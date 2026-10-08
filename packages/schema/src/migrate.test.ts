import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { buildOrgSchema, loadBaseline, loadOrgSchema, OrgSchemaImpl, type FieldDef, type OrgSchema, type SObjectDef } from "@orglet/metadata";
import type { Pool } from "./db.js";
import { openTestDb, type TestDb } from "../../../test/db.js";
import { migrate } from "./migrate.js";
import { quote } from "./columns.js";

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
