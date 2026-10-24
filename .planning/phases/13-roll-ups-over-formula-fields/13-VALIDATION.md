---
phase: 13
slug: roll-ups-over-formula-fields
status: draft
nyquist_compliant: false
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
| (filled by planner) | | | ROLL2-01 | | | | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

See `13-RESEARCH.md` §"Validation Architecture" for the success-criterion → test map.

---

## Wave 0 Requirements

- [ ] `packages/formula/src/rollup-admission.test.ts` — SC1 admission, SC3 (`UNSUPPORTED:rollup-formula`), SC4 (`UNSUPPORTED:rollup-cycle`), `--strict` warnings/diagnostics 1:1
- [ ] `packages/engine/src/rollups-formula.test.ts` — SC1 recompute (insert/update/delete/undelete/reparent, field only the formula reads), D-05 rounding, SC2 backfill once / silent second run / crash recovery, SOQL `INVALID_FIELD`
- [ ] `packages/schema/src/backfills.test.ts` — marker-table helpers, per-org isolation, reset
- [ ] Update `packages/metadata/src/build.test.ts` (~L568-580) and `packages/metadata/src/rollup.test.ts` — rewrite the tests asserting the old formula rejection
- [ ] Extend `packages/schema/src/rollup.test.ts`, `packages/schema/src/migrate.test.ts`, `packages/engine/src/formulas.test.ts` (D-02 topological order)
- Framework install: none.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Datetime array params on real Postgres vs pglite | ROLL2-01 | pglite is the default test DB | `pnpm db:up && ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
