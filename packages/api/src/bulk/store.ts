/**
 * The Postgres-backed Bulk job store (ingest half). Every method is one short statement or runs on a
 * caller-supplied client, so it never holds a pool client while the engine uses another. Only
 * `setState` changes a job's `state`, via schema.ts `setJobState` and its transition table.
 */
import type { Session } from "@orglet/engine";
import type { Pool, Queryable } from "@orglet/schema";
import { delimiterChar, parseCsv, type ColumnDelimiter, type LineEnding } from "./csv.js";
import type { IngestJob, IngestOperation, JobKind, JobState, QueryJob, QueryOperation } from "./jobs.js";
import { BULK_TABLES, purgeExpiredBulkJobs, setJobState, type StateChange } from "./schema.js";

export interface NewIngestJob {
  id: string;
  session: Session;
  operation: IngestOperation;
  object: string;
  externalIdFieldName?: string;
  lineEnding: LineEnding;
  columnDelimiter: ColumnDelimiter;
  apiVersion: string;
}

export interface NewQueryJob {
  id: string;
  session: Session;
  operation: QueryOperation;
  object: string;
  query: string;
  lineEnding: LineEnding;
  columnDelimiter: ColumnDelimiter;
  apiVersion: string;
}

export interface QueryPageRows {
  header: string[];
  rows: string[][];
  more: boolean;
}

export interface IngestResultRow {
  rowIndex: number;
  success: boolean;
  recordId: string | null;
  created: boolean | null;
  error: string | null;
}

/** Never `csv_data`: job reads must stay cheap however large the upload is. */
const JOB_COLUMNS =
  "id, user_id, organization_id, profile_id, operation, object, external_id_field, line_ending, column_delimiter, api_version, state, created_date, system_modstamp, number_records_processed, number_records_failed, total_processing_time, error_message";

interface IngestJobRow {
  id: string;
  user_id: string;
  organization_id: string;
  profile_id: string;
  operation: IngestOperation;
  object: string;
  external_id_field: string | null;
  line_ending: LineEnding;
  column_delimiter: ColumnDelimiter;
  api_version: string;
  state: JobState;
  created_date: string;
  system_modstamp: string;
  number_records_processed: number;
  number_records_failed: number;
  total_processing_time: number;
  error_message: string | null;
}

/** Never `result_header`: job reads stay cheap. */
const QUERY_COLUMNS =
  "id, user_id, organization_id, profile_id, operation, object, query, line_ending, column_delimiter, api_version, state, created_date, system_modstamp, number_records_processed, total_processing_time, error_message";

interface QueryJobRow {
  id: string;
  user_id: string;
  organization_id: string;
  profile_id: string;
  operation: QueryOperation;
  object: string;
  query: string;
  line_ending: LineEnding;
  column_delimiter: ColumnDelimiter;
  api_version: string;
  state: JobState;
  created_date: string;
  system_modstamp: string;
  number_records_processed: number;
  total_processing_time: number;
  error_message: string | null;
}

function toQueryJob(r: QueryJobRow): QueryJob {
  const job: QueryJob = {
    id: r.id,
    session: { userId: r.user_id, organizationId: r.organization_id, profileId: r.profile_id },
    operation: r.operation,
    object: r.object,
    query: r.query,
    contentType: "CSV",
    lineEnding: r.line_ending,
    columnDelimiter: r.column_delimiter,
    apiVersion: r.api_version,
    state: r.state,
    createdDate: r.created_date,
    systemModstamp: r.system_modstamp,
    numberRecordsProcessed: r.number_records_processed,
    totalProcessingTime: r.total_processing_time,
  };
  if (r.error_message !== null) job.errorMessage = r.error_message;
  return job;
}

/** Rows per INSERT when persisting query results. */
const QUERY_ROW_BLOCK = 1000;

function toIngestJob(r: IngestJobRow): IngestJob {
  const job: IngestJob = {
    id: r.id,
    session: { userId: r.user_id, organizationId: r.organization_id, profileId: r.profile_id },
    operation: r.operation,
    object: r.object,
    contentType: "CSV",
    lineEnding: r.line_ending,
    columnDelimiter: r.column_delimiter,
    apiVersion: r.api_version,
    state: r.state,
    createdDate: r.created_date,
    systemModstamp: r.system_modstamp,
    numberRecordsProcessed: r.number_records_processed,
    numberRecordsFailed: r.number_records_failed,
    totalProcessingTime: r.total_processing_time,
  };
  if (r.external_id_field !== null) job.externalIdFieldName = r.external_id_field;
  if (r.error_message !== null) job.errorMessage = r.error_message;
  return job;
}

