/**
 * Which roll-up summary parents a child DML touches. The registry indexes every roll-up by its child
 * object once per OrgSchema; affectedParents turns a batch of child work items into the parent ids to
 * recompute and, per parent, every child in the batch that points at it (the D-03 blame set).
 */
import type { FieldDef, OrgSchema, RollupDef, SObjectDef } from "@orglet/metadata";
import type { RecordData } from "@orglet/formula";

export interface RollupBinding {
  parent: SObjectDef;
  field: FieldDef;
  rollup: RollupDef;
  child: SObjectDef;
  /** Fields whose change can move this roll-up: FK, summarized field, filter fields and valueFields. */
  watched: ReadonlySet<string>;
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

  constructor(schema: OrgSchema) {
    for (const parent of schema.objects.values()) {
      for (const field of parent.fields) {
        const rollup = field.rollup;
        if (!rollup) continue;
        const child = schema.getObject(rollup.childObject);
        if (!child) continue;
        const watched = new Set<string>([rollup.foreignKey]);
        if (rollup.summarizedField !== undefined) watched.add(rollup.summarizedField);
        for (const f of rollup.filters) {
          watched.add(f.field);
          if (f.valueField !== undefined) watched.add(f.valueField);
        }
        const key = child.name.toLowerCase();
        this.byChild.set(key, [...(this.byChild.get(key) ?? []), { parent, field, rollup, child, watched }]);
      }
    }
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
