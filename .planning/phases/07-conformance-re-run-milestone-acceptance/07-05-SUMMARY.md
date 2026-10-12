---
phase: 07-conformance-re-run-milestone-acceptance
plan: 05
subsystem: testing
tags: [conformance, ci, github-actions, run-all]
requires:
  - phase: 07-conformance-re-run-milestone-acceptance
    provides: "07-04 final jsforce run and filters"
provides:
  - "conformance/run-all.sh running all 8 conformance legs, never calling reset"
  - "conformance job in .github/workflows/ci.yml, green on GitHub"
affects: [07-06]
key-files:
  created: [conformance/run-all.sh]
  modified: [.github/workflows/ci.yml, conformance/describe-check/README.md, conformance/poly-check/README.md, conformance/rollup-check/README.md]
key-decisions:
  - "run-all.sh never resets the schema, so a mistyped ORG_SCHEMA cannot drop an existing one"
  - "jsforce checkout cached on the pinned JSFORCE_SHA, extracted from run.sh by sed"
requirements-completed: []  # ACCEPT-01..03 deferred to 07-06
duration: n/a
completed: 2026-10-12
---

# Phase 7 Plan 05: Conformance run-all and CI job Summary

**One script (`conformance/run-all.sh`) runs all eight conformance legs; a new `conformance` CI job runs it and passed on GitHub alongside test-pglite and test-postgres.**

## Task Commits
1. Task 1: run-all.sh and three README updates - `c706d74`
2. Task 2: `conformance` job in ci.yml (setup-python@v7, actions/cache@v6, Postgres 16 service, Node from .nvmrc) - `ecc6283`
3. Task 3: push decision - Johan: push (2026-10-12)
4. Task 4: push and CI watch - no new commit

## Local measurement (schema ciconf7, port 8093)
`exit=0`, 8 PASS lines: jsforce core `Tests: 60 skipped, 51 passed` (51/0/60), bulk2 12 passed/5 skipped (12/0/5), python 29/29, describe 14/14 + 14/14, poly 4/4 + 4/4, rollup 5/5 + 5/5.

## CI (Task 4)
Johan: push (2026-10-12). One `git push -u origin gsd/phase-07-conformance-re-run-milestone-acceptance`; no further pushes.
Run: https://github.com/snorf/orglet/actions/runs/38248142895, headSha ecc6283a92a9bb557b0d52b91ff1be714cef36b8 (equals pushed HEAD).
- test-pglite success
- test-postgres success
- conformance success (12:17:52 to 12:20:37, about 2m45s)

Cache state: cold. `actions/cache` reported "Cache not found" for key `jsforce-Linux-9bae14e...`, so jsforce was cloned and built in that run; the cache is saved for later runs. Node pnpm cache was a hit.
Validation of ci.yml: done by the CI run itself (no actionlint used).

## Deviations
None - plan executed as written. No rulesets or required checks touched.

## Requirements
ACCEPT-01..03: deferred to 07-06 (left Pending in REQUIREMENTS.md).

## Known Stubs
None.

## Self-Check: PASSED
