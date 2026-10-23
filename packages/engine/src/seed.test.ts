/** Custom-metadata seeding (CMDT-02, CMDT-03): the pure plan (coercion, derived Ids, relationship resolution, warnings) and the per-type full sync at orglet up. Fixture: conformance/cmdt-check/project. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { formatDiagnostic, loadBaseline, loadOrgSchema, buildOrgSchema, readSourceProject, type Baseline, type BuildResult, type CustomMetadataRecord, type OrgSchema, type SourceProject } from "@orglet/metadata";
import { deriveCustomMetadataId, dropKeyPrefixes, migrate, quote, reconcileKeyPrefixes, type Pool } from "@orglet/schema";
import { openTestDb, type TestDb } from "../../../test/db.js";
import { bootstrapOrg } from "./bootstrap.js";
import { customMetadataSummary, planCustomMetadataSeed, seedCustomMetadata, type CustomMetadataPlan, type CustomMetadataSeedRow } from "./seed.js";

const CMDT = fileURLToPath(new URL("../../../conformance/cmdt-check/project/", import.meta.url));

let testDb: TestDb;
let pool: Pool;
let baseline: Baseline;
let project: SourceProject;
const orgs: string[] = [];

beforeAll(async () => {
  testDb = await openTestDb();
  pool = testDb.pool;
  baseline = await loadBaseline();
  project = await readSourceProject(CMDT);
});

afterAll(async () => {
  for (const org of orgs) {
    await dropKeyPrefixes(pool, org);
    await pool.query(`DROP SCHEMA IF EXISTS ${quote(org)} CASCADE`);
  }
  await testDb.close();
});

const fixture = () => loadOrgSchema({ projectDir: CMDT });
const rowOf = (plan: CustomMetadataPlan, type: string, dev: string): CustomMetadataSeedRow => {
  const row = plan.types.find((t) => t.object.name === type)?.rows.find((r) => r.developerName === dev);
  if (!row) throw new Error(`no planned row ${type}.${dev}`);
  return row;
};
const rec = (type: string, developerName: string, values: { field: string; value: string }[] = [], file = `${developerName}.md-meta.xml`): CustomMetadataRecord => ({
  type,
  developerName,
  label: developerName,
  protected: false,
  values,
  file,
});
/** The fixture schema with only the given records, for in-memory cases. */
const withRecords = (records: CustomMetadataRecord[]): BuildResult => buildOrgSchema(baseline, { ...project, customMetadata: records });

// The six seed-plan warnings of conformance/cmdt-check/README.md.
const SEED_WARNINGS = [
  "UNSUPPORTED:custom-metadata-record Support_Tier__mdt.Unknown_Field__c is not a field of Support_Tier__mdt; values dropped (records: Bronze)",
  "UNSUPPORTED:custom-metadata-record Support_Tier__mdt.Max_Seats__c: values that cannot be stored as Number were stored as null (records: Bronze)",
  "UNSUPPORTED:custom-metadata-record Support_Tier__mdt.Region__c: values that cannot be stored as Picklist were stored as null (records: Silver)",
  "UNSUPPORTED:custom-metadata-record Support_Tier__mdt.Tier_Group__c: target Tier_Group__mdt record Missing_Group does not exist; stored as null (records: Bronze)",
  "UNSUPPORTED:reference-target Support_Tier__mdt.Target_Object__c: EntityDefinition target Solution is not modelled by orglet; stored as null (records: Bronze)",
  "UNSUPPORTED:reference-target Support_Tier__mdt.Target_Field__c: FieldDefinition target Account.No_Such_Field__c is not modelled by orglet; stored as null (records: Bronze)",
];

