import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { loadOrgSchema, type OrgSchema } from "@orglet/metadata";
import { migrate, quote, type Pool } from "@orglet/schema";
import { openTestDb, type TestDb } from "../../../test/db.js";
import { bootstrapOrg } from "./bootstrap.js";
import { DmlEngine } from "./engine.js";
import type { Session } from "./hooks.js";
import { runQuery } from "./query.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));
const orgSchema = `test_${randomBytes(4).toString("hex")}`;
let testDb: TestDb;
let pool: Pool;
let schema: OrgSchema;
let engine: DmlEngine;
let session: Session;
const ids: Record<string, string> = {};

const q = (soql: string, options = {}) => runQuery(engine, session, soql, { apiVersion: "60.0", ...options });

beforeAll(async () => {
  testDb = await openTestDb();
  pool = testDb.pool;
  schema = (await loadOrgSchema({ projectDir: ACME })).schema;
  await migrate(pool, schema, { orgSchema });
  session = (await bootstrapOrg(pool, schema, { orgSchema })).session;
  engine = new DmlEngine(pool, schema, { orgSchema });

  const insert = async (sobject: string, input: Record<string, unknown>) => {
    const [r] = await engine.insert(session, sobject, [input]);
    if (!r?.success) throw new Error(JSON.stringify(r?.errors));
    return r.id as string;
  };
  ids["acme"] = await insert("Account", { Name: "Acme", Industry: "Energy", AnnualRevenue: 1000, Website: "https://acme.se", BillingCity: "Stockholm", BillingCountry: "Sweden" });
  ids["beta"] = await insert("Account", { Name: "beta corp", Industry: "Other", AnnualRevenue: 50 });
  ids["gamma"] = await insert("Account", { Name: "Gamma", Industry: "Energy" });
  ids["jane"] = await insert("Contact", { FirstName: "Jane", LastName: "Doe", Email: "jane@acme.se", AccountId: ids["acme"], Preferred_Language__c: "sv" });
  ids["john"] = await insert("Contact", { FirstName: "John", LastName: "Roe", AccountId: ids["acme"] });
  ids["solo"] = await insert("Contact", { LastName: "Solo" });
  ids["opp"] = await insert("Opportunity", { Name: "Big", StageName: "Prospecting", CloseDate: "2026-12-31", Amount: 2000, AccountId: ids["acme"] });
  ids["proj"] = await insert("Project__c", { Name: "Rollout", Account__c: ids["acme"], Status__c: "Active", End_Date__c: "2020-01-01" });
  await engine.delete(session, "Account", [ids["gamma"]]);
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${quote(orgSchema)} CASCADE`);
  await testDb.close();
});

describe("runQuery", () => {
  it("returns records with attributes in canonical field casing", async () => {
    const page = await q("select id, name, industry from account where name = 'ACME'");
    expect(page).toMatchObject({ totalSize: 1, done: true });
    expect(page.records[0]).toEqual({
      attributes: { type: "Account", url: `/services/data/v60.0/sobjects/Account/${ids["acme"]}` },
      Id: ids["acme"],
      Name: "Acme",
      Industry: "Energy",
    });
  });

  it("nests parent records and null parents", async () => {
    const page = await q("SELECT Id, Name, Account.Name, Account.Owner.Alias FROM Contact ORDER BY LastName");
    expect(page.records.map((r) => r["Name"])).toEqual(["Jane Doe", "John Roe", "Solo"]);
    expect(page.records[0]?.["Account"]).toMatchObject({ attributes: { type: "Account" }, Name: "Acme", Owner: { Alias: "admin" } });
    expect(page.records[2]?.["Account"]).toBeNull();
  });

  it("returns child subqueries as nested query results, null when empty", async () => {
    const page = await q("SELECT Id, (SELECT LastName FROM Contacts ORDER BY LastName DESC LIMIT 1), (SELECT Name, Status__c FROM Projects__r) FROM Account ORDER BY Name");
    const acme = page.records.find((r) => r["Id"] === ids["acme"]);
    expect(acme?.["Contacts"]).toEqual({ totalSize: 1, done: true, records: [{ attributes: { type: "Contact", url: `/services/data/v60.0/sobjects/Contact/${ids["john"]}` }, LastName: "Roe" }] });
    expect(acme?.["Projects__r"]).toMatchObject({ totalSize: 1, records: [{ Name: "Rollout", Status__c: "Active" }] });
    const beta = page.records.find((r) => r["Id"] === ids["beta"]);
    expect(beta?.["Contacts"]).toBeNull();
  });

  it("excludes deleted rows unless queryAll", async () => {
    expect((await q("SELECT COUNT() FROM Account")).totalSize).toBe(2);
    expect((await q("SELECT COUNT() FROM Account", { includeDeleted: true })).totalSize).toBe(3);
    const all = await q("SELECT Id, IsDeleted FROM Account WHERE IsDeleted = true", { includeDeleted: true });
    expect(all.records.map((r) => r["Id"])).toEqual([ids["gamma"]]);
  });

  it("filters with semi-joins, IN lists and LIKE", async () => {
    const page = await q("SELECT Name FROM Account WHERE Id IN (SELECT AccountId FROM Contact WHERE Email LIKE '%@acme.se') AND Industry IN ('Energy', 'Other')");
    expect(page.records.map((r) => r["Name"])).toEqual(["Acme"]);
  });

  it("aggregates with GROUP BY and names unaliased expressions expr0..", async () => {
    const page = await q("SELECT Industry, COUNT(Id) cnt, SUM(AnnualRevenue) FROM Account GROUP BY Industry ORDER BY Industry");
    expect(page.records).toEqual([
      { attributes: { type: "AggregateResult" }, Industry: "Energy", cnt: 1, expr0: 1000 },
      { attributes: { type: "AggregateResult" }, Industry: "Other", cnt: 1, expr0: 50 },
    ]);
  });

  it("computes formula fields and compound fields in results", async () => {
    const opp = await q("SELECT Name, Weighted_Amount__c FROM Opportunity");
    expect(opp.records[0]).toMatchObject({ Name: "Big", Weighted_Amount__c: 200 });
    const proj = await q("SELECT Is_Overdue__c FROM Project__c");
    expect(proj.records[0]?.["Is_Overdue__c"]).toBe(true);
    const acct = await q(`SELECT BillingAddress, BillingCity FROM Account WHERE Id = '${ids["acme"]}'`);
    expect(acct.records[0]?.["BillingAddress"]).toMatchObject({ city: "Stockholm", country: "Sweden", street: null });
    const beta = await q(`SELECT BillingAddress FROM Account WHERE Id = '${ids["beta"]}'`);
    expect(beta.records[0]?.["BillingAddress"]).toBeNull();
  });

  it("maps toLabel and sorts text case-insensitively", async () => {
    const page = await q("SELECT toLabel(Preferred_Language__c) FROM Contact WHERE Preferred_Language__c != null");
    expect(page.records[0]?.["Preferred_Language__c"]).toBe("Swedish");
    const sorted = await q("SELECT Name FROM Account ORDER BY Name");
    expect(sorted.records.map((r) => r["Name"])).toEqual(["Acme", "beta corp"]);
  });

  it("pages results statelessly with a total size", async () => {
    const first = await q("SELECT Id FROM Contact ORDER BY LastName", { batchSize: 2 });
    expect(first).toMatchObject({ totalSize: 3, done: false, nextOffset: 2 });
    expect(first.records).toHaveLength(2);
    const second = await q("SELECT Id FROM Contact ORDER BY LastName", { batchSize: 2, offset: 2 });
    expect(second).toMatchObject({ totalSize: 3, done: true });
    expect(second.records.map((r) => r["Id"])).toEqual([ids["solo"]]);
  });

  it("honours the query's own LIMIT under pagination", async () => {
    const page = await q("SELECT Id FROM Contact LIMIT 1", { batchSize: 2000 });
    expect(page).toMatchObject({ totalSize: 1, done: true });
  });
});
