---
phase: 14-check-report-enterprise-acceptance
verified: 2026-10-29T14:00:00Z
status: gaps_found
score: 3/4 success criteria verified
gaps:
  - truth: "The author's large real-org retrieve (local only) reports zero warnings for everything it references (success criterion 4 / ACC2-03)"
    status: failed
    reason: "DE retrieve leg holds (check --strict exit 0, 0 warnings). Large retrieve reports 150 warnings: standard-field 37 (vs 19 accepted exclusions), custom-metadata-record 24, formula 28, object-kind 11, reference-target 50."
    artifacts:
      - path: "conformance/README.md"
        issue: "Records the counts honestly; criterion itself unmet"
    missing:
      - "Gap-closure plan covering the generic areas once the author has triaged the 150 warnings locally (no names in repo)"
      - "Re-run on the large retrieve until zero warnings beyond accepted exclusions, then tick ACC2-03"
---

# Phase 14: Check Report & Enterprise Acceptance Verification Report

**Phase Goal:** `orglet check` reads as an actionable report on a large retrieve, and the milestone is proven against a public enterprise-shaped fixture, both SDK suites and the author's real retrieves.
**Status:** gaps_found. Re-verification: No.

## Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | check on acme prints census, verdict, per-area table, grouped cascades, deterministic order, warning: lines unchanged | VERIFIED | `packages/cli/src/report.ts`, snapshots `__snapshots__/check-acme.txt`; `pnpm vitest run packages/cli/src` = 61/61 pass (report 18, enterprise 11, main 32) |
| 2 | --summary redacted, --json, --strict semantics | VERIFIED | `main.ts` flags (lines 6-40, 77-109), `summariseCheckReport`, summary snapshot, tests pass |
| 3 | examples/enterprise passes check --strict in CI; run-all.sh green, every exclusion classified | VERIFIED | Fixture exists; CI step at `.github/workflows` line 28 and matrix over acme/enterprise; enterprise.test.ts passes; 14-07 records run-all enterprise exit 0, 11 legs, at 05ddbe9 (not re-run, per instruction). The one added jsforce exclusion (asterisk select) is classified UNSUPPORTED:soql-formula, backlog 999.12, documented in conformance/jsforce/README.md: satisfies "every exclusion still classified". |
| 4 | DE retrieve exit 0; large retrieve zero warnings, counts per area in conformance/README.md | FAILED (partial) | DE: exit 0, 0 warnings (recorded). Large: 150 warnings; counts recorded per area, no names. |

**Score:** 3/4

## Requirements Coverage

| ID | Status | Evidence |
|----|--------|----------|
| CHECK-01 | SATISFIED | report core + snapshot tests; ticked in REQUIREMENTS.md |
| CHECK-02 | SATISFIED | --summary/--json/--strict tests; ticked |
| ACC2-01 | SATISFIED | examples/enterprise, CI step, 0 warnings exit 0 |
| ACC2-02 | SATISFIED | describe/poly/rollup-check extended (38/38, 6/6, 6/6 on enterprise) per README and 14-07 |
| ACC2-03 | BLOCKED | Correctly left unticked (traceability "Partial") |

No orphaned requirement IDs: all five phase IDs appear in plans and REQUIREMENTS.md.

## Anti-Patterns
None found in the verified CLI files; working tree clean.

## Human Verification
None beyond the author's local triage and re-run of the large retrieve (required for gap closure).

## Gaps Summary
Single gap: ACC2-03 / criterion 4 large-retrieve leg. Scope: 150 warnings in five generic areas (standard-field 37 vs 19 accepted, custom-metadata-record 24, formula 28, object-kind 11, reference-target 50). The author is triaging locally; feed into `/gsd:plan-phase 14 --gaps`. The report itself and the acceptance bookkeeping are honest and correct.

_Verifier: Claude (gsd-verifier). Not committed._
