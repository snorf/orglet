/**
 * Merges the standard-object baseline with an SFDX source project into an OrgSchema.
 */
import { readdir, readFile } from "node:fs/promises";
import { pushDiagnostic, type Diagnostic, type DiagnosticSink, type InfoDiagnostic, type SkippedItem } from "./diagnostics.js";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type {
  CustomLabelDef,
  CustomMetadataRecord,
  FieldDef,
  FieldType,
  GlobalValueSetDef,
  PicklistDef,
  PicklistValue,
  RollupDef,
  SObjectDef,
  StandardFieldJson,
  StandardObjectJson,
  StandardValueSetDef,
} from "./types.js";
import type { SourceField, SourceObject, SourceProject } from "./sfdx.js";
import { OrgSchemaImpl, definitionTarget } from "./schema.js";
import { resolveRollups, splitRollupRef, type PendingRollup, type RollupColumn } from "./rollup.js";

const STANDARD_DIR = fileURLToPath(new URL("../standard/", import.meta.url));

export interface Baseline {
  objects: StandardObjectJson[];
  standardValueSets: Map<string, StandardValueSetDef>;
  /** Distinct lookup targets the generator skipped (PROVENANCE.json skipped.referenceTarget); absent for fixture baselines. */
  skippedReferenceTargets?: string[];
}

export interface BuildResult {
  schema: OrgSchemaImpl;
  /** Things in the project that were skipped or partially loaded, prefixed `UNSUPPORTED:<area>`. */
  warnings: string[];
  /** Structured form of `warnings`, same order (D-15). */
  diagnostics: Diagnostic[];
  /** Informational items, sorted by object: unmodelled standard objects nothing references (D-06/D-07) and custom settings loaded without data (Phase 11 D-20); never in warnings. Consumers filter by area. */
  info: InfoDiagnostic[];
  /** Record files matched to a loaded __mdt type (canonical type casing), in file order. Values are coerced and relationships resolved by @orglet/engine planCustomMetadataSeed. */
  customMetadata: CustomMetadataRecord[];
}

export async function loadBaseline(dir: string = STANDARD_DIR): Promise<Baseline> {
  const objectsDir = join(dir, "objects");
  const files = (await readdir(objectsDir)).filter((f) => f.endsWith(".json")).sort();
  const objects: StandardObjectJson[] = [];
  for (const f of files) {
    objects.push(JSON.parse(await readFile(join(objectsDir, f), "utf8")) as StandardObjectJson);
  }
  const raw = JSON.parse(await readFile(join(dir, "standardValueSets.json"), "utf8")) as Record<
    string,
    { sorted?: boolean; values: PicklistValue[] }
  >;
  const standardValueSets = new Map<string, StandardValueSetDef>();
  for (const [name, v] of Object.entries(raw)) {
    standardValueSets.set(name, { name, sorted: v.sorted ?? false, values: v.values });
  }
  const skippedReferenceTargets = await readSkippedReferenceTargets(dir);
  return { objects, standardValueSets, ...(skippedReferenceTargets !== undefined ? { skippedReferenceTargets } : {}) };
}

/**
 * PROVENANCE.json ships with the package (files: dist, standard); test fixture baselines have none.
 * Entries look like `Account.ActivityMetricId -> ActivityMetric`, `... -> (none stated)` or `... -> A, B, C`.
 */
async function readSkippedReferenceTargets(dir: string): Promise<string[] | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(dir, "PROVENANCE.json"), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw e;
  }
  const entries = (JSON.parse(raw) as { skipped?: { referenceTarget?: unknown } }).skipped?.referenceTarget;
  if (!Array.isArray(entries)) return undefined;
  const names = new Set<string>();
  for (const entry of entries) {
    if (typeof entry !== "string") continue;
    const at = entry.indexOf(" -> ");
    if (at < 0) continue;
    for (const part of entry.slice(at + 4).split(", ")) {
      const name = part.trim();
      if (name !== "" && name !== "(none stated)") names.add(name);
    }
  }
  return [...names].sort();
}

// ---------------------------------------------------------------------------
// Field construction helpers

function baseField(name: string, label: string, type: FieldType, custom: boolean): FieldDef {
  return {
    name,
    label,
    type,
    custom,
    nillable: true,
    createable: true,
    updateable: true,
    defaultedOnCreate: false,
    unique: false,
    externalId: false,
    caseSensitive: false,
    idLookup: false,
    nameField: false,
    filterable: true,
    sortable: true,
    groupable: true,
  };
}

