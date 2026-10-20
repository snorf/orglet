/** planTable index and foreign-key rules (Phase 11: unique lookups, MetadataRelationship). */
import { describe, expect, it } from "vitest";
import { OrgSchemaImpl, type FieldDef, type FieldType, type SObjectDef } from "@orglet/metadata";
import { planTable } from "./ddl.js";

const field = (name: string, type: FieldType, extra: Partial<FieldDef> = {}): FieldDef => ({
  name,
  label: name,
  type,
  custom: true,
  nillable: true,
  createable: true,
  updateable: true,
  defaultedOnCreate: false,
  unique: false,
  externalId: false,
  caseSensitive: false,
  idLookup: false,
  nameField: false,
  ...extra,
});

const obj = (name: string, fields: FieldDef[]): SObjectDef => ({
  name,
  label: name,
  labelPlural: name,
  keyPrefix: "a00",
  custom: true,
  createable: true,
  updateable: true,
  deletable: true,
  undeletable: true,
  queryable: true,
  searchable: true,
  hasOwner: false,
  fields,
  validationRules: [],
  recordTypes: [],
});

const schemaOf = (...objects: SObjectDef[]) => new OrgSchemaImpl(new Map(objects.map((o) => [o.name.toLowerCase(), o])), new Map(), new Map());

describe("planTable indexes and foreign keys", () => {
  it("a unique Lookup gets a unique index on the raw column and no FK when polymorphic (D-18)", () => {
    const cfg = obj("Cfg__c", [field("Id", "Id"), field("SetupOwnerId", "Lookup", { unique: true, referenceTo: ["Organization", "Profile", "User"] })]);
    const plan = planTable(schemaOf(cfg), cfg);
    expect(plan.indexes).toContainEqual({ name: "ux_cfg__c_setupownerid", unique: true, expression: '"setupownerid"' });
    expect(plan.indexes.find((i) => i.name === "ix_cfg__c_setupownerid")).toBeUndefined();
    expect(plan.foreignKeys.find((f) => f.column === "setupownerid")).toBeUndefined();
  });

  it("a non-unique Lookup keeps its plain index", () => {
    const parent = obj("Parent__c", [field("Id", "Id")]);
    const child = obj("Child__c", [field("Id", "Id"), field("Parent__c", "Lookup", { referenceTo: ["Parent__c"] })]);
    const plan = planTable(schemaOf(parent, child), child);
    expect(plan.indexes).toContainEqual({ name: "ix_child__c_parent__c", unique: false, expression: '"parent__c"' });
    expect(plan.foreignKeys.map((f) => f.column)).toContain("parent__c");
  });

  it("a MetadataRelationship gets a plain index and never a foreign key (D-07)", () => {
    const other = obj("Other__mdt", [field("Id", "Id")]);
    const foo = obj("Foo__mdt", [
      field("Id", "Id"),
      field("Rel__c", "MetadataRelationship", { referenceTo: ["Other__mdt"] }),
      field("Obj__c", "MetadataRelationship", { referenceTo: ["EntityDefinition"] }),
    ]);
    const plan = planTable(schemaOf(other, foo), foo);
    expect(plan.indexes).toContainEqual({ name: "ix_foo__mdt_rel__c", unique: false, expression: '"rel__c"' });
    expect(plan.indexes).toContainEqual({ name: "ix_foo__mdt_obj__c", unique: false, expression: '"obj__c"' });
    expect(plan.foreignKeys.map((f) => f.column)).not.toContain("rel__c");
    expect(plan.foreignKeys.map((f) => f.column)).not.toContain("obj__c");
    expect(plan.columns.find((c) => c.name === "obj__c")?.sqlType).toBe("varchar(255)");
    expect(plan.columns.find((c) => c.name === "rel__c")?.sqlType).toBe("char(18)");
  });

  it("a unique case-insensitive Text field keeps its lower() unique index", () => {
    const o = obj("Code__c", [field("Id", "Id"), field("Code__c", "Text", { length: 20, unique: true })]);
    expect(planTable(schemaOf(o), o).indexes).toContainEqual({ name: "ux_code__c_code__c", unique: true, expression: 'lower("code__c")' });
  });
});
