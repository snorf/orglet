/** FORM-03 ($UserRole) and FORM-05 ($Setup) at runtime on conformance/cmdt-check/project. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { formatDiagnostic, loadOrgSchema, OrgSchemaImpl, type FieldDef, type OrgSchema, type SObjectDef, type ValidationRuleDef } from "@orglet/metadata";
import { migrate, quote, reconcileKeyPrefixes, dropKeyPrefixes, type Pool } from "@orglet/schema";
import { openTestDb, type TestDb } from "../../../test/db.js";
import { bootstrapOrg } from "./bootstrap.js";
import { DmlEngine } from "./engine.js";
import { FormulaRegistry } from "./formulas.js";
import type { Session } from "./hooks.js";

const PROJECT = fileURLToPath(new URL("../../../conformance/cmdt-check/project/", import.meta.url));

interface Fixture {
  testDb: TestDb;
  pool: Pool;
  orgSchema: string;
  engine: DmlEngine;
  session: Session;
}

const formula = (template: FieldDef, name: string, type: FieldDef["type"], expr: string): FieldDef => ({
  ...template,
  name,
  label: name,
  type,
  formula: expr,
  ...(type === "Text" ? { length: 255 } : {}),
  formulaTreatBlanksAs: "BlankAsBlank",
});

function extend(base: OrgSchema, change: (o: SObjectDef, template: FieldDef) => SObjectDef): OrgSchema {
  const obj = base.getObject("Ticket__c") as SObjectDef;
  const template = obj.fields.find((f) => f.name === "Name") as FieldDef;
  const objects = new Map(base.objects);
  objects.set("ticket__c", change(obj, template));
  return new OrgSchemaImpl(objects, base.globalValueSets, base.standardValueSets, base.labels);
}

const withFormulas = (base: OrgSchema): OrgSchema =>
  extend(base, (o, t) => ({
    ...o,
    fields: [
      ...o.fields,
      formula(t, "Role_Name__c", "Text", "$UserRole.Name"),
      formula(t, "Cfg_Endpoint__c", "Text", "$Setup.App_Config__c.Endpoint__c"),
      formula(t, "Cfg_Flag__c", "Checkbox", "$Setup.App_Config__c.Feature_Enabled__c"),
    ],
  }));

async function setup(extendSchema: (base: OrgSchema) => OrgSchema): Promise<Fixture> {
  const testDb = await openTestDb();
  const pool = testDb.pool;
  const orgSchema = `test_${randomBytes(4).toString("hex")}`;
  const schema = extendSchema((await loadOrgSchema({ projectDir: PROJECT })).schema);
  await reconcileKeyPrefixes(pool, schema, { orgSchema });
  await migrate(pool, schema, { orgSchema });
  const session = (await bootstrapOrg(pool, schema, { orgSchema })).session;
  return { testDb, pool, orgSchema, engine: new DmlEngine(pool, schema, { orgSchema }), session };
}

async function teardown(f: Fixture): Promise<void> {
  await dropKeyPrefixes(f.pool, f.orgSchema);
  await f.pool.query(`DROP SCHEMA IF EXISTS ${quote(f.orgSchema)} CASCADE`);
  await f.testDb.close();
}

const insert = async (f: Fixture, sobject: string, input: Record<string, unknown>) => {
  const [r] = await f.engine.insert(f.session, sobject, [input]);
  if (!r?.success) throw new Error(JSON.stringify(r?.errors));
  return r.id as string;
};

const read = async (f: Fixture, id: string) => (await f.engine.retrieve(f.session, "Ticket__c", [id])).get(id);

describe("$UserRole and $Setup at runtime", () => {
  let f: Fixture;
  let ticket = "";

  beforeAll(async () => {
    f = await setup(withFormulas);
    ticket = await insert(f, "Ticket__c", { Name: "T-1" });
  });
  afterAll(() => teardown(f));

  it("a user without a role reads every $UserRole field as blank", async () => {
    expect((await read(f, ticket))?.["Role_Name__c"] ?? null).toBeNull();
  });

  it("a user with a role reads it through $UserRole", async () => {
    const roleId = await insert(f, "UserRole", { Name: "Support Lead", DeveloperName: "Support_Lead", OpportunityAccessForAccountOwner: "None" });
    const [u] = await f.engine.update(f.session, "User", [{ Id: f.session.userId, UserRoleId: roleId }]);
    expect(u?.success).toBe(true);
    expect((await read(f, ticket))?.["Role_Name__c"]).toBe("Support Lead");
  });

  it("with no App_Config__c rows every $Setup field is blank", async () => {
    const t = await read(f, ticket);
    expect(t?.["Cfg_Endpoint__c"] ?? null).toBeNull();
    expect(t?.["Cfg_Flag__c"]).not.toBe(true);
  });

  it("hierarchy settings resolve user, then profile, then organization, per field", async () => {
    await insert(f, "App_Config__c", { SetupOwnerId: f.session.organizationId, Endpoint__c: "https://org", Feature_Enabled__c: true });
    let t = await read(f, ticket);
    expect(t?.["Cfg_Endpoint__c"]).toBe("https://org");
    expect(t?.["Cfg_Flag__c"]).toBe(true);

    // A Checkbox always holds a value, so the more specific row's stored false wins; the merge is per defined field.
    await insert(f, "App_Config__c", { SetupOwnerId: f.session.profileId, Endpoint__c: "https://profile" });
    t = await read(f, ticket);
    expect(t?.["Cfg_Endpoint__c"]).toBe("https://profile");
    expect(t?.["Cfg_Flag__c"]).toBe(false);

    await insert(f, "App_Config__c", { SetupOwnerId: f.session.userId, Feature_Enabled__c: true });
    t = await read(f, ticket);
    expect(t?.["Cfg_Endpoint__c"]).toBe("https://profile");
    expect(t?.["Cfg_Flag__c"]).toBe(true);
  });

  it("registry lists the Hierarchy settings formulas read", () => {
    expect(f.engine.formulas.settingsUsed()).toEqual(["App_Config__c"]);
  });
});

describe("gating", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await setup((base) => base);
  });
  afterAll(() => teardown(f));

  it("a schema with no $UserRole/$Setup formula issues no role or setting queries", async () => {
    const findByField = vi.spyOn(f.engine.store, "findByField");
    const loadByIds = vi.spyOn(f.engine.store, "loadByIds");
    const id = await insert(f, "Ticket__c", { Name: "T-1" });
    await f.engine.retrieve(f.session, "Ticket__c", [id]);
    expect(findByField.mock.calls.some((c) => c[1].name === "App_Config__c")).toBe(false);
    expect(loadByIds.mock.calls.some((c) => c[1].name === "UserRole")).toBe(false);
  });
});

describe("unsupported globals", () => {
  it("List settings and $Permission stay unsupported with the reason", async () => {
    const base = (await loadOrgSchema({ projectDir: PROJECT })).schema;
    const rule = (name: string, expr: string): ValidationRuleDef => ({ name, active: true, errorConditionFormula: expr, errorMessage: "x" });
    const schema = extend(base, (o) => ({
      ...o,
      validationRules: [...o.validationRules, rule("Uses_List", "$Setup.Region_List__c.Region_Code__c = 'x'"), rule("Uses_Permission", "$Permission.Can_Approve")],
    }));
    const registry = new FormulaRegistry(schema);
    expect(registry.warnings).toContain(
      "UNSUPPORTED:formula validation rule Ticket__c.Uses_List skipped: UNSUPPORTED:formula-global $Setup.Region_List__c.Region_Code__c is not available: $Setup is available only for Hierarchy custom settings; List custom settings are accessible only from code",
    );
    expect(registry.warnings.some((w) => w.includes("Ticket__c.Uses_Permission skipped: UNSUPPORTED:formula-global $Permission.Can_Approve is not available: $Permission needs custom permissions"))).toBe(true);
    expect(registry.warnings).toEqual(registry.diagnostics.map(formatDiagnostic));
  });
});

describe("$Api at the engine level", () => {
  let f: Fixture;
  const WARN = "without a request context";
  const apiWarnings = () => f.engine.warnings.filter((w) => w.includes(WARN));

  beforeAll(async () => {
    f = await setup((base) =>
      extend(base, (o, t) => ({
        ...o,
        fields: [...o.fields, formula(t, "Api_Session__c", "Text", "$Api.Session_ID"), formula(t, "Api_Partner__c", "Text", "$Api.Partner_Server_URL_600")],
        validationRules: [...o.validationRules, { name: "Api_Rule", active: true, errorConditionFormula: "ISBLANK($Api.Session_ID) && Name = 'never'", errorMessage: "x" }],
      })),
    );
  });
  afterAll(() => teardown(f));

  it("without a request context $Api is blank and warns once per formula", async () => {
    const a = await insert(f, "Ticket__c", { Name: "T-1" });
    const b = await insert(f, "Ticket__c", { Name: "T-2" });
    for (let i = 0; i < 2; i++) {
      const rows = await f.engine.retrieve(f.session, "Ticket__c", [a, b]);
      for (const id of [a, b]) {
        expect(rows.get(id)?.["Api_Session__c"]).toBeNull();
        expect(rows.get(id)?.["Api_Partner__c"]).toBeNull();
      }
    }
    const formulaWarnings = apiWarnings().filter((w) => w.includes("formula field")).sort();
    expect(formulaWarnings).toEqual([
      "UNSUPPORTED:formula-global formula field Ticket__c.Api_Partner__c uses $Api but was evaluated without a request context; $Api values are blank",
      "UNSUPPORTED:formula-global formula field Ticket__c.Api_Session__c uses $Api but was evaluated without a request context; $Api values are blank",
    ]);
    expect(f.engine.warnings).toEqual(f.engine.diagnostics.map(formatDiagnostic));
  });

  it("with a request context $Api reads the request", async () => {
    const id = await insert(f, "Ticket__c", { Name: "T-4" });
    const before = f.engine.warnings.length;
    const rows = await f.engine.retrieve({ ...f.session, request: { baseUrl: "http://h:1", sessionId: "tok" } }, "Ticket__c", [id]);
    expect(rows.get(id)?.["Api_Session__c"]).toBe("tok");
    expect(rows.get(id)?.["Api_Partner__c"]).toBe(`http://h:1/services/Soap/u/60.0/${f.session.organizationId}`);
    expect(f.engine.warnings.length).toBe(before);
  });

  it("a validation rule using $Api does not block a save without a request", async () => {
    await insert(f, "Ticket__c", { Name: "T-3" });
    expect(apiWarnings().filter((w) => w.includes("validation rule Ticket__c.Api_Rule"))).toHaveLength(1);
  });
});