export class BulkStore {
  constructor(
    private readonly pool: Pool,
    private readonly orgSchema: string,
  ) {}

  async createIngestJob(job: NewIngestJob): Promise<IngestJob> {
    const res = await this.pool.query<IngestJobRow>(
      `INSERT INTO ${BULK_TABLES.ingestJobs} (org_schema, id, user_id, organization_id, profile_id, operation, object, external_id_field, line_ending, column_delimiter, api_version, state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'Open') RETURNING ${JOB_COLUMNS}`,
      [
        this.orgSchema,
        job.id,
        job.session.userId,
        job.session.organizationId,
        job.session.profileId,
        job.operation,
        job.object,
        job.externalIdFieldName ?? null,
        job.lineEnding,
        job.columnDelimiter,
        job.apiVersion,
      ],
    );
    return toIngestJob(res.rows[0] as IngestJobRow);
  }

  async findIngestJob(id: string): Promise<IngestJob | undefined> {
    const res = await this.pool.query<IngestJobRow>(`SELECT ${JOB_COLUMNS} FROM ${BULK_TABLES.ingestJobs} WHERE org_schema = $1 AND id = $2`, [this.orgSchema, id]);
    return res.rows[0] ? toIngestJob(res.rows[0]) : undefined;
  }

  async listIngestJobs(userId: string): Promise<IngestJob[]> {
    const res = await this.pool.query<IngestJobRow>(`SELECT ${JOB_COLUMNS} FROM ${BULK_TABLES.ingestJobs} WHERE org_schema = $1 AND user_id = $2 ORDER BY created_date, id`, [
      this.orgSchema,
      userId,
    ]);
    return res.rows.map(toIngestJob);
  }

  /** Appends only while the job is Open; false means the job is gone or no longer accepts data. */
  async appendCsv(id: string, csv: string): Promise<boolean> {
    const res = await this.pool.query(
      `UPDATE ${BULK_TABLES.ingestJobs} SET csv_data = csv_data || $3, system_modstamp = now() WHERE org_schema = $1 AND id = $2 AND state = 'Open'`,
      [this.orgSchema, id, csv],
    );
    return (res.rowCount ?? 0) === 1;
  }

  async readIngestInput(id: string): Promise<{ header: string[]; rows: string[][] }> {
    const res = await this.pool.query<{ csv_data: string; column_delimiter: ColumnDelimiter }>(
      `SELECT csv_data, column_delimiter FROM ${BULK_TABLES.ingestJobs} WHERE org_schema = $1 AND id = $2`,
      [this.orgSchema, id],
    );
    const row = res.rows[0];
    return row ? parseCsv(row.csv_data, delimiterChar(row.column_delimiter)) : { header: [], rows: [] };
  }

  /** Result rows and counter increments in one go; run it on the same client as the chunk's DML so both commit or neither does. */
  async writeIngestChunk(client: Queryable, id: string, rows: IngestResultRow[]): Promise<void> {
    if (rows.length === 0) return;
    const payload = JSON.stringify(rows.map((r) => ({ row_index: r.rowIndex, success: r.success, record_id: r.recordId, created: r.created, error: r.error })));
    await client.query(
      `INSERT INTO ${BULK_TABLES.ingestResults} (org_schema, job_id, row_index, success, record_id, created, error)
       SELECT $1, $2, r.row_index, r.success, r.record_id, r.created, r.error
         FROM jsonb_to_recordset($3::jsonb) AS r(row_index integer, success boolean, record_id text, created boolean, error text)`,
      [this.orgSchema, id, payload],
    );
    await client.query(
      `UPDATE ${BULK_TABLES.ingestJobs} SET number_records_processed = number_records_processed + $3, number_records_failed = number_records_failed + $4, system_modstamp = now() WHERE org_schema = $1 AND id = $2`,
      [this.orgSchema, id, rows.length, rows.filter((r) => !r.success).length],
    );
  }

  async readIngestResults(id: string): Promise<IngestResultRow[]> {
    const res = await this.pool.query<{ row_index: number; success: boolean; record_id: string | null; created: boolean | null; error: string | null }>(
      `SELECT row_index, success, record_id, created, error FROM ${BULK_TABLES.ingestResults} WHERE org_schema = $1 AND job_id = $2 ORDER BY row_index`,
      [this.orgSchema, id],
    );
    return res.rows.map((r) => ({ rowIndex: r.row_index, success: r.success, recordId: r.record_id, created: r.created, error: r.error }));
  }

