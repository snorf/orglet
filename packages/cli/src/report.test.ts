/**
 * Pins the rules of the `orglet check` report core: root-cause grouping, counts, ordering independent of input order,
 * summary redaction and the exact text of the formatters.
 */
import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatDiagnostic, loadOrgSchema, type Diagnostic, type FormulaFailure, type InfoDiagnostic } from "@orglet/metadata";
import { admitFormulaRollups } from "@orglet/formula";
import { FormulaRegistry, planCustomMetadataSeed } from "@orglet/engine";
import { buildCheckReport, formatAreas, formatCensus, formatGroups, formatVerdict, summariseCheckReport, type CheckInputs, type CheckReport } from "./report.js";

interface StubField { name: string; custom?: boolean; featureGated?: boolean; referenceTo?: string[] }
interface StubObject { name: string; custom?: boolean; customSetting?: "List" | "Hierarchy"; fields?: StubField[] }

function stubSchema(objs: StubObject[], labels = 0): CheckInputs["schema"] {
  const objects = new Map(
    objs.map((o) => [o.name.toLowerCase(), { name: o.name, custom: o.custom ?? false, customSetting: o.customSetting, fields: (o.fields ?? []).map((f) => ({ custom: false, ...f })) }]),
  );
  const getField = (object: string, field: string) => objects.get(object.toLowerCase())?.fields.find((f) => f.name.toLowerCase() === field.toLowerCase());
  return { objects, labels: new Map(Array.from({ length: labels }, (_, i) => [`l${i}`, {}])), getField } as unknown as CheckInputs["schema"];
}
const EMPTY = stubSchema([]);
const inputs = (diagnostics: Diagnostic[], over: Partial<CheckInputs> = {}): CheckInputs => ({
  schema: EMPTY,
  diagnostics,
  info: [],
  customMetadata: { types: 0, records: 0 },
  ...over,
});

const fieldType = (object: string, field: string): Diagnostic => ({ area: "field-type", object, field, message: `${object}: field type ExternalLookup is not supported yet; field skipped` });
const failure = (what: string, object: string, field: string, missing?: { object: string; field: string }): FormulaFailure => ({
  area: "formula",
  what,
  object,
  field,
  message: `${what} skipped: Field does not exist`,
  ...(missing ? { missing } : {}),
});
const rollup = (area: string, object: string, field: string, cause?: string): Diagnostic => ({
  area,
  object,
  field,
  message: `roll-up ${object}.${field} skipped`,
  ...(cause ? { cause } : {}),
});

const FIXTURES: Record<string, CheckInputs> = {
  externalLookup: inputs([fieldType("Foo__c", "Ext__c"), failure("formula field Foo__c.F__c", "Foo__c", "F__c", { object: "Foo__c", field: "Ext__c" }), failure("validation rule Foo__c.R", "Foo__c", "R", { object: "Foo__c", field: "Ext__c" })]),
  rollupChain: inputs([
    rollup("rollup-formula", "Parent__c", "A__c"),
    rollup("rollup-target", "Parent__c", "B__c", "rollup-formula:Parent__c.A__c"),
    rollup("rollup-target", "Grand__c", "C__c", "rollup-target:Parent__c.B__c"),
  ]),
  cycle: inputs([rollup("rollup-cycle", "A__c", "R__c"), failure("formula field A__c.F__c", "A__c", "F__c", { object: "A__c", field: "R__c" })]),
  standardId: inputs([
    { area: "standard-field", object: "Opportunity", field: "SyncedQuoteId", message: "Opportunity.SyncedQuoteId skipped" },
    failure("formula field Opportunity.F__c", "Opportunity", "F__c", { object: "Opportunity", field: "SyncedQuote" }),
  ]),
  object: inputs(
    [
      { area: "reference-target", object: "WorkOrder", message: "WorkOrder is referenced but not defined; lookups to it are unchecked" },
      { area: "standard-object", object: "WorkOrder", message: "WorkOrder skipped" },
      failure("formula field Bar__c.F__c", "Bar__c", "F__c", { object: "Bar__c", field: "Wo__r" }),
    ],
    { schema: stubSchema([{ name: "Bar__c", custom: true, fields: [{ name: "Wo__c", custom: true, referenceTo: ["WorkOrder"] }] }]) },
  ),
};