function readOnly(f: FieldDef): FieldDef {
  f.createable = false;
  f.updateable = false;
  return f;
}

function systemFields(hasOwner: boolean, ownerTargets?: readonly ("User" | "Group")[]): { head: FieldDef[]; tail: FieldDef[] } {
  const id = readOnly(baseField("Id", "Record ID", "Id", false));
  id.nillable = false;
  id.idLookup = true;
  id.defaultedOnCreate = true;

  const isDeleted = readOnly(baseField("IsDeleted", "Deleted", "Checkbox", false));
  isDeleted.nillable = false;
  isDeleted.defaultedOnCreate = true;
  isDeleted.defaultValue = "false";

  const userRef = (name: string, label: string, rel: string): FieldDef => {
    const f = readOnly(baseField(name, label, "Lookup", false));
    f.nillable = false;
    f.defaultedOnCreate = true;
    f.referenceTo = ["User"];
    f.relationshipName = rel;
    return f;
  };
  const dateTime = (name: string, label: string): FieldDef => {
    const f = readOnly(baseField(name, label, "DateTime", false));
    f.nillable = false;
    f.defaultedOnCreate = true;
    return f;
  };

  const tail: FieldDef[] = [];
  if (hasOwner) {
    const owner = baseField("OwnerId", "Owner ID", "Lookup", false);
    owner.nillable = false;
    owner.defaultedOnCreate = true;
    owner.referenceTo = [...(ownerTargets ?? ["User", "Group"])];
    owner.relationshipName = "Owner";
    tail.push(owner);
  }
  tail.push(
    dateTime("CreatedDate", "Created Date"),
    userRef("CreatedById", "Created By ID", "CreatedBy"),
    dateTime("LastModifiedDate", "Last Modified Date"),
    userRef("LastModifiedById", "Last Modified By ID", "LastModifiedBy"),
    dateTime("SystemModstamp", "System Modstamp"),
  );
  return { head: [id, isDeleted], tail };
}

function picklistFromValues(values: PicklistValue[], restricted: boolean, sorted = false, valueSetName?: string): PicklistDef {
  const p: PicklistDef = { restricted, sorted, values };
  if (valueSetName !== undefined) p.valueSetName = valueSetName;
  return p;
}

// ---------------------------------------------------------------------------
// Baseline conversion

function fromStandardJson(
  j: StandardFieldJson,
  standardValueSets: Map<string, StandardValueSetDef>,
  objectName: string,
): FieldDef {
  const f = baseField(j.name, j.label, j.type, false);
  const copy = <K extends keyof FieldDef & keyof StandardFieldJson>(k: K) => {
    const v = j[k] as unknown as FieldDef[K] | undefined;
    if (v !== undefined) f[k] = v;
  };
  copy("length");
  copy("precision");
  copy("scale");
  copy("nillable");
  copy("createable");
  copy("updateable");
  copy("defaultedOnCreate");
  copy("unique");
  copy("externalId");
  copy("caseSensitive");
  copy("idLookup");
  copy("nameField");
  copy("referenceTo");
  copy("relationshipName");
  copy("childRelationshipName");
  copy("deleteConstraint");
  copy("formula");
  copy("defaultValue");
  copy("displayFormat");
  copy("compoundFieldName");
  copy("filterable");
  copy("sortable");
  copy("groupable");
  copy("description");
  copy("featureGated");

  if (j.type === "Picklist" || j.type === "MultiselectPicklist") {
    if (j.standardValueSet !== undefined) {
      const set = standardValueSets.get(j.standardValueSet);
      if (!set) throw new Error(`${objectName}.${j.name}: unknown StandardValueSet ${j.standardValueSet}`);
      f.picklist = picklistFromValues(set.values, j.restrictedPicklist ?? false, set.sorted, set.name);
    } else {
      const values = (j.picklistValues ?? []).map((v) => ({
        value: v.value,
        label: v.label ?? v.value,
        default: v.default ?? false,
        active: true,
      }));
      f.picklist = picklistFromValues(values, j.restrictedPicklist ?? false);
    }
  }
  if (j.type === "Checkbox") {
    f.nillable = false;
    f.defaultedOnCreate = true;
    if (f.defaultValue === undefined) f.defaultValue = "false";
  }
  // A picklist default is a value, not a formula: express it on the value set.
  if (f.picklist && f.defaultValue !== undefined) {
    const def = f.defaultValue;
    f.picklist = { ...f.picklist, values: f.picklist.values.map((v) => ({ ...v, default: v.value === def })) };
    delete f.defaultValue;
    f.defaultedOnCreate = true;
  }
  if (j.type === "AutoNumber" || j.formula !== undefined) {
    readOnly(f);
    if (j.type === "AutoNumber") f.defaultedOnCreate = true;
  }
  if (j.type === "Address" || j.type === "Name") {
    readOnly(f);
    f.groupable = false;
  }
  if (j.type === "LongTextArea" || j.type === "Html" || j.type === "TextArea") {
    f.sortable = j.sortable ?? false;
    f.groupable = j.groupable ?? false;
    f.filterable = j.filterable ?? true;
  }
  return f;
}

