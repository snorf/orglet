---
phase: 04-polymorphic-lookups-soql-typeof
plan: 01
subsystem: schema, engine
tags: [polymorphic-lookups, key-prefix, formula-parents]
requires: []
provides:
  - "matchTargetByPrefix(targets, id) in @orglet/schema: the single prefix-to-target rule"
affects: [04-04, 04-05]
tech-stack:
  added: []
  patterns: ["one shared prefix-match helper for write path and read paths"]
key-files:
  created: []
  modified:
    - packages/schema/src/ids.ts
    - packages/schema/src/ids.test.ts
    - packages/schema/src/index.ts
    - packages/engine/src/engine.ts
    - packages/engine/src/parents.ts
    - packages/engine/src/engine.test.ts
    - packages/metadata/src/types.ts
key-decisions:
  - "loadParents stops at a polymorphic parent mid-path (D-08/D-16) and gates on field.referenceTo.length > 1 (D-15)"
requirements-completed: []
duration: 10min
completed: 2026-10-08
---

# Phase 4 Plan 01: Shared prefix-match helper Summary

`matchTargetByPrefix` in `@orglet/schema` is now the one rule for picking a polymorphic lookup's target from an Id; `checkReferences` and the formula parent loader `loadParents` both use it, so a Group-owned record's `Owner` loads from `group` instead of `user`.

## Tasks

1. `eb12326` feat: `matchTargetByPrefix` helper, barrel export, unit tests (match, unmodelled prefix, empty targets, case sensitivity).
2. `6c4dcb8` feat: `checkReferences` uses the helper (behaviour unchanged, existing tests untouched); `loadParents` groups Ids per matched target; new engine test `loadParents reads each polymorphic parent from the table its Id prefix names`; stale `resolveRelationship` doc comment fixed.

## Verification

`pnpm build`, `pnpm lint` clean; `pnpm test`: 16 files, 187 passed, 2 skipped (skips pre-existing, not touched by this plan).

## Deviations from Plan

None - plan executed as written.

POLY-01 is not marked complete: this plan lays the TS foundation only; SOQL and the formula colon syntax remain in later plans.

## Known Stubs

None.

## Self-Check: PASSED
