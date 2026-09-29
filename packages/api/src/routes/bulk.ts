/**
 * Salesforce Bulk API 2.0: ingest jobs (CSV in, DML through the engine) and query jobs
 * (SOQL run eagerly, CSV out with offset-based paging). Everything is processed
 * synchronously within the request that triggers it; "Open" -> "UploadComplete" and
 * "query" job creation both do the real work before responding, which is allowed by the
 * spec ("synchronously is fine").
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { runQuery, type SaveError, type SaveResult, type Session } from "@orglet/engine";
import { formatSalesforceDatetime } from "@orglet/schema";
import { apiError, sendErrors, session, NOT_FOUND, type ApiContext } from "../server.js";
import { delimiterChar, lineEndingChars, parseCsv, writeCsv, type ColumnDelimiter, type LineEnding } from "../bulk/csv.js";
import { JobStore, newJobId, type IngestJob, type IngestOperation, type QueryJob } from "../bulk/jobs.js";

type Json = Record<string, unknown>;

const INGEST_OPERATIONS = new Set<IngestOperation>(["insert", "update", "upsert", "delete", "hardDelete"]);
const CHUNK_SIZE = 200;

function parseColumnDelimiter(v: unknown): ColumnDelimiter {
  const allowed: readonly string[] = ["COMMA", "TAB", "PIPE", "SEMICOLON", "CARET", "BACKQUOTE"];
  return typeof v === "string" && allowed.includes(v) ? (v as ColumnDelimiter) : "COMMA";
}

function parseLineEnding(v: unknown): LineEnding {
  return v === "CRLF" ? "CRLF" : "LF";
}

/** Look up a job by id, answering 404 (unknown or owned by a different session) otherwise. */
function findJob<T extends { session: Session }>(map: Map<string, T>, reply: FastifyReply, id: string, userId: string): T | undefined {
  const job = map.get(id);
  if (!job || job.session.userId !== userId) {
    void sendErrors(reply, 404, [NOT_FOUND]);
    return undefined;
  }
  return job;
}

function ingestJobInfo(job: IngestJob): Json {
  const info: Json = {
    id: job.id,
    operation: job.operation,
    object: job.object,
    createdById: job.session.userId,
    createdDate: job.createdDate,
    systemModstamp: job.systemModstamp,
    state: job.state,
    concurrencyMode: "Parallel",
    contentType: job.contentType,
    apiVersion: Number(job.apiVersion),
    contentUrl: `services/data/v${job.apiVersion}/jobs/ingest/${job.id}/batches`,
    lineEnding: job.lineEnding,
    columnDelimiter: job.columnDelimiter,
    numberRecordsProcessed: job.numberRecordsProcessed,
    numberRecordsFailed: job.numberRecordsFailed,
    retries: 0,
    totalProcessingTime: job.totalProcessingTime,
    apiActiveProcessingTime: job.totalProcessingTime,
    apexProcessingTime: 0,
    jobType: "V2Ingest",
  };
  if (job.externalIdFieldName) info["externalIdFieldName"] = job.externalIdFieldName;
  if (job.errorMessage) info["errorMessage"] = job.errorMessage;
  return info;
}

function queryJobInfo(job: QueryJob): Json {
  return {
    id: job.id,
    operation: job.operation,
    object: job.object,
    createdById: job.session.userId,
    createdDate: job.createdDate,
    systemModstamp: job.systemModstamp,
    state: job.state,
    concurrencyMode: "Parallel",
    contentType: job.contentType,
    apiVersion: Number(job.apiVersion),
    lineEnding: job.lineEnding,
    columnDelimiter: job.columnDelimiter,
    numberRecordsProcessed: job.numberRecordsProcessed,
    retries: 0,
    totalProcessingTime: job.totalProcessingTime,
    apiActiveProcessingTime: job.totalProcessingTime,
    apexProcessingTime: 0,
    jobType: "V2Query",
  };
}

function formatSaveError(e: SaveError | undefined): string {
  const err = e ?? { statusCode: "UNKNOWN_EXCEPTION", message: "", fields: [] };
  return `${err.statusCode}:${err.message}:${err.fields.join(",")}--`;
}

