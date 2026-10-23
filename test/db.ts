/**
 * One switch for which Postgres the tests talk to (D-09, D-21). With ORGLET_DATABASE_URL set, tests
 * use that server; without it, each test file starts its own in-memory pglite behind pglite-socket and
 * reaches it through the ordinary pg pool, so no Docker is needed. A per-file instance rather than one
 * shared instance, because pglite-socket runs every connection through a single query queue and
 * interleaved transactions from parallel test files can block each other indefinitely.
 * pglite-socket needs Node 19+ (global CustomEvent); the project pins Node 22.
 */
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { createPool, databaseUrlFromEnv, type Pool } from "@orglet/schema";

/** True when the suite runs on embedded pglite. Postgres-only tests skip on this, with a reason. */
export const usingPglite = databaseUrlFromEnv() === undefined;

export interface TestDb {
  pool: Pool;
  close: () => Promise<void>;
}

/**
 * Work around electric-sql/pglite#958 (present in pglite <= 0.5.10, pglite-socket <= 0.2.13): when an
 * extended-protocol message (Parse/Bind/Execute) fails, pglite answers ErrorResponse + ReadyForQuery at
 * once instead of waiting for the client's Sync, then answers the Sync with a second ReadyForQuery. pg
 * takes the first one as the end of the query and sends its next query; the second one then desyncs the
 * protocol ("Received unexpected parseComplete message from backend") and the pool client is dead. The
 * race is intermittent and shows up as a 500 on the second DUPLICATE_VALUE insert of a test file.
 *
 * pglite-socket runs every client message through `queryQueue.enqueue` with its own response callback,
 * so the server can be given Postgres's ordering: after an ErrorResponse inside an extended-protocol
 * batch, drop everything (the premature ReadyForQuery, errors for the now-pointless Bind/Execute) until
 * the client's Sync, whose own ReadyForQuery is the one the client waits for. Simple Query, Sync and the
 * startup packet pass through untouched. Remove once the upstream fix (pglite PR #1144) is released.
 */
function installExtendedProtocolErrorFilter(server: PGLiteSocketServer): void {
  type Enqueue = (handlerId: number, message: Uint8Array, onData: (data: Uint8Array) => void) => Promise<number>;
  const queue = (server as unknown as { queryQueue: { enqueue: Enqueue } }).queryQueue;
  const original = queue.enqueue.bind(queue);
  const discarding = new Map<number, boolean>();
  queue.enqueue = (handlerId, message, onData) => {
    // Startup packets have no type byte (they begin with a length whose high byte is 0).
    const type = message[0] === 0 ? "startup" : String.fromCharCode(message[0] ?? 0);
    if (type === "startup" || type === "Q" || type === "S") {
      discarding.set(handlerId, false);
      return original(handlerId, message, onData);
    }
    let carry = Buffer.alloc(0);
    const filtered = (chunk: Uint8Array): void => {
      carry = Buffer.concat([carry, Buffer.from(chunk)]);
      const out: Buffer[] = [];
      while (carry.length >= 5) {
        const len = 1 + carry.readInt32BE(1);
        if (carry.length < len) break;
        const msg = carry.subarray(0, len);
        carry = carry.subarray(len);
        const kind = String.fromCharCode(msg[0] ?? 0);
        if (discarding.get(handlerId)) continue;
        if (kind === "Z") continue; // premature ReadyForQuery: Postgres only sends it for Query or Sync
        if (kind === "E") discarding.set(handlerId, true);
        out.push(Buffer.from(msg));
      }
      if (out.length > 0) onData(new Uint8Array(Buffer.concat(out)));
    };
    return original(handlerId, message, filtered);
  };
}

export async function openTestDb(): Promise<TestDb> {
  const url = databaseUrlFromEnv();
  if (url !== undefined) {
    const pool = createPool(url);
    try {
      await pool.query("SELECT 1");
    } catch (err) {
      await pool.end();
      throw new Error(`Postgres not reachable at ${url} (start it with \`pnpm db:up\`, or unset ORGLET_DATABASE_URL to use embedded pglite): ${String(err)}`);
    }
    return { pool, close: () => pool.end() };
  }
  const db = await PGlite.create();
  // pglite-socket allows one connection by default. pg-pool destroys a client after a failed query
  // and reconnects at once; if the server has not yet processed the old socket's close, the new
  // connection is rejected and the next query fails with ECONNRESET. Allow as many sockets as the
  // pool can open (pg.Pool default max is 10); they are still served one query at a time.
  const server = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1", maxConnections: 10 });
  installExtendedProtocolErrorFilter(server);
  await server.start();
  const pool = createPool(`postgres://postgres:postgres@${server.getServerConn()}/postgres`);
  return {
    pool,
    close: async () => {
      await pool.end();
      await server.stop();
      await db.close();
    },
  };
}
