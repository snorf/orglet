---
phase: 11-custom-metadata-custom-settings-labels
plan: 02
subsystem: metadata
tags: [sfdx, custom-metadata, custom-settings, labels, metadata-relationship]
requires: []
provides:
  - FieldType MetadataRelationship with switch arms in sqlTypeFor, describeType, sfTypeOf
  - SObjectDef.customMetadata / customSetting, CustomMetadataRecord, CustomLabelDef, OrgSchema.labels/getLabel
  - hasSoftDelete and definitionTarget helpers exported from @orglet/metadata
  - readSourceProject reads customMetadata/, labels/, customSettingsType and MetadataRelationship fields
affects: [11-03, 11-04, 11-05, 11-06, 11-07, 11-08]
tech-stack:
  added: []
  patterns: [optional new constructor/interface members so existing literals compile]
key-files:
  created: [packages/metadata/src/schema.test.ts]
  modified:
    - packages/metadata/src/types.ts
    - packages/metadata/src/schema.ts
    - packages/metadata/src/index.ts
    - packages/metadata/src/xml.ts
    - packages/metadata/src/sfdx.ts
    - packages/metadata/src/sfdx.test.ts
    - packages/schema/src/columns.ts
    - packages/api/src/describe.ts
    - packages/formula/src/values.ts
key-decisions:
  - "Empty customSettingsType element means Hierarchy (Metadata API default); unknown value warns UNSUPPORTED:custom-setting and loads as ordinary object"
  - "nil, empty and absent record values all read as empty string (null, D-05)"
requirements-completed: [CMDT-02, CMDT-03, CSET-01, CSET-02]
duration: 10min
completed: 2026-10-20
---

# Phase 11 Plan 02: Metadata contracts and SFDX reader Summary

Type contracts (MetadataRelationship, customMetadata/customSetting flags, labels) and an SFDX reader for record files, labels, customSettingsType and MetadataRelationship fields.

## Tasks
1. Type contracts, schema helpers, switch arms: f53a3bd
2. Reader for records, labels, settings type, MetadataRelationship: see git log (feat(11-02) second commit)

## Verification
`pnpm vitest run packages/metadata`, `schema.test.ts`, `migrate.test.ts`, `formulas.test.ts` pass; `pnpm build` and `pnpm lint` clean.

## Deviations from Plan
None - plan executed as written. The 11-01 fixture was not used; tests use inline temp projects.

## Known Stubs
None. build.ts does not yet consume the new reader output (plan 11-03).

## Self-Check: PASSED
