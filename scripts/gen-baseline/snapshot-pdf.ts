/**
 * Manual, network-only snapshot step for the second generator source (Phase 9 D-01b): download the public
 * Object Reference PDF, pin it (sha256, Last-Modified, size), run `pdftotext -layout`, parse the per-object
 * field tables and write facts-only JSON under source/object-reference/. Never run in CI. Only facts leave this
 * script: names, type and property tokens, numeric maxima, Refers To names, relationship names and types, and
 * gating keyword ids. Description prose is read in memory for `maxLength` and `matchGating` and then discarded;
 * the PDF and the raw text stay in a scratch directory outside the repo.
 *
 *   pnpm baseline:snapshot                 download, pin, extract (prints the local cache path for re-runs)
 *   pnpm baseline:snapshot -- --pdf <path> extract from a local copy, no network
 */
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { matchGating } from "./gating.js";
import { DOC_ONLY_REVIEWED, KNOWN_GAPS, KNOWN_PROPERTY_TOKENS, NOT_IN_PDF } from "./snapshot-lists.js";

const PDF_URL = "https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/object_reference.pdf";
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, "source", "object-reference");
const SF_SKILLS_DIR = join(HERE, "source", "sf-skills");
const OBJECTS = JSON.parse(readFileSync(join(HERE, "objects.json"), "utf8")) as string[];

const IDENT = /^[A-Za-z][A-Za-z0-9_]*$/;
const LABELS: ReadonlySet<string> = new Set(["Type", "Properties", "Description", "Relationship Name", "Relationship Type", "Refers To"]);
const HEADER = /^( +)(Field Name|Field) {2,}(Details|Field Type) *$/;
const BULLET_LABEL = /^•\s*(Relationship Type|Refers To|Relationship Name):\s*(.*)$/;
const RELATIONSHIP_TYPES: Readonly<Record<string, "lookup" | "master-detail">> = {
  lookup: "lookup",
  "master-detail": "master-detail",
  "parent-detail": "master-detail",
  "primary-detail": "master-detail",
};

interface FieldFacts {
  type?: string;
  properties?: string[];
  maxLength?: number;
  refersTo?: string[];
  relationshipName?: string;
  relationshipType?: "lookup" | "master-detail";
  gating?: string[];
}

interface Pin {
  lastModified: string;
  size: number;
  sha256: string;
}

// ---------------------------------------------------------------------------------------------------------------
// Input acquisition

async function sha256Of(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

function pdftotextVersion(): string {
  // pdftotext -v prints its version on stderr; the exit code differs between poppler versions.
  let stderr = "";
  try {
    const res = spawnSync("pdftotext", ["-v"], { encoding: "utf8" });
    stderr = `${res.stderr ?? ""}${res.stdout ?? ""}`;
  } catch {
    // fall through to the error below
  }
  const m = /pdftotext version (\S+)/.exec(stderr);
  if (m?.[1]) return m[1];
  throw new Error("pdftotext not found on PATH (poppler); install it to run the snapshot step");
}

function existingPin(): Pin | undefined {
  const vendor = join(OUT_DIR, "VENDOR.md");
  if (!existsSync(vendor)) return undefined;
  const text = readFileSync(vendor, "utf8");
  const sha = /^sha256: ([0-9a-f]{64})$/m.exec(text)?.[1];
  const lastModified = /^Last-Modified: (.+)$/m.exec(text)?.[1];
  const size = /^Size: (\d+)$/m.exec(text)?.[1];
  return sha && lastModified && size ? { sha256: sha, lastModified, size: Number(size) } : undefined;
}

async function acquirePdf(scratch: string, localPdf: string | undefined): Promise<{ pdf: string; pin: Pin }> {
  if (localPdf) {
    const sha256 = await sha256Of(localPdf);
    const prior = existingPin();
    const size = statSync(localPdf).size;
    const pin: Pin =
      prior && prior.sha256 === sha256 ? prior : { sha256, size, lastModified: "unknown (snapshot taken from a local --pdf file)" };
    return { pdf: localPdf, pin };
  }
  const pdf = join(scratch, "object_reference.pdf");
  console.log(`downloading ${PDF_URL}`);
  const head = execFileSync("curl", ["-fsSI", PDF_URL], { encoding: "utf8" });
  const lastModified = /^last-modified: (.+)$/im.exec(head)?.[1]?.trim() ?? "unknown";
  execFileSync("curl", ["-fsSL", "-o", pdf, PDF_URL], { stdio: "inherit" });
  const sha256 = await sha256Of(pdf);
  const size = statSync(pdf).size;
  const cacheDir = join(homedir(), ".cache", "orglet");
  mkdirSync(cacheDir, { recursive: true });
  const cached = join(cacheDir, `object_reference-${sha256.slice(0, 12)}.pdf`);
  copyFileSync(pdf, cached);
  console.log(`cached copy for re-runs: --pdf ${cached}`);
  return { pdf, pin: { lastModified, size, sha256 } };
}

// ---------------------------------------------------------------------------------------------------------------
// Section location: TOC order + printed page numbers (Research Pitfall 7)

interface TocEntry {
  /** Heading text as printed (may contain spaces, e.g. "Business Process"). */
  display: string;
  /** API-style name used for matching objects.json (spaces removed). */
  name: string;
  page: number;
}

function parseToc(pages: string[]): TocEntry[] {
  const entries: TocEntry[] = [];
  const line = /^ {6,}([A-Za-z][A-Za-z0-9 ]*?) (?:\. )+\.? *(\d+) *$/;
  for (const page of pages) {
    // The TOC occupies the front matter; body pages carry a numeric footer.
    if (footerNumber(page) !== undefined) break;
    for (const l of page.split("\n")) {
      const m = line.exec(l);
      if (m?.[1] && m[2]) entries.push({ display: m[1], name: m[1].replace(/ /g, ""), page: Number(m[2]) });
    }
  }
  return entries;
}

function footerNumber(page: string): number | undefined {
  const lines = page.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i]?.trim() ?? "";
    if (t === "") continue;
    return /^\d+$/.test(t) ? Number(t) : undefined;
  }
  return undefined;
}

