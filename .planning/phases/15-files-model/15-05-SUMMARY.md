---
phase: 15-files-model
plan: 05
subsystem: schema, migrate
tags: [not-null, migrate, upgrade, content-version]
requires: ["15-03"]
provides:
  - "STRUCTURAL_NOT_NULL rule; columnFor(field, objectName)"
  - "migrate step 1b: nullability reconcile with UNSUPPORTED:schema-notnull skip-and-warn"
  - "frozen baseline-v1.1 fixture and upgrade-v11.test.ts"
affects: [15-06, 15-07]
key-files:
  modified:
    - packages/schema/src/columns.ts
    - packages/schema/src/ddl.ts
    - packages/schema/src/ddl.test.ts
    - packages/schema/src/migrate.ts
    - packages/schema/src/migrate.test.ts
  created:
    - packages/metadata/test/fixtures/baseline-v1.1/**
    - packages/engine/src/upgrade-v11.test.ts
key-decisions:
  - "NOT NULL only via an explicit Object.Field set, never from nillable:false"
  - "Reconcile is generic: any planned NOT NULL column that is nullable in the database; --force does not change it"
duration: 15min
completed: 2026-11-04
---

# Phase 15 Plan 05: NOT NULL on ContentVersion.ContentDocumentId Summary

ContentVersion.ContentDocumentId is NOT NULL in new orgs; migrate tightens existing columns only when no row is NULL, otherwise warns once per column per run (UNSUPPORTED:schema-notnull) and never rewrites rows.

## Tasks
1. STRUCTURAL_NOT_NULL and migrate step 1b - 38038ea
2. Frozen v1.1 baseline fixture (tag v1.1, commit 281831b) and upgrade-v11.test.ts - bf8b948

## Deviations from Plan
**1. [Rule 1 - test setup] v1.1 database emulation needed DROP NOT NULL.** The structural rule is keyed by name, so migrate on the v1.1 schema already creates the column NOT NULL; upgrade-v11.test.ts drops the constraint before inserting rows to reproduce what v1.1 code produced. Commit bf8b948.

## Notes
- CLI report (packages/cli/src/report.ts) groups by `area` generically, so `schema-notnull` appears as its own per-area count with no change. diagnostics.ts comment not touched (does not enumerate areas).
- The v1.0 upgrade test's EXPECTED_WARNINGS stays `[]`.

## Verification
Run and green: pnpm build, pnpm lint, ddl.test.ts, migrate.test.ts (15), upgrade-v11.test.ts (4), upgrade.test.ts, and all of packages/schema, engine, cli tests (387 passed, 2 skipped pre-existing). Not run: full `pnpm test` (parallel plans 15-04/15-08 editing metadata/api/soql), conformance suites.

## Known Stubs
None.

## Self-Check: PASSED
