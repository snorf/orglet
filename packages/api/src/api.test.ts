import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { loadOrgSchema, type OrgSchema } from "@orglet/metadata";
import { dropKeyPrefixes, generateId, migrate, quote, reconcileKeyPrefixes, type Pool } from "@orglet/schema";
import { openTestDb, type TestDb } from "../../../test/db.js";
import { bootstrapOrg, DmlEngine } from "@orglet/engine";
import { createApiServer } from "./server.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));
const orgSchema = `test_${randomBytes(4).toString("hex")}`;
const V = "/services/data/v59.0";

let testDb: TestDb;
let pool: Pool;
let schema: OrgSchema;
let app: FastifyInstance;
let token = "";
let orgId = "";
let userId = "";
let engine: DmlEngine;
let recordTypeIds: ReadonlyMap<string, string>;

type Json = Record<string, unknown>;
const json = (res: { body: string }) => JSON.parse(res.body) as Json;
const arr = (res: { body: string }) => JSON.parse(res.body) as Json[];
const auth = () => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const get = (url: string) => app.inject({ method: "GET", url, headers: auth() });
const post = (url: string, body: unknown) => app.inject({ method: "POST", url, headers: auth(), payload: JSON.stringify(body) });
const patch = (url: string, body: unknown) => app.inject({ method: "PATCH", url, headers: auth(), payload: JSON.stringify(body) });
const del = (url: string) => app.inject({ method: "DELETE", url, headers: auth() });

interface DescribeContract { globalSObjectKeys: string[]; sobjectDescribeKeys: string[]; fieldKeys: string[]; childRelationshipKeys: string[]; urlKeys: string[]; systemFields: string[] }
// The SDK key sets and object list are shared with conformance/describe-check (D-11), so the CI test and the manual SDK run check the same contract.
const DESCRIBE_CHECK = new URL("../../../conformance/describe-check/", import.meta.url);
const contract = JSON.parse(readFileSync(new URL("contract.json", DESCRIBE_CHECK), "utf8")) as DescribeContract;
const listedObjects = readFileSync(new URL("objects.txt", DESCRIBE_CHECK), "utf8").split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));
type Thin = { keyPrefix: string; createable: boolean; updateable: boolean; deletable: boolean; undeletable: boolean; searchable: boolean; hasOwner: boolean; nameField: string | null; children: [string, string][] };
const THIN: Record<string, Thin> = {
  BusinessHours:      { keyPrefix: "01m", createable: true,  updateable: true,  deletable: false, undeletable: false, searchable: true,  hasOwner: false, nameField: "Name", children: [["Case", "BusinessHoursId"]] },
  BusinessProcess:    { keyPrefix: "019", createable: true,  updateable: true,  deletable: false, undeletable: false, searchable: false, hasOwner: false, nameField: "Name", children: [["RecordType", "BusinessProcessId"]] },
  CallCenter:         { keyPrefix: "04v", createable: true,  updateable: false, deletable: false, undeletable: false, searchable: false, hasOwner: false, nameField: "Name", children: [["User", "CallCenterId"]] },
  DandBCompany:       { keyPrefix: "06E", createable: true,  updateable: true,  deletable: true,  undeletable: true,  searchable: true,  hasOwner: false, nameField: "Name", children: [["Account", "DandbCompanyId"], ["Lead", "DandbCompanyId"]] },
  Entitlement:        { keyPrefix: "550", createable: true,  updateable: true,  deletable: true,  undeletable: true,  searchable: true,  hasOwner: false, nameField: "Name", children: [["Case", "EntitlementId"]] },
  ExternalDataSource: { keyPrefix: "0XC", createable: false, updateable: false, deletable: false, undeletable: false, searchable: false, hasOwner: false, nameField: "DeveloperName", children: [["Product2", "ExternalDataSourceId"]] },
  IdeaTheme:          { keyPrefix: "0Bg", createable: true,  updateable: true,  deletable: true,  undeletable: true,  searchable: true,  hasOwner: false, nameField: "Title", children: [["User", "WorkspaceId"]] },
  Individual:         { keyPrefix: "0PK", createable: true,  updateable: true,  deletable: true,  undeletable: true,  searchable: true,  hasOwner: true,  nameField: "Name", children: [["Contact", "IndividualId"], ["Lead", "IndividualId"], ["User", "IndividualId"]] },
  OperatingHours:     { keyPrefix: "0OH", createable: true,  updateable: true,  deletable: true,  undeletable: true,  searchable: true,  hasOwner: true,  nameField: "Name", children: [["Account", "OperatingHoursId"]] },
  OpportunityHistory: { keyPrefix: "008", createable: false, updateable: false, deletable: false, undeletable: false, searchable: false, hasOwner: false, nameField: null, children: [["Opportunity", "LastAmountChangedHistoryId"], ["Opportunity", "LastCloseDateChangedHistoryId"]] },
  ServiceAppointment: { keyPrefix: "08p", createable: true,  updateable: true,  deletable: true,  undeletable: true,  searchable: true,  hasOwner: true,  nameField: "AppointmentNumber", children: [["Event", "ServiceAppointmentId"]] },
  ServiceContract:    { keyPrefix: "810", createable: true,  updateable: true,  deletable: true,  undeletable: true,  searchable: true,  hasOwner: true,  nameField: "Name", children: [["Case", "ServiceContractId"]] },
  SocialPost:         { keyPrefix: "0ST", createable: true,  updateable: true,  deletable: true,  undeletable: true,  searchable: true,  hasOwner: true,  nameField: "Name", children: [["Case", "SourceId"]] },
  UserLicense:        { keyPrefix: "100", createable: false, updateable: false, deletable: false, undeletable: false, searchable: false, hasOwner: false, nameField: "Name", children: [["Profile", "UserLicenseId"]] },
};
const missingKeys = (obj: Json, keys: string[]) => keys.filter((k) => !(k in obj));

