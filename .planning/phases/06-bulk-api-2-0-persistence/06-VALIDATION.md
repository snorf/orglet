---
phase: 6
slug: bulk-api-2-0-persistence
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-10-10
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.2.7 (single root config, `@orglet/*` aliased to `src/index.ts`) |
| **Config file** | `vitest.config.ts` (root) |
| **Quick run command** | `pnpm vitest run packages/api/src/bulk packages/api/src/bulk.test.ts packages/api/src/bulk-persistence.test.ts` |
| **Full suite command** | `pnpm build && pnpm lint && pnpm test` (pglite), plus `ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test` at the phase gate (after `pnpm db:up`) |
| **Estimated runtime** | milliseconds for the pure rule tests; a few seconds per DB-backed file on pglite; full suite ~1-2 minutes |

All commands need Node 22 and Corepack pnpm (`nvm use 22 && corepack enable pnpm`); the research shell had Node 18, so the executor activates them first. Embedded pglite per test file by default (no Docker); `ORGLET_DATABASE_URL` switches to real Postgres 16. CI runs both jobs.

---

## Sampling Rate

- **After every task commit:** Run the task's `<automated>` command (the quick run command or a single file, under 30 s)
- **After every plan wave:** Run `pnpm vitest run packages/api packages/engine packages/cli && pnpm build && pnpm lint`
- **Before `/gsd:verify-work`:** Full suite green on pglite and on real Postgres 16
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD by planner | — | — | BULK-01 | integration | `pnpm vitest run packages/api/src/bulk-persistence.test.ts -t "survives a restart"` | ❌ W0 | ⬜ pending |
| TBD by planner | — | — | BULK-01 | integration | `pnpm vitest run packages/api/src/bulk-persistence.test.ts -t "per org and per user"` | ❌ W0 | ⬜ pending |
| TBD by planner | — | — | BULK-01 | integration | `pnpm vitest run packages/api/src/bulk-persistence.test.ts -t "reset"` | ❌ W0 | ⬜ pending |
| TBD by planner | — | — | BULK-02 | integration | `pnpm vitest run packages/api/src/bulk-persistence.test.ts -t "state machine"` | ❌ W0 | ⬜ pending |
| TBD by planner | — | — | BULK-02 | integration | `pnpm vitest run packages/api/src/bulk.test.ts -t "invalid job state"` | ✅ extends | ⬜ pending |
| TBD by planner | — | — | BULK-02 | integration | `pnpm vitest run packages/api/src/bulk-persistence.test.ts -t "reconcile"` | ❌ W0 | ⬜ pending |
| TBD by planner | — | — | BULK-03 | integration | `pnpm vitest run packages/api/src/bulk-persistence.test.ts -t "per chunk"` | ❌ W0 | ⬜ pending |
| TBD by planner | — | — | BULK-03 | integration | `pnpm vitest run packages/api/src/bulk-persistence.test.ts -t "result csv"` | ❌ W0 | ⬜ pending |
| TBD by planner | — | — | BULK-03 (D-19) | integration | engine-level test for the caller-supplied-client option (`packages/engine/src/*.test.ts`) | ❌ W0 | ⬜ pending |
| TBD by planner | — | — | BULK-04 | integration | `pnpm vitest run packages/api/src/bulk-persistence.test.ts -t "retention"` | ❌ W0 | ⬜ pending |
| TBD by planner | — | — | BULK-05 | unit | `pnpm vitest run packages/api/src/bulk/soql-rules.test.ts` | ❌ W0 | ⬜ pending |
| TBD by planner | — | — | BULK-05 | integration | `pnpm vitest run packages/api/src/bulk.test.ts -t "bulk query rules"` | ✅ extends | ⬜ pending |
| TBD by planner | — | — | Regression | integration | `pnpm vitest run packages/api/src/bulk.test.ts` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

The planner fills Task ID / Plan / Wave when PLAN.md files exist; the research's requirement map (06-RESEARCH.md §Validation Architecture) is the source for the rows above.

---

## Wave 0 Requirements

- [ ] `packages/api/src/bulk/soql-rules.test.ts` — BULK-05 pure table tests (needs `@jetstreamapp/soql-parser-js` added to `packages/api/package.json` first, lockfile committed)
- [ ] `packages/api/src/bulk-persistence.test.ts` — BULK-01..04 restart / reconcile / retention / per-chunk / reset tests (shared fixture with `bulk.test.ts`: `examples/acme`, `openTestDb`, per-file `test_<hex>` org schema; restart = second `createApiServer` on the same pool with a fresh login)
- [ ] `packages/api/src/bulk.test.ts` setup edit — call the bulk table-preparation function in `beforeAll`, the org-scoped drop in `afterAll`
- [ ] engine test for the D-19 caller-supplied-client option (events published after outer commit, allOrNone unwinds only engine work, no second BEGIN)
- [ ] No framework install needed

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real process restart of `orglet up` with a job mid-flight | BULK-02 | Killing a live process is not reproducible in vitest; the two-server test covers the same code path | `orglet up` against Docker Postgres, start a large ingest, `kill -9` during processing, `orglet up` again, `GET /jobs/ingest/{id}` shows `Failed` with the restart message; recorded in the plan SUMMARY |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
