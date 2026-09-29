/**
 * Reads an SFDX project directory in source format and returns the raw
 * customisations it contains. No merging with the standard baseline happens
 * here; see build.ts.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";
import { parseMetadataXml, str, bool, num, list, child, type XmlNode } from "./xml.js";
import type {
  DeleteConstraint,
  FieldType,
  FormulaBlankTreatment,
  GlobalValueSetDef,
  PicklistValue,
  RecordTypeDef,
  StandardValueSetDef,
  ValidationRuleDef,
} from "./types.js";

/** A field as declared in <Obj>/fields/<Field>.field-meta.xml. Standard-field overrides have only fullName. */
export interface SourceField {
  fullName: string;
  label?: string;
  type?: FieldType;
  length?: number;
  precision?: number;
  scale?: number;
  required?: boolean;
  unique?: boolean;
  externalId?: boolean;
  caseSensitive?: boolean;
  referenceTo?: string;
  relationshipName?: string;
  relationshipLabel?: string;
  deleteConstraint?: DeleteConstraint;
  relationshipOrder?: number;
  reparentableMasterDetail?: boolean;
  formula?: string;
  formulaTreatBlanksAs?: FormulaBlankTreatment;
  defaultValue?: string;
  displayFormat?: string;
  visibleLines?: number;
  inlineHelpText?: string;
  description?: string;
  valueSet?: {
    restricted?: boolean;
    valueSetName?: string;
    sorted?: boolean;
    values?: PicklistValue[];
  };
}

export interface SourceObject {
  name: string;
  label?: string;
  pluralLabel?: string;
  nameField?: { label?: string; type?: "Text" | "AutoNumber"; displayFormat?: string };
  sharingModel?: string;
  description?: string;
  fields: SourceField[];
  validationRules: ValidationRuleDef[];
  recordTypes: RecordTypeDef[];
}

export interface SourceProject {
  rootDir: string;
  packageDirectories: string[];
  objects: SourceObject[];
  globalValueSets: GlobalValueSetDef[];
  standardValueSets: StandardValueSetDef[];
  /** `UNSUPPORTED:<area>` notes for metadata that was skipped rather than loaded. */
  warnings: string[];
}

const CUSTOM_FIELD_TYPES = new Set<string>([
  "AutoNumber", "Checkbox", "Currency", "Date", "DateTime", "Time", "Email", "Phone", "Url",
  "Number", "Percent", "Picklist", "MultiselectPicklist", "Text", "TextArea", "LongTextArea",
  "Html", "EncryptedText", "Lookup", "MasterDetail", "Location", "Summary", "ExternalLookup",
  "IndirectLookup", "Hierarchy", "MetadataRelationship",
]);

export class UnsupportedMetadataError extends Error {
  constructor(
    readonly area: string,
    message: string,
  ) {
    super(`UNSUPPORTED:${area} ${message}`);
    this.name = "UnsupportedMetadataError";
  }
}

async function isDir(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

async function readPackageDirectories(rootDir: string): Promise<string[]> {
  try {
    const raw = await readFile(join(rootDir, "sfdx-project.json"), "utf8");
    const json = JSON.parse(raw) as { packageDirectories?: { path: string }[] };
    const dirs = (json.packageDirectories ?? []).map((d) => join(rootDir, d.path));
    if (dirs.length > 0) return dirs;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }
  return [rootDir];
}

/** Recursively find directories with the given basename (e.g. `objects`), skipping node_modules and dot-dirs. */
async function findDirs(root: string, name: string, out: string[] = []): Promise<string[]> {
  if (!(await isDir(root))) return out;
  const entries = await readdir(root, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isDirectory() || e.name.startsWith(".") || e.name === "node_modules") continue;
    const p = join(root, e.name);
    if (e.name === name) out.push(p);
    else await findDirs(p, name, out);
  }
  return out;
}

async function filesWithSuffix(dir: string, suffix: string): Promise<string[]> {
  if (!(await isDir(dir))) return [];
  const entries = await readdir(dir);
  return entries.filter((f) => f.endsWith(suffix)).sort().map((f) => join(dir, f));
}

function parsePicklistValues(nodes: XmlNode[]): PicklistValue[] {
  return nodes.map((v) => {
    const value = str(v, "fullName") ?? "";
    const pv: PicklistValue = {
      value,
      label: str(v, "label") ?? value,
      default: bool(v, "default") ?? false,
      active: bool(v, "isActive") ?? true,
    };
    const probability = num(v, "probability");
    if (probability !== undefined) pv.probability = probability;
    const fc = str(v, "forecastCategory");
    if (fc !== undefined) pv.forecastCategory = fc;
    const closed = bool(v, "closed");
    if (closed !== undefined) pv.closed = closed;
    const won = bool(v, "won");
    if (won !== undefined) pv.won = won;
    const converted = bool(v, "converted");
    if (converted !== undefined) pv.isConverted = converted;
    return pv;
  });
}

