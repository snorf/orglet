/**
 * SQL-level tests for the Bulk job storage: DDL, the single state writer, boot reconciliation, the
 * 7-day purge and the per-org drop. No org schema is migrated; job rows are inserted directly, and
 * every test uses a fresh org name so files and tests never see each other's rows.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import type { Pool } from "@orglet/schema";
import { openTestDb, usingPglite, type TestDb } from "../../../../test/db.js";
import type { JobState } from "./jobs.js";
import { BULK_INGEST_RESTART_MESSAGE, BULK_QUERY_RESTART_MESSAGE, dropBulkJobs, ensureBulkSchema, prepareBulk, purgeExpiredBulkJobs, setJobState } from "./schema.js";

let testDb: TestDb;
let pool: Pool;
const orgs: string[] = [];
const freshOrg = () => {
  const s = `test_${randomBytes(4).toString("hex")}`;
  orgs.push(s);
  return s;
};

const USER = ["005000000000001AAA", "00D000000000001AAA", "00e000000000001AAA"];

async function insertIngest(org: string, id: string, state: JobState, extra: { processed?: number; failed?: number } = {}) {
  await pool.query(
    `INSERT INTO "_orglet"."bulk_ingest_jobs" (org_schema, id, user_id, organization_id, profile_id, operation, object, line_ending, column_delimiter, api_version, state, number_records_processed, number_records_failed)
     VALUES ($1, $2, $3, $4, $5, 'insert', 'Account', 'LF', 'COMMA', '59.0', $6, $7, $8)`,
    [org, id, ...USER, state, extra.processed ?? 0, extra.failed ?? 0],
  );
}
async function insertQuery(org: string, id: string, state: JobState) {
  await pool.query(
    `INSERT INTO "_orglet"."bulk_query_jobs" (org_schema, id, user_id, organization_id, profile_id, operation, object, query, line_ending, column_delimiter, api_version, state)
     VALUES ($1, $2, $3, $4, $5, 'query', 'Account', 'SELECT Id FROM Account', 'LF', 'COMMA', '59.0', $6)`,
    [org, id, ...USER, state],
  );
}
async function insertResults(org: string, id: string, kind: "ingest" | "query") {
  for (const i of [0, 1]) {
    if (kind === "ingest") {
      await pool.query(`INSERT INTO "_orglet"."bulk_ingest_results" (org_schema, job_id, row_index, success, record_id, created) VALUES ($1, $2, $3, true, '001000000000001AAA', true)`, [org, id, i]);
    } else {
      await pool.query(`INSERT INTO "_orglet"."bulk_query_rows" (org_schema, job_id, row_index, cells) VALUES ($1, $2, $3, '["a"]'::jsonb)`, [org, id, i]);
    }
  }
}
const backdate = (table: "bulk_ingest_jobs" | "bulk_query_jobs", org: string, id: string, days: number) =>
  pool.query(`UPDATE "_orglet"."${table}" SET created_date = now() - make_interval(days => $3) WHERE org_schema = $1 AND id = $2`, [org, id, days]);
const stateOf = async (table: "bulk_ingest_jobs" | "bulk_query_jobs", org: string, id: string) =>
  (await pool.query<{ state: string }>(`SELECT state FROM "_orglet"."${table}" WHERE org_schema = $1 AND id = $2`, [org, id])).rows[0]?.state;
const count = async (table: string, org: string, col = "org_schema") =>
  Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM "_orglet"."${table}" WHERE ${col} = $1`, [org])).rows[0]?.n);

beforeAll(async () => {
  testDb = await openTestDb();
  pool = testDb.pool;
});

afterAll(async () => {
  for (const org of orgs) await dropBulkJobs(pool, org);
  await testDb.close();
});

describe("bulk job storage", () => {
  it("drop_before_the_tables_exist_returns_zero", async ({ skip }) => {
    skip(!usingPglite, "needs a database where the bulk tables were never created");
    expect(await dropBulkJobs(pool, freshOrg())).toBe(0);
    const r = await pool.query<{ t: string | null }>("SELECT to_regclass('_orglet.bulk_ingest_jobs')::text AS t");
    expect(r.rows[0]?.t).toBeNull();
  });

  it("ensure_creates_the_four_tables_and_is_idempotent", async () => {
    await ensureBulkSchema(pool);
    await ensureBulkSchema(pool);
    for (const t of ["bulk_ingest_jobs", "bulk_ingest_results", "bulk_query_jobs", "bulk_query_rows"]) {
      const r = await pool.query<{ t: string | null }>("SELECT to_regclass($1)::text AS t", [`_orglet.${t}`]);
      expect(r.rows[0]?.t, t).not.toBeNull();
    }
  });

  it("concurrent_ensure_does_not_fail", async ({ skip }) => {
    skip(usingPglite, "Postgres-only: pglite-socket serialises connections");
    await expect(Promise.all([ensureBulkSchema(pool), ensureBulkSchema(pool)])).resolves.toBeDefined();
  });

  it("state_writer_follows_the_transition_table", async () => {
    await ensureBulkSchema(pool);
    const org = freshOrg();
    const other = freshOrg();
    await insertIngest(org, "750A", "Open");
    await insertIngest(other, "750A", "Open");
    const to = (s: JobState, extra: { totalProcessingTime?: number; errorMessage?: string } = {}) => setJobState(pool, { kind: "ingest", orgSchema: org, id: "750A", to: s, ...extra });

    expect(await to("UploadComplete")).toBe(1);
    expect(await to("UploadComplete")).toBe(0);
    expect(await to("JobComplete")).toBe(0);
    expect(await to("InProgress")).toBe(1);
    expect(await to("JobComplete", { totalProcessingTime: 42 })).toBe(1);
    const row = (await pool.query<{ total_processing_time: number; ok: boolean }>(`SELECT total_processing_time, system_modstamp >= created_date AS ok FROM "_orglet"."bulk_ingest_jobs" WHERE org_schema = $1 AND id = '750A'`, [org])).rows[0];
    expect(row?.total_processing_time).toBe(42);
    expect(row?.ok).toBe(true);
    expect(await stateOf("bulk_ingest_jobs", other, "750A")).toBe("Open");

    await insertQuery(org, "750Q", "UploadComplete");
    expect(await setJobState(pool, { kind: "query", orgSchema: org, id: "750Q", to: "Open" })).toBe(0);
    expect(await setJobState(pool, { kind: "query", orgSchema: org, id: "750Q", to: "Failed", errorMessage: "boom" })).toBe(1);
    const q = (await pool.query<{ error_message: string }>(`SELECT error_message FROM "_orglet"."bulk_query_jobs" WHERE org_schema = $1 AND id = '750Q'`, [org])).rows[0];
    expect(q?.error_message).toBe("boom");
  });

  it("reconcile_fails_upload_complete_and_in_progress_jobs_of_this_org_only", async () => {
    await ensureBulkSchema(pool);
    const a = freshOrg();
    const b = freshOrg();
    await insertIngest(a, "i-open", "Open");
    await insertIngest(a, "i-uc", "UploadComplete");
    await insertIngest(a, "i-ip", "InProgress", { processed: 200, failed: 3 });
    await insertIngest(a, "i-done", "JobComplete");
    await insertQuery(a, "q-uc", "UploadComplete");
    await insertQuery(a, "q-ip", "InProgress");
    await insertQuery(a, "q-done", "JobComplete");
    await insertIngest(b, "i-ip", "InProgress");

    expect(await prepareBulk(pool, a)).toEqual({ reconciled: 4, purged: 0 });
    for (const id of ["i-uc", "i-ip"]) expect(await stateOf("bulk_ingest_jobs", a, id)).toBe("Failed");
    for (const id of ["q-uc", "q-ip"]) expect(await stateOf("bulk_query_jobs", a, id)).toBe("Failed");
    const msgs = await pool.query<{ id: string; error_message: string }>(`SELECT id, error_message FROM "_orglet"."bulk_ingest_jobs" WHERE org_schema = $1 AND state = 'Failed'`, [a]);
    expect(msgs.rows.every((r) => r.error_message === BULK_INGEST_RESTART_MESSAGE)).toBe(true);
    const qmsgs = await pool.query<{ error_message: string }>(`SELECT error_message FROM "_orglet"."bulk_query_jobs" WHERE org_schema = $1 AND state = 'Failed'`, [a]);
    expect(qmsgs.rows.every((r) => r.error_message === BULK_QUERY_RESTART_MESSAGE)).toBe(true);
    const counters = (await pool.query<{ number_records_processed: number; number_records_failed: number }>(`SELECT number_records_processed, number_records_failed FROM "_orglet"."bulk_ingest_jobs" WHERE org_schema = $1 AND id = 'i-ip'`, [a])).rows[0];
    expect(counters).toEqual({ number_records_processed: 200, number_records_failed: 3 });
    expect(await stateOf("bulk_ingest_jobs", a, "i-open")).toBe("Open");
    expect(await stateOf("bulk_ingest_jobs", a, "i-done")).toBe("JobComplete");
    expect(await stateOf("bulk_query_jobs", a, "q-done")).toBe("JobComplete");
    expect(await stateOf("bulk_ingest_jobs", b, "i-ip")).toBe("InProgress");
    expect((await prepareBulk(pool, a)).reconciled).toBe(0);
  });

  it("purge_deletes_jobs_older_than_seven_days_in_any_state_with_their_results", async () => {
    await ensureBulkSchema(pool);
    const a = freshOrg();
    const b = freshOrg();
    await insertIngest(a, "i-old", "JobComplete");
    await insertResults(a, "i-old", "ingest");
    await insertQuery(a, "q-old", "JobComplete");
    await insertResults(a, "q-old", "query");
    await insertIngest(a, "i-open-old", "Open");
    await insertIngest(a, "i-recent", "JobComplete");
    await insertIngest(b, "i-old", "JobComplete");
    await backdate("bulk_ingest_jobs", a, "i-old", 8);
    await backdate("bulk_query_jobs", a, "q-old", 8);
    await backdate("bulk_ingest_jobs", a, "i-open-old", 8);
    await backdate("bulk_ingest_jobs", a, "i-recent", 6);
    await backdate("bulk_ingest_jobs", b, "i-old", 8);

    expect(await purgeExpiredBulkJobs(pool, a)).toBe(3);
    expect(await stateOf("bulk_ingest_jobs", a, "i-recent")).toBe("JobComplete");
    expect(await count("bulk_ingest_jobs", a)).toBe(1);
    expect(await count("bulk_query_jobs", a)).toBe(0);
    expect(await count("bulk_ingest_results", a)).toBe(0);
    expect(await count("bulk_query_rows", a)).toBe(0);
    expect(await count("bulk_ingest_jobs", b)).toBe(1);
  });

  it("drop_removes_only_this_orgs_jobs_and_keeps_key_prefixes", async () => {
    await ensureBulkSchema(pool);
    const a = freshOrg();
    const b = freshOrg();
    for (const org of [a, b]) {
      await insertIngest(org, "i1", "JobComplete");
      await insertResults(org, "i1", "ingest");
      await insertQuery(org, "q1", "JobComplete");
      await insertResults(org, "q1", "query");
    }
    const hasPrefixes = ((await pool.query<{ t: string | null }>("SELECT to_regclass('_orglet.key_prefixes')::text AS t")).rows[0]?.t ?? null) !== null;
    if (hasPrefixes) await pool.query(`INSERT INTO "_orglet"."key_prefixes" (org_schema, object_name, key_prefix, source) VALUES ($1, 'Zz__c', 'zzz', 'test')`, [a]);

    expect(await dropBulkJobs(pool, a)).toBe(2);
    for (const t of ["bulk_ingest_jobs", "bulk_query_jobs", "bulk_ingest_results", "bulk_query_rows"]) {
      expect(await count(t, a), t).toBe(0);
      expect(await count(t, b), t).toBeGreaterThan(0);
    }
    if (hasPrefixes) {
      expect(await count("key_prefixes", a)).toBe(1);
      await pool.query(`DELETE FROM "_orglet"."key_prefixes" WHERE org_schema = $1`, [a]);
    }
  });
});
