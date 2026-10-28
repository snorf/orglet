/** Phase 13 admission of roll-ups over formula fields (ROLL2-01, D-01..D-09): which formula roll-ups load, which degrade with UNSUPPORTED:rollup-formula or UNSUPPORTED:rollup-cycle, and that warnings and diagnostics stay 1:1. */
import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import {
  buildOrgSchema,
  formatDiagnostic,
  loadBaseline,
  loadOrgSchema,
  type BuildResult,
  type FieldType,
  type SourceField,
  type SourceFilterItem,
  type SourceObject,
} from "@orglet/metadata";
import { compileFormula, FormulaCompileError } from "./compile.js";
import { admitFormulaRollups } from "./rollup-admission.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));

const field = (fullName: string, type: FieldType, extra: Partial<SourceField> = {}): SourceField => ({ fullName, label: fullName, type, ...extra });
const object = (name: string, fields: SourceField[], extra: Partial<SourceObject> = {}): SourceObject => ({ name, fields, validationRules: [], recordTypes: [], ...extra });
const filter = (f: string, operation: string, value: string, valueField?: string): SourceFilterItem => ({ field: f, operation, value, ...(valueField !== undefined ? { valueField } : {}) });
const summary = (fullName: string, op: string, fk: string, summarized?: string, filters?: SourceFilterItem[]): SourceField => ({
  fullName,
  label: fullName,
  type: "Summary",
  summaryForeignKey: fk,
  summaryOperation: op,
  ...(summarized !== undefined ? { summarizedField: summarized } : {}),
  ...(filters !== undefined ? { summaryFilterItems: filters } : {}),
});
const num = (fullName: string, formula: string): SourceField => field(fullName, "Number", { precision: 18, scale: 0, formula });
const text = (fullName: string, formula: string): SourceField => field(fullName, "Text", { length: 255, formula });
const bool = (fullName: string, formula: string): SourceField => field(fullName, "Checkbox", { formula });
const FK = "Child__c.Parent__c";
const countWhere = (name: string, f: string, value: string): SourceField => summary(name, "count", FK, undefined, [filter(`Child__c.${f}`, "equals", value)]);

const childFields = (): SourceField[] => [
  field("Parent__c", "MasterDetail", { referenceTo: "Parent__c", relationshipName: "Children" }),
  field("Qty__c", "Number", { precision: 10, scale: 0 }),
  field("Price__c", "Currency", { precision: 16, scale: 2 }),
  field("Due__c", "Date"),
  field("Tag__c", "Text", { length: 40 }),
  field("Line__c", "Currency", { precision: 18, scale: 2, formula: "Qty__c * Price__c" }),
  num("Inner__c", "Qty__c * 2"),
  num("Outer__c", "Inner__c + 1"),
  bool("Is_Big__c", "Qty__c > 10"),
  num("Labeled__c", "Qty__c + VALUE($Label.Bonus)"),
  bool("Origin__c", "CreatedDate > $System.OriginDateTime"),
  text("Parent_Rating__c", "Parent__r.Rating__c"),
  field("Age__c", "Number", { precision: 18, scale: 0, formula: "TODAY() - Due__c" }),
  field("Stamp_Now__c", "DateTime", { formula: "NOW()" }),
  text("Clock__c", "TEXT(TIMENOW())"),
  text("Who__c", "$User.Alias"),
  text("Prof__c", "$Profile.Name"),
  text("Org__c", "$Organization.Name"),
  text("Role__c", "$UserRole.Name"),
  text("Api__c", "$Api.Session_ID"),
  text("Setup__c", "$Setup.Cfg__c.Code__c"),
  text("RT__c", "$RecordType.Name"),
  num("Via_Age__c", "Age__c + 1"),
];

const parentRollups = (): SourceField[] => [
  field("Rating__c", "Text", { length: 10 }),
  field("Grand__c", "MasterDetail", { referenceTo: "Grand__c", relationshipName: "Parents" }),
  summary("Sum_Line__c", "sum", FK, "Child__c.Line__c"),
  summary("Max_Inner__c", "max", FK, "Child__c.Inner__c"),
  summary("Count_All__c", "count", FK),
  countWhere("Count_Big__c", "Is_Big__c", "True"),
  summary("Count_Outer__c", "count", FK, undefined, [filter("Child__c.Outer__c", "greaterThan", "", "Child__c.Qty__c")]),
  summary("Sum_Outer__c", "sum", FK, "Child__c.Outer__c"),
  summary("Sum_Labeled__c", "sum", FK, "Child__c.Labeled__c"),
  countWhere("Count_Origin__c", "Origin__c", "True"),
  countWhere("Rated__c", "Parent_Rating__c", "A"),
  summary("Sum_Age__c", "sum", FK, "Child__c.Age__c"),
  summary("Max_Now__c", "max", FK, "Child__c.Stamp_Now__c"),
  countWhere("Count_Clock__c", "Clock__c", "x"),
  countWhere("Count_Who__c", "Who__c", "x"),
  countWhere("Count_Prof__c", "Prof__c", "x"),
  countWhere("Count_Setup__c", "Setup__c", "x"),
  countWhere("Count_Api__c", "Api__c", "x"),
  countWhere("Count_Org__c", "Org__c", "x"),
  countWhere("Count_Role__c", "Role__c", "x"),
  countWhere("Count_RT__c", "RT__c", "x"),
  summary("Sum_Via_Age__c", "sum", FK, "Child__c.Via_Age__c"),
];

