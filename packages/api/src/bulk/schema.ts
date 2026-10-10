/**
 * Postgres storage for Bulk API 2.0 jobs. Jobs live in the `_orglet` schema, next to the key
 * prefixes and never inside the org schema, so they survive a restart and `DROP SCHEMA <org>`;
 * every row is keyed by `org_schema` first so several orgs in one database never see each other's jobs.
 * `setJobState` is the only writer of an existing job's `state` (D-08).
 *
 * Retention: jobs are purged when `created_date` is older than 7 days, in every state. Source: Limits
 * Quick Reference "Batch and job lifespan", Bulk API 2.0 column: "Jobs in a terminal state ... that are
 * older than seven days are deleted. Jobs in a non-terminal state that are older than seven days are
 * periodically cleaned up." The window is deliberately not configurable (D-11).
 *
 * Size limit: one job's uploaded CSV is a single `text` value. Postgres caps one value at 1 GB (it is
 * stored out of line, TOASTed) and the server buffers the upload in memory, so very large uploads
 * should be split across several jobs.
 */
import { ensureInternalSchema, INTERNAL_SCHEMA, quote, withTransaction, type Pool, type Queryable } from "@orglet/schema";
import { allowedFrom, type JobKind, type JobState } from "./jobs.js";

const S = quote(INTERNAL_SCHEMA);
const INGEST_JOBS = `${S}.${quote("bulk_ingest_jobs")}`;
const INGEST_RESULTS = `${S}.${quote("bulk_ingest_results")}`;
const QUERY_JOBS = `${S}.${quote("bulk_query_jobs")}`;
const QUERY_ROWS = `${S}.${quote("bulk_query_rows")}`;

export const BULK_TABLES = { ingestJobs: INGEST_JOBS, ingestResults: INGEST_RESULTS, queryJobs: QUERY_JOBS, queryRows: QUERY_ROWS } as const;

export const BULK_INGEST_RESTART_MESSAGE =
  "ServerRestarted : The server restarted while this job was in progress. Records already processed are listed in successfulResults and failedResults; records not yet processed are listed in unprocessedrecords.";
export const BULK_QUERY_RESTART_MESSAGE = "ServerRestarted : The server restarted while this job was in progress. No results were saved; create a new query job to run the query again.";

const DDL = [
  `CREATE TABLE IF NOT EXISTS ${INGEST_JOBS} (
  org_schema text NOT NULL, id text NOT NULL,
  user_id text NOT NULL, organization_id text NOT NULL, profile_id text NOT NULL,
  operation text NOT NULL, object text NOT NULL, external_id_field text,
  line_ending text NOT NULL, column_delimiter text NOT NULL, api_version text NOT NULL,
  state text NOT NULL,
  created_date timestamptz NOT NULL DEFAULT now(), system_modstamp timestamptz NOT NULL DEFAULT now(),
  csv_data text NOT NULL DEFAULT '',
  number_records_processed bigint NOT NULL DEFAULT 0, number_records_failed bigint NOT NULL DEFAULT 0,
  total_processing_time bigint NOT NULL DEFAULT 0, error_message text,
  PRIMARY KEY (org_schema, id))`,
  `CREATE TABLE IF NOT EXISTS ${INGEST_RESULTS} (
  org_schema text NOT NULL, job_id text NOT NULL, row_index integer NOT NULL,
  success boolean NOT NULL, record_id text, created boolean, error text,
  PRIMARY KEY (org_schema, job_id, row_index),
  FOREIGN KEY (org_schema, job_id) REFERENCES ${INGEST_JOBS} (org_schema, id) ON DELETE CASCADE)`,
  `CREATE TABLE IF NOT EXISTS ${QUERY_JOBS} (
  org_schema text NOT NULL, id text NOT NULL,
  user_id text NOT NULL, organization_id text NOT NULL, profile_id text NOT NULL,
  operation text NOT NULL, object text NOT NULL, query text NOT NULL,
  line_ending text NOT NULL, column_delimiter text NOT NULL, api_version text NOT NULL,
  state text NOT NULL,
  created_date timestamptz NOT NULL DEFAULT now(), system_modstamp timestamptz NOT NULL DEFAULT now(),
  result_header jsonb, number_records_processed bigint NOT NULL DEFAULT 0,
  total_processing_time bigint NOT NULL DEFAULT 0, error_message text,
  PRIMARY KEY (org_schema, id))`,
  `CREATE TABLE IF NOT EXISTS ${QUERY_ROWS} (
  org_schema text NOT NULL, job_id text NOT NULL, row_index integer NOT NULL, cells jsonb NOT NULL,
  PRIMARY KEY (org_schema, job_id, row_index),
  FOREIGN KEY (org_schema, job_id) REFERENCES ${QUERY_JOBS} (org_schema, id) ON DELETE CASCADE)`,
  `CREATE INDEX IF NOT EXISTS bulk_ingest_jobs_created ON ${INGEST_JOBS} (org_schema, created_date)`,
  `CREATE INDEX IF NOT EXISTS bulk_query_jobs_created ON ${QUERY_JOBS} (org_schema, created_date)`,
];

