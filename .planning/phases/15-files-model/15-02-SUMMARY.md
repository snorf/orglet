---
phase: 15-files-model
plan: 02
subsystem: engine
tags: [blobstore, file-types, blobkey]
requires: ["15-01"]
provides:
  - "BlobStore/OpenedBlob/BlobRef interfaces, InlineBlobStore, blobKey (validated Heimdall key builder)"
  - "fileTypeFor, contentTypeFor, fileExtensionOf from one sourced extension table"
affects: [15-06, 15-09]
key-files:
  created:
    - packages/engine/src/blobs.ts
    - packages/engine/src/blobs.test.ts
    - packages/engine/src/filetypes.ts
    - packages/engine/src/filetypes.test.ts
  modified:
    - packages/engine/src/index.ts
key-decisions:
  - "blobKey rejects, never sanitises; empty extension gives no trailing dot (to be confirmed against Heimdall in Phase 16/18)"
  - ".jpeg and .json left out of the table (no public source); fall back to UNKNOWN / application/octet-stream"
duration: 10min
completed: 2026-11-04
---

# Phase 15 Plan 02: Blob seam and file types Summary

One BlobStore interface (stream-based open, transactional put) with the inline bytea implementation, a strict blobKey builder, and a sourced extension table feeding both FileType and download Content-Type.

## Tasks
1. BlobStore, InlineBlobStore, blobKey - 3be8268
2. FileType / Content-Type table - f942c77

## Deviations from Plan
None - plan executed exactly as written.

## Verification
blobs.test.ts (9) and filetypes.test.ts (5) pass; `pnpm build` and `pnpm lint` green. InlineBlobStore.put/open are not exercised against a real table here (planned for 15-06).

## Known Stubs
None.

## Self-Check: PASSED