function isHeading(line: string, display: string): boolean {
  const indent = line.length - line.trimStart().length;
  return indent > 0 && indent <= 8 && line.trim() === display;
}

/** Lines of one object's section: from its heading to the next TOC entry's heading. */
function sectionLines(pages: string[], printedToIndex: Map<number, number>, toc: TocEntry[], i: number): string[] {
  const entry = toc[i] as TocEntry;
  const next = toc[i + 1];
  const start = printedToIndex.get(entry.page);
  if (start === undefined) throw new Error(`${entry.display}: no page with footer ${entry.page}`);
  const end = next ? (printedToIndex.get(next.page) ?? pages.length - 1) : pages.length - 1;
  const lines: string[] = [];
  let lastPageOffset = 0;
  for (let p = start; p <= end; p++) {
    if (p === end) lastPageOffset = lines.length;
    lines.push(...(pages[p] as string).split("\n"));
  }
  const firstPageLen = (pages[start] as string).split("\n").length;
  let from = -1;
  for (let k = 0; k < firstPageLen; k++) if (isHeading(lines[k] as string, entry.display)) { from = k; break; }
  if (from < 0) throw new Error(`${entry.display}: heading not found on page ${entry.page}`);
  let to = lines.length;
  if (next) {
    for (let k = Math.max(lastPageOffset, from + 1); k < lines.length; k++) {
      if (isHeading(lines[k] as string, next.display)) { to = k; break; }
    }
  }
  return lines.slice(from, to);
}

// ---------------------------------------------------------------------------------------------------------------
// Field table parsing

interface Block {
  /** One name, or several when the PDF documents a bulleted group of fields with one shared details block. */
  names: string[];
  group: boolean;
  values: Map<string, string[]>;
  label: string | undefined;
}

interface ParseResult {
  fields: Map<string, FieldFacts>;
  warnings: string[];
  /** unknown Properties token -> fields that carry it */
  unknownProperties: Map<string, string[]>;
}

/** "Name", "• Name", optionally a "(beta)" qualifier, then whatever sits in the details column of the same line. */
const NAME_LINE = /^(•\s*)?([A-Za-z][A-Za-z0-9_]*)(?:\s+\([^)]*\))?(?:\s+(.*))?$/;

