---
phase: 13-roll-ups-over-formula-fields
plan: 07
subsystem: engine
tags: [rollup, formula, backfill, engine, pglite]
requires: ["13-03", "13-05", "13-06"]
provides:
  - DmlEngine.backfillFormulaRollups(): Promise<string[]> (marker-gated, chain-ordered, crash-safe)
  - RollupRegistry.all() and level(field)
  - Store.liveRows(client, obj)
affects: [13-08]
tech-stack:
  patterns: ["one transaction per backfilled column together with its _orglet marker row"]
key-files:
  modified:
    - packages/engine/src/engine.ts
    - packages/engine/src/rollups.ts
    - packages/engine/src/store.ts
    - packages/engine/src/rollups-formula.test.ts
key-decisions:
  - "Backfill gate is the marker row alone: a formula roll-up without one is computed, so a crash after migrate is self-healing and a completed database is silent"
  - "evaluateChildren and the backfill share a private virtualRows helper; no behaviour change for recompute"
requirements-completed: [ROLL2-01]
duration: ~30min
completed: 2026-10-24
---

# Phase 13 Plan 07: Engine backfill for formula roll-ups Summary

`DmlEngine.backfillFormulaRollups()` fills every formula-dependent roll-up that has no `_orglet.rollup_backfills` row, lower chain levels first, each column in its own transaction together with its marker, without hooks, rules or events, in import mode too. `orglet up` wiring is plan 08.

## Tasks
1. RED: six backfill tests replacing the five todos (47aebc4)
2. GREEN: `backfillFormulaRollups`, `RollupRegistry.all()/level()`, `Store.liveRows`, shared `virtualRows` (1998d22)

Verification: `npx vitest run packages/engine/src/rollups-formula.test.ts` 16/16. `npx vitest run packages/engine` 177 passed, 2 timeouts under machine load (seed.test.ts, upgrade-owner.test.ts); both pass on rerun (35/35 with rollups-formula). eslint clean and no tsc errors in touched files (engine.test.ts error pre-existing). `pnpm build` and the full `pnpm lint` not run, per instruction.

## Deviations from Plan
- [Rule 1 - Bug, test] The plan's connect spy ignored pg's `pool.connect(callback)` form that `pool.query()` uses internally, which hung the test. The spy now passes calls with arguments through and wraps only the no-argument promise form. The invariant (zero UPDATE statements, unchanged marker count) is unchanged.
- No changes were needed in packages/formula or packages/schema.

## Known Stubs
None.

## Self-Check: PASSED
Commits 47aebc4 and 1998d22 exist; the four files are modified as listed.
