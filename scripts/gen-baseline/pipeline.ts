/**
 * The pure core of the baseline generator (Phase 9 BASE2-01/BASE2-02): `generate(inputs, options)` turns the
 * normalised sources, the v1.0 pin layer and overrides.json into the exact `StandardObjectJson` files under
 * packages/metadata/standard, plus a report of what the sources could not establish. No fs, no process, no Date: the
 * CLI (generate.ts) and the vitest parity gate call this same function, so "regenerate in memory" and "regenerate on
 * disk" cannot diverge (D-18/D-19). Precedence per fact: overrides > v1 pins > source-derived > type defaults; a fact
 * the two sources disagree on must be settled by a pin or an override, otherwise generation aborts (D-03).
 */
import type { StandardFieldJson, StandardObjectJson } from "@orglet/metadata";
import { GeneratorError } from "./errors.js";
import { codeUnit, sourceFieldsOf, type FieldOverride, type GeneratorInputs, type ObjectOverride, type Overrides, type SourceField } from "./sources.js";
import { compoundParent, flagsFrom, humanise, isTextType, lengthFor, mapType, sfTextLength, type Provenance } from "./typemap.js";

export { GeneratorError } from "./errors.js";

export const OBJECT_KEY_ORDER = ["name", "label", "labelPlural", "keyPrefix", "keyPrefixSource", "createable", "updateable", "deletable", "undeletable", "queryable", "searchable", "hasOwner", "ownerTargets", "fields"] as const;
export const FIELD_KEY_ORDER = ["name", "label", "type", "length", "precision", "scale", "nillable", "createable", "updateable", "defaultedOnCreate", "unique", "externalId", "caseSensitive", "idLookup", "nameField", "referenceTo", "relationshipName", "childRelationshipName", "deleteConstraint", "standardValueSet", "picklistValues", "restrictedPicklist", "formula", "defaultValue", "displayFormat", "compoundFieldName", "filterable", "sortable", "groupable", "featureGated"] as const;

export interface GenerateOptions {
  /** Emit only the objects and fields v1-pins.json lists, in the exact v1.0 key set (SC2 step 1). 09-07 sets false. */
  v1Only: boolean;
}
export const CLI_OPTIONS: GenerateOptions = { v1Only: true };

/** A fact the two sources state differently. Values are JSON for the message. */
export interface Conflict {
  fact: string;
  sf: string;
  doc: string;
}

export interface DerivedField {
  json: Partial<StandardFieldJson> & { name: string };
  conflicts: Conflict[];
  /** Per emitted fact (type, length, label, flags, referenceTo, ...). */
  provenance: Record<string, Provenance>;
  /** Set when the source type is not a physical column; `json` then holds only the name. */
  skip?: { reason: "system" | "unsupported"; sourceType: string };
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
  if ("skip" in mapped) return { json: { name: field.name }, conflicts, provenance, skip: { reason: mapped.skip, sourceType: mapped.sourceType } };

