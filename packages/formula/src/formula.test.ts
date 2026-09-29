import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { loadOrgSchema, type OrgSchema } from "@orglet/metadata";
import { compileFormula, FormulaCompileError, type CompiledFormula } from "./compile.js";
import { evaluateCompiled, type EvaluationContext } from "./evaluate.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));
let schema: OrgSchema;

beforeAll(async () => {
  schema = (await loadOrgSchema({ projectDir: ACME })).schema;
});

const rule = (source: string, objectName = "Account") => compileFormula(source, { schema, objectName, context: "validation_rule" });
const field = (source: string, objectName: string, treatBlanksAs: "BlankAsBlank" | "BlankAsZero" = "BlankAsBlank") =>
  compileFormula(source, { schema, objectName, context: "formula_field", treatBlanksAs });
const run = (compiled: CompiledFormula, ctx: Partial<EvaluationContext> & { record: EvaluationContext["record"] }) =>
  evaluateCompiled(compiled, { isNew: true, ...ctx });

describe("compileFormula", () => {
  it("resolves field references case-insensitively to canonical names", () => {
    const c = rule('AND(ISPICKVAL(type, "Customer - Direct"), ISBLANK(WEBSITE))');
    expect(c.references.map((r) => r.key).sort()).toEqual(["Type", "Website"]);
    expect(c.references.find((r) => r.key === "Type")?.type).toBe("Picklist");
  });

  it("rejects unknown fields with Salesforce's wording", () => {
    expect(() => rule("ISBLANK(Nope__c)")).toThrow("Field Nope__c does not exist. Check spelling.");
  });

  it("rejects syntax errors and unknown functions at compile time", () => {
    expect(() => rule("IF(ISBLANK(Name), TRUE")).toThrow(FormulaCompileError);
    expect(() => rule("FOO(Name)")).toThrow(/FOO/);
  });

  it("resolves parent paths and reports which relationships must be loaded", () => {
    const c = rule("Account.Industry = 'Energy' && Account.Owner.Alias = 'x'".replace("Account.Owner.Alias = 'x'", "TRUE"), "Contact");
    expect(c.parentPaths).toEqual([["Account"]]);
    expect(c.references[0]).toMatchObject({ key: "Account.Industry", path: ["Account", "Industry"], type: "Picklist" });
  });

  it("refuses polymorphic traversal and unknown globals explicitly", () => {
    expect(() => rule("Owner.Alias = 'x'")).toThrow(/UNSUPPORTED:formula-polymorphic/);
    expect(() => rule("$Setup.Foo__c.Bar__c")).toThrow(/UNSUPPORTED:formula-global/);
  });

  it("only allows record-state functions where Salesforce does", () => {
    expect(() => field("PRIORVALUE(Name)", "Account")).toThrow(FormulaCompileError);
    const c = rule("ISCHANGED(Name) || ISNEW() || PRIORVALUE(Industry) = 'Energy'");
    expect(c.usesRecordState).toBe(true);
    expect(c.references.map((r) => r.key).sort()).toEqual(["$Changed.Name", "$Prior.Industry", "$Record.IsNew"]);
  });

  it("maps globals to their objects", () => {
    const c = rule("$User.Alias = 'admin' && $Profile.Name = 'System Administrator'");
    expect(c.references.map((r) => r.key).sort()).toEqual(["$Profile.Name", "$User.Alias"]);
    expect(c.parentPaths).toEqual([]);
  });
});

describe("evaluateCompiled", () => {
  it("evaluates the acme validation rule against a record", () => {
    const c = rule('AND(ISPICKVAL(Type, "Customer - Direct"), ISBLANK(Website))');
    expect(run(c, { record: { Type: "Customer - Direct", Website: null } }).value).toBe(true);
    expect(run(c, { record: { Type: "Customer - Direct", Website: "https://acme.example" } }).value).toBe(false);
    expect(run(c, { record: { Type: "Prospect" } }).value).toBe(false);
  });

  it("evaluates formula fields with blank-as-zero and blank-as-blank semantics", () => {
    const zero = field("Amount * Probability / 100", "Opportunity", "BlankAsZero");
    expect(run(zero, { record: { Amount: 1000, Probability: 10 } }).value).toBe(100);
    expect(run(zero, { record: { Amount: null, Probability: 10 } }).value).toBe(0);
    const blank = field("Amount * Probability / 100", "Opportunity", "BlankAsBlank");
    expect(run(blank, { record: { Amount: null, Probability: 10 } }).value).toBeNull();
  });

  it("keeps decimal arithmetic exact", () => {
    const c = field("0.1 + 0.2", "Account");
    expect(run(c, { record: {} }).value).toBe(0.3);
  });

  it("reads dates from ISO strings and compares them with TODAY()", () => {
    const c = field('AND(NOT(ISPICKVAL(Status__c, "Done")), NOT(ISBLANK(End_Date__c)), End_Date__c < TODAY())', "Project__c");
    const now = new Date("2026-09-25T10:00:00Z");
    expect(run(c, { record: { Status__c: "Active", End_Date__c: "2026-09-01" }, now }).value).toBe(true);
    expect(run(c, { record: { Status__c: "Active", End_Date__c: "2026-10-01" }, now }).value).toBe(false);
    expect(run(c, { record: { Status__c: "Done", End_Date__c: "2026-09-01" }, now }).value).toBe(false);
  });

  it("renders date and datetime results in REST format", () => {
    expect(run(field("DATE(2026, 1, 31)", "Account"), { record: {} }).value).toBe("2026-01-31");
    expect(run(field("DATETIMEVALUE('2026-01-31 13:45:00')", "Account"), { record: {} }).value).toBe("2026-01-31T13:45:00.000+0000");
  });

  it("implements ISNEW, ISCHANGED and PRIORVALUE from the old record", () => {
    const c = rule("ISCHANGED(Name) && PRIORVALUE(Name) = 'Old' && NOT(ISNEW())");
    expect(run(c, { record: { Name: "New" }, old: { Name: "Old" }, isNew: false }).value).toBe(true);
    expect(run(c, { record: { Name: "Old" }, old: { Name: "Old" }, isNew: false }).value).toBe(false);
    expect(run(c, { record: { Name: "New" }, isNew: true }).value).toBe(false);
    // On insert PRIORVALUE returns the current value.
    expect(run(rule("PRIORVALUE(Name) = 'New'"), { record: { Name: "New" }, isNew: true }).value).toBe(true);
    expect(run(rule("ISCHANGED(Name)"), { record: { Name: "New" }, isNew: true }).value).toBe(false);
  });

  it("reads parent fields and globals from nested context", () => {
    const c = rule("Account.Industry = 'Energy' && $User.Alias = 'jk'", "Contact");
    const ctx = { record: { Account: { Industry: "Energy" } }, user: { Alias: "jk" } };
    expect(run(c, ctx).value).toBe(true);
    expect(run(c, { record: { Account: null }, user: { Alias: "jk" } }).value).toBe(false);
  });

  it("returns #Error! rather than throwing on runtime errors", () => {
    const r = run(field("1 / Probability", "Opportunity", "BlankAsZero"), { record: { Probability: 0 } });
    expect(r.value).toBeNull();
    expect(r.error).toMatch(/^#Error!/);
  });
});