/** Create the four job tables; idempotent and safe to call from concurrent processes. */
export async function ensureBulkSchema(pool: Pool): Promise<void> {
  await withTransaction(pool, async (client) => {
    await ensureInternalSchema(client);
    for (const sql of DDL) await client.query(sql);
  });
}

export interface StateChange {
  kind: JobKind;
  orgSchema: string;
  to: JobState;
  /** One job; omitted only by boot reconciliation. */
  id?: string;
  /** Narrow the predecessor states further than TRANSITIONS allows. */
  from?: readonly JobState[];
  errorMessage?: string;
  totalProcessingTime?: number;
}

const jobsTable = (kind: JobKind) => (kind === "ingest" ? INGEST_JOBS : QUERY_JOBS);

/** The only writer of an existing job's state (D-08): a compare-and-set UPDATE against TRANSITIONS. Returns the number of jobs moved. */
export async function setJobState(q: Queryable, change: StateChange): Promise<number> {
  const { from } = change;
  const predecessors = allowedFrom(change.kind, change.to).filter((s) => from === undefined || from.includes(s));
  if (predecessors.length === 0) return 0;
  const params: unknown[] = [change.to, change.errorMessage ?? null, change.totalProcessingTime ?? null, change.orgSchema, predecessors];
  let sql = `UPDATE ${jobsTable(change.kind)} SET state = $1, system_modstamp = now(), error_message = COALESCE($2, error_message), total_processing_time = COALESCE($3, total_processing_time) WHERE org_schema = $4 AND state = ANY($5::text[])`;
  if (change.id !== undefined) {
    params.push(change.id);
    sql += " AND id = $6";
  }
  const res = await q.query(sql, params);
  return res.rowCount ?? 0;
}

/** Fail every job a previous run left at UploadComplete or InProgress (D-07, D-16); counters stay as persisted. */
export async function reconcileBulkJobs(pool: Pool, orgSchema: string): Promise<number> {
  const from: JobState[] = ["UploadComplete", "InProgress"];
  const ingest = await setJobState(pool, { kind: "ingest", orgSchema, to: "Failed", from, errorMessage: BULK_INGEST_RESTART_MESSAGE });
  const query = await setJobState(pool, { kind: "query", orgSchema, to: "Failed", from, errorMessage: BULK_QUERY_RESTART_MESSAGE });
  return ingest + query;
}

/** Delete this org's jobs created more than 7 days ago, in any state; results and rows cascade. */
export async function purgeExpiredBulkJobs(q: Queryable, orgSchema: string): Promise<number> {
  let n = 0;
  for (const table of [INGEST_JOBS, QUERY_JOBS]) {
    const res = await q.query(`DELETE FROM ${table} WHERE org_schema = $1 AND created_date < now() - interval '7 days'`, [orgSchema]);
    n += res.rowCount ?? 0;
  }
  return n;
}

export interface PrepareBulkResult {
  reconciled: number;
  purged: number;
}

/** Boot step for `orglet up`: create the tables, fail jobs left mid-flight, drop expired jobs (D-04). */
export async function prepareBulk(pool: Pool, orgSchema: string): Promise<PrepareBulkResult> {
  await ensureBulkSchema(pool);
  const reconciled = await reconcileBulkJobs(pool, orgSchema);
  const purged = await purgeExpiredBulkJobs(pool, orgSchema);
  return { reconciled, purged };
}

/** Remove one org's jobs (results cascade); safe when the tables were never created, leaves other orgs and key prefixes alone (D-02). */
export async function dropBulkJobs(pool: Pool, orgSchema: string): Promise<number> {
  let n = 0;
  for (const [reg, table] of [
    [`${INTERNAL_SCHEMA}.bulk_ingest_jobs`, INGEST_JOBS],
    [`${INTERNAL_SCHEMA}.bulk_query_jobs`, QUERY_JOBS],
  ] as const) {
    const exists = await pool.query<{ t: string | null }>("SELECT to_regclass($1)::text AS t", [reg]);
    if (exists.rows[0] === undefined || exists.rows[0].t === null) continue;
    const res = await pool.query(`DELETE FROM ${table} WHERE org_schema = $1`, [orgSchema]);
    n += res.rowCount ?? 0;
  }
  return n;
}
