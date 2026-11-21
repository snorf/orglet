---
phase: 16-archive-fixture-generator
plan: 02
subsystem: engine, test, scripts
tags: [bootstrap, pglite, leak-guard, fixture]
requires: []
provides:
  - BootstrapOptions.now and BootstrapOptions.ids (pinned bootstrap rows)
  - openPgliteDb() always-pglite opener
  - checkLeaks / FixtureLeakError value-free guard
affects: [16-archive-fixture-generator]
tech-stack:
  added: []
  patterns: [options-with-fallback instead of Clock/IdGenerator interfaces]
key-files:
  created: [scripts/gen-archive-fixture/guard.ts, packages/archive/src/guard.test.ts]
  modified: [packages/engine/src/bootstrap.ts, packages/engine/src/bootstrap.test.ts, test/db.ts]
decisions:
  - "Bootstrap pinning is two optional options with ?? fallbacks; generateId unchanged (D-01)"
  - "Guard diagnostics name object and field only, never cell values (D-04, P22)"
metrics:
  duration: ~10min
  completed: 2026-11-07
---

# Phase 16 Plan 02: Generator seams Summary

bootstrapOrg can mint Organization/Profile/User/BusinessHours/UserLicense/RecordType rows with fixed Ids and a fixed stamp, openPgliteDb() opens pglite regardless of ORGLET_DATABASE_URL, and checkLeaks refuses foreign Ids and out-of-window datetimes without echoing values.

## Tasks
1. bootstrapOrg now/ids (f9db591) with two new tests; existing tests unchanged.
2. openPgliteDb export, openTestDb delegates (8edb9be).
3. Leak guard + 5 tests (401b469).

## Verification
bootstrap, schema and guard tests green (123 passed, 2 skipped pre-existing Postgres-only); `pnpm typecheck:scripts` and `pnpm lint` clean.

## Deviations from Plan
None - plan executed as written.

## Known Stubs
None.

## Self-Check: PASSED
