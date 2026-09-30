---
phase: 1
slug: test-infrastructure-ci
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-09-30
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.2.7 |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm vitest run <file>` |
| **Full suite command** | `pnpm test` (pglite when `ORGLET_DATABASE_URL` is unset) |
| **Estimated runtime** | ~60 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run <changed file>`
- **After every plan wave:** Run `pnpm test`
- **Before `/gsd:verify-work`:** Full suite must be green on pglite and on Docker Postgres (`pnpm db:up && ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test`), and both CI jobs green on the phase branch
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| (filled by planner) | | | INFRA-01 | integration | `unset ORGLET_DATABASE_URL; pnpm test` | ✅ test files / ❌ W0 helper | ⬜ pending |
| (filled by planner) | | | INFRA-02 | integration | `pnpm vitest run packages/schema/src/pglite-compat.test.ts` | ❌ W0 | ⬜ pending |
| (filled by planner) | | | INFRA-03 | typecheck + manual | `pnpm build` | ✅ | ⬜ pending |
| (filled by planner) | | | INFRA-04 | CLI check | `gh repo view snorf/orglet --json isPrivate,description,repositoryTopics,owner` | ❌ (repo not created) | ⬜ pending |
| (filled by planner) | | | INFRA-05 | CI | `gh run view <id>` job `test-pglite` | ❌ W0 ci.yml | ⬜ pending |
| (filled by planner) | | | INFRA-06 | CI | `gh run view <id>` job `test-postgres` | ❌ W0 ci.yml | ⬜ pending |
| (filled by planner) | | | INFRA-07 | negative | `gh run view <id> --log \| grep -i sync-sigha` → empty | ❌ W0 ci.yml | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] Test bootstrap helper (`startPglite()`; see `01-RESEARCH-A-pglite.md`) — shared by the five DB-backed test files
- [ ] `packages/schema/src/pglite-compat.test.ts` (or first `it()` in `migrate.test.ts`) — D-19 compatibility test for INFRA-02
- [ ] `.github/workflows/ci.yml` — INFRA-05/06/07
- [ ] `.planning/codebase/TESTING.md` — record D-19 outcome (PASS, 2026-09-30, pglite 0.5.8)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `orglet up` still reaches Docker Postgres | INFRA-03 | No e2e server test in scope | `pnpm db:up`, run `orglet up --project examples/acme`, `curl localhost:8080/services/data/` |
| Repo creation and first push | INFRA-04 | Outward-facing, confirmed with Johan (D-08) | Follow `01-RESEARCH-B-github.md` command sequence, stop at each checkpoint |
| Ruleset on `main` | INFRA-05/06 | Requires one completed CI run first | Apply the ruleset JSON from part B via `gh api` after the first green run |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
