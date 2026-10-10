---
phase: 6
slug: bulk-api-2-0-persistence
status: draft
nyquist_compliant: true
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
| 06-01-T1 | 06-01 | 1 | BULK-03 (D-19) | integration (RED) | `pnpm vitest run packages/engine/src/transaction.test.ts; test $? -ne 0` | ❌ created by task | ⬜ pending |
| 06-01-T2 | 06-01 | 1 | BULK-03 (D-19) | integration | `pnpm vitest run packages/engine/src && pnpm exec eslint packages/engine/src` | ✅ after T1 | ⬜ pending |
| 06-02-T1 | 06-02 | 1 | BULK-05 | unit (RED) | `pnpm vitest run packages/api/src/bulk/soql-rules.test.ts; test $? -ne 0` | ❌ created by task | ⬜ pending |
| 06-02-T2 | 06-02 | 1 | BULK-05 | unit | `pnpm vitest run packages/api/src/bulk/soql-rules.test.ts && pnpm exec eslint packages/api/src/bulk/soql-rules.ts packages/api/src/bulk/soql-rules.test.ts` | ✅ after T1 | ⬜ pending |
| 06-03-T1 | 06-03 | 2 | BULK-01, BULK-02, BULK-04 | integration (SQL) | `pnpm vitest run packages/api/src/bulk/schema.test.ts && pnpm vitest run packages/api/src/bulk.test.ts` | ❌ created by task | ⬜ pending |
| 06-03-T2 | 06-03 | 2 | BULK-01, BULK-02, BULK-04 | build + integration | `pnpm build && pnpm exec eslint <06-03 files> && pnpm vitest run packages/cli packages/api/src/bulk/schema.test.ts` | ✅ | ⬜ pending |
| 06-04-T1 | 06-04 | 3 | BULK-01, BULK-03 | integration (store) | `pnpm vitest run packages/api/src/bulk/store.test.ts packages/api/src/bulk/schema.test.ts` | ❌ created by task | ⬜ pending |
| 06-04-T2 | 06-04 | 3 | BULK-02, BULK-03, BULK-04 | integration (HTTP) | `pnpm vitest run packages/api/src/bulk.test.ts packages/api/src/bulk && pnpm build && pnpm lint` (incl. `-t "invalid job state"` / `"only UploadComplete and Aborted"`) | ✅ extends | ⬜ pending |
| 06-04-T3 | 06-04 | 3 | BULK-03 (D-06, D-19) | integration (HTTP) | `pnpm vitest run packages/api/src/bulk-persistence.test.ts -t "per chunk" && pnpm vitest run packages/api/src/bulk-persistence.test.ts -t "result csv"` | ❌ created by task | ⬜ pending |
| 06-05-T1 | 06-05 | 4 | BULK-01, BULK-02 | integration (store) | `pnpm vitest run packages/api/src/bulk/store.test.ts` | ✅ extends | ⬜ pending |
| 06-05-T2 | 06-05 | 4 | BULK-05, D-20 | integration (HTTP) | `pnpm vitest run packages/api/src/bulk.test.ts -t "bulk query rules" && pnpm vitest run packages/api/src/bulk.test.ts packages/api/src/bulk packages/api/src/bulk-persistence.test.ts && pnpm build && pnpm lint` | ✅ extends | ⬜ pending |
| 06-06-T1 | 06-06 | 5 | BULK-01 ("survives a restart", "per org and per user", "reset"), BULK-02 ("state machine", "reconcile"), BULK-04 ("retention") | integration (HTTP) | `pnpm vitest run packages/api/src/bulk-persistence.test.ts` (each `-t` name runnable alone) | ✅ extends | ⬜ pending |
| 06-06-T2 | 06-06 | 5 | BULK-01..04 (docs) | grep | `grep -n "^## Bulk API 2.0" README.md && grep -n "_orglet.bulk_ingest_jobs" README.md && ...` | ✅ | ⬜ pending |
| 06-06-T3 | 06-06 | 5 | Regression | full suite | `pnpm build && pnpm lint && pnpm test` (+ real Postgres leg when Docker is up) | ✅ | ⬜ pending |
| 06-06-T4 | 06-06 | 5 | Manual-only row (real restart) | human checkpoint | `echo "human checkpoint: outcome recorded in 06-06-SUMMARY.md"` (steps in the plan's how-to-verify) | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

Filled by the planner on 2026-10-10. Wave-1 plans lint only their own files because they run in parallel with RED commits (see 06-01/02/03).

---

## Wave 0 Requirements

- [x] `packages/api/src/bulk/soql-rules.test.ts` (06-02-T1) — BULK-05 pure table tests (needs `@jetstreamapp/soql-parser-js` added to `packages/api/package.json` first, lockfile committed)
- [x] `packages/api/src/bulk-persistence.test.ts` (06-04-T3 creates, 06-06-T1 completes) — BULK-01..04 restart / reconcile / retention / per-chunk / reset tests (shared fixture with `bulk.test.ts`: `examples/acme`, `openTestDb`, per-file `test_<hex>` org schema; restart = second `createApiServer` on the same pool with a fresh login)
- [x] `packages/api/src/bulk.test.ts` setup edit (06-04-T2) — call the bulk table-preparation function in `beforeAll`, the org-scoped drop in `afterAll`
- [x] engine test for the D-19 caller-supplied-client option (events published after outer commit, allOrNone unwinds only engine work, no second BEGIN) — `packages/engine/src/transaction.test.ts` (06-01-T1)
- [ ] No framework install needed

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real process restart of `orglet up` with a job mid-flight | BULK-02 | Killing a live process is not reproducible in vitest; the two-server test covers the same code path | Automated in 06-06-T3 when Docker is available: `orglet up` against Docker Postgres, an uploaded job forced to `InProgress` in SQL, `kill -9`, `orglet up` again, `GET /jobs/ingest/{id}` shows `Failed` with the restart message; recorded in the plan SUMMARY |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** planner sign-off 2026-10-10 (plan checker to confirm)
