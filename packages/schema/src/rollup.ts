/**
 * SQL for roll-up summary fields: one correlated aggregate per roll-up over the child's live rows, used
 * by the engine to recompute affected parents and by migrate() to backfill a newly added column. Pure:
 * returns SQL and parameters, executes nothing. Values are always parameters, never inlined.
 *
 * Filter semantics (ROLL-03, decided at planning): text comparisons are case-insensitive; multi-token
 * equals/contains/startsWith OR their tokens; notEqual and notContain count NULL as "not equal"; a blank
 * value means NULL (text: NULL or ''); range operators never match NULL; field-to-field equals is `=`
 * (NULL never matches) and notEqual is IS DISTINCT FROM.
 */
import type { FieldDef, OrgSchema, RollupFilterDef, SObjectDef } from "@orglet/metadata";
import { columnName, quote, tableName } from "./columns.js";

export interface RollupStatement {
  sql: string;
  params: unknown[];
}

type Family = "numeric" | "date" | "timestamptz" | "boolean" | "text";

const RANGE: Record<string, string> = { lessThan: "<", greaterThan: ">", lessOrEqual: "<=", greaterOrEqual: ">=" };

/** `SELECT p."id" AS "Id", <aggregate> AS "<Field>", ... FROM <parent> p WHERE p."id" = ANY($1) AND p."isdeleted" = false`. */
export function rollupSelectSql(orgSchema: string, schema: OrgSchema, parent: SObjectDef, fields: FieldDef[], parentIds: string[]): RollupStatement {
  const params: unknown[] = [parentIds];
  const columns = fields.map((f) => `${aggregate(orgSchema, schema, f, params)} AS ${quote(f.name)}`);
  const sql = `SELECT p."id" AS "Id", ${columns.join(", ")} FROM ${table(orgSchema, parent)} p WHERE p."id" = ANY($1) AND p."isdeleted" = false`;
  return { sql, params };
}

/** `UPDATE <parent> AS p SET "<col>" = <aggregate>` over every row (D-10 backfill). */
export function rollupBackfillSql(orgSchema: string, schema: OrgSchema, parent: SObjectDef, field: FieldDef): RollupStatement {
  const params: unknown[] = [];
  const sql = `UPDATE ${table(orgSchema, parent)} AS p SET ${quote(columnName(field))} = ${aggregate(orgSchema, schema, field, params)}`;
  return { sql, params };
}

/** 0 for a plain field, 1 for a roll-up over a plain field, n + 1 for a roll-up over a depth-n roll-up. */
export function rollupDepth(schema: OrgSchema, field: FieldDef): number {
  const r = field.rollup;
  if (!r) return 0;
  const summarized = r.summarizedField === undefined ? undefined : schema.getField(r.childObject, r.summarizedField);
  return 1 + (summarized ? rollupDepth(schema, summarized) : 0);
}

function table(orgSchema: string, obj: SObjectDef): string {
  return `${quote(orgSchema)}.${quote(tableName(obj))}`;
}

function aggregate(orgSchema: string, schema: OrgSchema, field: FieldDef, params: unknown[]): string {
  const r = field.rollup;
  if (!r) throw new Error(`${field.name}: not a roll-up summary field`);
  const child = schema.getObject(r.childObject);
  if (!child) throw new Error(`${field.name}: child object ${r.childObject} is not defined`);
  const fk = schema.getField(child.name, r.foreignKey);
  if (!fk) throw new Error(`${field.name}: foreign key ${child.name}.${r.foreignKey} is not defined`);

  let fn: string;
  if (r.operation === "COUNT") {
    fn = "COUNT(*)";
  } else {
    const summarized = r.summarizedField === undefined ? undefined : schema.getField(child.name, r.summarizedField);
    if (!summarized) throw new Error(`${field.name}: summarized field ${child.name}.${r.summarizedField ?? "(missing)"} is not defined`);
    fn = `${r.operation}(c.${quote(columnName(summarized))})`;
  }

  const where = [`c.${quote(columnName(fk))} = p."id"`, `c."isdeleted" = false`];
  for (const filter of r.filters) {
    const f = schema.getField(child.name, filter.field);
    if (!f) throw new Error(`${field.name}: filter field ${child.name}.${filter.field} is not defined`);
    const other = filter.valueField === undefined ? undefined : schema.getField(child.name, filter.valueField);
    if (filter.valueField !== undefined && !other) throw new Error(`${field.name}: valueField ${child.name}.${filter.valueField} is not defined`);
    where.push(filterSql(field, f, filter, other, params));
  }

  const subquery = `(SELECT ${fn} FROM ${table(orgSchema, child)} c WHERE ${where.join(" AND ")})`;
  return r.operation === "SUM" ? `COALESCE(${subquery}, 0)` : subquery;
}

