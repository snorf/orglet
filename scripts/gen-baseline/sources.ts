/**
 * Loads and normalises the generator's committed inputs (Phase 9 D-01/D-02): the vendored sf-skills snapshot, the
 * facts-only Object Reference extraction, objects.json, overrides.json and the v1.0 pin layer. Both sources are merged
 * per field into one `SourceField` so typemap.ts and pipeline.ts never look at raw upstream shapes. Parsing uses narrow
 * runtime checks and throws GeneratorError on any shape surprise instead of silently producing an empty baseline.
 * Description prose is kept in memory only (for gating); nothing here writes anything.
 */
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { KeyPrefixProvenance, StandardFieldJson, StandardObjectJson } from "@orglet/metadata";
import { KNOWN_SUPPORTED_CALLS } from "./calls.js";
import { GeneratorError } from "./errors.js";
import { KNOWN_PROPERTY_TOKENS } from "./snapshot-lists.js";

/** sf-skills facts for one field, merged from `fields` / `ispersonaccount_fields` and `field_reference`. */
export interface SfSkillsFacts {
  /** Raw type token from `fields` (case as in the source); absent when the field is only in `field_reference`. */
  type?: string;
  /** Normalised property tokens; undefined when the entry has no `properties` (then sf-skills states no flag facts). */
  properties?: string[];
  /** `refers_to` split on ",", trimmed, code-unit sorted. */
  refersTo?: string[];
  relationshipName?: string;
  relationshipType?: string;
  /** Prose, read in memory for gating only; never emitted. */
  description?: string;
  /** `field_reference.field_label`. */
  label?: string;
  /** `field_reference.type` (differs in vocabulary from `fields.type`: ids are `id`, booleans dominate). */
  referenceType?: string;
  /** `field_reference.length`, parsed. Reports the UI length for textareas. */
  length?: number;
  precision?: number;
  scale?: number;
}

/** Object Reference facts for one field (scripts/gen-baseline/source/object-reference). */
export interface DocFacts {
  type?: string;
  properties?: string[];
  maxLength?: number;
  refersTo?: string[];
  relationshipName?: string;
  relationshipType?: "lookup" | "master-detail";
  gating?: string[];
}

export interface SourceField {
  object: string;
  name: string;
  sf?: SfSkillsFacts;
  doc?: DocFacts;
  /** Listed under sf-skills `ispersonaccount_fields`: a Person Accounts gating signal. */
  personAccount: boolean;
  /** Set when `name` is not the spelling the documented sources use: the PDF spelling, and why `name` differs (SDK case twin or overrides.json `renameFrom`). */
  respelled?: { documentedName: string; reason: "case-twin" | "override" };
}

export interface SfSkillsObject {
  /** `fields` plus `ispersonaccount_fields` entries (the latter flagged in `personAccountFields`). */
  fields: Map<string, SfSkillsFacts>;
  personAccountFields: Set<string>;
  fieldReference: Map<string, SfSkillsFacts>;
}

export interface ObjectReferenceObject {
  object: string;
  /** Object-level Supported Calls tokens, sorted (Phase 10 D-10); absent in extractions taken before Phase 10. */
  supportedCalls?: string[];
  fields: Map<string, DocFacts>;
}

export interface KeyPrefixOverride {
  value: string | null;
  source: KeyPrefixProvenance;
  ref?: string;
}

export interface FieldOverride {
  keep?: true;
  set?: Partial<StandardFieldJson>;
  featureGated?: boolean;
  skip?: true;
  /** The key is the emitted name; this is the spelling the documented sources use. For a PDF spelling that has no sf-skills `field_reference` twin to take the describe spelling from. */
  renameFrom?: string;
  reason: string;
}

export interface ObjectFlagsOverride {
  createable?: boolean;
  updateable?: boolean;
  deletable?: boolean;
  undeletable?: boolean;
  queryable?: boolean;
  searchable?: boolean;
  reason: string;
}

