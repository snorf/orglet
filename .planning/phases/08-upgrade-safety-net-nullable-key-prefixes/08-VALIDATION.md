---
phase: 8
slug: upgrade-safety-net-nullable-key-prefixes
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-10-13
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.2.7 (single root config, includes `packages/*/src/**/*.test.ts` and `packages/*/test/**/*.test.ts`) |
| **Config file** | `vitest.config.ts` (root); backend switch in `test/db.ts` (pglite default, Postgres via `ORGLET_DATABASE_URL`) |
| **Setup (every shell)** | `source ~/.nvm/nvm.sh && nvm use && corepack enable pnpm` (default shell has Node 18, no pnpm) |
| **Quick run command** | `pnpm vitest run <file(s) touched by the task>` |
| **Full suite command** | `pnpm build && pnpm lint && pnpm test`; Postgres leg: `pnpm db:up && ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test` |
| **Estimated runtime** | quick ~5-20 s per file (pglite start per file); full suite a few minutes |

---

## Sampling Rate

- **After every task commit:** the task's `<automated>` command (narrowest `pnpm vitest run <files>`).
- **After every plan wave:** `pnpm build && pnpm lint && pnpm test` (pglite). Exception: after wave 1 the full `pnpm build` is expected to fail in engine/soql until 08-03 (wave 2) lands; wave-1 gate is `pnpm exec tsc -b packages/schema/tsconfig.json && pnpm test`.
- **Before `/gsd:verify-work`:** full suite green on pglite and Postgres 16 (local or CI `test-postgres`), CI `sigha-sync-check` green.
- **Max feedback latency:** ~20 s for a task-level run.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 8-01-01 | 01 | 1 | MIGR-04 | integration | `pnpm vitest run packages/schema/src/pglite-compat.test.ts packages/schema/src/migrate.test.ts -t "pg_indexes\|idempotent"` | ✅ (extended) | ⬜ pending |
| 8-01-02 | 01 | 1 | MIGR-02 | integration | `pnpm vitest run packages/schema/src/migrate.test.ts` | ✅ (FK test rewritten) | ⬜ pending |
| 8-02-01 | 02 | 1 | BASE2-05 | unit | `pnpm vitest run packages/metadata` | ✅ build.test.ts + ❌ W0 fixture `packages/metadata/test/fixtures/null-prefix/` | ⬜ pending |
| 8-02-02 | 02 | 1 | BASE2-05 | unit + integration | `pnpm vitest run packages/schema/src/ids.test.ts packages/schema/src/prefixes.test.ts && pnpm exec tsc -b packages/schema/tsconfig.json && ! grep -nE 'keyPrefix!\|keyPrefix as string\|keyPrefix \?\? "' packages/schema/src/*.ts packages/metadata/src/*.ts` | ✅ | ⬜ pending |
| 8-03-01 | 03 | 2 | BASE2-05 | integration | `pnpm vitest run packages/engine/src/null-prefix.test.ts packages/engine/src/engine.test.ts packages/engine/src/bootstrap.test.ts packages/engine/src/query.test.ts` | ❌ W0 `null-prefix.test.ts` | ⬜ pending |
| 8-03-02 | 03 | 2 | BASE2-05 | unit | `pnpm build && pnpm lint && pnpm vitest run packages/soql packages/api/src/describe.test.ts packages/engine` | ❌ W0 `describe.test.ts` | ⬜ pending |
| 8-04-01 | 04 | 1 | (SC5) | script + CI | `! grep -n "sed -i ''" scripts/sync-sigha.sh && bash -n scripts/sync-sigha.sh` + scratch `SIGHA_DEST` sync + `diff -r`; CI `sigha-sync-check` | ❌ W0 CI job | ⬜ pending |
| 8-04-02 | 04 | 1 | (SC5) | unit | `pnpm vitest run packages/formula && git diff --exit-code packages/formula/src/formula.test.ts` | ❌ W0 `expectations.test.ts` | ⬜ pending |
| 8-04-03 | 04 | 1 | (SC5) | review + grep | audit completeness loop (prints no `MISSING`) | ❌ W0 `08-GROUP-OWNED-AUDIT.md` | ⬜ pending |
| 8-05-01 | 05 | 3 | (SC5) | unit | `pnpm vitest run packages/metadata/src/diagnostics.test.ts` | ❌ W0 `diagnostics.ts` / `diagnostics.test.ts` | ⬜ pending |
| 8-05-02 | 05 | 3 | (SC5) | unit | `pnpm vitest run packages/metadata && pnpm vitest run packages/schema/src/rollup.test.ts packages/schema/src/migrate.test.ts` | ✅ | ⬜ pending |
| 8-05-03 | 05 | 3 | MIGR-02 | integration | `pnpm vitest run packages/schema packages/metadata && pnpm build && pnpm lint` | ✅ | ⬜ pending |
| 8-06-01 | 06 | 4 | (SC5) | unit | `pnpm vitest run packages/formula` | ✅ | ⬜ pending |
| 8-06-02 | 06 | 4 | (SC5) | unit + integration | `pnpm vitest run packages/engine/src/formulas.test.ts packages/engine/src/query.test.ts packages/engine/src/engine.test.ts && pnpm build && pnpm lint && pnpm test` | ❌ W0 `formulas.test.ts` | ⬜ pending |
| 8-07-01 | 07 | 4 | MIGR-01 | fixture check | `test "$(ls packages/metadata/test/fixtures/baseline-v1.0/objects/*.json \| wc -l \| tr -d ' ')" = 35` + per-file `cmp` against commit 1b737c1 + `test -z "$(git tag --list \| grep -vx v1.0)"` (no new tag; pre-existing `v1.0` untouched) + audit lists `baseline-v1.0/objects/Group.json` | ❌ W0 fixture dir | ⬜ pending |
| 8-07-02 | 07 | 4 | MIGR-01, MIGR-04 | integration (both backends) | `pnpm vitest run packages/engine/src/upgrade.test.ts` (+ same with `ORGLET_DATABASE_URL`) + audit lists `upgrade.test.ts` + 08-04 completeness loop prints no `MISSING` | ❌ W0 `upgrade.test.ts` | ⬜ pending |
| 8-08-01 | 08 | 1 | (SC5) | upstream tests | upstream's own test command on `feat/unary-bang` in `/Users/johankarlsteen/Development.nosync/sigha-upstream`, after `source ~/.nvm/nvm.sh` + `nvm use` (upstream `.nvmrc`, fallback 22); toolchain recorded before install | n/a (external clone) | ⬜ pending |
| 8-08-02 | 08 | 1 | (SC5) | upstream tests | upstream's own test command on `feat/polymorphic-colon-ref` | n/a (external clone) | ⬜ pending |
| 8-09-01 | 09 | 2 | (SC5) | checkpoint:decision | manual (Johan approves fork) | n/a | ⬜ pending |
| 8-09-02 | 09 | 2 | (SC5) | CLI check | `gh repo view snorf/sigha --json parent -q .parent.owner.login` = `rfaulhaber` | n/a | ⬜ pending |
| 8-09-03 | 09 | 2 | (SC5) | checkpoint:decision | manual (Johan approves push) | n/a | ⬜ pending |
| 8-10-01 | 10 | 3 | (SC5) | CLI check | `git ls-remote --heads fork` lists exactly the approved branches, or `grep -qx "Push decision: stop" 08-09-SUMMARY.md` | n/a | ⬜ pending |
| 8-10-02 | 10 | 3 | (SC5) | checkpoint:human-action | manual (Johan opens PRs, pastes URLs) | n/a | ⬜ pending |
| 8-10-03 | 10 | 3 | (SC5) | grep + script | `grep -nE '^## (Pending upstream changes\|Upstream changes)$' packages/sigha/VENDOR.md` + scratch re-sync keeps section once | ✅ (VENDOR.md) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*(SC5) = phase success criterion 5 groundwork; frontmatter `requirements` of those plans carry BASE2-05 / MIGR-01 for traceability.*