beforeAll(async () => {
  testDb = await openTestDb();
  pool = testDb.pool;
  schema = (await loadOrgSchema({ projectDir: ACME })).schema;
  // Same order as `orglet up`: reconcile prefixes, then migrate, then bootstrap/engine, so describe and Ids see the persisted value.
  await reconcileKeyPrefixes(pool, schema, { orgSchema, mapping: { Project__c: "a0Z" } });
  await migrate(pool, schema, { orgSchema });
  const boot = await bootstrapOrg(pool, schema, { orgSchema });
  orgId = boot.session.organizationId;
  userId = boot.session.userId;
  engine = new DmlEngine(pool, schema, { orgSchema });
  recordTypeIds = boot.recordTypeIds;
  app = createApiServer({
    engine,
    organizationId: orgId,
    recordTypeIds: boot.recordTypeIds,
    auth: { mode: "list", users: [{ username: "admin@orglet.local", password: "secret" }] },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  // _orglet rows live outside the org schema and would otherwise outlive this file on a shared Postgres.
  await dropKeyPrefixes(pool, orgSchema);
  await pool.query(`DROP SCHEMA IF EXISTS ${quote(orgSchema)} CASCADE`);
  await testDb.close();
});

describe("ui", () => {
  it("serves the built-in page at / without a session", async () => {
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("<title>orglet</title>");
  });
});

describe("login", () => {
  it("answers SOAP login with the fields jsforce and simple-salesforce read", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/services/Soap/u/59.0",
      headers: { "content-type": "text/xml", soapaction: "login" },
      payload: `<?xml version="1.0"?><soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:partner.soap.sforce.com"><soapenv:Body><urn:login><urn:username>admin@orglet.local</urn:username><urn:password>secretTOKEN123</urn:password></urn:login></soapenv:Body></soapenv:Envelope>`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/xml");
    const serverUrl = /<serverUrl>([^<]+)<\/serverUrl>/.exec(res.body)?.[1];
    expect(serverUrl).toMatch(new RegExp(`^http://localhost(:\\d+)?/services/Soap/u/59.0/${orgId}$`));
    expect(res.body).toMatch(/<sessionId>[^<]+<\/sessionId>/);
    expect(/<userId>([^<]+)<\/userId>/.exec(res.body)?.[1]).toBe(userId);
    expect(/<organizationId>([^<]+)<\/organizationId>/.exec(res.body)?.[1]).toBe(orgId);
    expect(res.body).toContain("<passwordExpired>false</passwordExpired>");
  });

  it("rejects a bad password with a SOAP LoginFault", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/services/Soap/u/59.0",
      headers: { "content-type": "text/xml" },
      payload: `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><login><username>admin@orglet.local</username><password>wrong</password></login></soapenv:Body></soapenv:Envelope>`,
    });
    expect(res.statusCode).toBe(500);
    expect(res.body).toContain("<sf:exceptionCode>INVALID_LOGIN</sf:exceptionCode>");
    expect(res.body).toContain("<faultstring>INVALID_LOGIN:");
  });

  it("issues OAuth password-grant tokens with the id url jsforce parses", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/services/oauth2/token",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "grant_type=password&client_id=x&client_secret=y&username=admin%40orglet.local&password=secret",
    });
    expect(res.statusCode).toBe(200);
    const body = json(res);
    expect(body["token_type"]).toBe("Bearer");
    expect(body["instance_url"]).toMatch(/^http:\/\/localhost/);
    expect(body["id"]).toBe(`${String(body["instance_url"])}/id/${orgId}/${userId}`);
    token = String(body["access_token"]);

    const bad = await app.inject({ method: "POST", url: "/services/oauth2/token", headers: { "content-type": "application/x-www-form-urlencoded" }, payload: "grant_type=password&username=nobody&password=x" });
    expect(bad.statusCode).toBe(400);
    expect(json(bad)).toMatchObject({ error: "invalid_grant" });
  });

  it("requires a session on the REST surface", async () => {
    const res = await app.inject({ method: "GET", url: `${V}/sobjects` });
    expect(res.statusCode).toBe(401);
    expect(arr(res)).toEqual([{ message: "Session expired or invalid", errorCode: "INVALID_SESSION_ID" }]);
  });

  it("lists versions, resources and identity", async () => {
    const versions = await app.inject({ method: "GET", url: "/services/data" });
    expect(arr(versions).some((v) => v["version"] === "59.0")).toBe(true);
    const resources = await get(V);
    expect(json(resources)["query"]).toBe(`${V}/query`);
    const identity = await get(String(json(resources)["identity"]).replace(/^http:\/\/localhost(:\d+)?/, ""));
    expect(json(identity)).toMatchObject({ user_id: userId, organization_id: orgId, username: "admin@orglet.local" });
  });
});

