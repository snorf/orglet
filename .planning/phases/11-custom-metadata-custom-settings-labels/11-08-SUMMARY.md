---
phase: 11-custom-metadata-custom-settings-labels
plan: 08
subsystem: cli
tags: [cli, check, up, custom-metadata, custom-settings, upgrade]
requires: ["11-03", "11-04", "11-06"]
provides:
  - orglet up seeds custom metadata and prints the D-04 summary line
  - orglet check lists __mdt prefixes, counts records and labels, counts seed warnings under --strict, prints the D-20 settings info line
  - upgrade test mirrors up including the seed; setting-upgrade path pinned by a migrate test
affects: [11-09]
key-files:
  modified:
    - packages/cli/src/main.ts
    - packages/cli/src/main.test.ts
    - packages/engine/src/upgrade.test.ts
    - packages/schema/src/migrate.test.ts
key-decisions:
  - "Standard-object info line now filters by area (Pitfall 9); settings get their own line, never counted by --strict"
requirements-completed: [CMDT-02, CSET-01, CSET-02]
completed: 2026-10-20
---

# Phase 11 Plan 08: CLI wiring and upgrade safety Summary

`orglet up` seeds `__mdt` rows after bootstrapOrg and prints the summary; `orglet check` reports types, records, labels, seed warnings and custom settings loaded without data.

## Tasks
1. CLI seed wiring and check output (5 new tests, TDD red then green): ff01ff6
2. Upgrade test seed step and setting-upgrade migrate test: 88da839

## Verification
- `pnpm vitest run packages/cli packages/engine/src/upgrade.test.ts packages/engine/src/upgrade-owner.test.ts packages/schema/src/migrate.test.ts` green; `pnpm build` clean; eslint clean on touched files (full-repo lint not run because of the parallel executor).
- `EXPECTED_WARNINGS` stays `[]`; no `expect(` line removed from upgrade.test.ts.

## Deviations from Plan
- [Rule 1 - test bug] The setting-upgrade test's "no CREATE statements" filter initially matched the idempotent `CREATE SCHEMA IF NOT EXISTS`; narrowed to TABLE/INDEX/SEQUENCE. migrate.ts untouched.

## Known Stubs
None.

## Self-Check: PASSED
