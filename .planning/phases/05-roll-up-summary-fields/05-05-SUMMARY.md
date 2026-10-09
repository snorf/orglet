---
phase: 05-roll-up-summary-fields
plan: 05
subsystem: engine
tags: [salesforce, rollup, dml, savepoint, order-of-execution, pglite, postgres, vitest]

requires:
  - phase: 05-roll-up-summary-fields (plans 01-04)
    provides: FieldDef.rollup on read-only stored columns, rollupSelectSql in @orglet/schema, acme Account <- Project__c <- Milestone__c chain with the Milestone_Limit parent rule
provides:
  - RollupRegistry (roll-ups indexed by child object with watched field sets) and affectedParents (trigger rule per DML kind plus the D-03 blame set) in packages/engine/src/rollups.ts
  - saveBatch recomputes roll-ups for insert/update/upsert after the children's after-hooks, through the parent's before-hooks, validation rules, UPDATE and after-hooks (D-01, D-02)
  - Batch savepoint with bounded replay: a refusing parent fails exactly the children pointing at it and committed parent values reflect only committed children (D-03)
  - Upward chain propagation with a 16-level guard (ROLL-06); D-04 defaults (0 / null) on parent insert; import mode untouched (D-09)
affects: [05-06 delete/undelete wiring and SOQL surface, 05-07 DE check]

tech-stack:
  added: []
  patterns:
    - "withRollups(client, obj, size, body, recompute): SAVEPOINT rollup_batch around write loop + after-hooks + recompute; ROLLBACK TO and replay survivors while recompute reports newly failed children; skipped entirely in import mode and for objects without bindings"
    - "Recompute is SELECT-first: one rollupSelectSql per (parent object, field set) per chain level, compared with === against Store rows; only changed columns are written and an unchanged parent is not saved at all"
    - "Parent save procedure = saveRollupParent: before-hooks, hook fold-back, runValidationRules(isNew false), store.update under SAVEPOINT rollup_parent, after-hooks; no audit stamps"
    - "Blame resolves through a Map<parentWork, Set<childWork>> so a grandparent failure lands on the original children"

key-files:
  created:
    - packages/engine/src/rollups.ts
    - packages/engine/src/rollups.test.ts
  modified:
    - packages/engine/src/engine.ts

key-decisions:
  - "D-03 failure attribution uses a batch savepoint with a bounded replay loop (RESEARCH Pattern 2) instead of per-parent savepoints alone, because released per-record savepoints cannot be undone selectively; the per-parent SAVEPOINT rollup_parent is kept around the parent UPDATE and after-hooks"
  - "Recompute is SELECT-first (rollupSelectSql) with the parent's rules evaluated on the prospective row, then an UPDATE of only the changed roll-up columns; unchanged parents skip hooks and rules (Pitfall 10, LOW)"
  - "Blame set is D-03 literal: every live child in the batch whose old or new FK points at the failed parent, whether or not it triggered the recompute; child error is saveError(statusCode, message) with no fields"
  - "Trigger rule: insert -> new FK; update -> old and new FK when they differ, else the FK when any watched field is a key of changes (over-approximation, idempotent); delete/undelete -> old FK (wired in 05-06)"
  - "Parent recompute writes no LastModifiedDate/LastModifiedById/SystemModstamp and publishes no ChangeBus event"
  - "Chains: a written parent's own bindings as a child decide the next level with kind update; depth guard throws after 16 levels; a pass with newly failed children stops climbing because it is rolled back and replayed anyway"
  - "Concurrency hardening (parent row locks) out of scope; single-tenant tool"
  - "ROLL-05 and ROLL-06 marked complete; ROLL-04 withheld until 05-06 wires delete/undelete"

patterns-established:
  - "runValidationRules(client, obj, candidates, isNew, globals) is the single rule evaluator for child batches and roll-up parents"

requirements-completed: [ROLL-05, ROLL-06]  # plan frontmatter also lists ROLL-03 (already complete, 05-03) and ROLL-04 (withheld: delete/undelete paths are 05-06)

duration: 9 min
completed: 2026-10-09
---

# Phase 5 Plan 05: Roll-up recompute in the save pipeline Summary

