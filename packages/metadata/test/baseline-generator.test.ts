/**
 * Step-A gate for the baseline generator (BASE2-01, BASE2-02 step 1): regeneration is deterministic, the v1.0 scope
 * reproduces the frozen v1.0 fixture field for field, the committed standard objects are exactly the CLI's output, and
 * the sources carry most of v1.0 on their own (pins are the exception layer, not the baseline). Runs in memory on the
 * committed inputs: no fs writes, no network.
 */
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import type { StandardObjectJson } from "@orglet/metadata";
import { CLI_OPTIONS, generate, type GenerateResult } from "../../../scripts/gen-baseline/pipeline.js";
import { loadInputs, type GeneratorInputs } from "../../../scripts/gen-baseline/sources.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURE_DIR = `${REPO_ROOT}packages/metadata/test/fixtures/baseline-v1.0/objects/`;
const STANDARD_DIR = `${REPO_ROOT}packages/metadata/standard/`;
const codeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

let inputs: GeneratorInputs;
let v1: GenerateResult;

beforeAll(async () => {
  inputs = await loadInputs(REPO_ROOT);
  v1 = generate(inputs, { v1Only: true });
});

describe("baseline generator (BASE2-01, BASE2-02 step A)", () => {
  it("two in-memory runs yield identical bytes", () => {
    const again = generate(inputs, { v1Only: true });
    expect([...again.files.keys()]).toEqual([...v1.files.keys()]);
    for (const [path, text] of v1.files) expect(again.files.get(path)).toBe(text);
  });

  it("v1.0 scope reproduces the frozen v1.0 fixture for all 35 objects", () => {
    const fixtureFiles = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json")).sort(codeUnit);
    expect(fixtureFiles).toHaveLength(35);
    expect([...v1.files.keys()].sort(codeUnit)).toEqual(fixtureFiles.map((f) => `objects/${f}`));
    for (const file of fixtureFiles) {
      const fixture = JSON.parse(readFileSync(`${FIXTURE_DIR}${file}`, "utf8")) as StandardObjectJson;
      const generated = JSON.parse(v1.files.get(`objects/${file}`)!) as StandardObjectJson;
      // D-19 sorts fields by code-unit order; 20 v1.0 files were hand-ordered, so the fixture is compared field by field.
      const sortedFixture = { ...fixture, fields: [...fixture.fields].sort((a, b) => codeUnit(a.name, b.name)) };
      expect(generated, file).toEqual(sortedFixture);
    }
  });

  it("the committed standard objects are exactly the CLI regeneration", () => {
    const cli = generate(inputs, CLI_OPTIONS);
    for (const [path, text] of cli.files) expect(readFileSync(`${STANDARD_DIR}${path}`, "utf8"), path).toBe(text);
    const committed = readdirSync(`${STANDARD_DIR}objects/`).filter((f) => f.endsWith(".json")).map((f) => `objects/${f}`).sort(codeUnit);
    expect(committed).toEqual([...cli.files.keys()].sort(codeUnit));
  });

  it("fields are sorted by code-unit order in every output file", () => {
    for (const [path, text] of v1.files) {
      const names = (JSON.parse(text) as StandardObjectJson).fields.map((f) => f.name);
      expect(names, path).toEqual([...names].sort(codeUnit));
    }
  });

  it("most v1.0 fields come from the sources, not from pins", () => {
    expect(v1.report.unpinnedV1Fields.length + v1.report.pinnedFields.length).toBe(659);
    expect(v1.report.unpinnedV1Fields.length).toBeGreaterThanOrEqual(200);
  });

  it("no conflict is left unresolved", () => {
    // generate() throws on an unresolved conflict, so reaching here means every disagreement was settled;
    // the report must say by what.
    expect(v1.report.conflictsSettledByPin.length + v1.report.overrideResolved.length).toBeGreaterThan(0);
    for (const entry of [...v1.report.conflictsSettledByPin, ...v1.report.overrideResolved]) expect(entry).toMatch(/^[A-Za-z0-9]+\.[A-Za-z0-9]+\.[a-zA-Z]+$/);
  });
});
