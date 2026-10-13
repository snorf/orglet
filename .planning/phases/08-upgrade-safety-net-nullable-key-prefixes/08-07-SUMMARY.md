---
phase: 08-upgrade-safety-net-nullable-key-prefixes
plan: 07
subsystem: engine, metadata-fixtures
tags: [upgrade, migr-01, fixture]
requires: ["08-01", "08-03", "08-04", "08-05"]
provides:
  - frozen v1.0 baseline snapshot fixture
  - upgrade.test.ts contract test with EXPECTED_WARNINGS
key-files:
  created:
    - packages/metadata/test/fixtures/baseline-v1.0/
    - packages/engine/src/upgrade.test.ts
  modified:
    - .planning/phases/08-upgrade-safety-net-nullable-key-prefixes/08-GROUP-OWNED-AUDIT.md
requirements-completed: [MIGR-01, MIGR-04]
duration: 10min
completed: 2026-10-13
---

# Phase 8 Plan 07: Populated v1.0 upgrade test Summary

A hermetic v1.0 baseline snapshot (commit 1b737c1, 35 objects) plus an engine test that builds a v1.0 org with Group-owned and importMode rows, upgrades it as `orglet up` does, and asserts rows byte-identical, warnings equal to EXPECTED_WARNINGS (empty), and a silent second run.

## Commits
- 0c56b31: fixture snapshot and audit rows
- c53aedd: upgrade.test.ts and audit row

## Verification
- Snapshot identical to the live baseline (git diff --no-index empty); no new tag, v1.0 untouched.
- upgrade.test.ts: 3 passed on pglite and on Postgres 16 (Docker, localhost:5433).
- pnpm build, lint green; pnpm test 488 passed, 3 skipped (Postgres-only). A transient build/lint error from concurrent 08-06 files resolved on retry.
- Group audit completeness loop prints nothing.

## Deviations from Plan
None. All fixture field names existed in the v1.0 baseline.

## Known Stubs
None.

## Self-Check: PASSED
