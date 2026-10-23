---
phase: 12-sigha-resync-formula-globals
plan: 03
subsystem: engine
tags: [formula, polymorphic, parents, owner]
requires:
  - phase: 12-02
    provides: typed Relationship:Object segments in formula compile
provides:
  - runtime evaluation of Owner:User / Owner:Group / Owner:Queue formula references
  - no relationship-object leakage into retrieved records
key-files:
  created: [packages/engine/src/polymorphic-formula.test.ts]
  modified: [packages/engine/src/parents.ts, packages/engine/src/engine.ts]
key-decisions:
  - "Typed segment ends polymorphism; loaded only when key prefix matches the named target, via matchLookupTarget"
  - "project() deletes relationship keys loaded for formulas after evaluation"
requirements-completed: [FORM-02]
completed: 2026-10-23
---

# Phase 12 Plan 03: Typed polymorphic runtime Summary

**Typed `Owner:User` / `Owner:Queue` formula references now evaluate against the named target (blank for the other type), and parents loaded for formulas no longer leak into returned records.**

## Commits
- 615053e test(12-03): failing tests (all 6 failed: typed values null, `Account` key leaked, validation rule did not block)
- feat(12-03): typed loading in parents.ts and parent-key cleanup in DmlEngine.project

## Verification
`pnpm vitest run packages/engine packages/api packages/formula` 322 passed, 1 skipped (pre-existing pglite skip); `pnpm lint` and `pnpm build` clean. No existing test relied on leaked parent keys. Full-repo `pnpm test` not re-run (only engine/api/formula touched).

## Deviations from Plan
None. Note: the two fixture setups each use their own test schema, as planned.

## Self-Check: PASSED
