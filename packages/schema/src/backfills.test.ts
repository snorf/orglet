/** _orglet.rollup_backfills marker helpers (Phase 13 D-11): per-org completion rows for engine-backfilled formula roll-ups. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { openTestDb, type TestDb } from "../../../test/db.js";
import { completedRollupBackfills, dropRollupBackfills, ensureRollupBackfillTable, markRollupBackfilled, rollupBackfillKey } from "./backfills.js";

let testDb: TestDb;
const orgs: string[] = [];
const freshOrg = () => {
  const s = `test_${randomBytes(4).toString("hex")}`;
  orgs.push(s);
  return s;
};

beforeAll(async () => {
  testDb = await openTestDb();
  await ensureRollupBackfillTable(testDb.pool);
});

afterAll(async () => {
  await testDb.pool.query(`DELETE FROM "_orglet"."rollup_backfills" WHERE org_schema = ANY($1)`, [orgs]);
  await testDb.close();
});

describe("roll-up backfill markers", () => {
  it("creates the marker table idempotently", async () => {
    await ensureRollupBackfillTable(testDb.pool);
    await ensureRollupBackfillTable(testDb.pool);
    const res = await testDb.pool.query<{ t: string | null }>(`SELECT to_regclass('_orglet.rollup_backfills')::text AS t`);
    expect(res.rows[0]?.t).not.toBeNull();
  });

  it("marks a field completed and reads it back case-insensitively", async () => {
    const org = freshOrg();
    await markRollupBackfilled(testDb.pool, org, "Parent__c", "Sum_Line__c");
    await markRollupBackfilled(testDb.pool, org, "Parent__c", "Sum_Line__c");
    const done = await completedRollupBackfills(testDb.pool, org);
    expect(done.has(rollupBackfillKey("parent__c", "SUM_LINE__C"))).toBe(true);
    expect(done.size).toBe(1);
  });

  it("keeps markers per org schema", async () => {
    const a = freshOrg();
    const b = freshOrg();
    await markRollupBackfilled(testDb.pool, a, "Parent__c", "Sum_Line__c");
    expect((await completedRollupBackfills(testDb.pool, b)).size).toBe(0);
  });

  it("drops only the given org's markers and tolerates a missing table", async () => {
    const a = freshOrg();
    const b = freshOrg();
    await markRollupBackfilled(testDb.pool, a, "Parent__c", "Sum_Line__c");
    await markRollupBackfilled(testDb.pool, b, "Parent__c", "Sum_Line__c");
    expect(await dropRollupBackfills(testDb.pool, a)).toBe(1);
    expect((await completedRollupBackfills(testDb.pool, b)).size).toBe(1);

    const fresh = await openTestDb();
    try {
      const exists = await fresh.pool.query<{ t: string | null }>(`SELECT to_regclass('_orglet.rollup_backfills')::text AS t`);
      if (exists.rows[0]?.t === null) {
        expect(await dropRollupBackfills(fresh.pool, a)).toBe(0);
        expect((await completedRollupBackfills(fresh.pool, a)).size).toBe(0);
      }
    } finally {
      await fresh.close();
    }
  });
});
