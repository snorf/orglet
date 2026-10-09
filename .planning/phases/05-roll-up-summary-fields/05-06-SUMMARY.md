---
phase: 05-roll-up-summary-fields
plan: 06
subsystem: engine
tags: [salesforce, rollup, dml, delete, undelete, cascade, soql, pglite, postgres, vitest]

requires:
  - phase: 05-roll-up-summary-fields (plan 05)
    provides: withRollups replay loop, recomputeRollups with kinds delete/undelete and a skip set, saveRollupParent, RollupRegistry/affectedParents
  - phase: 05-roll-up-summary-fields (plans 03, 04)
    provides: rollupSelectSql filter semantics, acme Account <- Project__c <- Milestone__c chain with the Milestone_Limit parent rule
provides:
  - deleteBatch and undeleteBatch recompute roll-ups under withRollups (ROLL-04 complete: insert, update, filter-only, reparent, delete, undelete)
  - Cascade safety: the ids being deleted up the stack flow through the recursive deleteBatch as a skip set, so a parent that is itself being deleted is never recomputed, rule-checked or hooked (RESEARCH Pitfall 3)
  - End-to-end proof of multi-level chains with grandparent failure attribution (ROLL-06), every documented filter operator on a real database (ROLL-03) and SOQL SELECT/WHERE/ORDER BY/aggregate over roll-up columns (ROLL-08)
affects: [05-07 DE retrieve check, verify-work for phase 5]

tech-stack:
  added: []
  patterns:
    - "Delete body under withRollups = cascade + setDeleted(true) + after-hooks, recomputing live ids inside the body so a replay only touches survivors; before-hooks stay outside the wrapper"
    - "Undelete body under withRollups = setDeleted(false) + cascade + after-hooks; no skip set because the parent is made live before its children recompute"
    - "Second in-memory org schema in one test file: fresh readSourceProject(ACME) mapped over project.objects to append fields, never mutating the schema the rest of the file uses (phase 4 D-13 pattern)"

key-files:
  created: []
  modified:
    - packages/engine/src/engine.ts
    - packages/engine/src/rollups.test.ts

key-decisions:
  - "deleteBatch takes deleting: ReadonlySet<string> = NO_IDS and the cascade passes new Set([...deleting, ...ids]); recomputeRollups(..., 'delete', deleting) skips those parents"
  - "undeleteBatch recomputes with NO_IDS: the inner cascade's recompute already sees the live parent and the outer recompute is idempotent"
  - "Reparent and undelete recompute triggers have no primary Salesforce quote (ROADMAP research flag); implemented as ROLL-04 requires, sourcing gap recorded for verify-work"
  - "ROLL-04 and ROLL-08 marked complete; ROLL-03 and ROLL-06 (already complete) are re-proven end to end; ROLL-09 stays with 05-07"

patterns-established:
  - "Hook-log assertions distinguish 'parent recomputed' from 'parent skipped' (before:update:<Parent>:<id> present or absent) for cascade-safety tests"

requirements-completed: [ROLL-03, ROLL-04, ROLL-06, ROLL-08]

duration: 8 min
completed: 2026-10-09
---

# Phase 5 Plan 06: Delete/undelete recompute, chains, operators and SOQL Summary

**Deleting or undeleting a child now recomputes its parent (and grandparent) through the same savepoint-and-replay loop as saves, a cascade never recomputes a parent that is itself being deleted, and 18 new integration tests prove chains with grandparent attribution, every documented filter operator on a real database, and SOQL over roll-up columns on both pglite and Docker Postgres 16.**

## Performance

