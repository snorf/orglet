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
let groupId = "";
let groupCase = "";
let userCase = "";

const q = (soql: string, options = {}) => runQuery(engine, session, soql, { apiVersion: "60.0", ...options });

const insert = async (sobject: string, input: Record<string, unknown>) => {
  const [r] = await engine.insert(session, sobject, [input]);
  if (!r?.success) throw new Error(JSON.stringify(r?.errors));
  return r.id as string;
};

beforeAll(async () => {
  testDb = await openTestDb();
  pool = testDb.pool;
  schema = (await loadOrgSchema({ projectDir: ACME })).schema;
  await migrate(pool, schema, { orgSchema });
  session = (await bootstrapOrg(pool, schema, { orgSchema })).session;
  engine = new DmlEngine(pool, schema, { orgSchema });

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

describe("polymorphic lookups", () => {
  beforeAll(async () => {
    groupId = await insert("Group", { Name: "Support Queue", DeveloperName: "Support_Queue", Type: "Queue", Email: "queue@acme.se" });
    groupCase = await insert("Case", { Subject: "Group case", OwnerId: groupId });
    userCase = await insert("Case", { Subject: "User case" });
  });

  const idsOf = async (soql: string) => (await q(soql)).records.map((r) => r["Id"]);

  it("owner name, type and attributes come from the concrete owner of each row", async () => {
    const page = await q("SELECT Subject, Owner.Name, Owner.Type FROM Case ORDER BY Subject");
    expect(page.records[0]?.["Owner"]).toEqual({ attributes: { type: "Group", url: `/services/data/v60.0/sobjects/Group/${groupId}` }, Name: "Support Queue", Type: "Group" });
    expect(page.records[1]?.["Owner"]).toEqual({ attributes: { type: "User", url: `/services/data/v60.0/sobjects/User/${session.userId}` }, Name: "Admin User", Type: "User" });
  });

  it("user-only Name fields are null on a Group owner even though Group has an Email column", async () => {
    const page = await q("SELECT Subject, Owner.Email, Owner.Alias, Owner.Title FROM Case ORDER BY Subject");
    expect(page.records[0]?.["Owner"]).toMatchObject({ Email: null, Alias: null, Title: null });
    expect(page.records[1]?.["Owner"]).toMatchObject({ Alias: "admin" });
  });

  it("a field outside the Name pseudo-object is INVALID_FIELD on entity Name", async () => {
    await expect(q("SELECT Owner.Department FROM Case")).rejects.toMatchObject({ errorCode: "INVALID_FIELD", message: expect.stringContaining("entity 'Name'") as string });
  });

  it("Owner.Type filter returns exactly the Group-owned rows", async () => {
    expect(await idsOf("SELECT Id FROM Case WHERE Owner.Type = 'Group'")).toEqual([groupCase]);
    expect(await idsOf("SELECT Id FROM Case WHERE Owner.Type = 'group'")).toEqual([groupCase]);
    expect(await idsOf("SELECT Id FROM Case WHERE Owner.Type != 'Group'")).toEqual([userCase]);
    expect(await idsOf("SELECT Id FROM Case WHERE Owner.Type IN ('User')")).toEqual([userCase]);
    expect(await idsOf("SELECT Id FROM Case WHERE Owner.Type LIKE 'Gr%'")).toEqual([groupCase]);
  });

  it("filters and sorts on the concrete owner's name", async () => {
    expect(await idsOf("SELECT Id FROM Case WHERE Owner.Name = 'Support Queue'")).toEqual([groupCase]);
    expect(await idsOf("SELECT Id FROM Case ORDER BY Owner.Name")).toEqual([userCase, groupCase]);
  });

  it("refuses traversal past a polymorphic parent as UNSUPPORTED:polymorphic-traversal", async () => {
    await expect(q("SELECT Owner.Profile.Name FROM Case")).rejects.toThrow(/UNSUPPORTED:polymorphic-traversal/);
  });

  describe("TYPEOF", () => {
    const url = (type: string, id: string) => `/services/data/v60.0/sobjects/${type}/${id}`;
    let taskAcme = "";
    let taskOpp = "";
    let taskCase = "";

    beforeAll(async () => {
      taskAcme = await insert("Task", { Subject: "Call Acme", WhatId: ids["acme"] });
      taskOpp = await insert("Task", { Subject: "Call Big", WhatId: ids["opp"] });
      taskCase = await insert("Task", { Subject: "Call Case", WhatId: groupCase });
    });

    it("TYPEOF returns only the matching branch's fields for each owner", async () => {
      const page = await q("SELECT Subject, TYPEOF Owner WHEN User THEN Alias, Email WHEN Group THEN Name, Type END FROM Case ORDER BY Subject");
      expect(page.records.map((r) => r["Subject"])).toEqual(["Group case", "User case"]);
      expect(page.records[0]?.["Owner"]).toEqual({ attributes: { type: "Group", url: url("Group", groupId) }, Name: "Support Queue", Type: "Queue" });
      expect(page.records[1]?.["Owner"]).toEqual({ attributes: { type: "User", url: url("User", session.userId) }, Alias: "admin", Email: "admin@orglet.local" });
    });

    it("TYPEOF over What picks the Account or Opportunity branch per row and is null for an unlisted type without ELSE", async () => {
      const page = await q("SELECT Id, Subject, TYPEOF What WHEN Account THEN Name, Industry WHEN Opportunity THEN Name, Amount END FROM Task ORDER BY Subject");
      expect(page.records.map((r) => r["Id"])).toEqual([taskAcme, taskOpp, taskCase]);
      expect(page.records[0]?.["What"]).toEqual({ attributes: { type: "Account", url: url("Account", ids["acme"] ?? "") }, Name: "Acme", Industry: "Energy" });
      expect(page.records[1]?.["What"]).toEqual({ attributes: { type: "Opportunity", url: url("Opportunity", ids["opp"] ?? "") }, Name: "Big", Amount: 2000 });
      expect(page.records[2]?.["What"]).toBeNull();
    });

    it("ELSE covers unlisted types with Name fields, null where the concrete object lacks the field", async () => {
      const page = await q("SELECT Subject, TYPEOF What WHEN Account THEN Name ELSE Id, Name END FROM Task ORDER BY Subject");
      expect(page.records[0]?.["What"]).toEqual({ attributes: { type: "Account", url: url("Account", ids["acme"] ?? "") }, Name: "Acme" });
      expect(page.records[1]?.["What"]).toEqual({ attributes: { type: "Opportunity", url: url("Opportunity", ids["opp"] ?? "") }, Id: ids["opp"], Name: "Big" });
      expect(page.records[2]?.["What"]).toEqual({ attributes: { type: "Case", url: url("Case", groupCase) }, Id: groupCase, Name: null });
    });

    it("TYPEOF combines with an Owner.Type filter", async () => {
      const page = await q("SELECT Subject, TYPEOF Owner WHEN Group THEN Name END FROM Case WHERE Owner.Type = 'Group'");
      expect(page.records).toHaveLength(1);
      expect(page.records[0]?.["Owner"]).toEqual({ attributes: { type: "Group", url: url("Group", groupId) }, Name: "Support Queue" });
    });

    it("two TYPEOF expressions on different relationships shape independently", async () => {
      const page = await q("SELECT Subject, TYPEOF What WHEN Account THEN Name END, TYPEOF Owner WHEN User THEN Alias END FROM Task WHERE Subject = 'Call Acme'");
      expect(page.records).toHaveLength(1);
      expect(page.records[0]?.["What"]).toMatchObject({ attributes: { type: "Account" }, Name: "Acme" });
      expect(page.records[0]?.["Owner"]).toMatchObject({ attributes: { type: "User" }, Alias: "admin" });
    });
  });
});
