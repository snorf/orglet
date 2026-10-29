/**
 * CLI surface that needs no database: `check` output and `--help`. The `up`/`reset` database paths
 * are covered by packages/schema/src/prefixes.test.ts and the API test in plan 02-03.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fileURLToPath } from "node:url";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { admitFormulaRollups } from "@orglet/formula";
import { loadOrgSchema } from "@orglet/metadata";
import { FormulaRegistry, planCustomMetadataSeed } from "@orglet/engine";
import { main } from "./main.js";

const ACME = fileURLToPath(new URL("../../../examples/acme/", import.meta.url));
const CMDT = fileURLToPath(new URL("../../../conformance/cmdt-check/project/", import.meta.url));

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
    expect(logs[0]).toMatch(/^\d+ objects \(4 custom, \d+ standard\), \d+ fields \(\d+ custom, \d+ standard\)$/);
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

  it("a validation rule traversing Opportunity.SyncedQuote compiles without a warning", async () => {
    const root = await project({
      "objects/Opportunity/validationRules/Synced_Quote_Accepted.validationRule-meta.xml":
        `<?xml version="1.0" encoding="UTF-8"?><ValidationRule xmlns="http://soap.sforce.com/2006/04/metadata"><fullName>Synced_Quote_Accepted</fullName><active>true</active><errorConditionFormula>ISPICKVAL(SyncedQuote.Status, 'Denied')</errorConditionFormula><errorMessage>Denied quote</errorMessage></ValidationRule>`,
    });
    try {
      expect(await main(["check", "--strict", "--project", root])).toBe(0);
      expect(warns).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
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

  const INFO_LINE = /^info: (\d+) standard objects not modelled and unreferenced: (.*)$/;
  const workOrder = { "objects/WorkOrder/fields/Foo__c.field-meta.xml": field("<fullName>Foo__c</fullName><type>Text</type><length>10</length>") };
  const barLookup = {
    "objects/Bar__c/fields/Wo__c.field-meta.xml": field("<fullName>Wo__c</fullName><type>Lookup</type><referenceTo>WorkOrder</referenceTo><relationshipName>Wo</relationshipName>"),
  };

  it("an unreferenced unmodelled standard object is listed on one info line after the warnings, not as a warning (BASE2-08)", async () => {
    const root = await project(workOrder);
    try {
      expect(await main(["check", "--project", root])).toBe(0);
      expect(warns.filter((w) => w.includes("WorkOrder"))).toEqual([]);
      const lines = logs.filter((l) => INFO_LINE.test(l));
      expect(lines).toHaveLength(1);
      expect(logs[logs.length - 1]).toBe(lines[0]);
      const m = INFO_LINE.exec(lines[0]!)!;
      const names = m[2]!.split(", ");
      expect(names).toContain("WorkOrder");
      expect(names).toContain("ActivityMetric");
      expect(names).toEqual([...names].sort());
      expect(Number(m[1])).toBe(names.length);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("--strict exits 0 when only informational items exist", async () => {
    const root = await project(workOrder);
    try {
      expect(await main(["check", "--strict", "--project", root])).toBe(0);
      expect(warns).toEqual([]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("a referenced unmodelled standard object keeps its warnings and fails --strict", async () => {
    const root = await project({ ...workOrder, ...barLookup });
    try {
      expect(await main(["check", "--strict", "--project", root])).toBe(1);
      expect(warns).toContain("warning: UNSUPPORTED:standard-object WorkOrder skipped");
      expect(warns).toContain("warning: UNSUPPORTED:reference-target WorkOrder is referenced but not defined; lookups to it are unchecked");
      const info = logs.find((l) => INFO_LINE.test(l))!;
      expect(INFO_LINE.exec(info)![2]!.split(", ")).not.toContain("WorkOrder");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("acme prints the info line and still no warning", async () => {
    expect(await main(["check", "--project", ACME])).toBe(0);
    expect(warns).toEqual([]);
    expect(logs.some((l) => INFO_LINE.test(l))).toBe(true);
    expect(logs[0]).toMatch(/^\d+ objects \(4 custom, \d+ standard\), \d+ fields \(\d+ custom, \d+ standard\)$/);
  });

  const SETTINGS_LINE = "info: 2 custom settings loaded without data (custom-setting data is not part of a retrieve): App_Config__c, Region_List__c";
  const settingOnly = () =>
    project({
      "objects/Cfg__c/Cfg__c.object-meta.xml":
        '<?xml version="1.0" encoding="UTF-8"?><CustomObject xmlns="http://soap.sforce.com/2006/04/metadata"><label>Cfg</label><customSettingsType>List</customSettingsType></CustomObject>',
    });

  it("lists __mdt types with m prefixes beside custom objects and counts records and labels (D-02, D-21)", async () => {
    expect(await main(["check", "--project", CMDT])).toBe(0);
    expect(logs[0]).toMatch(/^\d+ objects \(5 custom, \d+ standard\), \d+ fields \(\d+ custom, \d+ standard\)$/);
    for (const l of [
      "  App_Config__c  a00  (provisional)",
      "  Region_List__c  a01  (provisional)",
      "  Ticket__c  a02  (provisional)",
      "  Support_Tier__mdt  m00  (provisional)",
      "  Tier_Group__mdt  m01  (provisional)",
      "custom metadata: 5 records in 2 types",
      "2 custom labels",
    ]) expect(logs).toContain(l);
  });

  it("prints the fixture's eight warnings and fails --strict", async () => {
    expect(await main(["check", "--project", CMDT])).toBe(0);
    expect(warns).toHaveLength(8);
    const normalised = warns.map((w) => w.replace(/^(warning: UNSUPPORTED:custom-metadata-record ).*Retired_Type\.Old\.md-meta\.xml/, "$1<path>/Retired_Type.Old.md-meta.xml")).sort();
    expect(normalised).toEqual(
      [
        "warning: UNSUPPORTED:custom-metadata-record <path>/Retired_Type.Old.md-meta.xml: Retired_Type__mdt is not a custom metadata type in objects/; record Old skipped",
        "warning: UNSUPPORTED:custom-label welcome_message duplicates Welcome_Message; the first definition is kept",
        "warning: UNSUPPORTED:custom-metadata-record Support_Tier__mdt.Unknown_Field__c is not a field of Support_Tier__mdt; values dropped (records: Bronze)",
        "warning: UNSUPPORTED:custom-metadata-record Support_Tier__mdt.Max_Seats__c: values that cannot be stored as Number were stored as null (records: Bronze)",
        "warning: UNSUPPORTED:custom-metadata-record Support_Tier__mdt.Region__c: values that cannot be stored as Picklist were stored as null (records: Silver)",
        "warning: UNSUPPORTED:custom-metadata-record Support_Tier__mdt.Tier_Group__c: target Tier_Group__mdt record Missing_Group does not exist; stored as null (records: Bronze)",
        "warning: UNSUPPORTED:reference-target Support_Tier__mdt.Target_Object__c: EntityDefinition target Solution is not modelled by orglet; stored as null (records: Bronze)",
        "warning: UNSUPPORTED:reference-target Support_Tier__mdt.Target_Field__c: FieldDefinition target Account.No_Such_Field__c is not modelled by orglet; stored as null (records: Bronze)",
      ].sort(),
    );
    warns = [];
    expect(await main(["check", "--strict", "--project", CMDT])).toBe(1);
  });

  it("states that custom-setting data is not part of a retrieve on one info line, after the standard info line (D-20)", async () => {
    expect(await main(["check", "--project", CMDT])).toBe(0);
    expect(logs.filter((l) => l === SETTINGS_LINE)).toHaveLength(1);
    expect(logs[logs.length - 1]).toBe(SETTINGS_LINE);
    expect(warns.filter((w) => w.includes("App_Config__c") || w.includes("Region_List__c"))).toEqual([]);
    const standard = logs.find((l) => INFO_LINE.test(l));
    if (standard !== undefined) {
      const names = INFO_LINE.exec(standard)![2]!.split(", ");
      expect(names).not.toContain("App_Config__c");
      expect(names).not.toContain("Region_List__c");
    }
  });

  it("a project whose only finding is a custom setting passes --strict", async () => {
    const root = await settingOnly();
    try {
      expect(await main(["check", "--strict", "--project", root])).toBe(0);
      expect(warns).toEqual([]);
      expect(logs).toContain("info: 1 custom settings loaded without data (custom-setting data is not part of a retrieve): Cfg__c");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("--quiet hides the settings line", async () => {
    const root = await settingOnly();
    try {
      expect(await main(["check", "--quiet", "--project", root])).toBe(0);
      expect(logs).toEqual([]);
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
    expect(usage).toContain("--summary");
    expect(usage).toContain("--json");
    expect(usage).toContain("--strict");
    expect(usage).toContain("orglet reset [--db <postgres-url>] [--org-schema <name>] [--drop-prefixes]");
  });
});

const summary = (name: string, target: string, fk: string, op = "sum") =>
  field(`<fullName>${name}</fullName><label>${name}</label><type>Summary</type><summaryForeignKey>${fk}</summaryForeignKey><summaryOperation>${op}</summaryOperation><summarizedField>${target}</summarizedField>`);
const masterDetail = (name: string, ref: string, rel: string) =>
  field(`<fullName>${name}</fullName><label>${name}</label><type>MasterDetail</type><referenceTo>${ref}</referenceTo><relationshipName>${rel}</relationshipName><relationshipLabel>${rel}</relationshipLabel><reprioritizeMasterDetail>false</reprioritizeMasterDetail><writeRequiresMasterRead>false</writeRequiresMasterRead>`);
const formulaField = (name: string, type: string, precision: number, scale: number, formula: string) =>
  field(`<fullName>${name}</fullName><label>${name}</label><type>${type}</type><precision>${precision}</precision><scale>${scale}</scale><formula>${formula}</formula>`);
const numberField = (name: string, type: string, precision: number, scale: number) =>
  field(`<fullName>${name}</fullName><label>${name}</label><type>${type}</type><precision>${precision}</precision><scale>${scale}</scale>`);
const rollupBase = (): Record<string, string> => ({
  "objects/Child__c/fields/Parent__c.field-meta.xml": masterDetail("Parent__c", "Parent__c", "Children"),
  "objects/Child__c/fields/Qty__c.field-meta.xml": numberField("Qty__c", "Number", 10, 0),
  "objects/Child__c/fields/Price__c.field-meta.xml": numberField("Price__c", "Currency", 16, 2),
  "objects/Child__c/fields/Due__c.field-meta.xml": field("<fullName>Due__c</fullName><label>Due</label><type>Date</type>"),
  "objects/Child__c/fields/Line__c.field-meta.xml": formulaField("Line__c", "Currency", 18, 2, "Qty__c * Price__c"),
  "objects/Parent__c/fields/Sum_Line__c.field-meta.xml": summary("Sum_Line__c", "Child__c.Line__c", "Child__c.Parent__c"),
});

describe("check with roll-ups over formula fields", () => {
  it("check reports a roll-up over a volatile formula as UNSUPPORTED:rollup-formula and --strict fails", async () => {
    const root = await project({
      ...rollupBase(),
      "objects/Child__c/fields/Age__c.field-meta.xml": formulaField("Age__c", "Number", 18, 0, "TODAY() - Due__c"),
      "objects/Parent__c/fields/Sum_Age__c.field-meta.xml": summary("Sum_Age__c", "Child__c.Age__c", "Child__c.Parent__c"),
    });
    try {
      expect(await main(["check", "--project", root])).toBe(0);
      expect(warns.filter((w) => w.includes("rollup"))).toEqual(["warning: UNSUPPORTED:rollup-formula Parent__c.Sum_Age__c: Child__c.Age__c uses TODAY(); field skipped"]);
      warns = [];
      expect(await main(["check", "--strict", "--project", root])).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("check accepts a roll-up over a same-object formula without a warning", async () => {
    const root = await project(rollupBase());
    try {
      expect(await main(["check", "--project", root])).toBe(0);
      expect(warns).toEqual([]);
      expect(await main(["check", "--strict", "--project", root])).toBe(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("check reports a formula -> roll-up -> formula cycle first and the formulas that read a skipped roll-up after it", async () => {
    const root = await project({
      "objects/A__c/fields/B__c.field-meta.xml": masterDetail("B__c", "B__c", "As"),
      "objects/A__c/fields/R__c.field-meta.xml": summary("R__c", "B__c.F__c", "B__c.A__c"),
      "objects/A__c/fields/G__c.field-meta.xml": formulaField("G__c", "Number", 18, 0, "R__c * 1"),
      "objects/B__c/fields/A__c.field-meta.xml": masterDetail("A__c", "A__c", "Bs"),
      "objects/B__c/fields/R2__c.field-meta.xml": summary("R2__c", "A__c.G__c", "A__c.B__c"),
      "objects/B__c/fields/F__c.field-meta.xml": formulaField("F__c", "Number", 18, 0, "R2__c * 1"),
    });
    try {
      expect(await main(["check", "--project", root])).toBe(0);
      const cycle = [
        "warning: UNSUPPORTED:rollup-cycle A__c.R__c: roll-up summaries and formula fields read each other in a cycle (A__c.R__c -> B__c.F__c -> B__c.R2__c -> A__c.G__c -> A__c.R__c); field skipped",
        "warning: UNSUPPORTED:rollup-cycle B__c.R2__c: roll-up summaries and formula fields read each other in a cycle (B__c.R2__c -> A__c.G__c -> A__c.R__c -> B__c.F__c -> B__c.R2__c); field skipped",
      ];
      const formulas = [
        "warning: UNSUPPORTED:formula formula field A__c.G__c skipped: Field R__c does not exist. Check spelling.",
        "warning: UNSUPPORTED:formula formula field B__c.F__c skipped: Field R2__c does not exist. Check spelling.",
      ];
      expect([...warns].sort()).toEqual([...cycle, ...formulas].sort());
      const lastCycle = Math.max(...cycle.map((w) => warns.indexOf(w)));
      for (const w of formulas) expect(warns.indexOf(w)).toBeGreaterThan(lastCycle);
      warns = [];
      expect(await main(["check", "--strict", "--project", root])).toBe(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

const NAMES = ["Foo__c", "Ext__c", "Support_Tier__mdt", "Tier_Group__mdt", "App_Config__c", "Region_List__c", "Ticket__c", "Welcome_Message", "Retired_Type", "F__c"];
const cascadeProject = () =>
  project({
    "objects/Foo__c/fields/Ext__c.field-meta.xml": field("<fullName>Ext__c</fullName><type>ExternalLookup</type>"),
    "objects/Foo__c/fields/F__c.field-meta.xml": field("<fullName>F__c</fullName><type>Text</type><length>10</length><formula>Ext__c</formula>"),
    "objects/Foo__c/validationRules/R.validationRule-meta.xml":
      `<?xml version="1.0" encoding="UTF-8"?><ValidationRule xmlns="http://soap.sforce.com/2006/04/metadata"><fullName>R</fullName><active>true</active><errorConditionFormula>LEN(Ext__c) &gt; 1</errorConditionFormula><errorMessage>x</errorMessage></ValidationRule>`,
  });

describe("check report", () => {
  // A baseline regeneration legitimately changes the census and the info line: update the files with
  // `pnpm vitest run packages/cli/src/main.test.ts -u` as a reviewed step. CI runs without -u, so drift fails.
  it("prints a stable census, verdict and area table for examples/acme", async () => {
    expect(await main(["check", "--project", ACME])).toBe(0);
    await expect(logs.join("\n") + "\n").toMatchFileSnapshot("./__snapshots__/check-acme.txt");
  });

  it("the acme summary is a stable prefix-free count report", async () => {
    expect(await main(["check", "--summary", "--project", ACME])).toBe(0);
    await expect(logs.join("\n") + "\n").toMatchFileSnapshot("./__snapshots__/check-acme-summary.txt");
  });

  it("default check prints warning lines byte-identical to the loader, seed plan and formula registry, in that order", async () => {
    const cascade = await cascadeProject();
    const warn = await warningProject();
    try {
      for (const projectDir of [CMDT, warn, cascade]) {
        warns = [];
        logs = [];
        const result = admitFormulaRollups(await loadOrgSchema({ projectDir }));
        const cmdt = planCustomMetadataSeed(result.schema, result.customMetadata);
        const expected = [...result.warnings, ...cmdt.warnings, ...new FormulaRegistry(result.schema, cmdt).warnings].map((w) => `warning: ${w}`);
        await main(["check", "--project", projectDir]);
        expect(warns).toEqual(expected);
        // The verdict counts exactly the warning lines printed.
        const verdict = logs.find((l) => l.startsWith("verdict:"))!;
        expect(verdict).toContain(expected.length === 0 ? "verdict: clean (warnings: 0" : `${expected.length} warnings to review`);
      }
    } finally {
      await rm(warn, { recursive: true, force: true });
      await rm(cascade, { recursive: true, force: true });
    }
  });

  it("the root causes section lists a skipped ExternalLookup field with the formula and validation rule that read it", async () => {
    const root = await cascadeProject();
    try {
      await main(["check", "--project", root]);
      const at = logs.indexOf("root causes with dependents:");
      expect(at, logs.join("\n")).toBeGreaterThanOrEqual(0);
      expect(logs[at + 1]).toMatch(/^ {2}UNSUPPORTED:field-type .*\[2 dependents\]$/);
      expect(logs[at + 2]).toMatch(/^ {4}UNSUPPORTED:formula /);
      expect(logs[at + 3]).toMatch(/^ {4}UNSUPPORTED:formula /);
      expect(logs.find((l) => l.startsWith("verdict:"))).toContain("3 warnings to review (root causes: 1, dependents: 2,");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("summary prints no object, field or rule names and no warning lines", async () => {
    const cascade = await cascadeProject();
    try {
      for (const projectDir of [CMDT, cascade]) {
        warns = [];
        logs = [];
        await main(["check", "--summary", "--project", projectDir]);
        expect(warns).toEqual([]);
        const out = logs.join("\n");
        for (const n of NAMES) expect(out).not.toContain(n);
        expect(out).toContain("verdict:");
        expect(out).toContain("areas:");
        expect(out).not.toContain("(provisional)");
        // The area table has `info:<area>` count rows; only the name-listing `info: N ...` lines are forbidden.
        expect(logs.filter((l) => l.startsWith("info: "))).toEqual([]);
        expect(out).not.toContain("root causes with dependents");
        expect(logs[0]).toMatch(/^\d+ objects \(/);
      }
    } finally {
      await rm(cascade, { recursive: true, force: true });
    }
  });

  it("json prints the full report including the informational category and no warning lines", async () => {
    expect(await main(["check", "--json", "--project", CMDT])).toBe(0);
    expect(warns).toEqual([]);
    expect(logs).toHaveLength(1);
    const r = JSON.parse(logs[0]!) as { version: number; verdict: { warnings: number }; diagnostics: unknown[]; info: { area: string }[]; areas: { key: string }[] };
    expect(r.version).toBe(1);
    expect(r.verdict.warnings).toBe(8);
    expect(r.diagnostics).toHaveLength(8);
    expect(r.info.some((d) => d.area === "custom-setting-no-data")).toBe(true);
    expect(r.areas.some((a) => a.key === "info:custom-setting-no-data")).toBe(true);
  });

  it("json with summary prints only census, verdict and areas", async () => {
    expect(await main(["check", "--json", "--summary", "--project", CMDT])).toBe(0);
    expect(Object.keys(JSON.parse(logs[0]!) as object).sort()).toEqual(["areas", "census", "verdict", "version"]);
    for (const n of NAMES) expect(logs[0]).not.toContain(n);
  });

  it("json prints even with --quiet", async () => {
    expect(await main(["check", "--json", "--quiet", "--project", ACME])).toBe(0);
    expect(logs).toHaveLength(1);
    expect(() => void JSON.parse(logs[0]!)).not.toThrow();
  });

  it("--quiet hides the text report but not the warning lines", async () => {
    const root = await warningProject();
    try {
      expect(await main(["check", "--quiet", "--project", root])).toBe(0);
      expect(logs).toEqual([]);
      expect(warns.length).toBeGreaterThanOrEqual(1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("strict exits 1 on a warning and 0 on informational entries alone, in every output mode", async () => {
    const warn = await warningProject();
    const infoOnly = await project({ "objects/WorkOrder/fields/Foo__c.field-meta.xml": field("<fullName>Foo__c</fullName><type>Text</type><length>10</length>") });
    try {
      for (const flags of [[], ["--summary"], ["--json"], ["--json", "--summary"]]) {
        expect(await main(["check", "--strict", ...flags, "--project", warn]), flags.join(" ")).toBe(1);
        expect(await main(["check", "--strict", ...flags, "--project", infoOnly]), flags.join(" ")).toBe(0);
      }
    } finally {
      await rm(warn, { recursive: true, force: true });
      await rm(infoOnly, { recursive: true, force: true });
    }
  });
});
