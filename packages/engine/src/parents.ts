/**
 * Attaches parent records to records along relationship paths, so formulas and validation
 * rules that reference `Account.Owner.Alias` find the values nested in the record.
 */
import type { OrgSchema, SObjectDef } from "@orglet/metadata";
import type { Queryable } from "@orglet/schema";
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
      current = { obj: rel.target, records: current.records.map((r) => r[seg]).filter((v): v is RecordData => typeof v === "object" && v !== null) };
    }
    const rel = relationship(store.schema, current.obj, leaf);
    if (!rel) continue;
    const ids = [...new Set(current.records.map((r) => r[rel.field]).filter((v): v is string => typeof v === "string"))];
    const parents = await store.loadByIds(client, rel.target, ids);
    for (const r of current.records) {
      const id = r[rel.field];
      r[leaf] = typeof id === "string" ? (parents.get(id) ?? null) : null;
    }
  }
}

function relationship(schema: OrgSchema, obj: SObjectDef, relationshipName: string): { field: string; target: SObjectDef } | undefined {
  const resolved = schema.resolveRelationship(obj.name, relationshipName);
  if (resolved === undefined || resolved === "polymorphic") return undefined;
  return { field: resolved.field.name, target: resolved.target };
}
