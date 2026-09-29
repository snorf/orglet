import type {
  ChildRelationship,
  FieldDef,
  GlobalValueSetDef,
  OrgSchema,
  SObjectDef,
  StandardValueSetDef,
} from "./types.js";

export class OrgSchemaImpl implements OrgSchema {
  private readonly fieldIndex = new Map<string, Map<string, FieldDef>>();
  private readonly children = new Map<string, ChildRelationship[]>();

  constructor(
    /** Keyed by lower-cased API name. */
    readonly objects: ReadonlyMap<string, SObjectDef>,
    readonly globalValueSets: ReadonlyMap<string, GlobalValueSetDef>,
    readonly standardValueSets: ReadonlyMap<string, StandardValueSetDef>,
  ) {
    for (const obj of objects.values()) {
      const byName = new Map<string, FieldDef>();
      for (const f of obj.fields) byName.set(f.name.toLowerCase(), f);
      this.fieldIndex.set(obj.name.toLowerCase(), byName);
    }
    for (const obj of objects.values()) {
      for (const f of obj.fields) {
        if (f.type !== "Lookup" && f.type !== "MasterDetail") continue;
        for (const ref of f.referenceTo ?? []) {
          const key = ref.toLowerCase();
          if (!objects.has(key)) continue;
          const list = this.children.get(key) ?? [];
          list.push({
            childSObject: obj.name,
            field: f.name,
            relationshipName: f.childRelationshipName,
            cascadeDelete: f.deleteConstraint === "Cascade",
            restrictedDelete: f.deleteConstraint === "Restrict",
          });
          this.children.set(key, list);
        }
      }
    }
  }

  getObject(name: string): SObjectDef | undefined {
    return this.objects.get(name.toLowerCase());
  }

  getField(objectName: string, fieldName: string): FieldDef | undefined {
    return this.fieldIndex.get(objectName.toLowerCase())?.get(fieldName.toLowerCase());
  }

  childRelationships(objectName: string): ChildRelationship[] {
    return this.children.get(objectName.toLowerCase()) ?? [];
  }

  /** Objects in a stable order: standard first by name, then custom by name. */
  list(): SObjectDef[] {
    return [...this.objects.values()].sort((a, b) =>
      a.custom === b.custom ? a.name.localeCompare(b.name) : a.custom ? 1 : -1,
    );
  }

  /** Plain-data snapshot for tests and for the CLI `describe` dump. */
  toJSON(): { objects: SObjectDef[] } {
    return { objects: this.list() };
  }
}
