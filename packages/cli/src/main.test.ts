/**
 * CLI surface that needs no database: `check` output and `--help`. The `up`/`reset` database paths
 * are covered by packages/schema/src/prefixes.test.ts and the API test in plan 02-03.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "./main.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));

async function project(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "orglet-cli-"));
  for (const [rel, content] of Object.entries(files)) {
    const p = join(root, rel);
    await mkdir(join(p, ".."), { recursive: true });
    await writeFile(p, content);
  }
  return root;
}
const field = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><CustomField xmlns="http://soap.sforce.com/2006/04/metadata">${body}</CustomField>`;
// ExternalLookup is a field type orglet does not model, so loading yields an UNSUPPORTED:field-type warning.
const warningProject = () =>
  project({
    "objects/Foo__c/fields/Ext__c.field-meta.xml": field("<fullName>Ext__c</fullName><type>ExternalLookup</type>"),
    "objects/Foo__c/fields/Bar__c.field-meta.xml": field("<fullName>Bar__c</fullName><type>Text</type><length>10</length>"),
  });

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

  it("check reports how many feature-gated standard fields the baseline includes", async () => {
    expect(await main(["check"])).toBe(0);
    const line = logs.find((l) => /^\d+ feature-gated standard fields included \(nullable; present in an org only when the feature is enabled\)$/.test(l));
    expect(line, logs.join("\n")).toBeDefined();
    expect(Number.parseInt(line!, 10)).toBeGreaterThan(0);
    logs = [];
    expect(await main(["check", "--quiet"])).toBe(0);
    expect(logs).toEqual([]);
  });

  it("prints nothing with --quiet", async () => {
    expect(await main(["check", "--project", ACME, "--quiet"])).toBe(0);
    expect(logs).toEqual([]);
  });

  it("strict check of a clean project exits 0", async () => {
    expect(await main(["check", "--strict", "--project", ACME])).toBe(0);
    expect(warns).toEqual([]);
  });

  it("strict check exits 1 when any warning is printed", async () => {
    const root = await warningProject();
    try {
      expect(await main(["check", "--strict", "--project", root])).toBe(1);
      expect(warns.some((w) => /^warning: UNSUPPORTED:field-type .*ExternalLookup/.test(w))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("check without --strict still exits 0 when warnings are printed", async () => {
    const root = await warningProject();
    try {
      expect(await main(["check", "--project", root])).toBe(0);
      expect(warns.some((w) => /^warning: UNSUPPORTED:field-type .*ExternalLookup/.test(w))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("--quiet does not hide warnings or the strict failure", async () => {
    const root = await warningProject();
    try {
      expect(await main(["check", "--strict", "--quiet", "--project", root])).toBe(1);
      expect(logs).toEqual([]);
      expect(warns.length).toBeGreaterThanOrEqual(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("usage", () => {
  it("documents --key-prefixes, --drop-prefixes and --strict", async () => {
    await main(["--help"]);
    const usage = logs.join("\n");
    expect(usage).toContain("--key-prefixes <file>");
    expect(usage).toContain("--drop-prefixes");
    expect(usage).toContain("orglet check [--project <sfdx-dir>] [--strict]");
    expect(usage).toContain("--strict");
    expect(usage).toContain("orglet reset [--db <postgres-url>] [--org-schema <name>] [--drop-prefixes]");
  });
});