describe("describe", () => {
  it("returns global and object describes in the documented shape", async () => {
    const global = json(await get(`${V}/sobjects`));
    const account = (global["sobjects"] as Json[]).find((s) => s["name"] === "Account");
    expect(account).toMatchObject({ keyPrefix: "001", label: "Account", custom: false, queryable: true, urls: { describe: `${V}/sobjects/Account/describe` } });

    const describe = json(await get(`${V}/sobjects/Account/describe`));
    const fields = describe["fields"] as Json[];
    expect(fields.find((f) => f["name"] === "Name")).toMatchObject({ type: "string", length: 255, nillable: false, nameField: true, soapType: "xsd:string" });
    expect(fields.find((f) => f["name"] === "Industry")).toMatchObject({ type: "picklist" });
    expect((fields.find((f) => f["name"] === "Tier__c")?.["picklistValues"] as Json[]).map((v) => v["value"])).toEqual(["Gold", "Silver", "Bronze"]);
    expect(fields.find((f) => f["name"] === "OwnerId")).toMatchObject({ type: "reference", referenceTo: ["User", "Group"], relationshipName: "Owner", namePointing: true });
    expect((describe["childRelationships"] as Json[]).find((c) => c["relationshipName"] === "Contacts")).toMatchObject({ childSObject: "Contact", field: "AccountId" });

    const project = json(await get(`${V}/sobjects/Project__c/describe`));
    expect((project["recordTypeInfos"] as Json[]).map((r) => r["developerName"]).sort()).toEqual(["External", "Internal"]);
    expect(String((project["recordTypeInfos"] as Json[])[0]?.["recordTypeId"])).toMatch(/^012/);

    const basic = json(await get(`${V}/sobjects/Account`));
    expect(basic["objectDescribe"]).toMatchObject({ name: "Account" });
    expect((await get(`${V}/sobjects/Nope`)).statusCode).toBe(404);
  });

  it("reports the persisted key prefix for a custom object and mints Ids with it", async () => {
    const global = json(await get(`${V}/sobjects`));
    expect((global["sobjects"] as Json[]).find((s) => s["name"] === "Project__c")).toMatchObject({ keyPrefix: "a0Z", custom: true });
    expect(json(await get(`${V}/sobjects/Project__c/describe`))["keyPrefix"]).toBe("a0Z");

    const acc = json(await post(`${V}/sobjects/Account`, { Name: "Prefix Co" }));
    expect(acc["success"]).toBe(true);
    const proj = json(await post(`${V}/sobjects/Project__c`, { Name: "Seeded", Account__c: acc["id"] }));
    expect(proj["success"]).toBe(true);
    expect(String(proj["id"])).toMatch(/^a0Z[0-9A-Za-z]{15}$/);

    // The mapping only touches Project__c; standard prefixes stay documented values.
    expect((global["sobjects"] as Json[]).find((s) => s["name"] === "Account")).toMatchObject({ keyPrefix: "001" });
  });
});

