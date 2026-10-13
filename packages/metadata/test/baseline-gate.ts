/**
 * The v1-vs-v2 diff gate (MIGR-03, D-16..D-18): compares the frozen v1.0 baseline with a regenerated one at the
 * SQL-type level and reports every v1.0 field that disappears or narrows without a diff-allowlist entry, plus every
 * allowlist entry that no longer suppresses anything. Test-only helper: it lives under packages/metadata/test rather
 * than scripts/ because it needs `@orglet/schema` (vitest alias) so that "narrows" is migrate()'s own `isWidening` on
 * `sqlTypeFor` output and the gate can never disagree with what migrate() would refuse. Flag and label changes are
 * invisible here by design (D-17); virtual fields (compound, formula) have no column and are compared by presence only.
 */
import { buildOrgSchema, type Baseline, type FieldDef } from "@orglet/metadata";
import { isVirtual, isWidening, sqlTypeFor } from "@orglet/schema";
import type { AllowlistEntry } from "../../../scripts/gen-baseline/sources.js";

const codeUnit = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const columnType = (field: FieldDef): string => (isVirtual(field) ? "virtual" : sqlTypeFor(field));

export function diffGate(v1: Baseline, v2: Baseline, allowlist: readonly AllowlistEntry[]): string[] {
  const before = buildOrgSchema(v1).schema.objects;
  const after = buildOrgSchema(v2).schema.objects;
  const used = new Set<AllowlistEntry>();
  const allowed = (object: string, field: string, kind: AllowlistEntry["kind"]): boolean => {
    const entry = allowlist.find((e) => e.object === object && e.field === field && e.kind === kind);
    if (!entry) return false;
    used.add(entry);
    return true;
  };

  const messages: string[] = [];
  for (const [key, o1] of before) {
    const o2 = after.get(key);
    if (!o2) {
      messages.push(`${o1.name} object removed`);
      continue;
    }
    if (o1.keyPrefix !== o2.keyPrefix) messages.push(`${o1.name} key prefix changed: ${String(o1.keyPrefix)} -> ${String(o2.keyPrefix)}`);
    const fields2 = new Map(o2.fields.map((f) => [f.name, f]));
    for (const f1 of o1.fields) {
      const where = `${o1.name}.${f1.name}`;
      const f2 = fields2.get(f1.name);
      if (!f2) {
        if (!allowed(o1.name, f1.name, "removed")) messages.push(`${where} removed`);
        continue;
      }
      const a = columnType(f1);
      const b = columnType(f2);
      // A column on one side and none on the other is a type change too; isWidening only compares real column types.
      const widening = a === b || (a !== "virtual" && b !== "virtual" && isWidening(a, b));
      if (!widening && !allowed(o1.name, f1.name, "narrowed")) messages.push(`${where} narrowed: ${a} -> ${b}`);
    }
  }
  for (const entry of allowlist) if (!used.has(entry)) messages.push(`allowlist entry ${entry.object}.${entry.field} (${entry.kind}) is not needed`);
  return messages.sort(codeUnit);
}
