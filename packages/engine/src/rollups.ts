/**
 * Which roll-up summary parents a child DML touches. The registry indexes every roll-up by its child
 * object once per OrgSchema; affectedParents turns a batch of child work items into the parent ids to
 * recompute and, per parent, every child in the batch that points at it (the D-03 blame set).
 * Roll-ups over formula fields watch the stored fields those formulas read (Phase 13 D-14).
 */
import type { FieldDef, OrgSchema, RollupDef, SObjectDef } from "@orglet/metadata";
import { formulaInputs, type FormulaLookup, type RecordData } from "@orglet/formula";

import type { FormulaRegistry } from "./formulas.js";

export interface RollupBinding {
  parent: SObjectDef;
  field: FieldDef;
  rollup: RollupDef;
  child: SObjectDef;
  /** Fields whose change can move this roll-up: FK, summarized field, filter fields and valueFields, and for a formula among them the stored same-object fields it reads, transitively (D-14). */
  watched: ReadonlySet<string>;
  /** True when the summarized field, a filter field or a valueField is a formula on the child: recomputed over TS-evaluated values (Phase 13 D-15). */
  formulaBacked: boolean;
  /** Child formula fields to evaluate for this roll-up, inner first (empty unless formulaBacked). */
  formulas: string[];
}

export type RollupKind = "insert" | "update" | "delete" | "undelete";

/** The parts of an engine work item this module reads. */
export interface RollupWork {
  errors: readonly unknown[];
  changes: RecordData;
  old?: RecordData;
  next: RecordData;
}

export interface ParentGroup<W> {
  parent: SObjectDef;
  /** Roll-up fields on `parent` fed by this child object. */
  fields: FieldDef[];
  /** Triggered parent id -> every live work in the batch whose old or new FK is that id. */
  ids: Map<string, Set<W>>;
}

export class RollupRegistry {
  private readonly byChild = new Map<string, RollupBinding[]>();

  private readonly byField = new Map<FieldDef, RollupBinding>();

  private readonly bindings: RollupBinding[] = [];

  private readonly levels = new Map<FieldDef, number>();

  private readonly visiting = new Set<FieldDef>();

  constructor(
    private readonly schema: OrgSchema,
    formulas?: Pick<FormulaRegistry, "fieldDependencies">,
  ) {
    const lookup: FormulaLookup = (o, f) => {
      const obj = schema.getObject(o);
      return obj && formulas ? formulas.fieldDependencies(obj, f) : undefined;
    };
    for (const parent of schema.objects.values()) {
      for (const field of parent.fields) {
        const rollup = field.rollup;
        if (!rollup) continue;
        const child = schema.getObject(rollup.childObject);
        if (!child) continue;
        const watched = new Set<string>([rollup.foreignKey]);
        const formulaNames: string[] = [];
        let formulaBacked = false;
        const inputs = [rollup.summarizedField, ...rollup.filters.flatMap((x) => [x.field, x.valueField])];
        for (const name of inputs) {
          if (name === undefined) continue;
          const def = schema.getField(child.name, name);
          if (def?.formula !== undefined) {
            const walked = formulaInputs(schema, lookup, child.name, def.name);
            for (const s of walked.stored) watched.add(s);
            for (const f of walked.formulas) if (!formulaNames.some((n) => n.toLowerCase() === f.toLowerCase())) formulaNames.push(f);
            formulaBacked = true;
          } else {
            watched.add(name);
          }
        }
        const binding: RollupBinding = { parent, field, rollup, child, watched, formulaBacked, formulas: formulaNames };
        const key = child.name.toLowerCase();
        this.byChild.set(key, [...(this.byChild.get(key) ?? []), binding]);
        this.byField.set(field, binding);
        this.bindings.push(binding);
      }
    }
  }

  binding(field: FieldDef): RollupBinding | undefined {
    return this.byField.get(field);
  }

  /** Every binding in construction order. */
  all(): RollupBinding[] {
    return this.bindings;
  }

  /** Chain level for backfill order: 1 for a roll-up whose watched inputs are all non-roll-up fields, otherwise 1 + the highest level among the roll-up columns it watches (summarized roll-ups and roll-ups its formulas read, D-03). */
  level(field: FieldDef): number {
    const known = this.levels.get(field);
    if (known !== undefined) return known;
    const b = this.byField.get(field);
    if (!b || this.visiting.has(field)) return 1;
    this.visiting.add(field);
    const inner = [...b.watched].map((n) => {
      const d = this.schema.getField(b.child.name, n);
      const nested = d?.rollup ? this.binding(d) : undefined;
      return nested ? this.level(nested.field) : 0;
    });
    this.visiting.delete(field);
    const level = 1 + Math.max(0, ...inner);
    this.levels.set(field, level);
    return level;
  }

  forChild(child: SObjectDef): RollupBinding[] {
    return this.byChild.get(child.name.toLowerCase()) ?? [];
  }
}

const idOf = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

/**
 * Parents to recompute for a batch of child works, grouped by parent object. Insert triggers the new FK;
 * update triggers old and new when they differ (reparent) and otherwise the FK when any watched field is a
 * key of `changes` (over-approximation: recompute is idempotent and unchanged parents are skipped);
 * delete/undelete trigger the old FK. Ids in `skip` (parents being deleted up the stack) are ignored.
 */
export function affectedParents<W extends RollupWork>(bindings: RollupBinding[], works: W[], kind: RollupKind, skip: ReadonlySet<string>): ParentGroup<W>[] {
  const live = works.filter((w) => w.errors.length === 0);
  if (bindings.length === 0 || live.length === 0) return [];

  const groups = new Map<string, { parent: SObjectDef; fields: FieldDef[]; fks: Set<string>; watched: Set<string> }>();
  for (const b of bindings) {
    const key = b.parent.name.toLowerCase();
    const g = groups.get(key) ?? { parent: b.parent, fields: [], fks: new Set<string>(), watched: new Set<string>() };
    if (!g.fields.includes(b.field)) g.fields.push(b.field);
    g.fks.add(b.rollup.foreignKey);
    for (const f of b.watched) g.watched.add(f);
    groups.set(key, g);
  }

  const readsOld = kind !== "insert";
  const readsNext = kind === "insert" || kind === "update";
  const out: ParentGroup<W>[] = [];
  for (const g of groups.values()) {
    const ids = new Map<string, Set<W>>();
    for (const w of live) {
      for (const fk of g.fks) {
        const oldId = readsOld ? idOf(w.old?.[fk]) : undefined;
        const newId = readsNext ? idOf(w.next[fk]) : undefined;
        const triggered: (string | undefined)[] = [];
        if (kind === "insert") triggered.push(newId);
        else if (kind === "update") {
          if (oldId !== newId) triggered.push(oldId, newId);
          else if ([...g.watched].some((f) => f in w.changes)) triggered.push(newId);
        } else triggered.push(oldId);
        for (const id of triggered) if (id !== undefined && !skip.has(id) && !ids.has(id)) ids.set(id, new Set<W>());
      }
    }
    if (ids.size === 0) continue;
    for (const [id, blamed] of ids) {
      for (const w of live) {
        for (const fk of g.fks) {
          if ((readsOld && idOf(w.old?.[fk]) === id) || (readsNext && idOf(w.next[fk]) === id)) blamed.add(w);
        }
      }
    }
    out.push({ parent: g.parent, fields: g.fields, ids });
  }
  return out;
}