**Insert, update and upsert of a child now recompute every affected parent (and grandparent) in the same transaction through the parent's own hooks and validation rules; a parent that refuses rolls back exactly the children that point at it via a batch savepoint with bounded replay, so committed roll-up values always equal the aggregate over committed children.**

## Performance

- **Duration:** 9 min
- **Started:** 2026-10-09T07:47:33Z
- **Completed:** 2026-10-09T07:56:37Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments
- `RollupRegistry` indexes every roll-up by child object with its watched field set (FK, summarized field, filter fields, valueFields); `affectedParents` applies the trigger rule per DML kind and builds the D-03 blame set, tested without a DB over the acme schema.
- New parents get `0` for COUNT/SUM and `null` for MIN/MAX in `defaults()` (D-04); import mode keeps supplied values through the existing early `continue` (D-09).
- `saveBatch` wraps the write loop and the children's after-hooks in `withRollups`: `SAVEPOINT rollup_batch`, recompute, and on any newly failed child `ROLLBACK TO` and replay the survivors. Ids, auto-numbers, defaults and before-hook results are computed once before the loop.
- `recomputeRollups` runs one `rollupSelectSql` per (parent object, field set) per chain level, compares against `store.loadByIds` rows, and calls `saveRollupParent` only for parents whose values changed; a refusing parent puts `saveError(statusCode, message)` on every blamed child. Written parents feed the next level through their own child bindings; the guard throws after 16 levels.
- `saveRollupParent`: before-hooks, hook fold-back, `runValidationRules`, `store.update` of the changed columns under `SAVEPOINT rollup_parent`, after-hooks; unique violations become `duplicateError` as in saveBatch; no audit stamps.
- 23 tests in `rollups.test.ts` (7 pure, 16 DB): all green on pglite and on Docker Postgres 16 (`ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet`, 44 passed together with engine.test.ts). Full suite 323 passed / 2 skipped (pre-existing); lint and build green before each commit.

## Task Commits

1. **Task 1: RollupRegistry, affectedParents, D-04 defaults, runValidationRules extraction** - `82983ac` (feat)
2. **Task 2: recompute with parent save procedure, upward propagation and batch replay in saveBatch** - `e37ea47` (feat)

_TDD note: RED was run and observed for both tasks (missing module; then 13 failing integration tests) before implementing; tests and implementation were committed together because every commit must be green (same as 05-01..05-04)._

## Files Created/Modified
- `packages/engine/src/rollups.ts` - `RollupBinding`, `RollupKind`, `RollupWork`, `ParentGroup`, `RollupRegistry`, `affectedParents`
- `packages/engine/src/engine.ts` - `rollups` registry on `DmlEngine`; `defaults()` roll-up branch; `runValidationRules` extracted; `withRollups`, `recomputeRollups`, `saveRollupParent`; saveBatch write loop wrapped; header sentence; `NO_IDS`, `MAX_ROLLUP_DEPTH`
- `packages/engine/src/rollups.test.ts` - logging/locking executor, `describe("affectedParents")`, D-04 test, ROLL-04 insert/update/reparent/filter/sum/chain/upsert tests, ROLL-05 rule/hook/attribution tests, no-stamp, unchanged-skip, import-mode test

## Decisions Made