/**
 * Build one input record from a CSV row: `#N/A` is an explicit null; an empty value is null
 * on insert but "leave unchanged" (the key is simply omitted) on update/upsert/delete. The
 * `Id` column is normalised to canonical casing so the engine's update path recognises it
 * regardless of how the CSV header cased it.
 */
function buildRecord(header: string[], row: string[], blankIsNull: boolean): Record<string, unknown> {
  const record: Record<string, unknown> = {};
  header.forEach((col, i) => {
    const raw = row[i] ?? "";
    const key = col.toLowerCase() === "id" ? "Id" : col;
    if (raw === "#N/A") {
      record[key] = null;
      return;
    }
    if (raw === "") {
      if (blankIsNull) record[key] = null;
      return;
    }
    record[key] = raw;
  });
  return record;
}

/** Process an ingest job's uploaded CSV through the engine, in chunks of 200 records. */
async function processIngestJob(ctx: ApiContext, job: IngestJob): Promise<void> {
  const started = Date.now();
  const combined = job.csvChunks.join("");
  const parsed = parseCsv(combined, delimiterChar(job.columnDelimiter));
  if (parsed.header.length === 0) {
    job.state = "Failed";
    job.errorMessage = "InvalidBatch : the uploaded CSV had no header row";
    job.systemModstamp = formatSalesforceDatetime(new Date());
    return;
  }
  job.inputHeader = parsed.header;

  const relationshipColumns = parsed.header.filter((h) => h.includes("."));
  const isDelete = job.operation === "delete" || job.operation === "hardDelete";
  const successRows: string[][] = [];
  const failedRows: string[][] = [];

  if (relationshipColumns.length > 0) {
    const col = relationshipColumns[0] as string;
    const error: SaveError = { statusCode: "INVALID_FIELD", message: `UNSUPPORTED:bulk-relationship-column ${col} is not supported`, fields: [col] };
    for (const row of parsed.rows) failedRows.push(["", formatSaveError(error), ...row]);
  } else if (isDelete) {
    const idIndex = parsed.header.findIndex((h) => h.toLowerCase() === "id");
    for (let start = 0; start < parsed.rows.length; start += CHUNK_SIZE) {
      const chunk = parsed.rows.slice(start, start + CHUNK_SIZE);
      const ids = chunk.map((row) => (idIndex >= 0 ? (row[idIndex] ?? "") : ""));
      const results = await ctx.engine.delete(job.session, job.object, ids, { allOrNone: false });
      results.forEach((r, i) => {
        const row = chunk[i] as string[];
        if (r.success) successRows.push([r.id ?? "", "false", ...row]);
        else failedRows.push(["", formatSaveError(r.errors[0]), ...row]);
      });
    }
  } else {
    const blankIsNull = job.operation === "insert";
    for (let start = 0; start < parsed.rows.length; start += CHUNK_SIZE) {
      const chunk = parsed.rows.slice(start, start + CHUNK_SIZE);
      const records = chunk.map((row) => buildRecord(parsed.header, row, blankIsNull));
      let results: SaveResult[];
      if (job.operation === "insert") results = await ctx.engine.insert(job.session, job.object, records, { allOrNone: false });
      else if (job.operation === "update") results = await ctx.engine.update(job.session, job.object, records, { allOrNone: false });
      else results = await ctx.engine.upsert(job.session, job.object, job.externalIdFieldName ?? "Id", records, { allOrNone: false });
      results.forEach((r, i) => {
        const row = chunk[i] as string[];
        if (r.success) {
          const created = job.operation === "insert" ? true : job.operation === "update" ? false : (r.created ?? false);
          successRows.push([r.id ?? "", String(created), ...row]);
        } else {
          failedRows.push(["", formatSaveError(r.errors[0]), ...row]);
        }
      });
    }
  }

  job.successRows = successRows;
  job.failedRows = failedRows;
  job.numberRecordsProcessed = parsed.rows.length;
  job.numberRecordsFailed = failedRows.length;
  job.state = "JobComplete";
  job.systemModstamp = formatSalesforceDatetime(new Date());
  job.totalProcessingTime = Date.now() - started;
}

