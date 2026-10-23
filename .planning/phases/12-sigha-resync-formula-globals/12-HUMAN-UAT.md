---
status: partial
phase: 12-sigha-resync-formula-globals
source: [12-VERIFICATION.md]
started: 2026-10-23T14:00:54Z
updated: 2026-10-23T14:00:54Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. sync-sigha.sh runs on Linux against the fork pin (success criterion 1, Linux half)
expected: After the branch is pushed, the CI job `sigha-sync-check` on `.github/workflows/ci.yml` clones `https://github.com/snorf/sigha.git` at `ff6c108786e086168c4e70797d23162fbab7e614` (read from the `Repository:` and `Revision:` lines of `packages/sigha/VENDOR.md`), re-runs `scripts/sync-sigha.sh` into `$RUNNER_TEMP` on ubuntu, and the diff against `packages/sigha/src`, `corpus`, `LICENSE` and `NOTICE` is empty, so the job passes. macOS was exercised locally in plans 12-01 and 12-02.
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
