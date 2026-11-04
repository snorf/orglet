---
phase: 15-files-model
plan: 06
subsystem: engine
tags: [files, contentversion, contentdocument, blobstore]
requires: [15-02, 15-04, 15-05]
provides: [ContentVersion insert semantics, DmlEngine.blobs seam, mirrorDocument]
affects: [packages/engine]
key-files:
  created: [packages/engine/src/files.ts, packages/engine/src/files.test.ts]
  modified: [packages/engine/src/engine.ts, packages/engine/src/index.ts, packages/engine/src/blobs.test.ts]
decisions:
  - "Files step is plain functions over (client, store), reusable outside DmlEngine; DmlEngine.blobs / EngineOptions.blobs is the external-store seam"
  - "FirstPublishLocationId link only when the insert creates the document"
requirements-completed: [FILE-03, FILE-04, FILE-05, FILE-09]
completed: 2026-11-04
---

# Phase 15 Plan 06: ContentVersion insert semantics Summary

ContentVersion inserts now create or version their ContentDocument, derive Checksum/size/type fields, store bytes through the BlobStore and auto-link FirstPublishLocationId, all inside the per-record savepoint; import mode only stores supplied bytes.

## Commits
- bd82bdf feat(15-06): files.ts, saveBatch wiring, DmlEngine.blobs, files.test.ts (14 tests)
- 0f4c3e8 test(15-06): InlineBlobStore DB tests (5 added to blobs.test.ts)

## Deviations
None - plan executed as written.

## Notes
- Import mode, ContentVersion without ContentDocumentId: engine returns `success: false` with REQUIRED_FIELD_MISSING [ContentDocumentId] (checkRequired); no row, no document. Archive-org policy is Phase 17's (D-03).
- PublishStatus/MalwareScanStatus on new documents stay null (no source for values).
- Known gap (from 15-04, not fixed here): `ContentVersion.FirstPublishLocationId.referenceTo` is not expanded to custom objects, so FirstPublishLocationId pointing at a custom-object record is refused with INVALID_CROSS_REFERENCE_KEY. Natural fix mirrors the LinkedEntityId expansion in packages/metadata/src/build.ts.
- A version without VersionData is allowed (no bytes, null Checksum/ContentSize); download answers 404 in plan 15-09.

## Verification
pnpm build, pnpm lint, pnpm test (59 files, 1011 passed, 3 skipped) all green.

## Self-Check: PASSED
