import pg from "pg";

// Render Postgres values the way the Salesforce REST API does, so no layer above has to
// know what the driver would otherwise hand back (Date objects, numeric strings).
const OID = { DATE: 1082, TIME: 1083, TIMESTAMPTZ: 1184, NUMERIC: 1700, INT8: 20 } as const;
pg.types.setTypeParser(OID.DATE, (v) => v);
pg.types.setTypeParser(OID.NUMERIC, (v) => Number(v));
pg.types.setTypeParser(OID.INT8, (v) => Number(v));
pg.types.setTypeParser(OID.TIME, (v) => {
  const [h = "00", m = "00", rest = "00"] = v.split(":");
  const [s = "00", frac = ""] = rest.split(".");
  return `${h}:${m}:${s}.${frac.padEnd(3, "0").slice(0, 3)}Z`;
});
pg.types.setTypeParser(OID.TIMESTAMPTZ, (v) => formatSalesforceDatetime(new Date(v)));

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** `2024-01-31T13:45:00.000+0000`, always UTC. */
export function formatSalesforceDatetime(d: Date): string {
  return (
    `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}` +
    `T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)}+0000`
  );
}

export type Pool = pg.Pool;
export type PoolClient = pg.PoolClient;
export type Queryable = Pick<pg.PoolClient, "query">;

export function createPool(connectionString: string): Pool {
  return new pg.Pool({ connectionString });
}

export function databaseUrlFromEnv(): string {
  return process.env["ORGLET_DATABASE_URL"] ?? "postgres://orglet:orglet@localhost:5433/orglet";
}

export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}
