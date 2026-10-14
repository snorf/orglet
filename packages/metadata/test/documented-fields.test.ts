/**
 * SC3 proof for the v2 baseline (BASE2-02): a retrieve that declares every documented field of the 35 standard objects
 * loads with no UNSUPPORTED:standard-field except the fields the generator itself reports as skipped (unsupported type,
 * or a reference target outside the object list), and that skipped set stays within the ratio Johan accepted at the
 * 09-06 checkpoint. Runs in memory on the committed inputs plus a temp SFDX project; no network.
 */
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildOrgSchema, loadBaseline, readSourceProject, type BuildResult } from "@orglet/metadata";
import { CLI_OPTIONS, generate, type GenerateResult } from "../../../scripts/gen-baseline/pipeline.js";
import { loadInputs, type GeneratorInputs } from "../../../scripts/gen-baseline/sources.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
/**
 * Documented skips Johan accepted at the 09-06 checkpoint: 83/818 = 0.1015 assuming all 13 name-rule fields were
 * documented; Product2.RecordTypeId is field_reference-only, so the documented count is 84/818 = 0.1027 (the raw
 * ratio 99/818 = 12.1 % matches the decision exactly). Bound rounded up to three decimals; lowering it is a decision.
 */
const SKIP_RATIO_MAX = 0.103;
// The loader adds these (standard/README.md); matched lower-cased because Postgres columns are.
const SYSTEM = new Set(["id", "isdeleted", "createddate", "createdbyid", "lastmodifieddate", "lastmodifiedbyid", "systemmodstamp", "ownerid"]);
const codeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const fieldOf = (entry: string): string => entry.split(" ")[0]!;
const fieldXml = (name: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><CustomField xmlns="http://soap.sforce.com/2006/04/metadata"><fullName>${name}</fullName></CustomField>`;

let inputs: GeneratorInputs;
let full: GenerateResult;
let projectDir: string;
/** `Obj.Field` of every documented field written to the retrieve. */
const written = new Set<string>();
let result: BuildResult;

beforeAll(async () => {
  inputs = await loadInputs(REPO_ROOT);
  full = generate(inputs, CLI_OPTIONS);
  projectDir = await mkdtemp(join(tmpdir(), "orglet-documented-fields-"));
  for (const object of inputs.objects) {
    const overrides = inputs.overrides.objects[object]?.fields ?? {};
    const names = new Set([...(inputs.sfSkills.get(object)?.fields.keys() ?? []), ...(inputs.objectReference.get(object)?.fields.keys() ?? [])]);
    // macOS file systems are case-insensitive: documented case variants (Entitlement.AssetWarrantyID / AssetWarrantyId)
    // would overwrite each other, so one file per lower-cased name; the expectation below is restricted to `written`.
    const seen = new Set<string>();
    const dir = join(projectDir, "objects", object, "fields");
    await mkdir(dir, { recursive: true });
    for (const name of [...names].sort(codeUnit)) {
      if (name.endsWith("__c") || SYSTEM.has(name.toLowerCase()) || overrides[name]?.skip || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      written.add(`${object}.${name}`);
      await writeFile(join(dir, `${name}.field-meta.xml`), fieldXml(name));
    }
  }
  result = buildOrgSchema(await loadBaseline(), await readSourceProject(projectDir));
});

afterAll(async () => {
  await rm(projectDir, { recursive: true, force: true });
});

describe("documented fields of the 35 standard objects (SC3)", () => {
  it("a retrieve using every documented field of the 35 objects reports no UNSUPPORTED:standard-field outside the generator's reported skips", () => {
    expect(written.size).toBeGreaterThan(1000);
    const skipped = [...full.report.skipped.fieldType, ...full.report.skipped.referenceTarget].map(fieldOf).filter((f) => written.has(f)).sort(codeUnit);
    const reported = result.diagnostics.filter((d) => d.area === "standard-field").map((d) => `${d.object}.${d.field}`).sort(codeUnit);
    expect(reported).toEqual(skipped);
    expect(result.diagnostics.filter((d) => d.area === "reference-target")).toEqual([]);
    expect(result.warnings.filter((w) => w.startsWith("UNSUPPORTED:standard-field")).length).toBe(skipped.length);
  });

  it("skipped documented fields stay within the accepted ratio", () => {
    const { documentedNew, skippedDocumented } = full.report.totals;
    const perObject = Object.entries(full.report.skipped.perObject)
      .filter(([, c]) => c.fieldType + c.referenceTarget > 0)
      .map(([object, c]) => `${object}: field-type ${c.fieldType}, reference-target ${c.referenceTarget}`)
      .join("\n  ");
    const message = `documented skips ${skippedDocumented}/${documentedNew} = ${(skippedDocumented / documentedNew).toFixed(4)} > SKIP_RATIO_MAX ${SKIP_RATIO_MAX}; skips per object (documented and sdk-only):\n  ${perObject}`;
    expect(documentedNew).toBeGreaterThan(0);
    expect(skippedDocumented / documentedNew, message).toBeLessThanOrEqual(SKIP_RATIO_MAX);
  });
});
