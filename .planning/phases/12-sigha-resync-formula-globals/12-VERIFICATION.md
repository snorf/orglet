---
phase: 12-sigha-resync-formula-globals
verified: 2026-10-23T16:00:00Z
status: human_needed
score: 5/5 success criteria verified in code (criterion 1 Linux half pending CI)
human_verification:
  - test: "Push the branch (Johan's call) and let CI job sigha-sync-check run"
    expected: "Job clones the fork named on VENDOR.md's Repository: line, re-runs scripts/sync-sigha.sh at the pinned SHA, and the diff is empty on Linux"
    why_human: "The Linux leg has not run (branch unpushed). Only macOS was exercised."
---

# Phase 12: sigha Resync & Formula Globals Verification Report

**Goal:** Formulas and validation rules that use `!`, `Relationship:Object.Field` and the extra global variables compile and evaluate instead of raising warnings.
**Re-verification:** No, initial.

## Criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Pinned resync, corpus >= 6312, `sync-sigha.sh` on macOS and Linux, `!` as NOT | VERIFIED on macOS; Linux PENDING | `packages/sigha/VENDOR.md` has the full SHA `ff6c108786e0...` and `Repository:` set to the snorf fork. `corpus-baseline.test.ts` passes: salesforce-v2 pass 6312, fail 0, total 9730. `expectations.test.ts` (now `it`, not `it.fails`) passes, including `!ISBLANK`, `!(Name = 'x')`, and the test "`!` and `:` inside string literals are plain text". The sync script uses `sed -i.bak` and `.bak` files are cleaned (0 left), which is portable between BSD and GNU sed. Not run on Linux: CI `sigha-sync-check` reads the `Repository:` line, but it has not executed. |
| 2 | `Owner:User.Email`, `Owner:Queue.Name`, blank on the other type, bad qualifier fails to compile | VERIFIED | `compile.ts` ~L185-200: `Queue` aliases `Group`, and a qualifier that is not among `referenceTo` throws `fieldNotFound` ("Field ... does not exist. Check spelling."). Plain `Owner.Name` on a polymorphic lookup still fails. `engine/src/polymorphic-formula.test.ts` passes (6 tests). |
| 3 | `$UserRole` blank without role; `$Api` URLs and Session_ID | VERIFIED | `compile.ts` ~L254-266 handles `$Api`. Suffix `n/10` formatted to one decimal. `api/src/formula-globals.test.ts` (4) and `engine/src/formula-globals.test.ts` (10) pass. Both cover `$UserRole` and `$Api` with and without a request. |
| 4 | `$Label` and `$CustomMetadata` resolve; unknowns error; unknown record is blank with one aggregated `UNSUPPORTED:custom-metadata-record` | VERIFIED | `compile.ts` L90 diagnostic; coverage in `formula/src/globals.test.ts`, `engine/src/formulas.test.ts`, `api/src/custom-metadata.test.ts` (13). All pass. |
| 5 | `$Setup` hierarchy user, then profile, then org; list setting and `$Permission` raise `UNSUPPORTED:formula-global` with a reason | VERIFIED | `compile.ts` L278-290 (list setting: "is not available: ... List custom settings are accessible only from code") and L274 (`$Permission`: "...needs custom permissions and permission sets, which orglet does not model"). Per-field order is asserted in the engine test "hierarchy settings resolve user, then profile, then organization, per field". |

Targeted run: `pnpm vitest run packages/sigha packages/formula packages/engine/src/polymorphic-formula.test.ts packages/engine/src/formula-globals.test.ts packages/api` gave 18 files, 243 passed, 1 skipped. The orchestrator's full gate (805/807 passing, build, lint, typecheck:scripts, conformance 10/10) was not re-run. I accept it as reported.

## Requirements cross-reference

| ID | Plans | REQUIREMENTS.md | Status |
|----|-------|-----------------|--------|
| FORM-01 | 12-01, 12-02, 12-08 | `[x]`, Complete | Satisfied (macOS; Linux CI pending) |
| FORM-02 | 12-02, 12-03, 12-08 | `[x]`, Complete | Satisfied |
| FORM-03 | 12-04, 12-06, 12-07, 12-08 | `[x]`, Complete | Satisfied |
| FORM-04 | 12-05, 12-08 | `[x]`, Complete | Satisfied |
| FORM-05 | 12-04, 12-06, 12-08 | `[x]`, Complete | Satisfied |

All five IDs are claimed by plans. There are no orphaned requirements.

## Locked decisions D-01..D-18

- D-01..D-05: fork pin, `Repository:` line, pending-branches table and D-02 re-pin text in `VENDOR.md`. The measured baseline is locked outside `src` and covers salesforce-v2 only. The `it.fails` tests are flipped and the `unexpected-character` fallback is gone from `compile.ts`. Honoured.
- D-06..D-09: `$Api` implemented. The `_<n>` suffix is the API version times ten, a sanctioned deviation, because D-08 lets the documented shape win. Blank plus one warning when no request context exists, covered by tests. Honoured.
- D-10..D-13: the `Queue` to `Group` alias, typed hops continuing like ordinary lookups, and plain polymorphic traversal failing are all in `compile.ts`. Honoured. A qualifier that is not a declared target errors using the generic "does not exist" wording.
- D-14, D-15: `dependencies.test.ts` is present and passing (it was part of the formula run).
- D-16..D-18: verified through the tests above. I did not inspect the `defaultValue` fallback behaviour for hierarchy settings in detail.

## Sanctioned deviations

All three are acceptable. `$Api` suffix times ten is documented and D-08 allows it. `QueueName`/`QueueEmail` alias to Group `Name`/`Email`, following the research recommendation under D-10. The corpus guard sits in `packages/sigha/test/corpus-baseline.test.ts`, outside `src`, so the sync script does not wipe it.

## Gaps and anti-patterns

None blocking. I did not run a repo-wide stub scan beyond the targeted files. One minor observation: a wrong-type qualifier produces the generic "Field ... does not exist. Check spelling." error, not a distinct message. This fits D-13.

## Human verification required

1. Linux half of criterion 1. Push the branch (Johan's decision) and confirm CI `sigha-sync-check` goes green. Until then criterion 1 is proven on macOS only, which is why the status is human_needed and not passed.

---
_Verified: 2026-10-23_
_Verifier: Claude (gsd-verifier)_