describe("planCustomMetadataSeed", () => {
  it("keeps \"007\" in a Text field as text and stores xsi:nil and absent values as null", async () => {
    const built = await fixture();
    const plan = planCustomMetadataSeed(built.schema, built.customMetadata);
    expect(rowOf(plan, "Support_Tier__mdt", "Gold").values["Code__c"]).toBe("007");
    expect(rowOf(plan, "Support_Tier__mdt", "Silver").values["Code__c"]).toBeNull();
    expect(rowOf(plan, "Support_Tier__mdt", "Bronze").values["Is_Active__c"]).toBe(false);
    expect(rowOf(plan, "Tier_Group__mdt", "Standard").values["Sort_Order__c"]).toBeNull();
    expect(plan.types.map((t) => t.object.name)).toEqual(["Support_Tier__mdt", "Tier_Group__mdt"]);
    expect(plan.records).toBe(5);
    expect([...plan.warnings].sort()).toEqual([...SEED_WARNINGS].sort());
    expect(plan.warnings).toEqual(plan.diagnostics.map(formatDiagnostic));
  });

  it("stores an absent or nil Checkbox as false", async () => {
    const built = await fixture();
    const plan = planCustomMetadataSeed(built.schema, [
      ...built.customMetadata,
      rec("Support_Tier__mdt", "Blank", [{ field: "Is_Active__c", value: "" }]),
    ]);
    expect(rowOf(plan, "Support_Tier__mdt", "Blank").values["Is_Active__c"]).toBe(false);
    expect(rowOf(plan, "Support_Tier__mdt", "Bronze").values["Is_Active__c"]).toBe(false);
    expect(rowOf(plan, "Support_Tier__mdt", "Gold").values["IsProtected"]).toBe(false);
    expect(rowOf(plan, "Support_Tier__mdt", "Silver").values["IsProtected"]).toBe(true);
  });

  it("derives the same 18-character Id for a record in every run and for any casing of type and DeveloperName", async () => {
    const built = await fixture();
    const first = planCustomMetadataSeed(built.schema, built.customMetadata);
    const second = planCustomMetadataSeed(built.schema, built.customMetadata);
    expect(second.types.map((t) => t.rows.map((r) => r.id))).toEqual(first.types.map((t) => t.rows.map((r) => r.id)));
    const gold = rowOf(first, "Support_Tier__mdt", "Gold").id;
    expect(gold).toHaveLength(18);
    expect(gold).toBe(deriveCustomMetadataId("m00", "Support_Tier__mdt", "Gold"));
    const recased = planCustomMetadataSeed(built.schema, [rec("support_tier__MDT", "GOLD")]);
    expect(recased.types[0]?.rows[0]?.id).toBe(gold);
  });

  it("warns once per type and field for a value that cannot be coerced, naming the records", async () => {
    const built = await fixture();
    const bad = (dev: string) => rec("Support_Tier__mdt", dev, [{ field: "Max_Seats__c", value: "lots" }]);
    const plan = planCustomMetadataSeed(built.schema, [bad("B"), bad("A")]);
    expect(plan.warnings).toEqual([
      "UNSUPPORTED:custom-metadata-record Support_Tier__mdt.Max_Seats__c: values that cannot be stored as Number were stored as null (records: A, B)",
    ]);
    expect(rowOf(plan, "Support_Tier__mdt", "A").values["Max_Seats__c"]).toBeNull();
  });

  it("warns once per type and field for an undeclared field and drops the value", async () => {
    const built = await fixture();
    const plan = planCustomMetadataSeed(built.schema, built.customMetadata);
    expect(plan.warnings).toContain(SEED_WARNINGS[0]);
    expect(plan.warnings.filter((w) => w.includes("Unknown_Field__c"))).toHaveLength(1);
    expect(rowOf(plan, "Support_Tier__mdt", "Bronze").values).not.toHaveProperty("Unknown_Field__c");
  });

  it("resolves an mdt-to-mdt relationship to the target record's derived Id, cycles included", async () => {
    const built = await fixture();
    const plan = planCustomMetadataSeed(built.schema, built.customMetadata);
    expect(rowOf(plan, "Support_Tier__mdt", "Gold").values["Tier_Group__c"]).toBe(deriveCustomMetadataId("m01", "Tier_Group__mdt", "Premium"));
    expect(rowOf(plan, "Tier_Group__mdt", "Premium").values["Default_Tier__c"]).toBe(deriveCustomMetadataId("m00", "Support_Tier__mdt", "Gold"));
  });

  it("stores an EntityDefinition or FieldDefinition target as written and nulls a dangling one with one reference-target warning", async () => {
    const built = await fixture();
    const plan = planCustomMetadataSeed(built.schema, [
      ...built.customMetadata,
      rec("Support_Tier__mdt", "Lower", [{ field: "Target_Object__c", value: "account" }]),
    ]);
    const gold = rowOf(plan, "Support_Tier__mdt", "Gold").values;
    expect(gold["Target_Object__c"]).toBe("Account");
    expect(gold["Target_Field__c"]).toBe("Account.Industry");
    const silver = rowOf(plan, "Support_Tier__mdt", "Silver").values;
    expect(silver["Target_Object__c"]).toBe("Ticket__c");
    expect(silver["Target_Field__c"]).toBe("Ticket__c.Priority__c");
    expect(rowOf(plan, "Support_Tier__mdt", "Lower").values["Target_Object__c"]).toBe("account");
    const bronze = rowOf(plan, "Support_Tier__mdt", "Bronze").values;
    expect(bronze["Target_Object__c"]).toBeNull();
    expect(bronze["Target_Field__c"]).toBeNull();
    for (const w of SEED_WARNINGS.filter((s) => s.startsWith("UNSUPPORTED:reference-target"))) expect(plan.warnings.filter((x) => x === w)).toHaveLength(1);
  });

  it("nulls an mdt target record that does not exist with one custom-metadata-record warning", async () => {
    const built = await fixture();
    const plan = planCustomMetadataSeed(built.schema, built.customMetadata);
    expect(rowOf(plan, "Support_Tier__mdt", "Bronze").values["Tier_Group__c"]).toBeNull();
    expect(plan.warnings.filter((w) => w === SEED_WARNINGS[3])).toHaveLength(1);
  });

  it("keeps the first of two records with the same DeveloperName and warns", async () => {
    const built = await fixture();
    const plan = planCustomMetadataSeed(built.schema, [rec("Support_Tier__mdt", "Gold", [], "one.xml"), rec("Support_Tier__mdt", "gold", [], "two.xml")]);
    expect(plan.types[0]?.rows.map((r) => r.developerName)).toEqual(["Gold"]);
    expect(plan.warnings).toEqual(["UNSUPPORTED:custom-metadata-record two.xml: duplicate record Support_Tier__mdt.gold; the first definition is kept"]);
  });

  it("refuses two records whose derived Ids collide, naming both", async () => {
    const built = await fixture();
    expect(() => planCustomMetadataSeed(built.schema, [rec("Support_Tier__mdt", "A"), rec("Support_Tier__mdt", "B")], () => "m00000000000000AAA")).toThrow(
      "custom metadata Id collision in Support_Tier__mdt: records A and B both derive m00000000000000AAA; rename one of them",
    );
  });

  it("builds from in-memory records the same way as from disk", () => {
    const built = withRecords([rec("support_tier__mdt", "Gold")]);
    const plan = planCustomMetadataSeed(built.schema, built.customMetadata);
    expect(plan.records).toBe(1);
  });
});

