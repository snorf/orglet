/**
 * Proves that Bulk jobs are durable, over HTTP: per-chunk atomicity, the persisted result CSV, serving
 * from a second server after a restart, per-org and per-user scoping, reset, the persisted state
 * machine, boot reconciliation and seven-day retention.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { loadOrgSchema, type OrgSchema } from "@orglet/metadata";
import { migrate, quote, type Pool } from "@orglet/schema";
import { bootstrapOrg, DmlEngine, type BootstrapResult } from "@orglet/engine";
import { openTestDb, type TestDb } from "../../../test/db.js";
import { createApiServer } from "./server.js";
import { parseCsv, writeCsv } from "./bulk/csv.js";
import {
  BULK_INGEST_RESTART_MESSAGE,
  BULK_QUERY_RESTART_MESSAGE,
  BULK_TABLES,
  dropBulkJobs,
  prepareBulk,
  setJobState,
} from "./bulk/schema.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));
const orgSchema = `test_${randomBytes(4).toString("hex")}`;
const V = "/services/data/v59.0";

let testDb: TestDb;
let pool: Pool;
let schema: OrgSchema;
let boot: BootstrapResult;
let engine: DmlEngine;
let app: FastifyInstance;
let token = "";
const extraApps: FastifyInstance[] = [];
const extraSchemas: string[] = [];

type Json = Record<string, unknown>;
const json = (res: { body: string }) => JSON.parse(res.body) as Json;

/** Request helpers bound to one server and one login, so two servers over one database can be addressed side by side. */
const client = (a: () => FastifyInstance, t: () => string) => {
  const auth = () => ({ authorization: `Bearer ${t()}` });
  return {
    get: (url: string) => a().inject({ method: "GET", url, headers: auth() }),
    post: (url: string, body: unknown) => a().inject({ method: "POST", url, headers: { ...auth(), "content-type": "application/json" }, payload: JSON.stringify(body) }),
    patch: (url: string, body: unknown) => a().inject({ method: "PATCH", url, headers: { ...auth(), "content-type": "application/json" }, payload: JSON.stringify(body) }),
    putCsv: (url: string, csv: string) => a().inject({ method: "PUT", url, headers: { ...auth(), "content-type": "text/csv" }, payload: csv }),
  };
};
const { get, post, patch, putCsv } = client(() => app, () => token);
const parseResult = (res: { body: string }, delimiter = ",") => parseCsv(res.body, delimiter);

/** Start a server over `eng` and log in; sessions are in memory, so every new server needs a fresh login. */
async function startServer(eng: DmlEngine, b: BootstrapResult): Promise<{ app: FastifyInstance; token: string }> {
  const a = createApiServer({
    engine: eng,
    organizationId: b.session.organizationId,
    recordTypeIds: b.recordTypeIds,
    auth: { mode: "list", users: [{ username: "admin@orglet.local", password: "secret" }] },
  });
  await a.ready();
  const login = await a.inject({
    method: "POST",
    url: "/services/oauth2/token",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: "grant_type=password&username=admin%40orglet.local&password=secret",
  });
  return { app: a, token: String(json(login)["access_token"]) };
}

/** A second server (fresh login) over an engine, registered for cleanup; `client` addresses it. */
async function restart(eng: DmlEngine = engine, b: BootstrapResult = boot) {
  const s = await startServer(eng, b);
  extraApps.push(s.app);
  return { app: s.app, ...client(() => s.app, () => s.token) };
}

beforeAll(async () => {
  testDb = await openTestDb();
  pool = testDb.pool;
  schema = (await loadOrgSchema({ projectDir: ACME })).schema;
  await migrate(pool, schema, { orgSchema });
  boot = await bootstrapOrg(pool, schema, { orgSchema });
  await prepareBulk(pool, orgSchema);
  engine = new DmlEngine(pool, schema, { orgSchema });
  ({ app, token } = await startServer(engine, boot));
});

afterAll(async () => {
  await app.close();
  for (const a of extraApps) await a.close();
  await dropBulkJobs(pool, orgSchema);
  for (const name of [...extraSchemas, orgSchema]) {
    await dropBulkJobs(pool, name);
    await pool.query(`DROP SCHEMA IF EXISTS ${quote(name)} CASCADE`);
  }
  await testDb.close();
});

type Client = ReturnType<typeof client>;
const createJobOn = async (c: Client, extra: Json = {}) =>
  String(json(await c.post(`${V}/jobs/ingest`, { object: "Account", operation: "insert", contentType: "CSV", lineEnding: "LF", ...extra }))["id"]);
