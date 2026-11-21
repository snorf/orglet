/** Key and period rules, with hand-written expected strings. */
import { describe, expect, it } from "vitest";
import { blobObjectKey, csvKey, epochSeconds, periodInt, periodSegment } from "./keys.js";

const base = {
  orgId: "00D000000000001EAA",
  period: "202601",
  uploaded: "2026-01-31T02:00:00.000+0000",
  objectName: "Account",
  deleted: false,
  fileName: "750000000000001AAA.csv",
};

describe("periods", () => {
  it("formats the index period as YYMM but the key segment as yyyyMM", () => {
    expect(periodSegment(2026, 1)).toBe("202601");
    expect(periodSegment(2026, 12)).toBe("202612");
    expect(periodInt(2026, 1)).toBe(2601);
    expect(periodInt(2026, 2)).toBe(2602);
    expect(periodInt(2030, 11)).toBe(3011);
  });
});

describe("csvKey", () => {
  it("builds the partitioned key with two-digit month and date", () => {
    expect(csvKey(base)).toBe("OrgId=00D000000000001EAA/Period=202601/Year=2026/Month=01/Date=31/Account/750000000000001AAA.csv");
  });
  it("puts deleted rows under an <Object>_deleted folder", () => {
    expect(csvKey({ ...base, deleted: true, objectName: "Contact" })).toBe(
      "OrgId=00D000000000001EAA/Period=202601/Year=2026/Month=01/Date=31/Contact_deleted/750000000000001AAA.csv",
    );
  });
  it("takes Year/Month/Date from the UTC upload time", () => {
    expect(csvKey({ ...base, uploaded: "2026-02-03T23:59:59.000+0000" })).toContain("Year=2026/Month=02/Date=03/");
  });
  it("rejects bad parts by name and never echoes a rejected value in a key error", () => {
    const cases: [Partial<typeof base>, string, string][] = [
      [{ orgId: "SECRET-org" }, "orgId", "SECRET-org"],
      [{ objectName: "Bad/SECRET" }, "objectName", "SECRET"],
      [{ fileName: "a/SECRET.csv" }, "fileName", "SECRET"],
      [{ fileName: "SECRET.txt" }, "fileName", "SECRET"],
    ];
    for (const [over, part, secret] of cases) {
      let msg = "";
      try {
        csvKey({ ...base, ...over });
      } catch (e) {
        expect(e).toBeInstanceOf(RangeError);
        msg = (e as Error).message;
      }
      expect(msg).toContain(part);
      expect(msg).not.toContain(secret);
    }
  });
});

describe("blobObjectKey", () => {
  it("places blobs under Period=0", () => {
    expect(blobObjectKey("00D000000000001EAA", "files/0cc1/0cc175b9c0f1b6a831c399e269772661.txt")).toBe(
      "OrgId=00D000000000001EAA/Period=0/files/0cc1/0cc175b9c0f1b6a831c399e269772661.txt",
    );
  });
  it("refuses keys outside files/", () => {
    expect(() => blobObjectKey("00D000000000001EAA", "other/x")).toThrow(RangeError);
  });
});

describe("epochSeconds", () => {
  it("floors milliseconds", () => {
    expect(epochSeconds("2026-01-10T09:00:00.000+0000")).toBe(1768035600);
    expect(epochSeconds("2026-01-10T09:00:00.999+0000")).toBe(1768035600);
  });
  it("rejects anything but the +0000 form", () => {
    expect(() => epochSeconds("2026-01-10T09:00:00Z")).toThrow(RangeError);
  });
});
