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
import { dropBulkJobs, prepareBulk } from "./bulk/schema.js";

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
  await prepareBulk(pool, orgSchema);
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
  await dropBulkJobs(pool, orgSchema);
  await pool.query(`DROP SCHEMA IF EXISTS ${quote(orgSchema)} CASCADE`);
  await testDb.close();
});

describe("ingest jobs", () => {
  it("only UploadComplete and Aborted can be requested by the client", async () => {
    const created = json(await post(`${V}/jobs/ingest`, { object: "Account", operation: "insert", contentType: "CSV", lineEnding: "LF" }));
    const jobId = String(created["id"]);
    for (const state of ["InProgress", "JobComplete", "Failed", "Open", "Bogus"]) {
      const res = await patch(`${V}/jobs/ingest/${jobId}`, { state });
      expect(res.statusCode).toBe(400);
      expect(arr(res)[0]).toMatchObject({ errorCode: "INVALIDJOBSTATE" });
    }
    expect(json(await get(`${V}/jobs/ingest/${jobId}`))["state"]).toBe("Open");
  });

  it("an aborted job lists every uploaded row as unprocessed", async () => {
    const created = json(await post(`${V}/jobs/ingest`, { object: "Account", operation: "insert", contentType: "CSV", lineEnding: "LF" }));
    const jobId = String(created["id"]);
    await putCsv(`${V}/jobs/ingest/${jobId}/batches`, writeCsv(["Name"], [["Abort A"], ["Abort B"], ["Abort C"]]));
    expect(json(await patch(`${V}/jobs/ingest/${jobId}`, { state: "Aborted" }))["state"]).toBe("Aborted");
    const unprocessed = parseResult(await get(`${V}/jobs/ingest/${jobId}/unprocessedrecords`));
    expect(unprocessed.header).toEqual(["Name"]);
    expect(unprocessed.rows).toEqual([["Abort A"], ["Abort B"], ["Abort C"]]);
    for (const kind of ["successfulResults", "failedResults"]) {
      const r = parseResult(await get(`${V}/jobs/ingest/${jobId}/${kind}`));
      expect(r.header.slice(2)).toEqual(["Name"]);
      expect(r.rows).toHaveLength(0);
    }
  });

  it("a second UploadComplete is refused", async () => {
    const created = json(await post(`${V}/jobs/ingest`, { object: "Account", operation: "insert", contentType: "CSV", lineEnding: "LF" }));
    const jobId = String(created["id"]);
    await putCsv(`${V}/jobs/ingest/${jobId}/batches`, writeCsv(["Name"], [["Twice"]]));
    expect(json(await patch(`${V}/jobs/ingest/${jobId}`, { state: "UploadComplete" }))["state"]).toBe("JobComplete");
    const again = await patch(`${V}/jobs/ingest/${jobId}`, { state: "UploadComplete" });
    expect(again.statusCode).toBe(400);
    expect(arr(again)[0]).toMatchObject({ errorCode: "INVALIDJOBSTATE", message: "InvalidJobState : cannot move to UploadComplete from JobComplete" });
  });

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
    expect(arr(sub)[0]).toMatchObject({ errorCode: "FEATURE_NOT_ENABLED", message: "Bulk API 2.0 query jobs do not support parent-to-child relationship subqueries" });

    const bad = await post(`${V}/jobs/query`, { operation: "query", query: "SELECT Nope FROM Account" });
    expect(bad.statusCode).toBe(400);
    expect(arr(bad)[0]).toMatchObject({ errorCode: "INVALID_FIELD" });
  });
});

const queryJobCount = async () =>
  Number(((await pool.query(`SELECT count(*)::int AS n FROM "_orglet"."bulk_query_jobs" WHERE org_schema = $1`, [orgSchema])).rows[0] as { n: number }).n);

describe("bulk query rules", () => {
  it.each([
    ["SELECT Id, TYPEOF Owner WHEN User THEN Alias END FROM Case", "TYPEOF"],
    ["SELECT Industry FROM Account GROUP BY Industry", "GROUP BY"],
    ["SELECT Id FROM Account OFFSET 1", "OFFSET"],
    ["SELECT COUNT() FROM Account", "aggregate function COUNT"],
    ["SELECT FIELDS(ALL) FROM Account LIMIT 200", "FIELDS()"],
    ["SELECT Id, BillingAddress FROM Account", "compound field BillingAddress"],
    ["SELECT Id, (SELECT Id FROM Contacts) FROM Account", "parent-to-child relationship subqueries"],
  ])("%s is refused as FEATURE_NOT_ENABLED without creating a job", async (soql, construct) => {
    const before = await queryJobCount();
    const res = await post(`${V}/jobs/query`, { operation: "query", query: soql });
    expect(res.statusCode).toBe(400);
    expect(arr(res)).toEqual([{ errorCode: "FEATURE_NOT_ENABLED", message: `Bulk API 2.0 query jobs do not support ${construct}` }]);
    expect(String(arr(res)[0]?.["message"])).not.toContain("UNSUPPORTED:");
    expect(await queryJobCount()).toBe(before);
  });

  it("the REST query endpoint still accepts SOQL that Bulk rejects", async () => {
    const count = await get(`${V}/query?q=SELECT+COUNT()+FROM+Account`);
    expect(count.statusCode).toBe(200);
    expect(typeof json(count)["totalSize"]).toBe("number");
    expect((await get(`${V}/query?q=SELECT+Id,(SELECT+Id+FROM+Contacts)+FROM+Account`)).statusCode).toBe(200);
  });

  it("a WHERE semi-join is a legal bulk query", async () => {
    const res = await post(`${V}/jobs/query`, { operation: "query", query: "SELECT Id FROM Account WHERE Id IN (SELECT AccountId FROM Contact)" });
    expect(res.statusCode).toBe(200);
    expect(json(res)).toMatchObject({ state: "JobComplete" });
  });

  it("invalid SOQL creates no job", async () => {
    const before = await queryJobCount();
    const bad = await post(`${V}/jobs/query`, { operation: "query", query: "SELECT Nope FROM Account" });
    expect(bad.statusCode).toBe(400);
    expect(arr(bad)[0]).toMatchObject({ errorCode: "INVALID_FIELD" });
    const malformed = await post(`${V}/jobs/query`, { operation: "query", query: "SELEKT Id FROM Account" });
    expect(malformed.statusCode).toBe(400);
    expect(arr(malformed)[0]).toMatchObject({ errorCode: "MALFORMED_QUERY" });
    expect(await queryJobCount()).toBe(before);
  });
});

