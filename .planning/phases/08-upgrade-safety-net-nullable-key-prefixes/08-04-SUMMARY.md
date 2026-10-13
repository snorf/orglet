---
phase: 08-upgrade-safety-net-nullable-key-prefixes
plan: 04
subsystem: sigha-vendoring, formula-tests
tags: [sigha, ci, it.fails, audit]
requires: []
provides:
  - portable sync-sigha.sh preserving the VENDOR.md upstream section
  - CI job sigha-sync-check
  - formula expectation tests (it.fails for upstream gaps)
  - 08-GROUP-OWNED-AUDIT.md for Phase 9
affects: [phase-9, phase-12]
key-files:
  created:
    - packages/formula/src/expectations.test.ts
    - .planning/phases/08-upgrade-safety-net-nullable-key-prefixes/08-GROUP-OWNED-AUDIT.md
  modified:
    - scripts/sync-sigha.sh
    - .github/workflows/ci.yml
    - packages/sigha/VENDOR.md
    - .planning/codebase/TESTING.md
decisions:
  - "it.fails only for the lone ! and the three colon forms; != and ! / : in string literals are plain guards (they already pass)"
metrics:
  duration: 15min
  completed: 2026-10-13
---

# Phase 8 Plan 04: sigha sync portability, expectation tests, Group audit Summary

Portable, self-cleaning sigha vendoring script that keeps the pending-upstream section, a CI job proving it on Linux, six formula expectation tests (4 `it.fails`), and a classified Group-owner audit list.

## Tasks

| Task | Commit |
|------|--------|
| 1 sync script, VENDOR.md section, CI job | 2671c9b |
| 2 expectations.test.ts + TESTING.md | 3935ad5 |
| 3 Group-owned audit | see git log (docs(08-04)) |

## Verification

- Scratch sync of rev 2abe5db into a temp dir: src, corpus, LICENSE, NOTICE diffs empty; `## Pending upstream changes` count 1 after first and second sync; 0 `.bak` files; `git status --porcelain packages/sigha` shows only VENDOR.md.
- `pnpm vitest run packages/formula`: 22 passed (6 new); formula.test.ts untouched; eslint clean on the new file.
- Audit completeness loop prints nothing. ci.yml parses (ruby YAML).
- Not verified: the CI job itself has not run on GitHub (Linux/GNU sed path untested locally).

## Deviations from Plan

- CI step additionally copies the repo VENDOR.md into the scratch dir before syncing so the carry-over path is exercised; the final `git diff --exit-code` is limited to `packages/sigha/src` and `packages/sigha/corpus`. Minor, within the plan's intent.
- Audit: `conformance/describe-check` has no Group/OwnerId hits, noted in the file; User.json and Group.json got "incidental" rows.

## Known Stubs

None.

## Self-Check: PASSED
