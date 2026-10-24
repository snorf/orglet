---
phase: 13
slug: roll-ups-over-formula-fields
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-10-24
---

# Phase 13 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.2.7 (single root `vitest.config.ts`, `@orglet/*` aliased to `src/index.ts`) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm vitest run packages/<pkg>/src/<file>.test.ts` |
| **Full suite command** | `pnpm test` (plus `pnpm build`, `pnpm lint`, `bash conformance/run-all.sh` at the phase gate) |
| **Estimated runtime** | ~60 seconds for the four touched packages on pglite |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run <the test file the task touches>`
- **After every plan wave:** Run `pnpm vitest run packages/metadata packages/schema packages/formula packages/engine && pnpm build && pnpm lint`
- **Before `/gsd:verify-work`:** Full suite must be green, once also with `ORGLET_DATABASE_URL` set against real Postgres (`pnpm db:up`)
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 13-01-T1 | 01 | 1 | ROLL2-01 | unit | `pnpm vitest run packages/metadata/src/build.test.ts packages/metadata/src/rollup.test.ts` | ✅ existing (rewritten) | ⬜ pending |
| 13-01-T2 | 01 | 1 | ROLL2-01 | unit | `pnpm vitest run packages/formula/src/dependencies.test.ts packages/formula/src/globals.test.ts` | ✅ existing (extended) | ⬜ pending |
| 13-01-T3 | 01 | 1 | ROLL2-01 | probe + scaffold | `pnpm vitest run packages/schema/src/pglite-compat.test.ts packages/formula/src/rollup-admission.test.ts packages/engine/src/rollups-formula.test.ts packages/schema/src/backfills.test.ts && pnpm lint` | ❌ W0 creates | ⬜ pending |
| 13-02-T1 | 02 | 2 | ROLL2-01 | unit | `pnpm vitest run packages/formula/src/rollup-inputs.test.ts` | ❌ created in task (TDD) | ⬜ pending |
| 13-02-T2 | 02 | 2 | ROLL2-01 | unit | `pnpm vitest run packages/formula/src/rollup-inputs.test.ts && pnpm build && pnpm lint` | ❌ created in 13-02-T1 | ⬜ pending |
| 13-03-T1 | 03 | 3 | ROLL2-01 | unit (RED; case 9 also asserts the follow-on compile failure) | `pnpm vitest run packages/formula/src/rollup-admission.test.ts` | W0 scaffold (13-01-T3) | ⬜ pending |
| 13-03-T2 | 03 | 3 | ROLL2-01 | unit | `pnpm vitest run packages/formula && pnpm build && pnpm lint` | W0 scaffold (13-01-T3) | ⬜ pending |
| 13-04-T1 | 04 | 2 | ROLL2-01 | unit + pglite | `pnpm vitest run packages/schema/src/rollup.test.ts && pnpm build && pnpm lint` | ✅ existing (extended) | ⬜ pending |
| 13-05-T1 | 05 | 3 | ROLL2-01 | integration (pglite) | `pnpm vitest run packages/schema/src/backfills.test.ts` | W0 scaffold (13-01-T3) | ⬜ pending |
| 13-05-T2 | 05 | 3 | ROLL2-01 | integration (pglite) | `pnpm vitest run packages/schema && pnpm build && pnpm lint` | ✅ existing (extended) | ⬜ pending |
| 13-06-T1 | 06 | 3 | ROLL2-01 | unit | `pnpm vitest run packages/engine/src/formulas.test.ts packages/engine/src/engine.test.ts packages/engine/src/query.test.ts` | ✅ existing (extended) | ⬜ pending |
| 13-06-T2 | 06 | 3 | ROLL2-01 | integration (pglite) | `pnpm vitest run packages/engine/src/rollups-formula.test.ts packages/engine/src/rollups.test.ts` | W0 scaffold (13-01-T3) | ⬜ pending |
| 13-06-T3 | 06 | 3 | ROLL2-01 | integration (pglite) | `pnpm vitest run packages/engine && pnpm build && pnpm lint` | W0 scaffold (13-01-T3) | ⬜ pending |
| 13-07-T1 | 07 | 4 | ROLL2-01 | integration (RED) | `pnpm vitest run packages/engine/src/rollups-formula.test.ts` | W0 scaffold (13-01-T3) | ⬜ pending |
| 13-07-T1 (SC2 silent) | 07 | 4 | ROLL2-01 | integration (pglite) | `pnpm vitest run packages/engine/src/rollups-formula.test.ts -t "a second up on a completed database runs no backfill and no UPDATE"` | W0 scaffold file (13-01-T3); test added by 13-07-T1 | ⬜ pending |
| 13-07-T2 | 07 | 4 | ROLL2-01 | integration (pglite) | `pnpm vitest run packages/engine && pnpm build && pnpm lint` | W0 scaffold (13-01-T3) | ⬜ pending |
| 13-08-T1 | 08 | 5 | ROLL2-01 | CLI unit (incl. D-09 cycle -> UNSUPPORTED:formula order) | `pnpm vitest run packages/cli && pnpm build && pnpm lint` | ✅ existing (extended) | ⬜ pending |
| 13-08-T2 | 08 | 5 | ROLL2-01 | full gate | `pnpm build && pnpm lint && pnpm test (+ Postgres run, conformance/run-all.sh)` | ✅ existing | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

See `13-RESEARCH.md` §"Validation Architecture" for the success-criterion → test map.

---

## Wave 0 Requirements

Created as `it.todo` scaffolds by 13-01-T3 (wave 1); filled by the plans named per file.

- [ ] `packages/formula/src/rollup-admission.test.ts` (filled by 13-03) — SC1 admission, SC3 (`UNSUPPORTED:rollup-formula`), SC4 (`UNSUPPORTED:rollup-cycle`), `--strict` warnings/diagnostics 1:1
- [ ] `packages/engine/src/rollups-formula.test.ts` (filled by 13-06, 13-07) — SC1 recompute (insert/update/delete/undelete/reparent, field only the formula reads), D-05 rounding, SC2 backfill once / silent second run / crash recovery, SOQL `INVALID_FIELD`
- [ ] `packages/schema/src/backfills.test.ts` (filled by 13-05) — marker-table helpers, per-org isolation, reset
- [ ] (13-01-T1) Update `packages/metadata/src/build.test.ts` (~L568-580) and `packages/metadata/src/rollup.test.ts` — rewrite the tests asserting the old formula rejection
- [ ] Probes (13-01-T2, 13-01-T3): formula-on-formula cycle compile behaviour; typed `unnest` array params incl. `+0000` datetimes and rounding
- [ ] Extend `packages/schema/src/rollup.test.ts` (13-04), `packages/schema/src/migrate.test.ts`, `packages/engine/src/formulas.test.ts` (D-02 topological order)
- Framework install: none.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Datetime array params on real Postgres vs pglite | ROLL2-01 | pglite is the default test DB | `pnpm db:up && ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test` |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [ ] Feedback latency < 90s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