function fromStandardObject(j: StandardObjectJson, standardValueSets: Map<string, StandardValueSetDef>): SObjectDef {
  const sys = systemFields(j.hasOwner, j.ownerTargets);
  return {
    name: j.name,
    label: j.label,
    labelPlural: j.labelPlural,
    keyPrefix: j.keyPrefix,
    ...(j.keyPrefixSource !== undefined ? { keyPrefixSource: j.keyPrefixSource } : {}),
    custom: false,
    createable: j.createable ?? true,
    updateable: j.updateable ?? true,
    deletable: j.deletable ?? true,
    undeletable: j.undeletable ?? true,
    queryable: j.queryable ?? true,
    searchable: j.searchable ?? true,
    hasOwner: j.hasOwner,
    fields: [...sys.head, ...j.fields.map((f) => fromStandardJson(f, standardValueSets, j.name)), ...sys.tail],
    validationRules: [],
    recordTypes: [],
  };
}

// ---------------------------------------------------------------------------
// Source (custom) field conversion

interface ValueSets {
  global: Map<string, GlobalValueSetDef>;
  standard: Map<string, StandardValueSetDef>;
}

function resolvePicklist(sf: SourceField, objectName: string, sets: ValueSets): PicklistDef {
  const vs = sf.valueSet;
  if (!vs) throw new Error(`${objectName}.${sf.fullName}: picklist without <valueSet>`);
  const restricted = vs.restricted ?? false;
  if (vs.valueSetName !== undefined) {
    const g = sets.global.get(vs.valueSetName);
    if (!g) throw new Error(`${objectName}.${sf.fullName}: unknown GlobalValueSet ${vs.valueSetName}`);
    return picklistFromValues(g.values, restricted, g.sorted, g.name);
  }
  return picklistFromValues(vs.values ?? [], restricted, vs.sorted ?? false);
}