function stable(r: CheckReport) {
  return { census: r.census, verdict: r.verdict, areas: r.areas, groups: r.groups };
}
function permutations(i: CheckInputs): CheckInputs[] {
  const rev = [...i.diagnostics].reverse();
  const shuffled = i.diagnostics.map((_, k, a) => a[(k * 2 + 1) % a.length] as Diagnostic);
  const uniq = new Set(shuffled).size === i.diagnostics.length ? shuffled : rev;
  return [{ ...i, diagnostics: rev }, { ...i, diagnostics: uniq }];
}

describe("root-cause grouping", () => {
  it("a formula that reads a skipped ExternalLookup field is listed under the field-type root, not as a root of its own", () => {
    const r = buildCheckReport(FIXTURES.externalLookup as CheckInputs);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]?.root.area).toBe("field-type");
    expect(r.groups[0]?.dependents).toHaveLength(2);
    expect(r.verdict).toMatchObject({ warnings: 3, rootCauses: 1, dependents: 2 });
  });

  it("a roll-up dropped because of another drop follows its cause key to the top root", () => {
    const r = buildCheckReport(FIXTURES.rollupChain as CheckInputs);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]?.root).toMatchObject({ area: "rollup-formula", field: "A__c" });
    expect(r.groups[0]?.dependents.map((d) => d.field).sort()).toEqual(["B__c", "C__c"]);
  });

  it("a formula that reads a roll-up skipped in a cycle is grouped under the cycle diagnostic", () => {
    const r = buildCheckReport(FIXTURES.cycle as CheckInputs);
    expect(r.groups[0]?.root.area).toBe("rollup-cycle");
    expect(r.groups[0]?.dependents).toHaveLength(1);
  });

  it("a relationship traversal over a skipped standard Id field is grouped under the standard-field diagnostic", () => {
    const r = buildCheckReport(FIXTURES.standardId as CheckInputs);
    expect(r.groups[0]?.root).toMatchObject({ area: "standard-field", field: "SyncedQuoteId" });
    expect(r.groups[0]?.dependents).toHaveLength(1);
  });

  it("a traversal through a lookup whose target object was skipped is grouped under the object skip", () => {
    const r = buildCheckReport(FIXTURES.object as CheckInputs);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]?.root.area).toBe("standard-object");
    expect(r.groups[0]?.dependents.map((d) => d.area).sort()).toEqual(["formula", "reference-target"]);
    expect(r.verdict).toMatchObject({ warnings: 3, rootCauses: 1, dependents: 2 });
  });

  it("a cause that points back to its own chain never loops", () => {
    const r = buildCheckReport(inputs([rollup("rollup-target", "P__c", "A__c", "rollup-target:P__c.B__c"), rollup("rollup-target", "P__c", "B__c", "rollup-target:P__c.A__c")]));
    expect(r.verdict.warnings).toBe(2);
    expect(r.verdict.rootCauses + r.verdict.dependents).toBe(2);
  });

  it("a diagnostic whose cause or missing field resolves to nothing is its own root", () => {
    const r = buildCheckReport(inputs([rollup("rollup-target", "P__c", "A__c", "rollup-formula:Nope__c.X__c"), failure("formula field Q__c.F__c", "Q__c", "F__c", { object: "Q__c", field: "Gone__c" }), failure("formula field Q__c.G__c", "Q__c", "G__c")]));
    expect(r.groups).toEqual([]);
    expect(r.verdict).toMatchObject({ warnings: 3, rootCauses: 3, dependents: 0 });
  });

  it("warnings always equal root causes plus dependents", () => {
    for (const i of Object.values(FIXTURES)) {
      const r = buildCheckReport(i);
      expect(r.verdict.warnings).toBe(i.diagnostics.length);
      expect(r.verdict.rootCauses + r.verdict.dependents).toBe(r.verdict.warnings);
      expect(r.groups.reduce((n, g) => n + g.dependents.length, 0)).toBe(r.verdict.dependents);
    }
  });

  it("the report is identical for any input order", () => {
    for (const i of Object.values(FIXTURES)) {
      const base = stable(buildCheckReport(i));
      for (const p of permutations(i)) expect(stable(buildCheckReport(p))).toEqual(base);
    }
  });
});

