---
phase: 15-files-model
plan: 07
subsystem: engine
tags: [files, delete, undelete, cascade, contentdocumentlink]
requires: [15-06]
provides: [FILE-08 cascade/undelete, D-11 update mirror, D-14 link DML contract]
affects: [packages/engine]
key-files:
  modified: [packages/engine/src/engine.ts, packages/engine/src/files.test.ts]
decisions:
  - "Set-null cascade only nulls child rows not themselves being deleted up the stack (Pitfall 1)"
  - "Direct ContentDocument.Title update stays document-only (documented gap, pinned by test)"
requirements-completed: [FILE-04, FILE-07, FILE-08]
completed: 2026-11-04
---

# Phase 15 Plan 07: Delete/undelete cascade and link DML Summary

Deleting a ContentDocument soft-deletes its versions and links and undelete restores them together with LatestPublishedVersionId intact; the latest version's Title update mirrors to the document; link DML needed no engine special-casing.

## Commits
- feat(15-07): single commit covering both tasks (the two engine.ts changes and all tests landed together; tasks were not committed separately).

## Deviations
None to the engine. Link DML (FILE-07) passed from the generated flags/picklists with no baseline override changes. Test fix only: the custom-object link test needed `Account__c` on `Project__c`.

## Verification
pnpm build, pnpm lint green; `pnpm vitest run packages/engine` 18 files, 240 passed (includes soft-delete.test.ts and engine.test.ts unchanged, which cover the generic set-null rule). files.test.ts 29 passed. Full `pnpm test` not run (parallel plan 15-09 is editing packages/api).

## Self-Check: PASSED
