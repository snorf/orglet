/**
 * Key-prefix persistence: the pure planner and mapping parser are exercised without a database;
 * the DB-backed reconcile/drop wrappers run against whichever backend test/db.ts provides.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { buildOrgSchema, loadBaseline, loadOrgSchema, readSourceProject, type Baseline, type OrgSchema, type SourceObject, type SourceProject } from "@orglet/metadata";
import { bootstrapOrg, DmlEngine } from "@orglet/engine";
import { openTestDb, usingPglite, type TestDb } from "../../../test/db.js";
import { quote } from "./columns.js";
import type { Pool } from "./db.js";
import { migrate } from "./migrate.js";
import { KeyPrefixError, dropKeyPrefixes, planKeyPrefixes, parseKeyPrefixMapping, reconcileKeyPrefixes, type KeyPrefixPlanInput } from "./prefixes.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));

let testDb: TestDb;
let pool: Pool;
let baseline: Baseline;
let project: SourceProject;
// Each DB test gets its own org schema; afterAll removes both the schema and its _orglet rows.
const orgs: string[] = [];
const freshOrg = () => {
  const s = `test_${randomBytes(4).toString("hex")}`;
  orgs.push(s);
  return s;
};
const build = (objects: SourceObject[]) => buildOrgSchema(baseline, { ...project, objects }).schema;
const minimal = (name: string): SourceObject => ({ name, fields: [], validationRules: [], recordTypes: [] });
const rows = async (org: string) =>
  new Map(
    (
      await pool.query<{ object_name: string; key_prefix: string; source: string }>(
        `SELECT object_name, key_prefix, source FROM "_orglet"."key_prefixes" WHERE org_schema = $1 ORDER BY object_name`,
        [org],
      )
    ).rows.map((r) => [r.object_name, { keyPrefix: r.key_prefix, source: r.source }]),
  );
const flatten = (assignments: { objectName: string; keyPrefix: string; source: string }[]) => assignments.map((a) => [a.objectName, a.keyPrefix, a.source]);

beforeAll(async () => {
  testDb = await openTestDb();
  pool = testDb.pool;
  baseline = await loadBaseline();
  project = await readSourceProject(ACME);
});

afterAll(async () => {
  for (const org of orgs) {
    await dropKeyPrefixes(pool, org);
    await pool.query(`DROP SCHEMA IF EXISTS ${quote(org)} CASCADE`);
  }
  await testDb.close();
});

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

describe("dropKeyPrefixes before any reconcile", () => {
  it("drop: returns 0 for an org that never persisted a key prefix", async () => {
    expect(await dropKeyPrefixes(pool, freshOrg())).toBe(0);
  });
});

describe("reconcileKeyPrefixes", () => {
  const orgA = freshOrg();

  it("two-build: keeps every existing assignment when a newcomer shifts the provisional scheme", async () => {
    const first = build(project.objects);
    const r1 = await reconcileKeyPrefixes(pool, first, { orgSchema: orgA });
    expect(flatten(r1.assignments)).toEqual([
      ["BigTable__c", "a00", "provisional"],
      ["Milestone__c", "a01", "provisional"],
      ["Project__c", "a02", "provisional"],
      ["UpsertTable__c", "a03", "provisional"],
    ]);
    expect(r1.warnings).toEqual([]);

    const second = build([...project.objects, minimal("Aardvark__c")]);
    // The provisional scheme really does shift: Aardvark__c sorts first and takes a00 in memory.
    expect(second.getObject("Aardvark__c")?.keyPrefix).toBe("a00");
    expect(second.getObject("BigTable__c")?.keyPrefix).toBe("a01");

    const r2 = await reconcileKeyPrefixes(pool, second, { orgSchema: orgA });
    expect(r2.assignments).toEqual([{ objectName: "Aardvark__c", keyPrefix: "a04", source: "next-free" }]);
    expect(second.getObject("BigTable__c")?.keyPrefix).toBe("a00");
    expect(second.getObject("Milestone__c")?.keyPrefix).toBe("a01");
    expect(second.getObject("Project__c")?.keyPrefix).toBe("a02");
    expect(second.getObject("UpsertTable__c")?.keyPrefix).toBe("a03");
    expect(second.getObject("Aardvark__c")?.keyPrefix).toBe("a04");

    const r3 = await reconcileKeyPrefixes(pool, build([...project.objects, minimal("Aardvark__c")]), { orgSchema: orgA });
    expect(r3.assignments).toEqual([]);
    expect((await rows(orgA)).size).toBe(5);
  });

  it("removal: keeps the removed object's row and hands the prefix back when it returns", async () => {
    const removed = build(project.objects.filter((o) => o.name !== "BigTable__c"));
    const r = await reconcileKeyPrefixes(pool, removed, { orgSchema: orgA });
    expect(r.assignments).toEqual([]);
    expect((await rows(orgA)).get("BigTable__c")).toEqual({ keyPrefix: "a00", source: "provisional" });
    expect(removed.getObject("Milestone__c")?.keyPrefix).toBe("a01");

    const back = build(project.objects);
    const r2 = await reconcileKeyPrefixes(pool, back, { orgSchema: orgA });
    expect(r2.assignments).toEqual([]);
    expect(back.getObject("BigTable__c")?.keyPrefix).toBe("a00");
  });

  it("rename: treats the new name as a new object and keeps the old name's row", async () => {
    const renamed = build([...project.objects.filter((o) => o.name !== "UpsertTable__c"), minimal("Renamed__c")]);
    const r = await reconcileKeyPrefixes(pool, renamed, { orgSchema: orgA });
    expect(r.assignments).toEqual([{ objectName: "Renamed__c", keyPrefix: "a05", source: "next-free" }]);
    const persisted = await rows(orgA);
    expect(persisted.has("UpsertTable__c")).toBe(true);
    expect(persisted.size).toBe(6);
  });

  it("seeds from existing records when an upgraded org has no rows yet", async () => {
    const orgB = freshOrg();
    const first = build(project.objects);
    await migrate(pool, first, { orgSchema: orgB });
    const boot = await bootstrapOrg(pool, first, { orgSchema: orgB });
    const engine = new DmlEngine(pool, first, { orgSchema: orgB });
    const [big] = await engine.insert(boot.session, "BigTable__c", [{}]); // BigTable__c.Name is an AutoNumber
    expect(big?.success).toBe(true);
    expect(big?.id).toMatch(/^a00/);
    const [ups] = await engine.insert(boot.session, "UpsertTable__c", [{ Name: "legacy" }]);
    expect(ups?.id).toMatch(/^a03/);
    expect((await rows(orgB)).size).toBe(0);

    const r = await reconcileKeyPrefixes(pool, first, { orgSchema: orgB });
    expect(flatten(r.assignments)).toEqual([
      ["BigTable__c", "a00", "records"],
      ["Milestone__c", "a01", "provisional"],
      ["Project__c", "a02", "provisional"],
      ["UpsertTable__c", "a03", "records"],
    ]);
    const [upd] = await engine.update(boot.session, "BigTable__c", [{ Id: big?.id }]);
    expect(upd?.success).toBe(true);
  });

  it("sorts before: a newcomer that sorts first cannot steal a prefix existing records carry", async () => {
    const orgB2 = freshOrg();
    const first = build(project.objects);
    await migrate(pool, first, { orgSchema: orgB2 });
    const boot = await bootstrapOrg(pool, first, { orgSchema: orgB2 });
    const engine = new DmlEngine(pool, first, { orgSchema: orgB2 });
    const [big] = await engine.insert(boot.session, "BigTable__c", [{}]); // BigTable__c.Name is an AutoNumber
    expect(big?.id).toMatch(/^a00/);

    const second = build([...project.objects, minimal("Aardvark__c")]);
    const r = await reconcileKeyPrefixes(pool, second, { orgSchema: orgB2 });
    expect(flatten(r.assignments)).toEqual([
      ["Aardvark__c", "a01", "next-free"],
      ["BigTable__c", "a00", "records"],
      ["Milestone__c", "a02", "provisional"],
      ["Project__c", "a03", "provisional"],
      ["UpsertTable__c", "a04", "provisional"],
    ]);
    expect(second.getObject("BigTable__c")?.keyPrefix).toBe("a00");
    expect(second.getObject("Aardvark__c")?.keyPrefix).toBe("a01");
  });

  it("nothing written: a colliding mapping on a fresh org rolls the whole reconcile back", async () => {
    const orgC = freshOrg();
    const first = build(project.objects);
    const attempt = () => reconcileKeyPrefixes(pool, first, { orgSchema: orgC, mapping: { Project__c: "001" } });
    await expect(attempt()).rejects.toThrow(KeyPrefixError);
    await expect(attempt()).rejects.toThrow(/Account/);
    await expect(attempt()).rejects.toThrow(/Project__c/);
    expect((await rows(orgC)).size).toBe(0);
    expect(first.getObject("Project__c")?.keyPrefix).toBe("a02");
  });

  it("concurrent: two reconciles of a fresh org agree and never duplicate a prefix", async ({ skip }) => {
    skip(usingPglite, "Postgres-only: pglite-socket serialises connections, so two transactions cannot interleave");
    const orgF = freshOrg();
    const [ra, rb] = await Promise.all([
      reconcileKeyPrefixes(pool, build(project.objects), { orgSchema: orgF }),
      reconcileKeyPrefixes(pool, build(project.objects), { orgSchema: orgF }),
    ]);
    expect(ra.assignments.length + rb.assignments.length).toBe(4);
    expect((await rows(orgF)).size).toBe(4);
  });
});

describe("dropKeyPrefixes", () => {
  it("drop: rows survive DROP SCHEMA of the org and dropKeyPrefixes removes only that org's rows", async () => {
    const orgD = freshOrg();
    const orgE = freshOrg();
    const s = build(project.objects);
    await migrate(pool, s, { orgSchema: orgD });
    await reconcileKeyPrefixes(pool, s, { orgSchema: orgD });
    await reconcileKeyPrefixes(pool, build(project.objects), { orgSchema: orgE });

    await pool.query(`DROP SCHEMA ${quote(orgD)} CASCADE`);
    expect((await rows(orgD)).size).toBe(4);

    expect(await dropKeyPrefixes(pool, orgD)).toBe(4);
    expect((await rows(orgD)).size).toBe(0);
    expect((await rows(orgE)).size).toBe(4);
    expect(await dropKeyPrefixes(pool, orgD)).toBe(0);
  });
});
