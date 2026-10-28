---
phase: 13-roll-ups-over-formula-fields
verified: 2026-10-24T21:15:00Z
status: passed
score: 2/2 must-haves verified
---

# Phase 13: Roll-Ups over Formula Fields Verification Report

**Phase Goal:** A roll-up summary can aggregate or filter on a formula field in the cases Salesforce permits, and fails soft in the cases it does not.
**Status:** passed (initial verification)

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | COUNT/SUM/MIN/MAX roll-up over a same-object non-volatile formula loads and recomputes on insert/update/delete/undelete, including when a field the formula reads changes | VERIFIED | `packages/metadata/src/rollup.ts` no longer gates formulas; `admitFormulaRollups` (formula pkg) rejects cross-object, volatile, evaluation-time globals and cycles with `UNSUPPORTED:rollup-formula` / `rollup-cycle`; `RollupRegistry` watches transitive formula inputs (`formulaInputs`); `DmlEngine.computeRollups`/`evaluateChildren` evaluate child formulas in TS and aggregate via the unnest derived table. Tests in `rollups-formula.test.ts` cover insert/update/delete/undelete, "updating a field only the formula reads recomputes the parent", reparenting, filters/valueFields, scale rounding, Date/DateTime MIN/MAX, roll-up chain. |
| 2 | Upgrading a DB with children backfills the formula roll-up once; a second `orglet up` is silent | VERIFIED | `migrate()` returns `pendingBackfills` and runs no SQL for them; `engine.backfillFormulaRollups()` is gated only by `_orglet.rollup_backfills` marker rows, one transaction per column with its marker, ordered by chain level; `cli/main.ts` calls it before `createApiServer` and logs only when something was computed. Test "a second up on a completed database runs no backfill and no UPDATE" passes. |

**Score:** 2/2

## Required Artifacts

| Artifact | Status | Details |
|----------|--------|---------|
| `packages/formula/src/rollup-admission.ts`, `rollup-inputs.ts` | VERIFIED | Substantive, exported from barrel, used by CLI and engine |
| `packages/schema/src/rollup.ts` (VirtualChildren, isFormulaRollup), `backfills.ts`, `migrate.ts` | VERIFIED | Wired into engine and migrate |
| `packages/engine/src/{engine,rollups,formulas,store}.ts` | VERIFIED | Recompute and backfill implemented; no TODO/stub markers; the Wave 0 `it.todo` scaffolds were all replaced |
| `packages/cli/src/main.ts` | VERIFIED | `admitFormulaRollups` in `check` (l.76) and `up` (l.105), backfill (l.165), `dropRollupBackfills` on reset (l.201) |

## Key Links

| From | To | Status |
|------|----|--------|
| CLI `loadOrgSchema` | `admitFormulaRollups` before migrate | WIRED |
| `migrate()` pendingBackfills | engine marker-gated backfill | WIRED (engine derives its todo from registry and markers) |
| `computeRollups` | `rollupSelectSql(..., virtual)` | WIRED |

## Data-Flow

Child rows are loaded live from Postgres (`Store.liveRows` / `evaluateChildren`), formulas evaluated by `FormulaRegistry` in dependency order, values passed as unnest arrays to SQL. FLOWING.

## Behavioral Spot-Checks

Ran targeted suites on pglite (Node 22): formula (rollup-admission, rollup-inputs), engine (rollups-formula, formulas), schema (backfills, rollup, migrate), cli, metadata build: 9 files, 196 tests, all passed. Full-suite and 10-leg conformance results taken from 13-08-SUMMARY (not re-run, as instructed); the full-suite first runs showed only load-timeout failures in seed/upgrade-owner tests that passed on isolated rerun.

## Requirements Coverage

| Requirement | Source Plans | Status | Evidence |
|-------------|--------------|--------|----------|
| ROLL2-01 | 13-01 through 13-08 (all declare it) | SATISFIED | See truths 1 and 2. Marked complete in REQUIREMENTS.md (l.141, l.254). Text reflects the D-01 amendment ($Label, $CustomMetadata allowed). No orphaned Phase 13 IDs. |

## Anti-Patterns

None blocking. No TODO/FIXME in new formula/schema files.

## Human Verification

None required. Optional: an `orglet up` against a real database holding children, run twice (executors covered this in tests only).

## Notes (non-blocking)

- Pre-existing tsc errors in untouched test files (13-01/13-05 summaries).
- Isolated timeouts under load on seed/upgrade-owner tests, passing in isolation, match main.
- Cost O(children of affected parents) is accepted per D-15 and documented in PROJECT.md.

---
_Verified: 2026-10-24_
_Verifier: Claude (gsd-verifier)_
