/**
 * Unit tests for the baseline generator's source normalisation and type mapping (scripts/gen-baseline/sources.ts and
 * typemap.ts). Pure: hand-built source shapes, no files, no network. The parity of the whole pipeline against v1.0 is
 * covered by baseline-generator.test.ts.
 */
import { describe, expect, it } from "vitest";
import { parseSupportedCalls } from "../../../scripts/gen-baseline/calls.js";
import { GeneratorError } from "../../../scripts/gen-baseline/errors.js";
import { parseObjectReference, parseSfSkills, sourceFieldsOf, type SourceField } from "../../../scripts/gen-baseline/sources.js";
import { compoundParent, flagsFrom, humanise, lengthFor, mapType } from "../../../scripts/gen-baseline/typemap.js";

const field = (name: string, sf?: SourceField["sf"], doc?: SourceField["doc"]): SourceField => {
  const f: SourceField = { object: "Account", name, personAccount: false };
  if (sf) f.sf = sf;
  if (doc) f.doc = doc;
  return f;
};

describe("gen-baseline typemap: type normalisation", () => {
  it("normalises the source type token case-insensitively", () => {
    expect(mapType("Account", "A", "dateTime", {})).toMatchObject({ type: "DateTime" });
    expect(mapType("Account", "A", "datetime", {})).toMatchObject({ type: "DateTime" });
    expect(mapType("Account", "A", "String", {})).toMatchObject({ type: "Text" });
    expect(mapType("Account", "A", "ID", {})).toEqual({ skip: "system", sourceType: "ID" });
    expect(mapType("Account", "A", "JunctionIdLIst", {})).toEqual({ skip: "unsupported", sourceType: "JunctionIdLIst" });
  });

  it("aborts on an unknown type token naming Object.Field and the token", () => {
    expect(() => mapType("Account", "Weird", "hologram", {})).toThrow(GeneratorError);
    expect(() => mapType("Account", "Weird", "hologram", {})).toThrow(/Account\.Weird.*hologram/);
  });

  it("splits textarea into TextArea and LongTextArea on the 255 boundary", () => {
    expect(mapType("Account", "A", "textarea", { length: 255 })).toMatchObject({ type: "TextArea" });
    expect(mapType("Account", "A", "textarea", { length: 32000 })).toMatchObject({ type: "LongTextArea" });
  });

  it("guesses numeric precision and scale, with the geolocation convention for Latitude/Longitude doubles", () => {
    expect(mapType("Account", "BillingLatitude", "double", {})).toMatchObject({ type: "Number", precision: 18, scale: 15, guessed: true });
    expect(mapType("Account", "Score", "double", {})).toMatchObject({ type: "Number", precision: 18, scale: 6, guessed: true });
    expect(mapType("Account", "Count", "int", {})).toMatchObject({ type: "Number", precision: 18, scale: 0, guessed: true });
    expect(mapType("Account", "Amount", "currency", {})).toMatchObject({ type: "Currency", precision: 18, scale: 2, guessed: false });
  });

  it("maps reference to Lookup, or MasterDetail when the Object Reference says master-detail", () => {
    expect(mapType("Account", "ParentId", "reference", {})).toMatchObject({ type: "Lookup" });
    expect(mapType("Account", "ParentId", "reference", { relationshipType: "master-detail" })).toMatchObject({ type: "MasterDetail" });
    expect(mapType("Account", "ParentId", "reference", { relationshipType: "lookup" })).toMatchObject({ type: "Lookup" });
  });

  it("maps address to a read-only Address compound and combobox to Picklist", () => {
    expect(mapType("Account", "BillingAddress", "address", {})).toMatchObject({ type: "Address", createable: false, updateable: false });
    expect(mapType("Task", "Subject", "combobox", {})).toMatchObject({ type: "Picklist" });
  });
});

describe("gen-baseline typemap: flags", () => {
  it("writes no flag when Create, Update and Nillable are all present", () => {
    expect(flagsFrom(["Create", "Filter", "Nillable", "Sort", "Update"])).toEqual({});
  });

  it("writes createable, updateable and nillable false when their tokens are absent", () => {
    expect(flagsFrom(["Filter", "Sort"])).toEqual({ createable: false, updateable: false, nillable: false });
  });

  it("writes only true values for the positive flags, matching tokens by letters only", () => {
    expect(flagsFrom(["Create", "Defaulted on create", "Nillable", "Update", "idLookup", "Namefield", "Unique", "Restricted picklist"])).toEqual({
      defaultedOnCreate: true,
      idLookup: true,
      nameField: true,
      unique: true,
      restrictedPicklist: true,
    });
    expect(flagsFrom(["Create", "Nillable", "Update", "Defaulted on create or filter"])).toEqual({ defaultedOnCreate: true });
  });

  it("yields no flag facts at all when the source has no properties", () => {
    expect(flagsFrom(undefined)).toEqual({});
  });
});

