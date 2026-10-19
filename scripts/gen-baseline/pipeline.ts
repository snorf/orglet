/**
 * The pure core of the baseline generator (Phase 9 BASE2-01/BASE2-02): `generate(inputs, options)` turns the
 * normalised sources, the v1.0 pin layer and overrides.json into the exact `StandardObjectJson` files under
 * packages/metadata/standard, plus a report of what the sources could not establish. No fs, no process, no Date: the
 * CLI (generate.ts) and the vitest parity gate call this same function, so "regenerate in memory" and "regenerate on
 * disk" cannot diverge (D-18/D-19). Precedence per fact: overrides > v1 pins > source-derived > type defaults; a fact
 * the two sources disagree on must be settled by a pin or an override, otherwise generation aborts (D-03).
 *
 * Full mode (`v1Only: false`, BASE2-02 step B) adds every field the sources document to the 35 objects. A field new to a
 * v1.0 object follows extra rules (locked decisions 4 and 5): unsupported types and references to objects outside
 * objects.json are skipped and reported, gated fields are tagged and never required, required-looking fields are forced
 * nullable (rule 4, v1.0 objects only: objects without v1 pins keep the documented requirement, Phase 10 D-18), field_reference-only fields are read-only, picklists carry no values. v1.0 fields (those with a pin) are
 * never touched by these rules, so step B cannot change what step A reproduced. Full mode also emits PROVENANCE.json
 * (D-04): per-object counts of facts by provenance, the non-verified facts per field, and the skip/gating lists.
 */
import type { StandardFieldJson, StandardObjectJson } from "@orglet/metadata";
import { GeneratorError } from "./errors.js";
import { matchGating } from "./gating.js";
import { codeUnit, sourceFieldsOf, type FieldOverride, type GeneratorInputs, type ObjectOverride, type Overrides, type SourceField } from "./sources.js";
import { compoundParent, flagsFrom, humanise, isTextType, lengthFor, mapType, NEGATIVE_FLAGS, sfTextLength, type Provenance } from "./typemap.js";

export { GeneratorError } from "./errors.js";

export const OBJECT_KEY_ORDER = ["name", "label", "labelPlural", "keyPrefix", "keyPrefixSource", "createable", "updateable", "deletable", "undeletable", "queryable", "searchable", "hasOwner", "ownerTargets", "fields"] as const;
export const FIELD_KEY_ORDER = ["name", "label", "type", "length", "precision", "scale", "nillable", "createable", "updateable", "defaultedOnCreate", "unique", "externalId", "caseSensitive", "idLookup", "nameField", "referenceTo", "relationshipName", "childRelationshipName", "deleteConstraint", "standardValueSet", "picklistValues", "restrictedPicklist", "formula", "defaultValue", "displayFormat", "compoundFieldName", "filterable", "sortable", "groupable", "featureGated"] as const;

export interface GenerateOptions {
  /** Emit only the objects and fields v1-pins.json lists, in the exact v1.0 key set (SC2 step 1). The CLI runs full mode since 09-07. */
  v1Only: boolean;
  /** Return unresolved source conflicts in `report.conflicts` instead of aborting (`--report` and the step-B tests). */
  collectConflicts?: boolean;
}
export const CLI_OPTIONS: GenerateOptions = { v1Only: false };

/** A fact the two sources state differently. Values are JSON for the message. */
export interface Conflict {
  fact: string;
  sf: string;
  doc: string;
}

export interface DerivedField {
  source: SourceField;
  json: Partial<StandardFieldJson> & { name: string };
  conflicts: Conflict[];
  /** Per emitted fact (type, length, label, flags, referenceTo, ...). */
  provenance: Record<string, Provenance>;
  /** Set when the source type is not a physical column; `json` then holds only the name. */
  skip?: { reason: "system" | "unsupported"; sourceType: string };
}

export interface SkipCounts {
  fieldType: number;
  referenceTarget: number;
}

export interface GeneratorReport {
  /** `Object.Field` entries of v1.0 fields that needed at least one pin. */
  pinnedFields: string[];
  /** v1.0 fields fully reproduced from the sources (empty pin). */
  unpinnedV1Fields: string[];
  /** `Object.Field.fact` source disagreements settled by a pin. */
  conflictsSettledByPin: string[];
  /** `Object.Field.fact` facts emitted from a type default (D-05 lengths, numeric precision/scale, humanised labels). */
  guessed: string[];
  /** `UNSUPPORTED:field-type Object.Field (<token>)` for documented fields the baseline cannot model. */
  unsupportedTypes: string[];
  /** `Object.Field.fact` source disagreements settled by an overrides.json `set`. */
  overrideResolved: string[];
  /** Full mode: new fields omitted from the output, by kind (locked decision 4): `Object.Field (<token>)` and `Object.Field -> <targets>`. */
  skipped: { fieldType: string[]; referenceTarget: string[]; perObject: Record<string, SkipCounts> };
  /** Full mode: documented fields dropped by an overrides.json `skip` entry. */
  skippedByOverride: string[];
  /** Full mode: `Object.<PDF spelling> -> <SDK spelling>` for documented fields that sf-skills `field_reference` spells differently only by case; the emitted field takes the SDK (describe-derived) spelling. */
  caseSpelling: string[];
  /** Full mode: `Object.<PDF spelling> -> <emitted spelling>` for documented fields renamed by an overrides.json `renameFrom` (no field_reference twin to follow). */
  renamedByOverride: string[];
  /** Full mode: source names the loader provides itself (system fields, matched case-insensitively because Postgres columns are). */
  excludedSystem: string[];
  /** Full mode: new fields the sources mark required whose `nillable: false` was not written (locked decision 5). */
  forcedNullable: string[];
  /** Full mode: `Object.Field` -> gating keyword ids, every heuristic hit on a new field (D-08 review list). */
  gating: Record<string, string[]>;
  /** Full mode: new fields known only from sf-skills `field_reference`, emitted read-only. */
  sdkOnly: string[];
  /** Unresolved source conflicts (only populated with `collectConflicts`; otherwise generation aborts). */
  conflicts: { unresolved: string[]; byFact: Record<string, number> };
  /** Full mode: new fields in sf-skills `fields` or the Object Reference (documented) vs. new fields actually emitted (any source). */
  totals: { documentedNew: number; generatedNew: number; sdkOnlyCandidates: number; skippedDocumented: number; skippedSdkOnly: number };
}