const createJob = (extra: Json = {}) => createJobOn({ get, post, patch, putCsv }, extra);
/** Upload `csv` to an Open job and, unless `complete` is false, mark it UploadComplete (processing is synchronous). */
const ingestOn = async (c: Client, csv: string, complete = true) => {
  const id = await createJobOn(c);
  await c.putCsv(`${V}/jobs/ingest/${id}/batches`, csv);
  if (complete) await c.patch(`${V}/jobs/ingest/${id}`, { state: "UploadComplete" });
  return id;
};
const createQueryOn = async (c: Client, query: string) => String(json(await c.post(`${V}/jobs/query`, { operation: "query", query }))["id"]);
const stateOf = async (table: string, id: string, org = orgSchema) =>
  (await pool.query<{ state: string }>(`SELECT state FROM ${table} WHERE org_schema = $1 AND id = $2`, [org, id])).rows[0]?.state;
const countOf = async (table: string, jobId: string, org = orgSchema) =>
  Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${table} WHERE org_schema = $1 AND job_id = $2`, [org, jobId])).rows[0]?.n);
const backdate = (table: string, id: string, interval: "8 days" | "6 days") =>
  pool.query(`UPDATE ${table} SET created_date = now() - interval '${interval}' WHERE org_schema = $1 AND id = $2`, [orgSchema, id]);

describe("per chunk", () => {
  it("a failure in chunk 2 keeps chunk 1 and rolls back chunk 2 entirely", async () => {
    const names = Array.from({ length: 500 }, (_, i) => `Chunk ${String(i).padStart(3, "0")}`);
    const jobId = await createJob();
    await putCsv(`${V}/jobs/ingest/${jobId}/batches`, writeCsv(["Name"], names.map((n) => [n])));

    const original = engine.insert.bind(engine);
    let calls = 0;
    const spy = vi.spyOn(engine, "insert").mockImplementation(async (...args) => {
      const r = await original(...args);
      if (++calls === 2) throw new Error("simulated crash after the engine wrote chunk 2");
      return r;
    });
    let done: Json;
    try {
      done = json(await patch(`${V}/jobs/ingest/${jobId}`, { state: "UploadComplete" }));
    } finally {
      spy.mockRestore();
    }
    expect(done).toMatchObject({ state: "Failed", numberRecordsProcessed: 200, numberRecordsFailed: 0 });
    expect(String(done["errorMessage"])).toMatch(/^InternalServerError : simulated crash/);

    const q = json(await get(`${V}/query?q=${encodeURIComponent("SELECT Id FROM Account WHERE Name LIKE 'Chunk%'")}`));
    expect(q["totalSize"]).toBe(200);

    const ok = parseResult(await get(`${V}/jobs/ingest/${jobId}/successfulResults`));
    expect(ok.rows.map((r) => r[2])).toEqual(names.slice(0, 200));
    expect(parseResult(await get(`${V}/jobs/ingest/${jobId}/failedResults`)).rows).toHaveLength(0);
    const unprocessed = parseResult(await get(`${V}/jobs/ingest/${jobId}/unprocessedrecords`));
    expect(unprocessed.header).toEqual(["Name"]);
    expect(unprocessed.rows.map((r) => r[0])).toEqual(names.slice(200));
  });
});

describe("result csv", () => {
  it("persisted results render the documented columns", async () => {
    const jobId = await createJob();
    await putCsv(`${V}/jobs/ingest/${jobId}/batches`, writeCsv(["Name", "Industry"], [["Res One", "Technology"], ["", "Technology"]]));
    await patch(`${V}/jobs/ingest/${jobId}`, { state: "UploadComplete" });

    const ok = parseResult(await get(`${V}/jobs/ingest/${jobId}/successfulResults`));
    expect(ok.header).toEqual(["sf__Id", "sf__Created", "Name", "Industry"]);
    expect(ok.rows).toHaveLength(1);
    expect(ok.rows[0]?.[0]).toMatch(/^001/);
    expect(ok.rows[0]?.[1]).toBe("true");
    const failed = parseResult(await get(`${V}/jobs/ingest/${jobId}/failedResults`));
    expect(failed.header).toEqual(["sf__Id", "sf__Error", "Name", "Industry"]);
    expect(failed.rows).toHaveLength(1);
    expect(failed.rows[0]?.[0]).toBe("");
    expect(failed.rows[0]?.[1]).toContain("REQUIRED_FIELD_MISSING");
    const unprocessed = parseResult(await get(`${V}/jobs/ingest/${jobId}/unprocessedrecords`));
    expect(unprocessed.header).toEqual(["Name", "Industry"]);
    expect(unprocessed.rows).toHaveLength(0);

    const n = await pool.query<{ n: string }>(`SELECT count(*) AS n FROM "_orglet"."bulk_ingest_results" WHERE org_schema = $1 AND job_id = $2`, [orgSchema, jobId]);
    expect(Number(n.rows[0]?.n)).toBe(2);
  });

  it("a job with a TAB delimiter and CRLF line endings renders its results the same way", async () => {
    const jobId = await createJob({ columnDelimiter: "TAB", lineEnding: "CRLF" });
    await putCsv(`${V}/jobs/ingest/${jobId}/batches`, "Name\tIndustry\r\nTab One\tTechnology\r\n");
    await patch(`${V}/jobs/ingest/${jobId}`, { state: "UploadComplete" });

    const res = await get(`${V}/jobs/ingest/${jobId}/successfulResults`);
    expect(res.body).toContain("\r\n");
    expect(res.body).toContain("\t");
    const ok = parseResult(res, "\t");
    expect(ok.header).toEqual(["sf__Id", "sf__Created", "Name", "Industry"]);
    expect(ok.rows).toHaveLength(1);
  });
});

describe("survives a restart", () => {
  it("jobs, uploaded data and results are served by a second server", async () => {
    const a = await restart();
    const jobId = await ingestOn(a, writeCsv(["Name", "Industry"], [["Restart ok 1", "Technology"], ["", "Technology"], ["Restart ok 2", "Energy"]]));
    for (const n of [1, 2, 3]) await a.post(`${V}/sobjects/Account`, { Name: `Restart ${n}` });
    const queryId = await createQueryOn(a, "SELECT Id, Name FROM Account WHERE Name LIKE 'Restart %' ORDER BY Name");

    const ingestPaths = ["", "/successfulResults", "/failedResults", "/unprocessedrecords"].map((p) => `${V}/jobs/ingest/${jobId}${p}`);
    const capture = async (c: Client) => {
      const ingest = await Promise.all(ingestPaths.map((u) => c.get(u)));
      const list = await c.get(`${V}/jobs/ingest`);
      const info = await c.get(`${V}/jobs/query/${queryId}`);
      const page1 = await c.get(`${V}/jobs/query/${queryId}/results?maxRecords=2`);
      const locator = String(page1.headers["sforce-locator"]);
      const page2 = await c.get(`${V}/jobs/query/${queryId}/results?maxRecords=2&locator=${locator}`);
      return { ingest, list, info, pages: [page1, page2], locator };
    };
    const before = await capture(a);
    expect(before.locator).not.toBe("null");
    expect(json(before.ingest[0] as { body: string })).toMatchObject({ state: "JobComplete", numberRecordsProcessed: 3, numberRecordsFailed: 1 });
    await a.app.close();

    const b = await restart();
    const after = await capture(b);
    expect(json(after.ingest[0] as { body: string })).toEqual(json(before.ingest[0] as { body: string }));
    for (const i of [1, 2, 3]) expect((after.ingest[i] as { body: string }).body).toBe((before.ingest[i] as { body: string }).body);
    expect(json(after.list)).toEqual(json(before.list));
    expect(json(after.info)).toEqual(json(before.info));
    for (const i of [0, 1]) {
      const x = after.pages[i];
      const y = before.pages[i];
      expect(x?.body).toBe(y?.body);
      expect(x?.headers["sforce-locator"]).toBe(y?.headers["sforce-locator"]);
      expect(x?.headers["sforce-numberofrecords"]).toBe(y?.headers["sforce-numberofrecords"]);
    }
  });
});

describe("per org and per user", () => {
  it("another user's job is 404 and missing from the list", async () => {
    const jobId = await ingestOn({ get, post, patch, putCsv }, "Name\nOther user\n");
    expect((await get(`${V}/jobs/ingest/${jobId}`)).statusCode).toBe(200);
    await pool.query(`UPDATE ${BULK_TABLES.ingestJobs} SET user_id = '005000000000009AAA' WHERE org_schema = $1 AND id = $2`, [orgSchema, jobId]);
    const res = await get(`${V}/jobs/ingest/${jobId}`);
    expect(res.statusCode).toBe(404);
    expect((JSON.parse(res.body) as Json[])[0]).toMatchObject({ errorCode: "NOT_FOUND" });
    const ids = (json(await get(`${V}/jobs/ingest`))["records"] as Json[]).map((r) => r["id"]);
    expect(ids).not.toContain(jobId);
  });

  it("another org's server never sees this org's jobs", async () => {
    const orgB = `test_${randomBytes(4).toString("hex")}`;
    extraSchemas.push(orgB);
    await migrate(pool, schema, { orgSchema: orgB });
    const bootB = await bootstrapOrg(pool, schema, { orgSchema: orgB });
    await prepareBulk(pool, orgB);
    const b = await restart(new DmlEngine(pool, schema, { orgSchema: orgB }), bootB);
    const a = { get, post, patch, putCsv };

    const jobA = await ingestOn(a, "Name\nOrg A\n");
    const jobB = await ingestOn(b, "Name\nOrg B\n");
    expect((await b.get(`${V}/jobs/ingest/${jobA}`)).statusCode).toBe(404);
    expect((await get(`${V}/jobs/ingest/${jobB}`)).statusCode).toBe(404);
    const listA = ((json(await get(`${V}/jobs/ingest`))["records"] as Json[]).map((r) => r["id"]));
    const listB = ((json(await b.get(`${V}/jobs/ingest`))["records"] as Json[]).map((r) => r["id"]));
    expect(listA).toContain(jobA);
    expect(listA).not.toContain(jobB);
    expect(listB).toEqual([jobB]);
  });
});

describe("reset", () => {
  it("dropBulkJobs removes only this org's jobs and their results", async () => {
    const orgB = `test_${randomBytes(4).toString("hex")}`;
    extraSchemas.push(orgB);
    await migrate(pool, schema, { orgSchema: orgB });
    const bootB = await bootstrapOrg(pool, schema, { orgSchema: orgB });
    await prepareBulk(pool, orgB);
    const b = await restart(new DmlEngine(pool, schema, { orgSchema: orgB }), bootB);
    const a = { get, post, patch, putCsv };

    const jobA = await ingestOn(a, "Name\nKeep A\n");
    const jobB = await ingestOn(b, "Name\nDrop B 1\nDrop B 2\n");
    const queryB = await createQueryOn(b, "SELECT Id FROM Account");
    expect(await countOf(BULK_TABLES.ingestResults, jobB, orgB)).toBe(2);

    expect(await dropBulkJobs(pool, orgB)).toBe(2);
    expect((await b.get(`${V}/jobs/ingest/${jobB}`)).statusCode).toBe(404);
    expect((await b.get(`${V}/jobs/query/${queryB}`)).statusCode).toBe(404);
    expect(await countOf(BULK_TABLES.ingestResults, jobB, orgB)).toBe(0);
    expect((await get(`${V}/jobs/ingest/${jobA}`)).statusCode).toBe(200);
    expect(parseResult(await get(`${V}/jobs/ingest/${jobA}/successfulResults`)).rows).toHaveLength(1);
  });
});

describe("state machine", () => {
  it("a processing job reads InProgress and ends JobComplete", async () => {
    const jobId = await createJob();
    await putCsv(`${V}/jobs/ingest/${jobId}/batches`, "Name\nState one\n");
    const original = engine.insert.bind(engine);
    const seen: (string | undefined)[] = [];
    const spy = vi.spyOn(engine, "insert").mockImplementation(async (...args) => {
      const client = args[3]?.transaction?.client;
      if (client === undefined) throw new Error("expected the chunk to run inside a caller transaction");
      const r = await client.query<{ state: string }>(`SELECT state FROM ${BULK_TABLES.ingestJobs} WHERE org_schema = $1 AND id = $2`, [orgSchema, jobId]);
      seen.push(r.rows[0]?.state);
      return original(...args);
    });
    let done: Json;
    try {
      done = json(await patch(`${V}/jobs/ingest/${jobId}`, { state: "UploadComplete" }));
    } finally {
      spy.mockRestore();
    }
    expect(seen).toEqual(["InProgress"]);
    expect(done["state"]).toBe("JobComplete");
  });

  it("a query job is answered JobComplete and was never Open", async () => {
    const queryId = await createQueryOn({ get, post, patch, putCsv }, "SELECT Id FROM Account LIMIT 1");
    expect(await stateOf(BULK_TABLES.queryJobs, queryId)).toBe("JobComplete");
    expect(await setJobState(pool, { kind: "query", orgSchema, id: queryId, to: "Open" })).toBe(0);
    expect(await stateOf(BULK_TABLES.queryJobs, queryId)).toBe("JobComplete");
  });
});

describe("reconcile", () => {
  it("jobs a dead server left mid-flight are Failed after the next boot", async () => {
    const a = await restart();
    const rows = [["Rec 1"], ["Rec 2"], ["Rec 3"]];
    const stuck = await ingestOn(a, writeCsv(["Name"], rows), false);
    const finished = await ingestOn(a, "Name\nReconcile done\n");
    const queryId = await createQueryOn(a, "SELECT Id FROM Account LIMIT 2");
    await pool.query(`UPDATE ${BULK_TABLES.ingestJobs} SET state = 'InProgress' WHERE org_schema = $1 AND id = $2`, [orgSchema, stuck]);
    await pool.query(`UPDATE ${BULK_TABLES.queryJobs} SET state = 'UploadComplete' WHERE org_schema = $1 AND id = $2`, [orgSchema, queryId]);
    await pool.query(`DELETE FROM ${BULK_TABLES.queryRows} WHERE org_schema = $1 AND job_id = $2`, [orgSchema, queryId]);
    await a.app.close();

    const result = await prepareBulk(pool, orgSchema);
    expect(result.reconciled).toBe(2);
    const b = await restart();

    expect(json(await b.get(`${V}/jobs/ingest/${stuck}`))).toMatchObject({
      state: "Failed",
      errorMessage: BULK_INGEST_RESTART_MESSAGE,
      numberRecordsProcessed: 0,
    });
    const unprocessed = parseResult(await b.get(`${V}/jobs/ingest/${stuck}/unprocessedrecords`));
    expect(unprocessed.header).toEqual(["Name"]);
    expect(unprocessed.rows).toEqual(rows);
    expect(parseResult(await b.get(`${V}/jobs/ingest/${stuck}/successfulResults`)).rows).toHaveLength(0);
    expect(json(await b.get(`${V}/jobs/query/${queryId}`))).toMatchObject({ state: "Failed", errorMessage: BULK_QUERY_RESTART_MESSAGE });
    expect(json(await b.get(`${V}/jobs/ingest/${finished}`))["state"]).toBe("JobComplete");

    expect((await prepareBulk(pool, orgSchema)).reconciled).toBe(0);
    const retry = await b.patch(`${V}/jobs/ingest/${stuck}`, { state: "UploadComplete" });
    expect(retry.statusCode).toBe(400);
    expect((JSON.parse(retry.body) as Json[])[0]).toMatchObject({ errorCode: "INVALIDJOBSTATE" });
  });
});

describe("retention", () => {
  it("a job older than seven days is gone on the next request", async () => {
    const c = { get, post, patch, putCsv };
    const open = await createJob();
    const processed = await ingestOn(c, "Name\nRetention 1\nRetention 2\n");
    const query = await createQueryOn(c, "SELECT Id FROM Account LIMIT 2");
    const recent = await createJob();
    expect(await countOf(BULK_TABLES.ingestResults, processed)).toBe(2);
    expect(await countOf(BULK_TABLES.queryRows, query)).toBeGreaterThan(0);

    await backdate(BULK_TABLES.ingestJobs, open, "8 days");
    await backdate(BULK_TABLES.ingestJobs, processed, "8 days");
    await backdate(BULK_TABLES.queryJobs, query, "8 days");
    await backdate(BULK_TABLES.ingestJobs, recent, "6 days");

    expect((await get(`${V}/jobs/ingest/${open}`)).statusCode).toBe(404);
    expect((await get(`${V}/jobs/ingest/${processed}`)).statusCode).toBe(404);
    expect((await get(`${V}/jobs/ingest/${processed}/successfulResults`)).statusCode).toBe(404);
    expect((await get(`${V}/jobs/query/${query}`)).statusCode).toBe(404);
    expect(await countOf(BULK_TABLES.ingestResults, processed)).toBe(0);
    expect(await countOf(BULK_TABLES.queryRows, query)).toBe(0);
    const ids = (json(await get(`${V}/jobs/ingest`))["records"] as Json[]).map((r) => r["id"]);
    expect(ids).toContain(recent);
    expect(ids).not.toContain(open);
    expect(ids).not.toContain(processed);
    expect((await get(`${V}/jobs/ingest/${recent}`)).statusCode).toBe(200);

    expect((await prepareBulk(pool, orgSchema)).purged).toBe(0);
  });
});
