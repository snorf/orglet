/**
 * The Phase 15 contract for upgrading a v1.1 database (D-02): a database built by v1.1 (frozen snapshot in
 * packages/metadata/test/fixtures/baseline-v1.1) may hold ContentVersion rows without a ContentDocumentId, which the
 * current baseline declares NOT NULL. migrate never rewrites rows, so the upgrade keeps every row, skips the constraint
 * and prints one UNSUPPORTED:schema-notnull warning per run until the row is corrected; EXPECTED_WARNINGS lists the one
 * warning the fixture's NULL row must cause. Same `up()` sequence as cli/src/main.ts and upgrade.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { buildOrgSchema, loadBaseline, readSourceProject, type OrgSchema } from "@orglet/metadata";
import { dropKeyPrefixes, migrate, quote, reconcileKeyPrefixes, type Pool } from "@orglet/schema";
import { openTestDb, type TestDb } from "../../../test/db.js";
import { bootstrapOrg } from "./bootstrap.js";
import { DmlEngine } from "./engine.js";
import { planCustomMetadataSeed, seedCustomMetadata } from "./seed.js";
import type { Session } from "./hooks.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));
const V11_BASELINE = fileURLToPath(new URL("../../metadata/test/fixtures/baseline-v1.1/", import.meta.url));
/** The tables Phase 15 adds on top of v1.1; the only CREATE TABLE statements the upgrade may emit. */
const NEW_TABLES = ["contentdocumentlink"];
/** One ContentVersion (B) in the fixture has no ContentDocumentId. */
const EXPECTED_WARNINGS = ["UNSUPPORTED:schema-notnull column contentversion.contentdocumentid holds 1 row(s) with NULL; NOT NULL not applied; correct them and run orglet up again"];
const orgSchema = `test_${randomBytes(4).toString("hex")}`;

let testDb: TestDb;
let pool: Pool;
let session: Session;
let documentId: string;
let looseVersionId: string;
let before: Record<string, unknown[]>;
const V11_COLUMNS: Record<string, string[]> = {};

const schemaFrom = async (dir?: string): Promise<OrgSchema> =>
  buildOrgSchema(dir === undefined ? await loadBaseline() : await loadBaseline(dir), await readSourceProject(ACME)).schema;

const up = async (schema: OrgSchema) => {
  const prefixes = await reconcileKeyPrefixes(pool, schema, { orgSchema });
  const migration = await migrate(pool, schema, { orgSchema });
  const boot = await bootstrapOrg(pool, schema, { orgSchema });
  const seed = await seedCustomMetadata(pool, schema, planCustomMetadataSeed(schema, []), { orgSchema, userId: boot.session.userId });
  return { prefixes, migration, boot, seed };
};

const TABLES = ["contentdocument", "contentversion"] as const;
const snapshot = async (): Promise<Record<string, unknown[]>> =>
  Object.fromEntries(
    await Promise.all(
      TABLES.map(async (t) => {
        const cols = (V11_COLUMNS[t] ?? []).map(quote).join(", ");
        return [t, (await pool.query(`SELECT ${cols} FROM ${quote(orgSchema)}.${quote(t)} ORDER BY "id"`)).rows] as const;
      }),
    ),
  );

const isNullable = async (): Promise<string | undefined> =>
  (
    await pool.query<{ is_nullable: string }>(
      "SELECT is_nullable FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'contentversion' AND column_name = 'contentdocumentid'",
      [orgSchema],
    )
  ).rows[0]?.is_nullable;

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

describe("upgrading a populated v1.1 database with the current code (Phase 15 D-02)", () => {
  it("a v1.1 org holding ContentVersions with and without a ContentDocumentId is built", async () => {
    const v11 = await schemaFrom(V11_BASELINE);
    session = (await up(v11)).boot.session;

    // The structural rule is keyed by name, so today's migrate already made the column NOT NULL on the v1.1 schema; v1.1's own code did not.
    await pool.query(`ALTER TABLE ${quote(orgSchema)}."contentversion" ALTER COLUMN "contentdocumentid" DROP NOT NULL`);

    // Import mode: v1.1 has ContentDocument as createable:false and no auto-document step.
    const importer = new DmlEngine(pool, v11, { orgSchema, importMode: true });
    documentId = await insertOk(importer, "ContentDocument", { Title: "Spec" });
    await insertOk(importer, "ContentVersion", { Title: "Spec", PathOnClient: "spec.pdf", ContentDocumentId: documentId });
    looseVersionId = await insertOk(importer, "ContentVersion", { Title: "Loose", PathOnClient: "loose.txt" });

    for (const t of TABLES) {
      const cols = await pool.query<{ column_name: string }>(
        "SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position",
        [orgSchema, t],
      );
      V11_COLUMNS[t] = cols.rows.map((r) => r.column_name);
    }
    before = await snapshot();
    expect(before["contentdocument"]).toHaveLength(1);
    expect(before["contentversion"]).toHaveLength(2);
    expect(await isNullable()).toBe("YES");
  });

  it("the upgrade keeps every row, adds versiondata and contentdocumentlink, and skips NOT NULL with one schema-notnull warning", async () => {
    const { migration } = await up(await schemaFrom());
    expect(migration.warnings).toEqual(EXPECTED_WARNINGS);
    expect(migration.statements.some((s) => /ADD COLUMN "versiondata" bytea/.test(s))).toBe(true);
    const created = migration.statements.filter((s) => s.startsWith("CREATE TABLE")).map((s) => /^CREATE TABLE "[^"]+"\."([^"]+)"/.exec(s)?.[1]);
    expect(created).toEqual(NEW_TABLES);
    expect(migration.statements.filter((s) => /DROP TABLE|DROP COLUMN|ALTER COLUMN .* TYPE|SET NOT NULL/.test(s))).toEqual([]);
    expect(await snapshot()).toEqual(before);
    expect(await isNullable()).toBe("YES");
  });

  it("a second up re-evaluates and warns again without changing anything", async () => {
    const again = await migrate(pool, await schemaFrom(), { orgSchema });
    expect(again.warnings).toEqual(EXPECTED_WARNINGS);
    expect(again.statements.filter((s) => /^(CREATE|ALTER)/.test(s) && !s.startsWith("CREATE SCHEMA"))).toEqual([]);
    expect(await snapshot()).toEqual(before);
  });

  it("after the user corrects the row, the next up applies NOT NULL", async () => {
    await pool.query(`UPDATE ${quote(orgSchema)}."contentversion" SET "contentdocumentid" = $1 WHERE "id" = $2`, [documentId, looseVersionId]);
    const { migration } = await up(await schemaFrom());
    expect(migration.warnings).toEqual([]);
    expect(migration.statements.some((s) => s.includes('ALTER COLUMN "contentdocumentid" SET NOT NULL'))).toBe(true);
    expect(await isNullable()).toBe("NO");
  });
});
