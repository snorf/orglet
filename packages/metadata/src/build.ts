/**
 * Merges the standard-object baseline with an SFDX source project into an OrgSchema.
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type {
  FieldDef,
  FieldType,
  GlobalValueSetDef,
  PicklistDef,
  PicklistValue,
  SObjectDef,
  StandardFieldJson,
  StandardObjectJson,
  StandardValueSetDef,
} from "./types.js";
import type { SourceField, SourceObject, SourceProject } from "./sfdx.js";
import { OrgSchemaImpl } from "./schema.js";

const STANDARD_DIR = fileURLToPath(new URL("../standard/", import.meta.url));

export interface Baseline {
  objects: StandardObjectJson[];
  standardValueSets: Map<string, StandardValueSetDef>;
}

export interface BuildResult {
  schema: OrgSchemaImpl;
  /** Things in the project that were skipped or partially loaded, prefixed `UNSUPPORTED:<area>`. */
  warnings: string[];
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
  return { objects, standardValueSets };
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

function systemFields(hasOwner: boolean): { head: FieldDef[]; tail: FieldDef[] } {
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
    owner.referenceTo = ["User", "Group"];
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
  const sys = systemFields(j.hasOwner);
  return {
    name: j.name,
    label: j.label,
    labelPlural: j.labelPlural,
    keyPrefix: j.keyPrefix,
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

function recordTypeField(): FieldDef {
  const f = baseField("RecordTypeId", "Record Type ID", "Lookup", false);
  f.referenceTo = ["RecordType"];
  f.relationshipName = "RecordType";
  f.defaultedOnCreate = true;
  return f;
}

function fromSourceObject(obj: SourceObject, keyPrefix: string, sets: ValueSets): SObjectDef {
  const hasOwner = !obj.fields.some((f) => f.type === "MasterDetail");
  const sys = systemFields(hasOwner);
  const custom = obj.fields.map((f) => fromSourceField(f, obj.name, sets));
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
    ...(obj.sharingModel !== undefined ? { sharingModel: obj.sharingModel } : {}),
    fields: [...sys.head, nameFieldFor(obj), ...sys.tail, ...custom],
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
 */
function customKeyPrefix(index: number): string {
  const alphabet = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
  const hi = alphabet[Math.floor(index / alphabet.length)];
  const lo = alphabet[index % alphabet.length];
  if (hi === undefined || lo === undefined) throw new Error("too many custom objects");
  return `a${hi}${lo}`;
}

export function buildOrgSchema(baseline: Baseline, project?: SourceProject): BuildResult {
  const warnings: string[] = [...(project?.warnings ?? [])];
  const standardValueSets = new Map(baseline.standardValueSets);
  for (const s of project?.standardValueSets ?? []) standardValueSets.set(s.name, s);
  const globalValueSets = new Map<string, GlobalValueSetDef>();
  for (const g of project?.globalValueSets ?? []) globalValueSets.set(g.name, g);
  const sets: ValueSets = { global: globalValueSets, standard: standardValueSets };

  const objects = new Map<string, SObjectDef>();
  for (const j of baseline.objects) objects.set(j.name.toLowerCase(), fromStandardObject(j, standardValueSets));

  const sourceObjects = project?.objects ?? [];
  const customObjects = sourceObjects.filter((o) => isCustomObjectName(o.name)).sort((a, b) => a.name.localeCompare(b.name));
  customObjects.forEach((o, i) => {
    objects.set(o.name.toLowerCase(), fromSourceObject(o, customKeyPrefix(i), sets));
  });

  for (const o of sourceObjects) {
    if (isCustomObjectName(o.name)) continue;
    const target = objects.get(o.name.toLowerCase());
    if (!target) {
      const area = /__(e|mdt|x|b|share|history|feed)$/i.test(o.name) ? "object-kind" : "standard-object";
      warnings.push(`UNSUPPORTED:${area} ${o.name} skipped`);
      continue;
    }
    if (o.label !== undefined) target.label = o.label;
    if (o.pluralLabel !== undefined) target.labelPlural = o.pluralLabel;
    if (o.sharingModel !== undefined) target.sharingModel = o.sharingModel;
    for (const sf of o.fields) {
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
        warnings.push(`UNSUPPORTED:standard-field ${o.name}.${sf.fullName} is not in the baseline and was skipped`);
        continue;
      }
      target.fields.push(fromSourceField(sf, o.name, sets));
    }
    target.validationRules.push(...o.validationRules);
    target.recordTypes.push(...o.recordTypes);
  }

  // Dangling references are allowed (e.g. Campaign not in phase 0) but reported once per target.
  const missing = new Set<string>();
  for (const obj of objects.values()) {
    for (const f of obj.fields) {
      for (const ref of f.referenceTo ?? []) {
        if (!objects.has(ref.toLowerCase())) missing.add(ref);
      }
    }
  }
  for (const m of [...missing].sort()) warnings.push(`UNSUPPORTED:reference-target ${m} is referenced but not defined; lookups to it are unchecked`);

  return { schema: new OrgSchemaImpl(objects, globalValueSets, standardValueSets), warnings };
}
