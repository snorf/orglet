// Unit tests for the Phase 12 formula globals: $Label and $CustomMetadata resolve at compile time.
import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { loadOrgSchema, type OrgSchema } from "@orglet/metadata";
import { compileFormula, type FormulaContextId } from "./compile.js";
import type { CustomMetadataValues } from "./compile.js";
import { evaluateCompiled } from "./evaluate.js";

const PROJECT = fileURLToPath(new URL("../../../conformance/cmdt-check/project/", import.meta.url));
let schema: OrgSchema;

const CMT: CustomMetadataValues = new Map([
  ["support_tier__mdt", new Map([["gold", { DeveloperName: "Gold", Code__c: "007", Max_Seats__c: 50, Is_Active__c: true, Region__c: "EMEA" }]])],
]);

beforeAll(async () => {
  schema = (await loadOrgSchema({ projectDir: PROJECT })).schema;
});

const f = (source: string, context: FormulaContextId = "formula_field", customMetadata: CustomMetadataValues | null = CMT) =>
  compileFormula(source, { schema, objectName: "Ticket__c", context, ...(customMetadata ? { customMetadata } : {}) });
const value = (source: string, context: FormulaContextId = "formula_field") => evaluateCompiled(f(source, context), { record: {}, isNew: true }).value;

describe("$Label", () => {
  it("evaluates to the master value", () => {
    expect(value("$Label.Terms_Link_Text")).toBe("Terms & Conditions <v2>");
  });

  it("matches the label name case-insensitively and keys it by its declared name", () => {
    expect(f("$label.terms_link_text").references.map((r) => r.key)).toEqual(["$Label.Terms_Link_Text"]);
  });

  it("uses the first definition when two labels differ only by case", () => {
    expect(value("$Label.Welcome_Message")).toBe("Welcome to the support portal");
  });

  it("rejects an unknown label with the generic wording", () => {
    expect(() => f("$Label.Nope")).toThrow("Field $Label.Nope does not exist. Check spelling.");
  });

  it("rejects the namespaced form", () => {
    expect(() => f("$Label.ns.Welcome_Message")).toThrow("does not exist");
  });
});

describe("$CustomMetadata", () => {
  it("keeps text values as written, leading zeros included", () => {
    expect(value("$CustomMetadata.Support_Tier__mdt.Gold.Code__c")).toBe("007");
  });

  it("evaluates number and checkbox fields by their declared type", () => {
    expect(value("$CustomMetadata.Support_Tier__mdt.Gold.Max_Seats__c * 2")).toBe(100);
    expect(value("$CustomMetadata.Support_Tier__mdt.Gold.Is_Active__c", "validation_rule")).toBe(true);
  });

  it("canonicalises the reference key regardless of how the formula spells it", () => {
    expect(f("$customMetadata.support_tier__mdt.gold.code__c").references.map((r) => r.key)).toEqual(["$CustomMetadata.Support_Tier__mdt.Gold.Code__c"]);
  });

  it.each([
    ["unknown type", "$CustomMetadata.Nope__mdt.Gold.Code__c"],
    ["non-mdt object", "$CustomMetadata.Ticket__c.Gold.Priority__c"],
    ["unknown field", "$CustomMetadata.Support_Tier__mdt.Gold.Nope__c"],
    ["relationship spanning (five segments)", "$CustomMetadata.Support_Tier__mdt.Gold.Tier_Group__r.DeveloperName"],
    ["missing field segment", "$CustomMetadata.Support_Tier__mdt.Gold"],
  ])("fails to compile on %s with the generic wording", (_name, source) => {
    expect(() => f(source)).toThrow(/^Field \$CustomMetadata\..* does not exist\. Check spelling\.$/);
  });

  it("compiles an unknown record, evaluates it blank and warns", () => {
    const compiled = f("$CustomMetadata.Support_Tier__mdt.Platinum.Code__c");
    expect(evaluateCompiled(compiled, { record: {}, isNew: true }).value).toBeNull();
    expect(compiled.warnings).toEqual([
      { area: "custom-metadata-record", message: "references custom metadata records that do not exist (Support_Tier__mdt.Platinum); those references evaluate blank" },
    ]);
  });

  it("aggregates every missing record of a formula into one sorted warning", () => {
    const compiled = f(
      "ISBLANK($CustomMetadata.Support_Tier__mdt.Platinum.Code__c) && ISBLANK($CustomMetadata.Support_Tier__mdt.Platinum.Region__c) && ISBLANK($CustomMetadata.Support_Tier__mdt.Diamond.Code__c)",
      "validation_rule",
    );
    expect(compiled.warnings).toHaveLength(1);
    expect(compiled.warnings[0]?.message).toContain("(Support_Tier__mdt.Diamond, Support_Tier__mdt.Platinum)");
  });

  it("never crashes without a custom-metadata map: the record is unknown", () => {
    const compiled = f("$CustomMetadata.Support_Tier__mdt.Gold.Code__c", "formula_field", null);
    expect(evaluateCompiled(compiled, { record: {}, isNew: true }).value).toBeNull();
    expect(compiled.warnings).toHaveLength(1);
  });
});

describe("dependencies and warnings", () => {
  it("lists both globals and is not volatile", () => {
    const d = f("$Label.Terms_Link_Text & $CustomMetadata.Support_Tier__mdt.Gold.Code__c").dependencies;
    expect(d.globals).toEqual(["$CustomMetadata", "$Label"]);
    expect(d.volatile).toBe(false);
  });

  it("has no warnings when no custom-metadata record is missing", () => {
    expect(f("'x'").warnings).toEqual([]);
  });
});
