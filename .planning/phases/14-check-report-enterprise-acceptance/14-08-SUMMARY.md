---
phase: 14-check-report-enterprise-acceptance
plan: 08
subsystem: metadata, engine (custom metadata seed)
tags: [custom-metadata, FieldDefinition, reference-target, gap-closure]
requires: []
provides:
  - FieldDef.metadataRelationshipControllingField
  - bare FieldDefinition value resolution in planCustomMetadataSeed
affects: [14-12]
key-files:
  modified:
    - packages/metadata/src/sfdx.ts
    - packages/metadata/src/types.ts
    - packages/metadata/src/build.ts
    - packages/metadata/src/sfdx.test.ts
    - packages/engine/src/seed.ts
    - packages/engine/src/seed.test.ts
    - packages/cli/src/enterprise.test.ts
    - examples/enterprise/force-app/main/default/customMetadata/Service_Level.Silver.md-meta.xml
    - examples/enterprise/README.md
decisions:
  - "Phase 11 D-11 (controlling field ignored) is superseded; D-08 and D-09 stand unchanged."
metrics:
  completed: 2026-10-30
---

# Phase 14 Plan 08: Bare FieldDefinition resolution Summary

A bare FieldDefinition value (e.g. `Status`) on a custom-metadata record is now resolved against the object named by the record's own controlling EntityDefinition field, closing the 50-warning reference-target class of ACC2-03.

Phase 11 D-11 is superseded: `<metadataRelationshipControllingField>` is parsed, carried on `FieldDef` (field part only, FieldDefinition targets only) and used by the seed plan. Describe is untouched. Stored value stays as written (D-08); dangling values still give one `UNSUPPORTED:reference-target` warning in the unchanged line format.

## Commits
- 1e973a7: parse controlling field onto FieldDef (Task 1)
- 65eb7cb: seed resolution, enterprise fixture case (Task 2)

## Tests
- Added 2 seed tests (bare resolution in any value order; missing controlling value or wrong field gives null + warning) and 1 enterprise test (Silver: Case/Status, no warnings); updated 1 sfdx test.
- `pnpm vitest run` on seed, enterprise, main and packages/metadata/src: 8 files, 202 tests pass. Red phase confirmed before implementation.
- `pnpm build` and `pnpm lint` clean. `check --strict` on examples/enterprise: exit 0, 0 warning lines. cmdt-check fixture: still 2 reference-target warnings.
- Not run: `pnpm typecheck` separately and the full suite on both backends (planned in 14-12).

## Deviations from Plan
None. Plan executed as written.

## Self-Check: PASSED
