/**
 * The contract for every baseline change (MIGR-01, D-05..D-07): a database built by v1.0 (frozen snapshot in
 * packages/metadata/test/fixtures/baseline-v1.0) and holding Group-owned and --import rows is upgraded the way
 * `orglet up` does it (reconcileKeyPrefixes -> migrate -> bootstrapOrg, cli/src/main.ts) and must keep every row.
 * Later phases extend EXPECTED_WARNINGS when their baseline change is meant to warn; they never weaken the row or
 * second-run assertions. Since Phase 9 the baseline grows additively: ADD COLUMN and ADD CONSTRAINT are expected,
 * rows are compared on their v1.0 columns, and CREATE/DROP TABLE, DROP COLUMN and ALTER COLUMN ... TYPE stay
 * forbidden. Runs on pglite by default and on Postgres 16 with ORGLET_DATABASE_URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { buildOrgSchema, loadBaseline, readSourceProject, type OrgSchema } from "@orglet/metadata";
import { dropKeyPrefixes, migrate, quote, reconcileKeyPrefixes, toCaseSafeId, type Pool } from "@orglet/schema";
import { openTestDb, type TestDb } from "../../../test/db.js";
import { bootstrapOrg } from "./bootstrap.js";
import { DmlEngine } from "./engine.js";
import type { Session } from "./hooks.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));
const V1_BASELINE = fileURLToPath(new URL("../../metadata/test/fixtures/baseline-v1.0/", import.meta.url));
/** Warnings the current code is expected to print when upgrading the v1.0 fixture org. Phase 9 v2 baseline: none (every change is an ADD COLUMN or an FK the fixture rows satisfy). */
const EXPECTED_WARNINGS: string[] = [];
const TABLES = ["account", "contact", "case", "group"] as const;
const orgSchema = `test_${randomBytes(4).toString("hex")}`;

let testDb: TestDb;
let pool: Pool;
let session: Session;
let before: Record<string, unknown[]>;
/** Column names per table as the v1.0 build created them; later baselines only append columns. */
const V1_COLUMNS: Record<string, string[]> = {};

const schemaFrom = async (dir?: string): Promise<OrgSchema> =>
  buildOrgSchema(dir === undefined ? await loadBaseline() : await loadBaseline(dir), await readSourceProject(ACME)).schema;

// Same three calls, in the same order, as cli/src/main.ts up().
const up = async (schema: OrgSchema) => {
  const prefixes = await reconcileKeyPrefixes(pool, schema, { orgSchema });
  const migration = await migrate(pool, schema, { orgSchema });
  const boot = await bootstrapOrg(pool, schema, { orgSchema });
  return { prefixes, migration, boot };
};

const snapshot = async (): Promise<Record<string, unknown[]>> =>
  Object.fromEntries(
    await Promise.all(
      TABLES.map(async (t) => {
        const cols = (V1_COLUMNS[t] ?? []).map(quote).join(", ");
        return [t, (await pool.query(`SELECT ${cols} FROM ${quote(orgSchema)}.${quote(t)} ORDER BY "id"`)).rows] as const;
      }),
    ),
  );

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

describe("upgrading a populated v1.0 database with the current code (MIGR-01)", () => {
  it("a v1.0 org holding Group-owned and imported rows is built through the real write path", async () => {
    const v1 = await schemaFrom(V1_BASELINE);
    session = (await up(v1)).boot.session;

    const engine = new DmlEngine(pool, v1, { orgSchema });
    const groupId = await insertOk(engine, "Group", { Name: "Support Queue", DeveloperName: "Support_Queue", Type: "Queue", Email: "queue@example.com" });
    const accountId = await insertOk(engine, "Account", { Name: "Live Account" });
    await insertOk(engine, "Contact", { LastName: "Live", AccountId: accountId });
    await insertOk(engine, "Case", { Subject: "Queue-owned case", OwnerId: groupId });
    await insertOk(engine, "Case", { Subject: "User-owned case" });

    const importer = new DmlEngine(pool, v1, { orgSchema, importMode: true });
    const importedAccount = toCaseSafeId("001000000000IMP");
    await insertOk(importer, "Account", {
      Id: importedAccount,
      Name: "Imported Account",
      CreatedDate: "2019-06-01T00:00:00.000+0000",
      CreatedById: session.userId,
      LastModifiedDate: "2019-06-02T00:00:00.000+0000",
      LastModifiedById: session.userId,
    });
    await insertOk(importer, "Contact", { Id: toCaseSafeId("003000000000IMP"), LastName: "Imported", AccountId: importedAccount, CreatedDate: "2020-01-02T03:04:05.000+0000", CreatedById: session.userId });
    await insertOk(importer, "Case", { Id: toCaseSafeId("500000000000IMP"), Subject: "Imported queue case", OwnerId: groupId, CreatedDate: "2020-02-03T04:05:06.000+0000", CreatedById: session.userId });

    for (const t of TABLES) {
      const cols = await pool.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
        [orgSchema, t],
      );
      V1_COLUMNS[t] = cols.rows.map((r) => r.column_name);
    }
    before = await snapshot();
    expect(before["account"]?.length).toBeGreaterThanOrEqual(2);
    expect(before["contact"]?.length).toBeGreaterThanOrEqual(2);
    expect(before["case"]?.length).toBeGreaterThanOrEqual(3);
    expect(before["group"]?.length).toBeGreaterThanOrEqual(1);
  });

  it("upgrading it keeps every row identical on its v1.0 columns, only adds, and warns exactly the expected list", async () => {
    const now = await schemaFrom();
    const { prefixes, migration } = await up(now);
    expect(prefixes.assignments).toEqual([]);
    expect(prefixes.warnings).toEqual([]);
    expect(migration.warnings).toEqual(EXPECTED_WARNINGS);
    const FORBIDDEN = /^(CREATE TABLE|DROP TABLE|ALTER TABLE \S+ DROP COLUMN|ALTER TABLE \S+ ALTER COLUMN \S+ TYPE)/;
    expect(migration.statements.filter((s) => FORBIDDEN.test(s))).toEqual([]);
    // SC5 with the v2 baseline: the upgrade is additive, so new columns must actually be added (not a no-op by accident).
    expect(migration.statements.some((s) => /^ALTER TABLE \S+ ADD COLUMN /.test(s))).toBe(true);
    expect(await snapshot()).toEqual(before);
  });

  it("a second up on the upgraded database is silent and creates no index or sequence", async () => {
    const again = await migrate(pool, await schemaFrom(), { orgSchema });
    expect(again.warnings).toEqual([]);
    expect(again.statements.filter((s) => /^CREATE (UNIQUE )?INDEX|^CREATE SEQUENCE/.test(s))).toEqual([]);
  });
});
