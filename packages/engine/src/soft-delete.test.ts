/** Store and SOQL reads on an object without IsDeleted (custom metadata, D-16): no isdeleted in any statement. Fixture: conformance/cmdt-check/project. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { loadOrgSchema, type OrgSchema, type SObjectDef } from "@orglet/metadata";
import { formatSalesforceDatetime, generateId, migrate, quote, type Pool } from "@orglet/schema";
import { openTestDb, type TestDb } from "../../../test/db.js";
import { bootstrapOrg } from "./bootstrap.js";
import { DmlEngine } from "./engine.js";
import type { Session } from "./hooks.js";
import { runQuery } from "./query.js";
import { Store } from "./store.js";

const CMDT = fileURLToPath(new URL("../../../conformance/cmdt-check/project/", import.meta.url));
const orgSchema = `test_${randomBytes(4).toString("hex")}`;
let testDb: TestDb;
let pool: Pool;
let schema: OrgSchema;
let engine: DmlEngine;
let session: Session;
let tier: SObjectDef;
let tierId = "";

beforeAll(async () => {
  testDb = await openTestDb();
  pool = testDb.pool;
  schema = (await loadOrgSchema({ projectDir: CMDT })).schema;
  await migrate(pool, schema, { orgSchema });
  session = (await bootstrapOrg(pool, schema, { orgSchema })).session;
  engine = new DmlEngine(pool, schema, { orgSchema });
  tier = schema.getObject("Support_Tier__mdt") as SObjectDef;
  tierId = generateId("m00");
  const now = formatSalesforceDatetime(new Date());
  await new Store(schema, orgSchema).insert(pool, tier, {
    Id: tierId,
    DeveloperName: "Gold",
    MasterLabel: "Gold",
    Label: "Gold",
    Language: "en_US",
    QualifiedApiName: "Gold",
    IsProtected: false,
    CreatedDate: now,
    CreatedById: session.userId,
    LastModifiedDate: now,
    LastModifiedById: session.userId,
    SystemModstamp: now,
  });
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${quote(orgSchema)} CASCADE`);
  await testDb.close();
});

describe("reads on an object without IsDeleted", () => {
  it("SOQL and queryAll return the row", async () => {
    const soql = "SELECT Id, DeveloperName FROM Support_Tier__mdt";
    expect((await runQuery(engine, session, soql, { apiVersion: "59.0" })).records).toHaveLength(1);
    expect((await runQuery(engine, session, soql, { apiVersion: "59.0", includeDeleted: true })).records).toHaveLength(1);
  });

  it("retrieve, findByField and existingIds return the row", async () => {
    expect((await engine.retrieve(session, "Support_Tier__mdt", [tierId])).has(tierId)).toBe(true);
    const developerName = tier.fields.find((f) => f.name === "DeveloperName");
    if (developerName === undefined) throw new Error("DeveloperName missing");
    expect(await engine.store.findByField(pool, tier, developerName, "gold")).toHaveLength(1);
    expect((await engine.store.existingIds(pool, tier, [tierId])).has(tierId)).toBe(true);
  });

  it("a semi-join into the __mdt runs", async () => {
    const page = await runQuery(engine, session, "SELECT Id FROM Tier_Group__mdt WHERE Id IN (SELECT Tier_Group__c FROM Support_Tier__mdt)", { apiVersion: "59.0" });
    expect(page.records).toHaveLength(0);
  });
});
