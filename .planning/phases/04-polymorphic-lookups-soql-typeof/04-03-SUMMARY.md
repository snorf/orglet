---
phase: 04-polymorphic-lookups-soql-typeof
plan: 03
subsystem: formula
tags: [formula, polymorphic, sigha, unsupported]
requires:
  - phase: 04-polymorphic-lookups-soql-typeof
    provides: matchTargetByPrefix and polymorphic gating on referenceTo.length > 1 (plan 04-01)
provides:
  - Plain traversal through a polymorphic lookup rejected at formula compile time (D-08)
  - Owner:Group.Name colon syntax reported as UNSUPPORTED:formula (D-16)
  - Two pending todos (sigha colon syntax, OwnerId narrowing)
affects: [04-06, 04-07]
tech-stack:
  added: []
  patterns: ["Classify the parser's own error instead of pre-processing formula text (D-09)"]
key-files:
  created:
    - .planning/todos/pending/2026-10-08-sigha-colon-syntax-for-polymorphic-formula-references.md
    - .planning/todos/pending/2026-10-08-narrow-baseline-ownerid-per-object.md
  modified:
    - packages/formula/src/compile.ts
    - packages/formula/src/formula.test.ts
key-decisions:
  - "Polymorphism gated on declared referenceTo.length > 1 (D-15), Account/Contact/Opportunity included"
  - "String literals blanked before the colon-reference regex so quoted text is not misread"
requirements-completed: [POLY-01]
duration: 10min
completed: 2026-10-08
---

# Phase 4 Plan 03: Polymorphic formula references Summary

**Formula compile rejects plain `Owner.X` through a User|Group lookup with Salesforce's unknown-field wording and reports `Owner:Group.Name` as `UNSUPPORTED:formula`, with the sigha gap recorded as a todo.**

Success criterion 1's formula leg is a **recorded gap (D-16)**: the vendored sigha lexer rejects `:`, upstream has no support, and `packages/sigha/src` is untouched. Plan 04-06 asserts the UNSUPPORTED outcome; 04-07 records it in the phase summary.

## Accomplishments
- `resolvePath` throws `Field Owner.Alias does not exist. Check spelling.` for any non-leaf segment whose relationship field declares more than one target. Non-polymorphic paths (`Account.Industry` from Contact) are unchanged.
- `compileFormula` turns an `unexpected-character` parse error containing `Rel:Object.Field` into `UNSUPPORTED:formula polymorphic reference <ref> needs ...`; other syntax errors keep `Syntax error in formula:`.
- Todos for the sigha colon syntax (with `Queue` as `Group` alias) and for narrowing baseline `OwnerId` per object.

## Task Commits
1. Task 1: 6635217 feat(04-03): reject plain polymorphic formula traversal and flag colon syntax UNSUPPORTED:formula
2. Task 2: 32b9f49 docs(04-03): record sigha colon-syntax gap and OwnerId narrowing todos

## Verification run
`pnpm build`, `pnpm lint` and `pnpm test` (16 files, 201 passed, 2 skipped, the skips are pre-existing Postgres-only tests) all green; `packages/engine/src` green; `git diff -- packages/sigha` empty. The RED step was not run separately as a failing commit; tests were written together with the implementation.

## Deviations from Plan
None - plan executed as written.

## Known Stubs
None.

## Self-Check: PASSED