export interface ObjectOverride {
  keyPrefix: KeyPrefixOverride;
  /** Hand fact for objects without v1 pins: neither source states object labels (research C1). */
  labels?: { label: string; labelPlural: string; reason: string };
  /** Wins over Supported Calls; a value that differs is reported override-resolved (D-10, D-12). */
  flags?: ObjectFlagsOverride;
  keepObject?: { reason: string };
  /** The object is owned although neither the Object Reference nor sf-skills `fields` lists OwnerId (D-21 stays as is). */
  hasOwner?: { value: true; reason: string; ref: string };
  ownerTargets?: { value: ("User" | "Group")[]; reason: string; ref?: string };
  fields?: Record<string, FieldOverride>;
}

export interface Overrides {
  objects: Record<string, ObjectOverride>;
}

/** v1.0 facts per field: a key with a value pins it, `null` deletes the derived key (the key is absent in v1.0). */
export type FieldPins = Record<string, unknown>;
export interface ObjectPins {
  object: Partial<Omit<StandardObjectJson, "name" | "keyPrefix" | "fields">>;
  fields: Record<string, FieldPins>;
}
export type Pins = Record<string, ObjectPins>;

/** A deliberate migration exception (D-16): the diff gate accepts this v1.0 field disappearing or narrowing. */
export interface AllowlistEntry {
  object: string;
  field: string;
  kind: "removed" | "narrowed";
  reason: string;
}

/** The two source pins from the VENDOR.md files, recorded in PROVENANCE.json (D-01); never a timestamp of the run. */
export interface Snapshots {
  sfSkills: { revision: string };
  objectReference: { url: string; lastModified: string; sha256: string };
}

export interface GeneratorInputs {
  objects: string[];
  sfSkills: Map<string, SfSkillsObject>;
  objectReference: Map<string, ObjectReferenceObject>;
  overrides: Overrides;
  pins?: Pins;
  allowlist: AllowlistEntry[];
  snapshots: Snapshots;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const notCustom = (name: string): boolean => !name.endsWith("__c") && !name.endsWith("__r");
export const codeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function optString(where: string, v: unknown, key: string): string | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "string") throw new GeneratorError(`${where}: expected ${key} to be a string, got ${typeof v}`);
  return v;
}

function optNumber(where: string, v: unknown, key: string): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.replace(/,/g, "")) : NaN;
  if (!Number.isFinite(n)) throw new GeneratorError(`${where}: expected ${key} to be numeric, got ${JSON.stringify(v)}`);
  return n;
}

function optStringList(where: string, v: unknown, key: string): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) throw new GeneratorError(`${where}: expected ${key} to be a string list`);
  return v;
}

const KNOWN_TOKENS_BY_LETTERS = new Map(KNOWN_PROPERTY_TOKENS.map((t) => [t.replace(/\s+/g, "").toLowerCase(), t]));

/**
 * sf-skills `properties` is a comma list; one entry prints two tokens without the comma ("Sort Update"). Tokens are
 * normalised to the Object Reference spelling so both sources compare equal; an unknown token aborts.
 */
export function normaliseTokens(where: string, raw: string): string[] {
  const out: string[] = [];
  for (const piece of raw.split(",")) {
    const token = piece.trim();
    if (token === "") continue;
    const known = KNOWN_TOKENS_BY_LETTERS.get(token.replace(/\s+/g, "").toLowerCase());
    if (known) {
      out.push(known);
      continue;
    }
    const parts = token.split(/\s+/).map((p) => KNOWN_TOKENS_BY_LETTERS.get(p.toLowerCase()));
    if (parts.length > 1 && parts.every((p) => p !== undefined)) {
      out.push(...(parts));
      continue;
    }
    throw new GeneratorError(`${where}: unknown property token ${JSON.stringify(token)}`);
  }
  return out;
}

function splitRefersTo(raw: string | undefined): string[] | undefined {
  if (raw === undefined) return undefined;
  const list = raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  return list.length === 0 ? undefined : list.sort(codeUnit);
}

function parseSfFieldEntry(where: string, entry: unknown): SfSkillsFacts {
  if (!isRecord(entry)) throw new GeneratorError(`${where}: expected an object`);
  const facts: SfSkillsFacts = {};
  const type = optString(where, entry.type, "type");
  if (type !== undefined) facts.type = type;
  const properties = optString(where, entry.properties, "properties");
  if (properties !== undefined) facts.properties = normaliseTokens(where, properties);
  const refersTo = splitRefersTo(optString(where, entry.refers_to, "refers_to"));
  if (refersTo) facts.refersTo = refersTo;
  const relationshipName = optString(where, entry.relationship_name, "relationship_name");
  if (relationshipName) facts.relationshipName = relationshipName;
  const relationshipType = optString(where, entry.relationship_type, "relationship_type");
  if (relationshipType) facts.relationshipType = relationshipType;
  const description = optString(where, entry.description, "description");
  if (description !== undefined) facts.description = description;
  return facts;
}

