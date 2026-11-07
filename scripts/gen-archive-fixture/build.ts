/**
 * Builds the whole archive fixture in memory (Phase 16 FIX-01): seed, back up period 1, apply the period-2 story, back up period 2, guard, index, blobs, README. No filesystem access, so `gen`, `--check` and the determinism test share one code path.
 */
import { blobObjectKey, renderIndexSql } from "@orglet/archive";
import type { Checkpoint } from "@orglet/archive";
import { blobKey } from "@orglet/engine";
import { toCaseSafeId } from "@orglet/schema";
import { checkLeaks } from "./guard.js";
import { applyDeletes, applyInserts, applyUpdates, bootFixtureOrg } from "./org.js";
import { describeReplicateable, exportPeriod } from "./export.js";
import type { ObjectRun } from "./export.js";
import { buildIndexRows } from "./indexrows.js";
import type { PeriodExport } from "./indexrows.js";
import { renderReadme } from "./readme.js";
import { FIXTURE_CLOCK, FIXTURE_PERIODS, buildSeed } from "./seed.js";

export type FixtureFiles = Map<string, string | Buffer>;

export const BIG_TABLE_LIMIT = 8;
export const DEFAULT_LIMIT = 50000;

const CSV_KEY = /^store\/OrgId=[A-Za-z0-9]{18}\/Period=\d{6}\/Year=\d{4}\/Month=\d{2}\/Date=\d{2}\/[A-Za-z][A-Za-z0-9_]*\/[A-Za-z0-9]{18}\.csv$/;
const BLOB_KEY = /^store\/OrgId=[A-Za-z0-9]{18}\/Period=0\/files\/[0-9a-f]{4}\/[0-9a-f]{32}\.[A-Za-z0-9]{1,16}$/;

const codeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export async function buildFixture(): Promise<FixtureFiles> {
  const seed = buildSeed();
  const org = await bootFixtureOrg(seed);
  try {
    await applyInserts(org, seed.period1.inserts);
    const objects = await describeReplicateable(org);
    const refs = new Map(objects.map((o) => [o.name, o.referenceColumns] as const));

    let n = 0;
    const nextFileName = (): string => `${toCaseSafeId(`750${"00"}${String(++n).padStart(10, "0")}`)}.csv`;
    const limitFor = (name: string): number => (name === "BigTable__c" ? BIG_TABLE_LIMIT : DEFAULT_LIMIT);

    const runs1 = await exportPeriod(org, objects, { startCheckpoints: new Map(), limitFor, nextFileName });

    await applyInserts(org, seed.period2.inserts);
    await applyUpdates(org, seed.period2.updates);
    await applyDeletes(org, seed.period2.deletes);

    const start = new Map<string, Checkpoint>();
    for (const r of runs1) if (r.status === "Completed" && !r.deleted && r.checkpoint) start.set(r.objectName, r.checkpoint);
    const runs2 = await exportPeriod(org, objects, { startCheckpoints: start, limitFor, nextFileName });

    const perPeriod: readonly (readonly ObjectRun[])[] = [runs1, runs2];
    perPeriod.forEach((runs, i) => {
      const period = FIXTURE_PERIODS[i];
      if (!period) throw new Error("fixture: missing period definition");
      checkLeaks(
        runs.flatMap((r) => r.csvs.map((c) => ({ objectName: r.objectName, deleted: r.deleted, header: c.header, rows: c.rows, referenceColumns: refs.get(r.objectName) ?? new Set<string>() }))),
        seed.allocated,
        { from: FIXTURE_CLOCK.bootstrap, to: period.runAt },
      );
    });

    const periods: PeriodExport[] = perPeriod.map((runs, i) => ({ period: FIXTURE_PERIODS[i]!, runs, referenceColumns: refs }));
    const { rows, csvTexts } = buildIndexRows(seed.orgId, periods);

    const entries = new Map<string, string | Buffer>();
    for (const [s3path, text] of csvTexts) entries.set(`store/${s3path}`, text);
    for (const b of seed.blobs) {
      const key = `store/${blobObjectKey(seed.orgId, blobKey(b.checksum, b.extension))}`;
      const prior = entries.get(key);
      if (prior !== undefined && !(Buffer.isBuffer(prior) && prior.equals(b.bytes))) throw new Error("blob key collision");
      entries.set(key, b.bytes);
    }

    // Format-version assertions: every key matches the documented layout, every ContentVersion row has its blob.
    for (const key of entries.keys()) {
      if (!CSV_KEY.test(key) && !BLOB_KEY.test(key)) throw new Error("fixture: a generated key does not match the Heimdall layout");
    }
    for (const runs of perPeriod) {
      for (const r of runs) {
        if (r.objectName !== "ContentVersion" || r.deleted) continue;
        for (const c of r.csvs) {
          const sum = c.header.indexOf("Checksum");
          const ext = c.header.indexOf("FileExtension");
          if (sum < 0 || ext < 0) throw new Error("fixture: ContentVersion export lacks Checksum or FileExtension");
          for (const cells of c.rows) {
            const key = `store/${blobObjectKey(seed.orgId, blobKey(cells[sum] as string, cells[ext] as string))}`;
            if (!entries.has(key)) throw new Error("fixture: a ContentVersion row has no blob file");
          }
        }
      }
    }

    const sql = renderIndexSql(rows);
    const readme = renderReadme({
      orgId: seed.orgId,
      periods: perPeriod.map((runs, i) => {
        const period = FIXTURE_PERIODS[i]!;
        return {
          segment: `${period.year}${String(period.month).padStart(2, "0")}`,
          index: (period.year % 100) * 100 + period.month,
          runAt: period.runAt,
          csvCount: runs.reduce((a, r) => a + r.csvs.length, 0),
          objectRows: runs.reduce((a, r) => a + r.csvs.reduce((b, c) => b + c.rows.length, 0), 0),
        };
      }),
      blobCount: new Set(seed.blobs.map((b) => b.checksum)).size,
      failedObjects: [...new Set(runs1.concat(runs2).filter((r) => r.status === "Failed").map((r) => r.objectName))].sort(codeUnit),
      splitObject: "BigTable__c",
      splitLimit: BIG_TABLE_LIMIT,
    });
    entries.set("index.sql", sql);
    entries.set("README.md", readme);

    const out: FixtureFiles = new Map();
    for (const key of [...entries.keys()].sort(codeUnit)) out.set(key, entries.get(key) as string | Buffer);
    return out;
  } finally {
    await org.close();
  }
}
