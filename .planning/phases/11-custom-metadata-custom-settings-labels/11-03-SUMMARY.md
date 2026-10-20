---
phase: 11-custom-metadata-custom-settings-labels
plan: 03
subsystem: metadata
tags: [custom-metadata, custom-settings, labels, metadata-relationship, build]
requires: ["11-01", "11-02"]
provides:
  - buildOrgSchema models __mdt objects (m00.. pool, read-only flags, D-16 system fields)
  - MetadataRelationship fields Lookup-shaped without child relationship; Entity/FieldDefinition targets exempt from reference-target warnings
  - BuildResult.customMetadata (records matched to loaded types) and OrgSchema.labels
  - Custom-setting shape (List/Hierarchy, SetupOwnerId) and custom-setting-no-data info items
affects: [11-05, 11-06, 11-07, 11-08, 11-09]
tech-stack:
  added: []
  patterns: [separate key-prefix pools, info diagnostics for retrieve-format facts]
key-files:
  created: []
  modified:
    - packages/metadata/src/build.ts
    - packages/metadata/src/build.test.ts
key-decisions:
  - "customKeyPrefix(index, pool) keeps the metadata package self-contained; no @orglet/schema symbol needed"
  - "Hierarchy Name nillable, List Name unique (D-19)"
requirements-completed: [CMDT-01, CMDT-03, CSET-01, CSET-02]
duration: 15min
completed: 2026-10-20
---

# Phase 11 Plan 03: Build __mdt objects, custom settings and labels Summary

`buildOrgSchema` now turns the 11-02 reader output into the org schema: `__mdt` types with their own `m00..` prefix pool and documented system fields, MetadataRelationship fields, record-to-type matching, List/Hierarchy custom-setting shapes and labels.

## Tasks
1. `__mdt` objects, m pool, MetadataRelationship, record matching: 18519be
2. Custom-setting shape and info item, labels, fixture contract: 1417cdc

## Verification
- `pnpm vitest run packages/metadata packages/schema packages/engine/src/upgrade.test.ts`: all metadata and upgrade tests green (`EXPECTED_WARNINGS = []` unchanged); `pnpm build` and `pnpm lint` clean.
- The conformance fixture builds to exactly two build warnings (unknown record type, duplicate label) and the documented prefixes.
- `examples/acme` untouched; no existing test lines removed.

## Deviations from Plan
None in code. Out-of-scope observation: `packages/schema/src/prefixes.test.ts` "a mapping or records claim outside the object's pool is a KeyPrefixError" failed during the run (expected `claims: []`, received one claim). It belongs to the parallel plan 11-04 work in progress and was not touched.

## Coupling
None: the metadata package does not need any `@orglet/schema` symbol from 11-04.

## Upgrade impact
A database that loaded a custom setting before this phase keeps an orphan `ownerid` column and prints `UNSUPPORTED:schema-drop ... kept (use --force to drop)` once per such table (covered by a migrate test in 11-08).

## Known Stubs
None.

## Self-Check: PASSED
