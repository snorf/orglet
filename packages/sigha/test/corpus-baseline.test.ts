/**
 * Orglet-owned guard of the vendored corpus pass count (D-03/D-04). Only corpus/salesforce-v2.json (the BSD-3
 * formula-engine oracle) is locked; org-verified.json deliberately is not. "Pass" means runRow(row).status === "pass"
 * with no exclusion list, which equals the vendored test's 6312 because its 47 excluded rows are all raw fails.
 * It lives outside src/ so every sync-sigha.sh run leaves it in place.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CorpusRow } from "../src/engine/corpus.js";
import { runRow } from "../src/engine/conformance.js";

const MIN_ROWS = 9730;
const MIN_PASS = 6312;
const rows = JSON.parse(readFileSync(new URL("../corpus/salesforce-v2.json", import.meta.url), "utf8")) as CorpusRow[];

describe("vendored salesforce-v2 corpus (orglet-owned baseline, D-03)", () => {
  it("keeps at least the v1.0 baseline of 6312 passing rows, so a resync cannot silently lose cases", () => {
    const pass = rows.filter((r) => runRow(r).status === "pass").length;
    expect(rows.length).toBeGreaterThanOrEqual(MIN_ROWS);
    expect(pass).toBeGreaterThanOrEqual(MIN_PASS);
  });
});
