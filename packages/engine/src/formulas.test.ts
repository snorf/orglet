/**
 * Proves the engine package's formula failures are structured records that sit beside the unchanged
 * warning strings (D-16): same order, same bytes, plus the missing reference as data.
 */
import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { formatDiagnostic, loadOrgSchema, OrgSchemaImpl, type FieldDef, type SObjectDef } from "@orglet/metadata";
import { FormulaRegistry } from "./formulas.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));

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
