---
phase: 07-conformance-re-run-milestone-acceptance
plan: 04
subsystem: testing
tags: [jsforce, conformance, bulk2, readme]
requires:
  - phase: 07-conformance-re-run-milestone-acceptance
    provides: "07-03 pinned harness and bulk2 classification"
provides:
  - "Final BULK2_FILTER (3 alternatives, 5 tests excluded)"
  - "jsforce README with two dated result tables and per-exclusion reasons"
affects: [07-05, 07-06]
key-files:
  modified: [conformance/jsforce/run.sh, conformance/jsforce/README.md, conformance/jsforce/seed.mjs]
key-decisions:
  - "Branch B: no orglet code change; empty-input, Jigsaw and Id-less upsert bulk2 tests excluded"
requirements-completed: []  # ACCEPT-02, ACCEPT-03 deferred to 07-06
duration: n/a
completed: 2026-10-12
---

# Phase 7 Plan 04: Final jsforce run and README Summary

**Default `run.sh` measured green (0 failed in both Jest invocations) on a fresh schema with the final BULK2_FILTER; README rewritten with dated tables and a reason per exclusion.**

## Task Commits
1. Task 1: BULK2_FILTER - `492c66a` (packages/ untouched, branch B)
2. Task 2: README + seed.mjs comment - see git log (`docs(07-04)`)

## Measured (2026-10-12, orglet 492c66a, jsforce 9bae14e / 3.10.26, Node v22.23.3, fresh schema jsconf7, port 8092)
exit=0. Log: scratchpad `jsforce-07-04.log`.
- `Tests:       60 skipped, 51 passed, 111 total` (core)
- `Tests:       5 skipped, 12 passed, 17 total` (bulk2)

12/0/5 matches the 07-03 expectation, measured.

## Filter vs README
- BULK2_FILTER: `with empty input and not raise client input error` (2 tests), `bulk insert from file and return inserted results` (2), `bulk upsert from CSV file using backquote as a delimiter` (1) - each has a README Exclusions row (not-implemented, not-implemented, test-defect), matching the 07-03 decision.
- CORE_FILTER: all 15 alternatives have README rows (bulk/Bulk/allowBulk, Query#update/destroy, search records, layout/list view/listup list, tabs list/theme information/recently accessed, identity information, already existing, randomly-waiting).

## Deviations
None to the plan's tasks. Note: README states CI runs the default `run.sh` in a `conformance` job; that job does not exist yet and is added by 07-05 (README sentence is forward-looking until then). Full `pnpm test/lint` not re-run since no package code changed.

## Requirements
ACCEPT-02, ACCEPT-03: deferred to 07-06.

## Known Stubs
None.

## Self-Check: PASSED
