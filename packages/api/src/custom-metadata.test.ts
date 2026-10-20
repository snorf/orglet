/** Phase 11 over HTTP on conformance/cmdt-check/project: describe, query and retrieve of custom metadata, its DML refusal, and custom-setting behaviour (CMDT-01, CMDT-04, CSET-01). */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { loadOrgSchema, type OrgSchema } from "@orglet/metadata";
import { deriveCustomMetadataId, dropKeyPrefixes, migrate, quote, reconcileKeyPrefixes, type Pool } from "@orglet/schema";
import { bootstrapOrg, DmlEngine, planCustomMetadataSeed, seedCustomMetadata, type Session } from "@orglet/engine";
import { openTestDb, type TestDb } from "../../../test/db.js";
import { dropBulkJobs, prepareBulk } from "./bulk/schema.js";
import { createApiServer } from "./server.js";

const CMDT = fileURLToPath(new URL("../../../conformance/cmdt-check/project/", import.meta.url));
const orgSchema = `test_${randomBytes(4).toString("hex")}`;
const V = "/services/data/v59.0";

let testDb: TestDb;
let pool: Pool;
let schema: OrgSchema;
let app: FastifyInstance;
let engine: DmlEngine;
let session: Session;
let token = "";
let orgId = "";
let userId = "";
const goldId = deriveCustomMetadataId("m00", "Support_Tier__mdt", "Gold");

type Json = Record<string, unknown>;
const json = (res: { body: string }) => JSON.parse(res.body) as Json;
const arr = (res: { body: string }) => JSON.parse(res.body) as Json[];
const auth = () => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const get = (url: string) => app.inject({ method: "GET", url, headers: auth() });
const post = (url: string, body: unknown) => app.inject({ method: "POST", url, headers: auth(), payload: JSON.stringify(body) });
const patch = (url: string, body: unknown) => app.inject({ method: "PATCH", url, headers: auth(), payload: JSON.stringify(body) });
const del = (url: string) => app.inject({ method: "DELETE", url, headers: auth() });
const soql = (q: string, path = "query") => get(`${V}/${path}?q=${encodeURIComponent(q)}`);

const missingKeys = (o: Json, keys: string[]) => keys.filter((k) => !(k in o));

interface DescribeContract { globalSObjectKeys: string[]; fieldKeys: string[] }
const contract = JSON.parse(readFileSync(new URL("../../../conformance/describe-check/contract.json", import.meta.url), "utf8")) as DescribeContract;