function parseSection(object: string, lines: string[]): ParseResult {
  const fields = new Map<string, FieldFacts>();
  const warnings: string[] = [];
  const unknownProperties = new Map<string, string[]>();
  let nameCol = -1;
  let inTable = false;
  let current: Block | undefined;
  let pendingName: string | undefined;

  const finish = (): void => {
    if (!current) return;
    const facts = toFacts(object, current, warnings, unknownProperties);
    for (const name of current.names) {
      if (name.endsWith("__c") || name.endsWith("__r")) continue;
      if (fields.has(name)) warnings.push(`${object}.${name}: duplicate field block, later block wins`);
      fields.set(name, facts);
    }
    current = undefined;
  };
  const start = (name: string, group: boolean): void => {
    finish();
    current = { names: [name], group, values: new Map(), label: "Type" };
  };

  for (const raw of lines) {
    const line = raw.replace(/\s+$/, "");
    if (line === "" || !line.startsWith(" ")) continue; // blank, or the running page header at column 0
    if (/^ *\d+$/.test(line)) continue; // printed page number
    const header = HEADER.exec(line);
    if (header) {
      nameCol = (header[1] as string).length;
      inTable = true;
      continue;
    }
    const trimmed = line.trim();
    const indent = line.length - line.trimStart().length;
    if (indent < 7) {
      // A section-level heading (Usage, Associated Objects, the next object...): the field table is over.
      finish();
      inTable = false;
      continue;
    }
    if (!inTable) continue;
    if (indent === nameCol && /^Field( Name)? {2,}[A-Z][a-z]+$/.test(trimmed)) {
      // A different two-column table (e.g. "Field Name  Description"); not field definitions.
      finish();
      inTable = false;
      continue;
    }
    if (/^Note:/.test(trimmed)) {
      // Notes sit between field blocks inside the table; they belong to no field.
      finish();
      continue;
    }

    // Split the line into its name-column part and its details-column part. Labels are recognised by text, not
    // by position: bulleted field groups shift the details column within one table.
    let detail = trimmed;
    if (indent === nameCol) {
      const m = NAME_LINE.exec(trimmed);
      if (!m) {
        warnings.push(`${object}: unexpected text in the name column: "${trimmed.slice(0, 60)}"`);
        continue;
      }
      const bullet = m[1] !== undefined;
      const name = m[2] as string;
      detail = m[3] ?? "";
      if (detail === "Type") {
        start(name, bullet);
        continue;
      }
      if (bullet) {
        if (current?.group) current.names.push(name);
        else {
          warnings.push(`${object}: bulleted field "${name}" outside a group`);
          start(name, true);
          current!.label = undefined;
        }
      } else if (detail === "") {
        pendingName = name;
        continue;
      } else {
        warnings.push(`${object}: name column "${name}" followed by "${detail.slice(0, 40)}"`);
        continue;
      }
      if (detail === "") continue;
    }

    if (pendingName !== undefined) {
      if (detail === "Type") start(pendingName, false);
      else warnings.push(`${object}: "${pendingName}" in the name column is not followed by Type`);
      pendingName = undefined;
      if (detail === "Type") continue;
    }
    const bullet = BULLET_LABEL.exec(detail);
    if (bullet && current) {
      current.values.set(bullet[1] as string, [bullet[2] as string]);
      current.label = undefined;
      continue;
    }
    if (LABELS.has(detail)) {
      if (current) current.label = detail;
      continue;
    }
    if (current && current.label !== undefined) {
      const list = current.values.get(current.label) ?? [];
      list.push(detail);
      current.values.set(current.label, list);
    }
  }
  finish();
  return { fields, warnings, unknownProperties };
}

