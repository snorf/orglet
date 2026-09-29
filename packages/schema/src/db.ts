import pg from "pg";

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