function fromSourceField(sf: SourceField, objectName: string, sets: ValueSets): FieldDef {
  if (sf.type === undefined) throw new Error(`${objectName}.${sf.fullName}: custom field without <type>`);
  if (sf.type === "Summary") throw new Error(`${objectName}.${sf.fullName}: roll-up summary fields are resolved separately`);
  const f = baseField(sf.fullName, sf.label ?? sf.fullName, sf.type, true);
  const set = <K extends keyof FieldDef>(k: K, v: FieldDef[K] | undefined) => {
    if (v !== undefined) f[k] = v;
  };
  set("length", sf.length);
  set("precision", sf.precision);
  set("scale", sf.scale);
  set("unique", sf.unique);
  set("externalId", sf.externalId);
  set("caseSensitive", sf.caseSensitive);
  set("defaultValue", sf.defaultValue);
  set("displayFormat", sf.displayFormat);
  set("visibleLines", sf.visibleLines);
  set("inlineHelpText", sf.inlineHelpText);
  set("description", sf.description);
  if (sf.required) f.nillable = false;
  if (sf.externalId || sf.unique) f.idLookup = sf.externalId ?? false;

  if (sf.formula !== undefined) {
    f.formula = sf.formula;
    f.formulaTreatBlanksAs = sf.formulaTreatBlanksAs ?? "BlankAsBlank";
    readOnly(f);
    f.nillable = true;
    return f;
  }

  switch (sf.type) {
    case "Checkbox":
      f.nillable = false;
      f.defaultedOnCreate = true;
      if (f.defaultValue === undefined) f.defaultValue = "false";
      break;
    case "AutoNumber":
      readOnly(f);
      f.defaultedOnCreate = true;
      break;
    case "TextArea":
      f.length ??= 255;
      f.sortable = false;
      f.groupable = false;
      break;
    case "LongTextArea":
    case "Html":
      f.sortable = false;
      f.groupable = false;
      f.filterable = false;
      break;
    case "Picklist":
      f.picklist = resolvePicklist(sf, objectName, sets);
      break;
    case "MultiselectPicklist":
      f.picklist = resolvePicklist(sf, objectName, sets);
      f.length ??= 4099;
      f.sortable = false;
      f.groupable = false;
      break;
    case "Lookup":
    case "MasterDetail": {
      // A Hierarchy field arrives as Lookup without referenceTo: it points at its own object.
      const referenceTo = sf.referenceTo ?? objectName;
      f.referenceTo = [referenceTo];
      f.relationshipName = sf.fullName.replace(/__c$/i, "__r");
      if (sf.relationshipName) f.childRelationshipName = `${sf.relationshipName}__r`;
      if (sf.relationshipLabel !== undefined) f.relationshipLabel = sf.relationshipLabel;
      if (sf.type === "MasterDetail") {
        f.nillable = false;
        f.deleteConstraint = "Cascade";
        f.relationshipOrder = sf.relationshipOrder ?? 0;
        f.reparentable = sf.reparentableMasterDetail ?? false;
      } else {
        f.deleteConstraint = sf.deleteConstraint ?? "SetNull";
      }
      break;
    }
    case "MetadataRelationship": {
      if (sf.referenceTo === undefined) throw new Error(`${objectName}.${sf.fullName}: MetadataRelationship without <referenceTo>`);
      // D-07/D-08: Lookup-shaped for describe and relationship queries, but stored as a plain name column: no FK and no child relationship.
      const lower = sf.referenceTo.toLowerCase();
      const target = lower === "entitydefinition" ? "EntityDefinition" : lower === "fielddefinition" ? "FieldDefinition" : sf.referenceTo;
      f.referenceTo = [target];
      f.relationshipName = sf.fullName.replace(/__c$/i, "__r");
      if (sf.relationshipLabel !== undefined) f.relationshipLabel = sf.relationshipLabel;
      break;
    }
    case "Location":
      readOnly(f);
      f.groupable = false;
      break;
    default:
      break;
  }
  if (f.defaultValue !== undefined && sf.type !== "Checkbox") f.defaultedOnCreate = true;
  return f;
}

/** A resolved roll-up: an ordinary stored column of the aggregate's type, read-only to clients (ROLL-07). */
function rollupField(sf: SourceField, column: RollupColumn, rollup: RollupDef): FieldDef {
  const f = readOnly(baseField(sf.fullName, sf.label ?? sf.fullName, column.type, true));
  if (column.precision !== undefined) f.precision = column.precision;
  if (column.scale !== undefined) f.scale = column.scale;
  if (sf.description !== undefined) f.description = sf.description;
  if (sf.inlineHelpText !== undefined) f.inlineHelpText = sf.inlineHelpText;
  f.rollup = rollup;
  return f;
}

function nameFieldFor(obj: SourceObject): FieldDef {
  const nf = obj.nameField ?? {};
  const label = nf.label ?? `${obj.label ?? obj.name} Name`;
  if (nf.type === "AutoNumber") {
    const f = readOnly(baseField("Name", label, "AutoNumber", false));
    f.nillable = false;
    f.defaultedOnCreate = true;
    f.nameField = true;
    if (nf.displayFormat !== undefined) f.displayFormat = nf.displayFormat;
    return f;
  }
  const f = baseField("Name", label, "Text", false);
  f.length = 80;
  f.nillable = false;
  f.nameField = true;
  return f;
}

function isCustomObjectName(name: string): boolean {
  return /__c$/i.test(name);
}

function isCustomMetadataName(name: string): boolean {
  return /__mdt$/i.test(name);
}

/**
 * D-16: the custom-metadata system fields the Object Reference documents plus the audit fields every orglet object has;
 * no Name, OwnerId or IsDeleted (no recycle bin). Labels and lengths the Object Reference does not state are orglet choices.
 */
