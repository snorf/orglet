import { describe, expect, it } from "vitest";
import { checkLeaks, FixtureLeakError, type GuardCsv } from "../../../scripts/gen-archive-fixture/guard.js";

const WINDOW = { from: "2026-01-01T00:00:00.000+0000", to: "2026-01-31T02:00:00.000+0000" };
const allocated = new Set(["001000000000001AAA", "003000000000001AAA"]);

function contact(row: string[], deleted = false): GuardCsv {
  return {
    objectName: "Contact",
    deleted,
    header: ["Id", "AccountId", "LastModifiedDate", "Birthdate"],
    rows: [row],
    referenceColumns: new Set(["AccountId"]),
  };
}

function leak(csv: GuardCsv): FixtureLeakError {
  try {
    checkLeaks([csv], allocated, WINDOW);
  } catch (err) {
    expect(err).toBeInstanceOf(FixtureLeakError);
    return err as FixtureLeakError;
  }
  throw new Error("expected a FixtureLeakError");
}

describe("checkLeaks", () => {
  it("passes allocated ids and datetimes inside the window", () => {
    expect(() => checkLeaks([contact(["003000000000001AAA", "001000000000001AAA", "2026-01-15T10:00:00.000+0000", ""])], allocated, WINDOW)).not.toThrow();
  });

  it("refuses an Id the generator did not allocate, naming object and field only", () => {
    const err = leak(contact(["003000000000001AAA", "001999999999999AAA", "2026-01-15T10:00:00.000+0000", ""]));
    expect([err.objectName, err.field, err.reason]).toEqual(["Contact", "AccountId", "unallocated-id"]);
    expect(err.message).toContain("Contact.AccountId");
    expect(err.message).not.toContain("001999999999999AAA");
    expect(leak(contact(["003999999999999AAA", "", "2026-01-15T10:00:00.000+0000", ""])).field).toBe("Id");
  });

  it("refuses a datetime outside the period window without printing it", () => {
    const late = leak(contact(["003000000000001AAA", "", "2031-06-15T10:00:00.000+0000", ""]));
    expect([late.field, late.reason]).toEqual(["LastModifiedDate", "datetime-outside-window"]);
    expect(late.message).not.toContain("2031");
    expect(leak(contact(["003000000000001AAA", "", "2025-12-31T23:59:59.999+0000", ""])).reason).toBe("datetime-outside-window");
  });

  it("ignores date-only cells and empty references", () => {
    expect(() => checkLeaks([contact(["003000000000001AAA", "", "2026-01-15T10:00:00.000+0000", "1999-01-01"])], allocated, WINDOW)).not.toThrow();
  });

  it("names the deleted phase as <Object>_deleted", () => {
    expect(leak(contact(["003999999999999AAA", "", "", ""], true)).objectName).toBe("Contact_deleted");
  });
});