describe("sobjects", () => {
  let accountId = "";

  it("creates, reads, updates and deletes a record with Salesforce status codes", async () => {
    const created = await post(`${V}/sobjects/Account`, { Name: "Acme", Industry: "Energy" });
    expect(created.statusCode).toBe(201);
    expect(created.headers["sforce-limit-info"]).toBe("api-usage=1/15000");
    expect(created.headers["content-type"]).toContain("application/json");
    const body = json(created);
    expect(body).toMatchObject({ success: true, errors: [] });
    accountId = String(body["id"]);

    const bad = await post(`${V}/sobjects/Account`, { Industry: "Energy" });
    expect(bad.statusCode).toBe(400);
    expect(arr(bad)).toEqual([{ message: "Required fields are missing: [Name]", errorCode: "REQUIRED_FIELD_MISSING", fields: ["Name"] }]);

    const read = json(await get(`${V}/sobjects/Account/${accountId}?fields=Name,Industry`));
    expect(read).toEqual({ attributes: { type: "Account", url: `${V}/sobjects/Account/${accountId}` }, Name: "Acme", Industry: "Energy" });
    const full = json(await get(`${V}/sobjects/Account/${accountId.slice(0, 15)}`));
    expect(full["OwnerId"]).toBe(userId);
    expect(full["BillingAddress"]).toBeNull();

    expect((await patch(`${V}/sobjects/Account/${accountId}`, { Name: "Acme AB" })).statusCode).toBe(204);
    expect(json(await get(`${V}/sobjects/Account/${accountId}`))["Name"]).toBe("Acme AB");
    const missing = await patch(`${V}/sobjects/Account/001000000000001AAA`, { Name: "x" });
    expect(missing.statusCode).toBe(404);
    expect(arr(missing)[0]).toMatchObject({ errorCode: "NOT_FOUND" });

    expect((await del(`${V}/sobjects/Account/${accountId}`)).statusCode).toBe(204);
    expect((await get(`${V}/sobjects/Account/${accountId}`)).statusCode).toBe(404);
    expect((await get(`${V}/sobjects/Account/not-an-id`)).statusCode).toBe(404);
  });

  it("upserts and reads by external id", async () => {
    const created = await patch(`${V}/sobjects/Account/Customer_Number__c/C-1`, { Name: "Ext" });
    expect(created.statusCode).toBe(201);
    expect(json(created)).toMatchObject({ success: true, created: true });
    const id = String(json(created)["id"]);
    expect((await patch(`${V}/sobjects/Account/Customer_Number__c/C-1`, { Name: "Ext 2" })).statusCode).toBe(204);
    const read = json(await get(`${V}/sobjects/Account/Customer_Number__c/c-1`));
    expect(read).toMatchObject({ Id: id, Name: "Ext 2" });
    expect((await get(`${V}/sobjects/Account/Customer_Number__c/nope`)).statusCode).toBe(404);
    const badField = await get(`${V}/sobjects/Account/Name/Ext`);
    expect(badField.statusCode).toBe(404);
    expect(arr(badField)[0]?.["message"]).toContain("Provided external ID field does not exist");
    expect((await del(`${V}/sobjects/Account/Customer_Number__c/C-1`)).statusCode).toBe(204);
  });
});