/** A fresh org schema with persisted prefixes and bootstrap rows; a fresh build each time because reconcile mutates keyPrefix. */
async function freshOrg(): Promise<{ org: string; schema: OrgSchema; plan: CustomMetadataPlan; userId: string; built: BuildResult }> {
  const org = `test_${randomBytes(4).toString("hex")}`;
  orgs.push(org);
  const built = await fixture();
  await reconcileKeyPrefixes(pool, built.schema, { orgSchema: org });
  await migrate(pool, built.schema, { orgSchema: org });
  const { session } = await bootstrapOrg(pool, built.schema, { orgSchema: org });
  const plan = planCustomMetadataSeed(built.schema, built.customMetadata);
  return { org, schema: built.schema, plan, userId: session.userId, built };
}

const tiers = async (org: string) => (await pool.query<Record<string, unknown>>(`SELECT * FROM ${quote(org)}.support_tier__mdt ORDER BY developername`)).rows;
const allIds = async (org: string) =>
  [...(await pool.query<{ id: string }>(`SELECT id FROM ${quote(org)}.support_tier__mdt UNION ALL SELECT id FROM ${quote(org)}.tier_group__mdt`)).rows.map((r) => r.id)].sort();

describe("seedCustomMetadata", () => {
  it("inserts every planned row with audit fields from the bootstrap admin", async () => {
    const { org, schema, plan, userId } = await freshOrg();
    const result = await seedCustomMetadata(pool, schema, plan, { orgSchema: org, userId });
    expect(result).toEqual({ records: 5, types: 2, added: 5, updated: 0, removed: 0 });
    const gold = (await tiers(org)).find((r) => r["developername"] === "Gold");
    expect(gold).toMatchObject({ code__c: "007", max_seats__c: 50, createdbyid: userId, label: "Gold", language: "en_US", namespaceprefix: null });
  });

  it("a second sync reports 0 added, 0 updated, 0 removed and leaves SystemModstamp unchanged", async () => {
    const { org, schema, plan, userId } = await freshOrg();
    await seedCustomMetadata(pool, schema, plan, { orgSchema: org, userId });
    const before = (await tiers(org)).map((r) => r["systemmodstamp"]);
    const again = await seedCustomMetadata(pool, schema, plan, { orgSchema: org, userId });
    expect(again).toEqual({ records: 5, types: 2, added: 0, updated: 0, removed: 0 });
    expect((await tiers(org)).map((r) => r["systemmodstamp"])).toEqual(before);
  });

  it("updates a changed record in place and keeps its Id", async () => {
    const { org, schema, built, plan, userId } = await freshOrg();
    await seedCustomMetadata(pool, schema, plan, { orgSchema: org, userId });
    const first = (await tiers(org)).find((r) => r["developername"] === "Gold");
    const records = built.customMetadata.map((r) => (r.developerName === "Gold" ? { ...r, label: "Gold Plus" } : r));
    const result = await seedCustomMetadata(pool, schema, planCustomMetadataSeed(schema, records), { orgSchema: org, userId });
    expect(result).toMatchObject({ added: 0, updated: 1, removed: 0 });
    const gold = (await tiers(org)).find((r) => r["developername"] === "Gold");
    expect(gold).toMatchObject({ id: first?.["id"], masterlabel: "Gold Plus", label: "Gold Plus" });
    expect(String(gold?.["systemmodstamp"]) >= String(first?.["systemmodstamp"])).toBe(true);
  });

  it("hard-deletes a record whose file is gone and gives the Id back when it returns", async () => {
    const { org, schema, built, plan, userId } = await freshOrg();
    await seedCustomMetadata(pool, schema, plan, { orgSchema: org, userId });
    const silver = (await tiers(org)).find((r) => r["developername"] === "Silver")?.["id"];
    const without = planCustomMetadataSeed(schema, built.customMetadata.filter((r) => r.developerName !== "Silver"));
    expect(await seedCustomMetadata(pool, schema, without, { orgSchema: org, userId })).toMatchObject({ added: 0, removed: 1 });
    expect((await tiers(org)).some((r) => r["developername"] === "Silver")).toBe(false);
    expect(await seedCustomMetadata(pool, schema, plan, { orgSchema: org, userId })).toMatchObject({ added: 1, removed: 0 });
    expect((await tiers(org)).find((r) => r["developername"] === "Silver")?.["id"]).toBe(silver);
  });

  it("yields the same Ids after orglet reset and in a second org schema", async () => {
    const one = await freshOrg();
    await seedCustomMetadata(pool, one.schema, one.plan, { orgSchema: one.org, userId: one.userId });
    const ids = await allIds(one.org);
    expect(ids).toHaveLength(5);
    // orglet reset without --drop-prefixes: the data goes, the persisted prefixes stay.
    await pool.query(`DROP SCHEMA ${quote(one.org)} CASCADE`);
    const built = await fixture();
    await reconcileKeyPrefixes(pool, built.schema, { orgSchema: one.org });
    await migrate(pool, built.schema, { orgSchema: one.org });
    const { session } = await bootstrapOrg(pool, built.schema, { orgSchema: one.org });
    await seedCustomMetadata(pool, built.schema, planCustomMetadataSeed(built.schema, built.customMetadata), { orgSchema: one.org, userId: session.userId });
    expect(await allIds(one.org)).toEqual(ids);

    const two = await freshOrg();
    await seedCustomMetadata(pool, two.schema, two.plan, { orgSchema: two.org, userId: two.userId });
    expect(await allIds(two.org)).toEqual(ids);
  });
});

describe("customMetadataSummary", () => {
  it("formats the D-04 line", () => {
    expect(customMetadataSummary({ records: 5, types: 2, added: 5, updated: 0, removed: 0 })).toBe("custom metadata: 5 records in 2 types (5 added, 0 updated, 0 removed)");
  });
});
