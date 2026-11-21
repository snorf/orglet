---
phase: 16
slug: archive-fixture-generator
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-11-07
---

# Phase 16 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.2.7 (root `vitest.config.ts`, `environment: node`, `testTimeout 30_000`, `hookTimeout 60_000`) |
| **Config file** | `vitest.config.ts` (Wave 0 adds `archive` to the `@orglet/*` alias list) |
| **Quick run command** | `pnpm vitest run packages/archive` (Node 22 required; default `node` on this machine is 18) |
| **Full suite command** | `pnpm build && pnpm lint && pnpm typecheck:scripts && pnpm test` |
| **Fixture gate** | `pnpm archive-fixture:check` (exit 1 on any differing, missing or stray file) |
| **Estimated runtime** | ~5 s quick, ~90 s full (pglite boot + 58 Bulk queries is about 2 s per generator run) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run packages/archive` (and `pnpm archive-fixture:check` once the seed exists)
- **After every plan wave:** Run `pnpm build && pnpm lint && pnpm typecheck:scripts && pnpm test`
- **Before `/gsd:verify-work`:** Full suite must be green, `pnpm archive-fixture:check` exits 0, `git status` clean after `pnpm archive-fixture:gen`
- **Max feedback latency:** 90 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 16-01-01 | 01 | 1 | FIX-01 (SC1) | unit | `pnpm vitest run packages/archive/src/keys.test.ts && pnpm build` | ❌ W0 (created by task) | ⬜ pending |
| 16-01-02 | 01 | 1 | FIX-01 (SC1) | unit | `pnpm vitest run packages/archive/src/columns.test.ts packages/archive/src/csv.test.ts` | ❌ W0 (created by task) | ⬜ pending |
| 16-01-03 | 01 | 1 | FIX-01 (SC2) | unit | `pnpm vitest run packages/archive && pnpm build && pnpm lint` (indexsql.test.ts loads DDL into pglite) | ❌ W0 (created by task) | ⬜ pending |
| 16-02-01 | 02 | 1 | FIX-01 (D-01) | unit | `pnpm vitest run packages/engine/src/bootstrap.test.ts` | ✅ (extended) | ⬜ pending |
| 16-02-02 | 02 | 1 | FIX-01 (D-12) | unit | `pnpm vitest run packages/engine/src/bootstrap.test.ts packages/schema && pnpm typecheck:scripts` | ✅ (test/db.ts) | ⬜ pending |
| 16-02-03 | 02 | 1 | FIX-01 (D-04) | unit | `pnpm vitest run packages/archive/src/guard.test.ts && pnpm typecheck:scripts && pnpm lint` | ❌ W0 (created by task) | ⬜ pending |
| 16-03-01 | 03 | 2 | FIX-01 (spikes) | spike | `test ! -e scripts/gen-archive-fixture/spike.ts && grep -q "Spike findings" .planning/phases/16-archive-fixture-generator/16-03-SUMMARY.md` | n/a | ⬜ pending |
| 16-03-02 | 03 | 2 | FIX-01 (D-02/D-03/D-07) | typecheck | `pnpm typecheck:scripts && pnpm lint` | ❌ W0 (created by task) | ⬜ pending |
| 16-03-03 | 03 | 2 | FIX-01 (D-01/D-02/D-03) | integration | `pnpm vitest run packages/archive/src/seed.test.ts && pnpm typecheck:scripts && pnpm lint` | ❌ W0 (created by task) | ⬜ pending |
| 16-04-01 | 04 | 3 | FIX-01 (SC1, D-05/D-06/D-13) | integration | `pnpm vitest run packages/archive/src/export.test.ts && pnpm typecheck:scripts && pnpm lint` | ❌ W0 (created by task) | ⬜ pending |
| 16-04-02 | 04 | 3 | FIX-01 (SC2, D-10) | unit | `pnpm vitest run packages/archive/src/indexrows.test.ts && pnpm typecheck:scripts && pnpm lint` | ❌ W0 (created by task) | ⬜ pending |
| 16-05-01 | 05 | 4 | FIX-01 (SC1/SC2, D-04/D-11) | integration | `pnpm typecheck:scripts && pnpm lint` + inline `tsx -e` buildFixture smoke (see plan) | ❌ W0 (created by task) | ⬜ pending |
| 16-05-02 | 05 | 4 | FIX-01 (D-15) | integration | `pnpm archive-fixture:check` + `_deleted` and `Period=0/files` presence checks | ❌ W0 (created by task) | ⬜ pending |
| 16-06-01 | 06 | 5 | FIX-01 (SC1/SC2/SC3, D-04/D-06/D-07/D-09) | integration | `pnpm vitest run packages/archive && pnpm build && pnpm lint && pnpm typecheck:scripts && pnpm test && pnpm archive-fixture:check && pnpm archive-fixture:gen && test -z "$(git status --porcelain examples/acme-archive)"` | ❌ W0 (fixture.test.ts created by task) | ⬜ pending |
| 16-06-02 | 06 | 5 | FIX-01 (D-11 README) | manual + check | `pnpm archive-fixture:check` (README review and optional Postgres 16 load are manual) | n/a | ⬜ pending |

All commands run with `export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH" &&` first (Node 22).

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*


---

## Wave 0 Requirements

- [ ] `packages/archive/` (package.json, tsconfig.json, src/index.ts) plus root `tsconfig.json` reference and `vitest.config.ts` alias (16-01-01)
- [ ] `test/db.ts` — export an always-pglite `openPgliteDb()` (the existing `openTestDb()` switches to Docker Postgres when `ORGLET_DATABASE_URL` is set) (16-02-02)
- [ ] `packages/archive/src/{keys,columns,indexsql}.test.ts` — the pure Heimdall-format rules (16-01-01..03; plus csv.test.ts)
- [ ] `packages/archive/src/fixture.test.ts` — determinism, MD5, structure, index load (vitest's include glob does not cover `scripts/`, so the generator test lives here and imports `buildFixture` from the script) (16-06-01; seed/export/indexrows/guard tests in 16-02/03/04)
- [ ] `packages/engine/src/bootstrap.test.ts` — `BootstrapOptions` ids/now honoured, unchanged when absent (16-02-01)
- [ ] Spikes before seed work: Summary-field acceptance in import mode; AutoNumber `Name` on BigTable__c in import mode; `Is_Overdue__c` formula inputs; tsx `--tsconfig` flag form (16-03-01; the planner already verified `tsx --tsconfig tsconfig.test.json <file>` resolves `@orglet/*` and read the `Is_Overdue__c` formula: it uses `TODAY()`, so seed end dates stay on/before 2025-12-31)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `index.sql` runs unchanged on Postgres 16 (D-09) | FIX-01 | pglite is the CI path; a real Postgres 16 needs Docker | `pnpm db:up`, then `psql $ORGLET_DATABASE_URL -v ON_ERROR_STOP=1 -f examples/acme-archive/index.sql` into an empty schema; expect no errors |
| Fixture README is readable as the Phase 18 contract (D-11) | FIX-01 | Prose quality | Read `examples/acme-archive/README.md`; confirm layout, period story and regenerate command are described |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (each test file is created by the task that first runs it)
- [x] No watch-mode flags
- [ ] Feedback latency < 90s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
