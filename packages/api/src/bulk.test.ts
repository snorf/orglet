import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { loadOrgSchema, type OrgSchema } from "@orglet/metadata";
import { migrate, quote, type Pool } from "@orglet/schema";
import { openTestDb, type TestDb } from "../../../test/db.js";
import { bootstrapOrg, DmlEngine } from "@orglet/engine";
import { createApiServer } from "./server.js";
import { parseCsv, writeCsv } from "./bulk/csv.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));
const orgSchema = `test_${randomBytes(4).toString("hex")}`;
const V = "/services/data/v59.0";

let testDb: TestDb;
let pool: Pool;
let schema: OrgSchema;
let app: FastifyInstance;
let token = "";

type Json = Record<string, unknown>;
const json = (res: { body: string }) => JSON.parse(res.body) as Json;
const arr = (res: { body: string }) => JSON.parse(res.body) as Json[];
const auth = () => ({ authorization: `Bearer ${token}` });
const get = (url: string) => app.inject({ method: "GET", url, headers: auth() });
const post = (url: string, body: unknown) => app.inject({ method: "POST", url, headers: { ...auth(), "content-type": "application/json" }, payload: JSON.stringify(body) });
const patch = (url: string, body: unknown) => app.inject({ method: "PATCH", url, headers: { ...auth(), "content-type": "application/json" }, payload: JSON.stringify(body) });
const del = (url: string) => app.inject({ method: "DELETE", url, headers: auth() });
const putCsv = (url: string, csv: string) => app.inject({ method: "PUT", url, headers: { ...auth(), "content-type": "text/csv" }, payload: csv });

/** Parse a Bulk API CSV response body into a header + data rows. */
const parseResult = (res: { body: string }) => parseCsv(res.body);

beforeAll(async () => {
  testDb = await openTestDb();
  pool = testDb.pool;
  schema = (await loadOrgSchema({ projectDir: ACME })).schema;
  await migrate(pool, schema, { orgSchema });
  const boot = await bootstrapOrg(pool, schema, { orgSchema });
  const engine = new DmlEngine(pool, schema, { orgSchema });
  app = createApiServer({
    engine,
    organizationId: boot.session.organizationId,
    recordTypeIds: boot.recordTypeIds,
    auth: { mode: "list", users: [{ username: "admin@orglet.local", password: "secret" }] },
  });
  await app.ready();
  const login = await app.inject({
    method: "POST",
    url: "/services/oauth2/token",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: "grant_type=password&username=admin%40orglet.local&password=secret",
  });
  token = String(json(login)["access_token"]);
});

afterAll(async () => {
  await app.close();
  await pool.query(`DROP SCHEMA IF EXISTS ${quote(orgSchema)} CASCADE`);
  await testDb.close();
});