/** Parse one field; unsupported field types are reported in `warnings` and skipped (undefined). */
function parseField(node: XmlNode, file: string, warnings: string[]): SourceField | undefined {
  const fullName = str(node, "fullName");
  if (!fullName) throw new Error(`${file}: <fullName> missing`);
  const f: SourceField = { fullName };
  const type = str(node, "type");
  if (type !== undefined) {
    if (!CUSTOM_FIELD_TYPES.has(type)) throw new Error(`${file}: unknown field type ${type}`);
    if (type === "Summary" || type === "ExternalLookup" || type === "IndirectLookup" || type === "MetadataRelationship") {
      warnings.push(`UNSUPPORTED:field-type ${file}: field type ${type} is not supported yet; field skipped`);
      return undefined;
    }
    // Hierarchy is a self-referencing lookup (Account.ParentId, User.ManagerId).
    f.type = type === "Hierarchy" ? "Lookup" : (type as FieldType);
  }
  const set = <K extends keyof SourceField>(key: K, value: SourceField[K] | undefined) => {
    if (value !== undefined) f[key] = value;
  };
  set("label", str(node, "label"));
  set("length", num(node, "length"));
  set("precision", num(node, "precision"));
  set("scale", num(node, "scale"));
  set("required", bool(node, "required"));
  set("unique", bool(node, "unique"));
  set("externalId", bool(node, "externalId"));
  set("caseSensitive", bool(node, "caseSensitive"));
  const refs: unknown = node["referenceTo"];
  const firstRef: unknown = Array.isArray(refs) ? refs[0] : refs;
  if (typeof firstRef === "string") set("referenceTo", firstRef);
  set("relationshipName", str(node, "relationshipName"));
  set("relationshipLabel", str(node, "relationshipLabel"));
  set("deleteConstraint", str(node, "deleteConstraint") as DeleteConstraint | undefined);
  set("relationshipOrder", num(node, "relationshipOrder"));
  set("reparentableMasterDetail", bool(node, "reparentableMasterDetail"));
  set("formula", str(node, "formula"));
  set("formulaTreatBlanksAs", str(node, "formulaTreatBlanksAs") as FormulaBlankTreatment | undefined);
  set("defaultValue", str(node, "defaultValue"));
  set("displayFormat", str(node, "displayFormat"));
  set("visibleLines", num(node, "visibleLines"));
  set("inlineHelpText", str(node, "inlineHelpText"));
  set("description", str(node, "description"));

  const valueSet = child(node, "valueSet");
  if (valueSet) {
    const vs: NonNullable<SourceField["valueSet"]> = {};
    const restricted = bool(valueSet, "restricted");
    if (restricted !== undefined) vs.restricted = restricted;
    const valueSetName = str(valueSet, "valueSetName");
    if (valueSetName !== undefined) vs.valueSetName = valueSetName;
    const def = child(valueSet, "valueSetDefinition");
    if (def) {
      const sorted = bool(def, "sorted");
      if (sorted !== undefined) vs.sorted = sorted;
      vs.values = parsePicklistValues(list(def, "value"));
    }
    f.valueSet = vs;
  }
  return f;
}

function parseValidationRule(node: XmlNode, file: string): ValidationRuleDef {
  const name = str(node, "fullName");
  const formula = str(node, "errorConditionFormula");
  const message = str(node, "errorMessage");
  if (!name || formula === undefined || message === undefined) {
    throw new Error(`${file}: validation rule needs fullName, errorConditionFormula and errorMessage`);
  }
  const rule: ValidationRuleDef = {
    name,
    active: bool(node, "active") ?? true,
    errorConditionFormula: formula,
    errorMessage: message,
  };
  const field = str(node, "errorDisplayField");
  if (field) rule.errorDisplayField = field;
  const description = str(node, "description");
  if (description) rule.description = description;
  return rule;
}

function parseRecordType(node: XmlNode, file: string): RecordTypeDef {
  const name = str(node, "fullName");
  if (!name) throw new Error(`${file}: record type needs fullName`);
  const rt: RecordTypeDef = {
    name,
    label: str(node, "label") ?? name,
    active: bool(node, "active") ?? true,
    picklistValues: list(node, "picklistValues").map((p) => ({
      picklist: str(p, "picklist") ?? "",
      values: list(p, "values").map((v) => ({
        value: str(v, "fullName") ?? "",
        default: bool(v, "default") ?? false,
      })),
    })),
  };
  const description = str(node, "description");
  if (description) rt.description = description;
  return rt;
}

