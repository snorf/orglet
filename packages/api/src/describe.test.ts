/**
 * Describe output for an object without a confirmed key prefix (D-09), using the test-only
 * null-prefix fixture combined with the real baseline. Pure: no database.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { buildOrgSchema, loadBaseline, type OrgSchema } from "@orglet/metadata";
import { describeField, globalDescribe, objectDescribe } from "./describe.js";

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

  it("a feature-gated field is described as a plain nullable field with the usual key set (D-10)", () => {
    const contact = schema.getObject("Contact");
    const gated = schema.getField("Contact", "JigsawContactId");
    const plain = schema.getField("Contact", "Jigsaw");
    if (!contact || !gated || !plain) throw new Error("Contact.JigsawContactId or Contact.Jigsaw missing from schema");
    expect(gated).toMatchObject({ featureGated: true, type: "Text", length: 20 });
    expect(plain.type).toBe("Text");
    expect("featureGated" in plain).toBe(false);
    const gatedDescribe = describeField(schema, contact, gated) as Record<string, unknown>;
    const plainDescribe = describeField(schema, contact, plain) as Record<string, unknown>;
    expect(Object.keys(gatedDescribe).sort()).toEqual(Object.keys(plainDescribe).sort());
    expect(gatedDescribe["nillable"]).toBe(true);
    expect("featureGated" in gatedDescribe).toBe(false);
  });
});
