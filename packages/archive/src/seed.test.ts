import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyDeletes, applyInserts, applyUpdates, bootFixtureOrg, type FixtureOrg } from "../../../scripts/gen-archive-fixture/org.js";
import { buildSeed, type FixtureSeed, type SeedRecord } from "../../../scripts/gen-archive-fixture/seed.js";

const ID_SHAPE = /^[a-zA-Z0-9]{3}0{2}\d{10}[A-Z0-5]{3}$/;

describe("archive fixture seed", () => {
  const seed: FixtureSeed = buildSeed();
  let org: FixtureOrg;

  beforeAll(async () => {
    org = await bootFixtureOrg(seed);
    await applyInserts(org, seed.period1.inserts);
    await applyInserts(org, seed.period2.inserts);
    await applyUpdates(org, seed.period2.updates);
    await applyDeletes(org, seed.period2.deletes);
  }, 60_000);

  afterAll(async () => {
    await org.close();
  });

  const rows = async (sql: string): Promise<Record<string, unknown>[]> => (await org.pool.query(sql)).rows as Record<string, unknown>[];
  const all = (): SeedRecord[] => [...seed.period1.inserts, ...seed.period2.inserts];

  it("allocates the same ids on every build", () => {
    const again = buildSeed();
    expect(again).toEqual(seed);
    expect([...again.allocated]).toEqual([...seed.allocated]);
  });

  it("only references ids the seed allocated", () => {
    const scan = (v: unknown): void => {
      if (typeof v === "string" && ID_SHAPE.test(v)) expect(seed.allocated.has(v), v).toBe(true);
    };
    for (const r of all()) {
      scan(r.id);
      Object.values(r.fields).forEach(scan);
    }
    for (const u of seed.period2.updates) Object.values(u.changes).forEach(scan);
  });

  it("keeps every Project__c under the milestone limit and in the past so Is_Overdue__c cannot change over time", () => {
    const perProject = new Map<unknown, number>();
    for (const r of all().filter((x) => x.object === "Milestone__c")) perProject.set(r.fields.Project__c, (perProject.get(r.fields.Project__c) ?? 0) + 1);
    for (const n of perProject.values()) expect(n).toBeLessThanOrEqual(5);
    for (const r of all().filter((x) => x.object === "Project__c")) {
      const end = r.fields.End_Date__c;
      if (typeof end === "string") expect(end <= "2025-12-31").toBe(true);
    }
  });

  it("leaves the deleted contact unreferenced by any other record", () => {
    const deletedId = seed.period2.deletes.find((d) => d.object === "Contact")?.ids[0];
    expect(deletedId).toBeDefined();
    for (const r of all()) expect(Object.values(r.fields)).not.toContain(deletedId);
  });

  it("seeds every period-1 object with the expected row counts", async () => {
    expect(await rows(`select 1 from org.account`)).toHaveLength(6);
    expect(await rows(`select 1 from org.contact`)).toHaveLength(8);
    expect(await rows(`select 1 from org.bigtable__c`)).toHaveLength(12);
    expect(await rows(`select 1 from org.contentversion`)).toHaveLength(5);
  });

  it("stamps period-2 deletes with the seed time, not the wall clock", async () => {
    const deleted = await rows(`select systemmodstamp, lastmodifieddate from org.contact where isdeleted = true`);
    expect(deleted).toHaveLength(1);
    expect(deleted[0]?.systemmodstamp).toBe("2026-02-10T10:00:00.000+0000");
    expect(deleted[0]?.lastmodifieddate).toBe("2026-02-10T10:00:00.000+0000");
  });

  it("moves the document mirror to the second version and retires the first", async () => {
    const versions = await rows(`select id, islatest from org.contentversion order by id`);
    expect(versions.filter((v) => v.islatest === false)).toHaveLength(1);
    const v5 = seed.period2.inserts.find((r) => r.object === "ContentVersion");
    const d1 = seed.period1.inserts.find((r) => r.object === "ContentDocument");
    const doc = await rows(`select latestpublishedversionid from org.contentdocument where id = '${d1?.id}'`);
    expect(doc[0]?.latestpublishedversionid).toBe(v5?.id);
  });

  it("stores every blob checksum as the md5 of its bytes", async () => {
    const stored = await rows(`select id, checksum from org.contentversion`);
    expect(stored).toHaveLength(seed.blobs.length);
    for (const b of seed.blobs) {
      expect(b.checksum).toBe(createHash("md5").update(b.bytes).digest("hex"));
      expect(stored.find((s) => s.id === b.versionId)?.checksum).toBe(b.checksum);
    }
  });

  it("stores the seed's roll-up values instead of recomputing them", async () => {
    const stored = await rows(`select id, milestone_count__c from org.project__c`);
    for (const p of all().filter((x) => x.object === "Project__c")) {
      expect(stored.find((s) => s.id === p.id)?.milestone_count__c).toBe(p.fields.Milestone_Count__c);
    }
  });

  it("fails the seed run without echoing values when the engine rejects a record", async () => {
    const bad: SeedRecord = { object: "Project__c", id: "a02000000000099AAA", at: "2026-01-20T00:00:00.000+0000", fields: { Name: "x", Status__c: "Bogus" } };
    const err = await applyInserts(org, [bad]).then(
      () => null,
      (e: unknown) => e as Error,
    );
    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toMatch(/^seed insert failed: Project__c #0: [A-Z_]+$/);
    expect(err?.message).not.toContain("Bogus");
  });
});
