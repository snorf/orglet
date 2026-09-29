import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { loadOrgSchema, OrgSchemaImpl, type FieldDef, type SObjectDef } from "@orglet/metadata";
import { createPool, databaseUrlFromEnv, type Pool } from "./db.js";
import { migrate } from "./migrate.js";
import { quote } from "./columns.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));

// Each run gets its own Postgres schema so tests never touch each other or a dev org.
const orgSchema = `test_${randomBytes(4).toString("hex")}`;
let pool: Pool;

beforeAll(async () => {
  pool = createPool(databaseUrlFromEnv());
  try {
    await pool.query("SELECT 1");
  } catch (err) {
    throw new Error(`Postgres not reachable at ${databaseUrlFromEnv()} (run \`pnpm db:up\`): ${String(err)}`);
  }
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${quote(orgSchema)} CASCADE`);
  await pool.end();
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