function parseFieldReferenceEntry(where: string, entry: unknown): SfSkillsFacts {
  if (!isRecord(entry)) throw new GeneratorError(`${where}: expected an object`);
  const facts: SfSkillsFacts = {};
  const label = optString(where, entry.field_label, "field_label");
  if (label) facts.label = label;
  const referenceType = optString(where, entry.type, "type");
  if (referenceType) facts.referenceType = referenceType;
  const length = optNumber(where, entry.length, "length");
  if (length !== undefined) facts.length = length;
  const precision = optNumber(where, entry.precision, "precision");
  if (precision !== undefined) facts.precision = precision;
  const scale = optNumber(where, entry.scale, "scale");
  if (scale !== undefined) facts.scale = scale;
  return facts;
}

/** Normalise one vendored sf-skills `enterprise_api/<Object>.json`; `__c`/`__r` entries are dropped everywhere. */
export function parseSfSkills(object: string, raw: unknown): SfSkillsObject {
  if (!isRecord(raw)) throw new GeneratorError(`sf-skills ${object}: expected a JSON object`);
  const out: SfSkillsObject = { fields: new Map(), personAccountFields: new Set(), fieldReference: new Map() };
  for (const key of ["fields", "ispersonaccount_fields"] as const) {
    const section = raw[key];
    if (section === undefined) continue;
    if (!isRecord(section)) throw new GeneratorError(`sf-skills ${object}: expected ${key} to be an object`);
    for (const [name, entry] of Object.entries(section)) {
      if (!notCustom(name)) continue;
      out.fields.set(name, parseSfFieldEntry(`sf-skills ${object}.${name}`, entry));
      if (key === "ispersonaccount_fields") out.personAccountFields.add(name);
    }
  }
  const reference = raw.field_reference;
  if (reference !== undefined) {
    if (!isRecord(reference)) throw new GeneratorError(`sf-skills ${object}: expected field_reference to be an object`);
    for (const [name, entry] of Object.entries(reference)) {
      if (!notCustom(name)) continue;
      out.fieldReference.set(name, parseFieldReferenceEntry(`sf-skills ${object}.${name} (field_reference)`, entry));
    }
  }
  return out;
}

/** Normalise one committed extraction `source/object-reference/<Object>.json`. */
export function parseObjectReference(object: string, raw: unknown): ObjectReferenceObject {
  if (!isRecord(raw) || raw.object !== object || !isRecord(raw.fields)) {
    throw new GeneratorError(`object-reference ${object}: expected { object: "${object}", fields: {...} }`);
  }
  const calls = optStringList(`object-reference ${object}`, raw.supportedCalls, "supportedCalls");
  for (const token of calls ?? []) {
    if (!KNOWN_SUPPORTED_CALLS.includes(token)) throw new GeneratorError(`object-reference ${object}: unknown Supported Call ${JSON.stringify(token)}`);
  }
  const fields = new Map<string, DocFacts>();
  for (const [name, entry] of Object.entries(raw.fields)) {
    const where = `object-reference ${object}.${name}`;
    if (!isRecord(entry)) throw new GeneratorError(`${where}: expected an object`);
    const facts: DocFacts = {};
    const type = optString(where, entry.type, "type");
    if (type !== undefined) facts.type = type;
    const properties = optStringList(where, entry.properties, "properties");
    if (properties) facts.properties = properties;
    const maxLength = optNumber(where, entry.maxLength, "maxLength");
    if (maxLength !== undefined) facts.maxLength = maxLength;
    const refersTo = optStringList(where, entry.refersTo, "refersTo");
    if (refersTo && refersTo.length > 0) facts.refersTo = [...refersTo].sort(codeUnit);
    const relationshipName = optString(where, entry.relationshipName, "relationshipName");
    if (relationshipName) facts.relationshipName = relationshipName;
    const relationshipType = optString(where, entry.relationshipType, "relationshipType");
    if (relationshipType !== undefined) {
      if (relationshipType !== "lookup" && relationshipType !== "master-detail") throw new GeneratorError(`${where}: unknown relationshipType ${relationshipType}`);
      facts.relationshipType = relationshipType;
    }
    const gating = optStringList(where, entry.gating, "gating");
    if (gating) facts.gating = gating;
    fields.set(name, facts);
  }
  return { object, ...(calls ? { supportedCalls: [...new Set(calls)].sort(codeUnit) } : {}), fields };
}