  const json: DerivedField["json"] = { name: field.name, label: "", type: mapped.type };
  if (field.sf?.label) {
    json.label = field.sf.label;
    provenance.label = "sdk-only";
  } else {
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
  return { json, conflicts, provenance };
}

/** Source-derived fields of one object, keyed by name; used by generate() and by `--bootstrap-pins`. */
export function deriveFromSources(inputs: GeneratorInputs, object: string): Map<string, DerivedField> {
  const fields = sourceFieldsOf(inputs, object);
  const addressFields = new Set(fields.filter((f) => typeToken(f).sf?.toLowerCase() === "address" || typeToken(f).doc?.toLowerCase() === "address").map((f) => f.name));
  return new Map(fields.map((f) => [f.name, deriveField(f, addressFields)]));
}

const KEY_PREFIX_SOURCES: readonly string[] = ["doc", "sdk-fixture", "unverified"];
const hasReason = (v: { reason?: unknown } | undefined): boolean => typeof v?.reason === "string" && v.reason.trim() !== "";

/** overrides.json must carry a reason on every hand fact (BASE2-01); key prefixes cite a public source or say unverified (D-07). */
export function validateOverrides(overrides: Overrides): void {
  for (const [object, entry] of Object.entries(overrides.objects)) {
    const where = `overrides.json ${object}`;
    const prefix = entry.keyPrefix as Partial<ObjectOverride["keyPrefix"]> | undefined;
    if (!prefix || (prefix.value !== null && typeof prefix.value !== "string")) throw new GeneratorError(`${where}: keyPrefix.value must be a string or null`);
    if (!KEY_PREFIX_SOURCES.includes(prefix.source as string)) throw new GeneratorError(`${where}: keyPrefix.source must be one of ${KEY_PREFIX_SOURCES.join("|")}`);
    if (prefix.source !== "unverified" && !prefix.ref) throw new GeneratorError(`${where}: keyPrefix.ref is required when source is ${prefix.source}`);
    if (entry.keepObject && !hasReason(entry.keepObject)) throw new GeneratorError(`${where}: keepObject needs a reason`);
    if (entry.ownerTargets && !hasReason(entry.ownerTargets)) throw new GeneratorError(`${where}: ownerTargets needs a reason`);
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

export function generate(inputs: GeneratorInputs, options: GenerateOptions): GenerateResult {
  validateOverrides(inputs.overrides);
  const pins = inputs.pins;
  if (options.v1Only && !pins) throw new GeneratorError("v1-pins.json is missing; run `pnpm baseline:gen --bootstrap-pins` once");
  for (const object of Object.keys(pins ?? {})) if (!inputs.objects.includes(object)) throw new GeneratorError(`v1-pins.json lists ${object}, which is not in objects.json`);

  const report: GeneratorReport = { pinnedFields: [], unpinnedV1Fields: [], conflictsSettledByPin: [], guessed: [], unsupportedTypes: [], overrideResolved: [] };
  const unresolved: string[] = [];
  const files = new Map<string, string>();
  const objects = options.v1Only ? inputs.objects.filter((o) => pins?.[o]) : inputs.objects;

  for (const object of objects) {
    const override: ObjectOverride | undefined = inputs.overrides.objects[object];
    if (!override) throw new GeneratorError(`overrides.json has no entry for ${object} (keyPrefix is a hand fact, D-07)`);
    const objectPins = pins?.[object];
    const derived = deriveFromSources(inputs, object);
    if (!inputs.sfSkills.has(object) && !inputs.objectReference.has(object) && !override.keepObject) {
      throw new GeneratorError(`${object} is in neither source; add an overrides.json keepObject entry`);
    }
    const objectFacts = objectPins?.object ?? {};
    if (typeof objectFacts.label !== "string" || typeof objectFacts.labelPlural !== "string" || typeof objectFacts.hasOwner !== "boolean") {
      throw new GeneratorError(`${object}: object facts (label, labelPlural, hasOwner) are stated by neither source; pin them in v1-pins.json`);
    }
    const objectJson: StandardObjectJson = { ...objectFacts, name: object, label: objectFacts.label, labelPlural: objectFacts.labelPlural, keyPrefix: override.keyPrefix.value, hasOwner: objectFacts.hasOwner, fields: [] };
    if (!options.v1Only) objectJson.keyPrefixSource = override.keyPrefix.source;

    const fieldOverrides: Record<string, FieldOverride> = override.fields ?? {};
    const names = new Set<string>();
    if (options.v1Only) for (const name of Object.keys(objectPins?.fields ?? {})) names.add(name);
    else {
      for (const [name, d] of derived) if (!d.skip || d.skip.reason !== "system") names.add(name);
      for (const [name, o] of Object.entries(fieldOverrides)) if (o.keep) names.add(name);
    }
    for (const [name, o] of Object.entries(fieldOverrides)) if (o.skip) names.delete(name);

    for (const name of [...names].sort(codeUnit)) {
      const where = `${object}.${name}`;
      const fieldPins = objectPins?.fields[name];
      const fieldOverride = fieldOverrides[name];
      const d = derived.get(name);
      if (d?.skip && !fieldPins) {
        if (d.skip.reason === "unsupported") report.unsupportedTypes.push(`UNSUPPORTED:field-type ${where} (${d.skip.sourceType})`);
        continue;
      }
      if (!d && !fieldOverride?.keep) throw new GeneratorError(`${where} is in v1.0 but in neither source; add an overrides.json keep entry`);
      const json: Record<string, unknown> = { ...(d?.json ?? { name }) };
      if (fieldPins) {
        applyPins(json, fieldPins);
        (Object.keys(fieldPins).length > 0 ? report.pinnedFields : report.unpinnedV1Fields).push(where);
      }
      if (fieldOverride?.set) Object.assign(json, fieldOverride.set);
      for (const c of d?.conflicts ?? []) {
        if (fieldOverride?.set && c.fact in fieldOverride.set) report.overrideResolved.push(`${where}.${c.fact}`);
        else if (fieldPins && c.fact in fieldPins) report.conflictsSettledByPin.push(`${where}.${c.fact}`);
        else unresolved.push(`${where}.${c.fact}: sf-skills=${c.sf} object-reference=${c.doc}`);
      }
      for (const [fact, p] of Object.entries(d?.provenance ?? {})) {
        if (p === "guessed" && json[fact] !== undefined && !(fieldPins && fact in fieldPins) && !(fieldOverride?.set && fact in fieldOverride.set)) report.guessed.push(`${where}.${fact}`);
      }
      if (typeof json.label !== "string" || typeof json.type !== "string") throw new GeneratorError(`${where}: label and type are required after pins and overrides`);
      if ((json.type === "Lookup" || json.type === "MasterDetail") && !(Array.isArray(json.referenceTo) && json.referenceTo.length > 0)) {
        throw new GeneratorError(`${where}: ${json.type} without referenceTo; neither source states Refers To, pin or override it`);
      }
      objectJson.fields.push(json as unknown as StandardFieldJson);
    }
    files.set(`objects/${object}.json`, serialise(orderObjectJson(objectJson)));
  }

  if (unresolved.length > 0) throw new GeneratorError(`unresolved source conflicts (settle each with a v1-pins.json pin or an overrides.json set):\n  ${unresolved.join("\n  ")}`);
  for (const list of Object.values(report) as string[][]) list.sort(codeUnit);
  return { files, report };
}