describe("counts and ordering", () => {
  it("areas list warnings before informational entries, each sorted by area in code-point order", () => {
    const info: InfoDiagnostic[] = [
      { area: "standard-object-unmodelled", object: "Zed", message: "z", severity: "info" },
      { area: "custom-setting-no-data", object: "Cs__c", message: "c", severity: "info" },
    ];
    const r = buildCheckReport(inputs([{ area: "rollup-target", message: "a" }, { area: "formula", message: "b" }, { area: "Z-upper", message: "c" }, { area: "formula", message: "d" }], { info }));
    expect(r.areas.map((a) => a.key)).toEqual(["UNSUPPORTED:Z-upper", "UNSUPPORTED:formula", "UNSUPPORTED:rollup-target", "info:custom-setting-no-data", "info:standard-object-unmodelled"]);
    expect(r.areas.find((a) => a.area === "formula")?.count).toBe(2);
    expect(r.verdict.info).toBe(2);
  });

  it("census counts objects and fields as custom and standard", () => {
    const schema = stubSchema(
      [
        { name: "Account", fields: [{ name: "Id" }, { name: "Name" }, { name: "Gated", featureGated: true }] },
        { name: "Contact", fields: [{ name: "Id" }, { name: "X__c", custom: true }] },
        { name: "Cust__c", custom: true, fields: [{ name: "Id" }, { name: "Y__c", custom: true }] },
        { name: "T__mdt", custom: true, fields: [] },
        { name: "S__c", custom: true, customSetting: "Hierarchy", fields: [] },
      ],
      2,
    );
    const r = buildCheckReport(inputs([], { schema, customMetadata: { types: 1, records: 4 } }));
    expect(r.census).toEqual({
      objects: { total: 5, custom: 3, standard: 2 },
      fields: { total: 7, custom: 2, standard: 5 },
      featureGatedFields: 1,
      customMetadataTypes: 1,
      customMetadataRecords: 4,
      customSettings: 1,
      labels: 2,
    });
  });
});

describe("a real project", () => {
  const roots: string[] = [];
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
  });
  const field = (b: string) => `<?xml version="1.0" encoding="UTF-8"?><CustomField xmlns="http://soap.sforce.com/2006/04/metadata">${b}</CustomField>`;
  const rule = (b: string) => `<?xml version="1.0" encoding="UTF-8"?><ValidationRule xmlns="http://soap.sforce.com/2006/04/metadata">${b}</ValidationRule>`;

  it("a project with an ExternalLookup field, a formula and a validation rule that read it reports one root cause and two dependents", async () => {
    const root = await mkdtemp(join(tmpdir(), "orglet-report-"));
    roots.push(root);
    const files: Record<string, string> = {
      "objects/Foo__c/fields/Ext__c.field-meta.xml": field("<fullName>Ext__c</fullName><type>ExternalLookup</type>"),
      "objects/Foo__c/fields/F__c.field-meta.xml": field("<fullName>F__c</fullName><type>Text</type><length>50</length><formula>Ext__r.Name</formula>"),
      "objects/Foo__c/validationRules/R.validationRule-meta.xml": rule("<fullName>R</fullName><active>true</active><errorConditionFormula>ISBLANK(Ext__c)</errorConditionFormula><errorMessage>x</errorMessage>"),
    };
    for (const [rel, content] of Object.entries(files)) {
      const p = join(root, rel);
      await mkdir(join(p, ".."), { recursive: true });
      await writeFile(p, content);
    }
    const result = admitFormulaRollups(await loadOrgSchema({ projectDir: root }));
    const cmdt = planCustomMetadataSeed(result.schema, result.customMetadata);
    const registry = new FormulaRegistry(result.schema, cmdt);
    const diagnostics = [...result.diagnostics, ...cmdt.diagnostics, ...registry.diagnostics];
    const warnings = [...result.warnings, ...cmdt.warnings, ...registry.warnings];
    expect(diagnostics.map(formatDiagnostic)).toEqual(warnings);
    const r = buildCheckReport({ schema: result.schema, diagnostics, info: result.info, customMetadata: { types: cmdt.types.length, records: cmdt.records } });
    expect(r.verdict).toMatchObject({ warnings: 3, rootCauses: 1, dependents: 2 });
    expect(r.groups[0]?.root.area).toBe("field-type");
  });
});