describe("query", () => {
  it("runs SOQL and pages with nextRecordsUrl", async () => {
    // 201 accounts -> two pages of 200 through the collections API (200 per call).
    const records = Array.from({ length: 201 }, (_, i) => ({ attributes: { type: "Account" }, Name: `Page ${String(i).padStart(3, "0")}` }));
    const first = await post(`${V}/composite/sobjects`, { allOrNone: true, records: records.slice(0, 200) });
    expect(arr(first).every((r) => r["success"] === true)).toBe(true);
    await post(`${V}/composite/sobjects`, { allOrNone: true, records: records.slice(200) });

    const page1 = await app.inject({ method: "GET", url: `${V}/query?q=${encodeURIComponent("SELECT Id, Name FROM Account WHERE Name LIKE 'Page %' ORDER BY Name")}`, headers: { ...auth(), "sforce-query-options": "batchSize=200" } });
    const body1 = json(page1);
    expect(body1).toMatchObject({ totalSize: 201, done: false });
    expect(body1["records"]).toHaveLength(200);
    expect((body1["records"] as Json[])[0]).toMatchObject({ attributes: { type: "Account" }, Name: "Page 000" });
    const next = String(body1["nextRecordsUrl"]);
    expect(next).toMatch(new RegExp(`^${V}/query/01g[A-Za-z0-9]{12}-200$`));
    const page2 = json(await get(next));
    expect(page2).toMatchObject({ totalSize: 201, done: true });
    expect((page2["records"] as Json[]).map((r) => r["Name"])).toEqual(["Page 200"]);
    expect(json(await get(`${V}/query/${next.split("/").pop() ?? ""}`))["done"]).toBe(true);
  });

  it("supports queryAll, COUNT() and error envelopes", async () => {
    const deleted = await post(`${V}/sobjects/Account`, { Name: "Gone" });
    await del(`${V}/sobjects/Account/${String(json(deleted)["id"])}`);
    const live = json(await get(`${V}/query/?q=${encodeURIComponent("SELECT COUNT() FROM Account WHERE Name = 'Gone'")}`));
    expect(live).toMatchObject({ totalSize: 0, done: true, records: [] });
    const all = json(await get(`${V}/queryAll?q=${encodeURIComponent("SELECT Id, IsDeleted FROM Account WHERE Name = 'Gone'")}`));
    expect((all["records"] as Json[])[0]?.["IsDeleted"]).toBe(true);

    const bad = await get(`${V}/query?q=${encodeURIComponent("SELECT Nope FROM Account")}`);
    expect(bad.statusCode).toBe(400);
    expect(arr(bad)[0]).toMatchObject({ errorCode: "INVALID_FIELD" });
    expect(arr(bad)[0]?.["message"]).toContain("No such column 'Nope' on entity 'Account'");
    const malformed = await get(`${V}/query?q=${encodeURIComponent("SELECT FROM")}`);
    expect(arr(malformed)[0]?.["errorCode"]).toBe("MALFORMED_QUERY");
  });
});