/** Every field either source knows for `object`, merged and sorted by code-unit name. */
export function sourceFieldsOf(inputs: Pick<GeneratorInputs, "sfSkills" | "objectReference"> & Partial<Pick<GeneratorInputs, "overrides">>, object: string): SourceField[] {
  const sf = inputs.sfSkills.get(object);
  const doc = inputs.objectReference.get(object);
  const documented = new Set<string>([...(sf?.fields.keys() ?? []), ...(doc?.fields.keys() ?? [])]);
  const renames = new Map<string, string>();
  for (const [name, o] of Object.entries(inputs.overrides?.objects[object]?.fields ?? {})) if (o.renameFrom) renames.set(o.renameFrom, name);
  const referenceByLower = new Map<string, string>();
  for (const name of sf?.fieldReference.keys() ?? []) referenceByLower.set(name.toLowerCase(), name);
  // A documented name and a field_reference name that differ only by case are one field (they would share one lower-cased
  // Postgres column). field_reference is derived from the SDK/describe, so its spelling wins; every documented fact is kept.
  const canonical = (documentedName: string): { name: string; reason?: "case-twin" | "override" } => {
    const renamed = renames.get(documentedName);
    if (renamed !== undefined) return { name: renamed, reason: "override" };
    const twin = referenceByLower.get(documentedName.toLowerCase());
    if (twin !== undefined && twin !== documentedName && !documented.has(twin)) return { name: twin, reason: "case-twin" };
    return { name: documentedName };
  };
  const documentedNames = new Map<string, string>();
  const respelled = new Map<string, "case-twin" | "override">();
  for (const d of documented) {
    const c = canonical(d);
    if (c.name === d) continue;
    documentedNames.set(c.name, d);
    respelled.set(c.name, c.reason!);
  }
  const names = new Set<string>([...[...documented].map((d) => canonical(d).name), ...(sf?.fieldReference.keys() ?? [])]);
  const out: SourceField[] = [];
  for (const name of [...names].sort(codeUnit)) {
    const documentedName = documentedNames.get(name);
    const own = documentedName ?? name;
    const field: SourceField = { object, name, personAccount: (sf?.personAccountFields.has(own) ?? false) || (sf?.personAccountFields.has(name) ?? false) };
    const fromFields = sf?.fields.get(own);
    const fromReference = sf?.fieldReference.get(name);
    // field_reference wins on a shared spelling (existing rule); on a respelled twin the documented facts win and only the name follows field_reference.
    if (fromFields || fromReference) field.sf = documentedName === undefined ? { ...fromFields, ...fromReference } : { ...fromReference, ...fromFields };
    const fromDoc = doc?.fields.get(own);
    if (fromDoc) field.doc = fromDoc;
    if (documentedName !== undefined) field.respelled = { documentedName, reason: respelled.get(name)! };
    out.push(field);
  }
  return out;
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function parseOverrides(raw: unknown): Overrides {
  if (!isRecord(raw) || !isRecord(raw.objects)) throw new GeneratorError("overrides.json: expected { objects: {...} }");
  return raw as unknown as Overrides;
}

function parsePins(raw: unknown): Pins {
  if (!isRecord(raw)) throw new GeneratorError("v1-pins.json: expected an object keyed by object name");
  for (const [object, entry] of Object.entries(raw)) {
    if (!isRecord(entry) || !isRecord(entry.object) || !isRecord(entry.fields)) throw new GeneratorError(`v1-pins.json ${object}: expected { object: {...}, fields: {...} }`);
    for (const [field, pins] of Object.entries(entry.fields)) if (!isRecord(pins)) throw new GeneratorError(`v1-pins.json ${object}.${field}: expected an object of pinned keys`);
  }
  return raw as Pins;
}

/** diff-allowlist.json states migration exceptions, never facts; each entry needs a reason like every other hand entry. */
export function parseAllowlist(raw: unknown): AllowlistEntry[] {
  if (!isRecord(raw) || !Array.isArray(raw.entries)) throw new GeneratorError("diff-allowlist.json: expected { entries: [...] }");
  return raw.entries.map((entry: unknown, i): AllowlistEntry => {
    const where = `diff-allowlist.json entries[${i}]`;
    if (!isRecord(entry)) throw new GeneratorError(`${where}: expected an object`);
    const { object, field, kind, reason } = entry;
    if (typeof object !== "string" || object === "" || typeof field !== "string" || field === "") throw new GeneratorError(`${where}: object and field must be non-empty strings`);
    if (kind !== "removed" && kind !== "narrowed") throw new GeneratorError(`${where} (${object}.${field}): kind must be one of removed|narrowed`);
    if (typeof reason !== "string" || reason.trim() === "") throw new GeneratorError(`${where} (${object}.${field}): every allowlist entry needs a non-empty reason`);
    return { object, field, kind, reason };
  });
}

function vendorLine(where: string, text: string, key: string): string {
  const match = new RegExp(`^${key}: (.+)$`, "m").exec(text);
  if (!match) throw new GeneratorError(`${where}: missing "${key}:" line`);
  return match[1]!.trim();
}

/** The pins both VENDOR.md files state; the generator copies them into PROVENANCE.json and never reads the network. */
export function parseSnapshots(sfSkillsVendor: string, objectReferenceVendor: string): Snapshots {
  const sfWhere = "source/sf-skills/VENDOR.md";
  const docWhere = "source/object-reference/VENDOR.md";
  const revision = vendorLine(sfWhere, sfSkillsVendor, "Revision");
  if (!/^[0-9a-f]{40}$/.test(revision)) throw new GeneratorError(`${sfWhere}: Revision must be a 40-hex commit SHA, got ${JSON.stringify(revision)}`);
  const sha256 = vendorLine(docWhere, objectReferenceVendor, "sha256");
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new GeneratorError(`${docWhere}: sha256 must be 64 hex characters, got ${JSON.stringify(sha256)}`);
  // "Source: <url> (© ...)": the URL is the first token.
  const url = vendorLine(docWhere, objectReferenceVendor, "Source").split(/\s+/)[0]!;
  return { sfSkills: { revision }, objectReference: { url, lastModified: vendorLine(docWhere, objectReferenceVendor, "Last-Modified"), sha256 } };
}

/** Read every committed input under `<root>/scripts/gen-baseline`. Missing per-object source files are allowed (sf-skills lacks BusinessProcess). */
export async function loadInputs(root: string): Promise<GeneratorInputs> {
  const dir = join(root, "scripts", "gen-baseline");
  const objectsRaw = await readJson(join(dir, "objects.json"));
  if (!Array.isArray(objectsRaw) || !objectsRaw.every((o) => typeof o === "string")) throw new GeneratorError("objects.json: expected a list of object names");
  const objects = objectsRaw;
  const sfSkills = new Map<string, SfSkillsObject>();
  const objectReference = new Map<string, ObjectReferenceObject>();
  for (const object of objects) {
    const sfPath = join(dir, "source", "sf-skills", `${object}.json`);
    if (existsSync(sfPath)) sfSkills.set(object, parseSfSkills(object, await readJson(sfPath)));
    const docPath = join(dir, "source", "object-reference", `${object}.json`);
    if (existsSync(docPath)) objectReference.set(object, parseObjectReference(object, await readJson(docPath)));
  }
  const inputs: GeneratorInputs = {
    objects,
    sfSkills,
    objectReference,
    overrides: parseOverrides(await readJson(join(dir, "overrides.json"))),
    allowlist: parseAllowlist(await readJson(join(dir, "diff-allowlist.json"))),
    snapshots: parseSnapshots(await readFile(join(dir, "source", "sf-skills", "VENDOR.md"), "utf8"), await readFile(join(dir, "source", "object-reference", "VENDOR.md"), "utf8")),
  };
  const pinsPath = join(dir, "v1-pins.json");
  if (existsSync(pinsPath)) inputs.pins = parsePins(await readJson(pinsPath));
  return inputs;
}
