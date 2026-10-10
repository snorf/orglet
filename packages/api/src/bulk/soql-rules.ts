/**
 * Bulk API 2.0 query jobs accept a narrower SOQL than REST: the guide lists TYPEOF, GROUP BY,
 * OFFSET, aggregate functions, compound address/geolocation fields, FIELDS() and parent-to-child
 * relationship queries as unsupported. The check walks the parser's AST beside the Bulk code so
 * REST SOQL (the @orglet/soql compiler) can never drift when these rules change. Salesforce
 * documents the list but not the error shape, so the message wording is orglet's own.
 */
import { parseQuery, type FieldType, type Query } from "@jetstreamapp/soql-parser-js";
import type { OrgSchema } from "@orglet/metadata";
import { malformed } from "@orglet/soql";

export type BulkRuleSchema = Pick<OrgSchema, "getField" | "resolveRelationship">;
export interface BulkQueryViolation {
  construct: string;
  message: string;
}

const AGGREGATES: ReadonlySet<string> = new Set(["COUNT", "COUNT_DISTINCT", "SUM", "AVG", "MIN", "MAX"]);
const COMPOUND_TYPES: ReadonlySet<string> = new Set(["Address", "Location"]);

export function parseBulkQuery(soql: string): Query {
  try {
    return parseQuery(soql);
  } catch (err) {
    throw malformed(err instanceof Error ? err.message : String(err));
  }
}

const violation = (construct: string): BulkQueryViolation => ({
  construct,
  message: `Bulk API 2.0 query jobs do not support ${construct}`,
});

/** Walks relationship hops from the root object; false when any hop is unknown. The parser already strips a FROM alias into `objectPrefix`. */
function resolveCompound(
  query: Query,
  schema: BulkRuleSchema,
  relationships: string[],
  field: string,
): boolean {
  if (query.sObject === undefined) return false;
  let current = query.sObject;
  for (const rel of relationships) {
    const next = schema.resolveRelationship(current, rel)?.target.name;
    if (next === undefined) return false;
    current = next;
  }
  const def = schema.getField(current, field);
  return def !== undefined && COMPOUND_TYPES.has(def.type);
}

function fieldViolation(f: FieldType, query: Query, schema: BulkRuleSchema): BulkQueryViolation | undefined {
  switch (f.type) {
    case "FieldTypeof":
      return violation("TYPEOF");
    case "FieldSubquery":
      return violation("parent-to-child relationship subqueries");
    case "FieldFunctionExpression": {
      const name = f.functionName.toUpperCase();
      if (name === "FIELDS") return violation("FIELDS()");
      return AGGREGATES.has(name) ? violation(`aggregate function ${name}`) : undefined;
    }
    case "Field":
      return resolveCompound(query, schema, [], f.field) ? violation(`compound field ${"rawValue" in f ? f.rawValue : f.field}`) : undefined;
    case "FieldRelationship":
      return resolveCompound(query, schema, f.relationships, f.field)
        ? violation(`compound field ${f.rawValue ?? [...f.relationships, f.field].join(".")}`)
        : undefined;
    default:
      return undefined;
  }
}

export function bulkQueryViolation(query: Query, schema: BulkRuleSchema): BulkQueryViolation | undefined {
  for (const f of query.fields ?? []) {
    const v = fieldViolation(f, query, schema);
    if (v) return v;
  }
  if (query.groupBy !== undefined) return violation("GROUP BY");
  if (query.offset !== undefined) return violation("OFFSET");
  return undefined;
}
