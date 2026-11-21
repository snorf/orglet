/**
 * FIX-01 acceptance for examples/acme-archive: determinism, committed equality, blob MD5, index load and the
 * two-period story. Expected index values are hand-written or checked against the committed files, never
 * recomputed with the generator's own @orglet/archive helpers (PITFALLS P23).
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { buildFixture, type FixtureFiles } from "../../../scripts/gen-archive-fixture/build.js";
import { diffTree, listTree, writeTree } from "../../../scripts/gen-archive-fixture/tree.js";
import { parseBulkCsv } from "./csv.js";

const COMMITTED = fileURLToPath(new URL("../../../examples/acme-archive/", import.meta.url));
const ORG = "OrgId=00D000000000001EAA";
const STORE = "store/";

const bytesOf = (c: string | Buffer): Buffer => (typeof c === "string" ? Buffer.from(c, "utf8") : c);
const read = (rel: string): Buffer => readFileSync(join(COMMITTED, rel));

interface Csv {
  path: string;
  header: string[];
  rows: Record<string, string>[];
}

describe("acme-archive fixture", () => {
  let runA: FixtureFiles;
  let runB: FixtureFiles;
  const tmpDirs: string[] = [];
  let committedFiles: string[];
  let csvs: Csv[];
  let db: PGlite;

  beforeAll(async () => {
    runA = await buildFixture();
    runB = await buildFixture();
    committedFiles = listTree(COMMITTED);
    csvs = committedFiles
      .filter((f) => f.startsWith(STORE) && f.endsWith(".csv") && !f.includes("/Period=0/"))
      .map((path) => {
        const { header, rows } = parseBulkCsv(read(path).toString("utf8"));
        return { path: path.slice(STORE.length), header, rows: rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""]))) };
      });
    db = await PGlite.create();
    await db.exec(read("index.sql").toString("utf8"));
  }, 180_000);

  afterAll(async () => {
    for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
    await db?.close();
  });

  const csvsOf = (objectDir: string, period: string): Csv[] =>
    csvs.filter((c) => c.path.includes(`/Period=${period}/`) && c.path.split("/").at(-2) === objectDir);
  const one = (objectDir: string, period: string): Csv => {
    const found = csvsOf(objectDir, period);
    expect(found).toHaveLength(1);
    return found[0]!;
  };

  it("two generator runs write byte-identical trees", () => {
    const dirA = mkdtempSync(join(tmpdir(), "acme-archive-"));
    const dirB = mkdtempSync(join(tmpdir(), "acme-archive-"));
    tmpDirs.push(dirA, dirB);
    writeTree(runA, dirA);
    writeTree(runB, dirB);
    const listA = listTree(dirA);
    expect(listA).toEqual(listTree(dirB));
    expect(listA.length).toBeGreaterThan(0);
    for (const rel of listA) expect(readFileSync(join(dirA, rel)).equals(readFileSync(join(dirB, rel))), rel).toBe(true);
  });

  it("a run under a different system date produces the same fixture", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2031-06-15T10:00:00Z"));
      const runC = await buildFixture();
      expect([...runC.keys()]).toEqual([...runA.keys()]);
      for (const [k, v] of runA) expect(Buffer.compare(bytesOf(runC.get(k)!), bytesOf(v)), k).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  }, 120_000);

  it("the committed fixture equals a regeneration", () => {
    expect(diffTree(runA, COMMITTED)).toEqual([]);
  });

  it("every blob's md5 equals its ContentVersion Checksum", () => {
    const referenced = new Set<string>();
    const versions = csvs.filter((c) => c.path.split("/").at(-2) === "ContentVersion");
    expect(versions.length).toBeGreaterThan(0);
    for (const csv of versions) {
      for (const row of csv.rows) {
        const cs = row.Checksum!;
        const rel = `${STORE}${ORG}/Period=0/files/${cs.slice(0, 4)}/${cs}.${row.FileExtension}`;
        expect(committedFiles, rel).toContain(rel);
        expect(createHash("md5").update(read(rel)).digest("hex")).toBe(cs);
        referenced.add(rel);
      }
    }
    const blobs = committedFiles.filter((f) => f.startsWith(`${STORE}${ORG}/Period=0/files/`));
    expect(blobs.length).toBeGreaterThan(0);
    for (const b of blobs) expect(referenced.has(b), b).toBe(true);
  });

  it("the index dump loads unchanged and every csv_id resolves", async () => {
    const cols = async (t: string): Promise<string[]> =>
      (await db.query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_name = '${t}' ORDER BY ordinal_position`)).rows.map(
        (r) => r.column_name,
      );
    expect(await cols("csvfiles")).toEqual(["csv_id", "period", "s3path"]);
    expect(await cols("objects")).toEqual(["id", "period", "version", "metadata", "org_id", "csv_id", "is_deleted", "object_name", "name"]);
    expect(await cols("backup_runs")).toEqual([
      "run_id", "object_name", "org_id", "period", "status", "query_all", "started_at", "completed_at", "last_checkpoint_id",
      "last_checkpoint_modstamp", "records_processed", "records_failed", "bytes_transferred", "error_message", "archive_expression",
    ]);

    const files = (await db.query<{ csv_id: number; s3path: string }>("SELECT csv_id, s3path FROM csvfiles ORDER BY csv_id")).rows;
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(f.s3path.startsWith("s3://")).toBe(false);
      expect(committedFiles, f.s3path).toContain(STORE + f.s3path);
      const csv = csvs.find((c) => c.path === f.s3path)!;
      const objs = (await db.query<{ id: string; version: number }>("SELECT id, version FROM objects WHERE csv_id = $1", [f.csv_id])).rows;
      expect(objs.length, f.s3path).toBe(csv.rows.length);
      const byId = new Map(objs.map((o) => [o.id, o.version]));
      for (const row of csv.rows) {
        const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{3}\+0000$/.exec(row.SystemModstamp!);
        expect(m, `${f.s3path} ${row.Id}`).not.toBeNull();
        const [y, mo, d, h, mi, s] = m!.slice(1).map(Number) as [number, number, number, number, number, number];
        expect(byId.get(row.Id!), `${f.s3path} ${row.Id}`).toBe(Math.floor(Date.UTC(y, mo - 1, d, h, mi, s) / 1000));
      }
    }
  });

  it("hand-written index expectations", async () => {
    const q = async <T>(sql: string): Promise<T[]> => (await db.query<T>(sql)).rows;
    expect((await q<{ period: number }>("SELECT DISTINCT period FROM objects ORDER BY 1")).map((r) => r.period)).toEqual([2601, 2602]);
    const paths = await q<{ period: number; s3path: string }>("SELECT period, s3path FROM csvfiles");
    for (const p of paths) {
      expect(p.s3path.startsWith("OrgId=00D000000000001EAA/Period=2026")).toBe(true);
      expect(p.s3path).not.toContain("/ContentDocumentLink/");
      expect(p.s3path.includes(p.period === 2601 ? "/Year=2026/Month=01/Date=31/" : "/Year=2026/Month=02/Date=28/"), p.s3path).toBe(true);
    }
    const acct = await q<{ period: number; name: string; metadata: unknown }>(
      "SELECT period, name, metadata FROM objects WHERE id = '001000000000001AAA' ORDER BY period",
    );
    expect(acct.map((a) => [a.period, a.name])).toEqual([
      [2601, "Acme Corporation"],
      [2602, "Acme Corporation AB"],
    ]);
    expect(acct[0]!.metadata).toEqual({
      OwnerId: "005000000000001AAA",
      CreatedById: "005000000000001AAA",
      LastModifiedById: "005000000000001AAA",
      Id: "001000000000001AAA",
    });
    const cdl = await q<{ period: number; status: string; error_message: string; last_checkpoint_id: string | null }>(
      "SELECT period, status, error_message, last_checkpoint_id FROM backup_runs WHERE object_name = 'ContentDocumentLink' ORDER BY period",
    );
    expect(cdl).toHaveLength(2);
    expect(cdl.map((r) => r.period)).toEqual([2601, 2602]);
    for (const r of cdl) {
      expect(r.status).toBe("Failed");
      expect(r.error_message.startsWith("MALFORMED_QUERY")).toBe(true);
      expect(r.last_checkpoint_id).toBeNull();
    }
    const others = await q<{ status: string }>("SELECT DISTINCT status FROM backup_runs WHERE object_name <> 'ContentDocumentLink'");
    expect(others).toEqual([{ status: "Completed" }]);
  });

  it("the two-period story is in the files", async () => {
    const big = (await db.query<{ period: number; n: number }>("SELECT period, count(*)::int AS n FROM csvfiles WHERE s3path LIKE '%/BigTable__c/%' GROUP BY period ORDER BY period")).rows;
    expect(big).toEqual([{ period: 2601, n: 2 }, { period: 2602, n: 2 }]);

    const activeP1 = new Set(one("Contact", "202601").rows.map((r) => r.Id!));
    const deleted = one("Contact_deleted", "202602");
    const resurfaced = deleted.rows.filter((r) => activeP1.has(r.Id!));
    expect(resurfaced.length).toBeGreaterThan(0);
    for (const r of resurfaced) {
      expect(r.IsDeleted).toBe("true");
      const o = await db.query<{ is_deleted: boolean }>("SELECT is_deleted FROM objects WHERE id = $1 AND period = 2602", [r.Id]);
      expect(o.rows.map((x) => x.is_deleted)).toEqual([true]);
    }

    const cv2 = one("ContentVersion", "202602").rows;
    const v2 = cv2.find((r) => r.VersionNumber === "2")!;
    expect(v2.IsLatest).toBe("true");
    const v1 = cv2.find((r) => r.ContentDocumentId === v2.ContentDocumentId && r.VersionNumber === "1");
    expect(v1?.IsLatest).toBe("false");

    const cv1 = one("ContentVersion", "202601").rows;
    const byChecksum = new Map<string, Set<string>>();
    for (const r of cv1) byChecksum.set(r.Checksum!, (byChecksum.get(r.Checksum!) ?? new Set()).add(r.Id!));
    expect([...byChecksum.values()].some((ids) => ids.size >= 2)).toBe(true);

    const decoder = new TextDecoder("utf-8", { fatal: true });
    const blobs = committedFiles.filter((f) => f.startsWith(`${STORE}${ORG}/Period=0/files/`));
    const invalid = blobs.filter((b) => {
      try {
        decoder.decode(read(b));
        return false;
      } catch {
        return true;
      }
    });
    expect(invalid.length).toBeGreaterThanOrEqual(1);
  });

  it("roll-ups and formulas in the CSV are consistent with the data", () => {
    const milestones = one("Milestone__c", "202601").rows;
    const projects = one("Project__c", "202601").rows;
    expect(projects.length).toBeGreaterThan(0);
    for (const p of projects) {
      expect(Number(p.Milestone_Count__c), p.Id).toBe(milestones.filter((m) => m.Project__c === p.Id).length);
      if (p.Status__c !== "Done" && p.End_Date__c !== "") expect(p.Is_Overdue__c, p.Id).toBe("true");
    }
    const opps = one("Opportunity", "202601").rows;
    expect(opps.length).toBeGreaterThan(0);
    for (const o of opps) expect(Number(o.Weighted_Amount__c), o.Id).toBeCloseTo((Number(o.Amount || 0) * Number(o.Probability || 0)) / 100, 6);
  });

  it("the fixture holds only synthetic Level 1 data", () => {
    let withAt = 0;
    for (const csv of csvs) {
      for (const row of csv.rows) {
        for (const cell of Object.values(row)) {
          if (!cell.includes("@")) continue;
          withAt++;
          expect(/^[^@\s]+@([a-z0-9-]+\.)*example\.com$/.test(cell), csv.path).toBe(true);
        }
      }
    }
    expect(withAt).toBeGreaterThan(0);
  });
});
