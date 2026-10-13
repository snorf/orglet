---
phase: 08-upgrade-safety-net-nullable-key-prefixes
plan: 01
subsystem: schema
tags: [migrate, postgres, foreign-keys, idempotency]
requires: []
provides:
  - "migrate() skips FKs that existing rows would violate, with an UNSUPPORTED:schema-fk warning"
  - "migrate() skips existing indexes and sequences via pg_indexes/pg_sequences"
affects: [08-07]
tech-stack:
  added: []
  patterns: ["catalog-read skip sets", "pre-check count before ADD CONSTRAINT"]
key-files:
  created: []
  modified:
    - packages/schema/src/migrate.ts
    - packages/schema/src/migrate.test.ts
    - packages/schema/src/pglite-compat.test.ts
key-decisions:
  - "FK pre-check only for tables that existed before the run; skip is not remembered (re-evaluated each run)"
  - "isPgForeignKeyViolation catch path removed; a failed ADD CONSTRAINT aborts the transaction"
requirements-completed: [MIGR-02, MIGR-04]
duration: 15min
completed: 2026-10-13
---

# Phase 8 Plan 01: Upgrade safety net in migrate() Summary

migrate() turns a would-be FK violation into one `UNSUPPORTED:schema-fk` warning (table, column, count) with data intact, and a second run on an up-to-date DB executes no CREATE INDEX / CREATE SEQUENCE.

## Tasks
1. Catalog-read skip for indexes and sequences (pglite backend check first, then migrate.ts) - 66923ae
2. FK pre-check and warning, rewritten dangling-Id test - 66923ae (both tasks touch migrate.ts and were committed together)

## Deviations from Plan
- Both tasks committed in a single commit because they share migrate.ts and were edited together.

## Verification
- `pnpm vitest run packages/schema`: 71 passed, 2 skipped (Postgres-only), on pglite. Postgres 16 not run locally; CI test-postgres covers it.
- eslint clean on the three files.
- `tsc -b packages/schema` reports errors only in `packages/schema/src/prefixes.ts` (lines 270-271, nullable keyPrefix types), caused by the concurrent plan 08-02 changing metadata types; not from this plan.

## Known Stubs
None.

## Self-Check: PASSED
