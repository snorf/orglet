---
phase: 15-files-model
plan: 08
subsystem: soql
tags: [soql, base64, blob-url, contentdocumentlink]
requires: ["15-01", "15-03"]
provides:
  - "Base64 fields select as the row id and shape into /services/data/vX/sobjects/{type}/{id}/{field}; blobUrl exported from @orglet/soql"
  - "ContentDocumentLink mandatory-filter check (MALFORMED_QUERY) at top level, COUNT() and semi-joins"
affects: [15-09, 20]
key-files:
  modified:
    - packages/soql/src/compile.ts
    - packages/soql/src/shape.ts
    - packages/soql/src/errors.ts
    - packages/soql/src/index.ts
    - packages/soql/src/compile.test.ts
    - packages/soql/src/shape.test.ts
key-decisions:
  - "Base64 in WHERE/ORDER/GROUP refused with INVALID_FIELD via expr(); one message for all three clauses"
  - "requiresLinkFilter evaluates the WHERE chain with qualifying conditions false and all others (and NOT-ed groups) true; true means reject"
  - "orglet always enforces the CDL restriction (no Query All Files permission model)"
duration: 15min
completed: 2026-11-04
---

# Phase 15 Plan 08: SOQL blob URLs and ContentDocumentLink filter Summary

Base64 fields (VersionData) select as their download URL and never touch the bytes column; ContentDocumentLink queries must carry an `=`/`IN` filter on Id, ContentDocumentId or LinkedEntityId, else MALFORMED_QUERY with the implementation-restriction text.

## Tasks
1. Base64 select as URL (compile addField/expr, shape blobUrl, barrel export) - 1decf99
2. ContentDocumentLink mandatory filter + D-16 pin - 1decf99

Both tasks touched the same files (compile.ts, compile.test.ts) and were committed together in one commit.

## Deviations from Plan
- Single commit for both tasks (interleaved edits in the same files).
- Negation (`NOT (...)`) handled with a parenthesis-depth counter inside the guarantee evaluator rather than the plan's token-skipping description; same semantics.

## Verification
- `pnpm vitest run packages/soql` : 104 passed (compile 92, shape 12), including all listed reject/accept cases and the D-16 pin.
- `pnpm vitest run packages/engine/src/engine.test.ts packages/api`: 178 passed, 1 skipped.
- `pnpm build` green.
- `pnpm lint`: one error remains in packages/schema/src/migrate.test.ts:383 (plan 15-05's file, not touched here). Full `pnpm test` not run (parallel plans in the tree).

## Notes for Phase 20
The built-in UI object browser query (`SELECT ... FROM <object> ORDER BY LastModifiedDate DESC LIMIT 50`) will return MALFORMED_QUERY for ContentDocumentLink, as in a real org.

## Known Stubs
None.

## Self-Check: PASSED