export interface GenerateResult {
  files: Map<string, string>;
  report: GeneratorReport;
}

type FieldKey = keyof StandardFieldJson;
const COMPARED_FLAGS = ["createable", "updateable", "nillable", "defaultedOnCreate"] as const;
const FLAG_DEFAULTS: Readonly<Record<(typeof COMPARED_FLAGS)[number], boolean>> = { createable: true, updateable: true, nillable: true, defaultedOnCreate: false };
const byName = (a: { name: string }, b: { name: string }): number => codeUnit(a.name, b.name);
const show = (v: unknown): string => JSON.stringify(v) ?? "undefined";
/** A string that ends a sentence or runs past 80 characters is documentation prose, not a field label (Research Pitfall 4); "Asst. Phone" is a label. */
const looksLikeProse = (label: string): boolean => /[.!?]$/.test(label) || label.length > 80;
const sameList = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

/** `JSON.stringify(v, null, 2) + "\n"`: the one serialiser shared by the CLI and the tests (D-19). */
export function serialise(value: unknown): string {
  return JSON.stringify(value, null, 2) + "\n";
}

/** Reorder keys to `order`; any key outside it (for example `description`) is an error, so prose can never be emitted. */
export function orderKeys<T extends object>(where: string, value: T, order: readonly string[]): T {
  const out: Record<string, unknown> = {};
  const source = value as Record<string, unknown>;
  for (const key of Object.keys(source)) if (!order.includes(key)) throw new GeneratorError(`${where}: key ${JSON.stringify(key)} is not in the output key order`);
  for (const key of order) if (source[key] !== undefined) out[key] = source[key];
  return out as T;
}

/** The on-disk form of one object: ordered keys, fields sorted by code-unit name. */
export function orderObjectJson(object: StandardObjectJson): StandardObjectJson {
  const fields = [...object.fields].sort(byName).map((f) => orderKeys(`${object.name}.${f.name}`, f, FIELD_KEY_ORDER));
  return orderKeys(object.name, { ...object, fields }, OBJECT_KEY_ORDER);
}

function typeToken(field: SourceField): { sf?: string; doc?: string } {
  const out: { sf?: string; doc?: string } = {};
  const sf = field.sf?.type ?? field.sf?.referenceType;
  if (sf !== undefined) out.sf = sf;
  if (field.doc?.type !== undefined) out.doc = field.doc.type;
  return out;
}