describe("summary and formatters", () => {
  it("the summary carries no object, field or rule names", () => {
    for (const i of Object.values(FIXTURES)) {
      const s = summariseCheckReport(buildCheckReport(i));
      expect(Object.keys(s).sort()).toEqual(["areas", "census", "verdict", "version"]);
      const text = JSON.stringify(s);
      for (const name of ["Foo__c", "Ext__c", "WorkOrder", "SyncedQuote", "Bar__c"]) expect(text).not.toContain(name);
    }
  });

  const census = { objects: { total: 57, custom: 4, standard: 53 }, fields: { total: 3643, custom: 25, standard: 3618 } };
  it("formatCensus states custom and standard counts for objects and fields", () => {
    expect(formatCensus({ census: census as CheckReport["census"] })).toBe("57 objects (4 custom, 53 standard), 3643 fields (25 custom, 3618 standard)");
  });

  it("the verdict is one line and says clean when there are no warnings", () => {
    expect(formatVerdict({ verdict: { ok: true, warnings: 0, rootCauses: 0, dependents: 0, info: 39 } })).toBe("verdict: clean (warnings: 0, informational: 39)");
  });

  it("the verdict states root causes and dependents when there are warnings", () => {
    expect(formatVerdict({ verdict: { ok: false, warnings: 3, rootCauses: 1, dependents: 2, info: 0 } })).toBe("verdict: 3 warnings to review (root causes: 1, dependents: 2, informational: 0)");
  });

  it("the area table is keyed by the UNSUPPORTED token with aligned columns", () => {
    expect(
      formatAreas({
        areas: [
          { key: "UNSUPPORTED:field-type", area: "field-type", severity: "warning", count: 1, dependents: 0 },
          { key: "UNSUPPORTED:formula", area: "formula", severity: "warning", count: 2, dependents: 2 },
          { key: "info:standard-object-unmodelled", area: "standard-object-unmodelled", severity: "info", count: 39, dependents: 0 },
        ],
      }),
    ).toEqual([
      "areas:",
      "  UNSUPPORTED:field-type              1",
      "  UNSUPPORTED:formula                 2  (2 dependents)",
      "  info:standard-object-unmodelled    39",
    ]);
    expect(formatAreas({ areas: [] })).toEqual([]);
  });

  it("root-cause groups list the root and every dependent as their warning text", () => {
    const root = fieldType("Foo__c", "Ext__c");
    const dep = failure("formula field Foo__c.F__c", "Foo__c", "F__c");
    expect(formatGroups({ groups: [{ root, dependents: [dep] }] })).toEqual(["root causes with dependents:", `  ${formatDiagnostic(root)}  [1 dependents]`, `    ${formatDiagnostic(dep)}`]);
    expect(formatGroups({ groups: [] })).toEqual([]);
  });
});