- **Duration:** 8 min
- **Started:** 2026-10-09T08:00:48Z
- **Completed:** 2026-10-09T08:08:50Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- `deleteBatch(client, session, obj, work, globals, deleting = NO_IDS)`: before-hooks first, then "cascade + setDeleted(true) + after-hooks" inside `withRollups`, recomputing with kind `"delete"` and the `deleting` skip set. The recursive cascade call passes `new Set([...deleting, ...ids])`, so deleting a Project recomputes its Account but never the Project itself (no `before:update:Project__c` in the hook log), and deleting an Account recomputes nothing in the chain below it.
- `undeleteBatch`: "setDeleted(false) + cascade + after-hooks" inside `withRollups`, recomputing with kind `"undelete"` and `NO_IDS`. Undeleting a Project restores `Total_Budget__c` and `Open_Project_Milestones__c` on the Account and the Project's own counts through the cascaded milestones.
- Failure attribution works for delete and undelete exactly as for saves: a locked Project (hook seam) fails the milestone delete with `FIELD_CUSTOM_VALIDATION_EXCEPTION "Project__c is locked"` and the milestone stays live; a locked Project fails the undelete and the milestone stays `IsDeleted: true`; committed child counts asserted from the table in both cases.
- Delete semantics: deleting one of two open milestones gives `{1, 1, "2026-05-01"}`; deleting the last gives `{0, 0, null}` and the Account back to 0 while the raw table still holds 2 rows (`count_excludes_soft_deleted_children`); undeleting both restores `{2, 2, "2026-04-01"}` and the Account's 2.
- Multi-level chains (ROLL-06): the Account follows a milestone through insert, Done toggles, delete and undelete; a locked Account fails the milestone insert and rolls back the Project's values to 0/0/null; one batch over two Accounts with one locked yields `[fail "Account is locked", success]` with only the open side committed.
- Filter operators (ROLL-03) on a second org schema built from a fresh `readSourceProject(ACME)` with `Milestone__c.Planned_Date__c` (Date), `Milestone__c.Tag__c` (Text 40) and 13 extra Summary fields on `Project__c`; `buildOrgSchema` warnings are `[]`. Over five fixed-date milestones (one with NULL sort order and NULL tag): Late 3, Same_Day 2, Big 2, Not_One 4 (NULL counts), Ab 2 (case-insensitive), Underscore 1 (`x_` escaped, `xa` excluded), No_Z 5 (NULL counts), Al 1, Blank_Tag 1, Tagged 4, Early 2, Max_Sort 5, Done_Sort_Sum 8; after deleting `x_ray`: Underscore 0, Big 1, Max_Sort 3, Done_Sort_Sum 3.
- SOQL (ROLL-08) on the acme schema: `WHERE Milestone_Count__c > 1 ORDER BY Milestone_Count__c DESC` returns exactly the 3-milestone project; `ORDER BY Milestone_Count__c ASC` orders [1, 3]; `SELECT SUM(Milestone_Count__c) total` gives `{ attributes: { type: "AggregateResult" }, total: 4 }`; `Open_Project_Milestones__c`/`Total_Budget__c` come back as numbers on the Account; `Next_Due_Date__c < 2026-12-31` matches both projects.
- Suite: 341 passed / 2 skipped (pre-existing skips) on pglite, up from 323; `rollups.test.ts` (41) and `engine.test.ts` (21, unmodified) also green on Docker Postgres 16 at `postgres://orglet:orglet@localhost:5433/orglet`. Lint and build green before each commit.

## Task Commits

1. **Task 1: delete and undelete recompute, cascade-safe, with replay** - `96e0d1a` (feat)
2. **Task 2: chains, filter operators end to end, and SOQL over roll-ups** - `acffe29` (test)

_TDD note: Task 1 RED was run and observed (6 failing delete/undelete tests, 25 existing green) before wiring engine.ts; tests and implementation were committed together because every commit must be green (same as 05-01..05-05). Task 2 is test-only by design (it proves behaviour 05-03 and 05-05 built); all 18 tests passed on the first run, no defect surfaced, so no production file changed._

## Files Created/Modified
- `packages/engine/src/engine.ts` - `deleteBatch` gains the `deleting` parameter and the `withRollups` wrapper around cascade/setDeleted/after-hooks with kind `"delete"`; `undeleteBatch` wrapped likewise with kind `"undelete"` and `NO_IDS`; early returns when nothing is live kept before the wrapper
- `packages/engine/src/rollups.test.ts` - `describe("recompute on delete and undelete (ROLL-04)")` (8 tests), `describe("multi-level chains (ROLL-06)")` (3), `describe("filter operators against a real database (ROLL-03)")` (2, own pglite/Postgres schema, engine and bootstrap), `describe("SOQL over roll-up fields (ROLL-08)")` (5); imports `buildOrgSchema`, `loadBaseline`, `readSourceProject`, `SourceField`/`SourceFilterItem`/`SourceObject` types and `runQuery`

## Decisions Made

