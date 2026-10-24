/** Phase 13: roll-ups over formula fields recompute in the save pipeline (D-14..D-16) and are backfilled once by the engine (D-10..D-13). Filled by plans 13-06 and 13-07. */
import { describe, it } from "vitest";

describe("RollupRegistry watched set", () => {
  it.todo("watches the stored fields a formula roll-up reads, transitively through formula-on-formula");
  it.todo("watches the roll-up column a formula reads (formula on roll-up)");
});

describe("formula roll-up recompute", () => {
  it.todo("insert, update, delete and undelete of children move a formula roll-up exactly as a stored one");
  it.todo("updating a field only the formula reads recomputes the parent");
  it.todo("reparenting moves the value from the old parent to the new one");
  it.todo("filters and valueFields on formula fields count exactly the matching children");
  it.todo("number formula values are rounded to the formula's scale before they are summed");
  it.todo("MIN and MAX over Date and DateTime formulas");
  it.todo("a stored-field roll-up on the same parent keeps the SQL path");
  it.todo("a formula reading a roll-up feeds a roll-up one level up");
});

describe("formula roll-up backfill", () => {
  it.todo("backfills a formula roll-up added to tables with rows once, lower chain levels first, without parent hooks");
  it.todo("a second backfill runs nothing");
  it.todo("a missing marker row is redone after a crash");
  it.todo("backfills in import mode too");
  it.todo("a roll-up skipped at admission answers INVALID_FIELD in SOQL");
});
