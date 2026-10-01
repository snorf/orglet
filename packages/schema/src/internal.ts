/**
 * The `_orglet` schema holds orglet's own bookkeeping (custom-object key prefixes now, Bulk jobs
 * later) next to, never inside, an org schema, so `orglet reset` dropping the org schema cannot
 * take it along. CREATE ... IF NOT EXISTS is not safe under concurrent sessions (both can pass the
 * existence check and one then fails on the catalog unique index), so callers hold a constant
 * transaction-scoped advisory lock first; it also serialises their own CREATE TABLE IF NOT EXISTS
 * that follows, and is released at COMMIT/ROLLBACK.
 */
import { INTERNAL_SCHEMA, quote } from "./columns.js";
import type { PoolClient } from "./db.js";

export async function ensureInternalSchema(client: PoolClient): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [INTERNAL_SCHEMA]);
  await client.query(`CREATE SCHEMA IF NOT EXISTS ${quote(INTERNAL_SCHEMA)}`);
}