describe("gen-baseline typemap: lengths and labels", () => {
  it("prefers the sf-skills field_reference length over the Object Reference maximum for plain text", () => {
    const f = field("Name", { referenceType: "string", length: 80 }, { type: "string", maxLength: 255 });
    expect(lengthFor(f, "string")).toEqual({ value: 80, provenance: "sdk-only" });
  });

  it("prefers the Object Reference maximum for textarea (field_reference reports the UI length)", () => {
    const f = field("Description", { referenceType: "textarea", length: 32000 }, { type: "textarea", maxLength: 1000 });
    expect(lengthFor(f, "textarea")).toEqual({ value: 1000, provenance: "doc-only" });
  });

  it("guesses 255 when neither source states a length, and none for non-text types", () => {
    expect(lengthFor(field("Fax", { referenceType: "phone" }, { type: "phone" }), "phone")).toEqual({ value: 255, provenance: "guessed" });
    expect(lengthFor(field("Type", { referenceType: "picklist", length: 255 }), "picklist")).toBeUndefined();
  });

  it("ignores a field_reference length whose field_reference type is not text-like", () => {
    // field_reference reports 18 for ids and 255 for picklists; a reference-typed entry must not lend its length.
    const f = field("Name", { referenceType: "reference", length: 18 }, { type: "string", maxLength: 80 });
    expect(lengthFor(f, "string")).toEqual({ value: 80, provenance: "doc-only" });
  });

  it("marks agreeing lengths verified", () => {
    const f = field("Name", { referenceType: "string", length: 80 }, { type: "string", maxLength: 80 });
    expect(lengthFor(f, "string")).toEqual({ value: 80, provenance: "verified" });
  });

  it("humanises API names: camel case split, trailing Id becomes ID", () => {
    expect(humanise("BillingCity")).toBe("Billing City");
    expect(humanise("AccountId")).toBe("Account ID");
    expect(humanise("SLAExpirationDate")).toBe("SLA Expiration Date");
    expect(humanise("Name")).toBe("Name");
  });

  it("assigns compound parts to their address parent", () => {
    const addresses = new Set(["BillingAddress", "ShippingAddress"]);
    expect(compoundParent("BillingCity", addresses)).toBe("BillingAddress");
    expect(compoundParent("ShippingGeocodeAccuracy", addresses)).toBe("ShippingAddress");
    expect(compoundParent("BillingAddress", addresses)).toBeUndefined();
    expect(compoundParent("Website", addresses)).toBeUndefined();
    expect(compoundParent("BillingCity", new Set())).toBeUndefined();
  });
});

