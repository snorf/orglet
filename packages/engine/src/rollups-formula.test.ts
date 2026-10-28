/** Phase 13: roll-ups over formula fields recompute in the save pipeline (D-14..D-16) and are backfilled once by the engine (D-10..D-13). Filled by plans 13-06 and 13-07. */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { buildOrgSchema, loadBaseline, type FieldDef, type OrgSchema, type SObjectDef, type SourceField, type SourceFilterItem, type SourceObject } from "@orglet/metadata";
import { admitFormulaRollups } from "@orglet/formula";
import { migrate, quote, type MigrateResult, type Pool, type PoolClient } from "@orglet/schema";
import { openTestDb, type TestDb } from "../../../test/db.js";
import { bootstrapOrg } from "./bootstrap.js";
import { DmlEngine } from "./engine.js";
import type { Session, TriggerContext } from "./hooks.js";
import { runQuery } from "./query.js";

const orgSchema = `test_${randomBytes(4).toString("hex")}`;

let testDb: TestDb;
let pool: Pool;
let schema: OrgSchema;
let engine: DmlEngine;
let session: Session;

const filter = (field: string, operation: string, value = "", valueField?: string): SourceFilterItem => ({
  field: `Child__c.${field}`,
  operation,
  value,
  ...(valueField === undefined ? {} : { valueField: `Child__c.${valueField}` }),
});
const rollup = (fullName: string, op: string, summarized: string | undefined, filters: SourceFilterItem[] = []): SourceField => ({
  fullName,
  label: fullName,
  type: "Summary",
  summaryOperation: op,
  summaryForeignKey: "Child__c.Parent__c",
  summaryFilterItems: filters,
  ...(summarized === undefined ? {} : { summarizedField: `Child__c.${summarized}` }),
});
const formula = (fullName: string, type: NonNullable<SourceField["type"]>, expr: string, extra: Omit<SourceField, "fullName" | "label" | "type" | "formula"> = {}): SourceField => ({ fullName, label: fullName, type, formula: expr, ...extra });
const masterDetail = (fullName: string, referenceTo: string, relationshipName: string): SourceField => ({ fullName, label: fullName, type: "MasterDetail", referenceTo, relationshipName, relationshipLabel: relationshipName, reparentableMasterDetail: true });

const objects: SourceObject[] = [
  {
    name: "Grand__c",
    label: "Grand",
    pluralLabel: "Grands",
    fields: [{ fullName: "Sum_Score__c", label: "Sum Score", type: "Summary", summaryOperation: "sum", summaryForeignKey: "Parent__c.Grand__c", summarizedField: "Parent__c.Score__c", summaryFilterItems: [] }],
    validationRules: [],
    recordTypes: [],
  },
  {
    name: "Parent__c",
    label: "Parent",
    pluralLabel: "Parents",
    fields: [
      masterDetail("Grand__c", "Grand__c", "Parents"),
      formula("Score__c", "Number", "Sum_Line__c * 2", { precision: 18, scale: 2 }),
      rollup("Sum_Line__c", "sum", "Line__c"),
      rollup("Sum_Third__c", "sum", "Third__c"),
      rollup("Max_Outer__c", "max", "Outer__c"),
      rollup("Big_Count__c", "count", undefined, [filter("Is_Big__c", "equals", "True")]),
      rollup("Late_Count__c", "count", undefined, [filter("Due_Plus__c", "greaterThan", "", "Planned__c")]),
      rollup("Max_Due_Plus__c", "max", "Due_Plus__c"),
      rollup("Min_Stamp__c", "min", "Stamp_Copy__c"),
      rollup("Alpha_Count__c", "count", undefined, [filter("Upper_Tag__c", "equals", "ALPHA")]),
      rollup("Plain_Total__c", "sum", "Price__c"),
    ],
    validationRules: [],
    recordTypes: [],
  },
  {
    name: "Child__c",
    label: "Child",
    pluralLabel: "Children",
    fields: [
      masterDetail("Parent__c", "Parent__c", "Children"),
      { fullName: "Qty__c", label: "Qty", type: "Number", precision: 10, scale: 0 },
      { fullName: "Price__c", label: "Price", type: "Currency", precision: 16, scale: 2 },
      { fullName: "Rate__c", label: "Rate", type: "Number", precision: 10, scale: 0 },
      { fullName: "Due__c", label: "Due", type: "Date" },
      { fullName: "Planned__c", label: "Planned", type: "Date" },
      { fullName: "Stamp__c", label: "Stamp", type: "DateTime" },
      { fullName: "Tag__c", label: "Tag", type: "Text", length: 40 },
      // Declared outer-first on purpose: evaluation order must follow dependencies (D-02).
      formula("Outer__c", "Number", "Inner__c + 1", { precision: 18, scale: 0 }),
      formula("Inner__c", "Number", "Qty__c * 2", { precision: 18, scale: 0 }),
      formula("Line__c", "Currency", "Qty__c * Price__c", { precision: 18, scale: 2 }),
      formula("Third__c", "Number", "Rate__c / 3", { precision: 18, scale: 2 }),
      formula("Is_Big__c", "Checkbox", "Qty__c > 10"),
      formula("Due_Plus__c", "Date", "Due__c + 1"),
      formula("Stamp_Copy__c", "DateTime", "Stamp__c"),
      formula("Upper_Tag__c", "Text", "UPPER(Tag__c)", { length: 40 }),
    ],
    validationRules: [],
    recordTypes: [],
  },
];

