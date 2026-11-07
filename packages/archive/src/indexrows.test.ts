import { describe, expect, it } from "vitest";
import type { ExportedCsv, ObjectRun } from "../../../scripts/gen-archive-fixture/export.js";
import { buildIndexRows, type PeriodExport } from "../../../scripts/gen-archive-fixture/indexrows.js";
import { FIXTURE_PERIODS } from "../../../scripts/gen-archive-fixture/seed.js";

const ORG = "00D000000000001EAA";
const header = ["Name", "OwnerId", "SystemModstamp", "Id"];
const csv = (fileName: string, rows: string[][]): ExportedCsv => ({
  fileName,
  header,
  rows,
  text: `${header.join(",")}\n${rows.map((r) => r.join(",")).join("\n")}\n`,
});
// 2026-01-10T09:00:00 UTC = 1768035600, 09:30:00 = 1768037400, 2026-02-20T12:00:00 = 1771588800
const account: ObjectRun = {
  objectName: "Account",
  deleted: false,
  status: "Completed",
  errorMessage: null,
  checkpoint: { modstamp: "2026-01-10T09:30:00.000+0000", id: "001000000000002AAA" },
  csvs: [
    csv("750000000000001AAA.csv", [
      ["Acme", "005000000000001AAA", "2026-01-10T09:00:00.000+0000", "001000000000001AAA"],
      ["Globex", "005000000000001AAA", "2026-01-10T09:30:00.000+0000", "001000000000002AAA"],
    ]),
  ],
};
const refused: ObjectRun = { objectName: "ContentDocumentLink", deleted: false, status: "Failed", csvs: [], errorMessage: "MALFORMED_QUERY: needs a filter", checkpoint: null };
const deletedContact: ObjectRun = {
  objectName: "Contact",
  deleted: true,
  status: "Completed",
  errorMessage: null,
  checkpoint: { modstamp: "2026-02-20T12:00:00.000+0000", id: "003000000000007AAA" },
  csvs: [csv("750000000000002AAA.csv", [["Gone", "005000000000001AAA", "2026-02-20T12:00:00.000+0000", "003000000000007AAA"]])],
};
const periods: PeriodExport[] = [
  { period: FIXTURE_PERIODS[0], runs: [account, refused], referenceColumns: new Map([["Account", new Set(["OwnerId"])]]) },
  { period: FIXTURE_PERIODS[1], runs: [deletedContact], referenceColumns: new Map() },
];

describe("archive index rows", () => {
  const { rows, csvTexts } = buildIndexRows(ORG, periods);

  it("gives every CSV a sequential csv_id and a bare S3 key", () => {
    expect(rows.csvfiles).toEqual([
      { csvId: 1, period: 2601, s3path: "OrgId=00D000000000001EAA/Period=202601/Year=2026/Month=01/Date=31/Account/750000000000001AAA.csv" },
      { csvId: 2, period: 2602, s3path: "OrgId=00D000000000001EAA/Period=202602/Year=2026/Month=02/Date=28/Contact_deleted/750000000000002AAA.csv" },
    ]);
    expect([...csvTexts.keys()]).toEqual(rows.csvfiles.map((f) => f.s3path));
    expect(csvTexts.get(rows.csvfiles[0]?.s3path ?? "")).toBe(account.csvs[0]?.text);
  });

  it("marks rows from a deleted-phase CSV as deleted", () => {
    expect(rows.objects).toHaveLength(3);
    expect(rows.objects.map((o) => o.isDeleted)).toEqual([false, false, true]);
    expect(rows.objects[0]).toEqual({
      id: "001000000000001AAA",
      period: 2601,
      version: 1768035600,
      metadata: { OwnerId: "005000000000001AAA", Id: "001000000000001AAA" },
      orgId: ORG,
      csvId: 1,
      isDeleted: false,
      objectName: "Account",
      name: "Acme",
    });
    expect(rows.objects[2]).toMatchObject({ objectName: "Contact", csvId: 2, version: 1771588800, period: 2602, name: "Gone" });
  });

  it("records a refused object as a Failed run without counts", () => {
    expect(rows.backupRuns.map((r) => [r.runId, r.objectName, r.status])).toEqual([
      [1, "Account", "Completed"],
      [2, "ContentDocumentLink", "Failed"],
      [3, "Contact", "Completed"],
    ]);
    expect(rows.backupRuns[0]).toEqual({
      runId: 1,
      objectName: "Account",
      orgId: ORG,
      period: 2601,
      status: "Completed",
      queryAll: false,
      startedAt: FIXTURE_PERIODS[0].runAt,
      completedAt: FIXTURE_PERIODS[0].runAt,
      lastCheckpointId: "001000000000002AAA",
      lastCheckpointModstamp: "2026-01-10T09:30:00.000+0000",
      recordsProcessed: 2,
      recordsFailed: 0,
      bytesTransferred: Buffer.byteLength(account.csvs[0]?.text ?? "", "utf8"),
      errorMessage: null,
      archiveExpression: null,
    });
    expect(rows.backupRuns[1]).toMatchObject({
      queryAll: false,
      recordsProcessed: null,
      recordsFailed: null,
      bytesTransferred: null,
      lastCheckpointId: null,
      lastCheckpointModstamp: null,
      errorMessage: "MALFORMED_QUERY: needs a filter",
    });
    expect(rows.backupRuns[2]?.queryAll).toBe(true);
  });
});