describe("gen-baseline sources: sf-skills and Object Reference normalisation", () => {
  const sfRaw = {
    fields: {
      Name: { type: "string", properties: "Create, Filter, Group, Sort, Update", description: "Maximum size is 255 characters." },
      OwnerId: { type: "reference", properties: "Create, Defaulted on create, Filter, Sort, Update", refers_to: "Group, User", relationship_name: "Owner", relationship_type: "Lookup" },
      Odd: { type: "picklist" },
      Weird: { type: "string", properties: "Sort Update" },
    },
    ispersonaccount_fields: {
      FirstName: { type: "string", properties: "Create, Nillable, Update" },
    },
    field_reference: {
      Name: { field_label: "Account Name", type: "string", length: "255" },
      Custom__c: { field_label: "Custom", type: "string", length: "10" },
      OnlyHere: { field_label: "Only Here", type: "boolean" },
    },
  };
  const docRaw = {
    object: "Account",
    fields: {
      Name: { type: "string", properties: ["Create", "Filter", "Group", "Sort", "Update"], maxLength: 255 },
      OwnerId: { type: "reference", properties: ["Create", "Defaulted on create", "Filter", "Sort", "Update"], refersTo: ["User", "Group"], relationshipName: "Owner", relationshipType: "lookup" },
      DocOnly: { type: "boolean", properties: ["Create", "Filter"], gating: ["person-accounts"] },
    },
  };

  it("merges fields, ispersonaccount_fields, field_reference and the extraction into one sorted field list", () => {
    const inputs = { sfSkills: new Map([["Account", parseSfSkills("Account", sfRaw)]]), objectReference: new Map([["Account", parseObjectReference("Account", docRaw)]]) };
    const fields = sourceFieldsOf(inputs, "Account");
    expect(fields.map((f) => f.name)).toEqual(["DocOnly", "FirstName", "Name", "Odd", "OnlyHere", "OwnerId", "Weird"]);
    const name = fields.find((f) => f.name === "Name")!;
    expect(name.sf).toMatchObject({ type: "string", label: "Account Name", referenceType: "string", length: 255, properties: ["Create", "Filter", "Group", "Sort", "Update"] });
    expect(name.doc).toMatchObject({ type: "string", maxLength: 255 });
    expect(fields.find((f) => f.name === "FirstName")!.personAccount).toBe(true);
    expect(fields.find((f) => f.name === "DocOnly")!.sf).toBeUndefined();
    expect(fields.find((f) => f.name === "OnlyHere")!.sf).toEqual({ label: "Only Here", referenceType: "boolean" });
  });

  it("drops __c entries, splits refers_to into a sorted list and leaves properties undefined when absent", () => {
    const sf = parseSfSkills("Account", sfRaw);
    expect(sf.fieldReference.has("Custom__c")).toBe(false);
    expect(sf.fields.get("OwnerId")).toMatchObject({ refersTo: ["Group", "User"], relationshipName: "Owner", relationshipType: "Lookup" });
    expect(sf.fields.get("Odd")!.properties).toBeUndefined();
  });

  it("splits a property token that is several known tokens without a comma", () => {
    expect(parseSfSkills("Account", sfRaw).fields.get("Weird")!.properties).toEqual(["Sort", "Update"]);
  });

  it("rejects an unknown property token and a malformed file shape", () => {
    expect(() => parseSfSkills("Account", { fields: { X: { type: "string", properties: "Create, Teleport" } } })).toThrow(/Account\.X.*Teleport/);
    expect(() => parseSfSkills("Account", { fields: [] })).toThrow(GeneratorError);
    expect(() => parseObjectReference("Account", { object: "Contact", fields: {} })).toThrow(GeneratorError);
  });
});

describe("gen-baseline Supported Calls (D-10)", () => {
  it("a wrapped Supported Calls line is read up to the first blank line", () => {
    const lines = [
      "      Supported Calls",
      "      create(), delete(), describeLayout(), describeSObjects(), getDeleted(), getUpdated(), query(),",
      "      retrieve(), search(), undelete(), update(), upsert()",
      "",
      "      Field Name   Details",
    ];
    expect(parseSupportedCalls(lines)).toEqual([
      "create", "delete", "describeLayout", "describeSObjects", "getDeleted", "getUpdated", "query", "retrieve", "search", "undelete", "update", "upsert",
    ]);
  });

  it("a missing comma between two calls still yields both tokens", () => {
    const lines = ["Supported Calls", "      delete(), describeLayout()describeSObjects(), query(), retrieve(), search(), undelete(), update()"];
    expect(parseSupportedCalls(lines)).toEqual(["delete", "describeLayout", "describeSObjects", "query", "retrieve", "search", "undelete", "update"]);
  });

  it("calls printed out of order come back sorted", () => {
    expect(parseSupportedCalls(["Supported Calls", "describeSObjects(), describeLayout(), create()"])).toEqual(["create", "describeLayout", "describeSObjects"]);
  });

  it("a section without a Supported Calls label yields undefined", () => {
    expect(parseSupportedCalls(["      Field Name   Details", "      Name   Type"])).toBeUndefined();
  });

  it("an unknown call aborts naming it", () => {
    expect(() => parseSupportedCalls(["Supported Calls", "frobnicate()"])).toThrow(/unknown Supported Call\(s\) frobnicate/);
  });

  it("parseObjectReference keeps supportedCalls and rejects a token outside the vocabulary", () => {
    expect(parseObjectReference("X", { object: "X", supportedCalls: ["update", "create"], fields: {} }).supportedCalls).toEqual(["create", "update"]);
    expect(() => parseObjectReference("X", { object: "X", supportedCalls: ["frobnicate"], fields: {} })).toThrow(GeneratorError);
    expect(() => parseObjectReference("X", { object: "X", supportedCalls: ["frobnicate"], fields: {} })).toThrow(/object-reference X: unknown Supported Call "frobnicate"/);
    expect(parseObjectReference("X", { object: "X", fields: {} }).supportedCalls).toBeUndefined();
  });
});
