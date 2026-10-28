/**
 * orglet check report: turns the structured diagnostics behind the `warning:` lines into a census, a verdict, per-area
 * counts and root-cause groups. Pure (no console, no fs) so every rule is unit-tested; the `warning:` lines themselves
 * are printed by main.ts from the strings and never change.
 */
import { formatDiagnostic, type Diagnostic, type FormulaFailure, type InfoDiagnostic, type OrgSchema } from "@orglet/metadata";

export interface CheckInputs {
  schema: Pick<OrgSchema, "objects" | "labels" | "getField">;
  /** Every warning's structured twin, in the order the `warning:` lines are printed (D-15: 1:1 with the strings). */
  diagnostics: readonly Diagnostic[];
  info: readonly InfoDiagnostic[];
  customMetadata: { types: number; records: number };
}
export interface Count3 {
  total: number;
  custom: number;
  standard: number;
}
export interface CheckCensus {
  objects: Count3;
  fields: Count3;
  featureGatedFields: number;
  customMetadataTypes: number;
  customMetadataRecords: number;
  customSettings: number;
  labels: number;
}
export interface CheckVerdict {
  ok: boolean;
  warnings: number;
  rootCauses: number;
  dependents: number;
  info: number;
}
export interface AreaCount {
  key: string;
  area: string;
  severity: "warning" | "info";
  count: number;
  dependents: number;
}
export interface RootCauseGroup {
  root: Diagnostic;
  dependents: Diagnostic[];
}
export interface CheckReport {
  version: 1;
  census: CheckCensus;
  verdict: CheckVerdict;
  areas: AreaCount[];
  groups: RootCauseGroup[];
  diagnostics: Diagnostic[];
  info: InfoDiagnostic[];
}
export type CheckSummary = Pick<CheckReport, "version" | "census" | "verdict" | "areas">;

// Code-point order, never localeCompare: ICU collation differs between macOS and Linux and the report must not.
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function census(i: CheckInputs): CheckCensus {
  const objects = [...i.schema.objects.values()];
  const fields = objects.flatMap((o) => o.fields);
  const count3 = (total: number, custom: number): Count3 => ({ total, custom, standard: total - custom });
  return {
    objects: count3(objects.length, objects.filter((o) => o.custom).length),
    fields: count3(fields.length, fields.filter((f) => f.custom).length),
    featureGatedFields: fields.filter((f) => f.featureGated === true).length,
    customMetadataTypes: i.customMetadata.types,
    customMetadataRecords: i.customMetadata.records,
    customSettings: objects.filter((o) => o.customSetting !== undefined).length,
    labels: i.schema.labels.size,
  };
}

/** Candidate field names a failed reference may stand for: the name itself, `X__r` -> `X__c`, `X` -> `XId`. */
function fieldCandidates(field: string): string[] {
  const out = [field];
  if (field.endsWith("__r")) out.push(`${field.slice(0, -3)}__c`);
  out.push(`${field}Id`);
  return out;
}

/** Group every diagnostic that follows from another one under that root cause; see the rules inline. */
function groupByRoot(inputs: CheckInputs): { groups: RootCauseGroup[]; dependents: number } {
  const ds = inputs.diagnostics;
  const byKey = new Map<string, Diagnostic>();
  const byField = new Map<string, Diagnostic>();
  const byObject = new Map<string, Diagnostic>();
  for (const d of ds) {
    if (d.object !== undefined && d.field !== undefined) {
      const k = `${d.object}.${d.field}`.toLowerCase();
      const key = `${d.area}:${k}`;
      if (!byKey.has(key)) byKey.set(key, d);
      if ((d.area === "standard-field" || d.area === "field-type" || d.area.startsWith("rollup-")) && !byField.has(k)) byField.set(k, d);
    } else if (d.object !== undefined && d.field === undefined && (d.area === "standard-object" || d.area === "object-kind")) {
      if (!byObject.has(d.object.toLowerCase())) byObject.set(d.object.toLowerCase(), d);
    }
  }

  const parentOf = (d: Diagnostic): Diagnostic | undefined => {
    // (1) an explicit cause key written by roll-up admission
    if (d.cause !== undefined) {
      const p = byKey.get(d.cause.toLowerCase());
      if (p) return p;
    }
    const missing = "missing" in d ? (d as FormulaFailure).missing : undefined;
    if (missing) {
      const names = fieldCandidates(missing.field);
      // (2) the missing field is itself a skipped field or roll-up (Id suffix and __r/__c rules)
      for (const n of names) {
        const p = byField.get(`${missing.object}.${n}`.toLowerCase());
        if (p) return p;
      }
      // (3) the missing relationship name belongs to a lookup whose single target object was skipped
      for (const n of names) {
        const targets = inputs.schema.getField(missing.object, n)?.referenceTo;
        if (targets?.length === 1) {
          const p = byObject.get((targets[0] as string).toLowerCase());
          if (p) return p;
        }
      }
    }
    // (4) "X is referenced but not defined" follows from the skip of X itself
    if (d.area === "reference-target" && d.field === undefined && d.object !== undefined) {
      const p = byObject.get(d.object.toLowerCase());
      if (p && p !== d) return p;
    }
    return undefined;
  };

  const rootOf = (d: Diagnostic): Diagnostic => {
    const path: Diagnostic[] = [d];
    let cur = d;
    for (;;) {
      const p = parentOf(cur);
      if (!p || p === cur) return cur;
      const at = path.indexOf(p);
      if (at >= 0) {
        // A cause cycle has no true root; pick the member that sorts first so every member and every input order agree.
        return path.slice(at).reduce((a, b) => (cmp(formatDiagnostic(b), formatDiagnostic(a)) < 0 ? b : a));
      }
      path.push(p);
      cur = p;
    }
  };

  const index = new Map(ds.map((d, k) => [d, k]));
  const grouped = new Map<Diagnostic, Diagnostic[]>();
  let dependents = 0;
  for (const d of ds) {
    const root = rootOf(d);
    if (root === d) continue;
    dependents++;
    const list = grouped.get(root);
    if (list) list.push(d);
    else grouped.set(root, [d]);
  }
  const groups = [...grouped.entries()].map(([root, deps]) => ({
    root,
    dependents: deps.sort((a, b) => cmp(formatDiagnostic(a), formatDiagnostic(b)) || (index.get(a) ?? 0) - (index.get(b) ?? 0)),
  }));
  groups.sort((a, b) => cmp(formatDiagnostic(a.root), formatDiagnostic(b.root)));
  return { groups, dependents };
}