  async createQueryJob(job: NewQueryJob): Promise<QueryJob> {
    const res = await this.pool.query<QueryJobRow>(
      `INSERT INTO ${BULK_TABLES.queryJobs} (org_schema, id, user_id, organization_id, profile_id, operation, object, query, line_ending, column_delimiter, api_version, state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'UploadComplete') RETURNING ${QUERY_COLUMNS}`,
      [
        this.orgSchema,
        job.id,
        job.session.userId,
        job.session.organizationId,
        job.session.profileId,
        job.operation,
        job.object,
        job.query,
        job.lineEnding,
        job.columnDelimiter,
        job.apiVersion,
      ],
    );
    return toQueryJob(res.rows[0] as QueryJobRow);
  }

  async findQueryJob(id: string): Promise<QueryJob | undefined> {
    const res = await this.pool.query<QueryJobRow>(`SELECT ${QUERY_COLUMNS} FROM ${BULK_TABLES.queryJobs} WHERE org_schema = $1 AND id = $2`, [this.orgSchema, id]);
    return res.rows[0] ? toQueryJob(res.rows[0]) : undefined;
  }

  async listQueryJobs(userId: string): Promise<QueryJob[]> {
    const res = await this.pool.query<QueryJobRow>(`SELECT ${QUERY_COLUMNS} FROM ${BULK_TABLES.queryJobs} WHERE org_schema = $1 AND user_id = $2 ORDER BY created_date, id`, [
      this.orgSchema,
      userId,
    ]);
    return res.rows.map(toQueryJob);
  }

  /** Header, counter and rows on the caller's client, so they commit together with the JobComplete transition. */
  async writeQueryResults(client: Queryable, id: string, header: string[], rows: string[][]): Promise<void> {
    await client.query(
      `UPDATE ${BULK_TABLES.queryJobs} SET result_header = $3::jsonb, number_records_processed = $4, system_modstamp = now() WHERE org_schema = $1 AND id = $2`,
      [this.orgSchema, id, JSON.stringify(header), rows.length],
    );
    for (let start = 0; start < rows.length; start += QUERY_ROW_BLOCK) {
      const block = rows.slice(start, start + QUERY_ROW_BLOCK);
      await client.query(
        `INSERT INTO ${BULK_TABLES.queryRows} (org_schema, job_id, row_index, cells)
         SELECT $1, $2, $3::int + (t.ord::int) - 1, t.elem FROM jsonb_array_elements($4::jsonb) WITH ORDINALITY AS t(elem, ord)`,
        [this.orgSchema, id, start, JSON.stringify(block)],
      );
    }
  }

  /** `max` undefined means all rows from `offset`; reads one extra row to learn whether more follow. */
  async readQueryPage(id: string, offset: number, max: number | undefined): Promise<QueryPageRows> {
    const head = await this.pool.query<{ result_header: string[] | null }>(`SELECT result_header FROM ${BULK_TABLES.queryJobs} WHERE org_schema = $1 AND id = $2`, [
      this.orgSchema,
      id,
    ]);
    const header = head.rows[0]?.result_header ?? [];
    const res = await this.pool.query<{ cells: string[] }>(
      `SELECT cells FROM ${BULK_TABLES.queryRows} WHERE org_schema = $1 AND job_id = $2 AND row_index >= $3 ORDER BY row_index LIMIT $4`,
      [this.orgSchema, id, offset, max === undefined ? null : max + 1],
    );
    const fetched = res.rows.map((r) => r.cells);
    const more = max !== undefined && fetched.length > max;
    return { header, rows: max === undefined ? fetched : fetched.slice(0, max), more };
  }

  /** True when the job moved; false when the transition table refuses it from the job's current state. */
  async setState(change: Omit<StateChange, "orgSchema">, q?: Queryable): Promise<boolean> {
    return (await setJobState(q ?? this.pool, { ...change, orgSchema: this.orgSchema })) === 1;
  }

  async deleteJob(kind: JobKind, id: string, states: readonly JobState[]): Promise<boolean> {
    const table = kind === "ingest" ? BULK_TABLES.ingestJobs : BULK_TABLES.queryJobs;
    const res = await this.pool.query(`DELETE FROM ${table} WHERE org_schema = $1 AND id = $2 AND state = ANY($3::text[])`, [this.orgSchema, id, [...states]]);
    return (res.rowCount ?? 0) === 1;
  }

  purgeExpired(): Promise<number> {
    return purgeExpiredBulkJobs(this.pool, this.orgSchema);
  }
}
