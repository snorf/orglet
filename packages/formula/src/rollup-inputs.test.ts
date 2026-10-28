import { beforeAll, describe, expect, it } from "vitest";
import { buildOrgSchema, loadBaseline, type FieldType, type OrgSchema, type SourceField, type SourceObject } from "@orglet/metadata";
import type { FormulaDependencies } from "./compile.js";
import { dependencyOrder, formulaInputs, type FormulaLookup, type OrderableFormula } from "./rollup-inputs.js";

const sourceField = (fullName: string, type: FieldType, extra: Partial<SourceField> = {}): SourceField => ({ fullName, label: fullName, type, ...extra });
const sourceObject = (name: string, fields: SourceField[]): SourceObject => ({ name, fields, validationRules: [], recordTypes: [] });
const formula = (name: string): SourceField => sourceField(name, "Number", { precision: 18, scale: 2, formula: "1" });

const deps = (...fields: string[]): FormulaDependencies => ({ fields: [{ object: "Child__c", path: [], fields }], globals: [], volatile: false });

let schema: OrgSchema;
const table = new Map<string, FormulaDependencies>([
  ["child__c.inner__c", deps("Qty__c")],
  ["child__c.outer__c", deps("Inner__c", "Price__c")],
  ["child__c.line__c", { fields: [{ object: "Child__c", path: [], fields: ["Price__c", "Qty__c"] }, { object: "Account", path: ["Account__r"], fields: ["Rating"] }], globals: [], volatile: false }],
  ["child__c.loop_a__c", deps("Loop_B__c")],
  ["child__c.loop_b__c", deps("Loop_A__c")],
  ["child__c.uses_rollup__c", deps("Rollup__c")],
]);
const lookup: FormulaLookup = (object, field) => table.get(`${object.toLowerCase()}.${field.toLowerCase()}`);

beforeAll(async () => {
  const objects = [
    sourceObject("Child__c", [
      sourceField("Qty__c", "Number", { precision: 10, scale: 0 }),
      sourceField("Price__c", "Currency", { precision: 16, scale: 2 }),
      ...["Inner__c", "Outer__c", "Line__c", "Loop_A__c", "Loop_B__c", "Uses_Rollup__c", "Broken__c"].map(formula),
      { fullName: "Rollup__c", label: "Rollup__c", type: "Summary", summaryForeignKey: "Sub__c.Child__c", summaryOperation: "count" },
    ]),
    sourceObject("Sub__c", [sourceField("Child__c", "MasterDetail", { referenceTo: "Child__c", relationshipName: "Subs" })]),
  ];
  const built = buildOrgSchema(await loadBaseline(), { rootDir: "", packageDirectories: [], objects, globalValueSets: [], standardValueSets: [], warnings: [] });
  expect(built.warnings.filter((w) => w.startsWith("UNSUPPORTED:rollup"))).toEqual([]);
  schema = built.schema;
});

describe("formulaInputs", () => {
  it("a stored field is its own only input", () => {
    expect(formulaInputs(schema, lookup, "Child__c", "qty__c")).toEqual({ stored: ["Qty__c"], formulas: [] });
  });
  it("follows formula-on-formula down to stored fields, inner formulas first", () => {
    expect(formulaInputs(schema, lookup, "Child__c", "Outer__c")).toEqual({ stored: ["Price__c", "Qty__c"], formulas: ["Inner__c", "Outer__c"] });
  });
  it("cross-object entries are not followed", () => {
    expect(formulaInputs(schema, lookup, "Child__c", "Line__c").stored).toEqual(["Price__c", "Qty__c"]);
  });
  it("a roll-up column read by a formula is a stored input", () => {
    expect(formulaInputs(schema, lookup, "Child__c", "Uses_Rollup__c").stored).toEqual(["Rollup__c"]);
  });
  it("a formula cycle is reported as a path and the walk terminates", () => {
    const r = formulaInputs(schema, lookup, "Child__c", "Loop_A__c");
    expect(r.cycle).toBe("Child__c.Loop_A__c -> Child__c.Loop_B__c -> Child__c.Loop_A__c");
    expect(r.formulas).toContain("Loop_A__c");
    expect(r.formulas).toContain("Loop_B__c");
  });
  it("a formula that did not compile is listed but not followed", () => {
    expect(formulaInputs(schema, lookup, "Child__c", "Broken__c")).toEqual({ stored: [], formulas: ["Broken__c"] });
  });
});

const item = (name: string, ...reads: string[]): OrderableFormula => ({ field: { name }, compiled: { dependencies: deps(...reads) } });
const names = (xs: OrderableFormula[]): string[] => xs.map((x) => x.field.name);

describe("dependencyOrder", () => {
  it("orders a formula after the formula it reads regardless of declaration order", () => {
    const a = item("A__c", "B__c");
    const b = item("B__c", "Qty__c");
    const out = dependencyOrder([a, b]);
    expect(out[0]).toBe(b);
    expect(out[1]).toBe(a);
  });
  it("keeps declaration order for independent formulas", () => {
    const xs = [item("X__c", "Qty__c"), item("Y__c"), item("Z__c", "Price__c")];
    const out = dependencyOrder(xs);
    xs.forEach((x, i) => expect(out[i]).toBe(x));
  });
  it("puts the members of a residual cycle last in declaration order and does not loop", () => {
    const l1 = item("L1", "L2");
    const c = item("C", "Qty__c");
    const l2 = item("L2", "L1");
    expect(dependencyOrder([l1, c, l2])).toEqual([c, l1, l2]);
    expect(names(dependencyOrder([l1, c, l2]))).toEqual(["C", "L1", "L2"]);
  });
  it("ignores cross-object reads and reads of stored fields", () => {
    const a: OrderableFormula = {
      field: { name: "A__c" },
      compiled: { dependencies: { fields: [{ object: "Account", path: ["Account__r"], fields: ["X__c"] }], globals: [], volatile: false } },
    };
    const x = item("X__c");
    const out = dependencyOrder([a, x]);
    expect(out[0]).toBe(a);
    expect(out[1]).toBe(x);
  });
  it("matches names case-insensitively", () => {
    const a = item("A__c", "b__c");
    const b = item("B__c");
    const out = dependencyOrder([a, b]);
    expect(out[0]).toBe(b);
    expect(out[1]).toBe(a);
  });
});
