import type {
  ChildRelationship,
  CustomLabelDef,
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
    /** Keyed by lower-cased fullName. */
    readonly labels: ReadonlyMap<string, CustomLabelDef> = new Map(),
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

  getLabel(fullName: string): CustomLabelDef | undefined {
    return this.labels.get(fullName.toLowerCase());
  }

  getField(objectName: string, fieldName: string): FieldDef | undefined {
    return this.fieldIndex.get(objectName.toLowerCase())?.get(fieldName.toLowerCase());
  }

  resolveRelationship(objectName: string, relationshipName: string): { field: FieldDef; target: SObjectDef; targets: SObjectDef[]; polymorphic: boolean } | undefined {
    const obj = this.getObject(objectName);
    const field = obj?.fields.find((f) => f.relationshipName?.toLowerCase() === relationshipName.toLowerCase());
    if (!field?.referenceTo || field.referenceTo.length === 0) return undefined;
    const defined = field.referenceTo.map((n) => this.getObject(n)).filter((o): o is SObjectDef => o !== undefined);
    const target = defined[0];
    if (!target) return undefined;
    return { field, target, targets: defined, polymorphic: defined.length > 1 };
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

/** Whether the object has a recycle bin (an IsDeleted column). Custom metadata types do not (D-16); every soft-delete filter asks this. */
export function hasSoftDelete(obj: SObjectDef): boolean {
  return obj.fields.some((f) => f.name === "IsDeleted");
}

/** The definition a MetadataRelationship points at when its target is not an sObject (D-08), else undefined. */
export function definitionTarget(field: FieldDef): "EntityDefinition" | "FieldDefinition" | undefined {
  if (field.type !== "MetadataRelationship") return undefined;
  const target = field.referenceTo?.[0]?.toLowerCase();
  if (target === "entitydefinition") return "EntityDefinition";
  if (target === "fielddefinition") return "FieldDefinition";
  return undefined;
}
