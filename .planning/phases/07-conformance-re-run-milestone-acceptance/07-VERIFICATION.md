---
phase: 07-conformance-re-run-milestone-acceptance
verified: 2026-10-12T00:00:00Z
status: passed
score: 3/3 success criteria verified
---

# Phase 7: Conformance re-run and milestone acceptance - Verification Report

**Goal:** Milestone acceptance bar verified against the DE retrieve and both SDK suites, results committed and dated.
**Status:** passed. Initial verification.

## Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | `orglet check` on DE retrieve reports zero UNSUPPORTED warnings | VERIFIED | `--strict` implemented in packages/cli/src/main.ts (exit 1 if any warning); main.test.ts 8/8 pass (run here). 07-06-SUMMARY and conformance/README.md record exit 0, 0 warnings, "37 objects (2 custom), 983 fields", consistent in both. Baseline 15 warnings on 2026-09-29 recorded. |
| 2 | Both suites re-run after all milestone changes and green; Bulk classified and v2 included | VERIFIED | jsforce core 51/0/60, bulk2 12/0/5, simple-salesforce 29/29, plus describe/poly/rollup legs, all dated 2026-10-12. run.sh runs two Jest invocations (CORE_FILTER, BULK2_FILTER) at pinned JSFORCE_SHA, no patches, no fetch of main. No packages/ code changed after commit 492c66a (jsforce numbers) and the READMEs' later overview commit is docs-only. CI run reported green. |
| 3 | READMEs updated with dated numbers and reasons for every exclusion | VERIFIED | conformance/jsforce/README.md has dated result tables and an Exclusions table with classification (bulk-v1-excluded, sosl, ui-api, not-implemented, plain-http, test-defect, timeout) for every filter alternative in both filters. python/README.md dated 29/0/0, "No check is excluded". conformance/README.md overview (D-17) links all. |

## Artifacts / wiring
- conformance/run-all.sh: syntax OK (`bash -n`), starts server, 8 legs, non-zero on any FAIL, called by CI.
- conformance/jsforce/run.sh: syntax OK, pinned sha, `--` override path, rc aggregated across both runs.
- .github/workflows/ci.yml: `conformance` job has no `name:` key (D-14, ruleset untouched), caches jsforce by sha, runs run-all.sh.
- packages/api/src/routes/bulk.ts: only fidelity fix is the `sf__Error` " --" separator (commit 127a735) with updated store.test.ts assertions (D-21).

## Requirements Coverage

| ID | Plans | Status |
|---|---|---|
| ACCEPT-01 | 07-01, 07-06 | SATISFIED, [x] and traceability Complete in REQUIREMENTS.md |
| ACCEPT-02 | 07-01..07-06 | SATISFIED, [x] / Complete |
| ACCEPT-03 | 07-02, 07-04, 07-06 | SATISFIED, [x] / Complete |

No orphaned requirement IDs.

## Project constraints
- "devrandom-metadata" is not referenced in .github, conformance/, packages/ or examples/ (grep); mentions exist only in .planning docs (PROJECT.md and plan/context docs, including earlier phases). Nothing copied into the repo. The directory was not read.
- `git log origin/main..HEAD --format=%ae | sort -u` gives only johan@karlsteen.com.
- git status clean.

## Observations (non-blocking)
- jsforce README results cite orglet commit 492c66a, python README 93f32f4, overview 3b6ad5a. Each is the commit at which that leg was measured. The overview table's 3b6ad5a is the final run-all.sh run. Numbers are consistent across files; commit labels differ by design, no code changed between them that affects results.
- The jsforce README mentions the Bulk v1 exclusion. Python README says "No check is excluded" while jsforce excludes 65; both are accurate for their suite.

## Human verification
None required. The DE check evidence (exit 0, 0 warnings, 37 objects, 983 fields) is recorded consistently in 07-06-SUMMARY.md and conformance/README.md.

_Verifier: Claude (gsd-verifier)_