/** Derive one field from its source facts alone (no pins, no overrides). */
export function deriveField(field: SourceField, addressFields: ReadonlySet<string>): DerivedField {
  const where = `${field.object}.${field.name}`;
  const tokens = typeToken(field);
  const token = tokens.sf ?? tokens.doc;
  if (token === undefined) throw new GeneratorError(`${where}: neither source states a type`);
  const conflicts: Conflict[] = [];
  const provenance: Record<string, Provenance> = {};
  const both = <T>(fact: string, sf: T | undefined, doc: T | undefined, equal: (a: T, b: T) => boolean): T | undefined => {
    if (sf !== undefined && doc !== undefined) {
      if (equal(sf, doc)) provenance[fact] = "verified";
      else conflicts.push({ fact, sf: show(sf), doc: show(doc) });
      return sf;
    }
    if (sf !== undefined) provenance[fact] = "sdk-only";
    if (doc !== undefined) provenance[fact] = "doc-only";
    return sf ?? doc;
  };

  const length = lengthFor(field, token);
  const context: { length?: number; relationshipType?: string } = {};
  if (length) context.length = length.value;
  if (field.doc?.relationshipType) context.relationshipType = field.doc.relationshipType;
  const mapped = mapType(field.object, field.name, token, context);
  const docMapped = tokens.sf !== undefined && tokens.doc !== undefined ? mapType(field.object, field.name, tokens.doc, context) : undefined;
  const typeName = (m: ReturnType<typeof mapType>): string => ("skip" in m ? `skip:${m.skip}` : m.type);
  both("type", typeName(mapped), docMapped === undefined ? undefined : typeName(docMapped), (a, b) => a === b);
  if ("skip" in mapped) return { source: field, json: { name: field.name }, conflicts, provenance, skip: { reason: mapped.skip, sourceType: mapped.sourceType } };

  const json: DerivedField["json"] = { name: field.name, label: "", type: mapped.type };
  if (field.sf?.label && !looksLikeProse(field.sf.label)) {
    json.label = field.sf.label;
    provenance.label = "sdk-only";
  } else {
    // No committed file may carry documentation prose (SC1): sf-skills field_reference labels of 87 Profile Permissions*
    // fields are full sentences, so the name is humanised instead and the label is reported as guessed.
    json.label = humanise(field.name);
    provenance.label = "guessed";
  }
  if (length && isTextType(mapped.type)) {
    json.length = length.value;
    provenance.length = length.provenance;
    const sfLength = sfTextLength(field);
    const docLength = field.doc?.maxLength;
    if (sfLength !== undefined && docLength !== undefined && sfLength !== docLength && provenance.length !== "verified") conflicts.push({ fact: "length", sf: show(sfLength), doc: show(docLength) });
  }
  if (mapped.precision !== undefined) {
    json.precision = mapped.precision;
    provenance.precision = mapped.guessed ? "guessed" : "verified";
  }
  if (mapped.scale !== undefined) {
    json.scale = mapped.scale;
    provenance.scale = mapped.guessed ? "guessed" : "verified";
  }

  const sfFlags = field.sf?.properties === undefined ? undefined : flagsFrom(field.sf.properties);
  const docFlags = field.doc?.properties === undefined ? undefined : flagsFrom(field.doc.properties);
  for (const flag of COMPARED_FLAGS) {
    const value = both(flag, sfFlags === undefined ? undefined : (sfFlags[flag] ?? FLAG_DEFAULTS[flag]), docFlags === undefined ? undefined : (docFlags[flag] ?? FLAG_DEFAULTS[flag]), (a, b) => a === b);
    if (value !== undefined && value !== FLAG_DEFAULTS[flag]) json[flag] = value;
  }
  for (const source of [sfFlags, docFlags]) {
    if (!source) continue;
    for (const [key, value] of Object.entries(source) as [FieldKey, unknown][]) {
      if ((COMPARED_FLAGS as readonly string[]).includes(key) || value !== true) continue;
      (json as Record<string, unknown>)[key] = true;
      provenance[key] = sfFlags && docFlags && sfFlags[key] === docFlags[key] ? "verified" : source === sfFlags ? "sdk-only" : "doc-only";
    }
  }
  if (mapped.createable === false) json.createable = false;
  if (mapped.updateable === false) json.updateable = false;

  if (mapped.type === "Lookup" || mapped.type === "MasterDetail") {
    const referenceTo = both("referenceTo", field.sf?.refersTo, field.doc?.refersTo, sameList);
    if (referenceTo) json.referenceTo = [...referenceTo];
    const relationshipName = both("relationshipName", field.sf?.relationshipName, field.doc?.relationshipName, (a, b) => a === b);
    if (relationshipName) json.relationshipName = relationshipName;
  }
  const compound = compoundParent(field.name, addressFields);
  if (compound) {
    json.compoundFieldName = compound;
    provenance.compoundFieldName = "verified";
  }
  return { source: field, json, conflicts, provenance };
}

/** Source-derived fields of one object, keyed by name; used by generate() and by `--bootstrap-pins`. */
export function deriveFromSources(inputs: GeneratorInputs, object: string): Map<string, DerivedField> {
  const fields = sourceFieldsOf(inputs, object);
  const addressFields = new Set(fields.filter((f) => typeToken(f).sf?.toLowerCase() === "address" || typeToken(f).doc?.toLowerCase() === "address").map((f) => f.name));
  return new Map(fields.map((f) => [f.name, deriveField(f, addressFields)]));
}

// de-describe: the author's own Developer Edition describe, confirmed at a checkpoint and cited in ref (Phase 10 D-01,
// Phase 3 D-03a); orglet itself never contacts an org.
const KEY_PREFIX_SOURCES: readonly string[] = ["doc", "sdk-fixture", "de-describe", "unverified"];
export const OBJECT_FLAGS = ["createable", "updateable", "deletable", "undeletable", "queryable", "searchable"] as const;
export type ObjectFlag = (typeof OBJECT_FLAGS)[number];
/** Supported Calls token -> object flag. `upsert` is no flag: the engine derives it from createable && updateable. */
export const FLAG_BY_CALL: Readonly<Record<string, ObjectFlag>> = { create: "createable", update: "updateable", delete: "deletable", undelete: "undeletable", query: "queryable", search: "searchable" };

