---
phase: 15-files-model
plan: 01
subsystem: metadata, schema, formula, api, engine
tags: [base64, bytea, field-type, coercion]
requires: []
provides:
  - "FieldType Base64 (bytea column, describe base64 / xsd:base64Binary)"
  - "isBlob predicate; Store never selects or writes blob columns"
  - "coerceValue strict base64 + MAX_VERSION_DATA_BASE64 / MAX_VERSION_DATA_BYTES; Errors.contentTooLarge"
affects: [15-03, 15-06, 15-08]
tech-stack:
  added: []
  patterns: ["blob columns exist in DDL but are excluded from every select list"]
key-files:
  created: []
  modified:
    - packages/metadata/src/types.ts
    - packages/metadata/src/build.ts
    - packages/schema/src/columns.ts
    - packages/schema/src/index.ts
    - packages/formula/src/values.ts
    - packages/formula/src/compile.ts
    - packages/api/src/describe.ts
    - packages/engine/src/coerce.ts
    - packages/engine/src/errors.ts
    - packages/engine/src/store.ts
key-decisions:
  - "Size limits read MB as MiB: 52,428,800 base64 chars, 39,321,600 decoded bytes"
  - "Oversized body: MAXIMUM_SIZE_OF_DOCUMENT with UNSUPPORTED:content-size message prefix"
duration: 25min
completed: 2026-11-04
---

# Phase 15 Plan 01: Base64 FieldType Summary

Base64 FieldType end to end (bytea column, base64 describe, never in Store select lists, strict base64 coercion with a 50 MiB cap), proven with synthetic FieldDefs.

## Tasks
1. Base64 in metadata/schema/formula/describe - c92de5b
2. Store exclusion, strict coercion, content-size cap - faac533

## Deviations from Plan

**1. [Rule 1 - Bug] Baseline loader needed its own Base64 defaults**
- **Found during:** Task 1 test
- **Issue:** The per-type switch in build.ts (~line 342) only serves custom (SFDX) fields; standard baseline fields went through `fromStandardObject`'s field copy, so a Base64 baseline field stayed filterable/sortable/groupable.
- **Fix:** Added a Base64 branch in the baseline field builder setting all three false; kept the `case "Base64"` in the custom switch (harmless, unreachable in practice).
- **Files:** packages/metadata/src/build.ts

## Verification
`pnpm build`, `pnpm lint` and full `pnpm test` (55 files, 932 passed, 3 skipped pre-existing) green. The full suite was run before one lint-only edit to a test assertion; build.test.ts, build and lint were re-run afterwards.

## Known Stubs
None.

## Self-Check: PASSED
