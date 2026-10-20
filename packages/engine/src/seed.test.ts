/** Custom-metadata seeding (CMDT-02, CMDT-03): the pure plan (coercion, derived Ids, relationship resolution, warnings) and the per-type full sync at orglet up. Fixture: conformance/cmdt-check/project. */
import { describe, it } from "vitest";

describe("planCustomMetadataSeed", () => {
  it.todo("keeps \"007\" in a Text field as text and stores xsi:nil and absent values as null");
  it.todo("stores an absent or nil Checkbox as false");
  it.todo("derives the same 18-character Id for a record in every run and for any casing of type and DeveloperName");
  it.todo("warns once per type and field for a value that cannot be coerced, naming the records");
  it.todo("warns once per type and field for an undeclared field and drops the value");
  it.todo("resolves an mdt-to-mdt relationship to the target record's derived Id, cycles included");
  it.todo("stores an EntityDefinition or FieldDefinition target as written and nulls a dangling one with one reference-target warning");
  it.todo("nulls an mdt target record that does not exist with one custom-metadata-record warning");
  it.todo("keeps the first of two records with the same DeveloperName and warns");
  it.todo("refuses two records whose derived Ids collide, naming both");
});

describe("seedCustomMetadata", () => {
  it.todo("inserts every planned row with audit fields from the bootstrap admin");
  it.todo("a second sync reports 0 added, 0 updated, 0 removed and leaves SystemModstamp unchanged");
  it.todo("updates a changed record in place and keeps its Id");
  it.todo("hard-deletes a record whose file is gone and gives the Id back when it returns");
  it.todo("yields the same Ids after orglet reset and in a second org schema");
});

describe("customMetadataSummary", () => {
  it.todo("formats the D-04 line");
});
