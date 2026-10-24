/** Which formula roll-up columns the engine has already backfilled, per org (Phase 13 D-11). migrate() cannot compute a roll-up over a formula (it has no formula engine), so orglet up backfills those after the DmlEngine exists; a row here is written only after that backfill committed, so a crash between migrate and the backfill is redone on the next up, and a completed database stays silent. Lives in _orglet beside key_prefixes so dropping the org schema does not take it along; orglet reset deletes the org's rows explicitly. */
import { INTERNAL_SCHEMA, quote } from "./columns.js";
import { withTransaction, type Pool, type Queryable } from "./db.js";
import { ensureInternalSchema } from "./internal.js";

const TABLE = `${quote(INTERNAL_SCHEMA)}.${quote("rollup_backfills")}`;
const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS ${TABLE} (
  org_schema   text        NOT NULL,
  object_name  text        NOT NULL,
  field_name   text        NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_schema, object_name, field_name)
)`;

/** Lower-cased `object.field`, the key completedRollupBackfills returns. */
export function rollupBackfillKey(object: string, field: string): string {
  return `${object}.${field}`.toLowerCase();
}

export async function ensureRollupBackfillTable(pool: Pool): Promise<void> {
  await withTransaction(pool, async (client) => {
    await ensureInternalSchema(client);
    await client.query(CREATE_TABLE);
  });
}

async function tableExists(db: Queryable): Promise<boolean> {
  const exists = await db.query<{ t: string | null }>("SELECT to_regclass($1)::text AS t", [`${INTERNAL_SCHEMA}.rollup_backfills`]);
  return exists.rows[0] !== undefined && exists.rows[0].t !== null;
}

/** Keys (rollupBackfillKey) of every completed backfill for the org; empty when the table does not exist yet. */
export async function completedRollupBackfills(db: Queryable, orgSchema: string): Promise<Set<string>> {
  if (!(await tableExists(db))) return new Set();
  const res = await db.query<{ object_name: string; field_name: string }>(`SELECT object_name, field_name FROM ${TABLE} WHERE org_schema = $1`, [orgSchema]);
  return new Set(res.rows.map((r) => rollupBackfillKey(r.object_name, r.field_name)));
}

/** Record a completed backfill; call inside the backfill's own transaction so the row commits with the data. */
export async function markRollupBackfilled(db: Queryable, orgSchema: string, object: string, field: string): Promise<void> {
  await db.query(
    `INSERT INTO ${TABLE} (org_schema, object_name, field_name) VALUES ($1, $2, $3) ON CONFLICT (org_schema, object_name, field_name) DO UPDATE SET completed_at = now()`,
    [orgSchema, object, field],
  );
}

/** Remove one org's rows (orglet reset); 0 on a database that never ran up. */
export async function dropRollupBackfills(pool: Pool, orgSchema: string): Promise<number> {
  if (!(await tableExists(pool))) return 0;
  const res = await pool.query(`DELETE FROM ${TABLE} WHERE org_schema = $1`, [orgSchema]);
  return res.rowCount ?? 0;
}
