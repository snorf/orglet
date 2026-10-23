---
phase: 12-sigha-resync-formula-globals
plan: 01
subsystem: infra
tags: [sigha, vendoring, ci, corpus, fork]

requires:
  - phase: 08-upgrade-safety-net-nullable-key-prefixes
    provides: sigha vendoring script and sigha-sync-check CI job
provides:
  - orglet-owned corpus pass-count guard (survives syncs)
  - fork-aware scripts/sync-sigha.sh and sigha-sync-check CI step (Repository: line in VENDOR.md)
  - pushed fork integration branch snorf/sigha integration/phase-12 at ff6c108786e086168c4e70797d23162fbab7e614
affects: [12-02 sigha resync, formula]

tech-stack:
  added: []
  patterns: ["VENDOR.md Repository: line selects clone source for sync and CI"]

key-files:
  created: [packages/sigha/test/corpus-baseline.test.ts]
  modified: [scripts/sync-sigha.sh, .github/workflows/ci.yml]

key-decisions:
  - "Only salesforce-v2.json is locked by the guard (rows >= 9730, pass >= 6312); org-verified.json deliberately is not"
  - "Pinned revision for plan 12-02 is the integration/phase-12 merge SHA; the branch must never be deleted or force-pushed while VENDOR.md names it"

requirements-completed: []  # FORM-01 stays open; plan 12-02 (the resync) closes it

duration: n/a
completed: 2026-10-23
---

# Phase 12 Plan 01: Resync safety net and fork integration branch Summary

**Corpus pass-count guard, fork-aware sigha sync script and CI step, and a Johan-pushed fork integration branch (ff6c108) combining unary-bang and polymorphic-colon-ref.**

## Baseline before resync (pin 2abe5dbb)

- org-verified.json: `pass 664 · fail 0 · quarantine 0 · unsupported 6 · total 670`
- salesforce-v2.json: `pass 6312 · fail 0 · quarantine 1394 · unsupported 1982 · org-overruled 42 · total 9730`

## Accomplishments

- Task 1 (ac31e7a): `packages/sigha/test/corpus-baseline.test.ts` fails if salesforce-v2.json has fewer than 9730 rows or fewer than 6312 passing rows. `scripts/sync-sigha.sh` accepts `SIGHA_REPO`, records `Repository:` in VENDOR.md and reuses it on later runs. CI `sigha-sync-check` clones the repository named on that line.
- Task 2: branch `integration/phase-12` in /Users/johankarlsteen/Development.nosync/sigha-upstream = `fork/feat/unary-bang` (6b02be3) merged with `fork/feat/polymorphic-colon-ref` (8f93df6), merge-base 2abe5dbb3ca0ab17b7aa1443024562041336ca5f. Merge SHA: `ff6c108786e086168c4e70797d23162fbab7e614`, author Johan Karlsteen <johan@karlsteen.com>.
  - Fork `pnpm install --frozen-lockfile`, `pnpm test` (22 files, 403 tests) and `pnpm typecheck` pass.
  - `git diff --stat` pin to HEAD over src and corpus: 10 files, +168/-13 (analysis/checker.ts + test, engine/evaluator.ts + test, i18n/en/syntax.ts, syntax/ast.ts, syntax/lexer.ts + test, syntax/parser.ts + test); corpus untouched.
- Task 3 (human-action): Johan pushed the branch. Reply verbatim:

```
git -C /Users/johankarlsteen/Development.nosync/sigha-upstream push -u fork integration/phase-12
 * [new branch]      integration/phase-12 -> integration/phase-12
branch 'integration/phase-12' set up to track 'fork/integration/phase-12'.
```

  Verification: `git ls-remote https://github.com/snorf/sigha.git refs/heads/integration/phase-12` returned `ff6c108786e086168c4e70797d23162fbab7e614`, equal to the local `integration/phase-12` SHA (re-run by the continuation agent, MATCH). Claude ran no push and no `gh pr create`.

## Deviations from Plan

None - plan executed as written. `packages/sigha/src`, `packages/sigha/corpus` and `packages/sigha/VENDOR.md` are unchanged (git diff clean).

## Issues Encountered

None.

## Next Phase Readiness

Plan 12-02 can pin `ff6c108786e086168c4e70797d23162fbab7e614` via `SIGHA_REPO=https://github.com/snorf/sigha.git bash scripts/sync-sigha.sh ff6c108786e086168c4e70797d23162fbab7e614`; CI can fetch it. FORM-01 remains open until that resync lands.

## Self-Check: PASSED

Verified: ac31e7a and 5d9da91 on branch gsd/phase-12-sigha-resync-formula-globals; corpus-baseline.test.ts exists; remote SHA matches.
