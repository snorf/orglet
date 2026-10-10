---
phase: 06-bulk-api-2-0-persistence
plan: 02
subsystem: api
tags: [bulk-api, soql, ast, soql-parser-js]
requires: []
provides:
  - parseBulkQuery / bulkQueryViolation pure Bulk SOQL rule check in packages/api/src/bulk
affects: [06-05]
tech-stack:
  added: ["@jetstreamapp/soql-parser-js ^8.1.0 (on @orglet/api)"]
  patterns: [AST walk over parser output, no REST compiler involvement]
key-files:
  created: [packages/api/src/bulk/soql-rules.ts, packages/api/src/bulk/soql-rules.test.ts]
  modified: [packages/api/package.json, pnpm-lock.yaml]
key-decisions:
  - "Rejection wording `Bulk API 2.0 query jobs do not support <construct>` is orglet's own; the guide documents the construct list but no error shape"
  - "WHERE semi-joins are now accepted; the old /\\(\\s*select\\b/i regex rejected them"
  - "Parser strips a FROM alias into objectPrefix itself, so no alias handling is needed; path reported via rawValue"
requirements-completed: [BULK-05]
duration: 8min
completed: 2026-10-10
---

# Phase 6 Plan 02: Bulk SOQL restriction check Summary

Pure AST-based `bulkQueryViolation` rejecting TYPEOF, GROUP BY (incl. ROLLUP/CUBE), OFFSET, aggregates, FIELDS(), child subqueries and Address/Location fields, with locked D-17 wording; route wiring is plan 06-05.

## Commits
- d1951b5 test(06-02): failing tests + parser dependency
- 0a9ac19 feat(06-02): implementation

## Decisions
- Wording is orglet's own and undocumented by Salesforce; no `UNSUPPORTED:` prefix.
- WHERE semi-joins are accepted (the old regex rejected them); Heimdall needs them.
- Compound `Name` is not rejected (D-18).

## Deviations from Plan
**1. [Rule 1 - Bug] Alias handling dropped.** The plan's alias-stripping assumed `SELECT a.Name FROM Account a` yields `relationships: ["a"]`. The parser actually yields a `Field` with `objectPrefix: "a"` and `rawValue`, so the alias step was unnecessary; the reported path uses `rawValue`. Behaviour matches the plan's tests.

**2. Minor:** `pnpm add` reordered two existing entries in `packages/api/package.json` (alphabetical); no version change, lockfile gained only the importer entry.

## Verification
31 vitest tests pass (no DB); scoped eslint clean; `tsc --noEmit -p tsconfig.test.json` has no errors in these files; `packages/soql` untouched. `pnpm build` not run (wave-1 rule).

## Known Stubs
None.

## Self-Check: PASSED
