/** OrgSchemaImpl label lookup and the object/field capability helpers Phase 11 adds. */
import { describe, expect, it } from "vitest";
import { OrgSchemaImpl, definitionTarget, hasSoftDelete } from "./schema.js";
import type { CustomLabelDef, FieldDef, SObjectDef } from "./types.js";

const label: CustomLabelDef = { fullName: "Welcome_Message", value: "Hi", language: "en_US", protected: false };

function field(name: string, type: FieldDef["type"], referenceTo?: string[]): FieldDef {
  return { name, label: name, type, referenceTo } as unknown as FieldDef;
}

function obj(fields: FieldDef[]): SObjectDef {
  return { name: "Foo__c", fields } as unknown as SObjectDef;
}

describe("OrgSchemaImpl labels", () => {
  it("labels are looked up case-insensitively by fullName", () => {
    const schema = new OrgSchemaImpl(new Map(), new Map(), new Map(), new Map([["welcome_message", label]]));
    expect(schema.getLabel("WELCOME_MESSAGE")).toBe(label);
    expect(schema.getLabel("nope")).toBeUndefined();
    expect(schema.labels.size).toBe(1);
  });

  it("a schema built without labels has an empty label map", () => {
    const schema = new OrgSchemaImpl(new Map(), new Map(), new Map());
    expect(schema.labels.size).toBe(0);
    expect(schema.getLabel("x")).toBeUndefined();
  });
});

describe("hasSoftDelete", () => {
  it("hasSoftDelete is true only when the object declares IsDeleted", () => {
    expect(hasSoftDelete(obj([field("Id", "Id"), field("IsDeleted", "Checkbox")]))).toBe(true);
    expect(hasSoftDelete(obj([field("Id", "Id")]))).toBe(false);
  });
});

describe("definitionTarget", () => {
  it("definitionTarget names EntityDefinition and FieldDefinition targets of a MetadataRelationship, case-insensitively, and nothing else", () => {
    expect(definitionTarget(field("A__c", "MetadataRelationship", ["entitydefinition"]))).toBe("EntityDefinition");
    expect(definitionTarget(field("A__c", "MetadataRelationship", ["FieldDefinition"]))).toBe("FieldDefinition");
    expect(definitionTarget(field("A__c", "MetadataRelationship", ["Tier_Group__mdt"]))).toBeUndefined();
    expect(definitionTarget(field("A__c", "Lookup", ["EntityDefinition"]))).toBeUndefined();
  });
});
