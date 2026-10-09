import { describe, expect, it } from "vitest";
import { splitRollupRef, tokenizeFilterValue } from "./rollup.js";

describe("tokenizeFilterValue", () => {
  it("a blank value tokenises to no values, meaning blank", () => {
    expect(tokenizeFilterValue("")).toEqual([]);
    expect(tokenizeFilterValue("   ")).toEqual([]);
  });

  it("a single literal stays one token", () => {
    expect(tokenizeFilterValue("True")).toEqual(["True"]);
    expect(tokenizeFilterValue("  Done ")).toEqual(["Done"]);
  });

  it("unquoted commas separate tokens", () => {
    expect(tokenizeFilterValue("Completed, Cancelled")).toEqual(["Completed", "Cancelled"]);
  });

  it("a quoted token keeps its comma and loses its quotes", () => {
    expect(tokenizeFilterValue('"Completed", "Closed, not Completed"')).toEqual(["Completed", "Closed, not Completed"]);
  });

  it("empty tokens between commas are dropped", () => {
    expect(tokenizeFilterValue("A,,B")).toEqual(["A", "B"]);
  });
});

describe("splitRollupRef", () => {
  it("a Child.Field reference splits into object and field", () => {
    expect(splitRollupRef("Child__c.Amount__c")).toEqual({ object: "Child__c", field: "Amount__c" });
  });

  it("anything but exactly one dot is not a roll-up reference", () => {
    expect(splitRollupRef("Amount__c")).toBeUndefined();
    expect(splitRollupRef("A.B.C")).toBeUndefined();
    expect(splitRollupRef("")).toBeUndefined();
  });
});
