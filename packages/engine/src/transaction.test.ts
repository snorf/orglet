/**
 * The Bulk ingest route commits each chunk's DML and its result rows in one transaction, so the
 * engine must be able to join a caller's transaction without breaking it: savepoint-scoped
 * rollback, no transaction control of its own, and change events only after the outer COMMIT.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { loadOrgSchema, type OrgSchema } from "@orglet/metadata";
import { migrate, quote, type Pool, type PoolClient } from "@orglet/schema";
import { openTestDb, type TestDb } from "../../../test/db.js";
import { bootstrapOrg } from "./bootstrap.js";
import { DmlEngine } from "./engine.js";
import type { ChangeEvent } from "./events.js";
import type { Session } from "./hooks.js";
import { runQuery } from "./query.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));
const orgSchema = `test_${randomBytes(4).toString("hex")}`;

let testDb: TestDb;
let pool: Pool;
let schema: OrgSchema;
let engine: DmlEngine;
let session: Session;
const published: ChangeEvent[] = [];

beforeAll(async () => {
  testDb = await openTestDb();
  pool = testDb.pool;
  schema = (await loadOrgSchema({ projectDir: ACME })).schema;
  await migrate(pool, schema, { orgSchema });
  session = (await bootstrapOrg(pool, schema, { orgSchema })).session;
  engine = new DmlEngine(pool, schema, { orgSchema });
  engine.bus.subscribe((e) => {
    published.push(...e);
  });
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${quote(orgSchema)} CASCADE`);
  await testDb.close();
});

// Only call when no transaction is open: pglite-socket would queue a second connection behind it.
async function names(prefix: string): Promise<string[]> {
  const page = await runQuery(engine, session, `SELECT Name FROM Account WHERE Name LIKE '${prefix}%' ORDER BY Name`);
  return page.records.map((r) => String(r["Name"]));
}

describe("DML on a caller-supplied transaction", () => {
  it("events_are_published_only_after_the_outer_commit", async () => {
    const before = published.length;
    let id = "";
    let seenByListener = -1;
    const off = engine.bus.subscribe(async () => {
      seenByListener = (await runQuery(engine, session, "SELECT Id FROM Account WHERE Name = 'Tx Commit'")).totalSize;
    });
    await engine.transaction(async (tx) => {
      const [r] = await engine.insert(session, "Account", [{ Name: "Tx Commit" }], { transaction: tx });
      expect(r?.success).toBe(true);
      id = r?.id ?? "";
      expect(published.length).toBe(before);
      expect(tx.events).toHaveLength(1);
    });
    if (typeof off === "function") off();
    expect(published.length).toBe(before + 1);
    expect(published[before]?.recordIds).toContain(id);
    expect(await names("Tx Commit")).toEqual(["Tx Commit"]);
    expect(seenByListener).toBe(1);
  });

  it("allornone_failure_unwinds_only_the_engines_work", async () => {
    const before = published.length;
    const ids: string[] = [];
    await engine.transaction(async (tx) => {
      const [keep] = await engine.insert(session, "Account", [{ Name: "Tx Keep" }], { transaction: tx });
      expect(keep?.success).toBe(true);
      ids.push(keep?.id ?? "");
      const failed = await engine.insert(session, "Account", [{ Name: "Tx Gone" }, {}], { allOrNone: true, transaction: tx });
      expect(failed.map((f) => f.success)).toEqual([false, false]);
      expect(failed[0]?.errors[0]?.statusCode).toBe("ALL_OR_NONE_OPERATION_ROLLED_BACK");
      expect(failed[1]?.errors[0]?.statusCode).toBe("REQUIRED_FIELD_MISSING");
      const [after] = await engine.insert(session, "Account", [{ Name: "Tx After" }], { transaction: tx });
      expect(after?.success).toBe(true);
      ids.push(after?.id ?? "");
    });
    expect(await names("Tx ")).toEqual(expect.arrayContaining(["Tx Keep", "Tx After"]));
    expect(await names("Tx Gone")).toEqual([]);
    const mine = published.slice(before).flatMap((e) => e.recordIds);
    expect(mine.sort()).toEqual([...ids].sort());
  });

  it("a_thrown_error_rolls_back_to_the_savepoint_and_keeps_the_callers_transaction", async () => {
    const boom = new DmlEngine(pool, schema, {
      orgSchema,
      executors: [{ run: (ctx) => (ctx.timing === "before" && ctx.records.some((r) => r["Name"] === "Tx Boom") ? Promise.reject(new Error("boom")) : Promise.resolve()) }],
    });
    await boom.transaction(async (tx) => {
      const [first] = await boom.insert(session, "Account", [{ Name: "Tx Before Boom" }], { transaction: tx });
      expect(first?.success).toBe(true);
      await expect(boom.insert(session, "Account", [{ Name: "Tx Boom" }], { transaction: tx })).rejects.toThrow("boom");
      const [after] = await boom.insert(session, "Account", [{ Name: "Tx After Boom" }], { transaction: tx });
      expect(after?.success).toBe(true);
    });
    expect(await names("Tx Before Boom")).toEqual(["Tx Before Boom"]);
    expect(await names("Tx After Boom")).toEqual(["Tx After Boom"]);
    expect(await names("Tx Boom")).toEqual([]);
  });

  it("a_rolled_back_outer_transaction_publishes_nothing", async () => {
    const before = published.length;
    await expect(
      engine.transaction(async (tx) => {
        await engine.insert(session, "Account", [{ Name: "Tx Abandoned" }], { transaction: tx });
        throw new Error("caller gives up");
      }),
    ).rejects.toThrow("caller gives up");
    expect(published.length).toBe(before);
    expect(await names("Tx Abandoned")).toEqual([]);
  });

  it("a_call_on_a_caller_transaction_issues_no_transaction_control_of_its_own", async () => {
    const before = published.length;
    const client: PoolClient = await pool.connect();
    await client.query("BEGIN");
    const connect = vi.spyOn(pool, "connect");
    const spy = vi.spyOn(client, "query");
    const tx = { client, events: [] as ChangeEvent[] };
    await engine.insert(session, "Account", [{ Name: "Tx Manual" }], { transaction: tx });
    const sql = spy.mock.calls.map((c) => {
      const first = c[0] as unknown;
      return (typeof first === "string" ? first : (first as { text: string }).text).trim();
    });
    expect(sql.filter((s) => /^(BEGIN|COMMIT|ROLLBACK)$/i.test(s))).toEqual([]);
    expect(sql).toContain("SAVEPOINT dml_run");
    expect(sql).toContain("RELEASE SAVEPOINT dml_run");
    expect(connect).not.toHaveBeenCalled();
    expect(tx.events).toHaveLength(1);
    expect(published.length).toBe(before);
    spy.mockRestore();
    connect.mockRestore();
    await client.query("ROLLBACK");
    client.release();
    expect(await names("Tx Manual")).toEqual([]);
  });
});
