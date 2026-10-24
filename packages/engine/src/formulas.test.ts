/**
 * Proves the engine package's formula failures are structured records that sit beside the unchanged
 * warning strings (D-16): same order, same bytes, plus the missing reference as data.
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { formatDiagnostic, loadOrgSchema, OrgSchemaImpl, type FieldDef, type SObjectDef } from "@orglet/metadata";
import { applyFormulaFields, FormulaRegistry } from "./formulas.js";
import { planCustomMetadataSeed } from "./seed.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));
const CMDT = fileURLToPath(new URL("../../../conformance/cmdt-check/project/", import.meta.url));

describe("FormulaRegistry diagnostics", () => {
  it("a formula that does not compile is a FormulaFailure record beside the unchanged warning string", async () => {
    const { schema } = await loadOrgSchema({ projectDir: ACME });
    const account = schema.getObject("Account") as SObjectDef;
    const template = account.fields.find((f) => f.name === "Name") as FieldDef;
    const broken: SObjectDef = {
      ...account,
      validationRules: [
        ...account.validationRules,
        { name: "Broken", active: true, errorConditionFormula: "ISBLANK(Nope__c)", errorMessage: "broken" },
      ],
      fields: [...account.fields, { ...template, name: "X__c", label: "X", type: "Number", formula: "Nope__c + 1" }],
    };
    const objects = new Map(schema.objects);
    objects.set("account", broken);
    const registry = new FormulaRegistry(new OrgSchemaImpl(objects, schema.globalValueSets, schema.standardValueSets));

    expect(registry.warnings).toContain("UNSUPPORTED:formula validation rule Account.Broken skipped: Field Nope__c does not exist. Check spelling.");
    expect(registry.diagnostics).toContainEqual({
      area: "formula",
      what: "validation rule Account.Broken",
      object: "Account",
      message: "validation rule Account.Broken skipped: Field Nope__c does not exist. Check spelling.",
      missing: { object: "Account", field: "Nope__c" },
    });
    expect(registry.diagnostics).toContainEqual(
      expect.objectContaining({ what: "formula field Account.X__c", field: "X__c", missing: { object: "Account", field: "Nope__c" } }),
    );
    expect(registry.warnings).toEqual(registry.diagnostics.map(formatDiagnostic));
  });

  it("a schema whose formulas all compile has no diagnostics", async () => {
    const { schema } = await loadOrgSchema({ projectDir: ACME });
    expect(new FormulaRegistry(schema).diagnostics).toEqual([]);
  });
});

describe("FormulaRegistry dependencies", () => {
  async function extended() {
    const { schema } = await loadOrgSchema({ projectDir: ACME });
    const account = schema.getObject("Account") as SObjectDef;
    const template = account.fields.find((f) => f.name === "Name") as FieldDef;
    const obj: SObjectDef = {
      ...account,
      validationRules: [...account.validationRules, { name: "Uses_User", active: true, errorConditionFormula: "$User.Alias = 'x'", errorMessage: "m" }],
      fields: [...account.fields, { ...template, name: "Owner_Alias__c", label: "Owner Alias", type: "Text", formula: "Owner.Alias" }],
    };
    const objects = new Map(schema.objects);
    objects.set("account", obj);
    return { obj, registry: new FormulaRegistry(new OrgSchemaImpl(objects, schema.globalValueSets, schema.standardValueSets, schema.labels)) };
  }

  it("the registry exposes each formula field's and rule's dependency list", async () => {
    const { obj, registry } = await extended();
    const compiled = registry.formulaFields(obj).find((f) => f.field.name === "Owner_Alias__c")?.compiled;
    expect(compiled).toBeDefined();
    expect(registry.fieldDependencies(obj, "owner_alias__c")).toEqual(compiled?.dependencies);
    expect(registry.fieldDependencies(obj, "owner_alias__c")?.fields).toEqual([
      { object: "Account", path: [], fields: ["OwnerId"] },
      { object: "User", path: ["Owner"], fields: ["Alias"] },
    ]);
    expect(registry.ruleDependencies(obj, "Uses_User")?.globals).toEqual(["$User"]);
    expect(registry.fieldDependencies(obj, "Nope__c")).toBeUndefined();
    expect(registry.ruleDependencies(obj, "Nope")).toBeUndefined();
  });

  it("usesGlobal is true only for roots some compiled formula reads", async () => {
    const { registry } = await extended();
    expect(registry.usesGlobal("$User")).toBe(true);
    const { schema } = await loadOrgSchema({ projectDir: ACME });
    const plain = new FormulaRegistry(schema);
    for (const root of ["$UserRole", "$Setup", "$Api"] as const) expect(plain.usesGlobal(root)).toBe(false);
  });
});

describe("custom metadata and labels in the registry", () => {
  async function extended() {
    const built = await loadOrgSchema({ projectDir: CMDT });
    const ticket = built.schema.getObject("Ticket__c") as SObjectDef;
    const template = ticket.fields.find((f) => f.name === "Priority__c") as FieldDef;
    const formulaField = (name: string, formula: string): FieldDef => ({ ...template, name, label: name, type: "Text", formula });
    const obj: SObjectDef = {
      ...ticket,
      validationRules: [
        ...ticket.validationRules,
        {
          name: "Missing_Twice",
          active: true,
          errorConditionFormula: "ISBLANK($CustomMetadata.Support_Tier__mdt.Platinum.Code__c) && ISBLANK($CustomMetadata.Support_Tier__mdt.Platinum.Region__c)",
          errorMessage: "m",
        },
      ],
      fields: [
        ...ticket.fields,
        formulaField("Tier_Code__c", "$CustomMetadata.Support_Tier__mdt.Gold.Code__c"),
        formulaField("Missing_Tier__c", "$CustomMetadata.Support_Tier__mdt.Platinum.Code__c"),
        formulaField("Terms__c", "$Label.Terms_Link_Text"),
      ],
    };
    const objects = new Map(built.schema.objects);
    objects.set("ticket__c", obj);
    const schema = new OrgSchemaImpl(objects, built.schema.globalValueSets, built.schema.standardValueSets, built.schema.labels);
    return { built, schema, obj, plan: planCustomMetadataSeed(schema, built.customMetadata) };
  }

  const MISSING = (what: string) => `UNSUPPORTED:custom-metadata-record ${what} references custom metadata records that do not exist (Support_Tier__mdt.Platinum); those references evaluate blank`;

  it("warns once per formula that names a missing record, in step with the structured diagnostics", async () => {
    const { schema, plan } = await extended();
    const registry = new FormulaRegistry(schema, plan);
    expect(registry.warnings).toHaveLength(2);
    expect(registry.warnings).toEqual(expect.arrayContaining([MISSING("formula field Ticket__c.Missing_Tier__c"), MISSING("validation rule Ticket__c.Missing_Twice")]));
    expect(registry.diagnostics).toContainEqual({
      area: "custom-metadata-record",
      what: "formula field Ticket__c.Missing_Tier__c",
      object: "Ticket__c",
      field: "Missing_Tier__c",
      message: "formula field Ticket__c.Missing_Tier__c references custom metadata records that do not exist (Support_Tier__mdt.Platinum); those references evaluate blank",
    });
    expect(registry.warnings).toEqual(registry.diagnostics.map(formatDiagnostic));
  });

  it("computes loaded records and labels and leaves a missing record blank", async () => {
    const { schema, obj, plan } = await extended();
    const record: Record<string, string | number | boolean | null> = {};
    applyFormulaFields(new FormulaRegistry(schema, plan), obj, record, {});
    expect(record["Tier_Code__c"]).toBe("007");
    expect(record["Missing_Tier__c"]).toBeNull();
    expect(record["Terms__c"]).toBe("Terms & Conditions <v2>");
  });

  it("still compiles every formula without a plan, treating each record as unknown", async () => {
    const { schema, obj } = await extended();
    const registry = new FormulaRegistry(schema);
    expect(registry.formulaFields(obj).map((f) => f.field.name)).toEqual(expect.arrayContaining(["Tier_Code__c", "Missing_Tier__c", "Terms__c"]));
    const record: Record<string, string | number | boolean | null> = {};
    applyFormulaFields(registry, obj, record, {});
    expect(record["Tier_Code__c"]).toBeNull();
    expect(registry.warnings).toContain(MISSING("formula field Ticket__c.Tier_Code__c").replace("Platinum", "Gold"));
  });

  it("has no diagnostics for the unmodified fixture", async () => {
    const { built } = await extended();
    expect(new FormulaRegistry(built.schema, planCustomMetadataSeed(built.schema, built.customMetadata)).diagnostics).toEqual([]);
  });
});

describe("formula evaluation order", () => {
  async function withFormulas(extra: { name: string; formula: string }[]) {
    const { schema } = await loadOrgSchema({ projectDir: ACME });
    const account = schema.getObject("Account") as SObjectDef;
    const template = account.fields.find((f) => f.name === "Name") as FieldDef;
    const obj: SObjectDef = {
      ...account,
      fields: [...account.fields, ...extra.map((e) => ({ ...template, name: e.name, label: e.name, type: "Number" as const, formula: e.formula }))],
    };
    const objects = new Map(schema.objects);
    objects.set("account", obj);
    return { obj, registry: new FormulaRegistry(new OrgSchemaImpl(objects, schema.globalValueSets, schema.standardValueSets, schema.labels)) };
  }

  it("a formula declared before the formula it reads evaluates against the fresh value", async () => {
    const { obj, registry } = await withFormulas([
      { name: "Plus_One__c", formula: "Doubled__c + 1" },
      { name: "Doubled__c", formula: "NumberOfEmployees * 2" },
    ]);
    const names = registry.formulaFields(obj).map((c) => c.field.name);
    expect(names.indexOf("Doubled__c")).toBeLessThan(names.indexOf("Plus_One__c"));
    const record: Record<string, unknown> = { NumberOfEmployees: 3 };
    applyFormulaFields(registry, obj, record as never, {});
    expect(record["Doubled__c"]).toBe(6);
    expect(record["Plus_One__c"]).toBe(7);
  });

  it("evaluates only the requested formula fields when a subset is given", async () => {
    const { obj, registry } = await withFormulas([
      { name: "Plus_One__c", formula: "Doubled__c + 1" },
      { name: "Doubled__c", formula: "NumberOfEmployees * 2" },
    ]);
    const record: Record<string, unknown> = { NumberOfEmployees: 3 };
    applyFormulaFields(registry, obj, record as never, {}, new Set(["doubled__c"]));
    expect(record["Doubled__c"]).toBe(6);
    expect("Plus_One__c" in record).toBe(false);
  });

  it("formula fields that read each other do not hang the registry", async () => {
    const { obj, registry } = await withFormulas([
      { name: "Loop_A__c", formula: "Loop_B__c + 1" },
      { name: "Loop_B__c", formula: "Loop_A__c + 1" },
      { name: "Fine__c", formula: "NumberOfEmployees + 1" },
    ]);
    const names = registry.formulaFields(obj).map((c) => c.field.name);
    expect(names).toContain("Fine__c");
    for (const n of ["Loop_A__c", "Loop_B__c"]) if (names.includes(n)) expect(names.indexOf(n)).toBeGreaterThan(names.indexOf("Fine__c"));
  });
});