describe("composite", () => {
  it("handles collections: mixed-type insert, retrieve, update, upsert and delete", async () => {
    const created = arr(await post(`${V}/composite/sobjects`, { records: [{ attributes: { type: "Account" }, Name: "Coll" }, { attributes: { type: "Contact" }, LastName: "Coll" }, { attributes: { type: "Account" } }] }));
    expect(created[0]).toMatchObject({ success: true, errors: [] });
    expect(String(created[0]?.["id"])).toMatch(/^001/);
    expect(String(created[1]?.["id"])).toMatch(/^003/);
    expect(created[2]).toMatchObject({ id: null, success: false, errors: [{ statusCode: "REQUIRED_FIELD_MISSING", fields: ["Name"] }] });

    const ids = [String(created[0]?.["id"]), String(created[1]?.["id"])];
    const fetched = arr(await post(`${V}/composite/sobjects/Account`, { ids: [ids[0], "001000000000001AAA"], fields: ["Id", "Name"] }));
    expect(fetched[0]).toMatchObject({ attributes: { type: "Account" }, Name: "Coll" });
    expect(fetched[1]).toBeNull();

    const updated = arr(await patch(`${V}/composite/sobjects`, { records: [{ attributes: { type: "Account" }, Id: ids[0], Name: "Coll 2" }] }));
    expect(updated[0]).toMatchObject({ id: ids[0], success: true });

    const upserted = arr(await patch(`${V}/composite/sobjects/Account/Customer_Number__c`, { records: [{ attributes: { type: "Account" }, Customer_Number__c: "U-1", Name: "Up" }] }));
    expect(upserted[0]).toMatchObject({ success: true, created: true });

    const deleted = arr(await del(`${V}/composite/sobjects?ids=${ids.join(",")}&allOrNone=true`));
    expect(deleted.map((r) => r["success"])).toEqual([true, true]);
  });

  it("runs composite subrequests with reference substitution", async () => {
    const res = json(
      await post(`${V}/composite`, {
        allOrNone: true,
        compositeRequest: [
          { method: "POST", url: `${V}/sobjects/Account`, referenceId: "acct", body: { Name: "Composite" } },
          { method: "POST", url: `${V}/sobjects/Contact`, referenceId: "cont", body: { LastName: "Child", AccountId: "@{acct.id}" } },
          { method: "GET", url: `${V}/sobjects/Contact/@{cont.id}?fields=AccountId`, referenceId: "read" },
        ],
      }),
    );
    const responses = res["compositeResponse"] as Json[];
    expect(responses.map((r) => r["httpStatusCode"])).toEqual([201, 201, 200]);
    expect(responses[2]?.["referenceId"]).toBe("read");
    expect((responses[2]?.["body"] as Json)["AccountId"]).toBe((responses[0]?.["body"] as Json)["id"]);
    expect((responses[0]?.["httpHeaders"] as Json)["Location"]).toBe(`${V}/sobjects/Account/${String((responses[0]?.["body"] as Json)["id"])}`);
  });

  it("runs batch requests", async () => {
    const res = json(await post(`${V}/composite/batch`, { batchRequests: [{ method: "GET", url: "v59.0/limits" }, { method: "GET", url: "v59.0/sobjects/Nope" }] }));
    expect(res["hasErrors"]).toBe(true);
    const results = res["results"] as Json[];
    expect(results[0]?.["statusCode"]).toBe(200);
    expect(results[1]?.["statusCode"]).toBe(404);
  });

  it("creates record trees", async () => {
    const res = await post(`${V}/composite/tree/Account`, {
      records: [{ attributes: { type: "Account", referenceId: "ref1" }, Name: "Tree", Contacts: { records: [{ attributes: { type: "Contact", referenceId: "ref2" }, LastName: "Leaf" }] } }],
    });
    expect(res.statusCode).toBe(201);
    const body = json(res);
    expect(body["hasErrors"]).toBe(false);
    const results = body["results"] as Json[];
    expect(results.map((r) => r["referenceId"])).toEqual(["ref1", "ref2"]);
    const contact = json(await get(`${V}/sobjects/Contact/${String(results[1]?.["id"])}?fields=AccountId`));
    expect(contact["AccountId"]).toBe(results[0]?.["id"]);
  });

  it("serves limits and an empty search result", async () => {
    expect(json(await get(`${V}/limits`))["DailyApiRequests"]).toMatchObject({ Max: 15000 });
    expect(json(await get(`${V}/search?q=${encodeURIComponent("FIND {Acme}")}`))).toEqual({ searchRecords: [] });
  });
});

