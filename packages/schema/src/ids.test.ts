import { describe, expect, it, vi } from "vitest";
import { generateId, keyPrefixOf, normalizeId, toCaseSafeId } from "./ids.js";

describe("case-safe ID checksum", () => {
  // Pairs published in Salesforce community answers and widely reused in test suites.
  const known: [string, string][] = [
    ["001A0000006Vm9r", "001A0000006Vm9rIAC"],
    ["00D50000000IZ3Z", "00D50000000IZ3ZEAW"],
    ["0013000000ABCde", "0013000000ABCdeAAH"],
  ];

  it.each(known)("%s -> %s", (id15, id18) => {
    expect(toCaseSafeId(id15)).toBe(id18);
  });

  it("returns the same 18-character ID for the 15- and 18-character inputs", () => {
    for (const [id15, id18] of known) {
      expect(normalizeId(id15)).toBe(id18);
      expect(normalizeId(id18)).toBe(id18);
      expect(normalizeId(id18.toLowerCase())).toBeUndefined(); // body case matters, suffix does not
      expect(normalizeId(id15 + id18.slice(15).toLowerCase())).toBe(id18);
    }
  });

  it("rejects malformed IDs", () => {
    expect(normalizeId("")).toBeUndefined();
    expect(normalizeId("001A0000006Vm9")).toBeUndefined();
    expect(normalizeId("001A0000006Vm9r!AC")).toBeUndefined();
    expect(normalizeId("001A0000006Vm9rZZZ")).toBeUndefined();
  });
});

describe("generateId", () => {
  it("produces valid, unique, increasing 18-character IDs with the key prefix", () => {
    const ids = Array.from({ length: 2000 }, () => generateId("001"));
    for (const id of ids) {
      expect(id).toHaveLength(18);
      expect(keyPrefixOf(id)).toBe("001");
      expect(normalizeId(id)).toBe(id);
    }
    expect(new Set(ids).size).toBe(ids.length);
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  it("keeps IDs increasing when the counter wraps inside one millisecond", () => {
    // Freeze the clock so every ID lands in the same millisecond and the 3-character counter must wrap.
    const frozen = Date.now();
    const spy = vi.spyOn(Date, "now").mockReturnValue(frozen);
    try {
      const ids = Array.from({ length: 62 ** 3 + 1 }, () => generateId("001"));
      expect(new Set(ids).size).toBe(ids.length);
      expect([...ids].sort()).toEqual(ids);
    } finally {
      spy.mockRestore();
    }
  });

  it("keeps IDs increasing when the wall clock steps backwards", () => {
    const start = Date.now() + 10_000;
    const spy = vi.spyOn(Date, "now");
    try {
      spy.mockReturnValue(start);
      const first = generateId("001");
      spy.mockReturnValue(start - 5_000);
      const second = generateId("001");
      expect(second > first).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("rejects a bad key prefix", () => {
    expect(() => generateId("00")).toThrow();
  });
});