function customMetadataSystemFields(): { head: FieldDef[]; tail: FieldDef[] } {
  const sys = systemFields(false);
  const id = sys.head[0];
  if (id === undefined) throw new Error("systemFields returned no Id");
  const text = (name: string, label: string, length: number, nillable: boolean): FieldDef => {
    const f = readOnly(baseField(name, label, "Text", false));
    f.length = length;
    f.nillable = nillable;
    return f;
  };
  const developerName = text("DeveloperName", "Custom Metadata Record Name", 40, false);
  developerName.unique = true;
  const masterLabel = text("MasterLabel", "Label", 40, false);
  masterLabel.nameField = true;
  // The Object Reference lists Label with an empty value list, i.e. a picklist; its value always equals MasterLabel (Pitfall 11).
  const label = readOnly(baseField("Label", "Label", "Picklist", false));
  label.length = 40;
  label.nillable = false;
  label.picklist = picklistFromValues([], false);
  // Documented as a string, "always the default language of the developing organization"; en_US here, the bootstrap Organization's LanguageLocaleKey.
  const language = text("Language", "Master Language", 40, false);
  const namespacePrefix = text("NamespacePrefix", "Namespace Prefix", 15, true);
  // NamespacePrefix__DeveloperName fits 15+2+40; the length is an orglet choice.
  const qualified = text("QualifiedApiName", "Qualified API Name", 70, false);
  const isProtected = readOnly(baseField("IsProtected", "Protected Component", "Checkbox", false));
  isProtected.nillable = false;
  isProtected.defaultedOnCreate = true;
  isProtected.defaultValue = "false";
  // Spelled SystemModstamp like every other orglet object although the Object Reference writes SystemModStamp.
  return { head: [id, developerName, masterLabel, label, language, namespacePrefix, qualified, isProtected], tail: sys.tail };
}

function fromCustomMetadataObject(obj: SourceObject, keyPrefix: string, sets: ValueSets): SObjectDef {
  const sys = customMetadataSystemFields();
  const custom = obj.fields.filter((f) => f.type !== "Summary").map((f) => readOnly(fromSourceField(f, obj.name, sets)));
  const label = obj.label ?? obj.name.replace(/__mdt$/i, "");
  return {
    name: obj.name,
    label,
    labelPlural: obj.pluralLabel ?? `${label}s`,
    keyPrefix,
    custom: true,
    // D-15: the Object Reference's Supported Calls for custom metadata types are describeSObjects(), query() and retrieve();
    // every other capability is false. Fields are read-only for the same reason (describe never claims more than orglet supports).
    createable: false,
    updateable: false,
    deletable: false,
    undeletable: false,
    queryable: true,
    searchable: false,
    hasOwner: false,
    customMetadata: true,
    fields: [...sys.head, ...sys.tail, ...custom],
    validationRules: obj.validationRules,
    recordTypes: [],
  };
}

function recordTypeField(): FieldDef {
  const f = baseField("RecordTypeId", "Record Type ID", "Lookup", false);
  f.referenceTo = ["RecordType"];
  f.relationshipName = "RecordType";
  f.defaultedOnCreate = true;
  return f;
}

/**
 * D-18: a Hierarchy setting holds one row per org, profile or user (Apex Developer Guide, Custom Settings). Unique so a second row
 * for the same owner fails DUPLICATE_VALUE through the engine's 23505 mapping; the engine defaults it to the Organization.
 * Label "Location ID" and updateable are orglet choices.
 */
function setupOwnerField(): FieldDef {
  const f = baseField("SetupOwnerId", "Location ID", "Lookup", false);
  f.referenceTo = ["Organization", "Profile", "User"];
  f.relationshipName = "SetupOwner";
  f.nillable = false;
  f.defaultedOnCreate = true;
  f.unique = true;
  return f;
}