describe("thin objects", () => {
  it("thin objects: objects.txt lists exactly the 14 thin objects", () => {
    expect([...listedObjects].sort()).toEqual(Object.keys(THIN).sort());
    expect(listedObjects).toHaveLength(14);
  });

  it("thin objects: global describe lists each with every DescribeGlobalSObjectResult key and the documented flags", async () => {
    const sobjects = json(await get(`${V}/sobjects`))["sobjects"] as Json[];
    for (const [name, t] of Object.entries(THIN)) {
      const entry = sobjects.find((s) => s["name"] === name);
      expect(entry, name).toBeDefined();
      expect(missingKeys(entry as Json, contract.globalSObjectKeys), name).toEqual([]);
      expect(entry).toMatchObject({
        name, keyPrefix: t.keyPrefix, custom: false, queryable: true, idEnabled: true,
        createable: t.createable, updateable: t.updateable, deletable: t.deletable, undeletable: t.undeletable, searchable: t.searchable,
        urls: { sobject: `${V}/sobjects/${name}`, describe: `${V}/sobjects/${name}/describe`, rowTemplate: `${V}/sobjects/${name}/{ID}` },
      });
      expect(json(await get(`${V}/sobjects/${name}`))["objectDescribe"]).toMatchObject({ name, keyPrefix: t.keyPrefix });
    }
  });

  it("thin objects: per-object describe carries the SDK key sets, system fields, owner and one or no name field", async () => {
    for (const [name, t] of Object.entries(THIN)) {
      const d = json(await get(`${V}/sobjects/${name}/describe`));
      expect(missingKeys(d, [...contract.globalSObjectKeys, ...contract.sobjectDescribeKeys]), name).toEqual([]);
      expect(missingKeys(d["urls"] as Json, contract.urlKeys), name).toEqual([]);
      const fields = d["fields"] as Json[];
      expect(fields.flatMap((f) => missingKeys(f, contract.fieldKeys).map((k) => `${String(f["name"])}.${k}`)), name).toEqual([]);
      for (const s of contract.systemFields) expect(fields.filter((f) => f["name"] === s), `${name}.${s}`).toHaveLength(1);
      expect(fields.filter((f) => f["name"] === "OwnerId"), `${name}.OwnerId`).toHaveLength(t.hasOwner ? 1 : 0);
      expect(fields.filter((f) => f["nameField"] === true).map((f) => f["name"]), name).toEqual(t.nameField === null ? [] : [t.nameField]);
      expect(d).toMatchObject({ name, keyPrefix: t.keyPrefix, createable: t.createable, updateable: t.updateable, deletable: t.deletable, undeletable: t.undeletable });
    }
  });

  it("thin objects: childRelationships list the baseline lookups that point at each object", async () => {
    for (const [name, t] of Object.entries(THIN)) {
      const rels = json(await get(`${V}/sobjects/${name}/describe`))["childRelationships"] as Json[];
      expect(rels.flatMap((r) => missingKeys(r, contract.childRelationshipKeys)), name).toEqual([]);
      expect(rels, name).toEqual(expect.arrayContaining(t.children.map(([childSObject, field]) => expect.objectContaining({ childSObject, field }) as unknown)));
    }
    const licenseRels = json(await get(`${V}/sobjects/UserLicense/describe`))["childRelationships"] as Json[];
    expect(licenseRels.find((r) => r["childSObject"] === "Profile")).toMatchObject({ field: "UserLicenseId", relationshipName: "Profiles" });
  });
});

describe("write protection", () => {
  it("write protection: REST refuses what a thin object's flags forbid with 400 INVALID_TYPE_FOR_OPERATION", async () => {
    const refused = (res: { statusCode: number; body: string }, name: string, op: string) => {
      expect(res.statusCode, `${name} ${op}`).toBe(400);
      expect(arr(res)).toEqual([{ message: `entity type ${name} does not support ${op}`, errorCode: "INVALID_TYPE_FOR_OPERATION" }]);
    };
    refused(await post(`${V}/sobjects/UserLicense`, { Name: "x", MasterLabel: "x" }), "UserLicense", "insert");
    const center = await post(`${V}/sobjects/CallCenter`, { Name: "REST Center" });
    expect(center.statusCode).toBe(201);
    refused(await patch(`${V}/sobjects/CallCenter/${String(json(center)["id"])}`, { Name: "Renamed" }), "CallCenter", "update");
    refused(await patch(`${V}/sobjects/UserLicense/Name/Salesforce`, { MasterLabel: "x" }), "UserLicense", "upsert");
    const hours = await post(`${V}/sobjects/BusinessHours`, { Name: "REST Hours" });
    expect(hours.statusCode).toBe(201);
    refused(await del(`${V}/sobjects/BusinessHours/${String(json(hours)["id"])}`), "BusinessHours", "delete");
    const allowed = await post(`${V}/sobjects/Entitlement`, { Name: "Gold Support" });
    expect(allowed.statusCode).toBe(201);
    expect(String(json(allowed)["id"])).toMatch(/^550[0-9A-Za-z]{15}$/);
  });
});