Planning-time decisions from the plan objective, implemented as specified:
- **Replay loop for D-03.** `SAVEPOINT rollup_batch` around write loop + child after-hooks + recompute. If the recompute marked any child newly failed: `ROLLBACK TO` + `RELEASE` and replay with the survivors, else `RELEASE`. A per-parent nested savepoint alone cannot undo child writes whose `rec` savepoints were already released; replaying from the surviving state makes every committed parent value reflect exactly the committed children (proven by `reparent_with_a_failing_old_parent_keeps_both_parents_unchanged` and `failed_parent_rolls_back_only_its_own_children`). Terminates: each repeated pass fails at least one more child; guard throws after `work.length + 1` passes. The per-parent `SAVEPOINT rollup_parent` is kept around the parent UPDATE and its after-hooks.
- **SELECT-first recompute.** `rollupSelectSql` per (parent object, field set), then per changed parent: before-hooks, fold hook changes into `changes` exactly like saveBatch, validation rules, `store.update` with only the changed columns (plus hook changes), after-hooks. One batched aggregate statement per field set (D-03) while the parent's rules see the prospective row (D-01).
- **Blame set (D-03 literal).** Every live child in the batch whose old or new FK points at the failed parent, whether or not it triggered the recompute. Child error: `saveError(parentError.statusCode, parentError.message)` with no `fields` (the parent's `errorDisplayField` names a parent field), so a rule gives FIELD_CUSTOM_VALIDATION_EXCEPTION with the parent rule's message.
- **Trigger rule.** insert -> new FK; update -> old and new FK when they differ (reparent), else the FK when any watched field is a key of `changes` (over-approximation; recompute is idempotent); delete/undelete -> old FK (wired in 05-06).
- **Skip unchanged parents** (no hooks, no rules; Pitfall 10, LOW). **No audit stamps** on the parent (asserted by `recompute_does_not_stamp_the_parent_last_modified_date`).
- **Chains.** After a parent is written, `registry.forChild(parent)` decides the next level with kind `update`; blame carries through to the original children. Depth guard: `Error("roll-up recompute on <Child> did not settle after 16 levels")`.
- **Concurrency hardening** (parent row locks) out of scope.
- **Import mode and objects without bindings** skip the wrapper entirely, so SQL for every other object is unchanged.

Execution-time additions:
- `recomputeRollups` stops climbing the chain as soon as a level produced newly failed children: that pass is rolled back and replayed anyway, so running grandparent hooks would be wasted work with visible side effects in the hook log.
- The test executor stringifies ids with `asString` rather than `String()` (`no-base-to-string` lint rule on `RecordValue`).

## Deviations from Plan

None - plan executed exactly as written. The early-exit per level above is an optimisation inside the specified mechanism, not a behaviour change.

## Issues Encountered

None. All 23 tests passed on the first run after implementing Task 2.

## Known limitations

- **No ChangeBus events for parent recompute updates.** `eventsFor` only describes the batch's own object; a Project whose `Milestone_Count__c` changed because of a Milestone insert produces no `UPDATE` change event. The event stream is internal (ORGLET_EVENTS=stdout); recorded here for a later phase.
- **Unchanged-parent skip** (Pitfall 10): a parent validation rule does not run when no roll-up value changed. Not documented platform behaviour either way; chosen so untouched parents with pre-existing violations do not block child saves.
- **Concurrency:** two transactions inserting children of the same parent concurrently can race on the parent UPDATE (last writer wins with its own aggregate). Single-tenant, low-concurrency tool; not hardened.

## Known Stubs

None. Delete and undelete paths do not yet call the recompute (`deleteBatch` / `undeleteBatch` untouched by design); plan 05-06 wires them with the `skip` set for cascades (RESEARCH Pitfall 3), which `affectedParents` and `recomputeRollups` already accept.

## Requirements

- **ROLL-05** marked complete: recompute runs in the app-side pipeline after the child write and after-hooks, through the parent's hooks and rules, never as a Postgres trigger; partial-success attribution rolls back the parent update together with its children (`failed_parent_rolls_back_only_its_own_children`, `locked_parent_fails_its_children_through_the_hook_seam`).
- **ROLL-06** marked complete: `milestone_changes_propagate_to_the_account` proves Milestone -> Project -> Account where `Account.Open_Project_Milestones__c` summarises the roll-up `Project__c.Open_Milestones__c`; the 16-level guard bounds recursion.
- **ROLL-04** withheld: insert, update (filter-only), reparent (both parents) and upsert are proven; delete and undelete are 05-06.
- **ROLL-03** already complete (05-03).

## Next Phase Readiness

Ready for 05-06. `deleteBatch` and `undeleteBatch` need: wrap "cascade + setDeleted + after-hooks" in `withRollups(client, obj, work.length, body, () => this.recomputeRollups(client, session, globals, obj, work, "delete" | "undelete", deleting))`, passing the ids being deleted up the stack as `skip` so a cascade does not recompute a parent that is itself being deleted. The Postgres leg ran against Docker Postgres 16 during this plan (not skipped).

## Self-Check: PASSED

Files present: packages/engine/src/rollups.ts, packages/engine/src/rollups.test.ts, packages/engine/src/engine.ts. Commits present: 82983ac, e37ea47.
