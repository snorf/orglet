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

// ---------------------------------------------------------------------------------------------

/** Live Milestone__c rows pointing at `pid`, straight from the table (what actually committed). */
async function committedMilestones(pid: string): Promise<number> {
  const res = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${quote(orgSchema)}."milestone__c" WHERE "project__c" = $1 AND "isdeleted" = false`, [pid]);
  return Number(res.rows[0]?.n);
}

async function project(account: string, extra: Record<string, unknown> = {}): Promise<string> {
  return one("Project__c", { Name: `P-${randomBytes(2).toString("hex")}`, Account__c: account, Status__c: "Active", ...extra });
}

const milestone = (pid: string, due: string, done = false) => ({ Project__c: pid, Due_Date__c: due, Done__c: done });
const RULE_MESSAGE = "A project can have at most 5 milestones.";

describe("recompute on insert and update (ROLL-04)", () => {
  let pid: string;
  let openId: string;

  it("insert_counts_children_and_applies_the_checkbox_filter", async () => {
    pid = await project(await one("Account", { Name: "Counts" }));
    const results = await engine.insert(session, "Milestone__c", [milestone(pid, "2026-03-01"), milestone(pid, "2026-01-15", true)]);
    expect(results.map((r) => r.success)).toEqual([true, true]);
    openId = results[0]?.id as string;
    expect(await get("Project__c", pid)).toMatchObject({ Milestone_Count__c: 2, Open_Milestones__c: 1, Next_Due_Date__c: "2026-03-01" });
  });

  it("filter_only_update_recomputes_the_parent", async () => {
    expect((await engine.update(session, "Milestone__c", [{ Id: openId, Done__c: true }]))[0]?.success).toBe(true);
    expect(await get("Project__c", pid)).toMatchObject({ Milestone_Count__c: 2, Open_Milestones__c: 0, Next_Due_Date__c: null });
  });

  it("reparent_recomputes_old_and_new_parent", async () => {
    const aid = await one("Account", { Name: "Reparent" });
    const p1 = await project(aid);
    const p2 = await project(aid);
    const [moved] = await engine.insert(session, "Milestone__c", [milestone(p1, "2026-05-01"), milestone(p1, "2026-06-01")]);
    expect(await get("Project__c", p1)).toMatchObject({ Milestone_Count__c: 2, Next_Due_Date__c: "2026-05-01" });
    expect(await get("Project__c", p2)).toMatchObject({ Milestone_Count__c: 0, Next_Due_Date__c: null });
    expect((await engine.update(session, "Milestone__c", [{ Id: moved?.id, Project__c: p2 }]))[0]?.success).toBe(true);
    expect(await get("Project__c", p1)).toMatchObject({ Milestone_Count__c: 1, Open_Milestones__c: 1, Next_Due_Date__c: "2026-06-01" });
    expect(await get("Project__c", p2)).toMatchObject({ Milestone_Count__c: 1, Open_Milestones__c: 1, Next_Due_Date__c: "2026-05-01" });
  });

  it("sum_ignores_children_failing_the_filter", async () => {
    const aid = await one("Account", { Name: "Budgets" });
    const active = await project(aid, { Budget__c: 100, Status__c: "Active" });
    await project(aid, { Budget__c: 50, Status__c: "Done" });
    const created = (await get("Project__c", active))["CreatedDate"];
    expect(typeof created).toBe("string");
    expect(await get("Account", aid)).toMatchObject({ Total_Budget__c: 100, Last_Active_Project_Created__c: created });
    expect((await engine.update(session, "Project__c", [{ Id: active, Status__c: "Done" }]))[0]?.success).toBe(true);
    expect(await get("Account", aid)).toMatchObject({ Total_Budget__c: 0, Last_Active_Project_Created__c: null });
  });

  it("milestone_changes_propagate_to_the_account", async () => {
    const aid = await one("Account", { Name: "Chain" });
    const p = await project(aid);
    const [m] = await engine.insert(session, "Milestone__c", [milestone(p, "2026-07-01"), milestone(p, "2026-07-02")]);
    expect(await get("Account", aid)).toMatchObject({ Open_Project_Milestones__c: 2 });
    expect((await engine.update(session, "Milestone__c", [{ Id: m?.id, Done__c: true }]))[0]?.success).toBe(true);
    expect(await get("Account", aid)).toMatchObject({ Open_Project_Milestones__c: 1 });
  });

  it("upsert_recomputes_like_insert_and_update", async () => {
    const aid = await one("Account", { Name: "Upserts" });
    const row = { Name: "Upserted", Code__c: "UPS-1", Account__c: aid, Status__c: "Active", Budget__c: 10 };
    expect((await engine.upsert(session, "Project__c", "Code__c", [row]))[0]).toMatchObject({ success: true, created: true });
    expect(await get("Account", aid)).toMatchObject({ Total_Budget__c: 10 });
    expect((await engine.upsert(session, "Project__c", "Code__c", [{ ...row, Budget__c: 20 }]))[0]).toMatchObject({ success: true, created: false });
    expect(await get("Account", aid)).toMatchObject({ Total_Budget__c: 20 });
  });
});

describe("parent rules, hooks and failure attribution (ROLL-05, D-01..D-03)", () => {
  it("parent_rule_blocks_the_child_insert_with_the_parent_message", async () => {
    const p = await project(await one("Account", { Name: "Limit" }));
    const five = await engine.insert(session, "Milestone__c", Array.from({ length: 5 }, (_, i) => milestone(p, `2026-08-0${i + 1}`)));
    expect(five.map((r) => r.success)).toEqual([true, true, true, true, true]);
    const [sixth] = await engine.insert(session, "Milestone__c", [milestone(p, "2026-08-06")]);
    expect(sixth?.success).toBe(false);
    expect(sixth?.errors).toEqual([{ statusCode: "FIELD_CUSTOM_VALIDATION_EXCEPTION", message: RULE_MESSAGE, fields: [] }]);
    expect(await committedMilestones(p)).toBe(5);
    expect(await get("Project__c", p)).toMatchObject({ Milestone_Count__c: 5 });
  });

  it("parent_hooks_run_after_the_child_after_hooks", async () => {
    const aid = await one("Account", { Name: "Order" });
    const p = await project(aid);
    log.length = 0;
    const [m] = await engine.insert(session, "Milestone__c", [milestone(p, "2026-09-01")]);
    const at = (entry: string) => {
      const i = log.indexOf(entry);
      expect(i, `${entry} missing from ${JSON.stringify(log)}`).toBeGreaterThanOrEqual(0);
      return i;
    };
    expect(at(`after:insert:Milestone__c:${m?.id}`)).toBeLessThan(at(`before:update:Project__c:${p}`));
    expect(at(`before:update:Project__c:${p}`)).toBeLessThan(at(`after:update:Project__c:${p}`));
    expect(at(`after:update:Project__c:${p}`)).toBeLessThan(at(`before:update:Account:${aid}`));
  });

  it("partial_success_batch_counts_only_committed_children", async () => {
    const p = await project(await one("Account", { Name: "Partial" }));
    const results = await engine.insert(session, "Milestone__c", [milestone(p, "2026-10-01"), { Project__c: p, Done__c: false }, milestone(p, "2026-10-03")]);
    expect(results.map((r) => r.success)).toEqual([true, false, true]);
    expect(results[1]?.errors.map((e) => e.statusCode)).toEqual(["REQUIRED_FIELD_MISSING"]);
    expect(await get("Project__c", p)).toMatchObject({ Milestone_Count__c: 2 });
    expect(await committedMilestones(p)).toBe(2);
  });

  it("failed_parent_rolls_back_only_its_own_children", async () => {
    const aid = await one("Account", { Name: "Two Parents" });
    const pa = await project(aid);
    const pb = await project(aid);
    await engine.insert(session, "Milestone__c", Array.from({ length: 5 }, (_, i) => milestone(pa, `2026-11-0${i + 1}`)));
    const results = await engine.insert(session, "Milestone__c", [milestone(pa, "2026-11-06"), milestone(pb, "2026-11-07"), milestone(pa, "2026-11-08")]);
    expect(results.map((r) => r.success)).toEqual([false, true, false]);
    expect(results[0]?.errors.map((e) => e.message)).toEqual([RULE_MESSAGE]);
    expect(results[2]?.errors.map((e) => e.message)).toEqual([RULE_MESSAGE]);
    expect(await get("Project__c", pa)).toMatchObject({ Milestone_Count__c: 5 });
    expect(await committedMilestones(pa)).toBe(5);
    expect(await get("Project__c", pb)).toMatchObject({ Milestone_Count__c: 1 });
    expect(await committedMilestones(pb)).toBe(1);
  });

  it("locked_parent_fails_its_children_through_the_hook_seam", async () => {
    const p = await project(await one("Account", { Name: "Locked" }));
    locked.add(p);
    try {
      const [m] = await engine.insert(session, "Milestone__c", [milestone(p, "2026-12-01")]);
      expect(m?.success).toBe(false);
      expect(m?.errors).toMatchObject([{ statusCode: "FIELD_CUSTOM_VALIDATION_EXCEPTION", message: "Project__c is locked" }]);
      expect(await committedMilestones(p)).toBe(0);
      expect(await get("Project__c", p)).toMatchObject({ Milestone_Count__c: 0 });
    } finally {
      locked.delete(p);
    }
  });

  it("reparent_with_a_failing_old_parent_keeps_both_parents_unchanged", async () => {
    const aid = await one("Account", { Name: "Stranded" });
    const p1 = await project(aid);
    const p2 = await project(aid);
    const [m] = await engine.insert(session, "Milestone__c", [milestone(p1, "2027-01-01")]);
    locked.add(p1);
    try {
      const [moved] = await engine.update(session, "Milestone__c", [{ Id: m?.id, Project__c: p2 }]);
      expect(moved?.success).toBe(false);
      expect(moved?.errors.map((e) => e.message)).toEqual(["Project__c is locked"]);
      expect(await get("Milestone__c", m?.id as string)).toMatchObject({ Project__c: p1 });
      expect(await get("Project__c", p1)).toMatchObject({ Milestone_Count__c: 1, Next_Due_Date__c: "2027-01-01" });
      expect(await get("Project__c", p2)).toMatchObject({ Milestone_Count__c: 0, Next_Due_Date__c: null });
      expect(await committedMilestones(p1)).toBe(1);
      expect(await committedMilestones(p2)).toBe(0);
    } finally {
      locked.delete(p1);
    }
  });

  it("recompute_does_not_stamp_the_parent_last_modified_date", async () => {
    const p = await project(await one("Account", { Name: "Stamps" }));
    const before = await get("Project__c", p);
    await one("Milestone__c", milestone(p, "2027-02-01"));
    const after = await get("Project__c", p);
    expect(before["Milestone_Count__c"]).toBe(0);
    expect(after["Milestone_Count__c"]).toBe(1);
    expect(after["LastModifiedDate"]).toBe(before["LastModifiedDate"]);
    expect(after["SystemModstamp"]).toBe(before["SystemModstamp"]);
  });

  it("unchanged_rollups_skip_the_parent_save", async () => {
    const aid = await one("Account", { Name: "Quiet" });
    log.length = 0;
    await project(aid, { Status__c: "Planned" });
    expect(log.filter((e) => e.startsWith("before:update:Account:"))).toEqual([]);
    expect(log.filter((e) => e.startsWith("after:update:Account:"))).toEqual([]);
    expect(await get("Account", aid)).toMatchObject({ Total_Budget__c: 0, Open_Project_Milestones__c: 0, Last_Active_Project_Created__c: null });
  });
});

describe("import mode (D-09)", () => {
  it("import_mode_keeps_supplied_rollup_values", async () => {
    const importer = new DmlEngine(pool, schema, { orgSchema, importMode: true, executors: [{ run: () => Promise.reject(new Error("hooks must not run")) }] });
    const aid = await one("Account", { Name: "Imported" });
    const [p] = await importer.insert(session, "Project__c", [{ Name: "Imported", Account__c: aid, Status__c: "Active", Milestone_Count__c: 42 }]);
    expect(p, JSON.stringify(p?.errors)).toMatchObject({ success: true });
    const pid = p?.id as string;
    expect(await get("Project__c", pid)).toMatchObject({ Milestone_Count__c: 42 });
    const [m] = await importer.insert(session, "Milestone__c", [milestone(pid, "2027-03-01")]);
    expect(m, JSON.stringify(m?.errors)).toMatchObject({ success: true });
    expect(await get("Project__c", pid)).toMatchObject({ Milestone_Count__c: 42 });
  });
});

// ---------------------------------------------------------------------------------------------

describe("recompute on delete and undelete (ROLL-04)", () => {
  let aid: string;
  let pid: string;
  let m1: string;
  let m2: string;

  it("delete_recomputes_the_parent", async () => {
    aid = await one("Account", { Name: "Deletes" });
    pid = await project(aid);
    const [a, b] = await engine.insert(session, "Milestone__c", [milestone(pid, "2026-04-01"), milestone(pid, "2026-05-01")]);
    m1 = a?.id as string;
    m2 = b?.id as string;
    expect(await get("Project__c", pid)).toMatchObject({ Milestone_Count__c: 2, Open_Milestones__c: 2, Next_Due_Date__c: "2026-04-01" });
    expect((await engine.delete(session, "Milestone__c", [m1]))[0]?.success).toBe(true);
    expect(await get("Project__c", pid)).toMatchObject({ Milestone_Count__c: 1, Open_Milestones__c: 1, Next_Due_Date__c: "2026-05-01" });
  });

  it("count_sum_zero_and_min_max_null_when_last_child_deleted", async () => {
    expect((await engine.delete(session, "Milestone__c", [m2]))[0]?.success).toBe(true);
    expect(await get("Project__c", pid)).toMatchObject({ Milestone_Count__c: 0, Open_Milestones__c: 0, Next_Due_Date__c: null });
    expect(await get("Account", aid)).toMatchObject({ Open_Project_Milestones__c: 0 });
  });

  it("count_excludes_soft_deleted_children", async () => {
    const res = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${quote(orgSchema)}."milestone__c" WHERE "project__c" = $1`, [pid]);
    expect(Number(res.rows[0]?.n)).toBe(2);
    expect(await get("Project__c", pid)).toMatchObject({ Milestone_Count__c: 0 });
  });

  it("undelete_recomputes_the_parent", async () => {
    expect((await engine.undelete(session, "Milestone__c", [m1, m2])).map((r) => r.success)).toEqual([true, true]);
    expect(await get("Project__c", pid)).toMatchObject({ Milestone_Count__c: 2, Open_Milestones__c: 2, Next_Due_Date__c: "2026-04-01" });
    expect(await get("Account", aid)).toMatchObject({ Open_Project_Milestones__c: 2 });
  });

  it("cascade_delete_of_a_project_skips_its_own_recompute_and_updates_the_account", async () => {
    const acct = await one("Account", { Name: "Cascade Rollups" });
    const p = await project(acct, { Budget__c: 70, Status__c: "Active" });
    await engine.insert(session, "Milestone__c", [milestone(p, "2026-06-01"), milestone(p, "2026-06-02")]);
    expect(await get("Account", acct)).toMatchObject({ Total_Budget__c: 70, Open_Project_Milestones__c: 2 });
    log.length = 0;
    expect((await engine.delete(session, "Project__c", [p]))[0]?.success).toBe(true);
    expect(log.filter((e) => e.startsWith(`before:update:Project__c:${p}`) || e.startsWith(`after:update:Project__c:${p}`))).toEqual([]);
    expect(log).toContain(`before:update:Account:${acct}`);
    expect(await get("Account", acct)).toMatchObject({ Total_Budget__c: 0, Open_Project_Milestones__c: 0, Last_Active_Project_Created__c: null });
    expect((await engine.undelete(session, "Project__c", [p]))[0]?.success).toBe(true);
    expect(await get("Account", acct)).toMatchObject({ Total_Budget__c: 70, Open_Project_Milestones__c: 2 });
    expect(await get("Project__c", p)).toMatchObject({ Milestone_Count__c: 2 });
  });

  it("delete_refused_by_the_parent_keeps_the_child", async () => {
    locked.add(pid);
    try {
      const [r] = await engine.delete(session, "Milestone__c", [m1]);
      expect(r?.success).toBe(false);
      expect(r?.errors).toMatchObject([{ statusCode: "FIELD_CUSTOM_VALIDATION_EXCEPTION", message: "Project__c is locked" }]);
      expect(await get("Milestone__c", m1)).toMatchObject({ IsDeleted: false });
      expect(await get("Project__c", pid)).toMatchObject({ Milestone_Count__c: 2 });
      expect(await committedMilestones(pid)).toBe(2);
    } finally {
      locked.delete(pid);
    }
  });

  it("undelete_refused_by_the_parent_keeps_the_child_deleted", async () => {
    expect((await engine.delete(session, "Milestone__c", [m1]))[0]?.success).toBe(true);
    expect(await get("Project__c", pid)).toMatchObject({ Milestone_Count__c: 1 });
    locked.add(pid);
    try {
      const [r] = await engine.undelete(session, "Milestone__c", [m1]);
      expect(r?.success).toBe(false);
      expect(r?.errors.map((e) => e.message)).toEqual(["Project__c is locked"]);
      expect((await engine.retrieve(session, "Milestone__c", [m1], { includeDeleted: true })).get(m1)?.["IsDeleted"]).toBe(true);
      expect(await get("Project__c", pid)).toMatchObject({ Milestone_Count__c: 1 });
      expect(await committedMilestones(pid)).toBe(1);
    } finally {
      locked.delete(pid);
    }
  });

  it("delete_of_an_account_cascades_without_recomputing_deleted_parents", async () => {
    const acct = await one("Account", { Name: "Whole Chain" });
    const p = await project(acct);
    await one("Milestone__c", milestone(p, "2026-07-01"));
    log.length = 0;
    expect((await engine.delete(session, "Account", [acct]))[0]?.success).toBe(true);
    expect(log.filter((e) => e.includes(`update:Project__c:${p}`) || e.includes(`update:Account:${acct}`))).toEqual([]);
    expect(log.some((e) => e.startsWith("after:delete:Milestone__c:"))).toBe(true);
  });
});