describe("polymorphic query", () => {
  const enc = (soql: string) => `${V}/query?q=${encodeURIComponent(soql)}`;
  let groupId = "";

  beforeAll(async () => {
    const group = await post(`${V}/sobjects/Group`, { Name: "Api Queue", DeveloperName: "Api_Queue", Type: "Queue" });
    expect(group.statusCode).toBe(201);
    groupId = String(json(group)["id"]);
    expect((await post(`${V}/sobjects/Case`, { Subject: "Api group case", OwnerId: groupId })).statusCode).toBe(201);
    expect((await post(`${V}/sobjects/Case`, { Subject: "Api user case" })).statusCode).toBe(201);
  });

  it("REST query returns the concrete owner type per row and filters on Owner.Type", async () => {
    const res = await get(enc("SELECT Subject, Owner.Type FROM Case WHERE Owner.Type = 'Group' AND Subject LIKE 'Api%'"));
    expect(res.statusCode).toBe(200);
    const records = json(res)["records"] as Json[];
    expect(records).toHaveLength(1);
    expect(records[0]?.["Owner"]).toMatchObject({ attributes: { type: "Group" }, Type: "Group" });
  });

  it("REST query logs one UNSUPPORTED:reference-target line per query for unmodelled owner prefixes", async () => {
    const lines: string[] = [];
    const app2 = createApiServer({
      engine,
      organizationId: orgId,
      recordTypeIds,
      auth: { mode: "list", users: [{ username: "admin@orglet.local", password: "secret" }] },
      logger: { level: "warn", stream: { write: (l: string) => void lines.push(l) } },
    });
    try {
      await app2.ready();
      const login = await app2.inject({
        method: "POST",
        url: "/services/oauth2/token",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        payload: "grant_type=password&client_id=x&client_secret=y&username=admin%40orglet.local&password=secret",
      });
      const token2 = String(json(login)["access_token"]);
      const extra = await post(`${V}/sobjects/Case`, { Subject: "Api user case two" });
      expect(extra.statusCode).toBe(201);
      await pool.query(`UPDATE ${quote(orgSchema)}."case" SET ownerid = $1 WHERE subject LIKE 'Api user case%'`, [generateId("zzz")]);
      const res = await app2.inject({ method: "GET", url: enc("SELECT Subject, Owner.Name FROM Case WHERE Subject LIKE 'Api%' ORDER BY Subject"), headers: { authorization: `Bearer ${token2}` } });
      expect(res.statusCode).toBe(200);
      const records = json(res)["records"] as Json[];
      expect(records.filter((r) => String(r["Subject"]).startsWith("Api user case")).map((r) => r["Owner"])).toEqual([null, null]);
      const matching = lines.filter((l) => l.includes("UNSUPPORTED:reference-target zzz matches no object in the org schema"));
      expect(matching).toHaveLength(1);
      expect((JSON.parse(matching[0] ?? "{}") as Json)["level"]).toBe(40);
    } finally {
      await app2.close();
    }
  });
});

describe("roll-up summary fields", () => {
  const describeFields = async (name: string) => (json(await get(`${V}/sobjects/${name}/describe`))["fields"] as Json[]);

  it("describe reports roll-ups as calculated and neither createable nor updateable", async () => {
    const project = await describeFields("Project__c");
    expect(project.find((f) => f["name"] === "Milestone_Count__c")).toMatchObject({
      calculated: true,
      calculatedFormula: null,
      createable: false,
      updateable: false,
      nillable: true,
      custom: true,
      type: "double",
    });
    const account = await describeFields("Account");
    expect(account.find((f) => f["name"] === "Total_Budget__c")).toMatchObject({ calculated: true, createable: false, updateable: false, type: "currency" });
    expect(account.find((f) => f["name"] === "Last_Active_Project_Created__c")).toMatchObject({ calculated: true, type: "datetime" });
    const overdue = project.find((f) => f["name"] === "Is_Overdue__c");
    expect(overdue).toMatchObject({ calculated: true });
    expect(overdue?.["calculatedFormula"]).not.toBeNull();
    expect(project.find((f) => f["name"] === "Budget__c")).toMatchObject({ calculated: false });
  });

  it("REST create and update carrying a roll-up value fail with INVALID_FIELD_FOR_INSERT_UPDATE", async () => {
    const bad = await post(`${V}/sobjects/Account`, { Name: "Rollup Write", Total_Budget__c: 5 });
    expect(bad.statusCode).toBe(400);
    expect(arr(bad)[0]).toMatchObject({ errorCode: "INVALID_FIELD_FOR_INSERT_UPDATE", fields: ["Total_Budget__c"] });

    const created = await post(`${V}/sobjects/Account`, { Name: "Rollup Write Ok" });
    expect(created.statusCode).toBe(201);
    const id = String(json(created)["id"]);
    const upd = await patch(`${V}/sobjects/Account/${id}`, { Total_Budget__c: 5 });
    expect(upd.statusCode).toBe(400);
    expect(arr(upd)[0]).toMatchObject({ errorCode: "INVALID_FIELD_FOR_INSERT_UPDATE", fields: ["Total_Budget__c"] });
    const rec = json(await get(`${V}/sobjects/Account/${id}`));
    expect(rec["Total_Budget__c"]).not.toBe(5);
  });
});