/** Does this shaped value look like a nested sobject (has `attributes`), not a leaf value? */
function isNestedRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value) && "attributes" in (value as Json);
}

/** Column order for the query results CSV: scalar fields first, then dotted parent paths, mirroring the compiled shape's key order. */
function flattenHeader(record: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (key === "attributes") continue;
    if (isNestedRecord(value)) out.push(...flattenHeader(value, `${prefix}${key}.`));
    else out.push(`${prefix}${key}`);
  }
  return out;
}

function flattenValue(record: Record<string, unknown>, path: string): unknown {
  const [head, ...rest] = path.split(".");
  const value = record[head ?? ""];
  if (rest.length === 0) return value;
  return isNestedRecord(value) ? flattenValue(value, rest.join(".")) : null;
}

function cellString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}

function flattenRow(record: Record<string, unknown>, header: string[]): string[] {
  return header.map((path) => cellString(flattenValue(record, path)));
}

export function registerBulkRoutes(app: FastifyInstance, ctx: ApiContext): void {
  const store = new JobStore();
  const version = (req: FastifyRequest) => req.apiVersion ?? ctx.defaultVersion;

  // Salesforce clients PUT raw CSV bytes as the batch body.
  app.addContentTypeParser("text/csv", { parseAs: "string" }, (_req, body, done) => done(null, body));

  // ---- ingest jobs --------------------------------------------------------------------

  app.post("/services/data/v:version/jobs/ingest", async (req, reply) => {
    const body = (req.body ?? {}) as Json;
    const objectName = typeof body["object"] === "string" ? body["object"] : "";
    const obj = ctx.engine.schema.getObject(objectName);
    if (!obj) return sendErrors(reply, 400, [apiError("INVALIDJOB", `InvalidJob : The object type '${objectName}' is not supported`)]);
    const operation = body["operation"] as IngestOperation;
    if (!INGEST_OPERATIONS.has(operation)) {
      return sendErrors(reply, 400, [apiError("INVALIDJOB", "InvalidJob : operation must be one of insert, update, upsert, delete, hardDelete")]);
    }
    const externalIdFieldName = typeof body["externalIdFieldName"] === "string" ? body["externalIdFieldName"] : undefined;
    if (operation === "upsert" && !externalIdFieldName) {
      return sendErrors(reply, 400, [apiError("INVALIDJOB", "InvalidJob : externalIdFieldName is required for upsert jobs")]);
    }
    const now = formatSalesforceDatetime(new Date());
    const job: IngestJob = {
      id: newJobId(),
      session: session(req),
      operation,
      object: obj.name,
      contentType: "CSV",
      lineEnding: parseLineEnding(body["lineEnding"]),
      columnDelimiter: parseColumnDelimiter(body["columnDelimiter"]),
      apiVersion: version(req),
      state: "Open",
      createdDate: now,
      systemModstamp: now,
      csvChunks: [],
      inputHeader: [],
      numberRecordsProcessed: 0,
      numberRecordsFailed: 0,
      successRows: [],
      failedRows: [],
      totalProcessingTime: 0,
      ...(externalIdFieldName ? { externalIdFieldName } : {}),
    };
    store.ingest.set(job.id, job);
    return reply.send(ingestJobInfo(job));
  });

  app.put<{ Params: { id: string } }>("/services/data/v:version/jobs/ingest/:id/batches", async (req, reply) => {
    const job = findJob(store.ingest, reply, req.params.id, session(req).userId);
    if (!job) return;
    if (job.state !== "Open") return sendErrors(reply, 400, [apiError("INVALIDJOBSTATE", `InvalidJobState : batches can only be added while the job is Open (is ${job.state})`)]);
    job.csvChunks.push(typeof req.body === "string" ? req.body : "");
    return reply.code(201).send();
  });

  app.patch<{ Params: { id: string } }>("/services/data/v:version/jobs/ingest/:id", async (req, reply) => {
    const job = findJob(store.ingest, reply, req.params.id, session(req).userId);
    if (!job) return;
    const state = (req.body as Json | undefined)?.["state"];
    if (state === "UploadComplete") {
      if (job.state !== "Open") return sendErrors(reply, 400, [apiError("INVALIDJOBSTATE", `InvalidJobState : cannot move to UploadComplete from ${job.state}`)]);
      await processIngestJob(ctx, job);
      return reply.send(ingestJobInfo(job));
    }
    if (state === "Aborted") {
      if (job.state !== "Open" && job.state !== "UploadComplete") {
        return sendErrors(reply, 400, [apiError("INVALIDJOBSTATE", `InvalidJobState : cannot abort a job in state ${job.state}`)]);
      }
      job.state = "Aborted";
      job.systemModstamp = formatSalesforceDatetime(new Date());
      return reply.send(ingestJobInfo(job));
    }
    return sendErrors(reply, 400, [apiError("INVALIDJOBSTATE", `InvalidJobState : unsupported state ${String(state)}`)]);
  });

  app.get<{ Params: { id: string } }>("/services/data/v:version/jobs/ingest/:id", async (req, reply) => {
    const job = findJob(store.ingest, reply, req.params.id, session(req).userId);
    if (!job) return;
    return reply.send(ingestJobInfo(job));
  });

  app.get("/services/data/v:version/jobs/ingest", async (req, reply) => {
    const userId = session(req).userId;
    const records = [...store.ingest.values()].filter((j) => j.session.userId === userId).map(ingestJobInfo);
    return reply.send({ done: true, records, nextRecordsUrl: null });
  });

  app.delete<{ Params: { id: string } }>("/services/data/v:version/jobs/ingest/:id", async (req, reply) => {
    const job = findJob(store.ingest, reply, req.params.id, session(req).userId);
    if (!job) return;
    if (job.state !== "JobComplete" && job.state !== "Failed" && job.state !== "Aborted") {
      return sendErrors(reply, 400, [apiError("INVALIDJOBSTATE", `InvalidJobState : cannot delete a job in state ${job.state}`)]);
    }
    store.ingest.delete(job.id);
    return reply.code(204).send();
  });

  app.get<{ Params: { id: string } }>("/services/data/v:version/jobs/ingest/:id/successfulResults", async (req, reply) => {
    const job = findJob(store.ingest, reply, req.params.id, session(req).userId);
    if (!job) return;
    const csv = writeCsv(["sf__Id", "sf__Created", ...job.inputHeader], job.successRows, delimiterChar(job.columnDelimiter), lineEndingChars(job.lineEnding));
    return reply.type("text/csv;charset=UTF-8").send(csv);
  });

  app.get<{ Params: { id: string } }>("/services/data/v:version/jobs/ingest/:id/failedResults", async (req, reply) => {
    const job = findJob(store.ingest, reply, req.params.id, session(req).userId);
    if (!job) return;
    const csv = writeCsv(["sf__Id", "sf__Error", ...job.inputHeader], job.failedRows, delimiterChar(job.columnDelimiter), lineEndingChars(job.lineEnding));
    return reply.type("text/csv;charset=UTF-8").send(csv);
  });

  app.get<{ Params: { id: string } }>("/services/data/v:version/jobs/ingest/:id/unprocessedrecords", async (req, reply) => {
    const job = findJob(store.ingest, reply, req.params.id, session(req).userId);
    if (!job) return;
    const csv = writeCsv(job.inputHeader, [], delimiterChar(job.columnDelimiter), lineEndingChars(job.lineEnding));
    return reply.type("text/csv;charset=UTF-8").send(csv);
  });

  // ---- query jobs ----------------------------------------------------------------------

  app.post("/services/data/v:version/jobs/query", async (req, reply) => {
    const body = (req.body ?? {}) as Json;
    const soql = typeof body["query"] === "string" ? body["query"] : "";
    const operation = body["operation"] === "queryAll" ? "queryAll" : "query";
    if (/\(\s*select\b/i.test(soql)) {
      return sendErrors(reply, 400, [apiError("FEATURE_NOT_ENABLED", "UNSUPPORTED:bulk-subquery child relationship subqueries are not supported in bulk query jobs")]);
    }
    const objectName = /\bfrom\s+([A-Za-z_]\w*)/i.exec(soql)?.[1] ?? "";
    const apiVersion = version(req);
    const s = session(req);

    const allRows: Record<string, unknown>[] = [];
    let offset = 0;
    for (;;) {
      const page = await runQuery(ctx.engine, s, soql, { includeDeleted: operation === "queryAll", apiVersion, batchSize: 2000, offset });
      allRows.push(...page.records);
      if (page.done || page.nextOffset === undefined) break;
      offset = page.nextOffset;
    }

    const header = allRows.length > 0 ? flattenHeader(allRows[0] as Record<string, unknown>) : [];
    const rows = allRows.map((r) => flattenRow(r, header));
    const now = formatSalesforceDatetime(new Date());
    const job: QueryJob = {
      id: newJobId(),
      session: s,
      operation,
      object: objectName,
      query: soql,
      contentType: "CSV",
      lineEnding: parseLineEnding(body["lineEnding"]),
      columnDelimiter: parseColumnDelimiter(body["columnDelimiter"]),
      apiVersion,
      state: "JobComplete",
      createdDate: now,
      systemModstamp: now,
      header,
      rows,
      numberRecordsProcessed: rows.length,
      totalProcessingTime: 0,
    };
    store.query.set(job.id, job);
    return reply.send(queryJobInfo(job));
  });

  app.get<{ Params: { id: string } }>("/services/data/v:version/jobs/query/:id", async (req, reply) => {
    const job = findJob(store.query, reply, req.params.id, session(req).userId);
    if (!job) return;
    return reply.send(queryJobInfo(job));
  });

  app.get("/services/data/v:version/jobs/query", async (req, reply) => {
    const userId = session(req).userId;
    const records = [...store.query.values()].filter((j) => j.session.userId === userId).map(queryJobInfo);
    return reply.send({ done: true, records, nextRecordsUrl: null });
  });

  app.get<{ Params: { id: string } }>("/services/data/v:version/jobs/query/:id/results", async (req, reply) => {
    const job = findJob(store.query, reply, req.params.id, session(req).userId);
    if (!job) return;
    const q = req.query as { maxRecords?: string; locator?: string };
    const offset = q.locator ? Number(q.locator) || 0 : 0;
    const max = q.maxRecords !== undefined ? Number(q.maxRecords) : undefined;
    const end = max !== undefined ? Math.min(job.rows.length, offset + max) : job.rows.length;
    const page = job.rows.slice(offset, end);
    const csv = writeCsv(job.header, page, delimiterChar(job.columnDelimiter), lineEndingChars(job.lineEnding));
    void reply.header("Sforce-NumberOfRecords", String(page.length));
    void reply.header("Sforce-Locator", end < job.rows.length ? String(end) : "null");
    return reply.type("text/csv;charset=UTF-8").send(csv);
  });

  app.patch<{ Params: { id: string } }>("/services/data/v:version/jobs/query/:id", async (req, reply) => {
    const job = findJob(store.query, reply, req.params.id, session(req).userId);
    if (!job) return;
    const state = (req.body as Json | undefined)?.["state"];
    if (state !== "Aborted") return sendErrors(reply, 400, [apiError("INVALIDJOBSTATE", `InvalidJobState : unsupported state ${String(state)}`)]);
    if (job.state !== "UploadComplete" && job.state !== "InProgress") {
      return sendErrors(reply, 400, [apiError("INVALIDJOBSTATE", `InvalidJobState : cannot abort a job in state ${job.state}`)]);
    }
    job.state = "Aborted";
    job.systemModstamp = formatSalesforceDatetime(new Date());
    return reply.send(queryJobInfo(job));
  });

  app.delete<{ Params: { id: string } }>("/services/data/v:version/jobs/query/:id", async (req, reply) => {
    const job = findJob(store.query, reply, req.params.id, session(req).userId);
    if (!job) return;
    store.query.delete(job.id);
    return reply.code(204).send();
  });
}
