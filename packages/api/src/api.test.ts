import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { loadOrgSchema, type OrgSchema } from "@orglet/metadata";
import { createPool, databaseUrlFromEnv, migrate, quote, type Pool } from "@orglet/schema";
import { bootstrapOrg, DmlEngine } from "@orglet/engine";
import { createApiServer } from "./server.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));
const orgSchema = `test_${randomBytes(4).toString("hex")}`;
const V = "/services/data/v59.0";

let pool: Pool;
let schema: OrgSchema;
let app: FastifyInstance;
let token = "";
let orgId = "";
let userId = "";

type Json = Record<string, unknown>;
const json = (res: { body: string }) => JSON.parse(res.body) as Json;
const arr = (res: { body: string }) => JSON.parse(res.body) as Json[];
const auth = () => ({ authorization: `Bearer ${token}`, "content-type": "application/json" });
const get = (url: string) => app.inject({ method: "GET", url, headers: auth() });
const post = (url: string, body: unknown) => app.inject({ method: "POST", url, headers: auth(), payload: JSON.stringify(body) });
const patch = (url: string, body: unknown) => app.inject({ method: "PATCH", url, headers: auth(), payload: JSON.stringify(body) });
const del = (url: string) => app.inject({ method: "DELETE", url, headers: auth() });

beforeAll(async () => {
  pool = createPool(databaseUrlFromEnv());
  schema = (await loadOrgSchema({ projectDir: ACME })).schema;
  await migrate(pool, schema, { orgSchema });
  const boot = await bootstrapOrg(pool, schema, { orgSchema });
  orgId = boot.session.organizationId;
  userId = boot.session.userId;
  const engine = new DmlEngine(pool, schema, { orgSchema });
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
  await pool.query(`DROP SCHEMA IF EXISTS ${quote(orgSchema)} CASCADE`);
  await pool.end();
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