function areaCounts(inputs: CheckInputs, groups: RootCauseGroup[]): AreaCount[] {
  const dependentSet = new Set(groups.flatMap((g) => g.dependents));
  const warn = new Map<string, AreaCount>();
  for (const d of inputs.diagnostics) {
    const row = warn.get(d.area) ?? { key: `UNSUPPORTED:${d.area}`, area: d.area, severity: "warning" as const, count: 0, dependents: 0 };
    row.count++;
    if (dependentSet.has(d)) row.dependents++;
    warn.set(d.area, row);
  }
  const info = new Map<string, AreaCount>();
  for (const d of inputs.info) {
    const row = info.get(d.area) ?? { key: `info:${d.area}`, area: d.area, severity: "info" as const, count: 0, dependents: 0 };
    row.count++;
    info.set(d.area, row);
  }
  const sorted = (m: Map<string, AreaCount>) => [...m.values()].sort((a, b) => cmp(a.area, b.area));
  return [...sorted(warn), ...sorted(info)];
}

export function buildCheckReport(inputs: CheckInputs): CheckReport {
  const { groups, dependents } = groupByRoot(inputs);
  const warnings = inputs.diagnostics.length;
  return {
    version: 1,
    census: census(inputs),
    verdict: { ok: warnings === 0, warnings, rootCauses: warnings - dependents, dependents, info: inputs.info.length },
    areas: areaCounts(inputs, groups),
    groups,
    // The warning order is the v1.0 contract; only the info list is sorted.
    diagnostics: [...inputs.diagnostics],
    info: [...inputs.info].sort((a, b) => cmp(`${a.area}\u0000${a.object ?? ""}\u0000${a.message}`, `${b.area}\u0000${b.object ?? ""}\u0000${b.message}`)),
  };
}

/** Everything that is safe to share: counts only, no object, field, rule or label names. */
export function summariseCheckReport(r: CheckReport): CheckSummary {
  return { version: r.version, census: r.census, verdict: r.verdict, areas: r.areas };
}

export function formatCensus(r: Pick<CheckReport, "census">): string {
  const { objects: o, fields: f } = r.census;
  return `${o.total} objects (${o.custom} custom, ${o.standard} standard), ${f.total} fields (${f.custom} custom, ${f.standard} standard)`;
}

export function formatVerdict(r: Pick<CheckReport, "verdict">): string {
  const v = r.verdict;
  if (v.warnings === 0) return `verdict: clean (warnings: 0, informational: ${v.info})`;
  return `verdict: ${v.warnings} warnings to review (root causes: ${v.rootCauses}, dependents: ${v.dependents}, informational: ${v.info})`;
}

export function formatAreas(r: Pick<CheckReport, "areas">): string[] {
  if (r.areas.length === 0) return [];
  const keyW = Math.max(...r.areas.map((a) => a.key.length));
  const countW = Math.max(...r.areas.map((a) => String(a.count).length));
  return ["areas:", ...r.areas.map((a) => `  ${a.key.padEnd(keyW)}  ${String(a.count).padStart(countW)}${a.dependents > 0 ? `  (${a.dependents} dependents)` : ""}`)];
}

export function formatGroups(r: Pick<CheckReport, "groups">): string[] {
  if (r.groups.length === 0) return [];
  return [
    "root causes with dependents:",
    ...r.groups.flatMap((g) => [`  ${formatDiagnostic(g.root)}  [${g.dependents.length} dependents]`, ...g.dependents.map((d) => `    ${formatDiagnostic(d)}`)]),
  ];
}
