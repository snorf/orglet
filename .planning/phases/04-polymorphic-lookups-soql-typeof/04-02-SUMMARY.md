---
phase: 04-polymorphic-lookups-soql-typeof
plan: 02
subsystem: soql
tags: [soql, typeof, errors, poly-06]
requires: []
provides:
  - "TYPEOF_RESTRICTIONS, diagnoseTypeofParseError, assertTypeofAllowed in packages/soql/src/typeof.ts"
affects: [04-04, 04-05]
tech-stack:
  added: []
  patterns: ["errors-first: AST check runs before countOnly/aggregate decision"]
key-files:
  created: [packages/soql/src/typeof.ts]
  modified: [packages/soql/src/compile.ts, packages/soql/src/compile.test.ts]
key-decisions:
  - "Parse errors containing TYPEOF are diagnosed by a text heuristic; the parser message is kept when no restriction matches"
  - "TYPEOF in child subqueries is UNSUPPORTED:polymorphic-subquery (D-17)"
requirements-completed: [POLY-06]
duration: 40min
completed: 2026-10-08
---

# Phase 4 Plan 02: TYPEOF restriction errors Summary

Every documented invalid TYPEOF form now ends as MALFORMED_QUERY naming the restriction (SOQL reference wording), and TYPEOF in child subqueries is gated as UNSUPPORTED:polymorphic-subquery.

## Tasks
1. typeof.ts + compile.ts hooks + 13 tests in `describe("TYPEOF restrictions")` (RED confirmed with 11 failures, then GREEN). Commit 7433c9a.

## Verification
- `pnpm vitest run packages/soql/src/compile.test.ts`: 27 passed.
- `pnpm build` clean, `pnpm lint` clean, `pnpm test`: 16 files, 200 passed, 2 skipped (pre-existing skips).

## Deviations from Plan
None in code. Note: a first full `pnpm test` run chained after build and lint in one command showed 8 failed files (timeouts, 719s); an isolated rerun of `pnpm test` passed in 6.7s, so it was environmental contention, not a code failure.

## Known Stubs
None. The `FieldTypeof` case in `compileSObjectSelect` still throws `UNSUPPORTED:soql-typeof` by design until plan 04-05.

## Self-Check: PASSED
