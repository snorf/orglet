---
phase: 1
slug: test-infrastructure-ci
status: ready
nyquist_compliant: true
wave_0_complete: true
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
| 01-01-T1 | 01 | 1 | INFRA-01, INFRA-03 | build + lint | `pnpm install --frozen-lockfile && pnpm build && pnpm exec eslint test/db.ts packages/schema/src/db.ts packages/cli/src/main.ts` | ❌ W0 creates `test/db.ts` | ⬜ pending |
| 01-01-T2 | 01 | 1 | INFRA-02 | integration | `env -u ORGLET_DATABASE_URL pnpm vitest run packages/schema/src/pglite-compat.test.ts` → `4 passed \| 1 skipped` | ❌ W0 creates it | ⬜ pending |
| 01-01-T3 | 01 | 1 | INFRA-01 | integration | `env -u ORGLET_DATABASE_URL pnpm test && pnpm lint && pnpm build` → `13 passed (13)` | ✅ | ⬜ pending |
| 01-02-T1 | 02 | 1 | INFRA-05, INFRA-06, INFRA-07 | static | `ruby -ryaml -e '...'` → `test-pglite,test-postgres`; `! grep -nE "sync-sigha\|conformance\|corepack" .github/workflows/ci.yml` | ❌ W0 creates ci.yml | ⬜ pending |
| 01-02-T2 | 02 | 1 | INFRA-03 (docs) | static | `grep -c "actions/workflows/ci.yml/badge.svg?branch=main" README.md && docker compose config -q` | ✅ | ⬜ pending |
| 01-03-T1 | 03 | 2 | INFRA-01, INFRA-03 | integration + smoke | `env -u ORGLET_DATABASE_URL pnpm test && ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test`; `orglet up` smoke on port 8099 → HTTP 200 | ✅ | ⬜ pending |
| 01-03-T2 | 03 | 2 | INFRA-04 | checkpoint | Johan confirms (D-08) | n/a | ⬜ pending |
| 01-03-T3 | 03 | 2 | INFRA-04, 05, 06, 07 | CLI + CI | `gh repo view snorf/orglet --json isPrivate,owner,defaultBranchRef,repositoryTopics` → `[false,"snorf","main",6]`; `gh run view <id>` both jobs success; `gh run view <id> --log \| grep -ci sync-sigha` → 0 | ❌ repo created here | ⬜ pending |
| 01-04-T1 | 04 | 3 | INFRA-05, INFRA-06 | checkpoint | Johan confirms ruleset, push, PR | n/a | ⬜ pending |
| 01-04-T2 | 04 | 3 | INFRA-05, INFRA-06 | CLI + CI | `gh api repos/snorf/orglet/rulesets` → `active`; `gh pr checks ... --required` → both pass | ❌ ruleset created here | ⬜ pending |

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
| `orglet up` still reaches Docker Postgres | INFRA-03 | No e2e server test in scope | Scripted in 01-03-T1: `pnpm db:up`, `orglet up --project examples/acme --port 8099 --org-schema phase1_smoke` without `--db`, `curl localhost:8099/services/data` → 200, then `orglet reset --org-schema phase1_smoke` |
| Repo creation and first push | INFRA-04 | Outward-facing, confirmed with Johan (D-08) | Follow `01-RESEARCH-B-github.md` command sequence, stop at each checkpoint |
| Ruleset on `main` | INFRA-05/06 | Requires one completed CI run first | Apply the ruleset JSON from part B via `gh api` after the first green run |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-09-30 (plan-checker pass, 0 blockers)
