---
phase: 15-files-model
plan: 04
subsystem: metadata
tags: [content-document-link, polymorphic-reference, custom-objects]
requires: ["15-03"]
provides:
  - "ContentDocumentLink.LinkedEntityId.referenceTo = 20 generated targets + every custom object of the retrieve (not custom settings, not CMDT)"
affects: [15-06, 15-07]
key-files:
  modified:
    - packages/metadata/src/build.ts
    - packages/metadata/src/build.test.ts
key-decisions:
  - "Expansion runs in buildOrgSchema before the dangling-reference scan and before OrgSchemaImpl, so child relationships and diagnostics follow without further changes"
duration: 8min
completed: 2026-11-04
---

# Phase 15 Plan 04: LinkedEntityId expansion Summary

buildOrgSchema appends the retrieve's custom objects (name order, localeCompare) to ContentDocumentLink.LinkedEntityId, excluding custom settings and custom metadata types; custom objects gain the ContentDocumentLink child relationship (no relationship name, cascade).

## Tasks
1. Load-time expansion plus 5 tests (order, exclusions, child relationship, no diagnostics, baseline without CDL) - ca238cf

## Deviations from Plan
None. api.test.ts needed no change.

## Known gap
FirstPublishLocationId is unchanged: an auto-link from it to a custom object is refused with INVALID_CROSS_REFERENCE_KEY.

## Verification
Run and green: build.test.ts (96), plus packages/metadata, api, engine, cli test directories (39 files, 661 passed, 1 skipped pre-existing). `pnpm build` and `pnpm lint` currently fail only in packages/soql/src/compile.ts (plan 15-08, in progress in the same tree); nothing in my files. Not re-run after 15-08 settles.

## Known Stubs
None.

## Self-Check: PASSED
