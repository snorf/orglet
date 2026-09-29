/**
 * Maps OrgSchema objects and fields to Postgres tables and columns.
 * Every object is a table named after its lower-cased API name in the org schema;
 * every stored field is a column named after its lower-cased API name.
 */
import { createHash } from "node:crypto";
import type { FieldDef, SObjectDef } from "@orglet/metadata";

export const DEFAULT_ORG_SCHEMA = "org";
export const INTERNAL_SCHEMA = "_orglet";

/** Postgres identifiers are limited to 63 bytes; longer names keep a prefix plus a stable hash. */
export function identifier(name: string): string {
  if (name.length <= 63) return name;
  const hash = createHash("sha1").update(name).digest("hex").slice(0, 10);
  return `${name.slice(0, 52)}_${hash}`;
}

export function quote(ident: string): string {
  return `"${ident.replace(/"/g, '""')}"`;
}

export function tableName(obj: SObjectDef | string): string {
  return identifier((typeof obj === "string" ? obj : obj.name).toLowerCase());
}

export function columnName(field: FieldDef | string): string {
  return identifier((typeof field === "string" ? field : field.name).toLowerCase());
}

export function sequenceName(obj: SObjectDef, field: FieldDef): string {
  return identifier(`seq_${obj.name.toLowerCase()}_${field.name.toLowerCase()}`);
}

export interface ColumnSpec {
  name: string;
  /** SQL type as written in DDL, e.g. `varchar(80)`, `numeric(18,2)`. */
  sqlType: string;
  notNull: boolean;
  default?: string;
}

/** True when the field has no column: formulas and compound fields are computed at read time. */
export function isVirtual(field: FieldDef): boolean {
  return field.formula !== undefined || field.type === "Address" || field.type === "Name" || field.type === "Location";
}

export function sqlTypeFor(field: FieldDef): string {
  switch (field.type) {
    case "Id":
    case "Lookup":
    case "MasterDetail":
      return "char(18)";
    case "Checkbox":
      return "boolean";
    case "Number":
    case "Currency":
    case "Percent": {
      const precision = field.precision ?? 18;
      const scale = field.scale ?? 0;
      return `numeric(${precision},${scale})`;
    }
    case "Date":
      return "date";
    case "DateTime":
      return "timestamptz";
    case "Time":
      return "time";
    case "LongTextArea":
    case "Html":
      return "text";
    case "MultiselectPicklist":
      return `varchar(${field.length ?? 4099})`;
    case "AutoNumber":
      return "varchar(30)";
    case "TextArea":
      return `varchar(${field.length ?? 255})`;
    case "Text":
    case "Email":
    case "Phone":
    case "Url":
    case "Picklist":
    case "EncryptedText":
      return `varchar(${field.length ?? 255})`;
    case "Address":
    case "Name":
    case "Location":
      throw new Error(`${field.name}: compound fields have no column`);
  }
}

const SYSTEM_NOT_NULL = new Set(["Id", "IsDeleted", "CreatedDate", "CreatedById", "LastModifiedDate", "LastModifiedById", "SystemModstamp"]);

export function columnFor(field: FieldDef): ColumnSpec | undefined {
  if (isVirtual(field)) return undefined;
  const spec: ColumnSpec = {
    name: columnName(field),
    sqlType: sqlTypeFor(field),
    notNull: SYSTEM_NOT_NULL.has(field.name) || field.type === "MasterDetail",
  };
  if (field.type === "Checkbox") {
    spec.notNull = true;
    spec.default = "false";
  }
  return spec;
}
