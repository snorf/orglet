/** Heimdall column, SOQL, objects.name and objects.metadata rules with hand-written expectations. */
import { describe, expect, it } from "vitest";
import { heimdallColumns, heimdallSoql, objectMetadata, objectRecordName, soqlDatetime } from "./columns.js";

describe("heimdallColumns", () => {
  const fields = [
    { name: "Id", type: "id" },
    { name: "IsDeleted", type: "boolean" },
    { name: "Name", type: "string" },
    { name: "BillingAddress", type: "address" },
    { name: "BillingCity", type: "string" },
    { name: "Photo", type: "base64" },
    { name: "Tier", type: "picklist" },
    { name: "Tier__c", type: "picklist" },
    { name: "SystemModstamp", type: "datetime" },
    { name: "OwnerId", type: "reference" },
  ];
  it("puts SystemModstamp then Id last, after every other describe field", () => {
    expect(heimdallColumns(fields)).toEqual(["IsDeleted", "Name", "BillingCity", "Tier__c", "OwnerId", "SystemModstamp", "Id"]);
  });
  it("excludes compound address and base64 fields case-insensitively but keeps their components", () => {
    expect(heimdallColumns([{ name: "A", type: "Address" }, { name: "B", type: "Base64" }, { name: "C", type: "string" }])).toEqual(["C"]);
  });
  it("omits SystemModstamp when the object has none", () => {
    expect(heimdallColumns([{ name: "Id", type: "id" }, { name: "Name", type: "string" }])).toEqual(["Name", "Id"]);
  });
});

describe("heimdallSoql", () => {
  it("orders by SystemModstamp then Id with a limit", () => {
    expect(heimdallSoql("Account", ["Name", "SystemModstamp", "Id"], { deleted: false, limit: 50000 })).toBe(
      "SELECT Name, SystemModstamp, Id FROM Account ORDER BY SystemModstamp ASC, Id ASC LIMIT 50000",
    );
  });
  it("resumes after a checkpoint and filters deleted rows", () => {
    expect(
      heimdallSoql("Contact", ["Name", "SystemModstamp", "Id"], {
        deleted: true,
        checkpoint: { modstamp: "2026-01-15T12:00:00.000+0000", id: "003000000000004AAA" },
        limit: 8,
      }),
    ).toBe(
      "SELECT Name, SystemModstamp, Id FROM Contact WHERE IsDeleted = true AND ((SystemModstamp = 2026-01-15T12:00:00.000Z AND Id > '003000000000004AAA') OR SystemModstamp > 2026-01-15T12:00:00.000Z) ORDER BY SystemModstamp ASC, Id ASC LIMIT 8",
    );
  });
  it("falls back to CreatedDate when the columns lack SystemModstamp", () => {
    expect(heimdallSoql("X__c", ["Name", "Id"], { deleted: false })).toBe("SELECT Name, Id FROM X__c ORDER BY CreatedDate ASC, Id ASC");
  });
  it("rejects a checkpoint id that could break out of the literal, without echoing it", () => {
    let msg = "";
    try {
      heimdallSoql("Account", ["Id"], { deleted: false, checkpoint: { modstamp: "2026-01-15T12:00:00.000+0000", id: "x' OR 'SECRET" } });
    } catch (e) {
      expect(e).toBeInstanceOf(RangeError);
      msg = (e as Error).message;
    }
    expect(msg).toContain("checkpoint id");
    expect(msg).not.toContain("SECRET");
  });
  it("converts +0000 datetimes to the Z literal form", () => {
    expect(soqlDatetime("2026-01-15T12:00:00.000+0000")).toBe("2026-01-15T12:00:00.000Z");
  });
});

describe("objectRecordName", () => {
  it("prefers Name over Subject and skips empty values", () => {
    expect(objectRecordName(["Subject", "Name", "Id"], ["", "Acme", "001000000000001AAA"])).toBe("Acme");
    expect(objectRecordName(["Subject", "Name", "Id"], ["Hello", "Acme", "001000000000001AAA"])).toBe("Acme");
  });
  it("falls back to the Id when no name field has a value", () => {
    expect(objectRecordName(["Title", "Id"], ["", "069000000000001AAA"])).toBe("069000000000001AAA");
  });
});

describe("objectMetadata", () => {
  const refs = new Set(["AccountId", "OwnerId", "ReportsToId"]);
  it("keeps only non-empty reference columns, in header order", () => {
    const m = objectMetadata(
      "Contact",
      ["AccountId", "Email", "OwnerId", "ReportsToId", "Id"],
      ["001000000000001AAA", "a@example.com", "005000000000001AAA", "", "003000000000001AAA"],
      refs,
    );
    expect(m).toEqual({ AccountId: "001000000000001AAA", OwnerId: "005000000000001AAA", Id: "003000000000001AAA" });
    expect(Object.keys(m)).toEqual(["AccountId", "OwnerId", "Id"]);
  });
  const header = ["Checksum", "FileType", "FileExtension", "ContentSize", "Title", "PathOnClient", "TextPreview", "Id"];
  const cells = ["abc", "TEXT", "txt", "12", "Doc", "doc.txt", "preview", "068000000000001AAA"];
  it("adds the six file facts only for ContentVersion", () => {
    expect(objectMetadata("ContentVersion", header, cells, new Set())).toEqual({
      Checksum: "abc",
      FileType: "TEXT",
      FileExtension: "txt",
      ContentSize: "12",
      Title: "Doc",
      PathOnClient: "doc.txt",
      Id: "068000000000001AAA",
    });
    expect(objectMetadata("ContentDocument", header, cells, new Set())).toEqual({ Id: "068000000000001AAA" });
  });
});