function toFacts(object: string, block: Block, warnings: string[], unknownProperties: Map<string, string[]>): FieldFacts {
  const facts: FieldFacts = {};
  const text = (label: string): string => (block.values.get(label) ?? []).join(" ").trim();
  const where = `${object}.${block.names.join("/")}`;

  const type = text("Type").toLowerCase();
  if (type !== "") {
    if (!/^[a-z]+$/.test(type)) warnings.push(`${where}: odd type token "${type}"`);
    facts.type = type;
  } else warnings.push(`${where}: no Type`);

  const props = text("Properties");
  if (props !== "") {
    const tokens = new Set<string>();
    for (const t of props.split(",").map((s) => s.trim()).filter((s) => s !== "")) {
      if (KNOWN_PROPERTY_TOKENS.includes(t)) tokens.add(t);
      else if (t.split(" ").every((part) => KNOWN_PROPERTY_TOKENS.includes(part))) {
        // "Sort Update": a comma missing in the PDF between two known tokens.
        warnings.push(`${where}: Properties token "${t}" split on the missing comma`);
        for (const part of t.split(" ")) tokens.add(part);
      } else unknownProperties.set(t, [...(unknownProperties.get(t) ?? []), where]);
    }
    facts.properties = [...tokens].sort();
  }

  // Description prose is used here and nowhere else; only the number and the keyword ids survive.
  const description = text("Description");
  const max = /Maximum size is ([\d,]+) characters/.exec(description) ?? /Limit: ([\d,]+) characters/.exec(description);
  if (max?.[1]) facts.maxLength = Number(max[1].replace(/,/g, ""));
  const gating = matchGating(description);
  if (gating.length > 0) facts.gating = gating;

  const refers = text("Refers To");
  if (refers !== "") {
    const names = new Set<string>();
    for (const part of refers.replace(/\([^)]*\)/g, "").split(",")) {
      const t = part.trim();
      if (t === "") continue;
      if (IDENT.test(t)) names.add(t);
      else warnings.push(`${where}: Refers To token dropped: "${t.slice(0, 40)}"`);
    }
    if (names.size > 0) facts.refersTo = [...names].sort();
  }

  const relName = text("Relationship Name");
  if (relName !== "") {
    if (IDENT.test(relName)) facts.relationshipName = relName;
    else warnings.push(`${where}: Relationship Name is not an identifier: "${relName.slice(0, 40)}"`);
  }

  const relType = text("Relationship Type");
  if (relType !== "") {
    const norm = RELATIONSHIP_TYPES[relType.toLowerCase()];
    if (norm) facts.relationshipType = norm;
    else warnings.push(`${where}: unknown Relationship Type "${relType.slice(0, 40)}"`);
  }
  return facts;
}

// ---------------------------------------------------------------------------------------------------------------
// Cross-check against sf-skills and output

interface SfSkills {
  fields?: Record<string, unknown>;
  field_reference?: Record<string, unknown>;
  ispersonaccount_fields?: Record<string, unknown>;
}

function loadSfSkills(object: string): SfSkills | undefined {
  const path = join(SF_SKILLS_DIR, `${object}.json`);
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as SfSkills) : undefined;
}

const notCustom = (name: string): boolean => name !== "" && !name.endsWith("__c") && !name.endsWith("__r");

