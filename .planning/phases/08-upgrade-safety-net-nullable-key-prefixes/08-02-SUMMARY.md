---
phase: 08-upgrade-safety-net-nullable-key-prefixes
plan: 02
subsystem: metadata, schema
tags: [key-prefix, baseline-validation, nullable]
requires: []
provides:
  - "SObjectDef/StandardObjectJson keyPrefix: string | null with keyPrefixSource (KeyPrefixProvenance)"
  - "validateBaseline() hard loader checks"
  - "matchLookupTarget, null-aware matchTargetByPrefix"
  - "null-prefix test fixture"
affects: [08-03]
tech-stack:
  added: []
  patterns: ["hard 'invalid baseline:' errors for orglet's own data"]
key-files:
  created:
    - packages/metadata/test/fixtures/null-prefix/README.md
    - packages/metadata/test/fixtures/null-prefix/standardValueSets.json
    - packages/metadata/test/fixtures/null-prefix/objects/PrefixlessThing.json
    - packages/metadata/test/fixtures/null-prefix/objects/PrefixlessLink.json
  modified:
    - packages/metadata/src/types.ts
    - packages/metadata/src/build.ts
    - packages/metadata/src/index.ts
    - packages/metadata/src/build.test.ts
    - packages/schema/src/ids.ts
    - packages/schema/src/ids.test.ts
    - packages/schema/src/index.ts
    - packages/schema/src/prefixes.ts
    - packages/schema/src/prefixes.test.ts
key-decisions:
  - "Type named KeyPrefixProvenance to avoid clashing with schema's KeyPrefixSource"
  - "m0-prefix guard for custom metadata is conservative and an assumption to confirm with Johan"
  - "generateId keeps a string parameter so 08-03 callers must narrow"
requirements-completed: [BASE2-05]
duration: 12min
completed: 2026-10-13
---

# Phase 8 Plan 02: Nullable key prefixes (metadata and schema) Summary

Key prefix is now `string | null` with a source label, validated hard at load time, and the schema primitives and reconciliation treat null as "never matched, never minted".

## Tasks
1. Metadata: types, `validateBaseline` (first statement of `buildOrgSchema`, exported), fixture, tests - d58ebb9 (tests amended in be29175 for the StandardObjectJson import)
2. Schema: `matchTargetByPrefix` widened, `matchLookupTarget` added, `reconcileKeyPrefixes` filters null-prefix standard objects and uses `provisionalPrefix` for custom ones - be29175

## Verification
- `pnpm vitest run packages/metadata packages/schema`: 144 passed, 2 skipped (pre-existing Postgres-only skips).
- `tsc -b packages/schema/tsconfig.json` clean; eslint clean on touched files; no `keyPrefix!`/cast/default sites.
- Full `pnpm build` was NOT run: engine/soql/api are expected to fail until 08-03 narrows `generateId` callers.

## Additional compiler-reported sites
None beyond the two named sites in prefixes.ts (lines for `standard` and `custom`); no other change in schema or metadata src was needed.

## Deviations from Plan
None in behavior. The test-file import of `StandardObjectJson` was added to build.test.ts, which landed in the second commit.

## Known Stubs
None.

## Self-Check: PASSED
