/**
 * D-14 (Phase 9): a database built by v1.0 may hold a queue-owned row on an object whose OwnerId is User-only
 * since the baseline was narrowed (Account here; v1.0 accepted any User or Group owner everywhere). Upgrading
 * such a database must take the Phase 8 schema-fk path: the new `fk_account_ownerid` is skipped with one
 * UNSUPPORTED:schema-fk warning, the row is neither deleted nor rewritten, and the FK is added silently on the
 * next run once the owner has been corrected. Kept apart from upgrade.test.ts so the main upgrade fixture
 * stays warning-free (CONTEXT D-14). Runs on pglite by default and on Postgres 16 with ORGLET_DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { buildOrgSchema, loadBaseline, readSourceProject, type OrgSchema } from "@orglet/metadata";
import { dropKeyPrefixes, migrate, quote, reconcileKeyPrefixes, type Pool } from "@orglet/schema";
import { openTestDb, type TestDb } from "../../../test/db.js";
import { bootstrapOrg } from "./bootstrap.js";
import { DmlEngine } from "./engine.js";
import type { Session } from "./hooks.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));
const V1_BASELINE = fileURLToPath(new URL("../../metadata/test/fixtures/baseline-v1.0/", import.meta.url));
const orgSchema = `test_${randomBytes(4).toString("hex")}`;

let testDb: TestDb;
let pool: Pool;
let session: Session;
let groupId: string;
let accountId: string;

const schemaFrom = async (dir?: string): Promise<OrgSchema> =>
  buildOrgSchema(dir === undefined ? await loadBaseline() : await loadBaseline(dir), await readSourceProject(ACME)).schema;

// Same three calls, in the same order, as cli/src/main.ts up().
const up = async (schema: OrgSchema) => {
  const prefixes = await reconcileKeyPrefixes(pool, schema, { orgSchema });
  const migration = await migrate(pool, schema, { orgSchema });
  const boot = await bootstrapOrg(pool, schema, { orgSchema });
  return { prefixes, migration, boot };
};

const ownerOf = async (id: string): Promise<string | null> => {
  const res = await pool.query<{ ownerid: string | null }>(`SELECT "ownerid" FROM ${quote(orgSchema)}."account" WHERE "id" = $1`, [id]);
  return res.rows[0]?.ownerid ?? null;
};

const insertOk = async (engine: DmlEngine, sobject: string, input: Record<string, unknown>): Promise<string> => {
  const [r] = await engine.insert(session, sobject, [input]);
  expect(r?.success, JSON.stringify(r?.errors)).toBe(true);
  return r?.id as string;
};

beforeAll(async () => {
  testDb = await openTestDb();
  pool = testDb.pool;
});

afterAll(async () => {
  await dropKeyPrefixes(pool, orgSchema);
  await pool.query(`DROP SCHEMA IF EXISTS ${quote(orgSchema)} CASCADE`);
  await testDb.close();
});

describe("a v1.0 database with a Group-owned Account (D-14)", () => {
  it("upgrading skips the new Account owner FK with one schema-fk warning and keeps the row", async () => {
    const v1 = await schemaFrom(V1_BASELINE);
    session = (await up(v1)).boot.session;
    // v1.0 declared Account.OwnerId as User or Group, so its engine accepts a queue as the owner.
    const engine = new DmlEngine(pool, v1, { orgSchema });
    groupId = await insertOk(engine, "Group", { Name: "Sales Queue", DeveloperName: "Sales_Queue", Type: "Queue" });
    accountId = await insertOk(engine, "Account", { Name: "Queue-owned Account", OwnerId: groupId });
    const ownerBefore = await ownerOf(accountId);
    expect(ownerBefore).toBe(groupId);

    const { migration } = await up(await schemaFrom());
    expect(migration.warnings).toEqual([
      "UNSUPPORTED:schema-fk foreign key fk_account_ownerid not added: account.ownerid holds 1 value(s) with no matching row in user; correct or clear them and run orglet up again",
    ]);
    expect(migration.statements.filter((s) => /ADD CONSTRAINT "fk_account_ownerid"/.test(s))).toEqual([]);
    expect(await ownerOf(accountId)).toBe(ownerBefore);
  });

  it("once the owner is corrected the next run adds the FK silently", async () => {
    await pool.query(`UPDATE ${quote(orgSchema)}."account" SET "ownerid" = $1 WHERE "id" = $2`, [session.userId, accountId]);
    const again = await migrate(pool, await schemaFrom(), { orgSchema });
    expect(again.warnings).toEqual([]);
    expect(again.statements.filter((s) => /ADD CONSTRAINT "fk_account_ownerid"/.test(s))).toHaveLength(1);
    expect(await ownerOf(accountId)).toBe(session.userId);
  });
});