function fromSourceObject(obj: SourceObject, keyPrefix: string, sets: ValueSets): SObjectDef {
  const setting = obj.customSettingsType;
  // D-17: a custom setting has no owner.
  const hasOwner = setting === undefined && !obj.fields.some((f) => f.type === "MasterDetail");
  const sys = systemFields(hasOwner);
  const name = nameFieldFor(obj);
  // D-19: Name is required and unique on a List setting, optional on a Hierarchy setting (secondary source, 11-RESEARCH Open Question 5).
  if (setting === "Hierarchy") name.nillable = true;
  if (setting === "List") name.unique = true;
  const custom = obj.fields.filter((f) => f.type !== "Summary").map((f) => fromSourceField(f, obj.name, sets));
  if (obj.recordTypes.length > 0) custom.unshift(recordTypeField());
  const label = obj.label ?? obj.name.replace(/__c$/i, "");
  return {
    name: obj.name,
    label,
    labelPlural: obj.pluralLabel ?? `${label}s`,
    keyPrefix,
    custom: true,
    createable: true,
    updateable: true,
    deletable: true,
    undeletable: true,
    queryable: true,
    searchable: true,
    hasOwner,
    ...(setting !== undefined ? { customSetting: setting } : {}),
    ...(obj.sharingModel !== undefined ? { sharingModel: obj.sharingModel } : {}),
    fields: [...sys.head, name, ...sys.tail, ...(setting === "Hierarchy" ? [setupOwnerField()] : []), ...custom],
    validationRules: obj.validationRules,
    recordTypes: obj.recordTypes,
  };
}

// ---------------------------------------------------------------------------

/**
 * Provisional key prefix for the i-th custom object in name order (`a00`, `a01`, ...). This is what
 * `orglet check` reports and what a brand-new org starts from; once `orglet up` has run, the
 * assignment persisted in `_orglet.key_prefixes` (see `reconcileKeyPrefixes` in @orglet/schema)
 * is the truth, so adding, removing or renaming objects never shifts an existing object's prefix.
 * `m` is the custom-metadata series (`m00` per public Tooling EntityDefinition fixtures, 11-RESEARCH Open Question 4),
 * numbered over __mdt types only so a new type never shifts a __c prefix (D-02).
 */
function customKeyPrefix(index: number, pool: "a" | "m" = "a"): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const hi = alphabet[Math.floor(index / alphabet.length)];
  const lo = alphabet[index % alphabet.length];
  if (hi === undefined || lo === undefined) throw new Error(pool === "m" ? "too many custom metadata types" : "too many custom objects");
  return `${pool}${hi}${lo}`;
}

const PROVENANCE = new Set<string>(["doc", "sdk-fixture", "de-describe", "unverified"]);

/**
 * Baseline files are orglet's own data, so a bad one is a bug and a hard error, not an UNSUPPORTED warning
 * (D-10). A null prefix must come with a source label and a non-createable object, because nothing may
 * mint an Id for it; every other prefix must be a real-looking, unique standard prefix that can never
 * collide with a custom-object (a00..azz) or custom-metadata (m0x, conservative guard) prefix (D-12).
 */
export function validateBaseline(objects: readonly StandardObjectJson[]): void {
  const seen = new Map<string, string>();
  for (const o of objects) {
    if (o.ownerTargets !== undefined) {
      if (!o.hasOwner) throw new Error(`invalid baseline: ${o.name} has ownerTargets but no owner (hasOwner is false)`);
      if (o.ownerTargets.length === 0) throw new Error(`invalid baseline: ${o.name} has an empty ownerTargets`);
      const named = new Set<string>();
      for (const t of o.ownerTargets as string[]) {
        if (t !== "User" && t !== "Group") throw new Error(`invalid baseline: ${o.name} has ownerTargets entry ${t}; only User and Group are allowed`);
        if (named.has(t)) throw new Error(`invalid baseline: ${o.name} lists ${t} twice in ownerTargets`);
        named.add(t);
      }
    }
    if (o.keyPrefixSource !== undefined && !PROVENANCE.has(o.keyPrefixSource)) throw new Error(`invalid baseline: ${o.name} has unknown keyPrefixSource ${String(o.keyPrefixSource)}`);
    if (o.keyPrefix === null) {
      if (o.createable !== false) throw new Error(`invalid baseline: ${o.name} has keyPrefix null but is createable; a prefix-less object must set "createable": false`);
      if (o.keyPrefixSource === undefined) throw new Error(`invalid baseline: ${o.name} has keyPrefix null but no keyPrefixSource`);
      continue;
    }
    if (!/^[0-9A-Za-z]{3}$/.test(o.keyPrefix)) throw new Error(`invalid baseline: ${o.name} key prefix ${o.keyPrefix} is not three alphanumeric characters`);
    if (/^a[0-9A-Za-z]{2}$/.test(o.keyPrefix)) throw new Error(`invalid baseline: ${o.name} key prefix ${o.keyPrefix} is in the custom-object range a00..azz`);
    if (o.keyPrefix.startsWith("m0")) throw new Error(`invalid baseline: ${o.name} key prefix ${o.keyPrefix} is in the custom-metadata range m0*`);
    const other = seen.get(o.keyPrefix);
    if (other !== undefined) throw new Error(`invalid baseline: key prefix ${o.keyPrefix} is used by both ${other} and ${o.name}`);
    seen.set(o.keyPrefix, o.name);
  }
}