describe("ingest jobs", () => {
  it("an ingest row carrying a roll-up value fails with INVALID_FIELD_FOR_INSERT_UPDATE", async () => {
    const created = json(await post(`${V}/jobs/ingest`, { object: "Account", operation: "insert", contentType: "CSV", lineEnding: "LF" }));
    const jobId = String(created["id"]);
    expect((await putCsv(`${V}/jobs/ingest/${jobId}/batches`, writeCsv(["Name", "Total_Budget__c"], [["Bulk Rollup", "5"]]))).statusCode).toBe(201);
    const done = json(await patch(`${V}/jobs/ingest/${jobId}`, { state: "UploadComplete" }));
    expect(done).toMatchObject({ state: "JobComplete", numberRecordsFailed: 1 });
    const failed = parseResult(await get(`${V}/jobs/ingest/${jobId}/failedResults`));
    expect(failed.rows).toHaveLength(1);
    expect(failed.rows[0]?.[1]).toContain("INVALID_FIELD_FOR_INSERT_UPDATE");
  });

  it("inserts records through a CSV upload, reporting per-record success and failure", async () => {
    const created = json(await post(`${V}/jobs/ingest`, { object: "Account", operation: "insert", contentType: "CSV", lineEnding: "LF" }));
    expect(created).toMatchObject({ operation: "insert", object: "Account", state: "Open", contentType: "CSV", concurrencyMode: "Parallel", jobType: "V2Ingest" });
    expect(String(created["id"])).toMatch(/^750/);
    expect(String(created["id"])).toHaveLength(18);
    expect(created["contentUrl"]).toBe(`services/data/v59.0/jobs/ingest/${String(created["id"])}/batches`);
    const jobId = String(created["id"]);

    const csv = writeCsv(["Name", "Industry"], [
      ["Acme One", "Technology"],
      ["Acme Two", "Technology"],
      ["", "Technology"],
    ]);
    const uploaded = await putCsv(`${V}/jobs/ingest/${jobId}/batches`, csv);
    expect(uploaded.statusCode).toBe(201);
    expect(uploaded.body).toBe("");

    const completed = json(await patch(`${V}/jobs/ingest/${jobId}`, { state: "UploadComplete" }));
    expect(completed).toMatchObject({ state: "JobComplete", numberRecordsProcessed: 3, numberRecordsFailed: 1, retries: 0, jobType: "V2Ingest" });

    const info = json(await get(`${V}/jobs/ingest/${jobId}`));
    expect(info).toMatchObject({ state: "JobComplete", numberRecordsProcessed: 3, numberRecordsFailed: 1 });

    const success = parseResult(await get(`${V}/jobs/ingest/${jobId}/successfulResults`));
    expect(success.header).toEqual(["sf__Id", "sf__Created", "Name", "Industry"]);
    expect(success.rows).toHaveLength(2);
    for (const row of success.rows) {
      expect(row[0]).toMatch(/^001/);
      expect(row[1]).toBe("true");
    }

    const failed = parseResult(await get(`${V}/jobs/ingest/${jobId}/failedResults`));
    expect(failed.header).toEqual(["sf__Id", "sf__Error", "Name", "Industry"]);
    expect(failed.rows).toHaveLength(1);
    expect(failed.rows[0]?.[1]).toContain("REQUIRED_FIELD_MISSING");

    const unprocessed = parseResult(await get(`${V}/jobs/ingest/${jobId}/unprocessedrecords`));
    expect(unprocessed.header).toEqual(["Name", "Industry"]);
    expect(unprocessed.rows).toHaveLength(0);
  });

  it("upserts by external id: creates then updates the same record", async () => {
    const jobBody = { object: "Account", operation: "upsert", externalIdFieldName: "Customer_Number__c", contentType: "CSV" };

    const job1 = json(await post(`${V}/jobs/ingest`, jobBody));
    expect(job1["externalIdFieldName"]).toBe("Customer_Number__c");
    await putCsv(`${V}/jobs/ingest/${String(job1["id"])}/batches`, writeCsv(["Customer_Number__c", "Name"], [["CN-BULK-1", "First"]]));
    await patch(`${V}/jobs/ingest/${String(job1["id"])}`, { state: "UploadComplete" });
    const success1 = parseResult(await get(`${V}/jobs/ingest/${String(job1["id"])}/successfulResults`));
    expect(success1.rows[0]?.[1]).toBe("true");
    const accountId = success1.rows[0]?.[0];

    const job2 = json(await post(`${V}/jobs/ingest`, jobBody));
    await putCsv(`${V}/jobs/ingest/${String(job2["id"])}/batches`, writeCsv(["Customer_Number__c", "Name"], [["CN-BULK-1", "Second"]]));
    await patch(`${V}/jobs/ingest/${String(job2["id"])}`, { state: "UploadComplete" });
    const success2 = parseResult(await get(`${V}/jobs/ingest/${String(job2["id"])}/successfulResults`));
    expect(success2.rows[0]?.[1]).toBe("false");
    expect(success2.rows[0]?.[0]).toBe(accountId);

    const read = json(await get(`${V}/sobjects/Account/${String(accountId)}`));
    expect(read["Name"]).toBe("Second");
  });

  it("deletes records by Id through a delete job", async () => {
    const acc = json(await post(`${V}/sobjects/Account`, { Name: "To delete" }));
    const accountId = String(acc["id"]);

    const job = json(await post(`${V}/jobs/ingest`, { object: "Account", operation: "delete", contentType: "CSV" }));
    await putCsv(`${V}/jobs/ingest/${String(job["id"])}/batches`, writeCsv(["Id"], [[accountId]]));
    const completed = json(await patch(`${V}/jobs/ingest/${String(job["id"])}`, { state: "UploadComplete" }));
    expect(completed).toMatchObject({ state: "JobComplete", numberRecordsProcessed: 1, numberRecordsFailed: 0 });

    expect((await get(`${V}/sobjects/Account/${accountId}`)).statusCode).toBe(404);
  });

  it("rejects invalid job state transitions and unknown jobs", async () => {
    const job = json(await post(`${V}/jobs/ingest`, { object: "Account", operation: "insert", contentType: "CSV" }));
    const jobId = String(job["id"]);

    // Deleting an Open job is not allowed.
    const deleteWhileOpen = await del(`${V}/jobs/ingest/${jobId}`);
    expect(deleteWhileOpen.statusCode).toBe(400);
    expect(arr(deleteWhileOpen)[0]).toMatchObject({ errorCode: "INVALIDJOBSTATE" });

    // Abort it, then a second UploadComplete transition is invalid.
    const aborted = json(await patch(`${V}/jobs/ingest/${jobId}`, { state: "Aborted" }));
    expect(aborted["state"]).toBe("Aborted");
    const badTransition = await patch(`${V}/jobs/ingest/${jobId}`, { state: "UploadComplete" });
    expect(badTransition.statusCode).toBe(400);
    expect(arr(badTransition)[0]).toMatchObject({ errorCode: "INVALIDJOBSTATE" });

    // Now it's terminal: delete succeeds.
    expect((await del(`${V}/jobs/ingest/${jobId}`)).statusCode).toBe(204);

    const unknown = await get(`${V}/jobs/ingest/750000000000000AAA`);
    expect(unknown.statusCode).toBe(404);
    expect(arr(unknown)[0]).toMatchObject({ errorCode: "NOT_FOUND" });
  });
});