async function readObjectDir(dir: string, warnings: string[]): Promise<SourceObject> {
  const name = basename(dir);
  const obj: SourceObject = { name, fields: [], validationRules: [], recordTypes: [] };

  const objFile = join(dir, `${name}.object-meta.xml`);
  try {
    const node = parseMetadataXml(await readFile(objFile, "utf8"), "CustomObject");
    const label = str(node, "label");
    if (label !== undefined) obj.label = label;
    const plural = str(node, "pluralLabel");
    if (plural !== undefined) obj.pluralLabel = plural;
    const sharing = str(node, "sharingModel");
    if (sharing !== undefined) obj.sharingModel = sharing;
    const description = str(node, "description");
    if (description !== undefined) obj.description = description;
    const nf = child(node, "nameField");
    if (nf) {
      obj.nameField = {};
      const nfLabel = str(nf, "label");
      if (nfLabel !== undefined) obj.nameField.label = nfLabel;
      const nfType = str(nf, "type");
      if (nfType === "Text" || nfType === "AutoNumber") obj.nameField.type = nfType;
      const fmt = str(nf, "displayFormat");
      if (fmt !== undefined) obj.nameField.displayFormat = fmt;
    }
    // Metadata-format style: fields/validationRules/recordTypes inlined in the object file.
    for (const f of list(node, "fields")) {
      const parsed = parseField(f, objFile, warnings);
      if (parsed) obj.fields.push(parsed);
    }
    for (const r of list(node, "validationRules")) obj.validationRules.push(parseValidationRule(r, objFile));
    for (const r of list(node, "recordTypes")) obj.recordTypes.push(parseRecordType(r, objFile));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  for (const file of await filesWithSuffix(join(dir, "fields"), ".field-meta.xml")) {
    const parsed = parseField(parseMetadataXml(await readFile(file, "utf8"), "CustomField"), file, warnings);
    if (parsed) obj.fields.push(parsed);
  }
  for (const file of await filesWithSuffix(join(dir, "validationRules"), ".validationRule-meta.xml")) {
    obj.validationRules.push(parseValidationRule(parseMetadataXml(await readFile(file, "utf8"), "ValidationRule"), file));
  }
  for (const file of await filesWithSuffix(join(dir, "recordTypes"), ".recordType-meta.xml")) {
    obj.recordTypes.push(parseRecordType(parseMetadataXml(await readFile(file, "utf8"), "RecordType"), file));
  }
  return obj;
}

async function readGlobalValueSet(file: string): Promise<GlobalValueSetDef> {
  const node = parseMetadataXml(await readFile(file, "utf8"), "GlobalValueSet");
  const name = basename(file).replace(/\.globalValueSet-meta\.xml$/, "");
  return {
    name,
    label: str(node, "masterLabel") ?? name,
    sorted: bool(node, "sorted") ?? false,
    values: parsePicklistValues(list(node, "customValue")),
  };
}

async function readStandardValueSet(file: string): Promise<StandardValueSetDef> {
  const node = parseMetadataXml(await readFile(file, "utf8"), "StandardValueSet");
  const name = basename(file).replace(/\.standardValueSet-meta\.xml$/, "");
  return {
    name,
    sorted: bool(node, "sorted") ?? false,
    values: parsePicklistValues(list(node, "standardValue")),
  };
}

export async function readSourceProject(rootDir: string): Promise<SourceProject> {
  const packageDirectories = await readPackageDirectories(rootDir);
  const project: SourceProject = { rootDir, packageDirectories, objects: [], globalValueSets: [], standardValueSets: [], warnings: [] };

  for (const pkgDir of packageDirectories) {
    for (const objectsDir of await findDirs(pkgDir, "objects")) {
      const entries = await readdir(objectsDir, { withFileTypes: true });
      for (const e of entries.filter((e) => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
        project.objects.push(await readObjectDir(join(objectsDir, e.name), project.warnings));
      }
    }
    for (const dir of await findDirs(pkgDir, "globalValueSets")) {
      for (const file of await filesWithSuffix(dir, ".globalValueSet-meta.xml")) {
        project.globalValueSets.push(await readGlobalValueSet(file));
      }
    }
    for (const dir of await findDirs(pkgDir, "standardValueSets")) {
      for (const file of await filesWithSuffix(dir, ".standardValueSet-meta.xml")) {
        project.standardValueSets.push(await readStandardValueSet(file));
      }
    }
  }
  return project;
}
