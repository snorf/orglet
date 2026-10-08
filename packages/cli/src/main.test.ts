/**
 * CLI surface that needs no database: `check` output and `--help`. The `up`/`reset` database paths
 * are covered by packages/schema/src/prefixes.test.ts and the API test in plan 02-03.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { main } from "./main.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));

let logs: string[] = [];
let warns: string[] = [];

beforeEach(() => {
  logs = [];
  warns = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    warns.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("check", () => {
  it("lists every custom object's provisional prefix and says they are provisional", async () => {
    expect(await main(["check", "--project", ACME])).toBe(0);
    expect(logs[0]).toMatch(/^\d+ objects \(4 custom\), \d+ fields$/);
    expect(logs).toContain("  BigTable__c  a00  (provisional)");
    expect(logs).toContain("  Milestone__c  a01  (provisional)");
    expect(logs).toContain("  Project__c  a02  (provisional)");
    expect(logs).toContain("  UpsertTable__c  a03  (provisional)");
    expect(logs).toContain("custom-object key prefixes are provisional here; `orglet up` assigns them once and reads them from the database thereafter");
    expect(logs.filter((l) => /\(provisional\)$/.test(l))).toHaveLength(4);
  });

  it("reports no reference-target warning, and no warning at all, for acme", async () => {
    expect(await main(["check", "--project", ACME])).toBe(0);
    expect(warns.filter((w) => w.includes("UNSUPPORTED:reference-target"))).toEqual([]);
    expect(warns).toEqual([]);
  });

  it("prints nothing with --quiet", async () => {
    expect(await main(["check", "--project", ACME, "--quiet"])).toBe(0);
    expect(logs).toEqual([]);
  });
});

describe("usage", () => {
  it("documents --key-prefixes and --drop-prefixes", async () => {
    await main(["--help"]);
    const usage = logs.join("\n");
    expect(usage).toContain("--key-prefixes <file>");
    expect(usage).toContain("--drop-prefixes");
    expect(usage).toContain("orglet reset [--db <postgres-url>] [--org-schema <name>] [--drop-prefixes]");
  });
});
