/**
 * Attaches parent records to records along relationship paths, so formulas and validation
 * rules that reference `Account.Owner.Alias` find the values nested in the record.
 */
import type { OrgSchema, SObjectDef } from "@orglet/metadata";
import { matchTargetByPrefix, type Queryable } from "@orglet/schema";
import type { RecordData } from "@orglet/formula";
import type { Store } from "./store.js";

export async function loadParents(client: Queryable, store: Store, obj: SObjectDef, records: RecordData[], paths: string[][]): Promise<void> {
  // Longest paths cover their prefixes; process each distinct prefix once.
  const prefixes = new Set<string>();
  for (const path of paths) {
    for (let i = 1; i <= path.length; i++) prefixes.add(path.slice(0, i).join("."));
  }
  for (const prefix of [...prefixes].sort((a, b) => a.split(".").length - b.split(".").length)) {
    const segments = prefix.split(".");
    const leaf = segments[segments.length - 1] ?? "";
    // Records one level up from the leaf.
    let current: { obj: SObjectDef; records: RecordData[] } = { obj, records };
    for (const seg of segments.slice(0, -1)) {
      const rel = relationship(store.schema, current.obj, seg);
      if (!rel) return;
      // Formula compilation rejects traversal past a polymorphic parent (D-08/D-16), so a path never continues past one.
      if (rel.polymorphic) return;
      const next = rel.targets[0];
      if (!next) return;
      current = { obj: next, records: current.records.map((r) => r[seg]).filter((v): v is RecordData => typeof v === "object" && v !== null) };
    }
    const rel = relationship(store.schema, current.obj, leaf);
    if (!rel) continue;
    const ids = [...new Set(current.records.map((r) => r[rel.field]).filter((v): v is string => typeof v === "string"))];
    // Each Id is loaded from the object its key prefix names (the write path's rule), so a
    // Group-owned record's Owner comes from Group, not from the first declared target.
    const byTarget = new Map<SObjectDef, string[]>();
    for (const id of ids) {
      const target = matchTargetByPrefix(rel.targets, id);
      if (target) byTarget.set(target, [...(byTarget.get(target) ?? []), id]);
    }
    const parents = new Map<string, RecordData>();
    for (const [target, targetIds] of byTarget) for (const [id, parent] of await store.loadByIds(client, target, targetIds)) parents.set(id, parent);
    for (const r of current.records) {
      const id = r[rel.field];
      r[leaf] = typeof id === "string" ? (parents.get(id) ?? null) : null;
    }
  }
}

function relationship(schema: OrgSchema, obj: SObjectDef, relationshipName: string): { field: string; targets: SObjectDef[]; polymorphic: boolean } | undefined {
  const resolved = schema.resolveRelationship(obj.name, relationshipName);
  if (resolved === undefined) return undefined;
  return { field: resolved.field.name, targets: resolved.targets, polymorphic: (resolved.field.referenceTo?.length ?? 0) > 1 };
}
