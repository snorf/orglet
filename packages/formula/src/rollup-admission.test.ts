/** Phase 13 admission of roll-ups over formula fields (ROLL2-01, D-01..D-09): which formula roll-ups load, which degrade with UNSUPPORTED:rollup-formula or UNSUPPORTED:rollup-cycle, and that warnings and diagnostics stay 1:1. Filled by plan 13-03. */
import { describe, it } from "vitest";

describe("admitFormulaRollups", () => {
  it.todo("keeps a roll-up over a same-object non-volatile formula");
  it.todo("keeps a roll-up whose filter or valueField is a same-object formula");
  it.todo("keeps a roll-up over a formula that reads another qualifying formula");
  it.todo("keeps a roll-up over a formula that uses $Label, $CustomMetadata or $System.OriginDateTime");
  it.todo("drops a roll-up over a cross-object formula with UNSUPPORTED:rollup-formula naming the path");
  it.todo("drops roll-ups over NOW, TODAY and TIMENOW formulas naming the function");
  it.todo("drops roll-ups over $User, $Profile, $Setup, $Api, $Organization, $UserRole and $RecordType formulas naming the global");
  it.todo("names the inner formula that breaks the rule in a formula chain");
  it.todo("reports a formula -> roll-up -> formula cycle once per roll-up with the full path and skips every roll-up on it");
  it.todo("drops a roll-up that summarises a skipped roll-up with a cause");
  it.todo("keeps warnings and diagnostics 1:1 and returns the input unchanged when nothing is formula-backed");
});
