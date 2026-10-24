---
phase: 13-roll-ups-over-formula-fields
plan: 08
subsystem: cli
tags: [rollup, formula, cli, backfill, docs]
requires: ["13-03", "13-05", "13-07"]
provides:
  - orglet check/up admit formula roll-ups (admitFormulaRollups) before planning
  - orglet up backfills formula roll-ups before the server listens
  - orglet reset drops the org's rollup_backfills markers
  - PROJECT.md documents the D-15 cost and three Phase 13 decisions
affects: [verify-work]
tech-stack:
  added: ["@orglet/formula workspace dependency for @orglet/cli"]
key-files:
  modified:
    - packages/cli/src/main.ts
    - packages/cli/src/main.test.ts
    - packages/cli/package.json
    - packages/cli/tsconfig.json
    - pnpm-lock.yaml
    - .planning/PROJECT.md
key-decisions:
  - "Backfill errors already carry the `roll-up backfill of <Parent>.<Field> failed:` text from the engine, so the CLI prints `error: <message>` and returns 1"
requirements-completed: [ROLL2-01]
duration: ~25min
completed: 2026-10-24
---

# Phase 13 Plan 08: CLI wiring and phase gate Summary

**`orglet check`/`up` now admit roll-ups over formula fields (rejected ones warn and never get a column), `up` backfills them before listening, `reset` clears their markers, and PROJECT.md records the cost.**

## Accomplishments

- `check` and `up` wrap `loadOrgSchema` in `admitFormulaRollups`, so `UNSUPPORTED:rollup-formula` / `rollup-cycle` warnings are printed, counted by `--strict`, and the field is gone before reconcile/migrate.
- `up` awaits `engine.backfillFormulaRollups()` after the engine warnings and before `createApiServer`; a failure prints `error: ...` and returns 1.
- `reset` calls `dropRollupBackfills(pool, c.orgSchema)` unconditionally.
- Three new check tests (volatile formula + `--strict`, accepted same-object formula with no warning, formula -> roll-up -> formula cycle with cause-before-effect ordering). Written RED first (2 of 3 failed), green after wiring.
- PROJECT.md: Known gaps line (O(children of affected parents), in-memory backfill, rounding choice, stricter global admission) and three Key Decisions rows (Pending Phase 13).
- pnpm-lock.yaml diff: only the `packages/cli` importer gained `@orglet/formula` (3 lines).

## Commits

- 2f6e57e feat(13-08): wire formula roll-up admission, backfill and marker reset into the CLI
- 9a183c0 docs(13-08): document formula roll-up cost and decisions in PROJECT.md

## Phase gate results (stated as run)

| Command | Result |
| --- | --- |
| `pnpm vitest run packages/cli` | 21/21 passed |
| `pnpm build` | green |
| `pnpm lint` | green |
| `pnpm test` (pglite) | NOT fully green on first run: 866 passed, 2 failed, both 30 s timeouts: `seed.test.ts` (reset/second schema Ids) and `upgrade-owner.test.ts`. Rerun in isolation of `seed.test.ts`, `upgrade.test.ts`, `upgrade-owner.test.ts`: 3 files, 23/23 passed. Treated as the known CPU-load timeouts; no code failure observed |
| `ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test` (Postgres 16) | NOT fully green on first run: 869 passed, 1 failed, 1 skipped; the failure was a 30 s timeout in `upgrade-owner.test.ts`. Isolated rerun on Postgres: 2/2 passed (15.7 s) |
| `bash conformance/run-all.sh` | **Partially run, exit 1 (environment failure).** All five jsforce legs PASS (jsforce-subset 32/32, describe-check, poly-check 4/4 or equivalent, rollup-check, cmdt-check 8/8). All five Python legs (simple-salesforce, describe-check-python, poly-check-python, rollup-check-python, cmdt-check-python) did NOT run: `env: conformance/python/.venv/bin/python: Bad CPU type in executable` (venv built for a different CPU architecture). Not repaired, per instructions. Python-leg result is therefore unknown, not a pass |
| `git status --porcelain examples/ conformance/` | empty (acme and conformance unchanged) |

Note the Python legs would have exercised pre-existing and Phase 13 rollup behaviour through simple-salesforce; the jsforce rollup-check leg covers the same Phase 13 surface and passed.

## Deviations from Plan

None - plan executed as written. The only unmet gate item is the Python conformance legs (environment failure, above).

## Known Stubs

None.

## Self-Check: PASSED

Commits 2f6e57e and 9a183c0 exist; `grep -c "admitFormulaRollups(" packages/cli/src/main.ts` = 2; `grep -c "Pending (Phase 13)" .planning/PROJECT.md` = 3.
