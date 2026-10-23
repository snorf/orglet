/**
 * Orglet-side expectations for formula syntax: guards for what always worked, and the unary `!` and
 * `Relationship:Object.Field` forms enabled by the Phase 12 sigha resync (formerly `it.fails`, D-05).
 */
import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { loadOrgSchema, type OrgSchema } from "@orglet/metadata";
import { compileFormula, type CompiledFormula } from "./compile.js";
import { evaluateCompiled, type EvaluationContext } from "./evaluate.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));
let schema: OrgSchema;

beforeAll(async () => {
  schema = (await loadOrgSchema({ projectDir: ACME })).schema;
});

const rule = (source: string, objectName = "Account") => compileFormula(source, { schema, objectName, context: "validation_rule" });
const run = (compiled: CompiledFormula, ctx: Partial<EvaluationContext> & { record: EvaluationContext["record"] }) =>
  evaluateCompiled(compiled, { isNew: true, ...ctx });

describe("formula syntax guards (work today, must keep working)", () => {
  it("`!=` compares like `<>`", () => {
    const c = rule("Name != 'x'");
    expect(run(c, { record: { Name: "y" } }).value).toBe(true);
    expect(run(c, { record: { Name: "x" } }).value).toBe(false);
  });

  it("`!` and `:` inside string literals are plain text, not operators", () => {
    const c = rule("Name = 'a!b:c'");
    expect(run(c, { record: { Name: "a!b:c" } }).value).toBe(true);
    expect(() => rule('Name = "Owner:User.Email"')).not.toThrow();
  });
});

describe("formulas the Phase 12 resync enabled", () => {
  it("unary `!` negates its operand like NOT()", () => {
    const c = rule("!ISBLANK(Name)");
    expect(run(c, { record: { Name: "Acme" } }).value).toBe(true);
    expect(run(c, { record: { Name: null } }).value).toBe(false);
  });

  it("`!X` equals NOT(X) for null, empty and non-empty values", () => {
    const bang = rule("!ISBLANK(Name)");
    const not = rule("NOT(ISBLANK(Name))");
    for (const Name of [null, "", "a"]) expect(run(bang, { record: { Name } }).value).toBe(run(not, { record: { Name } }).value);
  });

  it("`!` negates a parenthesised comparison", () => {
    const c = rule("!(Name = 'x')");
    expect(run(c, { record: { Name: "y" } }).value).toBe(true);
    expect(run(c, { record: { Name: "x" } }).value).toBe(false);
  });

  it("`!` binds tighter than `&&`", () => {
    const c = rule("!ISBLANK(Name) && ISBLANK(Website)");
    expect(run(c, { record: { Name: "Acme", Website: null } }).value).toBe(true);
    expect(run(c, { record: { Name: "Acme", Website: "x" } }).value).toBe(false);
    expect(run(c, { record: { Name: null, Website: null } }).value).toBe(false);
  });

  it("`Owner:User.Email` reaches the User owner of a polymorphic lookup", () => {
    const c = rule("Owner:User.Email = 'a@b.se'", "Case");
    expect(c.parentPaths).toEqual([["Owner:User"]]);
    expect(c.references[0]?.key).toBe("Owner:User.Email");
  });

  it("`Owner:Group.Name` reaches the Group owner of a polymorphic lookup", () => {
    const c = rule("Owner:Group.Name = 'Support'", "Case");
    expect(c.parentPaths).toEqual([["Owner:Group"]]);
    expect(c.references[0]?.key).toBe("Owner:Group.Name");
  });

  it("`Owner:Queue.Name` is accepted as an alias of `Owner:Group`", () => {
    const c = rule("Owner:Queue.Name = 'Support'", "Case");
    expect(c.parentPaths).toEqual([["Owner:Group"]]);
    expect(c.references[0]?.key).toBe("Owner:Group.Name");
  });
});