const refusal = (name: string, op: string) => [{ message: `entity type ${name} does not support ${op}`, errorCode: "INVALID_TYPE_FOR_OPERATION" }];
const describeOf = async (name: string) => json(await get(`${V}/sobjects/${name}/describe`));
const fieldOf = (d: Json, name: string) => (d["fields"] as Json[]).find((f) => f["name"] === name);
const mdtCount = async (): Promise<number> => Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM ${quote(orgSchema)}.support_tier__mdt`)).rows[0].n);

beforeAll(async () => {
  testDb = await openTestDb();
  pool = testDb.pool;
  const built = await loadOrgSchema({ projectDir: CMDT });
  schema = built.schema;
  await reconcileKeyPrefixes(pool, schema, { orgSchema });
  await migrate(pool, schema, { orgSchema });
  const boot = await bootstrapOrg(pool, schema, { orgSchema });
  orgId = boot.session.organizationId;
  userId = boot.session.userId;
  session = boot.session;
  await prepareBulk(pool, orgSchema);
  await seedCustomMetadata(pool, schema, planCustomMetadataSeed(schema, built.customMetadata), { orgSchema, userId });
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
});

afterAll(async () => {
  await app.close();
  await dropBulkJobs(pool, orgSchema);
  await dropKeyPrefixes(pool, orgSchema);
  await pool.query(`DROP SCHEMA IF EXISTS ${quote(orgSchema)} CASCADE`);
  await testDb.close();
});

describe("describe of custom metadata types", () => {
  it("global describe lists a __mdt with the D-15 flags and the Salesforce key set", async () => {
    const global = json(await get(`${V}/sobjects`));
    const entry = (global["sobjects"] as Json[]).find((o) => o["name"] === "Support_Tier__mdt") as Json;
    expect(entry).toMatchObject({
      activateable: false, createable: false, custom: true, customSetting: false, deletable: false, feedEnabled: false, keyPrefix: "m00", layoutable: false,
      mergeable: false, mruEnabled: false, queryable: true, replicateable: false, retrieveable: true, searchable: false, triggerable: false, undeletable: false, updateable: false,
    });
    expect(missingKeys(entry, contract.globalSObjectKeys)).toEqual([]);
  });

  it("describe of a __mdt has the documented fields and no Name, OwnerId or IsDeleted", async () => {
    const d = await describeOf("Support_Tier__mdt");
    const names = (d["fields"] as Json[]).map((f) => f["name"]);
    for (const n of ["Id", "DeveloperName", "MasterLabel", "Label", "Language", "NamespacePrefix", "QualifiedApiName", "IsProtected", "SystemModstamp"]) expect(names).toContain(n);
    for (const n of ["Name", "OwnerId", "IsDeleted"]) expect(names).not.toContain(n);
    expect(fieldOf(d, "Label")).toMatchObject({ type: "picklist", picklistValues: [] });
    expect(fieldOf(d, "Language")).toMatchObject({ type: "string" });
    expect((d["fields"] as Json[]).every((f) => f["createable"] === false)).toBe(true);
  });

  it("a MetadataRelationship to EntityDefinition is a 255-character reference with soapType xsd:string; to a __mdt an 18-character tns:ID reference", async () => {
    const d = await describeOf("Support_Tier__mdt");
    const entity = fieldOf(d, "Target_Object__c") as Json;
    expect(entity).toMatchObject({ type: "reference", referenceTo: ["EntityDefinition"], relationshipName: "Target_Object__r", length: 255, soapType: "xsd:string" });
    const group = fieldOf(d, "Tier_Group__c") as Json;
    expect(group).toMatchObject({ type: "reference", referenceTo: ["Tier_Group__mdt"], relationshipName: "Tier_Group__r", length: 18, soapType: "tns:ID" });
    expect(missingKeys(entity, contract.fieldKeys)).toEqual([]);
    expect(missingKeys(group, contract.fieldKeys)).toEqual([]);
  });
});

describe("custom settings", () => {
  it("custom settings describe as customSetting true without OwnerId; only Hierarchy has SetupOwnerId", async () => {
    const config = await describeOf("App_Config__c");
    expect(config).toMatchObject({ customSetting: true, createable: true, deletable: true });
    expect(fieldOf(config, "OwnerId")).toBeUndefined();
    expect(fieldOf(config, "SetupOwnerId")).toMatchObject({ type: "reference", referenceTo: ["Organization", "Profile", "User"], nillable: false, unique: true, defaultedOnCreate: true });
    const list = await describeOf("Region_List__c");
    expect(list).toMatchObject({ customSetting: true });
    expect(fieldOf(list, "OwnerId")).toBeUndefined();
    expect(fieldOf(list, "SetupOwnerId")).toBeUndefined();
    expect(fieldOf(list, "Name")).toMatchObject({ nillable: false, unique: true });
    expect(await describeOf("Ticket__c")).toMatchObject({ customSetting: false });
  });

  it("a Hierarchy row without SetupOwnerId is the org default; a second one is DUPLICATE_VALUE (D-18)", async () => {
    const first = await post(`${V}/sobjects/App_Config__c`, { Feature_Enabled__c: true });
    expect(first.statusCode).toBe(201);
    const firstId = String(json(first)["id"]);
    expect(json(await get(`${V}/sobjects/App_Config__c/${firstId}`))["SetupOwnerId"]).toBe(orgId);

    const dup = await post(`${V}/sobjects/App_Config__c`, {});
    expect(dup.statusCode).toBe(400);
    expect(arr(dup)).toEqual([{ errorCode: "DUPLICATE_VALUE", fields: ["SetupOwnerId"], message: `duplicate value found: SetupOwnerId duplicates value on record with id: ${firstId}` }]);

    const user = await post(`${V}/sobjects/App_Config__c`, { SetupOwnerId: userId });
    expect(user.statusCode).toBe(201);
    const again = await post(`${V}/sobjects/App_Config__c`, { SetupOwnerId: userId });
    expect(again.statusCode).toBe(400);
    expect(arr(again)[0]).toMatchObject({ errorCode: "DUPLICATE_VALUE", fields: ["SetupOwnerId"] });

    const ticket = await post(`${V}/sobjects/Ticket__c`, { Name: "T1" });
    expect(ticket.statusCode).toBe(201);
    const wrong = await post(`${V}/sobjects/App_Config__c`, { SetupOwnerId: String(json(ticket)["id"]) });
    expect(wrong.statusCode).toBe(400);
    expect(arr(wrong)[0]).toMatchObject({ errorCode: "INVALID_CROSS_REFERENCE_KEY", fields: ["SetupOwnerId"] });
  });

  it("a List setting needs a unique Name and has no SetupOwnerId", async () => {
    expect((await post(`${V}/sobjects/Region_List__c`, { Name: "EMEA", Region_Code__c: "E" })).statusCode).toBe(201);
    const dup = await post(`${V}/sobjects/Region_List__c`, { Name: "emea" });
    expect(dup.statusCode).toBe(400);
    expect(arr(dup)[0]).toMatchObject({ errorCode: "DUPLICATE_VALUE", fields: ["Name"] });
    const missing = await post(`${V}/sobjects/Region_List__c`, { Region_Code__c: "X" });
    expect(arr(missing)[0]).toMatchObject({ errorCode: "REQUIRED_FIELD_MISSING", fields: ["Name"] });
    const owner = await post(`${V}/sobjects/Region_List__c`, { Name: "APAC", SetupOwnerId: orgId });
    expect(owner.statusCode).toBe(400);
    expect(arr(owner)[0]).toMatchObject({ errorCode: "INVALID_FIELD" });
  });
});

describe("DML on custom metadata is refused", () => {
  it("REST insert, update, delete and upsert on a __mdt are 400 INVALID_TYPE_FOR_OPERATION and change nothing", async () => {
    const insert = await post(`${V}/sobjects/Support_Tier__mdt`, { DeveloperName: "Probe", MasterLabel: "Probe" });
    expect(insert.statusCode).toBe(400);
    expect(arr(insert)).toEqual(refusal("Support_Tier__mdt", "insert"));

    const update = await patch(`${V}/sobjects/Support_Tier__mdt/${goldId}`, { MasterLabel: "x" });
    expect(update.statusCode).toBe(400);
    expect(arr(update)).toEqual(refusal("Support_Tier__mdt", "update"));

    const remove = await del(`${V}/sobjects/Support_Tier__mdt/${goldId}`);
    expect(remove.statusCode).toBe(400);
    expect(arr(remove)).toEqual(refusal("Support_Tier__mdt", "delete"));

    // The Id field passes the route's externalField() check, so the request reaches refuse("upsert").
    const upsert = await patch(`${V}/sobjects/Support_Tier__mdt/Id/${goldId}`, { MasterLabel: "x" });
    expect(upsert.statusCode).toBe(400);
    expect(arr(upsert)).toEqual(refusal("Support_Tier__mdt", "upsert"));

    // DeveloperName is not idLookup: documented, unchanged behaviour.
    const byName = await patch(`${V}/sobjects/Support_Tier__mdt/DeveloperName/Probe`, { MasterLabel: "x" });
    expect(byName.statusCode).toBe(404);
    expect(arr(byName)).toEqual([{ errorCode: "NOT_FOUND", message: "Provided external ID field does not exist or is not accessible: DeveloperName" }]);

    const viaEngine = await engine.upsert(session, "Support_Tier__mdt", "Id", [{ Id: goldId, MasterLabel: "x" }]);
    expect(viaEngine[0]?.errors[0]?.statusCode).toBe("INVALID_TYPE_FOR_OPERATION");

    expect(await mdtCount()).toBe(3);
    const gold = await pool.query<{ masterlabel: string }>(`SELECT masterlabel FROM ${quote(orgSchema)}.support_tier__mdt WHERE developername = 'Gold'`);
    expect(gold.rows[0].masterlabel).toBe("Gold");
  });

  it("sObject Collections and composite get the per-record refusal", async () => {
    const insert = await post(`${V}/composite/sobjects`, { records: [{ attributes: { type: "Support_Tier__mdt" }, DeveloperName: "Probe" }] });
    expect(insert.statusCode).toBe(200);
    expect(arr(insert)).toEqual([{ id: null, success: false, errors: [expect.objectContaining({ statusCode: "INVALID_TYPE_FOR_OPERATION" })] }]);

    const remove = await del(`${V}/composite/sobjects?ids=${goldId}`);
    expect(remove.statusCode).toBe(200);
    expect(arr(remove)).toEqual([{ id: null, success: false, errors: [expect.objectContaining({ statusCode: "INVALID_TYPE_FOR_OPERATION" })] }]);

    const composite = await post(`${V}/composite`, {
      compositeRequest: [{ method: "POST", url: `${V}/sobjects/Support_Tier__mdt`, referenceId: "r1", body: { DeveloperName: "Probe" } }],
    });
    const sub = (json(composite)["compositeResponse"] as Json[])[0] as Json;
    expect(sub["httpStatusCode"]).toBe(400);
    expect((sub["body"] as Json[])[0]).toMatchObject({ errorCode: "INVALID_TYPE_FOR_OPERATION" });
    expect(await mdtCount()).toBe(3);
  });

  it("import mode refuses __mdt writes but still bypasses flags elsewhere (D-13)", async () => {
    const importing = new DmlEngine(pool, schema, { orgSchema, importMode: true });
    const insert = await importing.insert(session, "Support_Tier__mdt", [{ Id: deriveCustomMetadataId("m00", "Support_Tier__mdt", "Imported"), DeveloperName: "Imported" }]);
    expect(insert[0]?.errors[0]?.statusCode).toBe("INVALID_TYPE_FOR_OPERATION");
    const undelete = await importing.undelete(session, "Support_Tier__mdt", [goldId]);
    expect(undelete[0]?.errors[0]?.statusCode).toBe("INVALID_TYPE_FOR_OPERATION");
    expect(await mdtCount()).toBe(3);
  });
});

describe("reading custom metadata", () => {
  it("SOQL, queryAll and retrieve return the seeded rows", async () => {
    const q = "SELECT Id, DeveloperName, Code__c, Max_Seats__c FROM Support_Tier__mdt ORDER BY DeveloperName";
    for (const path of ["query", "queryAll"]) {
      const body = json(await soql(q, path));
      expect(body["totalSize"]).toBe(3);
      const records = body["records"] as Json[];
      expect(records.map((r) => r["DeveloperName"])).toEqual(["Bronze", "Gold", "Silver"]);
      const [, gold, silver] = records;
      expect(gold).toMatchObject({ Code__c: "007", Max_Seats__c: 50, Id: goldId });
      expect(silver?.["Code__c"]).toBeNull();
    }
    const one = await get(`${V}/sobjects/Support_Tier__mdt/${goldId}`);
    expect(one.statusCode).toBe(200);
    expect(json(one)).toMatchObject({ DeveloperName: "Gold", attributes: { type: "Support_Tier__mdt" } });
  });

  it("relationship paths over REST (CMDT-03)", async () => {
    const res = await soql("SELECT DeveloperName, Tier_Group__r.DeveloperName, Target_Object__r.QualifiedApiName FROM Support_Tier__mdt ORDER BY DeveloperName");
    expect(res.statusCode).toBe(200);
    const [bronze, gold] = json(res)["records"] as Json[];
    expect(gold).toMatchObject({
      Tier_Group__r: { DeveloperName: "Premium" },
      Target_Object__r: { attributes: { type: "EntityDefinition", url: "/services/data/v59.0/sobjects/EntityDefinition/Account" }, QualifiedApiName: "Account" },
    });
    expect(bronze?.["Target_Object__r"]).toBeNull();
    expect(bronze?.["Tier_Group__r"]).toBeNull();

    const bad = await soql("SELECT Target_Object__r.Label FROM Support_Tier__mdt");
    expect(bad.statusCode).toBe(400);
    expect(arr(bad)[0]).toMatchObject({ errorCode: "INVALID_FIELD" });
    expect(String(arr(bad)[0]?.["message"])).toMatch(/^UNSUPPORTED:entity-definition/);
  });

  it("a Bulk ingest job on a __mdt is refused at creation; a Bulk query job is accepted (D-14)", async () => {
    for (const operation of ["insert", "delete"]) {
      const res = await post(`${V}/jobs/ingest`, { object: "Support_Tier__mdt", operation });
      expect(res.statusCode).toBe(400);
      expect(arr(res)).toEqual(refusal("Support_Tier__mdt", operation));
    }
    const list = json(await get(`${V}/jobs/ingest`));
    expect((list["records"] as Json[]).filter((j) => j["object"] === "Support_Tier__mdt")).toEqual([]);
    const query = await post(`${V}/jobs/query`, { operation: "query", query: "SELECT Id, DeveloperName FROM Support_Tier__mdt" });
    expect(query.statusCode).toBe(200);
    expect(json(query)["object"]).toBe("Support_Tier__mdt");
  });

  it("/updated and /deleted on a __mdt are 400, never 500", async () => {
    const window = "start=2020-01-01T00:00:00Z&end=2030-01-01T00:00:00Z";
    const deleted = await get(`${V}/sobjects/Support_Tier__mdt/deleted?${window}`);
    expect(deleted.statusCode).toBe(400);
    expect(arr(deleted)).toEqual(refusal("Support_Tier__mdt", "getDeleted"));
    const updated = await get(`${V}/sobjects/Support_Tier__mdt/updated?${window}`);
    expect(updated.statusCode).toBe(400);
    expect(arr(updated)).toEqual(refusal("Support_Tier__mdt", "getUpdated"));
    expect((await get(`${V}/sobjects/Ticket__c/deleted?${window}`)).statusCode).toBe(200);
  });
});
