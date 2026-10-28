/** The dependency walk Phase 13 shares between load-time admission, the engine's roll-up watched sets and evaluation order: roll-ups may read formula fields, formulas have no column, so every consumer needs to know which stored fields a formula ultimately reads and in which order formulas must be evaluated (ROLL2-01, D-02, D-14). Pure: works on a dependency lookup, compiles nothing. */
import type { OrgSchema } from "@orglet/metadata";
import type { FormulaDependencies } from "./compile.js";

/** Dependency list of a compiled formula field, or undefined for a stored field or a formula that did not compile. */
export type FormulaLookup = (object: string, field: string) => FormulaDependencies | undefined;

export interface FormulaInputs {
  /** Stored same-object fields (canonical names, sorted) the field ultimately reads; roll-up columns count as stored. */
  stored: string[];
  /** Formula fields walked (canonical names), each after the formulas it reads; includes the start field when it is a formula. */
  formulas: string[];
  /** A formula met again on its own path, as `Obj.A -> Obj.B -> Obj.A`; the walk stops there. */
  cycle?: string;
}

export function formulaInputs(schema: OrgSchema, lookup: FormulaLookup, object: string, field: string): FormulaInputs {
  const obj = schema.getObject(object)?.name ?? object;
  const stored = new Set<string>();
  const formulas: string[] = [];
  const done = new Set<string>();
  const stack: string[] = [];
  let cycle: string | undefined;

  const visit = (name: string): void => {
    const def = schema.getField(obj, name);
    if (def === undefined) return;
    if (def.formula === undefined) {
      stored.add(def.name);
      return;
    }
    const key = def.name.toLowerCase();
    const at = stack.indexOf(def.name);
    if (at >= 0) {
      cycle ??= [...stack.slice(at), def.name].map((n) => `${obj}.${n}`).join(" -> ");
      return;
    }
    if (done.has(key)) return;
    stack.push(def.name);
    const deps = lookup(obj, def.name);
    for (const entry of deps?.fields ?? []) {
      if (entry.path.length !== 0) continue;
      for (const f of entry.fields) visit(f);
    }
    stack.pop();
    done.add(key);
    formulas.push(def.name);
  };

  visit(field);
  return { stored: [...stored].sort(), formulas, ...(cycle !== undefined ? { cycle } : {}) };
}

/** The parts of a compiled formula field dependencyOrder reads (structurally the engine's CompiledField). */
export interface OrderableFormula {
  field: { name: string };
  compiled: { dependencies: FormulaDependencies };
}

/**
 * Kahn's algorithm over same-object formula -> formula reads: every formula comes after the formulas it reads, so a
 * record evaluated in this order never sees a stale formula value (D-02; fixes declaration-order evaluation in project()).
 * Ties keep declaration order. Formulas left on a cycle are appended in declaration order rather than looping.
 */
export function dependencyOrder<T extends OrderableFormula>(items: readonly T[]): T[] {
  const index = new Map<string, number>();
  items.forEach((it, i) => index.set(it.field.name.toLowerCase(), i));
  const reads = items.map((it, i) => {
    const set = new Set<number>();
    for (const entry of it.compiled.dependencies.fields) {
      if (entry.path.length !== 0) continue;
      for (const f of entry.fields) {
        const j = index.get(f.toLowerCase());
        if (j !== undefined && j !== i) set.add(j);
      }
    }
    return set;
  });
  const emitted = new Set<number>();
  const out: T[] = [];
  for (;;) {
    const next = items.findIndex((_, i) => !emitted.has(i) && [...(reads[i] ?? [])].every((j) => emitted.has(j)));
    if (next < 0) break;
    emitted.add(next);
    out.push(items[next] as T);
  }
  items.forEach((it, i) => {
    if (!emitted.has(i)) out.push(it);
  });
  return out;
}
