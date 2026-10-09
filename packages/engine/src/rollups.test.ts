import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { loadOrgSchema, type OrgSchema, type SObjectDef } from "@orglet/metadata";
import { migrate, quote, type Pool } from "@orglet/schema";
import { asString } from "@orglet/formula";
import { openTestDb, type TestDb } from "../../../test/db.js";
import { bootstrapOrg } from "./bootstrap.js";
import { DmlEngine } from "./engine.js";
import type { Session, TriggerContext } from "./hooks.js";
import { affectedParents, RollupRegistry, type RollupBinding, type RollupWork } from "./rollups.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));
const orgSchema = `test_${randomBytes(4).toString("hex")}`;

let testDb: TestDb;
let pool: Pool;
let schema: OrgSchema;
let engine: DmlEngine;
let session: Session;
/** `${timing}:${operation}:${sobject}:${ids}` for every hook invocation. */
const log: string[] = [];
/** Record ids the executor refuses to update (`<Object> is locked`), to drive parent failures through the hook seam. */
const locked = new Set<string>();

beforeAll(async () => {
  testDb = await openTestDb();
  pool = testDb.pool;
  schema = (await loadOrgSchema({ projectDir: ACME })).schema;
  await migrate(pool, schema, { orgSchema });
  session = (await bootstrapOrg(pool, schema, { orgSchema })).session;
  engine = new DmlEngine(pool, schema, {
    orgSchema,
    executors: [
      {
        run: (ctx: TriggerContext) => {
          const ids = (ctx.operation === "delete" ? ctx.old : ctx.records).map((r) => asString(r["Id"])).join(",");
          log.push(`${ctx.timing}:${ctx.operation}:${ctx.sobject.name}:${ids}`);
          if (ctx.timing === "before" && ctx.operation === "update") {
            ctx.records.forEach((r, i) => {
              if (locked.has(asString(r["Id"]))) ctx.addError(i, `${ctx.sobject.name} is locked`);
            });
          }
          return Promise.resolve();
        },
      },
    ],
  });
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

// ---------------------------------------------------------------------------------------------

describe("affectedParents", () => {
  let bindings: RollupBinding[];
  let milestone: SObjectDef;
  const work = (w: Partial<RollupWork>): RollupWork => ({ errors: [], changes: {}, next: {}, ...w });
  const ids = (groups: ReturnType<typeof affectedParents<RollupWork>>, parent: string) => [...(groups.find((g) => g.parent.name === parent)?.ids.keys() ?? [])];
  const NONE: ReadonlySet<string> = new Set<string>();

  beforeAll(() => {
    milestone = schema.getObject("Milestone__c") as SObjectDef;
    bindings = new RollupRegistry(schema).forChild(milestone);
  });

  it("indexes the three Project__c roll-ups under Milestone__c with their watched fields", () => {
    expect(bindings.map((b) => `${b.parent.name}.${b.field.name}`).sort()).toEqual(["Project__c.Milestone_Count__c", "Project__c.Next_Due_Date__c", "Project__c.Open_Milestones__c"]);
    const nextDue = bindings.find((b) => b.field.name === "Next_Due_Date__c") as RollupBinding;
    expect([...nextDue.watched].sort()).toEqual(["Done__c", "Due_Date__c", "Project__c"]);
    expect(new RollupRegistry(schema).forChild(schema.getObject("Contact") as SObjectDef)).toEqual([]);
  });

  it("insert triggers the new parent with every bound field", () => {
    const groups = affectedParents(bindings, [work({ changes: { Project__c: "P1" }, next: { Project__c: "P1" } })], "insert", NONE);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.parent.name).toBe("Project__c");
    expect(ids(groups, "Project__c")).toEqual(["P1"]);
    expect(groups[0]?.fields.map((f) => f.name).sort()).toEqual(["Milestone_Count__c", "Next_Due_Date__c", "Open_Milestones__c"]);
  });

  it("reparent triggers both the old and the new parent and blames the work on both", () => {
    const w = work({ old: { Project__c: "P1" }, next: { Project__c: "P2" }, changes: { Project__c: "P2" } });
    const groups = affectedParents(bindings, [w], "update", NONE);
    expect(ids(groups, "Project__c")).toEqual(["P1", "P2"]);
    expect(groups[0]?.ids.get("P1")).toEqual(new Set([w]));
    expect(groups[0]?.ids.get("P2")).toEqual(new Set([w]));
  });

  it("a filter-only change triggers the parent while an unwatched change does not", () => {
    const done = work({ old: { Project__c: "P1", Done__c: false }, next: { Project__c: "P1", Done__c: true }, changes: { Done__c: true } });
    expect(ids(affectedParents(bindings, [done], "update", NONE), "Project__c")).toEqual(["P1"]);
    const name = work({ old: { Project__c: "P1" }, next: { Project__c: "P1", Name: "x" }, changes: { Name: "x" } });
    expect(affectedParents(bindings, [name], "update", NONE)).toEqual([]);
  });

  it("delete and undelete trigger the old parent", () => {
    const w = work({ old: { Project__c: "P1" } });
    expect(ids(affectedParents(bindings, [w], "delete", NONE), "Project__c")).toEqual(["P1"]);
    expect(ids(affectedParents(bindings, [w], "undelete", NONE), "Project__c")).toEqual(["P1"]);
  });

  it("ignores failed works and parents in the skip set", () => {
    const failed = work({ errors: [{ statusCode: "X" }], next: { Project__c: "P1" } });
    expect(affectedParents(bindings, [failed], "insert", NONE)).toEqual([]);
    const ok = work({ next: { Project__c: "P1" } });
    expect(affectedParents(bindings, [ok], "insert", new Set(["P1"]))).toEqual([]);
  });

  it("blames every live work pointing at a triggered parent, not only the one that triggered it", () => {
    const trigger = work({ old: { Project__c: "P1" }, next: { Project__c: "P1", Done__c: true }, changes: { Done__c: true } });
    const bystander = work({ old: { Project__c: "P1" }, next: { Project__c: "P1", Name: "y" }, changes: { Name: "y" } });
    const groups = affectedParents(bindings, [trigger, bystander], "update", NONE);
    expect(ids(groups, "Project__c")).toEqual(["P1"]);
    expect(groups[0]?.ids.get("P1")).toEqual(new Set([trigger, bystander]));
  });
});

// ---------------------------------------------------------------------------------------------

describe("defaults (D-04)", () => {
  it("new_parent_starts_with_zero_counts_and_null_min_max", async () => {
    const aid = await one("Account", { Name: "Empty Rollups" });
    const pid = await one("Project__c", { Name: "Empty", Account__c: aid, Status__c: "Planned" });
    expect(await get("Project__c", pid)).toMatchObject({ Milestone_Count__c: 0, Open_Milestones__c: 0, Next_Due_Date__c: null });
    expect(await get("Account", aid)).toMatchObject({ Total_Budget__c: 0, Open_Project_Milestones__c: 0, Last_Active_Project_Created__c: null });
  });
});
