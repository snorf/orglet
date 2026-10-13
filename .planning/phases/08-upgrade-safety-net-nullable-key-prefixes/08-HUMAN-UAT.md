---
status: partial
phase: 08-upgrade-safety-net-nullable-key-prefixes
source: [08-VERIFICATION.md]
started: 2026-10-13T13:54:58Z
updated: 2026-10-13T13:54:58Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Open the two upstream sigha PRs and record the links
expected: PRs opened from snorf/sigha (feat/unary-bang, feat/polymorphic-colon-ref) against rfaulhaber/sigha; packages/sigha/VENDOR.md lists the PR links under `## Upstream changes` instead of "pushed to fork, PR not opened yet"
result: [pending]

### 2. Confirm the sigha-sync-check CI job is green on ubuntu-latest
expected: After the phase branch is pushed, the `sigha-sync-check` job runs scripts/sync-sigha.sh with GNU sed and the diff of packages/sigha/src and corpus is empty
result: [pending]

### 3. Run the upgrade test against Postgres 16
expected: packages/engine/src/upgrade.test.ts passes on Postgres as well as pglite
result: passed — orchestrator ran it with ORGLET_DATABASE_URL against the local Docker Postgres 16 on 2026-10-13T13:54:58Z: 3/3 tests passed

## Summary

total: 3
passed: 1
issues: 0
pending: 2
skipped: 0
blocked: 0

## Gaps
