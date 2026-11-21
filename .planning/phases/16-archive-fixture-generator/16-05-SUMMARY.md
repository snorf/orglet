---
phase: 16-archive-fixture-generator
plan: 05
subsystem: scripts, examples
tags: [fixture, archive, heimdall, generator]
requires: [16-01, 16-02, 16-03, 16-04]
provides:
  - "scripts/gen-archive-fixture/build.ts: buildFixture() (filesystem-free)"
  - "pnpm archive-fixture:gen / archive-fixture:check"
  - "examples/acme-archive/ committed fixture (35 files)"
affects: [17, 18, 20, 21]
key-files:
  created: [scripts/gen-archive-fixture/build.ts, scripts/gen-archive-fixture/readme.ts, scripts/gen-archive-fixture/tree.ts, scripts/gen-archive-fixture/generate.ts, .gitattributes, examples/acme-archive/]
  modified: [package.json]
decisions:
  - "Synthetic CSV file names are 750-prefixed case-safe Ids from a counter shared by both periods"
  - "BigTable__c uses LIMIT 8 so it splits into two CSVs per period"
requirements-completed: [FIX-01]
metrics:
  tasks: 2
  completed: 2026-11-07
---

# Phase 16 Plan 05: Generator assembly and committed fixture Summary

`pnpm archive-fixture:gen` builds the acme archive in memory (seed, two Bulk 2.0 exported periods, leak guard, index rows, blobs, index.sql, README) and writes 35 files under examples/acme-archive/ (232 KB); `archive-fixture:check` exits 1 on missing, differing or stray files.

## Tasks
1. buildFixture + README generator: f170e59
2. tree helpers, CLI, root scripts, .gitattributes, committed fixture: 82a4530

## Verification
- gen twice gives identical output; check exits 0 ("checked 35 files"); a stray file makes check exit 1 (verified, then removed)
- Layout: Period=202601, Period=202602, Period=0/files, Contact_deleted and Opportunity_deleted in period 2, 4 BigTable__c CSVs
- index.sql has 3 CREATE TABLE and Failed runs
- `pnpm typecheck:scripts`, `pnpm lint` green. Full vitest not re-run in this plan (no package code changed).

## Deviations from Plan
None. Note: period 1 has no `_deleted` CSVs (nothing is deleted before period 2).

## Known Stubs
None.

## Self-Check: PASSED
