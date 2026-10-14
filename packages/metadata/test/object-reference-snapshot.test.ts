/**
 * Sanity checks on the committed Object Reference extraction (scripts/gen-baseline/source/object-reference): it
 * must cover every object and every sf-skills field except the reviewed gap lists, hold facts only (no
 * documentation prose) and use the reviewed token vocabulary. Pure: reads committed JSON and the shared lists,
 * never the PDF or snapshot-pdf.ts, so CI needs no network and no poppler.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { KNOWN_SUPPORTED_CALLS } from "../../../scripts/gen-baseline/calls.js";
import { DOC_ONLY_REVIEWED, KNOWN_GAPS, KNOWN_PROPERTY_TOKENS, NOT_IN_PDF } from "../../../scripts/gen-baseline/snapshot-lists.js";

const ROOT = fileURLToPath(new URL("../../../scripts/gen-baseline/", import.meta.url));
const DIR = `${ROOT}source/object-reference/`;
const SF_SKILLS = `${ROOT}source/sf-skills/`;
const FIELD_KEYS = ["type", "properties", "maxLength", "refersTo", "relationshipName", "relationshipType", "gating"];

interface Facts {
  type?: string;
  properties?: string[];
  maxLength?: number;
  refersTo?: string[];
  relationshipName?: string;
  relationshipType?: string;
  gating?: string[];
}
interface Extraction {
  object: string;
  supportedCalls?: string[];
  fields: Record<string, Facts>;
}
interface SfSkills {
  fields?: Record<string, unknown>;
  field_reference?: Record<string, unknown>;
  ispersonaccount_fields?: Record<string, unknown>;
}

const objects = JSON.parse(readFileSync(`${ROOT}objects.json`, "utf8")) as string[];
const vendorMd = existsSync(`${DIR}VENDOR.md`) ? readFileSync(`${DIR}VENDOR.md`, "utf8") : "";
const notInPdfLine = /^Not in PDF: (.*)$/m.exec(vendorMd)?.[1] ?? "";
const notInPdf = notInPdfLine === "none" ? [] : notInPdfLine.split(" ").filter(Boolean);
const extracted = new Map<string, Extraction>();
if (existsSync(DIR)) {
  for (const f of readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
    extracted.set(f.slice(0, -5), JSON.parse(readFileSync(`${DIR}${f}`, "utf8")) as Extraction);
  }
}
const notCustom = (name: string): boolean => name !== "" && !name.endsWith("__c") && !name.endsWith("__r");

function sfSkills(object: string): SfSkills | undefined {
  const path = `${SF_SKILLS}${object}.json`;
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as SfSkills) : undefined;
}

describe("Object Reference extraction (committed facts)", () => {
  it("every object in objects.json has an extraction except those VENDOR.md lists as not in the PDF", () => {
    expect(notInPdf.sort()).toEqual(Object.keys(NOT_IN_PDF).sort());
    const expected = objects.filter((o) => !notInPdf.includes(o)).sort();
    expect([...extracted.keys()].sort()).toEqual(expected);
    for (const [name, e] of extracted) expect(e.object).toBe(name);
    expect(vendorMd).toMatch(/^sha256: [0-9a-f]{64}$/m);
  });

  it("extracted field names cover sf-skills `fields` for every object, except the gap list", () => {
    const problems: string[] = [];
    for (const [object, e] of extracted) {
      const sf = sfSkills(object);
      const sfFields = Object.keys(sf?.fields ?? {}).filter(notCustom);
      const gaps = KNOWN_GAPS[object] ?? {};
      for (const f of sfFields) if (!(f in e.fields) && !(f in gaps)) problems.push(`${object}.${f} missing and not in KNOWN_GAPS`);
      for (const f of Object.keys(gaps)) if (f in e.fields || !sfFields.includes(f)) problems.push(`${object}.${f} stale KNOWN_GAPS entry`);

      const known = new Set([...sfFields, ...Object.keys(sf?.field_reference ?? {}), ...Object.keys(sf?.ispersonaccount_fields ?? {})]);
      const reviewed = DOC_ONLY_REVIEWED[object] ?? {};
      for (const [f, facts] of Object.entries(e.fields)) {
        if (known.has(f)) continue;
        if (!(facts.gating?.length ?? 0) && !(f in reviewed)) problems.push(`${object}.${f} doc-only without gating or review`);
      }
      for (const f of Object.keys(reviewed)) if (!(f in e.fields) || known.has(f)) problems.push(`${object}.${f} stale DOC_ONLY_REVIEWED entry`);
    }
    expect(problems).toEqual([]);
  });

  it("the extraction holds no prose", () => {
    const sentence = /\b[a-z]{3,}[.!?] [A-Z][a-z]+ [a-z]{2,}/;
    const problems: string[] = [];
    for (const [object, e] of extracted) {
      const topExtra = Object.keys(e).filter((k) => !["object", "supportedCalls", "fields"].includes(k));
      if (topExtra.length > 0) problems.push(`${object} has unexpected top-level keys ${topExtra.join(",")}`);
      for (const [f, facts] of Object.entries(e.fields)) {
        const extra = Object.keys(facts).filter((k) => !FIELD_KEYS.includes(k));
        if (extra.length > 0) problems.push(`${object}.${f} has unexpected keys ${extra.join(",")}`);
        const strings = [facts.type, facts.relationshipName, facts.relationshipType, ...(facts.properties ?? []), ...(facts.refersTo ?? []), ...(facts.gating ?? [])];
        for (const s of strings) {
          if (s === undefined) continue;
          if (s.length > 80 || sentence.test(s)) problems.push(`${object}.${f} string looks like prose: ${s.slice(0, 40)}`);
        }
        if (facts.maxLength !== undefined && !(Number.isInteger(facts.maxLength) && facts.maxLength > 0)) problems.push(`${object}.${f} maxLength ${facts.maxLength}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("supportedCalls, when present, are sorted, unique and from KNOWN_SUPPORTED_CALLS", () => {
    const problems: string[] = [];
    for (const [object, e] of extracted) {
      if (e.supportedCalls === undefined) continue;
      const sorted = [...new Set(e.supportedCalls)].sort();
      if (JSON.stringify(sorted) !== JSON.stringify(e.supportedCalls)) problems.push(`${object} supportedCalls not sorted and unique`);
      for (const c of e.supportedCalls) if (!KNOWN_SUPPORTED_CALLS.includes(c)) problems.push(`${object} supportedCalls ${c}`);
    }
    expect(problems).toEqual([]);
  });

  it("property and relationship tokens come from the known vocabulary", () => {
    const problems: string[] = [];
    for (const [object, e] of extracted) {
      for (const [f, facts] of Object.entries(e.fields)) {
        for (const p of facts.properties ?? []) if (!KNOWN_PROPERTY_TOKENS.includes(p)) problems.push(`${object}.${f} property ${p}`);
        if (facts.relationshipType !== undefined && !["lookup", "master-detail"].includes(facts.relationshipType)) problems.push(`${object}.${f} relationshipType ${facts.relationshipType}`);
        if (facts.type !== undefined && !/^[a-z]+$/.test(facts.type)) problems.push(`${object}.${f} type ${facts.type}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("Contact does not absorb a neighbouring section", () => {
    const contact = extracted.get("Contact");
    expect(contact).toBeDefined();
    const fields = contact?.fields ?? {};
    expect(["Address", "City", "Country"].filter((f) => f in fields)).toEqual([]);
    const sf = sfSkills("Contact");
    const known = new Set([...Object.keys(sf?.fields ?? {}), ...Object.keys(sf?.field_reference ?? {})]);
    const reviewed = DOC_ONLY_REVIEWED["Contact"] ?? {};
    const unreviewed = Object.entries(fields).filter(([f, facts]) => !known.has(f) && !(facts.gating?.length ?? 0) && !(f in reviewed));
    expect(unreviewed.map(([f]) => f)).toEqual([]);
  });
});