describe("query jobs", () => {
  it("runs a query job and pages results with Sforce-Locator", async () => {
    for (const name of ["QJ 000", "QJ 001", "QJ 002"]) {
      await post(`${V}/sobjects/Account`, { Name: name });
    }

    const job = json(await post(`${V}/jobs/query`, { operation: "query", query: "SELECT Id, Name, Owner.Alias FROM Account WHERE Name LIKE 'QJ %' ORDER BY Name" }));
    expect(job).toMatchObject({ operation: "query", object: "Account", state: "JobComplete" });
    const jobId = String(job["id"]);

    const names: string[] = [];
    let locator: string | null = null;
    let page = await get(`${V}/jobs/query/${jobId}/results?maxRecords=1`);
    for (;;) {
      const parsed = parseResult(page);
      expect(parsed.header).toEqual(["Id", "Name", "Owner.Alias"]);
      expect(parsed.rows).toHaveLength(1);
      names.push(parsed.rows[0]?.[1] ?? "");
      expect(page.headers["sforce-numberofrecords"]).toBe("1");
      locator = (page.headers["sforce-locator"] as string) ?? null;
      if (locator === "null") break;
      page = await get(`${V}/jobs/query/${jobId}/results?maxRecords=1&locator=${locator}`);
    }
    expect(names).toEqual(["QJ 000", "QJ 001", "QJ 002"]);

    const info = json(await get(`${V}/jobs/query/${jobId}`));
    expect(info).toMatchObject({ numberRecordsProcessed: 3, jobType: "V2Query", retries: 0 });
  });

  it("queryAll sees deleted rows that a plain query excludes", async () => {
    const acc = json(await post(`${V}/sobjects/Account`, { Name: "QJ Gone" }));
    await del(`${V}/sobjects/Account/${String(acc["id"])}`);

    const liveJob = json(await post(`${V}/jobs/query`, { operation: "query", query: "SELECT Id FROM Account WHERE Name = 'QJ Gone'" }));
    const liveResults = parseResult(await get(`${V}/jobs/query/${String(liveJob["id"])}/results`));
    expect(liveResults.rows).toHaveLength(0);

    const allJob = json(await post(`${V}/jobs/query`, { operation: "queryAll", query: "SELECT Id, Name, IsDeleted FROM Account WHERE Name = 'QJ Gone'" }));
    const allResults = parseResult(await get(`${V}/jobs/query/${String(allJob["id"])}/results`));
    expect(allResults.rows).toHaveLength(1);
    expect(allResults.rows[0]?.[2]).toBe("true");
  });

  it("rejects child subqueries and invalid SOQL", async () => {
    const sub = await post(`${V}/jobs/query`, { operation: "query", query: "SELECT Id, (SELECT Id FROM Contacts) FROM Account" });
    expect(sub.statusCode).toBe(400);
    expect(arr(sub)[0]).toMatchObject({ errorCode: "FEATURE_NOT_ENABLED" });

    const bad = await post(`${V}/jobs/query`, { operation: "query", query: "SELECT Nope FROM Account" });
    expect(bad.statusCode).toBe(400);
    expect(arr(bad)[0]).toMatchObject({ errorCode: "INVALID_FIELD" });
  });
});

describe("csv parser", () => {
  it("handles quoted fields with embedded delimiters", () => {
    const parsed = parseCsv('a,b\n1,"2,3"\n');
    expect(parsed.header).toEqual(["a", "b"]);
    expect(parsed.rows).toEqual([["1", "2,3"]]);
  });

  it("handles embedded newlines inside a quoted field", () => {
    const parsed = parseCsv('a,b\n"line1\nline2",x\n');
    expect(parsed.rows).toEqual([["line1\nline2", "x"]]);
  });

  it("handles doubled quotes as an escaped quote", () => {
    const parsed = parseCsv('a\n"He said ""hi"""\n');
    expect(parsed.rows).toEqual([['He said "hi"']]);
  });

  it("accepts CRLF line endings", () => {
    const parsed = parseCsv("a,b\r\n1,2\r\n3,4\r\n");
    expect(parsed.header).toEqual(["a", "b"]);
    expect(parsed.rows).toEqual([["1", "2"], ["3", "4"]]);
  });

  it("passes #N/A through as a literal value", () => {
    const parsed = parseCsv("a,b\n#N/A,x\n");
    expect(parsed.rows).toEqual([["#N/A", "x"]]);
  });

  it("round-trips values that need quoting when written", () => {
    const csv = writeCsv(["a", "b"], [["has,comma", 'has"quote']]);
    expect(parseCsv(csv)).toEqual({ header: ["a", "b"], rows: [["has,comma", 'has"quote']] });
  });
});
