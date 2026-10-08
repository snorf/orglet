/**
 * TYPEOF restrictions from the SOQL and SOSL Reference ("TYPEOF" considerations). Some invalid
 * forms already fail in the parser with a generic message and some parse; both end as
 * MALFORMED_QUERY whose message names the documented restriction (POLY-06).
 */
import type { Query } from "@jetstreamapp/soql-parser-js";
import { malformed } from "./errors.js";

export const TYPEOF_RESTRICTIONS = {
  selectOnly: "TYPEOF is only allowed in the SELECT clause of a query",
  noObjects: "TYPEOF isn't allowed in queries that don't return objects, such as COUNT()",
  nested: "TYPEOF expressions can't be nested",
  semiJoin: "TYPEOF isn't allowed in the SELECT clause of a semi-join query",
  functions: "TYPEOF can't be used in queries with functions in the SELECT clause",
  grouping: "TYPEOF can't be used in queries with GROUP BY, GROUP BY ROLLUP, GROUP BY CUBE, and HAVING",
} as const;

export const alsoSelected = (relationship: string): string =>
  `TYPEOF ${relationship}: a relationship field used in TYPEOF can't also be referenced in the field list of the SELECT statement`;

export const notPolymorphic = (relationship: string): string => `TYPEOF ${relationship}: TYPEOF can only be used with a polymorphic relationship field`;

export const notATarget = (relationship: string, objectType: string, relSeg: string): string =>
  `TYPEOF ${relationship}: ${objectType} is not a type of the polymorphic relationship ${relSeg}`;

/**
 * The parser rejects some invalid TYPEOF forms with a generic message. Called only when parsing
 * failed and the text mentions TYPEOF; a text heuristic decides which documented restriction was
 * hit, or returns undefined so the caller keeps the parser's own message.
 */
export function diagnoseTypeofParseError(soql: string): string | undefined {
  const text = soql.replace(/'(?:\\.|[^'\\])*'/g, "''");
  const m = /\bTYPEOF\b/i.exec(text);
  if (!m) return undefined;
  // Keywords inside earlier parenthesised subqueries do not decide which clause TYPEOF sits in.
  let before = text.slice(0, m.index);
  while (/\([^()]*\)/.test(before)) before = before.replace(/\([^()]*\)/g, " ");
  const clauses = [...before.matchAll(/\b(SELECT|WHERE|GROUP\s+BY|HAVING|ORDER\s+BY)\b/gi)];
  const clause = clauses[clauses.length - 1]?.[0].toUpperCase().replace(/\s+/g, " ");
  if (clause === "GROUP BY" || clause === "HAVING") return TYPEOF_RESTRICTIONS.grouping;
  if (clause === "WHERE" || clause === "ORDER BY") return TYPEOF_RESTRICTIONS.selectOnly;
  const rest = text.slice(m.index + m[0].length);
  const end = /\bEND\b/i.exec(rest);
  const span = end ? rest.slice(0, end.index) : rest;
  if (/\bTYPEOF\b/i.test(span)) return TYPEOF_RESTRICTIONS.nested;
  if (/\b(THEN|ELSE)\b[\s\S]*\(/i.test(span)) return TYPEOF_RESTRICTIONS.functions;
  return undefined;
}

/**
 * Rejects the TYPEOF forms that parse but are invalid. Runs right after parsing, before the
 * COUNT()/aggregate decision, so those paths never see a TYPEOF field.
 */
export function assertTypeofAllowed(query: Query): void {
  const fields = query.fields ?? [];
  const typeofs = fields.filter((f) => f.type === "FieldTypeof");
  if (typeofs.length === 0) return;
  if (fields.some((f) => f.type === "FieldFunctionExpression" && f.functionName.toUpperCase() === "COUNT" && f.parameters.length === 0)) throw malformed(TYPEOF_RESTRICTIONS.noObjects);
  if (query.groupBy !== undefined || query.having !== undefined) throw malformed(TYPEOF_RESTRICTIONS.grouping);
  if (fields.some((f) => f.type === "FieldFunctionExpression")) throw malformed(TYPEOF_RESTRICTIONS.functions);
  for (const t of typeofs) {
    const rel = t.field.toLowerCase();
    for (const f of fields) {
      if (f.type !== "FieldRelationship") continue;
      const path = f.relationships.join(".").toLowerCase();
      if (path === rel || path.startsWith(`${rel}.`)) throw malformed(alsoSelected(t.field));
    }
  }
}
