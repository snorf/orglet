/**
 * Turns exported runs into Heimdall's index rows (csvfiles, objects, backup_runs) and the S3 keys of the CSVs, using the shared @orglet/archive rules so writer and Phase 18 reader cannot drift.
 */
import { csvKey, epochSeconds, objectMetadata, objectRecordName, periodInt, periodSegment } from "@orglet/archive";
import type { BackupRunRow, CsvFileRow, IndexRows, ObjectRow } from "@orglet/archive";
import type { ObjectRun } from "./export.js";
import type { FixturePeriod } from "./seed.js";

export interface PeriodExport {
  period: FixturePeriod;
  runs: readonly ObjectRun[];
  /** Reference column names per object, from describe. */
  referenceColumns: ReadonlyMap<string, ReadonlySet<string>>;
}
/** `csvTexts` is keyed by the bare s3path. */
export interface IndexBuild {
  rows: IndexRows;
  csvTexts: Map<string, string>;
}

export function buildIndexRows(orgId: string, periods: readonly PeriodExport[]): IndexBuild {
  const csvfiles: CsvFileRow[] = [];
  const objects: ObjectRow[] = [];
  const backupRuns: BackupRunRow[] = [];
  const csvTexts = new Map<string, string>();
  const seen = new Set<string>();
  let csvId = 0;
  let runId = 0;

  for (const { period, runs, referenceColumns } of periods) {
    const periodCol = periodInt(period.year, period.month);
    for (const run of runs) {
      runId++;
      let records = 0;
      let bytes = 0;
      for (const csv of run.csvs) {
        csvId++;
        const s3path = csvKey({
          orgId,
          period: periodSegment(period.year, period.month),
          uploaded: period.runAt,
          objectName: run.objectName,
          deleted: run.deleted,
          fileName: csv.fileName,
        });
        csvfiles.push({ csvId, period: periodCol, s3path });
        csvTexts.set(s3path, csv.text);
        bytes += Buffer.byteLength(csv.text, "utf8");
        const idCol = csv.header.indexOf("Id");
        const versionCol = csv.header.indexOf(csv.header.includes("SystemModstamp") ? "SystemModstamp" : "CreatedDate");
        const refs = referenceColumns.get(run.objectName) ?? new Set<string>();
        for (const cells of csv.rows) {
          const id = cells[idCol] as string;
          const version = epochSeconds(cells[versionCol] as string);
          const key = `${periodCol}|${id}|${version}`;
          if (seen.has(key)) throw new Error(`index: duplicate objects primary key in ${run.objectName}`);
          seen.add(key);
          objects.push({
            id,
            period: periodCol,
            version,
            metadata: objectMetadata(run.objectName, csv.header, cells, refs),
            orgId,
            csvId,
            isDeleted: run.deleted,
            objectName: run.objectName,
            name: objectRecordName(csv.header, cells),
          });
          records++;
        }
      }
      // "Completed"/"Failed" is orglet's status vocabulary; Heimdall does not document its own.
      const base = { runId, objectName: run.objectName, orgId, period: periodCol, queryAll: run.deleted, startedAt: period.runAt, completedAt: period.runAt, archiveExpression: null };
      backupRuns.push(
        run.status === "Completed"
          ? {
              ...base,
              status: "Completed",
              lastCheckpointId: run.checkpoint?.id ?? null,
              lastCheckpointModstamp: run.checkpoint?.modstamp ?? null,
              recordsProcessed: records,
              recordsFailed: 0,
              bytesTransferred: bytes,
              errorMessage: null,
            }
          : {
              ...base,
              status: "Failed",
              lastCheckpointId: null,
              lastCheckpointModstamp: null,
              recordsProcessed: null,
              recordsFailed: null,
              bytesTransferred: null,
              errorMessage: run.errorMessage,
            },
      );
    }
  }
  return { rows: { csvfiles, objects, backupRuns }, csvTexts };
}