/** `false` for every flag whose call is absent from `calls`; the loader defaults object flags to true, so only `false` is ever written. */
export function flagsFromCalls(calls: readonly string[]): Partial<Record<ObjectFlag, false>> {
  const out: Partial<Record<ObjectFlag, false>> = {};
  for (const [call, flag] of Object.entries(FLAG_BY_CALL)) if (!calls.includes(call)) out[flag] = false;
  return out;
}
const hasReason = (v: { reason?: unknown } | undefined): boolean => typeof v?.reason === "string" && v.reason.trim() !== "";
type OwnerTarget = "User" | "Group";
/** The loader's default for `OwnerId.referenceTo` (code-unit sorted); `ownerTargets` is written only when narrower (D-11). */
const OWNER_TARGET_NAMES: readonly OwnerTarget[] = ["Group", "User"];
const isOwnerTarget = (t: string): t is OwnerTarget => (OWNER_TARGET_NAMES as readonly string[]).includes(t);

/**
 * OwnerId targets of one owned object (BASE2-04, D-11): what both sources state for `OwnerId` Refers To, restricted to
 * User and Group. An override always wins and is reported as override-resolved whenever the sources alone would not
 * have produced its value: no Refers To stated (ServiceContract), a target outside User/Group (Event's Calendar, Group's
 * Organization; D-12 says such a target is a hand decision, never dropped silently) or a different list. Without an
 * override, a source disagreement is a conflict like any field fact, and a missing or unmodelled target aborts.
 */
function ownerTargetsFor(object: string, derived: DerivedField | undefined, override: ObjectOverride["ownerTargets"], report: GeneratorReport): { value: OwnerTarget[]; provenance: FactProvenance } | undefined {
  const where = `${object}.OwnerId`;
  const sf = derived?.source.sf?.refersTo;
  const doc = derived?.source.doc?.refersTo;
  const conflict = sf !== undefined && doc !== undefined && !sameList(sf, doc);
  const stated = conflict ? undefined : (sf ?? doc);
  const modelled = stated?.filter(isOwnerTarget).sort(codeUnit);
  const unmodelled = (stated ?? []).filter((t) => !isOwnerTarget(t));
  if (override) {
    if (modelled === undefined || unmodelled.length > 0 || !sameList(modelled, [...override.value].sort(codeUnit))) report.overrideResolved.push(`${where}.ownerTargets`);
    return { value: [...override.value].sort(codeUnit), provenance: "override" };
  }
  if (conflict) {
    report.conflicts.unresolved.push(`${where}.ownerTargets: sf-skills=${show(sf)} object-reference=${show(doc)}`);
    report.conflicts.byFact.ownerTargets = (report.conflicts.byFact.ownerTargets ?? 0) + 1;
    return undefined;
  }
  if (modelled === undefined || modelled.length === 0) throw new GeneratorError(`${where}: no source names a User or Group owner target; add an overrides.json ownerTargets entry with a reason`);
  if (unmodelled.length > 0) throw new GeneratorError(`${where}: the sources name owner target(s) ${unmodelled.join(", ")} outside User/Group; decide in an overrides.json ownerTargets entry with a reason (D-12)`);
  return { value: modelled, provenance: sf !== undefined && doc !== undefined ? "verified" : sf !== undefined ? "sdk-only" : "doc-only" };
}

/**
 * Object-level facts for an object without v1 pins (Phase 10): labels only from an overrides.json labels entry (research
 * C1), DML flags from the Object Reference Supported Calls with a flags override winning (D-10, D-12), hasOwner from an
 * OwnerId in sf-skills `fields` or the Object Reference, never from field_reference alone (research C2).
 */
function objectFactsFor(object: string, inputs: GeneratorInputs, override: ObjectOverride, report: GeneratorReport): Partial<StandardObjectJson> & { label: string; labelPlural: string; hasOwner: boolean } {
  if (!override.labels) throw new GeneratorError(`${object}: label and labelPlural are stated by neither source; add an overrides.json labels entry with a reason`);
  const calls = inputs.objectReference.get(object)?.supportedCalls;
  if (!calls && !override.flags) {
    throw new GeneratorError(`${object}: object DML flags are stated by neither source (no Supported Calls in the Object Reference extraction); add an overrides.json flags entry with a reason`);
  }
  const derived: Partial<Record<ObjectFlag, boolean>> = calls ? flagsFromCalls(calls) : {};
  const flags: Partial<Record<ObjectFlag, false>> = {};
  for (const flag of OBJECT_FLAGS) {
    const stated = override.flags?.[flag];
    const value = stated ?? derived[flag] ?? true;
    if (stated !== undefined && (derived[flag] ?? true) !== stated) report.overrideResolved.push(`${object}.flags.${flag}`);
    if (!value) flags[flag] = false;
  }
  const statedBySources = inputs.sfSkills.get(object)?.fields.has("OwnerId") === true || inputs.objectReference.get(object)?.fields.has("OwnerId") === true;
  if (override.hasOwner && !statedBySources) report.overrideResolved.push(`${object}.hasOwner`);
  const hasOwner = statedBySources || override.hasOwner?.value === true;
  return { label: override.labels.label, labelPlural: override.labels.labelPlural, hasOwner, ...flags };
}

