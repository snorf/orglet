/**
 * DB-level tests of the Postgres-backed Bulk job store: job round trip, CSV appends, per-chunk
 * results with counters, per-user listing, guarded deletes and the transition table. No org schema
 * is migrated; every file uses a fresh org name so files never see each other's rows.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { withTransaction, type Pool } from "@orglet/schema";
import { openTestDb, type TestDb } from "../../../../test/db.js";
import { DELETABLE, newJobId } from "./jobs.js";
import { dropBulkJobs, ensureBulkSchema } from "./schema.js";
import { BulkStore, type NewIngestJob, type NewQueryJob } from "./store.js";

let testDb: TestDb;
let pool: Pool;
const orgSchema = `test_${randomBytes(4).toString("hex")}`;
const otherOrg = `test_${randomBytes(4).toString("hex")}`;
const USER_A = { userId: "005000000000001AAA", organizationId: "00D000000000001AAA", profileId: "00e000000000001AAA" };
const USER_B = { userId: "005000000000002AAA", organizationId: "00D000000000001AAA", profileId: "00e000000000001AAA" };

let store: BulkStore;
const newJob = (over: Partial<NewIngestJob> = {}): NewIngestJob => ({
  id: newJobId(),
  session: USER_A,
  operation: "insert",
  object: "Account",
  lineEnding: "LF",
  columnDelimiter: "COMMA",
  apiVersion: "59.0",
  ...over,
});

beforeAll(async () => {
  testDb = await openTestDb();
  pool = testDb.pool;
  await ensureBulkSchema(pool);
  store = new BulkStore(pool, orgSchema);
});

afterAll(async () => {
  await dropBulkJobs(pool, orgSchema);
  await dropBulkJobs(pool, otherOrg);
  await testDb.close();
});

describe("ingest job store", () => {
  it("created_ingest_job_round_trips_through_postgres", async () => {
    const job = await store.createIngestJob(newJob());
    expect(job).toMatchObject({ state: "Open", numberRecordsProcessed: 0, numberRecordsFailed: 0, totalProcessingTime: 0, session: USER_A, contentType: "CSV" });
    expect(job.createdDate).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}\+0000$/);
    expect("externalIdFieldName" in job).toBe(false);
    expect(await store.findIngestJob(job.id)).toEqual(job);
    const withExt = await store.createIngestJob(newJob({ operation: "upsert", externalIdFieldName: "Ext__c" }));
    expect(withExt.externalIdFieldName).toBe("Ext__c");
  });

  it("csv_appends_only_while_open", async () => {
    const job = await store.createIngestJob(newJob());
    expect(await store.appendCsv(job.id, "Name\nA\n")).toBe(true);
    expect(await store.appendCsv(job.id, "B\n")).toBe(true);
    expect(await store.readIngestInput(job.id)).toEqual({ header: ["Name"], rows: [["A"], ["B"]] });
    expect(await store.setState({ kind: "ingest", id: job.id, to: "Aborted" })).toBe(true);
    expect(await store.appendCsv(job.id, "C\n")).toBe(false);
  });

  it("chunk_results_and_counters_are_written_together", async () => {
    const job = await store.createIngestJob(newJob());
    await withTransaction(pool, (c) =>
      store.writeIngestChunk(c, job.id, [
        { rowIndex: 0, success: true, recordId: "001000000000001AAA", created: true, error: null },
        { rowIndex: 1, success: false, recordId: null, created: null, error: "REQUIRED_FIELD_MISSING:x:Name--" },
      ]),
    );
    expect(await store.findIngestJob(job.id)).toMatchObject({ numberRecordsProcessed: 2, numberRecordsFailed: 1 });
    expect((await store.readIngestResults(job.id)).map((r) => r.rowIndex)).toEqual([0, 1]);
    await withTransaction(pool, (c) => store.writeIngestChunk(c, job.id, [{ rowIndex: 2, success: true, recordId: "001000000000002AAA", created: false, error: null }]));
    expect(await store.findIngestJob(job.id)).toMatchObject({ numberRecordsProcessed: 3, numberRecordsFailed: 1 });
    const results = await store.readIngestResults(job.id);
    expect(results[1]).toEqual({ rowIndex: 1, success: false, recordId: null, created: null, error: "REQUIRED_FIELD_MISSING:x:Name--" });
  });

  it("list_shows_only_the_users_jobs_of_this_org", async () => {
    const mine = new BulkStore(pool, otherOrg);
    const a1 = await mine.createIngestJob(newJob());
    const a2 = await mine.createIngestJob(newJob());
    await mine.createIngestJob(newJob({ session: USER_B }));
    await store.createIngestJob(newJob());
    const listed = await mine.listIngestJobs(USER_A.userId);
    expect(listed.map((j) => j.id).sort()).toEqual([a1.id, a2.id].sort());
    const sorted = [...listed].sort((x, y) => (x.createdDate === y.createdDate ? x.id.localeCompare(y.id) : x.createdDate.localeCompare(y.createdDate)));
    expect(listed.map((j) => j.id)).toEqual(sorted.map((j) => j.id));
  });

  it("delete_respects_the_allowed_states", async () => {
    const job = await store.createIngestJob(newJob());
    await store.appendCsv(job.id, "Name\nA\n");
    expect(await store.deleteJob("ingest", job.id, DELETABLE.ingest)).toBe(false);
    expect(await store.findIngestJob(job.id)).toBeDefined();
    await store.setState({ kind: "ingest", id: job.id, to: "Aborted" });
    await withTransaction(pool, (c) => store.writeIngestChunk(c, job.id, [{ rowIndex: 0, success: true, recordId: "001000000000001AAA", created: true, error: null }]));
    expect(await store.deleteJob("ingest", job.id, DELETABLE.ingest)).toBe(true);
    expect(await store.findIngestJob(job.id)).toBeUndefined();
    expect(await store.readIngestResults(job.id)).toEqual([]);
  });

  it("set_state_refuses_transitions_outside_the_table", async () => {
    const job = await store.createIngestJob(newJob());
    expect(await store.setState({ kind: "ingest", id: job.id, to: "JobComplete" })).toBe(false);
    expect(await store.setState({ kind: "ingest", id: job.id, to: "UploadComplete" })).toBe(true);
    expect(await store.setState({ kind: "ingest", id: job.id, to: "InProgress" })).toBe(true);
    expect(await store.setState({ kind: "ingest", id: job.id, to: "JobComplete", totalProcessingTime: 42 })).toBe(true);
    expect(await store.findIngestJob(job.id)).toMatchObject({ state: "JobComplete", totalProcessingTime: 42 });
  });
});

const newQuery = (over: Partial<NewQueryJob> = {}): NewQueryJob => ({
  id: newJobId(),
  session: USER_A,
  operation: "query",
  object: "Account",
  query: "SELECT Id FROM Account",
  lineEnding: "LF",
  columnDelimiter: "COMMA",
  apiVersion: "59.0",
  ...over,
});

describe("query job store", () => {
  it("query_job_is_born_upload_complete", async () => {
    const job = await store.createQueryJob(newQuery());
    expect(job).toMatchObject({ state: "UploadComplete", numberRecordsProcessed: 0, session: USER_A, contentType: "CSV" });
    expect("errorMessage" in job).toBe(false);
    expect(await store.findQueryJob(job.id)).toEqual(job);
    expect(await store.setState({ kind: "query", id: job.id, to: "Open" })).toBe(false);
  });

  it("query_rows_page_by_offset", async () => {
    const job = await store.createQueryJob(newQuery());
    const rows = Array.from({ length: 2500 }, (_, i) => [String(i), `N${i}`]);
    await withTransaction(pool, (c) => store.writeQueryResults(c, job.id, ["Id", "Name"], rows));
    expect(await store.findQueryJob(job.id)).toMatchObject({ numberRecordsProcessed: 2500 });
    const first = await store.readQueryPage(job.id, 0, 1000);
    expect(first.rows).toHaveLength(1000);
    expect(first.rows[0]).toEqual(["0", "N0"]);
    expect(first.more).toBe(true);
    expect(first.header).toEqual(["Id", "Name"]);
    const last = await store.readQueryPage(job.id, 2000, 1000);
    expect(last.rows).toHaveLength(500);
    expect(last.more).toBe(false);
    const all = await store.readQueryPage(job.id, 0, undefined);
    expect(all.rows).toHaveLength(2500);
    expect(all.more).toBe(false);
    expect(await store.readQueryPage(job.id, 5000, 10)).toMatchObject({ rows: [], more: false });
  });

  it("empty_query_result_has_a_header_and_no_rows", async () => {
    const job = await store.createQueryJob(newQuery());
    await withTransaction(pool, (c) => store.writeQueryResults(c, job.id, [], []));
    expect(await store.readQueryPage(job.id, 0, 10)).toEqual({ header: [], rows: [], more: false });
    expect(await store.findQueryJob(job.id)).toMatchObject({ numberRecordsProcessed: 0 });
  });

  it("query_jobs_are_listed_per_user", async () => {
    const org = new BulkStore(pool, `test_${randomBytes(4).toString("hex")}`);
    const a1 = await org.createQueryJob(newQuery());
    const a2 = await org.createQueryJob(newQuery());
    await org.createQueryJob(newQuery({ session: USER_B }));
    const listed = await org.listQueryJobs(USER_A.userId);
    expect(listed.map((j) => j.id).sort()).toEqual([a1.id, a2.id].sort());
  });
});
