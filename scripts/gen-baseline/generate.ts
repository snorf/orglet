/**
 * IO shell of the baseline generator, run by `pnpm baseline:gen`. Offline: it reads only the committed inputs under
 * scripts/gen-baseline and writes packages/metadata/standard/objects/*.json (D-02). `--check` compares instead of
 * writing and exits 1 listing every differing, missing or stray file (the CI drift gate, D-18). `--bootstrap-pins` is a
 * one-off maintenance mode that derives v1-pins.json and the overrides.json keep entries from the frozen v1.0 fixture;
 * it is the only mode that reads the fixture. `--report` runs full mode (every documented field) in memory with
 * `collectConflicts` and prints the report as sorted JSON without writing anything: the step-B review input (09-06).
 * Both gen and `--check` refuse to proceed while a single-target lookup lacks an identifier-shaped relationshipName.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import type { StandardObjectJson } from "@orglet/metadata";
import { CLI_OPTIONS, deriveFromSources, FIELD_KEY_ORDER, generate, GeneratorError, OBJECT_KEY_ORDER, orderKeys, relationshipNameProblems, serialise, sortKeysDeep, type GeneratorReport } from "./pipeline.js";
import { codeUnit, loadInputs, type FieldOverride, type GeneratorInputs, type ObjectPins, type Overrides, type Pins } from "./sources.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const GEN_DIR = join(ROOT, "scripts", "gen-baseline");
const STANDARD_DIR = join(ROOT, "packages", "metadata", "standard");
const FIXTURE_DIR = join(ROOT, "packages", "metadata", "test", "fixtures", "baseline-v1.0", "objects");
const KEEP_REASON = "present in v1.0, absent from sources";

function printReport(report: GeneratorReport): void {
  const line = (label: string, list: string[]): void => console.log(`${label}: ${list.length}`);
  line("v1.0 fields reproduced without a pin", report.unpinnedV1Fields);
  line("v1.0 fields needing a pin", report.pinnedFields);
  line("source conflicts settled by a pin", report.conflictsSettledByPin);
  line("source conflicts settled by an override", report.overrideResolved);
  line("guessed facts", report.guessed);
  line("unsupported field types", report.unsupportedTypes);
  for (const u of report.unsupportedTypes) console.warn(`warning: ${u}`);
}

function committedObjectFiles(): string[] {
  const dir = join(STANDARD_DIR, "objects");
  return existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => `objects/${f}`) : [];
}

function writeOrCheck(inputs: GeneratorInputs, check: boolean): number {
  const { files, report } = generate(inputs, CLI_OPTIONS);
  const guard = relationshipNameProblems([...files].filter(([rel]) => rel.startsWith("objects/")).map(([, text]) => JSON.parse(text) as StandardObjectJson));
  if (guard.length > 0) {
    for (const g of guard) console.error(g);
    console.error("relationshipName guard failed: nothing written; add overrides.json entries");
    return 1;
  }
  const problems: string[] = [];
  for (const [rel, text] of files) {
    const path = join(STANDARD_DIR, rel);
    if (check) {
      if (!existsSync(path)) problems.push(`missing: ${rel}`);
      else if (readFileSync(path, "utf8") !== text) problems.push(`differs: ${rel}`);
    } else {
      mkdirSync(join(STANDARD_DIR, "objects"), { recursive: true });
      writeFileSync(path, text);
    }
  }
  for (const rel of committedObjectFiles()) if (!files.has(rel)) problems.push(`stray (not generated): ${rel}`);
  printReport(report);
  if (problems.length > 0) {
    for (const p of problems.sort(codeUnit)) console.error(p);
    console.error(check ? "baseline drift: run `pnpm baseline:gen` and commit the result" : "stray files under packages/metadata/standard/objects: remove them or add the object to objects.json");
    return 1;
  }
  console.log(`${check ? "checked" : "wrote"} ${files.size} files`);
  return 0;
}

/** Mechanically derive the v1.0 pin layer: per field, every key where the fixture differs from the source-derived value. */
function bootstrapPins(inputs: GeneratorInputs): number {
  const pins: Pins = {};
  const overrides: Overrides = structuredClone(inputs.overrides);
  let keeps = 0;
  for (const file of readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".json")).sort(codeUnit)) {
    const v1 = JSON.parse(readFileSync(join(FIXTURE_DIR, file), "utf8")) as StandardObjectJson;
    const object = v1.name;
    if (!inputs.objects.includes(object)) throw new GeneratorError(`fixture object ${object} is not in objects.json`);
    const objectEntry = (overrides.objects[object] ??= { keyPrefix: { value: v1.keyPrefix, source: "unverified" } });
    if (!inputs.sfSkills.has(object) && !inputs.objectReference.has(object)) objectEntry.keepObject ??= { reason: KEEP_REASON };
    const objectFacts: Record<string, unknown> = {};
    for (const key of OBJECT_KEY_ORDER) {
      if (key === "name" || key === "keyPrefix" || key === "fields") continue;
      const value = (v1 as unknown as Record<string, unknown>)[key];
      if (value !== undefined) objectFacts[key] = value;
    }
    orderKeys(object, v1, OBJECT_KEY_ORDER);
    const derived = deriveFromSources(inputs, object);
    const fieldPins: ObjectPins["fields"] = {};
    for (const field of [...v1.fields].sort((a, b) => codeUnit(a.name, b.name))) {
      const where = `${object}.${field.name}`;
      const d = derived.get(field.name);
      const base: Record<string, unknown> = d && !d.skip ? d.json : { name: field.name };
      if (!d || d.skip) {
        const fields = (objectEntry.fields ??= {});
        const existing: FieldOverride = fields[field.name] ?? { reason: KEEP_REASON };
        fields[field.name] = { keep: true, ...existing };
        keeps++;
      }
      const fixture = orderKeys(where, field, FIELD_KEY_ORDER) as unknown as Record<string, unknown>;
      const pin: Record<string, unknown> = {};
      for (const key of FIELD_KEY_ORDER) {
        if (key === "name") continue;
        const want = fixture[key];
        const have = base[key];
        if (want !== undefined && !isDeepStrictEqual(want, have)) pin[key] = want;
        else if (want === undefined && have !== undefined) pin[key] = null;
      }
      for (const c of d?.conflicts ?? []) if (!(c.fact in pin)) pin[c.fact] = fixture[c.fact] ?? null;
      fieldPins[field.name] = Object.fromEntries(FIELD_KEY_ORDER.filter((k) => k in pin).map((k) => [k, pin[k]]));
    }
    pins[object] = { object: objectFacts, fields: fieldPins };
  }
  const sortedOverrides: Overrides = { objects: {} };
  for (const object of Object.keys(overrides.objects).sort(codeUnit)) {
    const entry = overrides.objects[object]!;
    if (entry.fields) entry.fields = Object.fromEntries(Object.keys(entry.fields).sort(codeUnit).map((f) => [f, entry.fields![f]!]));
    sortedOverrides.objects[object] = entry;
  }
  writeFileSync(join(GEN_DIR, "v1-pins.json"), serialise(pins));
  writeFileSync(join(GEN_DIR, "overrides.json"), serialise(sortedOverrides));
  const fieldCount = Object.values(pins).reduce((n, o) => n + Object.keys(o.fields).length, 0);
  const pinned = Object.values(pins).reduce((n, o) => n + Object.values(o.fields).filter((p) => Object.keys(p).length > 0).length, 0);
  console.log(`bootstrapped v1-pins.json: ${Object.keys(pins).length} objects, ${fieldCount} fields, ${pinned} with pins, ${keeps} keep entries written to overrides.json`);
  return 0;
}

