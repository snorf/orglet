/**
 * Describe output for an object without a confirmed key prefix (D-09), using the test-only
 * null-prefix fixture combined with the real baseline. Pure: no database.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { buildOrgSchema, loadBaseline, type OrgSchema } from "@orglet/metadata";
import { globalDescribe, objectDescribe } from "./describe.js";

const NULL_PREFIX = fileURLToPath(new URL("../../metadata/test/fixtures/null-prefix/", import.meta.url));
let schema: OrgSchema;

beforeAll(async () => {
  const real = await loadBaseline();
  const extra = await loadBaseline(NULL_PREFIX);
  schema = buildOrgSchema({ ...real, objects: [...real.objects, ...extra.objects] }).schema;
});

describe("describe", () => {
  it("reports keyPrefix null for an object without a confirmed prefix, as Salesforce does, and lists it in global describe", () => {
    const thing = schema.getObject("PrefixlessThing");
    if (!thing) throw new Error("PrefixlessThing missing from schema");
    expect(objectDescribe(schema, thing, "59.0", new Map())).toMatchObject({ name: "PrefixlessThing", keyPrefix: null, createable: false });
    const sobjects = globalDescribe(schema, "59.0")["sobjects"] as { name: string; keyPrefix: string | null }[];
    expect(sobjects).toContainEqual(expect.objectContaining({ name: "PrefixlessThing", keyPrefix: null }));
  });

  it("still reports the prefix of an object that has one", () => {
    const account = schema.getObject("Account");
    if (!account) throw new Error("Account missing from schema");
    expect(objectDescribe(schema, account, "59.0", new Map())).toMatchObject({ keyPrefix: "001" });
  });
});
