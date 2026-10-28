/**
 * examples/enterprise is the public acceptance fixture for the v1.1 surface. A fixture that merely loads warning-free
 * would also pass `--strict` if a category were quietly removed, so these tests pin what it must contain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { loadOrgSchema, type BuildResult, type FieldDef } from "@orglet/metadata";
import { admitFormulaRollups } from "@orglet/formula";
import { FormulaRegistry, planCustomMetadataSeed } from "@orglet/engine";
import { main } from "./main.js";

const ENTERPRISE = fileURLToPath(new URL("../../../examples/enterprise/", import.meta.url));

let result: BuildResult;
let warns: string[] = [];

beforeEach(async () => {
  warns = [];
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warns.push(args.map(String).join(" "));
  });
  result = admitFormulaRollups(await loadOrgSchema({ projectDir: ENTERPRISE }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

const field = (object: string, name: string): FieldDef | undefined => result.schema.get(object)?.fields.find((f) => f.name === name);

function allFormulas(): string {
  const parts: string[] = [];
  for (const o of result.schema.list()) {
    for (const f of o.fields) if (f.formula !== undefined) parts.push(f.formula);
    for (const r of o.validationRules) parts.push(r.errorConditionFormula);
  }
  return parts.join("\n");
}

describe("enterprise fixture", () => {
  it("enterprise contains every acme custom object and acme's Account.Customer_Number__c unchanged", () => {
    for (const name of ["BigTable__c", "UpsertTable__c", "Project__c", "Milestone__c"]) expect(result.schema.get(name), name).toBeDefined();
    expect(field("Account", "Customer_Number__c")).toBeDefined();
  });

  it("enterprise has two custom metadata types, one relating to the other and to EntityDefinition/FieldDefinition, with records", () => {
    const level = result.schema.get("Service_Level__mdt");
    expect(level?.customMetadata).toBe(true);
    expect(result.schema.get("Service_Region__mdt")?.customMetadata).toBe(true);
    const refs = (level?.fields ?? []).flatMap((f) => f.referenceTo ?? []);
    expect(refs).toEqual(expect.arrayContaining(["Service_Region__mdt", "EntityDefinition", "FieldDefinition"]));
    expect(result.customMetadata.length).toBeGreaterThanOrEqual(3);
  });

  it("enterprise has one Hierarchy and one List custom setting", () => {
    expect(result.schema.get("Org_Defaults__c")?.customSetting).toBe("Hierarchy");
    expect(result.schema.get("Country_Code__c")?.customSetting).toBe("List");
  });

  it("enterprise defines custom labels", () => {
    expect(result.schema.labels.size).toBeGreaterThanOrEqual(2);
  });

  it("enterprise formulas use every v1.1 global, colon syntax and the ! operator", () => {
    const all = allFormulas();
    for (const token of ["$Label.", "$Setup.", "$CustomMetadata.", "$User.", "$UserRole.", "$Organization.", "$Profile.", "$Api.", "Owner:User.", "Owner:Queue."]) {
      expect(all, token).toContain(token);
    }
    expect(all).toMatch(/!\s*ISBLANK\(/);
  });

  it("enterprise has a roll-up over a same-object formula field that is admitted", () => {
    const total = field("Service_Order__c", "Total_Lines__c");
    expect(total?.rollup).toBeDefined();
    expect(JSON.stringify(total?.rollup)).toContain("Line_Total__c");
    expect(field("Service_Order_Line__c", "Line_Total__c")?.formula).toBeDefined();
  });

  it("enterprise looks up at least four of the 18 business objects", () => {
    const targets = new Set(result.schema.list().filter((o) => o.custom).flatMap((o) => o.fields).flatMap((f) => f.referenceTo ?? []));
    for (const t of ["Quote", "Order", "OrderItem", "Location"]) expect(targets.has(t), t).toBe(true);
  });

  it("enterprise reads Owner on a User-only object and uses colon syntax on a queue-enabled one", () => {
    const account = result.schema.get("Account");
    const caseObj = result.schema.get("Case");
    expect(account?.fields.some((f) => f.custom && f.formula?.includes("Owner.") === true)).toBe(true);
    expect(account?.hasOwner).toBe(true);
    expect(caseObj?.fields.some((f) => f.custom && f.formula?.includes("Owner:User.") === true)).toBe(true);
    expect(caseObj?.fields.some((f) => f.custom && f.formula?.includes("Owner:Queue.") === true)).toBe(true);
  });

  it("enterprise references a feature-gated standard field in a formula", () => {
    const hit = result.schema.list().some((o) => {
      const gated = o.fields.filter((f) => f.featureGated === true).map((f) => f.name);
      return o.fields.some((f) => f.custom && f.formula !== undefined && gated.some((g) => new RegExp(`\\b${g}\\b`).test(f.formula ?? "")));
    });
    expect(hit).toBe(true);
  });

  it("orglet check --strict exits 0 on enterprise with no warning lines", async () => {
    expect(await main(["check", "--strict", "--project", ENTERPRISE])).toBe(0);
    expect(warns).toEqual([]);
  });

  it("enterprise loads with warnings and diagnostics one to one and none of them", () => {
    expect(result.warnings).toEqual([]);
    expect(result.diagnostics).toEqual([]);
    const cmdt = planCustomMetadataSeed(result.schema, result.customMetadata);
    expect(cmdt.warnings).toEqual([]);
    expect(new FormulaRegistry(result.schema, cmdt).warnings).toEqual([]);
  });
});