function serialise(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

function sortedFacts(fields: Map<string, FieldFacts>): Record<string, FieldFacts> {
  const out: Record<string, FieldFacts> = {};
  for (const name of [...fields.keys()].sort()) out[name] = fields.get(name) as FieldFacts;
  return out;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const pdfFlag = args.indexOf("--pdf");
  const localPdf = pdfFlag >= 0 ? args[pdfFlag + 1] : undefined;
  if (pdfFlag >= 0 && !localPdf) throw new Error("--pdf needs a path");

  const scratch = mkdtempSync(join(tmpdir(), "orglet-objref-"));
  const { pdf, pin } = await acquirePdf(scratch, localPdf);
  const version = pdftotextVersion();
  const txt = join(scratch, "object_reference.txt");
  console.log(`pdftotext ${version} -layout -> ${txt}`);
  execFileSync("pdftotext", ["-layout", pdf, txt], { stdio: "inherit" });

  const pages = readFileSync(txt, "utf8").split("\f");
  const printedToIndex = new Map<number, number>();
  pages.forEach((p, i) => {
    const n = footerNumber(p);
    if (n !== undefined && !printedToIndex.has(n)) printedToIndex.set(n, i);
  });
  const toc = parseToc(pages);
  console.log(`${pages.length} pages, ${toc.length} TOC entries`);

  const errors: string[] = [];
  const warnings: string[] = [];
  const unknownProperties = new Map<string, string[]>();
  const results = new Map<string, Map<string, FieldFacts>>();
  const rows: string[][] = [["object", "sf-skills", "extracted", "missing(gap)", "docOnly(gated/reviewed)", "master-detail"]];

  for (const object of OBJECTS) {
    if (object in NOT_IN_PDF) continue;
    const hits = toc.map((e, i) => (e.name === object ? i : -1)).filter((i) => i >= 0);
    if (hits.length === 0) {
      errors.push(`${object}: not in the TOC (add to NOT_IN_PDF with a reason if the PDF really has no section)`);
      continue;
    }
    if (hits.length > 1) warnings.push(`${object}: ${hits.length} TOC entries, using the first`);
    const lines = sectionLines(pages, printedToIndex, toc, hits[0] as number);
    const parsed = parseSection(object, lines);
    warnings.push(...parsed.warnings);
    for (const [t, where] of parsed.unknownProperties) unknownProperties.set(t, [...(unknownProperties.get(t) ?? []), ...where]);

    const sf = loadSfSkills(object);
    const sfFields = new Set(Object.keys(sf?.fields ?? {}).filter(notCustom));
    const known = new Set([...sfFields, ...Object.keys(sf?.field_reference ?? {}), ...Object.keys(sf?.ispersonaccount_fields ?? {})]);
    const extracted = parsed.fields;
    const gaps = KNOWN_GAPS[object] ?? {};
    const reviewed = DOC_ONLY_REVIEWED[object] ?? {};

    const missing = [...sfFields].filter((f) => !extracted.has(f)).sort();
    const missingUnlisted = missing.filter((f) => !(f in gaps));
    if (missingUnlisted.length > 0) errors.push(`${object}: sf-skills fields not extracted and not in KNOWN_GAPS: ${missingUnlisted.join(", ")}`);
    for (const f of Object.keys(gaps)) if (!missing.includes(f)) errors.push(`${object}.${f}: stale KNOWN_GAPS entry (field was extracted)`);

    const docOnly = [...extracted.keys()].filter((f) => !known.has(f)).sort();
    const docOnlyUnreviewed = docOnly.filter((f) => !(extracted.get(f)?.gating?.length) && !(f in reviewed));
    if (docOnlyUnreviewed.length > 0) errors.push(`${object}: doc-only fields without gating or DOC_ONLY_REVIEWED entry: ${docOnlyUnreviewed.join(", ")}`);
    for (const f of Object.keys(reviewed)) if (!docOnly.includes(f)) errors.push(`${object}.${f}: stale DOC_ONLY_REVIEWED entry`);

    const gated = docOnly.filter((f) => extracted.get(f)?.gating?.length).length;
    const md = [...extracted.values()].filter((f) => f.relationshipType === "master-detail").length;
    rows.push([object, String(sfFields.size), String(extracted.size), `${missing.length}(${missing.length - missingUnlisted.length})`, `${docOnly.length}(${gated}/${docOnly.length - gated - docOnlyUnreviewed.length})`, String(md)]);
    results.set(object, extracted);
  }
  for (const object of Object.keys(NOT_IN_PDF)) {
    if (!OBJECTS.includes(object)) errors.push(`NOT_IN_PDF lists ${object}, which is not in objects.json`);
    else if (toc.some((e) => e.name === object)) errors.push(`NOT_IN_PDF lists ${object}, but the TOC has it`);
  }
  for (const [t, where] of [...unknownProperties].sort()) errors.push(`unknown Properties token "${t}" (review, then add to KNOWN_PROPERTY_TOKENS) on ${where.join(", ")}`);

  const widths = rows[0]!.map((_, c) => Math.max(...rows.map((r) => (r[c] ?? "").length)));
  for (const r of rows) console.log(r.map((cell, c) => cell.padEnd(widths[c] ?? 0)).join("  "));
  for (const w of warnings) console.warn(`warning: ${w}`);
  if (errors.length > 0) {
    for (const e of errors) console.error(`error: ${e}`);
    console.error(`${errors.length} error(s); nothing written`);
    process.exitCode = 1;
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  for (const [object, fields] of results) writeFileSync(join(OUT_DIR, `${object}.json`), serialise({ object, fields: sortedFacts(fields) }));
  const notInPdf = Object.keys(NOT_IN_PDF).sort();
  writeFileSync(
    join(OUT_DIR, "VENDOR.md"),
    [
      "# Object Reference facts (extracted)",
      "",
      `Source: ${PDF_URL} (© Salesforce, Inc.; the PDF is not redistributed here)`,
      `Last-Modified: ${pin.lastModified}`,
      `Size: ${pin.size}`,
      `sha256: ${pin.sha256}`,
      `Extractor: scripts/gen-baseline/snapshot-pdf.ts with pdftotext ${version} -layout`,
      `Not in PDF: ${notInPdf.length > 0 ? notInPdf.join(" ") : "none"}`,
      "",
      "Only facts are kept: field names, type and property tokens, numeric maxima, Refers To names, relationship names and",
      "types, and gating keyword ids. No documentation text is stored. Re-run `pnpm baseline:snapshot` to re-pin (deliberate PR).",
      "",
    ].join("\n"),
  );
  console.log(`wrote ${results.size} object files + VENDOR.md to ${OUT_DIR}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack ?? err.message : String(err));
  process.exitCode = 1;
});
