/**
 * Application-level Bulk API 2.0 job shapes and the state-transition rules. Jobs themselves live
 * in Postgres (see store.ts); only query jobs still sit in the in-memory `JobStore` until they move too.
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
  numberRecordsProcessed: number;
  numberRecordsFailed: number;
  errorMessage?: string;
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
  readonly query = new Map<string, QueryJob>();
}

/** Salesforce-looking 18-character job id with the Bulk API 2.0 key prefix. */
export function newJobId(): string {
  return generateId("750");
}

export type JobKind = "ingest" | "query";

/** Every state a job may move to from each state; the only source of truth for state changes (D-08). Boot reconciliation uses UploadComplete/InProgress -> Failed. */
export const TRANSITIONS: Record<JobKind, Partial<Record<JobState, readonly JobState[]>>> = {
  ingest: { Open: ["UploadComplete", "Aborted"], UploadComplete: ["InProgress", "Aborted", "Failed"], InProgress: ["JobComplete", "Failed"] },
  query: { UploadComplete: ["InProgress", "Aborted", "Failed"], InProgress: ["JobComplete", "Failed", "Aborted"] },
};

/** The only states a client may request with PATCH. */
export const CLIENT_SETTABLE: ReadonlySet<string> = new Set<JobState>(["UploadComplete", "Aborted"]);

/** States in which DELETE is allowed (guide: Delete a Job / Delete a Query Job). */
export const DELETABLE: Record<JobKind, readonly JobState[]> = {
  ingest: ["UploadComplete", "JobComplete", "Aborted", "Failed"],
  query: ["JobComplete", "Aborted", "Failed"],
};

/** States from which `to` is reachable. */
export function allowedFrom(kind: JobKind, to: JobState): JobState[] {
  return (Object.entries(TRANSITIONS[kind]) as [JobState, readonly JobState[]][]).filter(([, tos]) => tos.includes(to)).map(([from]) => from);
}
