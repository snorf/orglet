/** FORM-03 over HTTP: $Api values equal what the client saw at login (access_token, instance_url). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { loadOrgSchema, OrgSchemaImpl, type FieldDef, type OrgSchema, type SObjectDef } from "@orglet/metadata";
import { dropKeyPrefixes, migrate, quote, reconcileKeyPrefixes, type Pool } from "@orglet/schema";
import { bootstrapOrg, DmlEngine } from "@orglet/engine";
import { openTestDb, type TestDb } from "../../../test/db.js";
import { dropBulkJobs, prepareBulk } from "./bulk/schema.js";
import { createApiServer } from "./server.js";

const CMDT = fileURLToPath(new URL("../../../conformance/cmdt-check/project/", import.meta.url));
const orgSchema = `test_${randomBytes(4).toString("hex")}`;
const V = "/services/data/v59.0";

let testDb: TestDb;
let pool: Pool;
let app: FastifyInstance;
let engine: DmlEngine;
let token = "";
let instanceUrl = "";
let orgId = "";
let ticketId = "";

type Json = Record<string, unknown>;
const json = (res: { body: string }) => JSON.parse(res.body) as Json;
const auth = () => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const get = (url: string, extra: Record<string, string> = {}) => app.inject({ method: "GET", url, headers: { ...auth(), ...extra } });

const formula = (template: FieldDef, name: string, expr: string): FieldDef => ({ ...template, name, label: name, type: "Text", length: 255, formula: expr, formulaTreatBlanksAs: "BlankAsBlank" });

function withApiFormulas(base: OrgSchema): OrgSchema {
  const obj = base.getObject("Ticket__c") as SObjectDef;
  const template = obj.fields.find((f) => f.name === "Name") as FieldDef;
  const extended: SObjectDef = {
    ...obj,
    fields: [
      ...obj.fields,
      formula(template, "Api_Session__c", "$Api.Session_ID"),
      formula(template, "Api_Partner__c", "$Api.Partner_Server_URL_600"),
      formula(template, "Api_Enterprise__c", "$Api.Enterprise_Server_URL_590"),
    ],
  };
  const objects = new Map(base.objects);
  objects.set("ticket__c", extended);
  return new OrgSchemaImpl(objects, base.globalValueSets, base.standardValueSets, base.labels);
}

beforeAll(async () => {
  testDb = await openTestDb();
  pool = testDb.pool;
  const schema = withApiFormulas((await loadOrgSchema({ projectDir: CMDT })).schema);
  await reconcileKeyPrefixes(pool, schema, { orgSchema });
  await migrate(pool, schema, { orgSchema });
  const boot = await bootstrapOrg(pool, schema, { orgSchema });
  orgId = boot.session.organizationId;
  await prepareBulk(pool, orgSchema);
  engine = new DmlEngine(pool, schema, { orgSchema });
  app = createApiServer({ engine, organizationId: orgId, recordTypeIds: boot.recordTypeIds, auth: { mode: "permissive" } });
  await app.ready();
  const res = await app.inject({
    method: "POST",
    url: "/services/oauth2/token",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: "grant_type=password&client_id=x&client_secret=y&username=admin%40orglet.local&password=secret",
  });
  token = String(json(res)["access_token"]);
  instanceUrl = String(json(res)["instance_url"]);
  const created = await app.inject({ method: "POST", url: `${V}/sobjects/Ticket__c`, headers: auth(), payload: JSON.stringify({ Name: "T-1" }) });
  ticketId = String(json(created)["id"]);
});

afterAll(async () => {
  await app.close();
  await dropBulkJobs(pool, orgSchema);
  await dropKeyPrefixes(pool, orgSchema);
  await pool.query(`DROP SCHEMA IF EXISTS ${quote(orgSchema)} CASCADE`);
  await testDb.close();
});

describe("$Api over REST", () => {
  it("GET of a record returns $Api.Session_ID equal to the access token and URLs on instance_url", async () => {
    const rec = json(await get(`${V}/sobjects/Ticket__c/${ticketId}`));
    expect(token).not.toBe("");
    expect(rec["Api_Session__c"]).toBe(token);
    expect(rec["Api_Partner__c"]).toBe(`${instanceUrl}/services/Soap/u/60.0/${orgId}`);
    expect(rec["Api_Enterprise__c"]).toBe(`${instanceUrl}/services/Soap/c/59.0/${orgId}`);
  });

  it("SOQL formula fields see the same request", async () => {
    const res = json(await get(`${V}/query?q=${encodeURIComponent("SELECT Id, Api_Session__c FROM Ticket__c")}`));
    expect((res["records"] as Json[])[0]?.["Api_Session__c"]).toBe(token);
  });

  it("forwarded headers change the URL host like login's instance_url", async () => {
    const rec = json(await get(`${V}/sobjects/Ticket__c/${ticketId}`, { "x-forwarded-proto": "https", "x-forwarded-host": "orglet.example" }));
    expect(String(rec["Api_Partner__c"]).startsWith("https://orglet.example/services/Soap/u/60.0/")).toBe(true);
  });

  it("no request-context warning is raised for REST reads", () => {
    expect(engine.warnings.filter((w) => w.includes("without a request context"))).toEqual([]);
  });
});
