---
phase: 09-baseline-generator-parity-ownerid-narrowing
plan: 02
subsystem: metadata
tags: [baseline, ownerTargets, featureGated, upgrade-test]
requires: []
provides:
  - "StandardObjectJson.ownerTargets narrowing OwnerId.referenceTo, validated by validateBaseline"
  - "featureGated on StandardFieldJson and FieldDef (not exposed in describe)"
  - "Upgrade contract that admits additive baseline growth"
affects: [09-07, 09-08]
key-files:
  modified:
    - packages/metadata/src/types.ts
    - packages/metadata/src/build.ts
    - packages/metadata/src/build.test.ts
    - packages/engine/src/upgrade.test.ts
decisions:
  - "Upgrade test forbids only CREATE/DROP TABLE, DROP COLUMN, ALTER COLUMN TYPE; rows compared on v1.0 columns"
metrics:
  completed: 2026-10-13
---

# Phase 9 Plan 02: ownerTargets and featureGated loader contract Summary

The baseline loader now accepts and validates object-level `ownerTargets` (User/Group subset, default unchanged) and field-level `featureGated`, and the Phase 8 upgrade test is reworked to pass once v2 appends columns.

## Tasks
1. Loader contract (d92f1fd): types, `systemFields(hasOwner, ownerTargets)`, `copy("featureGated")`, four `validateBaseline` rules with the exact planned messages, new tests.
2. Upgrade contract (36d5557): `V1_COLUMNS` captured from `information_schema.columns`, snapshot selects those columns only, ADD COLUMN ban replaced by a FORBIDDEN regex. Warnings and second-run assertions unchanged.

## Verification
- `vitest run packages/metadata packages/engine/src/upgrade.test.ts`: 99 passed (pglite only; Docker Postgres not run).
- `pnpm lint`: my files clean. One remaining error is in `packages/metadata/test/sfdocs-vendor.test.ts` (plan 09-01's file, `no-regex-spaces`), out of scope.
- `tsc --noEmit -p tsconfig.test.json` shows errors only in files I did not touch (engine.test.ts, null-prefix.test.ts, diagnostics.test.ts); none in my files.

## Deviations from Plan
None.

## Self-Check: PASSED
