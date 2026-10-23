---
phase: 11-custom-metadata-custom-settings-labels
plan: 04
subsystem: schema
tags: [custom-metadata, key-prefix, ddl, ids]
requires: ["11-02"]
provides:
  - deriveCustomMetadataId (exported from @orglet/schema)
  - m00..mzz key-prefix pool through the persisted mechanism
  - planTable unique-first index rule and MetadataRelationship index without FK
affects: [11-05, 11-06, 11-07]
key-files:
  created: [packages/schema/src/ddl.test.ts]
  modified:
    - packages/schema/src/ids.ts
    - packages/schema/src/ids.test.ts
    - packages/schema/src/ddl.ts
    - packages/schema/src/prefixes.ts
    - packages/schema/src/prefixes.test.ts
    - packages/schema/src/index.ts
key-decisions:
  - "Golden derived Id: deriveCustomMetadataId('m00','Support_Tier__mdt','Gold') = m00dI6W8ONPwAT6Q0N"
  - "Cross-pool prefix claims (records, mapping) are KeyPrefixErrors in the planner and parseKeyPrefixMapping"
requirements-completed: [CMDT-01, CMDT-02, CSET-01]
duration: 10min
completed: 2026-10-20
---

# Phase 11 Plan 04: Schema groundwork Summary

Derived custom-metadata Ids (SHA-256 based, golden-tested), a separate m00..mzz persisted key-prefix pool for __mdt types, and DDL rules: unique Lookup gets a ux_ index, MetadataRelationship gets a plain index and never an FK.

## Tasks
1. deriveCustomMetadataId and unique-first DDL index rule: 77014ec
2. m key-prefix pool: see git log (feat(11-04) second commit)

## Verification
`pnpm vitest run packages/schema packages/engine/src/upgrade.test.ts` green, `pnpm build` clean, eslint on packages/schema clean. Repo-wide `pnpm lint` had one error at the time, in `packages/metadata/src/build.ts` (unused `CustomLabelDef` import) belonging to the parallel plan 11-03; out of scope.

## Deviations from Plan
None. The one removed line in prefixes.test.ts is the import list extended with `OrgSchemaImpl` and `SObjectDef`.

## Known Stubs
None.

## Self-Check: PASSED
