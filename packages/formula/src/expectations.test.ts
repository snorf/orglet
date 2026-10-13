/**
 * Orglet-side expectations for formula syntax that the vendored sigha parser does not accept yet (D-20).
 * Cases that already work are plain guards so the Phase 12 resync cannot regress them; cases that need the
 * upstream fix are `it.fails`, which vitest reports as passing while the gap exists and as a failure the
 * moment the resync closes it, so Phase 12 must flip them to `it`.
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

describe("known upstream gaps (it.fails until the Phase 12 sigha resync)", () => {
  // Known upstream gap: rfaulhaber/sigha lexes a lone ! as an error (branch snorf/sigha:feat/unary-bang).
  it.fails("unary `!` negates its operand like NOT()", () => {
    const c = rule("!ISBLANK(Name)");
    expect(run(c, { record: { Name: "Acme" } }).value).toBe(true);
  });

  // Known upstream gap: sigha has no Relationship:Object colon syntax (branch snorf/sigha:feat/polymorphic-colon-ref).
  it.fails("`Owner:User.Email` reaches the User owner of a polymorphic lookup", () => {
    const c = rule("Owner:User.Email = 'a@b.se'", "Case");
    expect(c.parentPaths.length).toBeGreaterThan(0);
  });

  // Known upstream gap: sigha has no Relationship:Object colon syntax (branch snorf/sigha:feat/polymorphic-colon-ref).
  it.fails("`Owner:Group.Name` reaches the Group owner of a polymorphic lookup", () => {
    const c = rule("Owner:Group.Name = 'Support'", "Case");
    expect(c.parentPaths.length).toBeGreaterThan(0);
  });

  // Known upstream gap: sigha has no Relationship:Object colon syntax (branch snorf/sigha:feat/polymorphic-colon-ref).
  it.fails("`Owner:Queue.Name` is accepted as an alias of `Owner:Group`", () => {
    const c = rule("Owner:Queue.Name = 'Support'", "Case");
    expect(c.parentPaths.length).toBeGreaterThan(0);
  });
});
