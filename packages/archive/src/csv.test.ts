/** Bulk CSV reader: RFC 4180 parsing and error hygiene. */
import { describe, expect, it } from "vitest";
import { parseBulkCsv, type ArchiveCsvError } from "./csv.js";

function failure(text: string): ArchiveCsvError {
  try {
    parseBulkCsv(text);
  } catch (e) {
    return e as ArchiveCsvError;
  }
  throw new Error("expected parseBulkCsv to throw");
}

describe("parseBulkCsv", () => {
  it("parses quoted fields with embedded newlines, commas and doubled quotes", () => {
    expect(parseBulkCsv('Name,Id\nAcme,001000000000001AAA\n"Line1\nLine2, ""q""",001000000000002AAA\n')).toEqual({
      header: ["Name", "Id"],
      rows: [
        ["Acme", "001000000000001AAA"],
        ['Line1\nLine2, "q"', "001000000000002AAA"],
      ],
    });
  });
  it("yields no rows for a header-only file", () => {
    expect(parseBulkCsv("Name,Id\n").rows).toEqual([]);
  });
  it("reports each malformation with a reason and line", () => {
    expect(failure("Name,Id\nAcme,1")).toMatchObject({ reason: "missing-final-newline", line: 2 });
    expect(failure('Name,Id\n"Acme,1\n')).toMatchObject({ reason: "unterminated-quote", line: 2 });
    expect(failure("Name,Id\nAcme\n")).toMatchObject({ reason: "ragged-row", line: 2 });
    expect(failure("Name,Id\r\nAcme,1\r\n")).toMatchObject({ reason: "carriage-return", line: 1 });
    expect(failure("")).toMatchObject({ reason: "empty" });
  });
  it("never echoes a cell value in a CSV error", () => {
    for (const text of ["A,B\nSECRET-VALUE\n", "A,B\nSECRET-VALUE,x", 'A,B\n"SECRET-VALUE,x\n', "A,B\nSECRET-VALUE,x\r\n"]) {
      expect(failure(text).message).not.toContain("SECRET-VALUE");
    }
  });
});