/** overrides.json must carry a reason on every hand fact (BASE2-01); key prefixes cite a public source or say unverified (D-07). */
export function validateOverrides(overrides: Overrides): void {
  for (const [object, entry] of Object.entries(overrides.objects)) {
    const where = `overrides.json ${object}`;
    const prefix = entry.keyPrefix as Partial<ObjectOverride["keyPrefix"]> | undefined;
    if (!prefix || (prefix.value !== null && typeof prefix.value !== "string")) throw new GeneratorError(`${where}: keyPrefix.value must be a string or null`);
    if (!KEY_PREFIX_SOURCES.includes(prefix.source as string)) throw new GeneratorError(`${where}: keyPrefix.source must be one of ${KEY_PREFIX_SOURCES.join("|")}`);
    if (prefix.source !== "unverified" && !prefix.ref) throw new GeneratorError(`${where}: keyPrefix.ref is required when source is ${prefix.source}`);
    if (entry.keepObject && !hasReason(entry.keepObject)) throw new GeneratorError(`${where}: keepObject needs a reason`);
    if (entry.labels) {
      const l = entry.labels as Partial<NonNullable<ObjectOverride["labels"]>>;
      if (!hasReason(l) || typeof l.label !== "string" || l.label === "" || typeof l.labelPlural !== "string" || l.labelPlural === "") {
        throw new GeneratorError(`${where}: labels needs label, labelPlural and a reason`);
      }
    }
    if (entry.flags) {
      const f = entry.flags as unknown as Record<string, unknown>;
      const keys = Object.keys(f).filter((k) => k !== "reason");
      if (!hasReason(entry.flags) || keys.length === 0 || keys.some((k) => !(OBJECT_FLAGS as readonly string[]).includes(k) || typeof f[k] !== "boolean")) {
        throw new GeneratorError(`${where}: flags needs a reason and at least one of ${OBJECT_FLAGS.join("|")} as a boolean`);
      }
    }
    if (entry.hasOwner) {
      const h = entry.hasOwner as Partial<NonNullable<ObjectOverride["hasOwner"]>>;
      if (!hasReason(h) || h.value !== true || typeof h.ref !== "string" || h.ref === "") throw new GeneratorError(`${where}: hasOwner needs value true, a reason and a ref`);
    }
    if (entry.ownerTargets) {
      if (!hasReason(entry.ownerTargets)) throw new GeneratorError(`${where}: ownerTargets needs a reason`);
      const value: unknown = entry.ownerTargets.value;
      if (!Array.isArray(value) || value.length === 0 || value.some((t) => typeof t !== "string" || !isOwnerTarget(t)) || new Set(value).size !== value.length) {
        throw new GeneratorError(`${where}: ownerTargets.value must be a non-empty list of distinct entries from ${OWNER_TARGET_NAMES.join("|")}`);
      }
    }
    for (const [field, override] of Object.entries(entry.fields ?? {})) {
      if (!hasReason(override)) throw new GeneratorError(`${where}.${field}: every field override needs a non-empty reason`);
      if (override.set) orderKeys(`${where}.${field}.set`, override.set, FIELD_KEY_ORDER);
    }
  }
}

function applyPins(json: Record<string, unknown>, pins: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(pins)) {
    if (value === null) delete json[key];
    else json[key] = value;
  }
}

/** Keys recursively sorted by code-unit order so PROVENANCE.json and `--report` are deterministic (D-19). */
export function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(source).sort(codeUnit).map((k) => [k, sortKeysDeep(source[k])]));
  }
  return value;
}

/** The loader adds these (standard/README.md); compared lower-cased because `columnName` lower-cases, so `CreatedByID` is the same column. */
const SYSTEM_FIELD_NAMES: ReadonlySet<string> = new Set(["id", "isdeleted", "createddate", "createdbyid", "lastmodifieddate", "lastmodifiedbyid", "systemmodstamp", "ownerid"]);
const isSystemName = (name: string): boolean => SYSTEM_FIELD_NAMES.has(name.toLowerCase());
/** In sf-skills `fields` or in the Object Reference; `field_reference`-only entries have no `type` (only `referenceType`). */
const isDocumented = (field: SourceField): boolean => field.sf?.type !== undefined || field.doc !== undefined;
const PICKLIST_PER_ORG_KEYS = ["picklistValues", "restrictedPicklist", "standardValueSet"] as const;

/** Per-field provenance for PROVENANCE.json: `v1.0` (pinned) and `override` beat the derived tag; facts with no tag are type-derived (`verified`). */
export type FactProvenance = Provenance | "v1.0" | "override";
const COUNT_KEYS = { verified: "verified", "sdk-only": "sdkOnly", "doc-only": "docOnly", guessed: "guessed", "v1.0": "v1", override: "override" } as const satisfies Record<FactProvenance, string>;

interface ProvenanceCounts {
  fields: number;
  verified: number;
  sdkOnly: number;
  docOnly: number;
  guessed: number;
  v1: number;
  override: number;
  featureGated: number;
  skippedFieldType: number;
  skippedReferenceTarget: number;
}

/** Gating ids for a new field: PDF `gating`, the keyword list over sf-skills prose, `ispersonaccount_fields` (D-08; Research Pattern 4). */
function gatingIds(field: SourceField): { ids: string[]; provenance: Provenance } {
  const doc = field.doc?.gating ?? [];
  const sf = [...(field.sf?.description ? matchGating(field.sf.description) : []), ...(field.personAccount ? ["person-accounts"] : [])];
  const ids = [...new Set([...doc, ...sf])].sort(codeUnit);
  return { ids, provenance: doc.length > 0 && sf.length > 0 ? "verified" : doc.length > 0 ? "doc-only" : "sdk-only" };
}