const parentObjects = (): SourceObject[] => [
  object("Parent__c", parentRollups()),
  object("Child__c", childFields()),
  object("Grand__c", [summary("Sum_Of_Age_Sum__c", "sum", "Parent__c.Grand__c", "Parent__c.Sum_Age__c")]),
  object("Cfg__c", [field("Code__c", "Text", { length: 20 })], { customSettingsType: "Hierarchy" }),
];
describe("admitFormulaRollups", () => {
  let baseline: Awaited<ReturnType<typeof loadBaseline>>;
  beforeAll(async () => {
    baseline = await loadBaseline();
  });
  const built = (objects: SourceObject[]): BuildResult =>
    buildOrgSchema(baseline, {
      rootDir: "",
      packageDirectories: [],
      objects,
      globalValueSets: [],
      standardValueSets: [],
      warnings: [],
      labels: [{ fullName: "Bonus", value: "5", language: "en_US", protected: false }],
    });
  const admit = (objects: SourceObject[]) => {
    const before = built(objects);
    expect(before.warnings.filter((w) => w.startsWith("UNSUPPORTED:rollup"))).toEqual([]);
    return admitFormulaRollups(before);
  };

  let main: BuildResult;
  beforeAll(() => {
    main = admit(parentObjects());
  });
  const has = (name: string, obj = "Parent__c") => main.schema.getField(obj, name) !== undefined;
  const warningsFor = (name: string, obj = "Parent__c") => main.warnings.filter((w) => w.includes(` ${obj}.${name}: `));

  it("keeps a roll-up over a same-object non-volatile formula", () => {
    for (const n of ["Sum_Line__c", "Max_Inner__c", "Count_All__c"]) expect(has(n)).toBe(true);
    expect(main.warnings.filter((w) => w.startsWith("UNSUPPORTED:rollup") && /Sum_Line|Max_Inner|Count_All/.test(w))).toEqual([]);
  });

  it("keeps a roll-up whose filter or valueField is a same-object formula", () => {
    expect(has("Count_Big__c")).toBe(true);
    expect(has("Count_Outer__c")).toBe(true);
  });

  it("keeps a roll-up over a formula that reads another qualifying formula", () => {
    expect(has("Sum_Outer__c")).toBe(true);
  });

  it("keeps a roll-up over a formula that uses $Label, $CustomMetadata or $System.OriginDateTime", () => {
    expect(has("Sum_Labeled__c")).toBe(true);
    expect(has("Count_Origin__c")).toBe(true);
  });

  it("drops a roll-up over a cross-object formula with UNSUPPORTED:rollup-formula naming the path", () => {
    expect(has("Rated__c")).toBe(false);
    expect(main.warnings).toContain("UNSUPPORTED:rollup-formula Parent__c.Rated__c: Child__c.Parent_Rating__c reads Parent__r.Rating__c (cross-object); field skipped");
  });

  it("drops roll-ups over NOW, TODAY and TIMENOW formulas naming the function", () => {
    const cases: [string, string, string][] = [
      ["Sum_Age__c", "Age__c", "TODAY()"],
      ["Max_Now__c", "Stamp_Now__c", "NOW()"],
      ["Count_Clock__c", "Clock__c", "TIMENOW()"],
    ];
    for (const [roll, formula, fn] of cases) {
      expect(has(roll)).toBe(false);
      expect(warningsFor(roll)).toEqual([`UNSUPPORTED:rollup-formula Parent__c.${roll}: Child__c.${formula} uses ${fn}; field skipped`]);
    }
  });

  it("drops roll-ups over $User, $Profile, $Setup, $Api, $Organization, $UserRole and $RecordType formulas naming the global", () => {
    const cases: [string, string, string][] = [
      ["Count_Who__c", "Who__c", "$User"],
      ["Count_Prof__c", "Prof__c", "$Profile"],
      ["Count_Setup__c", "Setup__c", "$Setup"],
      ["Count_Api__c", "Api__c", "$Api"],
      ["Count_Org__c", "Org__c", "$Organization"],
      ["Count_Role__c", "Role__c", "$UserRole"],
      ["Count_RT__c", "RT__c", "$RecordType"],
    ];
    for (const [roll, formula, global] of cases) {
      expect(has(roll)).toBe(false);
      expect(warningsFor(roll)).toEqual([`UNSUPPORTED:rollup-formula Parent__c.${roll}: Child__c.${formula} uses ${global}; field skipped`]);
    }
  });

  it("names the inner formula that breaks the rule in a formula chain", () => {
    expect(has("Sum_Via_Age__c")).toBe(false);
    expect(main.warnings).toContain("UNSUPPORTED:rollup-formula Parent__c.Sum_Via_Age__c: Child__c.Via_Age__c uses TODAY() via Child__c.Age__c; field skipped");
  });

  it("reports a formula -> roll-up -> formula cycle once per roll-up with the full path and skips every roll-up on it", () => {
    const a = object("A__c", [
      field("B__c", "MasterDetail", { referenceTo: "B__c", relationshipName: "As" }),
      summary("R__c", "sum", "B__c.A__c", "B__c.F__c"),
      num("G__c", "R__c * 1"),
    ]);
    const b = object("B__c", [
      field("A__c", "MasterDetail", { referenceTo: "A__c", relationshipName: "Bs" }),
      num("F__c", "R2__c * 1"),
      summary("R2__c", "sum", "A__c.B__c", "A__c.G__c"),
    ]);
    const r = admit([a, b]);
    expect(r.schema.getField("A__c", "R__c")).toBeUndefined();
    expect(r.schema.getField("B__c", "R2__c")).toBeUndefined();
    expect(r.schema.getField("A__c", "G__c")).toBeDefined();
    expect(r.schema.getField("B__c", "F__c")).toBeDefined();
    const cycles = r.warnings.filter((w) => w.startsWith("UNSUPPORTED:rollup-cycle"));
    expect(cycles).toHaveLength(2);
    expect(cycles).toContain(
      "UNSUPPORTED:rollup-cycle A__c.R__c: roll-up summaries and formula fields read each other in a cycle (A__c.R__c -> B__c.F__c -> B__c.R2__c -> A__c.G__c -> A__c.R__c); field skipped",
    );
    expect(cycles).toContain(
      "UNSUPPORTED:rollup-cycle B__c.R2__c: roll-up summaries and formula fields read each other in a cycle (B__c.R2__c -> A__c.G__c -> A__c.R__c -> B__c.F__c -> B__c.R2__c); field skipped",
    );
    // The follow-on failure is FormulaRegistry's own later UNSUPPORTED:formula (D-09 amended).
    const compileG = () => compileFormula("R__c * 1", { schema: r.schema, objectName: "A__c", context: "formula_field" });
    expect(compileG).toThrow("Field R__c does not exist. Check spelling.");
    try {
      compileG();
    } catch (e) {
      expect(e).toBeInstanceOf(FormulaCompileError);
      expect((e as FormulaCompileError).missing).toEqual({ object: "A__c", field: "R__c" });
    }
    const compileF = () => compileFormula("R2__c * 1", { schema: r.schema, objectName: "B__c", context: "formula_field" });
    expect(compileF).toThrow("Field R2__c does not exist. Check spelling.");
    try {
      compileF();
    } catch (e) {
      expect((e as FormulaCompileError).missing).toEqual({ object: "B__c", field: "R2__c" });
    }
    expect(r.warnings).toEqual(r.diagnostics.map(formatDiagnostic));
  });

  it("drops a roll-up that summarises a skipped roll-up with a cause", () => {
    expect(has("Sum_Of_Age_Sum__c", "Grand__c")).toBe(false);
    const d = main.diagnostics.find((x) => x.object === "Grand__c" && x.field === "Sum_Of_Age_Sum__c");
    expect(d).toMatchObject({
      area: "rollup-target",
      cause: "rollup-formula:Parent__c.Sum_Age__c",
      message: "Grand__c.Sum_Of_Age_Sum__c: Parent__c.Sum_Age__c was skipped; field skipped",
    });
    const causeAt = main.diagnostics.findIndex((x) => x.object === "Parent__c" && x.field === "Sum_Age__c");
    expect(causeAt).toBeGreaterThanOrEqual(0);
    expect(causeAt).toBeLessThan(main.diagnostics.indexOf(d!));
  });

  it("keeps warnings and diagnostics 1:1 and returns the input unchanged when nothing is formula-backed", async () => {
    expect(main.warnings).toEqual(main.diagnostics.map(formatDiagnostic));
    const r = await loadOrgSchema({ projectDir: ACME });
    expect(admitFormulaRollups(r)).toBe(r);
  });
});
