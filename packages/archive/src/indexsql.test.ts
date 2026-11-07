/** The index DDL and renderer, loaded into a real (in-process) Postgres. */
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderIndexSql, type IndexRows } from "./indexsql.js";

const rows: IndexRows = {
  csvfiles: [
    { csvId: 2, period: 2602, s3path: "OrgId=00D000000000001EAA/Period=202602/Year=2026/Month=02/Date=03/Contact/b.csv" },
    { csvId: 1, period: 2601, s3path: "OrgId=00D000000000001EAA/Period=202601/Year=2026/Month=01/Date=31/Account/a.csv" },
  ],
  objects: [
    { id: "003000000000001AAA", period: 2602, version: 1, metadata: { Id: "003000000000001AAA" }, orgId: "00D000000000001EAA", csvId: 2, isDeleted: false, objectName: "Contact", name: "O'Brien \\ co" },
    { id: "001000000000001AAA", period: 2601, version: 2, metadata: { Id: "001000000000001AAA" }, orgId: "00D000000000001EAA", csvId: 1, isDeleted: false, objectName: "Account", name: "Acme v2" },
    { id: "001000000000001AAA", period: 2601, version: 1, metadata: { Id: "001000000000001AAA", OwnerId: "005000000000001AAA" }, orgId: "00D000000000001EAA", csvId: 1, isDeleted: true, objectName: "Account", name: "Acme" },
  ],
  backupRuns: [
    { runId: 2, objectName: "Contact", orgId: "00D000000000001EAA", period: 2602, status: "Failed", queryAll: false, startedAt: "2026-02-03T02:00:00.000+0000", completedAt: null, lastCheckpointId: null, lastCheckpointModstamp: null, recordsProcessed: null, recordsFailed: 1, bytesTransferred: null, errorMessage: "boom 'x'", archiveExpression: null },
    { runId: 1, objectName: "Account", orgId: "00D000000000001EAA", period: 2601, status: "Completed", queryAll: true, startedAt: "2026-01-31T02:00:00.000+0000", completedAt: "2026-01-31T02:05:00.000+0000", lastCheckpointId: "001000000000001AAA", lastCheckpointModstamp: "2026-01-30T10:00:00.000+0000", recordsProcessed: 2, recordsFailed: 0, bytesTransferred: 120, errorMessage: null, archiveExpression: null },
  ],
};

const sql = renderIndexSql(rows);
let db: PGlite;

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(sql);
});
afterAll(async () => {
  await db.close();
});

async function columns(table: string): Promise<string[]> {
  const r = await db.query<{ column_name: string; data_type: string }>(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1 ORDER BY ordinal_position",
    [table],
  );
  return r.rows.map((c) => `${c.column_name} ${c.data_type}`);
}

describe("index sql", () => {
  it("loads unchanged into an empty pglite database with the documented column set", async () => {
    expect(await columns("csvfiles")).toEqual(["csv_id integer", "period integer", "s3path text"]);
    expect(await columns("objects")).toEqual([
      "id text", "period integer", "version integer", "metadata jsonb", "org_id text", "csv_id integer", "is_deleted boolean", "object_name text", "name text",
    ]);
    expect(await columns("backup_runs")).toEqual([
      "run_id bigint", "object_name text", "org_id text", "period integer", "status text", "query_all boolean",
      "started_at timestamp without time zone", "completed_at timestamp without time zone", "last_checkpoint_id text",
      "last_checkpoint_modstamp timestamp without time zone", "records_processed integer", "records_failed integer",
      "bytes_transferred bigint", "error_message text", "archive_expression text",
    ]);
  });

  it("keys objects on (org_id, period, id, version)", async () => {
    const r = await db.query<{ cols: string }>(
      `SELECT string_agg(a.attname, ',' ORDER BY array_position(i.indkey::int[], a.attnum::int)) AS cols
       FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
       WHERE i.indrelid = 'objects'::regclass AND i.indisprimary`,
    );
    expect(r.rows[0]?.cols).toBe("org_id,period,id,version");
  });

  it("orders rows by primary key regardless of input order", () => {
    const shuffled: IndexRows = { csvfiles: [...rows.csvfiles].reverse(), objects: [...rows.objects].reverse(), backupRuns: [...rows.backupRuns].reverse() };
    expect(renderIndexSql(shuffled)).toBe(sql);
    const iFirst = sql.indexOf("INSERT INTO csvfiles");
    expect(sql.indexOf("(1, 2601", iFirst)).toBeLessThan(sql.indexOf("(2, 2602", iFirst));
    expect(sql.indexOf("'Acme'")).toBeLessThan(sql.indexOf("'Acme v2'"));
  });

  it("lets a later insert take the next csv_id and run_id", async () => {
    const c = await db.query<{ csv_id: number }>("INSERT INTO csvfiles (period, s3path) VALUES (2602, 'x') RETURNING csv_id");
    expect(c.rows[0]?.csv_id).toBe(3);
    const b = await db.query<{ run_id: string }>("INSERT INTO backup_runs (object_name) VALUES ('x') RETURNING run_id");
    expect(Number(b.rows[0]?.run_id)).toBe(3);
  });

  it("round-trips quotes and backslashes through text and jsonb", async () => {
    const o = await db.query<{ name: string }>("SELECT name FROM objects WHERE id = '003000000000001AAA'");
    expect(o.rows[0]?.name).toBe("O'Brien \\ co");
    const e = await db.query<{ m: string }>("SELECT error_message AS m FROM backup_runs WHERE run_id = 2");
    expect(e.rows[0]?.m).toBe("boom 'x'");
    const meta = await db.query<{ v: string }>("SELECT metadata->>'OwnerId' AS v FROM objects WHERE version = 1 AND id = '001000000000001AAA'");
    expect(meta.rows[0]?.v).toBe("005000000000001AAA");
  });

  it("loads Salesforce datetimes as UTC timestamps and nulls as NULL", async () => {
    const r = await db.query<{ s: string; c: string | null }>(
      "SELECT to_char(started_at, 'YYYY-MM-DD HH24:MI:SS.MS') AS s, completed_at::text AS c FROM backup_runs WHERE run_id = 2",
    );
    expect(r.rows[0]).toEqual({ s: "2026-02-03 02:00:00.000", c: null });
  });

  it("ends with exactly one LF and uses LF only", () => {
    expect(sql.endsWith(";\n")).toBe(true);
    expect(sql.endsWith("\n\n")).toBe(false);
    expect(sql).not.toContain("\r");
  });

  it("refuses duplicate objects primary keys without echoing values", () => {
    const dup = { ...rows, objects: [rows.objects[0]!, rows.objects[0]!] };
    expect(() => renderIndexSql(dup)).toThrow("index: duplicate objects primary key");
  });
});
