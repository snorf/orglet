/**
 * In-memory Bulk API 2.0 job store. Lives entirely in this module: `ApiContext` itself is
 * untouched, so each call to `registerBulkRoutes()` gets its own store, scoped to that
 * server instance (tests that spin up several servers never see each other's jobs).
 */
import type { Session } from "@orglet/engine";
import { generateId } from "@orglet/schema";
import type { ColumnDelimiter, LineEnding } from "./csv.js";

export type IngestOperation = "insert" | "update" | "upsert" | "delete" | "hardDelete";
export type QueryOperation = "query" | "queryAll";
export type JobState = "Open" | "UploadComplete" | "InProgress" | "JobComplete" | "Failed" | "Aborted";

export interface IngestJob {
  id: string;
  /** The session that created the job; ingest data is always processed as this user. */
  session: Session;
  operation: IngestOperation;
  object: string;
  externalIdFieldName?: string;
  contentType: "CSV";
  lineEnding: LineEnding;
  columnDelimiter: ColumnDelimiter;
  apiVersion: string;
  state: JobState;
  createdDate: string;
  systemModstamp: string;
  /** Raw CSV text appended by each `PUT .../batches` call, concatenated at UploadComplete. */
  csvChunks: string[];
  inputHeader: string[];
  numberRecordsProcessed: number;
  numberRecordsFailed: number;
  errorMessage?: string;
  /** `sf__Id, sf__Created, <input columns>`, one row per succeeded record. */
  successRows: string[][];
  /** `sf__Id, sf__Error, <input columns>`, one row per failed record. */
  failedRows: string[][];
  totalProcessingTime: number;
}

export interface QueryJob {
  id: string;
  session: Session;
  operation: QueryOperation;
  object: string;
  query: string;
  contentType: "CSV";
  lineEnding: LineEnding;
  columnDelimiter: ColumnDelimiter;
  apiVersion: string;
  state: JobState;
  createdDate: string;
  systemModstamp: string;
  header: string[];
  rows: string[][];
  numberRecordsProcessed: number;
  totalProcessingTime: number;
}

export class JobStore {
  readonly ingest = new Map<string, IngestJob>();
  readonly query = new Map<string, QueryJob>();
}

/** Salesforce-looking 18-character job id with the Bulk API 2.0 key prefix. */
export function newJobId(): string {
  return generateId("750");
}
