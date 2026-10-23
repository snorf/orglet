/**
 * Generates DDL for an OrgSchema. Pure: returns SQL strings, executes nothing.
 */
import { hasSoftDelete, type FieldDef, type OrgSchema, type SObjectDef } from "@orglet/metadata";
import { columnFor, columnName, identifier, quote, sequenceName, tableName, type ColumnSpec } from "./columns.js";

export interface TablePlan {
  object: SObjectDef;
  table: string;
  columns: ColumnSpec[];
  foreignKeys: ForeignKeySpec[];
  indexes: IndexSpec[];
  sequences: string[];
}

export interface ForeignKeySpec {
  name: string;
  column: string;
  referencesTable: string;
}

export interface IndexSpec {
  name: string;
  unique: boolean;
  /** SQL expression list, e.g. `"accountid"` or `lower("code__c")`. */
  expression: string;
  /** Partial-index predicate: rows it excludes (soft-deleted ones) do not take part in uniqueness. */
  where?: string;
}

function isTextType(field: FieldDef): boolean {
  return ["Text", "Email", "Phone", "Url", "Picklist", "TextArea", "EncryptedText", "AutoNumber"].includes(field.type);
}

export function planTable(schema: OrgSchema, obj: SObjectDef): TablePlan {
  const table = tableName(obj);
  const columns: ColumnSpec[] = [];
  const foreignKeys: ForeignKeySpec[] = [];
  const indexes: IndexSpec[] = [];
  const sequences: string[] = [];

  for (const field of obj.fields) {
    const column = columnFor(field);
    if (!column) continue;
    columns.push(column);
    const col = column.name;

    // MetadataRelationship never gets an FK: seed-time resolution, cycles allowed (D-07).
    if ((field.type === "Lookup" || field.type === "MasterDetail") && field.referenceTo?.length === 1) {
      const target = schema.getObject(field.referenceTo[0] ?? "");
      if (target) {
        foreignKeys.push({ name: identifier(`fk_${table}_${col}`), column: col, referencesTable: tableName(target) });
      }
    }
    // Unique first: a unique Lookup (custom-setting SetupOwnerId, D-18) needs a real unique index so a duplicate fails as 23505 -> DUPLICATE_VALUE; no baseline lookup is unique, so existing indexes are unchanged.
    const reference = field.type === "Lookup" || field.type === "MasterDetail" || field.type === "MetadataRelationship";
    if (field.unique) {
      const expr = isTextType(field) && !field.caseSensitive ? `lower(${quote(col)})` : quote(col);
      // A deleted custom-setting row is gone for good in Salesforce (no recycle bin), so a soft-deleted SetupOwnerId must not block a new default row.
      indexes.push({ name: identifier(`ux_${table}_${col}`), unique: true, expression: expr, ...(reference && hasSoftDelete(obj) ? { where: '"isdeleted" = false' } : {}) });
    } else if (reference || field.externalId) {
      indexes.push({ name: identifier(`ix_${table}_${col}`), unique: false, expression: quote(col) });
    }
    if (field.type === "AutoNumber") sequences.push(sequenceName(obj, field));
  }
  return { object: obj, table, columns, foreignKeys, indexes, sequences };
}

export function planSchema(schema: OrgSchema): TablePlan[] {
  return [...schema.objects.values()]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((obj) => planTable(schema, obj));
}

export function columnDdl(c: ColumnSpec): string {
  let sql = `${quote(c.name)} ${c.sqlType}`;
  if (c.notNull) sql += " NOT NULL";
  if (c.default !== undefined) sql += ` DEFAULT ${c.default}`;
  return sql;
}

export function createTableSql(orgSchema: string, plan: TablePlan): string {
  const cols = plan.columns.map((c) => (c.name === columnName("Id") ? `${columnDdl(c)} PRIMARY KEY` : columnDdl(c)));
  return `CREATE TABLE ${quote(orgSchema)}.${quote(plan.table)} (\n  ${cols.join(",\n  ")}\n)`;
}

export function addColumnSql(orgSchema: string, table: string, c: ColumnSpec): string {
  return `ALTER TABLE ${quote(orgSchema)}.${quote(table)} ADD COLUMN ${columnDdl(c)}`;
}

export function alterColumnTypeSql(orgSchema: string, table: string, c: ColumnSpec): string {
  return `ALTER TABLE ${quote(orgSchema)}.${quote(table)} ALTER COLUMN ${quote(c.name)} TYPE ${c.sqlType}`;
}

export function foreignKeySql(orgSchema: string, table: string, fk: ForeignKeySpec): string {
  return (
    `ALTER TABLE ${quote(orgSchema)}.${quote(table)} ADD CONSTRAINT ${quote(fk.name)} ` +
    `FOREIGN KEY (${quote(fk.column)}) REFERENCES ${quote(orgSchema)}.${quote(fk.referencesTable)} (${quote("id")}) ` +
    `DEFERRABLE INITIALLY DEFERRED`
  );
}

export function indexSql(orgSchema: string, table: string, ix: IndexSpec): string {
  return `CREATE ${ix.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${quote(ix.name)} ON ${quote(orgSchema)}.${quote(table)} (${ix.expression})${ix.where ? ` WHERE ${ix.where}` : ""}`;
}

export function sequenceSql(orgSchema: string, name: string): string {
  return `CREATE SEQUENCE IF NOT EXISTS ${quote(orgSchema)}.${quote(name)} START WITH 1`;
}
