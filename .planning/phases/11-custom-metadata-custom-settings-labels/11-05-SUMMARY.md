---
phase: 11-custom-metadata-custom-settings-labels
plan: 05
subsystem: soql, engine
tags: [soql, store, custom-metadata, soft-delete, metadata-relationship]
requires: [11-03, 11-04]
provides:
  - "SOQL and Store reads on objects without IsDeleted (__mdt)"
  - "Rel__r.QualifiedApiName on EntityDefinition/FieldDefinition relationships (D-10)"
affects: [11-07, 11-08]
tech-stack:
  patterns: ["capability helper hasSoftDelete at every isdeleted SQL site", "compiler special case before resolveRelationship"]
key-files:
  modified:
    - packages/soql/src/compile.ts
    - packages/soql/src/errors.ts
    - packages/soql/src/compile.test.ts
    - packages/engine/src/store.ts
  created:
    - packages/engine/src/soft-delete.test.ts
key-decisions:
  - "ORDER BY on Rel__r.QualifiedApiName sorts as lower(col) like every text column (pseudoField is Text)"
  - "The stored qualified API name doubles as the parent shape id (orglet choice, commented in compile.ts)"
requirements-completed: [CMDT-03, CMDT-04]
duration: 15min
completed: 2026-10-20
---

# Phase 11 Plan 05: Read path for __mdt and MetadataRelationship SOQL Summary

Soft-delete filters are now emitted only for objects that have IsDeleted (3 sites in compile.ts, 4 in store.ts), and
`Rel__r.QualifiedApiName` on entity/field-definition relationships compiles to the stored string while every other path fails with INVALID_FIELD / `UNSUPPORTED:entity-definition`.

## Tasks

1. Soft-delete filters only where IsDeleted exists - b97e440 (compile.ts, store.ts, compile.test.ts, soft-delete.test.ts, DB-backed against pglite)
2. MetadataRelationship SOQL surface - 9a153b0 (compile.ts, errors.ts `definitionRelationshipOnly`, compile.test.ts)

## Verification

`pnpm vitest run packages/soql packages/engine`: 13 files / 215 tests green (before the final test-file import tweak, then soql re-run 78 green). `pnpm build` clean. `npx eslint packages/soql packages/engine/src/store.ts packages/engine/src/soft-delete.test.ts` clean (scoped, because the other executor edits engine/seed files).

## Deviations from Plan

**1. [Rule 1 - Test expectation] ORDER BY expectation**: plan expected `ORDER BY t0."target_field__c"`; the compiler sorts every Text column through `lower(...)`, so the test asserts `ORDER BY lower(t0."target_field__c")` (consistent with "sorts like a text column").
**2. [Rule 3] Test fixture**: `Ticket__c` is not in examples/acme; the "keeps the filter" test uses the CMDT fixture schema instead.
**3. Process**: Task 1 was committed with `definitionTarget` imported but not yet used (lint error for one commit); fixed in Task 2. TDD RED runs were not committed separately; tests were written after the implementation in the same task.

## Known Stubs

None.

## Self-Check: PASSED
