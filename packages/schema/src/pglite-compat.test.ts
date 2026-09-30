/**
 * Pins the Postgres features that migrate.ts and import mode depend on, against whichever backend
 * the suite runs on. On embedded pglite this is the D-19 compatibility check: if a pglite upgrade
 * breaks one of these, this file fails first and names the feature, before the larger suites do.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { withTransaction, type Pool } from "./db.js";
import { quote } from "./columns.js";
import { openTestDb, usingPglite, type TestDb } from "../../../test/db.js";

const orgSchema = `test_${randomBytes(4).toString("hex")}`;
const s = quote(orgSchema);
let testDb: TestDb;
let pool: Pool;

beforeAll(async () => {
  testDb = await openTestDb();
  pool = testDb.pool;
  await pool.query(`CREATE SCHEMA ${s}`);
  await pool.query(`CREATE TABLE ${s}.parent (id char(18) PRIMARY KEY, amount numeric(18,2), stamp timestamptz, label varchar(255))`);
  await pool.query(`CREATE TABLE ${s}.child (id char(18) PRIMARY KEY, parent_id char(18) CONSTRAINT child_parent_fk REFERENCES ${s}.parent(id))`);
});

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${s} CASCADE`);
  await testDb.close();
});

describe("backend compatibility", () => {
  it("describes columns through information_schema.columns exactly as migrate.ts reads them", async () => {
    const res = await pool.query<{ table_name: string; column_name: string; data_type: string; character_maximum_length: number | null; numeric_precision: number | null; numeric_scale: number | null }>(
      `SELECT table_name, column_name, data_type, character_maximum_length, numeric_precision, numeric_scale
         FROM information_schema.columns
        WHERE table_schema = $1
        ORDER BY table_name, ordinal_position`,
      [orgSchema],
    );
    expect(res.rows).toEqual([
      { table_name: "child", column_name: "id", data_type: "character", character_maximum_length: 18, numeric_precision: null, numeric_scale: null },
      { table_name: "child", column_name: "parent_id", data_type: "character", character_maximum_length: 18, numeric_precision: null, numeric_scale: null },
      { table_name: "parent", column_name: "id", data_type: "character", character_maximum_length: 18, numeric_precision: null, numeric_scale: null },
      { table_name: "parent", column_name: "amount", data_type: "numeric", character_maximum_length: null, numeric_precision: 18, numeric_scale: 2 },
      { table_name: "parent", column_name: "stamp", data_type: "timestamp with time zone", character_maximum_length: null, numeric_precision: null, numeric_scale: null },
      { table_name: "parent", column_name: "label", data_type: "character varying", character_maximum_length: 255, numeric_precision: null, numeric_scale: null },
    ]);
  });

  it("lists tables through information_schema.tables and constraints through pg_constraint", async () => {
    const tables = await pool.query<{ table_name: string }>(`SELECT table_name FROM information_schema.tables WHERE table_schema = $1 ORDER BY table_name`, [orgSchema]);
    expect(tables.rows.map((r) => r.table_name)).toEqual(["child", "parent"]);
    const constraints = await pool.query<{ conname: string }>(
      `SELECT c.conname FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = $1`,
      [orgSchema],
    );
    expect(constraints.rows.map((r) => r.conname)).toContain("child_parent_fk");
  });

  it("scopes SET LOCAL session_replication_role = replica to the transaction", async () => {
    const inside = await withTransaction(pool, async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      return (await client.query<{ session_replication_role: string }>("SHOW session_replication_role")).rows[0]?.session_replication_role;
    });
    const after = (await pool.query<{ session_replication_role: string }>("SHOW session_replication_role")).rows[0]?.session_replication_role;
    expect(inside).toBe("replica");
    expect(after).toBe("origin");
  });

  it("lets import mode insert a child before its parent, and enforces the foreign key otherwise", async () => {
    await withTransaction(pool, async (client) => {
      await client.query("SET LOCAL session_replication_role = replica");
      await client.query(`INSERT INTO ${s}.child (id, parent_id) VALUES ('a01000000000001AAA', 'a00000000000404AAA')`);
    });
    await expect(pool.query(`INSERT INTO ${s}.child (id, parent_id) VALUES ('a01000000000002AAA', 'a00000000000404AAA')`)).rejects.toMatchObject({ code: "23503" });
  });

  it("runs two open transactions on separate connections at the same time", async ({ skip }) => {
    skip(usingPglite, "Postgres-only: pglite-socket runs every connection through one query queue, so a second open transaction waits for the first");
    const a = await pool.connect();
    const b = await pool.connect();
    try {
      await a.query("BEGIN");
      await b.query("BEGIN");
      await a.query(`INSERT INTO ${s}.parent (id) VALUES ('a00000000000001AAA')`);
      await b.query(`INSERT INTO ${s}.parent (id) VALUES ('a00000000000002AAA')`);
      await a.query("COMMIT");
      await b.query("COMMIT");
    } finally {
      a.release();
      b.release();
    }
    const res = await pool.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${s}.parent`);
    expect(res.rows[0]?.n).toBe(2);
  });
});
