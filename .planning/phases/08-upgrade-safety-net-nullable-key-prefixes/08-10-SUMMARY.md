---
phase: 08-upgrade-safety-net-nullable-key-prefixes
plan: 10
subsystem: infra
tags: [sigha, upstream, github, fork, vendor]
requires:
  - phase: 08-upgrade-safety-net-nullable-key-prefixes
    provides: "Fork snorf/sigha and push approval (08-09), pending section in VENDOR.md (08-04)"
provides:
  - "feat/unary-bang and feat/polymorphic-colon-ref pushed to snorf/sigha"
  - "VENDOR.md records the pending upstream state (PRs not opened yet)"
affects: [phase-12]
tech-stack:
  added: []
  patterns: ["pending upstream section carried over by sync-sigha.sh"]
key-files:
  created: []
  modified: ["packages/sigha/VENDOR.md"]
key-decisions:
  - "Johan replied 'later': VENDOR.md keeps '## Pending upstream changes' with status 'pushed to fork, PR not opened yet'"
requirements-completed: [BASE2-05]
duration: 15min
completed: 2026-10-13
---

# Phase 8 Plan 10: Push sigha branches and record upstream state Summary

**Both upstream sigha branches are on the snorf/sigha fork; Johan has not opened the PRs yet, so VENDOR.md records the pending state, and the section survives a re-sync.**

## Push decision and outputs

Authorization: `Push decision: approve-push` (08-09-SUMMARY.md).

- `git push -u fork feat/unary-bang` succeeded first try.
- `git push -u fork feat/polymorphic-colon-ref` was rejected once (`! [remote rejected] ... (failed)`, no detail) and succeeded on an identical retry.
- `git ls-remote --heads fork`: feat/unary-bang = 6b02be38284f4c38ca5a8f1fdff6cb3a1950a274, feat/polymorphic-colon-ref = 8f93df6aec1e41d438506dc2b6feec10da35808d, both matching local. Fork has only those two plus main.
- No `gh pr create`, no force push, no push to origin or rfaulhaber/sigha.

Compare URLs shown to Johan:
- https://github.com/rfaulhaber/sigha/compare/main...snorf:sigha:feat/unary-bang
- https://github.com/rfaulhaber/sigha/compare/main...snorf:sigha:feat/polymorphic-colon-ref

## Checkpoint reply (verbatim)

Task 2 (open PRs, paste URLs): `later`

## Task 3: VENDOR.md and re-sync proof

Heading kept as `## Pending upstream changes`; Status column of both rows set to `pushed to fork, PR not opened yet`; compare URLs listed. No PR URLs invented.

Re-sync proof (SIGHA_DEST scratch dir, revision 2abe5db):
- `grep -cE '^## (Pending upstream changes|Upstream changes)$'` on the synced copy: `1`
- diff of the section from the original vs synced copy: empty
- `grep -n "Behaviour changes belong upstream." packages/sigha/VENDOR.md`: 1 line (line 9)
- `git diff --exit-code packages/sigha/src packages/sigha/corpus`: exit 0

## Task Commits

1. Task 1: no code commit (remote pushes, done by previous agent)
2. Task 2: checkpoint, no commit
3. Task 3: f9a9be3 (docs(08-10): record pushed upstream sigha branches in VENDOR.md)

## Deviations from Plan

**1. [Transient failure] First push of feat/polymorphic-colon-ref rejected by remote**
- Found during: Task 1
- Issue: `! [remote rejected] ... (failed)` with no detail
- Fix: identical retry succeeded; SHAs verified against local
- Files modified: none

## Open item for phase verification

SC5 ("upstream sigha PR links recorded in VENDOR.md") is NOT yet fully met: PRs are not opened. When Johan opens them, rename the heading to `## Upstream changes` and fill in the PR URLs.

## Known Stubs

None.

## Self-Check: PASSED
