---
phase: 15-files-model
plan: 10
subsystem: conformance
tags: [files, conformance, jsforce, simple-salesforce, phase-gate]
requires: ["15-07", "15-09"]
provides:
  - "files-check conformance legs (jsforce 7/7, simple-salesforce 5/5) wired into conformance/run-all.sh"
  - "Phase 15 gate evidence on pglite and Postgres 16"
affects: [conformance]
key-files:
  created:
    - conformance/files-check/jsforce.mjs
    - conformance/files-check/sf_files.py
    - conformance/files-check/README.md
  modified:
    - conformance/run-all.sh
    - conformance/README.md
key-decisions:
  - "Enterprise matrix not run for this plan (optional); enterprise numbers in the conformance README are kept from the earlier run"
duration: n/a
completed: 2026-11-04
---

# Phase 15 Plan 10: Files conformance and phase gate Summary

Unchanged jsforce and simple-salesforce now round-trip ContentVersion files against orglet (base64 upload, byte-exact VersionData download), and the full suite is green on both pglite and Postgres 16.

## Commits
- 6a1b117 feat(15-10): files-check conformance legs for jsforce and simple-salesforce
- b7ce669 docs(15-10): record files-check and describe-check conformance results

## Verification (what was run)
- pglite gate `pnpm build && pnpm test && pnpm lint && pnpm baseline:check`: rc=0; 60 files passed, 1044 tests passed, 4 skipped; baseline:check checked 55 files.
- Postgres 16 (`ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test`): rc=0; 60 files, 1047 passed, 1 skipped. The large-upload test passed: RSS growth 196 MiB for a 36 MiB upload plus download (3482 ms), within the 400 MiB bound.
- Conformance `conformance/run-all.sh` (acme), all PASS: jsforce-subset (core 51 passed/60 skipped, Bulk 2.0 12 passed/5 skipped, unchanged), simple-salesforce 29/29, describe-check 33/33 per SDK, poly-check 5/5 per SDK, rollup-check 5/5 per SDK, files-check jsforce 7/7 and simple-salesforce 5/5, cmdt-check 8/8 per SDK.
- Enterprise matrix: not run (optional).

## Checkpoint
Human-verify checkpoint (Task 2) approved by Johan ("approved").

## Deviations from Plan
None.

## Known Stubs
None.

## Self-Check: PASSED