Planning-time decisions from the plan objective, implemented as specified:
- **Reuse of 05-05's mechanism.** Delete and undelete go through the same `withRollups` replay loop and `recomputeRollups`, with the trigger being the old FK (`affectedParents` kinds `"delete"`/`"undelete"` already existed). The wrapper body recomputes live ids from `live()` so a replay after a refused parent only touches survivors; the before-delete hooks and the "nothing live" early return stay outside the wrapper.
- **Cascade safety (RESEARCH Pitfall 3).** `deleting: ReadonlySet<string>` defaults to `NO_IDS` at the top level and grows by the current batch's ids on each recursive cascade call. `recomputeRollups` passes it as `skip`, so a parent about to be soft-deleted is never recomputed, never has its rules evaluated and never sees `before/after:update` hooks. The Account above a deleted Project is still recomputed because the Project's own recompute runs with the outer (smaller) set.
- **No skip set for undelete.** `undeleteBatch` sets the parent live before cascading, so the children's inner recompute computes against the correct, live parent; the outer recompute of the parent itself is idempotent. Verified by `cascade_delete_of_a_project_skips_its_own_recompute_and_updates_the_account` (Account back to 70 / 2, Project count 2 after undelete).
- **Sourcing gap recorded.** No primary Salesforce document states the reparent and undelete recompute triggers (ROADMAP research flag; Help article 000391766 covers mass recalculation only, 05-RESEARCH §"Reparent and undelete triggers lack a primary-source quote"). They are implemented because ROLL-04 requires them; `/gsd:verify-work` should note the gap rather than treat it as unverified behaviour.
- **Fixture isolation.** The filter-operator schema is built from a second `readSourceProject(ACME)` call mapped over `project.objects`, never by mutating the project behind the acme org schema the rest of the file (and other test files) use. Dates are fixed literals; `Sort_Order__c` NULL is produced by a follow-up update because `defaults()` applies the metadata default `1` on insert.

Execution-time: none beyond the plan.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. Task 1 went green on the first implementation; Task 2's 18 tests passed on the first run on pglite and on Docker Postgres.

## Known limitations

- **SET NULL child relationships are not recompute triggers.** `deleteBatch`'s non-cascade, non-restricted branch runs `UPDATE child SET fk = NULL` directly; if such a lookup ever carried a roll-up (only the D-05 whitelist could), the parent would not be recomputed on that path. Not reachable with master-detail (always cascade) and not exercised by the acme fixture.
- **Undelete cascade failures do not propagate to the parent work** (pre-existing behaviour in `undeleteBatch`, untouched): a cascaded child whose undelete is refused leaves the parent undeleted and successful. Recorded, not changed (surgical scope).
- From 05-05, still true: no ChangeBus events for parent recompute updates; unchanged parents skip rules and hooks; no concurrency hardening.

## Known Stubs

None.

## Requirements

- **ROLL-04** marked complete: insert, update (incl. filter-only), reparent (both parents), upsert were proven in 05-05; delete and undelete are proven here (`delete_recomputes_the_parent`, `count_sum_zero_and_min_max_null_when_last_child_deleted`, `count_excludes_soft_deleted_children`, `undelete_recomputes_the_parent`, and the two refusal tests). Note for verify-work: reparent and undelete triggers lack a primary Salesforce quote.
- **ROLL-08** marked complete: stored columns are selectable, filterable, sortable and aggregatable in SOQL (`describe("SOQL over roll-up fields (ROLL-08)")`).
- **ROLL-03** and **ROLL-06**: already complete (05-03, 05-05); this plan re-proves them end to end on a real database (13 operator fields; grandparent attribution and cascade safety). Listed in `requirements-completed` because the plan frontmatter names them and they are true.
- **ROLL-09** withheld: Johan's DE retrieve check is 05-07.

## Next Phase Readiness

Ready for 05-07 (DE retrieve check, ROLL-09). The engine's roll-up surface is complete for the phase: all DML paths recompute, chains climb with correct blame, cascades are safe, operators and SOQL are proven on both backends. The Postgres leg ran against Docker Postgres 16 during this plan (not skipped).

## Self-Check: PASSED

Files present: packages/engine/src/engine.ts, packages/engine/src/rollups.test.ts. Commits present: 96e0d1a, acffe29.