export function buildOrgSchema(baseline: Baseline, project?: SourceProject): BuildResult {
  validateBaseline(baseline.objects);
  const sink: DiagnosticSink = { warnings: [...(project?.warnings ?? [])], diagnostics: [...(project?.diagnostics ?? [])] };
  const standardValueSets = new Map(baseline.standardValueSets);
  for (const s of project?.standardValueSets ?? []) standardValueSets.set(s.name, s);
  const globalValueSets = new Map<string, GlobalValueSetDef>();
  for (const g of project?.globalValueSets ?? []) globalValueSets.set(g.name, g);
  const sets: ValueSets = { global: globalValueSets, standard: standardValueSets };

  const objects = new Map<string, SObjectDef>();
  for (const j of baseline.objects) objects.set(j.name.toLowerCase(), fromStandardObject(j, standardValueSets));
  // Summary fields need every object registered first; they are resolved after both merge loops.
  const pending: PendingRollup[] = [];

  const unmodelledStandard = new Set<Diagnostic>();
  const sourceObjects = project?.objects ?? [];
  // D-19: custom settings are __c objects and share the a00..azz pool; the platform's series for settings is undocumented (orglet choice).
  const customObjects = sourceObjects.filter((o) => isCustomObjectName(o.name)).sort((a, b) => a.name.localeCompare(b.name));
  customObjects.forEach((o, i) => {
    for (const sf of o.fields) if (sf.type === "Summary") pending.push({ objectName: o.name, field: sf });
    objects.set(o.name.toLowerCase(), fromSourceObject(o, customKeyPrefix(i), sets));
  });

  const metadataTypes = sourceObjects.filter((o) => isCustomMetadataName(o.name)).sort((a, b) => a.name.localeCompare(b.name));
  metadataTypes.forEach((o, i) => {
    objects.set(o.name.toLowerCase(), fromCustomMetadataObject(o, customKeyPrefix(i, "m"), sets));
  });

  for (const o of sourceObjects) {
    if (isCustomObjectName(o.name) || isCustomMetadataName(o.name)) continue;
    const target = objects.get(o.name.toLowerCase());
    if (!target) {
      const area = /__(e|x|b|share|history|feed)$/i.test(o.name) ? "object-kind" : "standard-object";
      const skipped = { area, kind: "object", object: o.name, message: `${o.name} skipped` } satisfies SkippedItem;
      pushDiagnostic(sink, skipped);
      if (area === "standard-object") unmodelledStandard.add(skipped);
      continue;
    }
    if (o.label !== undefined) target.label = o.label;
    if (o.pluralLabel !== undefined) target.labelPlural = o.pluralLabel;
    if (o.sharingModel !== undefined) target.sharingModel = o.sharingModel;
    for (const sf of o.fields) {
      if (sf.type === "Summary") {
        pending.push({ objectName: target.name, field: sf });
        continue;
      }
      const existing = target.fields.find((f) => f.name.toLowerCase() === sf.fullName.toLowerCase());
      if (existing) {
        if (sf.inlineHelpText !== undefined) existing.inlineHelpText = sf.inlineHelpText;
        if (sf.description !== undefined) existing.description = sf.description;
        if (sf.valueSet?.values && existing.picklist) {
          existing.picklist = picklistFromValues(sf.valueSet.values, sf.valueSet.restricted ?? existing.picklist.restricted, sf.valueSet.sorted ?? false);
        }
        continue;
      }
      if (!/__c$/i.test(sf.fullName)) {
        pushDiagnostic(sink, { area: "standard-field", kind: "field", object: o.name, field: sf.fullName, message: `${o.name}.${sf.fullName} is not in the baseline and was skipped` } satisfies SkippedItem);
        continue;
      }
      target.fields.push(fromSourceField(sf, o.name, sets));
    }
    target.validationRules.push(...o.validationRules);
    target.recordTypes.push(...o.recordTypes);
  }

  resolveRollups(objects, pending, sink, rollupField);

  // D-21, D-22: labels are keyed case-insensitively; the first definition wins and a duplicate warns once.
  const labels = new Map<string, CustomLabelDef>();
  for (const l of project?.labels ?? []) {
    const key = l.fullName.toLowerCase();
    const first = labels.get(key);
    if (first !== undefined) {
      pushDiagnostic(sink, { area: "custom-label", message: `${l.fullName} duplicates ${first.fullName}; the first definition is kept` });
      continue;
    }
    labels.set(key, l);
  }

  // D-05: record files belong to a loaded __mdt type; anything else is skipped with one warning.
  const customMetadata: CustomMetadataRecord[] = [];
  for (const r of project?.customMetadata ?? []) {
    const obj = objects.get(r.type.toLowerCase());
    if (obj?.customMetadata !== true) {
      pushDiagnostic(sink, {
        area: "custom-metadata-record",
        object: r.type,
        message: `${r.file}: ${r.type} is not a custom metadata type in objects/; record ${r.developerName} skipped`,
      });
      continue;
    }
    customMetadata.push({ ...r, type: obj.name });
  }

  // Dangling references are allowed (e.g. Campaign not in phase 0) but reported once per target.
  // "Referenced" (D-05, D-09) = named in referenceTo of a lookup, master-detail or owner field, or as a roll-up child.
  // Formula and validation-rule paths to another object go through such a field, so no separate scan is needed.
  const missing = new Set<string>();
  const referenced = new Set<string>();
  for (const obj of objects.values()) {
    for (const f of obj.fields) {
      // Entity/field definition targets are checked per record at seed time, D-09.
      if (definitionTarget(f) !== undefined) continue;
      for (const ref of f.referenceTo ?? []) {
        referenced.add(ref.toLowerCase());
        if (!objects.has(ref.toLowerCase())) missing.add(ref);
      }
    }
  }
  for (const p of pending) {
    const child = splitRollupRef(p.field.summaryForeignKey ?? "")?.object;
    if (child !== undefined) referenced.add(child.toLowerCase());
  }
  for (const m of [...missing].sort()) pushDiagnostic(sink, { area: "reference-target", object: m, message: `${m} is referenced but not defined; lookups to it are unchecked` });

  // D-07: an unmodelled standard object nothing references moves from the warnings to the informational list.
  const info: InfoDiagnostic[] = [];
  for (let i = sink.diagnostics.length - 1; i >= 0; i--) {
    const d = sink.diagnostics[i];
    if (d === undefined || !unmodelledStandard.has(d) || d.object === undefined || referenced.has(d.object.toLowerCase())) continue;
    sink.diagnostics.splice(i, 1);
    sink.warnings.splice(i, 1);
    info.push({ severity: "info", area: "standard-object-unmodelled", object: d.object, message: `${d.object} is not modelled and nothing references it; its metadata was skipped` });
  }
  // D-20: a fact about the retrieve format, not an orglet gap, so no warning and no UNSUPPORTED.
  for (const o of [...objects.values()].filter((x) => x.customSetting !== undefined).sort((a, b) => a.name.localeCompare(b.name))) {
    info.push({ severity: "info", area: "custom-setting-no-data", object: o.name, message: `${o.name} is a ${o.customSetting} custom setting; custom-setting data is not part of a retrieve` });
  }
  // D-06: documented lookup targets the generator skipped, when neither modelled nor referenced.
  for (const name of baseline.skippedReferenceTargets ?? []) {
    const key = name.toLowerCase();
    if (objects.has(key) || referenced.has(key)) continue;
    info.push({ severity: "info", area: "reference-target-skipped", object: name, message: `${name} is a documented lookup target the baseline does not model; nothing references it` });
  }
  const seenInfo = new Set<string>();
  const uniqueInfo = info.filter((d) => {
    const key = d.object!.toLowerCase();
    if (seenInfo.has(key)) return false;
    seenInfo.add(key);
    return true;
  });
  uniqueInfo.sort((a, b) => (a.object! < b.object! ? -1 : a.object! > b.object! ? 1 : 0));

  return { schema: new OrgSchemaImpl(objects, globalValueSets, standardValueSets, labels), warnings: sink.warnings, diagnostics: sink.diagnostics, info: uniqueInfo, customMetadata };
}
