/**
 * Key-prefix persistence: the pure planner and mapping parser are exercised without a database;
 * the DB-backed reconcile/drop wrappers run against whichever backend test/db.ts provides.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { loadOrgSchema, type OrgSchema } from "@orglet/metadata";
import { KeyPrefixError, planKeyPrefixes, parseKeyPrefixMapping, type KeyPrefixPlanInput } from "./prefixes.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));

function caught(fn: () => unknown): KeyPrefixError {
  try {
    fn();
  } catch (err) {
    if (err instanceof KeyPrefixError) return err;
    throw err;
  }
  throw new Error("expected KeyPrefixError");
}

describe("planKeyPrefixes", () => {
  const standard = [
    { name: "Account", keyPrefix: "001" },
    { name: "Contact", keyPrefix: "003" },
  ];
  const custom = [
    { name: "Bar__c", provisional: "a00" },
    { name: "Foo__c", provisional: "a01" },
  ];
  const base = (): KeyPrefixPlanInput => ({ custom, standard, persisted: new Map(), observed: new Map(), mapping: new Map() });
  const flat = (input: KeyPrefixPlanInput) => planKeyPrefixes(input).assignments.map((a) => ({ objectName: a.objectName, keyPrefix: a.keyPrefix, source: a.source }));

  it("assigns the provisional prefix when nothing is persisted and nothing collides", () => {
    const plan = planKeyPrefixes(base());
    expect(flat(base())).toEqual([
      { objectName: "Bar__c", keyPrefix: "a00", source: "provisional" },
      { objectName: "Foo__c", keyPrefix: "a01", source: "provisional" },
    ]);
    expect(plan.warnings).toEqual([]);
  });

  it("never emits an assignment for an object that already has a persisted row", () => {
    const input = base();
    input.persisted = new Map([["bar__c", { name: "Bar__c", keyPrefix: "a07" }]]);
    const assignments = planKeyPrefixes(input).assignments;
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.objectName).toBe("Foo__c");
  });

  it("rejects a mapping prefix that collides with a standard object, naming both", () => {
    const input = base();
    input.mapping = new Map([["foo__c", "001"]]);
    expect(() => planKeyPrefixes(input)).toThrow(KeyPrefixError);
    const err = caught(() => planKeyPrefixes(input));
    expect(err.message).toMatch(/Foo__c/);
    expect(err.message).toMatch(/Account/);
    expect(err.message).toMatch(/001/);
    expect(err.claims).toHaveLength(2);
  });

  it("rejects a mapping prefix that collides with another object's persisted prefix, naming both", () => {
    const input = base();
    input.persisted = new Map([["bar__c", { name: "Bar__c", keyPrefix: "a0X" }]]);
    input.mapping = new Map([["foo__c", "a0X"]]);
    const err = caught(() => planKeyPrefixes(input));
    expect(err.message).toMatch(/Foo__c/);
    expect(err.message).toMatch(/Bar__c/);
    expect(err.message).toMatch(/a0X/);
  });

  it("rejects a table whose records carry two different prefixes", () => {
    const input = base();
    input.observed = new Map([["foo__c", ["a01", "a07"]]]);
    const err = caught(() => planKeyPrefixes(input));
    expect(err.message).toMatch(/Foo__c/);
    expect(err.message).toMatch(/a01/);
    expect(err.message).toMatch(/a07/);
  });

  it("rejects a mapping value that differs from the prefix existing records carry", () => {
    const input = base();
    input.observed = new Map([["foo__c", ["a01"]]]);
    input.mapping = new Map([["foo__c", "a05"]]);
    const err = caught(() => planKeyPrefixes(input));
    expect(err.message).toMatch(/a05/);
    expect(err.message).toMatch(/a01/);
    expect(err.message).toMatch(/Foo__c/);
  });

  it("rejects two mapping entries that claim the same prefix", () => {
    const input = base();
    input.mapping = new Map([
      ["bar__c", "a09"],
      ["foo__c", "a09"],
    ]);
    const err = caught(() => planKeyPrefixes(input));
    expect(err.message).toMatch(/Bar__c/);
    expect(err.message).toMatch(/Foo__c/);
    expect(err.message).toMatch(/a09/);
  });

  it("falls back to the next free prefix when the provisional one is held by a persisted row", () => {
    const input = base();
    // Old__c was removed from metadata but keeps its row (D-13), so a00 stays taken.
    input.persisted = new Map([["old__c", { name: "Old__c", keyPrefix: "a00" }]]);
    expect(flat(input)).toEqual([
      { objectName: "Bar__c", keyPrefix: "a01", source: "next-free" },
      { objectName: "Foo__c", keyPrefix: "a02", source: "next-free" },
    ]);
  });

  it("resolves records and mapping claims for every object before handing out provisional prefixes", () => {
    const input = base();
    input.custom = [
      { name: "Aardvark__c", provisional: "a00" },
      { name: "BigTable__c", provisional: "a01" },
    ];
    input.observed = new Map([["bigtable__c", ["a00"]]]);
    expect(flat(input)).toEqual([
      { objectName: "Aardvark__c", keyPrefix: "a01", source: "next-free" },
      { objectName: "BigTable__c", keyPrefix: "a00", source: "records" },
    ]);
  });

  it("rejects a mapping value that differs from the prefix already persisted for the object", () => {
    const input = base();
    input.persisted = new Map([["bar__c", { name: "Bar__c", keyPrefix: "a00" }]]);
    input.mapping = new Map([["bar__c", "a0X"]]);
    expect(() => planKeyPrefixes(input)).toThrow(KeyPrefixError);
    const err = caught(() => planKeyPrefixes(input));
    expect(err.message).toMatch(/Bar__c/);
    expect(err.message).toMatch(/a0X/);
    expect(err.message).toMatch(/a00/);
    expect(err.message).toMatch(/--key-prefixes/);
    expect(err.message).toMatch(/persisted/);
    expect(err.claims.map((c) => c.source)).toEqual(["mapping", "persisted"]);
  });

  it("accepts a mapping value equal to the persisted prefix as a no-op", () => {
    const input = base();
    input.persisted = new Map([["bar__c", { name: "Bar__c", keyPrefix: "a00" }]]);
    input.mapping = new Map([["bar__c", "a00"]]);
    const plan = planKeyPrefixes(input);
    expect(flat(input)).toEqual([{ objectName: "Foo__c", keyPrefix: "a01", source: "provisional" }]);
    expect(plan.warnings).toEqual([]);
  });

  it("uses the mapping for an object without a row and labels the source", () => {
    const input = base();
    input.mapping = new Map([["foo__c", "a0Z"]]);
    expect(flat(input)).toContainEqual({ objectName: "Foo__c", keyPrefix: "a0Z", source: "mapping" });
  });
});

describe("parseKeyPrefixMapping", () => {
  let schema: OrgSchema;

  beforeAll(async () => {
    schema = (await loadOrgSchema({ projectDir: ACME })).schema;
  });

  it("rejects anything that is not a plain object", () => {
    for (const raw of [null, [], "x", 5]) {
      expect(() => parseKeyPrefixMapping(raw, schema)).toThrow(KeyPrefixError);
    }
  });

  it("rejects a prefix that is not exactly 3 alphanumeric characters", () => {
    for (const raw of [{ Project__c: "a0" }, { Project__c: "a0XX" }, { Project__c: "a-0" }, { Project__c: 5 }]) {
      expect(() => parseKeyPrefixMapping(raw, schema)).toThrow(KeyPrefixError);
    }
  });

  it("rejects an object that is not in the schema", () => {
    expect(() => parseKeyPrefixMapping({ Nope__c: "a0X" }, schema)).toThrowError(/Nope__c/);
    expect(() => parseKeyPrefixMapping({ Nope__c: "a0X" }, schema)).toThrow(KeyPrefixError);
  });

  it("rejects a standard object", () => {
    expect(() => parseKeyPrefixMapping({ Account: "a0X" }, schema)).toThrow(KeyPrefixError);
    expect(() => parseKeyPrefixMapping({ Account: "a0X" }, schema)).toThrowError(/Account/);
    expect(() => parseKeyPrefixMapping({ Account: "a0X" }, schema)).toThrowError(/standard/);
  });

  it("rejects two entries with the same prefix", () => {
    const raw = { Project__c: "a0X", Milestone__c: "a0X" };
    expect(() => parseKeyPrefixMapping(raw, schema)).toThrow(KeyPrefixError);
    expect(() => parseKeyPrefixMapping(raw, schema)).toThrowError(/Project__c/);
    expect(() => parseKeyPrefixMapping(raw, schema)).toThrowError(/Milestone__c/);
  });

  it("canonicalises object-name casing", () => {
    expect(parseKeyPrefixMapping({ project__c: "a0X" }, schema)).toEqual({ Project__c: "a0X" });
  });
});
