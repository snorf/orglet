/**
 * Proves that Bulk jobs are durable: per-chunk atomicity and the persisted result CSV. Restart,
 * reconcile, retention and scoping tests are added by 06-06.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { loadOrgSchema } from "@orglet/metadata";
import { migrate, quote, type Pool } from "@orglet/schema";
import { bootstrapOrg, DmlEngine } from "@orglet/engine";
import { openTestDb, type TestDb } from "../../../test/db.js";
import { createApiServer } from "./server.js";
import { parseCsv, writeCsv } from "./bulk/csv.js";
import { dropBulkJobs, prepareBulk } from "./bulk/schema.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));
const orgSchema = `test_${randomBytes(4).toString("hex")}`;
const V = "/services/data/v59.0";

let testDb: TestDb;
let pool: Pool;
let engine: DmlEngine;
let app: FastifyInstance;
let token = "";

type Json = Record<string, unknown>;
const json = (res: { body: string }) => JSON.parse(res.body) as Json;
const auth = () => ({ authorization: `Bearer ${token}` });
const get = (url: string) => app.inject({ method: "GET", url, headers: auth() });
const post = (url: string, body: unknown) => app.inject({ method: "POST", url, headers: { ...auth(), "content-type": "application/json" }, payload: JSON.stringify(body) });
const patch = (url: string, body: unknown) => app.inject({ method: "PATCH", url, headers: { ...auth(), "content-type": "application/json" }, payload: JSON.stringify(body) });
const putCsv = (url: string, csv: string) => app.inject({ method: "PUT", url, headers: { ...auth(), "content-type": "text/csv" }, payload: csv });
const parseResult = (res: { body: string }, delimiter = ",") => parseCsv(res.body, delimiter);

beforeAll(async () => {
  testDb = await openTestDb();
  pool = testDb.pool;
  const schema = (await loadOrgSchema({ projectDir: ACME })).schema;
  await migrate(pool, schema, { orgSchema });
  const boot = await bootstrapOrg(pool, schema, { orgSchema });
  await prepareBulk(pool, orgSchema);
  engine = new DmlEngine(pool, schema, { orgSchema });
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

const createJob = async (extra: Json = {}) =>
  String(json(await post(`${V}/jobs/ingest`, { object: "Account", operation: "insert", contentType: "CSV", lineEnding: "LF", ...extra }))["id"]);

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