beforeAll(async () => {
  testDb = await openTestDb();
  pool = testDb.pool;
  const built = buildOrgSchema(await loadBaseline(), { rootDir: "", packageDirectories: [], objects, globalValueSets: [], standardValueSets: [], warnings: [] });
  expect(built.warnings.filter((w) => w.includes("UNSUPPORTED:rollup"))).toEqual([]);
  schema = built.schema;
  await migrate(pool, schema, { orgSchema });
  session = (await bootstrapOrg(pool, schema, { orgSchema })).session;
  engine = new DmlEngine(pool, schema, { orgSchema });
  expect(engine.warnings).toEqual([]);
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${quote(orgSchema)} CASCADE`);
  await testDb.close();
});

async function one(sobject: string, input: Record<string, unknown>): Promise<string> {
  const [r] = await engine.insert(session, sobject, [input]);
  expect(r?.errors, JSON.stringify(r?.errors)).toEqual([]);
  return r?.id as string;
}

async function get(sobject: string, id: string): Promise<Record<string, unknown>> {
  const rec = (await engine.retrieve(session, sobject, [id])).get(id);
  expect(rec, `${sobject} ${id} not found`).toBeDefined();
  return rec as Record<string, unknown>;
}

const obj = (name: string) => schema.getObject(name) as SObjectDef;
const field = (o: string, f: string) => schema.getField(o, f) as FieldDef;
const sorted = (s: ReadonlySet<string>) => [...s].sort();

async function parentOf(): Promise<{ grand: string; parent: string }> {
  const grand = await one("Grand__c", { Name: "G" });
  const parent = await one("Parent__c", { Name: "P", Grand__c: grand });
  return { grand, parent };
}

describe("RollupRegistry watched set", () => {
  const binding = (parent: string, name: string) => engine.rollups.binding(field(parent, name));
  it("watches the stored fields a formula roll-up reads, transitively through formula-on-formula", () => {
    const outer = binding("Parent__c", "Max_Outer__c");
    expect(sorted(outer?.watched ?? new Set())).toEqual(["Parent__c", "Qty__c"]);
    expect(outer?.formulaBacked).toBe(true);
    expect(outer?.formulas).toEqual(["Inner__c", "Outer__c"]);
    expect(sorted(binding("Parent__c", "Sum_Line__c")?.watched ?? new Set())).toEqual(["Parent__c", "Price__c", "Qty__c"]);
    const late = binding("Parent__c", "Late_Count__c")?.watched ?? new Set<string>();
    expect(late.has("Due__c")).toBe(true);
    expect(late.has("Planned__c")).toBe(true);
    const plain = binding("Parent__c", "Plain_Total__c");
    expect(plain?.formulaBacked).toBe(false);
    expect(sorted(plain?.watched ?? new Set())).toEqual(["Parent__c", "Price__c"]);
    expect(engine.rollups.forChild(obj("Child__c")).length).toBe(9);
  });

  it("watches the roll-up column a formula reads (formula on roll-up)", () => {
    const b = binding("Grand__c", "Sum_Score__c");
    expect(b?.watched.has("Sum_Line__c")).toBe(true);
    expect(b?.watched.has("Grand__c")).toBe(true);
    expect(b?.formulaBacked).toBe(true);
    expect(b?.formulas).toEqual(["Score__c"]);
  });
});

describe("formula roll-up recompute", () => {
  it("insert, update, delete and undelete of children move a formula roll-up exactly as a stored one", async () => {
    const { parent } = await parentOf();
    await one("Child__c", { Name: "c1", Parent__c: parent, Qty__c: 2, Price__c: 10 });
    const c2 = await one("Child__c", { Name: "c2", Parent__c: parent, Qty__c: 3, Price__c: 5 });
    expect(await get("Parent__c", parent)).toMatchObject({ Sum_Line__c: 35, Max_Outer__c: 7, Plain_Total__c: 15 });
    expect((await engine.delete(session, "Child__c", [c2]))[0]?.success).toBe(true);
    expect(await get("Parent__c", parent)).toMatchObject({ Sum_Line__c: 20, Max_Outer__c: 5, Plain_Total__c: 10 });
    expect((await engine.undelete(session, "Child__c", [c2]))[0]?.success).toBe(true);
    expect(await get("Parent__c", parent)).toMatchObject({ Sum_Line__c: 35, Max_Outer__c: 7, Plain_Total__c: 15 });
  });

  it("updating a field only the formula reads recomputes the parent", async () => {
    const { parent } = await parentOf();
    const c1 = await one("Child__c", { Name: "c1", Parent__c: parent, Qty__c: 2, Price__c: 10 });
    await one("Child__c", { Name: "c2", Parent__c: parent, Qty__c: 3, Price__c: 5 });
    expect((await engine.update(session, "Child__c", [{ Id: c1, Qty__c: 4 }]))[0]?.success).toBe(true);
    expect(await get("Parent__c", parent)).toMatchObject({ Sum_Line__c: 55, Max_Outer__c: 9 });
  });

  it("reparenting moves the value from the old parent to the new one", async () => {
    const { parent: p1 } = await parentOf();
    const { parent: p2 } = await parentOf();
    const c = await one("Child__c", { Name: "c1", Parent__c: p1, Qty__c: 2, Price__c: 10 });
    await one("Child__c", { Name: "c2", Parent__c: p1, Qty__c: 1, Price__c: 1 });
    expect(await get("Parent__c", p1)).toMatchObject({ Sum_Line__c: 21 });
    expect((await engine.update(session, "Child__c", [{ Id: c, Parent__c: p2 }]))[0]?.success).toBe(true);
    expect(await get("Parent__c", p1)).toMatchObject({ Sum_Line__c: 1 });
    expect(await get("Parent__c", p2)).toMatchObject({ Sum_Line__c: 20 });
  });

  it("filters and valueFields on formula fields count exactly the matching children", async () => {
    const { parent } = await parentOf();
    await one("Child__c", { Name: "c1", Parent__c: parent, Qty__c: 11, Tag__c: "alpha", Due__c: "2026-01-10", Planned__c: "2026-01-10" });
    await one("Child__c", { Name: "c2", Parent__c: parent, Qty__c: 5, Tag__c: "Beta", Due__c: "2026-01-01", Planned__c: "2026-01-05" });
    expect(await get("Parent__c", parent)).toMatchObject({ Big_Count__c: 1, Alpha_Count__c: 1, Late_Count__c: 1 });
  });

  it("number formula values are rounded to the formula's scale before they are summed", async () => {
    const { parent } = await parentOf();
    for (let i = 0; i < 3; i++) await one("Child__c", { Name: `c${i}`, Parent__c: parent, Rate__c: 1 });
    expect(Number((await get("Parent__c", parent))["Sum_Third__c"])).toBe(0.99);
  });

  it("MIN and MAX over Date and DateTime formulas", async () => {
    const { parent } = await parentOf();
    await one("Child__c", { Name: "c1", Parent__c: parent, Due__c: "2026-03-01", Stamp__c: "2026-01-02T03:04:05.000Z" });
    await one("Child__c", { Name: "c2", Parent__c: parent, Due__c: "2026-02-01", Stamp__c: "2026-01-01T00:00:00.000Z" });
    expect(await get("Parent__c", parent)).toMatchObject({ Max_Due_Plus__c: "2026-03-02", Min_Stamp__c: "2026-01-01T00:00:00.000+0000" });
  });

  it("a stored-field roll-up on the same parent keeps the SQL path", async () => {
    expect(engine.rollups.binding(field("Parent__c", "Plain_Total__c"))?.formulaBacked).toBe(false);
    const { parent } = await parentOf();
    await one("Child__c", { Name: "c1", Parent__c: parent, Qty__c: 2, Price__c: 10 });
    expect(await get("Parent__c", parent)).toMatchObject({ Plain_Total__c: 10, Sum_Line__c: 20 });
  });

  it("a formula reading a roll-up feeds a roll-up one level up", async () => {
    const { grand, parent } = await parentOf();
    await one("Child__c", { Name: "c1", Parent__c: parent, Qty__c: 2, Price__c: 10 });
    const c2 = await one("Child__c", { Name: "c2", Parent__c: parent, Qty__c: 3, Price__c: 5 });
    expect(await get("Grand__c", grand)).toMatchObject({ Sum_Score__c: 70 });
    expect((await engine.delete(session, "Child__c", [c2]))[0]?.success).toBe(true);
    expect(await get("Grand__c", grand)).toMatchObject({ Sum_Score__c: 40 });
  });
});

describe("formula roll-up backfill", () => {
  const orgB = `test_${randomBytes(4).toString("hex")}`;
  const markers = async (): Promise<number> => Number((await pool.query<{ n: string }>(`SELECT count(*) AS n FROM "_orglet"."rollup_backfills" WHERE org_schema = $1`, [orgB])).rows[0]?.n);
  const parentCol = async (col: string): Promise<number> => Number((await pool.query<{ v: string }>(`SELECT ${col} AS v FROM ${quote(orgB)}.parent__c`)).rows[0]?.v);

  /** The plan 06 fixture, with (true) or without (false) every roll-up and the formula that reads one; the Age__c / Sum_Age__c pair is inadmissible (TODAY()). */
  const objectsFor = (withRollups: boolean): SourceObject[] =>
    objects.map((o) => {
      const fields = withRollups ? [...o.fields] : o.fields.filter((f) => f.type !== "Summary" && f.fullName !== "Score__c");
      if (withRollups && o.name === "Child__c") fields.push(formula("Age__c", "Number", "TODAY() - Due__c", { precision: 18, scale: 0 }));
      if (withRollups && o.name === "Parent__c") fields.push(rollup("Sum_Age__c", "sum", "Age__c"));
      return { ...o, fields };
    });
  const source = (withRollups: boolean) => ({ rootDir: "", packageDirectories: [], objects: objectsFor(withRollups), globalValueSets: [], standardValueSets: [], warnings: [] });

  let full: ReturnType<typeof admitFormulaRollups>;
  let upgrade: MigrateResult;
  let engineB: DmlEngine;
  let sessionB: Session;
  let hookLog: string[];
  let firstRun: string[];

  beforeAll(async () => {
    const before = buildOrgSchema(await loadBaseline(), source(false)).schema;
    full = admitFormulaRollups(buildOrgSchema(await loadBaseline(), source(true)));
    await migrate(pool, before, { orgSchema: orgB });
    sessionB = (await bootstrapOrg(pool, before, { orgSchema: orgB })).session;
    const seed = new DmlEngine(pool, before, { orgSchema: orgB });
    const ins = async (sobject: string, input: Record<string, unknown>): Promise<string> => {
      const [r] = await seed.insert(sessionB, sobject, [input]);
      expect(r?.errors, JSON.stringify(r?.errors)).toEqual([]);
      return r?.id as string;
    };
    const grand = await ins("Grand__c", { Name: "G" });
    const parent = await ins("Parent__c", { Name: "P", Grand__c: grand });
    await ins("Child__c", { Name: "c1", Parent__c: parent, Qty__c: 2, Price__c: 10, Rate__c: 1 });
    await ins("Child__c", { Name: "c2", Parent__c: parent, Qty__c: 3, Price__c: 5, Rate__c: 1 });
    const gone = await ins("Child__c", { Name: "c3", Parent__c: parent, Qty__c: 100, Price__c: 1 });
    expect((await seed.delete(sessionB, "Child__c", [gone]))[0]?.success).toBe(true);

    upgrade = await migrate(pool, full.schema, { orgSchema: orgB });
    hookLog = [];
    const logging = {
      run: (ctx: TriggerContext): Promise<void> => {
        hookLog.push(`${ctx.sobject.name}.${ctx.operation}.${ctx.timing}`);
        return Promise.resolve();
      },
    };
    engineB = new DmlEngine(pool, full.schema, { orgSchema: orgB, executors: [logging] });
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await pool.query(`DROP SCHEMA IF EXISTS ${quote(orgB)} CASCADE`);
    await pool.query(`DELETE FROM "_orglet"."rollup_backfills" WHERE org_schema = $1`, [orgB]);
  });

  it("backfills a formula roll-up added to tables with rows once, lower chain levels first, without parent hooks", async () => {
    expect(upgrade.statements.filter((s) => s.includes('SET "sum_line__c"'))).toEqual([]);
    expect(upgrade.pendingBackfills).toContainEqual({ object: "Parent__c", field: "Sum_Line__c" });

    firstRun = await engineB.backfillFormulaRollups();
    expect(firstRun).toContain("Parent__c.Sum_Line__c");
    expect(firstRun).toContain("Grand__c.Sum_Score__c");
    expect(firstRun.indexOf("Parent__c.Sum_Line__c")).toBeLessThan(firstRun.indexOf("Grand__c.Sum_Score__c"));

    expect(await parentCol("sum_line__c")).toBe(35);
    expect(await parentCol("sum_third__c")).toBe(0.66);
    expect(await parentCol("max_outer__c")).toBe(7);
    expect(Number((await pool.query<{ v: string }>(`SELECT sum_score__c AS v FROM ${quote(orgB)}.grand__c`)).rows[0]?.v)).toBe(70);
    expect(hookLog).toEqual([]);
    expect(await markers()).toBe(firstRun.length);
    expect(full.warnings.filter((w) => w.includes("UNSUPPORTED:rollup-formula"))).toEqual(["UNSUPPORTED:rollup-formula Parent__c.Sum_Age__c: Child__c.Age__c uses TODAY(); field skipped"]);
  });

  it("a second backfill runs nothing", async () => {
    await pool.query(`UPDATE ${quote(orgB)}.parent__c SET sum_line__c = -1`);
    expect(await engineB.backfillFormulaRollups()).toEqual([]);
    expect(await parentCol("sum_line__c")).toBe(-1);
    await pool.query(`UPDATE ${quote(orgB)}.parent__c SET sum_line__c = 35`);
  });

  it("a second up on a completed database runs no backfill and no UPDATE", async () => {
    const count = await markers();
    const again = await migrate(pool, full.schema, { orgSchema: orgB });
    expect(again.pendingBackfills).toEqual([]);
    expect(again.statements.filter((s) => /^UPDATE/i.test(s))).toEqual([]);

    const sqls: string[] = [];
    const connect = pool.connect.bind(pool) as unknown as (...a: unknown[]) => Promise<PoolClient>;
    vi.spyOn(pool, "connect").mockImplementation(((...args: unknown[]) => {
      // pool.query() calls connect(callback) internally: pass those through untouched.
      if (args.length > 0) return connect(...args);
      return wrap(connect());
    }) as never);
    const wrap = async (pending: Promise<PoolClient>) => {
      const c = await pending;
      const q = c.query.bind(c) as (...a: unknown[]) => Promise<unknown>;
      (c as unknown as { query: unknown }).query = (...a: unknown[]) => {
        if (typeof a[0] === "string") sqls.push(a[0]);
        return q(...a);
      };
      return c;
    };
    const qs = vi.spyOn(pool, "query");
    expect(await engineB.backfillFormulaRollups()).toEqual([]);
    const all = [...sqls, ...qs.mock.calls.map((c) => String(c[0]))];
    vi.restoreAllMocks();
    expect(all.filter((s) => /^\s*UPDATE/i.test(s))).toEqual([]);
    expect(await markers()).toBe(count);
  });

  it("a missing marker row is redone after a crash", async () => {
    await pool.query(`DELETE FROM "_orglet"."rollup_backfills" WHERE org_schema = $1 AND object_name = 'Parent__c' AND field_name = 'Sum_Line__c'`, [orgB]);
    await pool.query(`UPDATE ${quote(orgB)}.parent__c SET sum_line__c = -1`);
    expect(await engineB.backfillFormulaRollups()).toEqual(["Parent__c.Sum_Line__c"]);
    expect(await parentCol("sum_line__c")).toBe(35);
  });

  it("backfills in import mode too", async () => {
    await pool.query(`DELETE FROM "_orglet"."rollup_backfills" WHERE org_schema = $1`, [orgB]);
    const imp = new DmlEngine(pool, full.schema, { orgSchema: orgB, importMode: true });
    expect([...(await imp.backfillFormulaRollups())].sort()).toEqual([...firstRun].sort());
  });

  it("a roll-up skipped at admission answers INVALID_FIELD in SOQL", async () => {
    const cols = await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'parent__c' AND column_name = 'sum_age__c'`, [orgB]);
    expect(cols.rows).toEqual([]);
    await expect(runQuery(engineB, sessionB, "SELECT Sum_Age__c FROM Parent__c")).rejects.toMatchObject({ errorCode: "INVALID_FIELD" });
  });
});