/** Full-mode report for review; nothing is written (locked decision: Johan sees the numbers before 09-07 regenerates). */
function printFullReport(inputs: GeneratorInputs): number {
  const { report } = generate(inputs, { v1Only: false, collectConflicts: true });
  process.stdout.write(serialise(sortKeysDeep(report)));
  return 0;
}

async function main(argv: string[]): Promise<number> {
  const MODES = ["--check", "--bootstrap-pins", "--report"];
  const unknown = argv.filter((a) => !MODES.includes(a));
  if (unknown.length > 0 || argv.length > 1) {
    console.error(`${unknown.length > 0 ? `unknown argument(s): ${unknown.join(" ")}` : "one mode at a time"}; usage: generate.ts [--check | --bootstrap-pins | --report]`);
    return 2;
  }
  const inputs = await loadInputs(ROOT);
  if (argv.includes("--report")) return printFullReport(inputs);
  return argv.includes("--bootstrap-pins") ? bootstrapPins(inputs) : writeOrCheck(inputs, argv.includes("--check"));
}

// exitCode rather than process.exit: on macOS a piped stdout is asynchronous and exit() would truncate `--report`.
main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    if (err instanceof GeneratorError) console.error(`error: ${err.message}`);
    else console.error(err instanceof Error ? err.stack : String(err));
    process.exit(1);
  },
);