export function generate(inputs: GeneratorInputs, options: GenerateOptions): GenerateResult {
  validateOverrides(inputs.overrides);
  const pins = inputs.pins;
  if (options.v1Only && !pins) throw new GeneratorError("v1-pins.json is missing; run `pnpm baseline:gen --bootstrap-pins` once");
  for (const object of Object.keys(pins ?? {})) if (!inputs.objects.includes(object)) throw new GeneratorError(`v1-pins.json lists ${object}, which is not in objects.json`);

  const report: GeneratorReport = {
    pinnedFields: [],
    unpinnedV1Fields: [],
    conflictsSettledByPin: [],
    guessed: [],
    unsupportedTypes: [],
    overrideResolved: [],
    skipped: { fieldType: [], referenceTarget: [], perObject: {} },
    skippedByOverride: [],
    caseSpelling: [],
    renamedByOverride: [],
    excludedSystem: [],
    forcedNullable: [],
    gating: {},
    sdkOnly: [],
    conflicts: { unresolved: [], byFact: {} },
    totals: { documentedNew: 0, generatedNew: 0, sdkOnlyCandidates: 0, skippedDocumented: 0, skippedSdkOnly: 0 },
  };
  const files = new Map<string, string>();
  const objects = options.v1Only ? inputs.objects.filter((o) => pins?.[o]) : inputs.objects;
  const knownObjects = new Set(inputs.objects);
  const provenanceCounts: Record<string, ProvenanceCounts> = {};
  const provenanceObjects: Record<string, { keyPrefix: string; labels?: "override"; flags?: "override" | "doc-only"; ownerTargets?: FactProvenance; fields: Record<string, Record<string, FactProvenance>> }> = {};

  for (const object of objects) {
    const override: ObjectOverride | undefined = inputs.overrides.objects[object];
    if (!override) throw new GeneratorError(`overrides.json has no entry for ${object} (keyPrefix is a hand fact, D-07)`);
    const objectPins = pins?.[object];
    const derived = deriveFromSources(inputs, object);
    if (!inputs.sfSkills.has(object) && !inputs.objectReference.has(object) && !override.keepObject) {
      throw new GeneratorError(`${object} is in neither source; add an overrides.json keepObject entry`);
    }
    if (objectPins && (override.labels || override.flags || override.hasOwner)) {
      throw new GeneratorError(`${object}: labels, flags and hasOwner overrides are for objects without v1 pins; v1.0 objects keep their pins`);
    }
    const objectFacts = objectPins ? objectPins.object : objectFactsFor(object, inputs, override, report);
    if (typeof objectFacts.label !== "string" || typeof objectFacts.labelPlural !== "string" || typeof objectFacts.hasOwner !== "boolean") {
      throw new GeneratorError(`${object}: object facts (label, labelPlural, hasOwner) are stated by neither source; pin them in v1-pins.json`);
    }
    const objectJson: StandardObjectJson = { ...objectFacts, name: object, label: objectFacts.label, labelPlural: objectFacts.labelPlural, keyPrefix: override.keyPrefix.value, hasOwner: objectFacts.hasOwner, fields: [] };
    if (!options.v1Only) objectJson.keyPrefixSource = override.keyPrefix.source;
    // BASE2-04: narrow OwnerId per object from the sources (full mode only; v1.0 scope keeps the polymorphic default).
    let ownerProvenance: FactProvenance | undefined;
    if (!options.v1Only && objectFacts.hasOwner) {
      const owner = ownerTargetsFor(object, [...derived.values()].find((d) => d.source.name.toLowerCase() === "ownerid"), override.ownerTargets, report);
      if (owner) {
        ownerProvenance = owner.provenance;
        if (!sameList(owner.value, OWNER_TARGET_NAMES)) objectJson.ownerTargets = owner.value;
      }
    }
    const counts: ProvenanceCounts = { fields: 0, verified: 0, sdkOnly: 0, docOnly: 0, guessed: 0, v1: 0, override: 0, featureGated: 0, skippedFieldType: 0, skippedReferenceTarget: 0 };
    const fieldProvenance: Record<string, Record<string, FactProvenance>> = {};
    const skip = (kind: keyof SkipCounts, d: DerivedField, entry: string): void => {
      report.skipped[kind].push(entry);
      counts[kind === "fieldType" ? "skippedFieldType" : "skippedReferenceTarget"]++;
      if (isDocumented(d.source)) report.totals.skippedDocumented++;
      else report.totals.skippedSdkOnly++;
    };

    const fieldOverrides: Record<string, FieldOverride> = override.fields ?? {};
    const names = new Set<string>();
    // v1.0 fields are always in the inventory, in both modes: one that both sources dropped aborts below until it gets a keep
    // entry (or leaves through the diff-gate allowlist); it never vanishes silently.
    for (const name of Object.keys(objectPins?.fields ?? {})) names.add(name);
    if (!options.v1Only) {
      for (const [name, d] of derived) {
        if (isSystemName(name) || d.skip?.reason === "system") report.excludedSystem.push(`${object}.${name}`);
        else names.add(name);
      }
      for (const [name, o] of Object.entries(fieldOverrides)) if (o.keep) names.add(name);
    }
    for (const [name, o] of Object.entries(fieldOverrides)) {
      if (!o.skip || !names.has(name)) continue;
      names.delete(name);
      if (!options.v1Only) report.skippedByOverride.push(`${object}.${name}`);
    }
    if (!options.v1Only) {
      for (const name of names) {
        const d = derived.get(name);
        if (!d || objectPins?.fields[name]) continue;
        if (isDocumented(d.source)) report.totals.documentedNew++;
        else report.totals.sdkOnlyCandidates++;
      }
    }

    for (const name of [...names].sort(codeUnit)) {
      const where = `${object}.${name}`;
      const fieldPins = objectPins?.fields[name];
      const fieldOverride = fieldOverrides[name];
      const d = derived.get(name);
      // A field new to this object: full mode only, no v1.0 pin. v1.0 fields never see the step-B rules below.
      const isNew = !options.v1Only && !fieldPins;
      if (d?.skip && !fieldPins) {
        if (d.skip.reason === "unsupported") {
          report.unsupportedTypes.push(`UNSUPPORTED:field-type ${where} (${d.skip.sourceType})`);
          skip("fieldType", d, `${where} (${d.skip.sourceType})`);
        }
        continue;
      }
      if (!d && !fieldOverride?.keep) throw new GeneratorError(`${where} is in v1.0 but in neither source; add an overrides.json keep entry`);
      const json: Record<string, unknown> = { ...(d?.json ?? { name }) };
      const facts: Record<string, FactProvenance> = {};
      for (const [fact, p] of Object.entries(d?.provenance ?? {})) facts[fact] = p;
      if (fieldPins) {
        applyPins(json, fieldPins);
        for (const fact of Object.keys(fieldPins)) facts[fact] = "v1.0";
        (Object.keys(fieldPins).length > 0 ? report.pinnedFields : report.unpinnedV1Fields).push(where);
      }
      if (fieldOverride?.set) {
        Object.assign(json, fieldOverride.set);
        for (const fact of Object.keys(fieldOverride.set)) facts[fact] = "override";
      }
      if (!fieldPins) {
        // v1 convention: an AutoNumber carries neither length nor nillable; flags equal to the loader default are never written.
        if (json.type === "AutoNumber") {
          delete json.length;
          delete json.nillable;
        }
        for (const flag of NEGATIVE_FLAGS) if (json[flag] === true) delete json[flag];
      }
      for (const c of d?.conflicts ?? []) {
        if (fieldOverride?.set && c.fact in fieldOverride.set) report.overrideResolved.push(`${where}.${c.fact}`);
        else if (fieldPins && c.fact in fieldPins) report.conflictsSettledByPin.push(`${where}.${c.fact}`);
        else {
          report.conflicts.unresolved.push(`${where}.${c.fact}: sf-skills=${c.sf} object-reference=${c.doc}`);
          report.conflicts.byFact[c.fact] = (report.conflicts.byFact[c.fact] ?? 0) + 1;
        }
      }
      for (const [fact, p] of Object.entries(d?.provenance ?? {})) {
        if (p === "guessed" && json[fact] !== undefined && !(fieldPins && fact in fieldPins) && !(fieldOverride?.set && fact in fieldOverride.set)) report.guessed.push(`${where}.${fact}`);
      }
      if (typeof json.label !== "string" || typeof json.type !== "string") throw new GeneratorError(`${where}: label and type are required after pins and overrides`);
      // MIGR-03: columnFor makes MasterDetail NOT NULL, which migrate() cannot add to a table with rows. Checked after
      // pins and overrides so no layer can introduce one; a field with a pin existed in v1.0 and already has its column.
      if (json.type === "MasterDetail" && objectPins && !fieldPins) {
        throw new GeneratorError(`${where}: MasterDetail on an object that existed in v1.0 would add a NOT NULL column to a populated table; model it as Lookup in overrides.json`);
      }
      if (isNew && d) {
        const set = fieldOverride?.set ?? {};
        if (json.type === "Lookup" || json.type === "MasterDetail") {
          // Rule 2: a target outside objects.json would make the loader warn UNSUPPORTED:reference-target on every run, and
          // dropping one target of a polymorphic lookup would silently make it single-target; the whole field is skipped.
          const targets = Array.isArray(json.referenceTo) ? (json.referenceTo as string[]) : [];
          if (targets.length === 0) {
            skip("referenceTarget", d, `${where} -> (none stated)`);
            continue;
          }
          if (targets.some((t) => !knownObjects.has(t))) {
            skip("referenceTarget", d, `${where} -> ${targets.join(", ")}`);
            continue;
          }
        }
        if (!isDocumented(d.source)) {
          // Rule 5: field_reference states labels, types and lengths but no Create/Update properties; read-only is the safe shape.
          for (const flag of ["createable", "updateable"] as const) {
            if (flag in set) continue;
            json[flag] = false;
            facts[flag] = "sdk-only";
          }
          report.sdkOnly.push(where);
        }
        // Rule 6: standard picklist values are per org (Pitfall B4); the field exists, its values do not.
        if (json.type === "Picklist" || json.type === "MultiselectPicklist") for (const key of PICKLIST_PER_ORG_KEYS) if (!(key in set)) delete json[key];
        // Rule 3: gating. An override decides when present; otherwise any heuristic hit gates the field (D-08, D-09).
        const gating = gatingIds(d.source);
        if (gating.ids.length > 0) report.gating[where] = gating.ids;
        const gated = fieldOverride?.featureGated ?? gating.ids.length > 0;
        if (gated) {
          if (fieldOverride?.featureGated === true && gating.ids.length === 0) report.gating[where] = ["override"];
          json.featureGated = true;
          facts.featureGated = fieldOverride?.featureGated === undefined ? gating.provenance : "override";
          if (set.nillable === false) throw new GeneratorError(`${where}: a feature-gated field is never nillable: false (D-09); drop the override or set featureGated: false with a reason`);
          delete json.nillable;
          counts.featureGated++;
        } else if (objectPins !== undefined && json.nillable === false && json.createable !== false && json.defaultedOnCreate !== true && json.type !== "Checkbox" && !("nillable" in set)) {
          // Rule 4, objects with v1 pins only (Phase 10 D-18): a documented-required field new to a v1.0 object would start
          // failing inserts that work today (Research Pitfall 3). Objects without v1 history keep the documented requirement.
          // Checkbox is exempt: the engine defaults an absent Checkbox to false before the required check, as v1.0 writes them.
          delete json.nillable;
          report.forcedNullable.push(where);
        }
        report.totals.generatedNew++;
      }
      if ((json.type === "Lookup" || json.type === "MasterDetail") && !(Array.isArray(json.referenceTo) && json.referenceTo.length > 0)) {
        throw new GeneratorError(`${where}: ${json.type} without referenceTo; neither source states Refers To, pin or override it`);
      }
      if (d?.source.respelled && !options.v1Only) (d.source.respelled.reason === "case-twin" ? report.caseSpelling : report.renamedByOverride).push(`${object}.${d.source.respelled.documentedName} -> ${name}`);
      objectJson.fields.push(json as unknown as StandardFieldJson);
      counts.fields++;
      const notVerified: Record<string, FactProvenance> = {};
      for (const key of Object.keys(json)) {
        if (key === "name") continue;
        const p: FactProvenance = facts[key] ?? "verified";
        counts[COUNT_KEYS[p]]++;
        if (p !== "verified") notVerified[key] = p;
      }
      if (Object.keys(notVerified).length > 0) fieldProvenance[name] = notVerified;
    }
    // Two names differing only in case would share one lower-cased Postgres column (sf-skills irregularity, Research Pitfall 8).
    const lowered = new Map<string, string>();
    for (const field of objectJson.fields) {
      const previous = lowered.get(field.name.toLowerCase());
      if (previous !== undefined) throw new GeneratorError(`${object}: fields ${previous} and ${field.name} differ only in case and would share one Postgres column; skip one in overrides.json`);
      lowered.set(field.name.toLowerCase(), field.name);
    }
    files.set(`objects/${object}.json`, serialise(orderObjectJson(objectJson)));
    report.skipped.perObject[object] = { fieldType: counts.skippedFieldType, referenceTarget: counts.skippedReferenceTarget };
    provenanceCounts[object] = counts;
    provenanceObjects[object] = { keyPrefix: override.keyPrefix.source, ...(objectPins ? {} : { labels: "override" as const, flags: override.flags ? ("override" as const) : ("doc-only" as const) }), ...(ownerProvenance ? { ownerTargets: ownerProvenance } : {}), fields: fieldProvenance };
  }

  if (report.conflicts.unresolved.length > 0 && !options.collectConflicts) {
    throw new GeneratorError(`unresolved source conflicts (settle each with a v1-pins.json pin or an overrides.json set):\n  ${report.conflicts.unresolved.sort(codeUnit).join("\n  ")}`);
  }
  const lists: string[][] = [report.pinnedFields, report.unpinnedV1Fields, report.conflictsSettledByPin, report.guessed, report.unsupportedTypes, report.overrideResolved, report.skipped.fieldType, report.skipped.referenceTarget, report.skippedByOverride, report.caseSpelling, report.renamedByOverride, report.excludedSystem, report.forcedNullable, report.sdkOnly, report.conflicts.unresolved];
  for (const list of lists) list.sort(codeUnit);
  if (!options.v1Only) {
    const provenance = {
      pins: { sfSkills: inputs.snapshots.sfSkills.revision, objectReference: inputs.snapshots.objectReference },
      counts: provenanceCounts,
      objects: provenanceObjects,
      skipped: { fieldType: report.skipped.fieldType, referenceTarget: report.skipped.referenceTarget },
      forcedNullable: report.forcedNullable,
      caseSpelling: report.caseSpelling,
      renamedByOverride: report.renamedByOverride,
      gating: report.gating,
    };
    files.set("PROVENANCE.json", serialise(sortKeysDeep(provenance)));
  }
  return { files, report };
}