function filterSql(rollupField: FieldDef, childField: FieldDef, filter: RollupFilterDef, other: FieldDef | undefined, params: unknown[]): string {
  const family = familyOf(childField);
  const col = `c.${quote(columnName(childField))}`;
  const op = filter.operation;
  const unsupported = () => new Error(`${rollupField.name}: filter ${childField.name} ${op} is not supported by the SQL builder`);

  if (other) {
    const otherCol = `c.${quote(columnName(other))}`;
    const [l, r] = family === "text" ? [`lower(${col})`, `lower(${otherCol})`] : [col, otherCol];
    if (op === "equals") return `${l} = ${r}`;
    if (op === "notEqual") return `${l} IS DISTINCT FROM ${r}`;
    const range = RANGE[op];
    if (range !== undefined) return `${l} ${range} ${r}`;
    throw unsupported();
  }

  if (op === "equals" || op === "notEqual") {
    if (filter.values.length === 0) {
      if (op === "equals") return family === "text" ? `(${col} IS NULL OR ${col} = '')` : `${col} IS NULL`;
      return family === "text" ? `(${col} IS NOT NULL AND ${col} <> '')` : `${col} IS NOT NULL`;
    }
    let eq: string;
    if (family === "boolean") {
      params.push(filter.values[0] === "true");
      eq = `${col} = $${params.length}::boolean`;
    } else if (family === "text") {
      params.push(filter.values.map((v) => v.toLowerCase()));
      eq = `lower(${col}) = ANY($${params.length}::text[])`;
    } else {
      params.push(family === "numeric" ? filter.values.map(Number) : filter.values);
      eq = `${col} = ANY($${params.length}::${family}[])`;
    }
    return op === "equals" ? eq : `(${col} IS NULL OR NOT (${eq}))`;
  }

  const range = RANGE[op];
  if (range !== undefined) {
    const value = filter.values[0];
    if (value === undefined) throw unsupported();
    params.push(family === "numeric" ? Number(value) : value);
    return `${col} ${range} $${params.length}::${family}`;
  }

  if (op === "contains" || op === "notContain" || op === "startsWith") {
    if (filter.values.length === 0) throw unsupported();
    params.push(filter.values.map((v) => (op === "startsWith" ? `${likeEscape(v)}%` : `%${likeEscape(v)}%`)));
    const like = `${col} ILIKE ANY($${params.length}::text[])`;
    return op === "notContain" ? `(${col} IS NULL OR NOT (${like}))` : like;
  }

  throw unsupported();
}

/** Postgres LIKE treats `%` and `_` as wildcards and backslash as the escape character (on pglite too). */
function likeEscape(v: string): string {
  return v.replace(/[\\%_]/g, (m) => `\\${m}`);
}

function familyOf(f: FieldDef): Family {
  switch (f.type) {
    case "Number":
    case "Currency":
    case "Percent":
      return "numeric";
    case "Date":
      return "date";
    case "DateTime":
      return "timestamptz";
    case "Checkbox":
      return "boolean";
    default:
      return "text";
  }
}
