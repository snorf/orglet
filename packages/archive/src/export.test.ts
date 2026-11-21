import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Checkpoint } from "@orglet/archive";
import { describeReplicateable, exportPeriod, type DescribedObject, type ObjectRun } from "../../../scripts/gen-archive-fixture/export.js";
import { applyDeletes, applyInserts, applyUpdates, bootFixtureOrg, type FixtureOrg } from "../../../scripts/gen-archive-fixture/org.js";
import { buildSeed } from "../../../scripts/gen-archive-fixture/seed.js";

describe("archive fixture export", () => {
  const seed = buildSeed();
  let org: FixtureOrg;
  let objects: DescribedObject[];
  let p1: ObjectRun[];
  let p2: ObjectRun[];
  let counter = 0;
  const options = (start: ReadonlyMap<string, Checkpoint>) => ({
    startCheckpoints: start,
    limitFor: (n: string) => (n === "BigTable__c" ? 8 : 50000),
    nextFileName: () => `f${++counter}`,
  });
  const run = (runs: ObjectRun[], name: string, deleted = false): ObjectRun | undefined => runs.find((r) => r.objectName === name && r.deleted === deleted);
  const col = (r: ObjectRun, name: string): string[] => r.csvs.flatMap((c) => c.rows.map((row) => row[c.header.indexOf(name)] as string));

  beforeAll(async () => {
    org = await bootFixtureOrg(seed);
    objects = await describeReplicateable(org);
    await applyInserts(org, seed.period1.inserts);
    p1 = await exportPeriod(org, objects, options(new Map()));
    await applyInserts(org, seed.period2.inserts);
    await applyUpdates(org, seed.period2.updates);
    await applyDeletes(org, seed.period2.deletes);
    const start = new Map<string, Checkpoint>();
    for (const r of p1) if (!r.deleted && r.checkpoint) start.set(r.objectName, r.checkpoint);
    p2 = await exportPeriod(org, objects, options(start));
  }, 120_000);

  afterAll(async () => {
    await org.close();
  });

  it("lists replicateable objects sorted by code unit", () => {
    const names = objects.map((o) => o.name);
    expect(names).toEqual([...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)));
    for (const n of ["Account", "BigTable__c", "ContentDocumentLink", "ContentVersion", "User", "Organization", "Profile", "RecordType", "BusinessHours", "UserLicense"]) {
      expect(names).toContain(n);
    }
  });

  it("splits BigTable__c into two Bulk jobs through the SystemModstamp/Id checkpoint", () => {
    const big = run(p1, "BigTable__c");
    expect(big?.status).toBe("Completed");
    expect(big?.csvs.map((c) => c.rows.length)).toEqual([8, 4]);
    const cols = objects.find((o) => o.name === "BigTable__c")?.columns ?? [];
    for (const c of big?.csvs ?? []) {
      expect(c.header).toEqual(cols);
      expect(c.header.slice(-2)).toEqual(["SystemModstamp", "Id"]);
    }
    const keys = (big?.csvs ?? []).flatMap((c) => c.rows.map((r) => `${r[c.header.indexOf("SystemModstamp")]}|${r[c.header.indexOf("Id")]}`));
    expect(keys).toEqual([...keys].sort());
    const last = big?.csvs.at(-1)?.rows.at(-1) ?? [];
    expect(big?.checkpoint).toEqual({ modstamp: last[cols.indexOf("SystemModstamp")], id: last[cols.indexOf("Id")] });
    expect(run(p1, "BigTable__c", true)).toBeUndefined();
    expect(run(p1, "Case")).toBeUndefined();
  });

  it("records the refused ContentDocumentLink query as a Failed run without a CSV", () => {
    const cdl = run(p1, "ContentDocumentLink");
    expect(cdl?.status).toBe("Failed");
    expect(cdl?.csvs).toEqual([]);
    expect(cdl?.errorMessage).toMatch(/^MALFORMED_QUERY: /);
    expect(cdl?.checkpoint).toBeNull();
  });

  it("writes period-2 deletions only to the deleted phase", () => {
    expect(run(p2, "BigTable__c")?.csvs.map((c) => c.rows.length)).toEqual([8, 1]);
    expect(run(p2, "Account")?.csvs.map((c) => c.rows.length)).toEqual([1]);
    expect(run(p2, "Contact")?.status).toBe("Completed");
    const del = run(p2, "Contact", true);
    expect(del?.csvs).toHaveLength(1);
    expect(del?.csvs[0]?.rows).toHaveLength(1);
    expect(col(del as ObjectRun, "IsDeleted")).toEqual(["true"]);
    const cv = run(p2, "ContentVersion");
    expect(col(cv as ObjectRun, "IsLatest").sort()).toEqual(["false", "true"]);
    expect(cv?.csvs[0]?.rows).toHaveLength(2);
  });
});
