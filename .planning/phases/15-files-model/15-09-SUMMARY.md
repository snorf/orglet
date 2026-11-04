---
phase: 15-files-model
plan: 09
subsystem: api
tags: [files, contentversion, download, multipart, 413]
requires: ["15-06", "15-08"]
provides:
  - "GET .../sobjects/ContentVersion/{id}/VersionData streaming download (attachment, nosniff, no Range, MD5 verified)"
  - "Blob URLs instead of bytes in record GET, external-id GET and composite collection GET"
  - "415 UNSUPPORTED:content-multipart and 413 MAXIMUM_SIZE_OF_DOCUMENT UNSUPPORTED:content-size"
affects: [packages/api, README.md]
key-files:
  modified:
    - packages/api/src/server.ts
    - packages/api/src/routes/sobjects.ts
    - packages/api/src/routes/composite.ts
    - README.md
  created:
    - packages/api/src/files.test.ts
key-decisions:
  - "Content-Length is the BlobStore size, not ContentSize (deviation from D-06 literal text); a differing ContentSize logs one blob-size diagnostic per version"
  - "Diagnostics (blob-missing, blob-checksum, blob-size) are req.log.warn lines once per process per area:versionId, no UNSUPPORTED prefix, never content or filenames"
  - "Multipart detected by Content-Type only; body never read"
duration: 25min
completed: 2026-11-04
---

# Phase 15 Plan 09: Files HTTP surface Summary

ContentVersion upload as base64 JSON, URL-not-bytes on every record path, a streamed VersionData download with MD5 verification, and explicit refusals for multipart (415) and oversized bodies (413).

## Commits
- 3eb285e feat(15-09): multipart refusal, 413 mapping, blob URLs in record JSON
- 3314e9a feat(15-09): VersionData download route with MD5 verification
- be36587 docs(15-09): Files README section and large-upload memory bound test

## Deviations from Plan
- Content-Length uses the store's size as the authority (as written in the plan's decisions), not ContentSize literally as in D-06. A header promising more bytes than delivered would hang the client.
- Otherwise none.

## Verification (what was run)
- `pnpm vitest run packages/api/src/files.test.ts` on pglite: 18 passed, 1 skipped (memory test).
- Same file with `ORGLET_DATABASE_URL` against the Docker Postgres: 19 passed. Measured RSS growth for a 36 MiB upload plus download: 179 MiB (bound 400 MiB).
- `pnpm vitest run packages/api packages/soql`: 264 passed, 2 skipped.
- `pnpm build` green (after a transient engine.ts error from the parallel plan 15-07 cleared).
- `pnpm lint` green.
- Full `pnpm test` not run (parallel plan 15-07 active in the tree).

## Known Stubs
None.

## Self-Check: PASSED