---

## Wave 0 Requirements

Created inside the plan that needs them (each is the first step of its task, before the implementation it verifies):

- [ ] `packages/schema/src/pglite-compat.test.ts`: `pg_indexes` / `pg_sequences` check, run first in 08-01 Task 1 (MIGR-04; research MEDIUM confidence)
- [ ] `packages/metadata/test/fixtures/null-prefix/` (`objects/PrefixlessThing.json`, `objects/PrefixlessLink.json`, `standardValueSets.json`, `README.md`) — 08-02 Task 1 (BASE2-05)
- [ ] `packages/engine/src/null-prefix.test.ts` — 08-03 Task 1 (BASE2-05)
- [ ] `packages/api/src/describe.test.ts` — 08-03 Task 2 (BASE2-05)
- [ ] `scripts/sync-sigha.sh` edits + `.github/workflows/ci.yml` job `sigha-sync-check` — 08-04 Task 1 (SC5)
- [ ] `packages/formula/src/expectations.test.ts` (4 `it.fails`, 2 guard `it`s) + TESTING.md `it.fails` note — 08-04 Task 2 (SC5)
- [ ] `.planning/phases/08-upgrade-safety-net-nullable-key-prefixes/08-GROUP-OWNED-AUDIT.md` — 08-04 Task 3 (SC5)
- [ ] `packages/metadata/src/diagnostics.ts` + `diagnostics.test.ts` — 08-05 Task 1 (SC5)
- [ ] `packages/engine/src/formulas.test.ts` — 08-06 Task 2 (SC5)
- [ ] `packages/metadata/test/fixtures/baseline-v1.0/` (35 objects + `standardValueSets.json` + README with SHA `1b737c12d8d10408fe5713a37d4d92557209f229`) — 08-07 Task 1 (MIGR-01)
- [ ] `packages/engine/src/upgrade.test.ts` — 08-07 Task 2 (MIGR-01, MIGR-04)
- [x] No framework install needed (vitest, pglite, pg already present).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Fork `snorf/sigha` created | SC5 | Outward-facing; needs Johan's explicit OK (D-19) | 08-09 Task 1 checkpoint, then `gh repo view snorf/sigha` |
| Branches pushed to the fork | SC5 | Outward-facing; second explicit OK (D-19) | 08-09 Task 3 checkpoint, then 08-10 Task 1 `git ls-remote --heads fork` |
| Upstream PR(s) opened | SC5 | Johan opens PRs himself; Claude never runs `gh pr create` (D-18) | 08-10 Task 2: Johan pastes PR URLs; 08-10 Task 3 records them in VENDOR.md |
| `sigha-sync-check` on GNU/Linux | SC5 | Runs only in GitHub Actions | Push of the phase branch is Johan's call; check the job result on the PR |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or are explicit checkpoints
- [x] Sampling continuity: no 3 consecutive tasks without automated verify (checkpoints in 08-09/08-10 alternate with automated checks)
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags (`vitest run` only)
- [x] Feedback latency < 20 s per task-level run
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
