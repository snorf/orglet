---
phase: 12-sigha-resync-formula-globals
plan: 02
subsystem: formula
tags: [sigha, vendoring, formula, polymorphic, unary-bang]

requires:
  - phase: 12-01
    provides: fork pin ff6c108, fork-aware sync script, corpus guard
provides:
  - packages/sigha vendored from snorf/sigha integration/phase-12 (ff6c108)
  - typed Relationship:Object segments in formula compile (Owner:User, Owner:Group, Owner:Queue)
affects: [12-03 typed parent evaluation]

key-files:
  modified:
    - packages/sigha/src/analysis/checker.ts
    - packages/sigha/src/engine/evaluator.ts
    - packages/sigha/src/i18n/en/syntax.ts
    - packages/sigha/src/syntax/ast.ts
    - packages/sigha/src/syntax/lexer.ts
    - packages/sigha/src/syntax/parser.ts
    - packages/sigha/VENDOR.md
    - packages/formula/src/compile.ts
    - packages/formula/src/expectations.test.ts
    - packages/formula/src/formula.test.ts
    - packages/engine/src/query.test.ts

key-decisions:
  - "Typed qualifier naming a declared target is accepted even on single-target lookups (D-12); invalid qualifier uses the generic 'Field X does not exist. Check spelling.' (D-13)"
  - "Queue aliases Group; QueueName/QueueEmail leaves map to Group Name/Email, canonical key is Owner:Group.Name"

requirements-completed: [FORM-01]

duration: n/a
completed: 2026-10-23
---

# Phase 12 Plan 02: Sigha resync and typed formula segments Summary

**Vendored sigha resynced to fork pin ff6c108 (unary `!`, `Owner:User.Email` lexing) and `resolvePath` taught typed `Relationship:Object` segments; the `it.fails` gap tests are now real tests.**

## Corpus tallies (identical before and after the resync)

- salesforce-v2.json: `pass 6312 · fail 0 · quarantine 1394 · unsupported 1982 · org-overruled 42 · total 9730`
- org-verified.json: `pass 664 · fail 0 · quarantine 0 · unsupported 6 · total 670`

## Changed vendored files

analysis/checker.ts, engine/evaluator.ts, i18n/en/syntax.ts, syntax/ast.ts, syntax/lexer.ts, syntax/parser.ts (plus VENDOR.md). Corpus, LICENSE, NOTICE unchanged. The CI reproduction (sync into a temp dir from the VENDOR.md Revision/Repository, diff src and corpus) exits 0.

## Commits

- 1cafc5e chore(12-02): resync sigha to integration/phase-12
- 46ca9b5 feat(12-02): compile typed Relationship:Object formula segments

## Verification

`pnpm build`, `pnpm lint`, full `pnpm test` (44 files, 729 passed, 3 skipped, pre-existing skips) all green.

## Deviations from Plan

None in behaviour. Process note: tests and implementation were written before the first test run, so the RED step was not observed separately.
No upstream PR exists for the two branches (`gh pr list` empty), so the VENDOR.md status says "upstream PR not opened yet".

## Requirements

FORM-01 met. FORM-02 compile half met; typed-parent evaluation is plan 12-03, so FORM-02 is not marked complete here.

## Self-Check: PASSED