describe("query results headers", () => {
  it("every page carries Sforce-Locator and an accurate Sforce-NumberOfRecords", async () => {
    for (const name of ["QH 0", "QH 1", "QH 2"]) await post(`${V}/sobjects/Account`, { Name: name });
    const job = json(await post(`${V}/jobs/query`, { operation: "query", lineEnding: "LF", query: "SELECT Id, Name FROM Account WHERE Name LIKE 'QH %' ORDER BY Name" }));
    const url = `${V}/jobs/query/${String(job["id"])}/results`;
    const first = await app.inject({ method: "GET", url: `${url}?maxRecords=2`, headers: { ...auth(), accept: "application/json" } });
    expect(first.headers["sforce-numberofrecords"]).toBe("2");
    expect(String(first.headers["sforce-locator"])).toMatch(/^\d+$/);
    expect(first.body).not.toContain("\r");
    expect(String(first.headers["content-type"])).toMatch(/^text\/csv/);
    expect(parseResult(first).rows).toHaveLength(2);
    const second = await get(`${url}?maxRecords=2&locator=${String(first.headers["sforce-locator"])}`);
    expect(second.headers["sforce-numberofrecords"]).toBe("1");
    expect(second.headers["sforce-locator"]).toBe("null");
  });

  it("an empty result still answers with locator null and zero records", async () => {
    const job = json(await post(`${V}/jobs/query`, { operation: "query", query: "SELECT Id, Name FROM Account WHERE Name = 'QH none'" }));
    const res = await get(`${V}/jobs/query/${String(job["id"])}/results?maxRecords=5`);
    expect(res.headers["sforce-locator"]).toBe("null");
    expect(res.headers["sforce-numberofrecords"]).toBe("0");
    expect(parseResult(res).rows).toHaveLength(0);
  });

  it("a queryAll job pages deleted rows the same way", async () => {
    for (const name of ["QH Gone 0", "QH Gone 1"]) {
      const acc = json(await post(`${V}/sobjects/Account`, { Name: name }));
      await del(`${V}/sobjects/Account/${String(acc["id"])}`);
    }
    const job = json(await post(`${V}/jobs/query`, { operation: "queryAll", query: "SELECT Id, Name FROM Account WHERE Name LIKE 'QH Gone %' ORDER BY Name" }));
    const url = `${V}/jobs/query/${String(job["id"])}/results`;
    const first = await get(`${url}?maxRecords=1`);
    expect(first.headers["sforce-numberofrecords"]).toBe("1");
    const second = await get(`${url}?maxRecords=1&locator=${String(first.headers["sforce-locator"])}`);
    expect(parseResult(second).rows[0]?.[1]).toBe("QH Gone 1");
    expect(second.headers["sforce-locator"]).toBe("null");
  });
});

describe("query job states", () => {
  it("aborting a completed query job is refused with the documented message", async () => {
    const job = json(await post(`${V}/jobs/query`, { operation: "query", query: "SELECT Id FROM Account LIMIT 1" }));
    const res = await patch(`${V}/jobs/query/${String(job["id"])}`, { state: "Aborted" });
    expect(res.statusCode).toBe(400);
    expect(arr(res)).toEqual([{ errorCode: "INVALIDJOBSTATE", message: "Aborting already Completed Job not allowed" }]);
  });

  it("a completed query job can be deleted and is then 404", async () => {
    const job = json(await post(`${V}/jobs/query`, { operation: "query", query: "SELECT Id FROM Account LIMIT 1" }));
    const url = `${V}/jobs/query/${String(job["id"])}`;
    expect((await del(url)).statusCode).toBe(204);
    expect((await get(url)).statusCode).toBe(404);
  });

  it("a query job is listed for its creator", async () => {
    const job = json(await post(`${V}/jobs/query`, { operation: "query", query: "SELECT Id FROM Account LIMIT 1" }));
    const list = json(await get(`${V}/jobs/query`));
    expect((list["records"] as Json[]).map((r) => r["id"])).toContain(job["id"]);
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
