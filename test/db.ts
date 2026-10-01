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
