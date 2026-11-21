/**
 * bootstrapOrg seeds the two rows every real org has (default BusinessHours, the Salesforce
 * UserLicense) exactly once, and never rewrites rows that already exist or were imported.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { loadOrgSchema, type OrgSchema, type SObjectDef } from "@orglet/metadata";
import { formatSalesforceDatetime, generateId, migrate, quote, type Pool } from "@orglet/schema";
import { openTestDb, type TestDb } from "../../../test/db.js";
import { bootstrapOrg } from "./bootstrap.js";
import { Store } from "./store.js";

let testDb: TestDb;
let pool: Pool;
let schema: OrgSchema;
const orgs: string[] = [];

beforeAll(async () => {
  testDb = await openTestDb();
  pool = testDb.pool;
  schema = (await loadOrgSchema()).schema;
});

afterAll(async () => {
  for (const org of orgs) await pool.query(`DROP SCHEMA IF EXISTS ${quote(org)} CASCADE`);
  await testDb.close();
});

// Each test gets its own Postgres schema so seed rows from one never satisfy another.
async function freshOrg(): Promise<string> {
  const org = `test_${randomBytes(4).toString("hex")}`;
  orgs.push(org);
  await migrate(pool, schema, { orgSchema: org });
  return org;
}

async function seeds(org: string) {
  const q = async <T extends Record<string, unknown>>(sql: string) => (await pool.query<T>(sql)).rows;
  return {
    hours: await q<{ id: string; name: string; isdefault: boolean; isactive: boolean }>(`SELECT "id", "name", "isdefault", "isactive" FROM ${quote(org)}."businesshours" ORDER BY "id"`),
    licenses: await q<{ id: string; name: string; masterlabel: string }>(`SELECT "id", "name", "masterlabel" FROM ${quote(org)}."userlicense" ORDER BY "id"`),
    profiles: await q<{ id: string; userlicenseid: string | null }>(`SELECT "id", "userlicenseid" FROM ${quote(org)}."profile"`),
  };
}

describe("bootstrapOrg seed rows", () => {
  it("seeds one default BusinessHours and one Salesforce UserLicense and links the admin profile to it", async () => {
    const org = await freshOrg();
    const { session } = await bootstrapOrg(pool, schema, { orgSchema: org });
    const { hours, licenses, profiles } = await seeds(org);
    expect(hours).toEqual([{ id: expect.stringMatching(/^01m/) as unknown, name: "Default", isdefault: true, isactive: true }]);
    expect(licenses).toEqual([{ id: expect.stringMatching(/^100/) as unknown, name: "Salesforce", masterlabel: "Salesforce" }]);
    expect(profiles).toEqual([{ id: session.profileId, userlicenseid: licenses[0]?.id }]);
  });

  it("seeds nothing on a second bootstrap: same rows, same ids, same link", async () => {
    const org = await freshOrg();
    await bootstrapOrg(pool, schema, { orgSchema: org });
    const first = await seeds(org);
    await bootstrapOrg(pool, schema, { orgSchema: org });
    expect(await seeds(org)).toEqual(first);
  });

  it("recreates missing seed rows and relinks the profile on an org that predates them", async () => {
    const org = await freshOrg();
    const { session } = await bootstrapOrg(pool, schema, { orgSchema: org });
    const first = await seeds(org);
    await pool.query(`UPDATE ${quote(org)}."profile" SET "userlicenseid" = NULL`);
    await pool.query(`DELETE FROM ${quote(org)}."userlicense"`);
    await pool.query(`DELETE FROM ${quote(org)}."businesshours"`);

    await bootstrapOrg(pool, schema, { orgSchema: org });
    const { hours, licenses, profiles } = await seeds(org);
    expect(hours).toEqual([{ id: expect.stringMatching(/^01m/) as unknown, name: "Default", isdefault: true, isactive: true }]);
    expect(licenses).toEqual([{ id: expect.stringMatching(/^100/) as unknown, name: "Salesforce", masterlabel: "Salesforce" }]);
    expect(licenses[0]?.id).not.toBe(first.licenses[0]?.id);
    expect(profiles).toEqual([{ id: session.profileId, userlicenseid: licenses[0]?.id }]);
  });

  it("never modifies an existing default BusinessHours or a profile that already has a license", async () => {
    const org = await freshOrg();
    const { session } = await bootstrapOrg(pool, schema, { orgSchema: org });
    const store = new Store(schema, org);
    const now = formatSalesforceDatetime(new Date());
    const stamp = { IsDeleted: false, CreatedDate: now, CreatedById: session.userId, LastModifiedDate: now, LastModifiedById: session.userId, SystemModstamp: now };
    const importedHours = generateId("01m");
    const otherLicense = generateId("100");
    await pool.query(`DELETE FROM ${quote(org)}."businesshours"`);
    await store.insert(pool, schema.getObject("BusinessHours") as SObjectDef, { Id: importedHours, Name: "Imported Hours", IsDefault: true, IsActive: false, ...stamp });
    await store.insert(pool, schema.getObject("UserLicense") as SObjectDef, { Id: otherLicense, Name: "Other", MasterLabel: "Other", ...stamp });
    await pool.query(`UPDATE ${quote(org)}."profile" SET "userlicenseid" = $1`, [otherLicense]);

    await bootstrapOrg(pool, schema, { orgSchema: org });
    const { hours, licenses, profiles } = await seeds(org);
    expect(hours).toEqual([{ id: importedHours, name: "Imported Hours", isdefault: true, isactive: false }]);
    expect(licenses).toHaveLength(2);
    expect(licenses.map((l) => l.name).sort()).toEqual(["Other", "Salesforce"]);
    expect(profiles).toEqual([{ id: session.profileId, userlicenseid: otherLicense }]);
  });
});

describe("bootstrapOrg fixed ids and clock", () => {
  const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));
  const NOW = "2026-01-02T08:00:00.000+0000";
  const ids = {
    organization: "00D000000000001EAA",
    profile: "00e000000000001AAA",
    user: "005000000000001AAA",
    businessHours: "01m000000000001AAA",
    userLicense: "100000000000001AAA",
    recordTypes: { "project__c.internal": "012000000000001AAA", "project__c.external": "012000000000002AAA" },
  };

  async function acmeOrg(): Promise<{ org: string; acme: OrgSchema }> {
    const acme = (await loadOrgSchema({ projectDir: ACME })).schema;
    const org = `test_${randomBytes(4).toString("hex")}`;
    orgs.push(org);
    await migrate(pool, acme, { orgSchema: org });
    return { org, acme };
  }

  it("mints bootstrap rows with the supplied ids and stamp", async () => {
    const { org, acme } = await acmeOrg();
    const { session, recordTypeIds } = await bootstrapOrg(pool, acme, { orgSchema: org, now: NOW, ids });
    expect(session).toEqual({ userId: ids.user, profileId: ids.profile, organizationId: ids.organization });
    expect(recordTypeIds.get("project__c.internal")).toBe(ids.recordTypes["project__c.internal"]);
    const expected: Record<string, string[]> = {
      organization: [ids.organization],
      profile: [ids.profile],
      user: [ids.user],
      businesshours: [ids.businessHours],
      userlicense: [ids.userLicense],
      recordtype: Object.values(ids.recordTypes),
    };
    for (const [table, want] of Object.entries(expected)) {
      const { rows } = await pool.query<{ id: string; createddate: string; lastmodifieddate: string; systemmodstamp: string }>(
        `SELECT "id", "createddate", "lastmodifieddate", "systemmodstamp" FROM ${quote(org)}.${quote(table)} ORDER BY "id"`,
      );
      expect(rows.map((r) => r.id).sort(), table).toEqual([...want].sort());
      for (const r of rows) expect([r.createddate, r.lastmodifieddate, r.systemmodstamp], table).toEqual([NOW, NOW, NOW]);
    }
  });

  it("generates ids for record types the options do not name", async () => {
    const { org, acme } = await acmeOrg();
    const { recordTypeIds } = await bootstrapOrg(pool, acme, {
      orgSchema: org,
      now: NOW,
      ids: { recordTypes: { "project__c.internal": ids.recordTypes["project__c.internal"], "nosuch__c.thing": "012000000000009AAA" } },
    });
    expect(recordTypeIds.get("project__c.internal")).toBe(ids.recordTypes["project__c.internal"]);
    expect(recordTypeIds.get("project__c.external")).toMatch(/^012/);
    expect(recordTypeIds.get("project__c.external")).not.toBe(ids.recordTypes["project__c.internal"]);
    expect(recordTypeIds.has("nosuch__c.thing")).toBe(false);
  });
});
