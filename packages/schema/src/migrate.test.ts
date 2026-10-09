import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { buildOrgSchema, loadBaseline, loadOrgSchema, OrgSchemaImpl, type FieldDef, type FieldType, type OrgSchema, type SObjectDef, type SourceField, type SourceFilterItem, type SourceObject } from "@orglet/metadata";
import type { Pool } from "./db.js";
import { openTestDb, type TestDb } from "../../../test/db.js";
import { migrate } from "./migrate.js";
import { quote } from "./columns.js";
import { generateId } from "./ids.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));

// Each run gets its own Postgres schema so tests never touch each other or a dev org.
const orgSchema = `test_${randomBytes(4).toString("hex")}`;
let testDb: TestDb;
let pool: Pool;

beforeAll(async () => {
  testDb = await openTestDb();
  pool = testDb.pool;
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${quote(orgSchema)} CASCADE`);
  await testDb.close();
});

async function columns(table: string): Promise<Map<string, string>> {
  const res = await pool.query<{ column_name: string; data_type: string; character_maximum_length: number | null }>(
    `SELECT column_name, data_type, character_maximum_length FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2`,
    [orgSchema, table],
  );
  return new Map(res.rows.map((r) => [r.column_name, r.character_maximum_length === null ? r.data_type : `${r.data_type}(${r.character_maximum_length})`]));
}

describe("migrate", () => {
  it("creates one table per object with stored columns only", async () => {
    const { schema } = await loadOrgSchema({ projectDir: ACME });
    const result = await migrate(pool, schema, { orgSchema });
    expect(result.warnings).toEqual([]);
    expect(result.statements.filter((s) => s.startsWith("CREATE TABLE")).length).toBe(schema.objects.size);

    const project = await columns("project__c");
    expect(project.get("id")).toBe("character(18)");
    expect(project.get("name")).toBe("character varying(80)");
    expect(project.get("account__c")).toBe("character(18)");
    expect(project.get("budget__c")).toBe("numeric");
    expect(project.get("notes__c")).toBe("text");
    expect(project.has("is_overdue__c"), "formula fields are virtual").toBe(false);
    expect(project.has("ownerid"), "master-detail children have no owner").toBe(false);

    const account = await columns("account");
    expect(account.has("billingaddress"), "compound fields are virtual").toBe(false);
    expect(account.get("billingcity")).toBe("character varying(40)");
    expect(account.get("isdeleted")).toBe("boolean");
  });

  it("is idempotent: a second run executes no DDL beyond the idempotent statements", async () => {
    const { schema } = await loadOrgSchema({ projectDir: ACME });
    const result = await migrate(pool, schema, { orgSchema });
    expect(result.warnings).toEqual([]);
    const changing = result.statements.filter((s) => /^(CREATE TABLE|ALTER TABLE .* (ADD|DROP|ALTER) COLUMN|DROP TABLE)/.test(s));
    expect(changing).toEqual([]);
  });

  it("adds foreign keys for lookups to known objects, unique indexes for unique fields, and sequences for auto-numbers", async () => {
    const fks = await pool.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = $1 AND contype = 'f'`,
      [orgSchema],
    );
    const names = fks.rows.map((r) => r.conname);
    expect(names).toContain("fk_project__c_account__c");
    expect(names).toContain("fk_contact_accountid");
    expect(names).not.toContain("fk_account_ownerid"); // polymorphic User/Group: no FK

    const idx = await pool.query<{ indexname: string; indexdef: string }>(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = $1`, [orgSchema]);
    const byName = new Map(idx.rows.map((r) => [r.indexname, r.indexdef]));
    expect(byName.get("ux_project__c_code__c")).toMatch(/UNIQUE INDEX .* \(code__c\)$/); // case-sensitive external id
    expect(byName.get("ux_account_customer_number__c")).toMatch(/UNIQUE INDEX .* \(lower\(\(customer_number__c\)::text\)\)$/);

    const seq = await pool.query<{ sequencename: string }>(`SELECT sequencename FROM pg_sequences WHERE schemaname = $1`, [orgSchema]);
    expect(seq.rows.map((r) => r.sequencename)).toContain("seq_milestone__c_name");
  });

  it("adds new columns and widens existing ones on reload, but refuses to narrow or drop without force", async () => {
    const { schema } = await loadOrgSchema({ projectDir: ACME });
    const project = schema.getObject("Project__c") as SObjectDef;
    const code = project.fields.find((f) => f.name === "Code__c") as FieldDef;
    const wider: SObjectDef = {
      ...project,
      fields: [
        ...project.fields.map((f) => (f === code ? { ...f, length: 40 } : f)),
        { ...code, name: "Extra__c", label: "Extra", unique: false, externalId: false, idLookup: false, length: 10 },
      ],
    };
    const objects = new Map(schema.objects);
    objects.set("project__c", wider);
    const grown = new OrgSchemaImpl(objects, schema.globalValueSets, schema.standardValueSets);

    const up = await migrate(pool, grown, { orgSchema });
    expect(up.warnings).toEqual([]);
    expect(up.statements).toContain(`ALTER TABLE "${orgSchema}"."project__c" ADD COLUMN "extra__c" varchar(10)`);
    expect(up.statements).toContain(`ALTER TABLE "${orgSchema}"."project__c" ALTER COLUMN "code__c" TYPE varchar(40)`);

    const back = await migrate(pool, schema, { orgSchema });
    expect(back.warnings).toEqual([
      expect.stringContaining("UNSUPPORTED:schema-narrow column project__c.code__c"),
      expect.stringContaining("UNSUPPORTED:schema-drop column project__c.extra__c"),
    ]);
    expect((await columns("project__c")).get("code__c")).toBe("character varying(40)");

    const forced = await migrate(pool, schema, { orgSchema, force: true });
    expect(forced.warnings).toEqual([]);
    const after = await columns("project__c");
    expect(after.get("code__c")).toBe("character varying(20)");
    expect(after.has("extra__c")).toBe(false);
  });
});

describe("migrate across the thin standard-object upgrade", () => {
  const THIN = new Set(["BusinessHours", "BusinessProcess", "CallCenter", "DandBCompany", "Entitlement", "ExternalDataSource", "IdeaTheme", "Individual", "OperatingHours", "OpportunityHistory", "ServiceAppointment", "ServiceContract", "SocialPost", "UserLicense"]);
  const FK_TO_THIN = ["fk_case_businesshoursid", "fk_recordtype_businessprocessid", "fk_user_callcenterid", "fk_account_dandbcompanyid", "fk_lead_dandbcompanyid", "fk_case_entitlementid", "fk_product2_externaldatasourceid", "fk_user_workspaceid", "fk_contact_individualid", "fk_lead_individualid", "fk_user_individualid", "fk_account_operatinghoursid", "fk_opportunity_lastamountchangedhistoryid", "fk_opportunity_lastclosedatechangedhistoryid", "fk_event_serviceappointmentid", "fk_case_servicecontractid", "fk_case_sourceid", "fk_profile_userlicenseid"];
  const orgs: string[] = [];
  let before: OrgSchema;
  let after: OrgSchema;
  const fkNames = async (org: string) =>
    (await pool.query<{ conname: string }>(`SELECT conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = $1 AND contype = 'f'`, [org])).rows.map((r) => r.conname);
  const freshOrg = () => {
    const s = `test_${randomBytes(4).toString("hex")}`;
    orgs.push(s);
    return s;
  };

  beforeAll(async () => {
    const baseline = await loadBaseline();
    before = buildOrgSchema({ ...baseline, objects: baseline.objects.filter((o) => !THIN.has(o.name)) }).schema;
    after = buildOrgSchema(baseline).schema;
  });

  afterAll(async () => {
    for (const org of orgs) await pool.query(`DROP SCHEMA IF EXISTS ${quote(org)} CASCADE`);
  });

  it("thin: upgrading an org migrated before the 14 objects existed creates their tables and adds the 18 foreign keys that point at them", async () => {
    const org = freshOrg();
    await migrate(pool, before, { orgSchema: org });
    expect((await fkNames(org)).filter((n) => FK_TO_THIN.includes(n))).toEqual([]);
    const up = await migrate(pool, after, { orgSchema: org });
    expect(up.warnings).toEqual([]);
    expect(up.statements.filter((s) => s.startsWith("CREATE TABLE")).length).toBe(14);
    expect(await fkNames(org)).toEqual(expect.arrayContaining(FK_TO_THIN));
  });

  it("thin: an upgrade whose new foreign key meets a dangling Id fails naming table, column and target, and rolls back", async () => {
    const org = freshOrg();
    await migrate(pool, before, { orgSchema: org });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // A row loaded by `up --import` while BusinessHours did not exist yet: no FK enforcement, like import mode.
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(
        `INSERT INTO ${quote(org)}."case" ("id", "isdeleted", "createddate", "createdbyid", "lastmodifieddate", "lastmodifiedbyid", "systemmodstamp", "businesshoursid") VALUES ($1, false, now(), $2, now(), $2, now(), $3)`,
        ["500000000000001AAA", "005000000000001AAA", "01m000000000001AAA"],
      );
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    await expect(migrate(pool, after, { orgSchema: org })).rejects.toThrow(
      `cannot add foreign key fk_case_businesshoursid: ${org}.case.businesshoursid holds values with no matching row in ${org}.businesshours`,
    );
    const tables = await pool.query<{ n: string }>(`SELECT count(*)::text AS n FROM information_schema.tables WHERE table_schema = $1 AND table_name = 'businesshours'`, [org]);
    expect(tables.rows[0]?.n).toBe("0"); // the whole upgrade rolled back
  });
});

describe("roll-up backfill", () => {
  const rollupSchema = `test_${randomBytes(4).toString("hex")}`;
  const sourceField = (fullName: string, type: FieldType, extra: Partial<SourceField> = {}): SourceField => ({ fullName, label: fullName, type, ...extra });
  const sourceObject = (name: string, fields: SourceField[]): SourceObject => ({ name, fields, validationRules: [], recordTypes: [] });
  const filter = (field: string, operation: string, value: string, valueField?: string): SourceFilterItem => ({ field, operation, value, ...(valueField !== undefined ? { valueField } : {}) });
  const summary = (fullName: string, op: string, fk: string, summarized?: string, filters?: SourceFilterItem[]): SourceField => ({
    fullName,
    label: fullName,
    type: "Summary",
    summaryForeignKey: fk,
    summaryOperation: op,
    ...(summarized !== undefined ? { summarizedField: summarized } : {}),
    ...(filters !== undefined ? { summaryFilterItems: filters } : {}),
  });
  const NAMES = ["grand__c", "parent__c", "child__c"];
  /** Only the three custom objects: no User table, so no audit foreign keys to satisfy. */
  const only3 = (full: OrgSchema, keep: (f: FieldDef) => boolean): OrgSchema =>
    new OrgSchemaImpl(
      new Map(
        NAMES.map((n) => {
          const o = full.objects.get(n) as SObjectDef;
          return [n, { ...o, fields: o.fields.filter(keep) }];
        }),
      ),
      full.globalValueSets,
      full.standardValueSets,
    );
  let full3: OrgSchema;
  let before: OrgSchema;
  const insert = async (obj: SObjectDef, { isdeleted = false, ...values }: Record<string, unknown>): Promise<string> => {
    const id = generateId(obj.keyPrefix);
    const cols = ["id", "isdeleted", "createddate", "createdbyid", "lastmodifieddate", "lastmodifiedbyid", "systemmodstamp", ...Object.keys(values)];
    const vals = ["$1", "$2", "now()", "$3", "now()", "$3", "now()", ...Object.keys(values).map((_, i) => `$${i + 4}`)];
    await pool.query(`INSERT INTO ${quote(rollupSchema)}.${quote(obj.name.toLowerCase())} (${cols.map(quote).join(", ")}) VALUES (${vals.join(", ")})`, [id, isdeleted, "005000000000001AAA", ...Object.values(values)]);
    return id;
  };

  beforeAll(async () => {
    const full = buildOrgSchema(await loadBaseline(), {
      rootDir: "",
      packageDirectories: [],
      objects: [
        sourceObject("Grand__c", [summary("Grand_Total__c", "sum", "Parent__c.Grand__c", "Parent__c.Total__c")]),
        sourceObject("Parent__c", [
          sourceField("Grand__c", "MasterDetail", { referenceTo: "Grand__c", relationshipName: "Parents" }),
          summary("Child_Count__c", "count", "Child__c.Parent__c"),
          summary("Open_Count__c", "count", "Child__c.Parent__c", undefined, [filter("Child__c.Done__c", "equals", "False")]),
          summary("Total__c", "sum", "Child__c.Parent__c", "Child__c.Amount__c"),
          summary("Tagged__c", "count", "Child__c.Parent__c", undefined, [filter("Child__c.Tag__c", "contains", "x_")]),
          summary("Slipped__c", "count", "Child__c.Parent__c", undefined, [filter("Child__c.Due__c", "greaterThan", "", "Child__c.Planned__c")]),
          summary("Not_Alpha__c", "count", "Child__c.Parent__c", undefined, [filter("Child__c.Tag__c", "notEqual", "alpha")]),
          summary("Latest_Due__c", "max", "Child__c.Parent__c", "Child__c.Due__c"),
        ]),
        sourceObject("Child__c", [
          sourceField("Parent__c", "MasterDetail", { referenceTo: "Parent__c", relationshipName: "Children" }),
          sourceField("Amount__c", "Currency", { precision: 16, scale: 2 }),
          sourceField("Done__c", "Checkbox"),
          sourceField("Tag__c", "Text", { length: 40 }),
          sourceField("Due__c", "Date"),
          sourceField("Planned__c", "Date"),
        ]),
      ],
      globalValueSets: [],
      standardValueSets: [],
      warnings: [],
    });
    expect(full.warnings.filter((w) => w.startsWith("UNSUPPORTED:rollup"))).toEqual([]);
    full3 = only3(full.schema, () => true);
    before = only3(full.schema, (f) => f.rollup === undefined);
  });

  afterAll(async () => {
    await pool.query(`DROP SCHEMA IF EXISTS ${quote(rollupSchema)} CASCADE`);
  });

  it("adding roll-up columns to tables with rows backfills them once, lower chain levels first", async () => {
    await migrate(pool, before, { orgSchema: rollupSchema });
    const grand = full3.getObject("Grand__c") as SObjectDef;
    const parent = full3.getObject("Parent__c") as SObjectDef;
    const child = full3.getObject("Child__c") as SObjectDef;
    const g = await insert(grand, {});
    const p1 = await insert(parent, { grand__c: g });
    const p2 = await insert(parent, { grand__c: g });
    await insert(child, { parent__c: p1, amount__c: 10, done__c: false, tag__c: "x_1", due__c: "2026-02-01", planned__c: "2026-01-01" });
    await insert(child, { parent__c: p1, amount__c: 5, done__c: true, tag__c: "xa", due__c: "2026-01-01", planned__c: "2026-01-01" });
    await insert(child, { parent__c: p1, amount__c: 100, done__c: false, tag__c: "alpha", isdeleted: true });

    const up = await migrate(pool, full3, { orgSchema: rollupSchema });
    expect(up.warnings).toEqual([]);
    const updates = up.statements.filter((s) => s.startsWith(`UPDATE "${rollupSchema}"."`));
    expect(updates).toHaveLength(8);
    expect(up.statements.findIndex((s) => s.includes(`SET "grand_total__c"`))).toBeGreaterThan(up.statements.findIndex((s) => s.includes(`SET "total__c"`)));

    const parents = await pool.query<Record<string, unknown>>(
      `SELECT id, child_count__c, open_count__c, total__c, tagged__c, slipped__c, not_alpha__c, latest_due__c FROM ${quote(rollupSchema)}."parent__c" ORDER BY id`,
    );
    const byId = new Map(parents.rows.map((r) => [r["id"], r]));
    expect(byId.get(p1)).toEqual({ id: p1, child_count__c: 2, open_count__c: 1, total__c: 15, tagged__c: 1, slipped__c: 1, not_alpha__c: 2, latest_due__c: "2026-02-01" });
    expect(byId.get(p2)).toEqual({ id: p2, child_count__c: 0, open_count__c: 0, total__c: 0, tagged__c: 0, slipped__c: 0, not_alpha__c: 0, latest_due__c: null });
    const grands = await pool.query<{ grand_total__c: number }>(`SELECT grand_total__c FROM ${quote(rollupSchema)}."grand__c" WHERE id = $1`, [g]);
    expect(grands.rows[0]?.grand_total__c).toBe(15);
  });

  it("a second migrate runs no backfill", async () => {
    const again = await migrate(pool, full3, { orgSchema: rollupSchema });
    expect(again.warnings).toEqual([]);
    expect(again.statements.filter((s) => s.startsWith("UPDATE"))).toEqual([]);
  });
});
