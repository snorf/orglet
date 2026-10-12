---
phase: 07-conformance-re-run-milestone-acceptance
plan: 01
subsystem: cli, api
tags: [cli, bulk, acceptance]
requires: []
provides:
  - "orglet check --strict (exit 1 when any warning printed)"
  - "Bulk 2.0 sf__Error separator ' --'"
affects: [07-03, 07-04, 07-06]
key-files:
  modified:
    - packages/cli/src/main.ts
    - packages/cli/src/main.test.ts
    - packages/api/src/routes/bulk.ts
    - packages/api/src/bulk.test.ts
    - packages/api/src/bulk/store.test.ts
key-decisions:
  - "--strict is parsed globally but only check uses it; up and reset ignore it"
  - "sf__Error format is CODE:message:fields --, matching the format jsforce bulk2.test.ts asserts"
requirements-completed: [ACCEPT-01, ACCEPT-02]
duration: 10min
completed: 2026-10-12
---

# Phase 7 Plan 01: check --strict and Bulk sf__Error separator Summary

`orglet check --strict` exits 1 whenever a warning was printed, and Bulk 2.0 failedResults now emit `CODE:message:fields --`.

## Tasks

1. `check --strict` (commit 93f32f4): warnings merged into one list, printed in the original order, exit 1 under `--strict` if non-empty. Usage and header document it. Four new tests (clean acme 0, ExternalLookup temp project 1, default still 0, `--quiet` does not hide warnings) plus an extended usage test.
2. `sf__Error` separator (commit 127a735): `formatSaveError` now ends with ` --`. API test asserts the full string `REQUIRED_FIELD_MISSING:Required fields are missing: [Name]:Name --` (confirmed failing before the fix with `Name--`); store fixtures updated.

## Verification

`pnpm build`, `pnpm lint`, `pnpm test` all green on Node 22 (25 files, 427 passed, 3 skipped; the skips are pre-existing and not from this plan). `node packages/cli/dist/index.js check --strict --project examples/acme` exits 0 with no warnings. No leftover `Name--` or `}--\`` occurrences.

## Deviations from Plan

None. The plan executed as written.

## Self-Check: PASSED
