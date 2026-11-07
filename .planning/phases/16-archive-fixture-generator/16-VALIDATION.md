---
phase: 16
slug: archive-fixture-generator
status: draft
nyquist_compliant: false
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
| 16-01-xx | 01 | 1 | FIX-01 (SC1) | unit | `pnpm vitest run packages/archive/src/keys.test.ts` | ❌ W0 | ⬜ pending |
| 16-01-xx | 01 | 1 | FIX-01 (SC1) | unit | `pnpm vitest run packages/archive/src/columns.test.ts` | ❌ W0 | ⬜ pending |
| 16-01-xx | 01 | 1 | FIX-01 (SC2) | unit | `pnpm vitest run packages/archive/src/indexsql.test.ts` | ❌ W0 | ⬜ pending |
| 16-xx-xx | xx | x | FIX-01 (D-01) | unit | `pnpm vitest run packages/engine/src/bootstrap.test.ts` | ❌ W0 | ⬜ pending |
| 16-xx-xx | xx | x | FIX-01 (SC3) | integration | `pnpm vitest run packages/archive/src/fixture.test.ts` (two runs byte-identical, faked `Date`) | ❌ W0 | ⬜ pending |
| 16-xx-xx | xx | x | FIX-01 (SC3) | integration | `fixture.test.ts` (MD5 of every blob equals ContentVersion `Checksum`) | ❌ W0 | ⬜ pending |
| 16-xx-xx | xx | x | FIX-01 (SC2) | integration | `fixture.test.ts` (index.sql loads into fresh pglite; `s3path` joins resolve; hand-written expected rows) | ❌ W0 | ⬜ pending |
| 16-xx-xx | xx | x | FIX-01 (D-06/D-07) | integration | `fixture.test.ts` (story assertions: 2 CSVs for BigTable__c, `_deleted`, second version, shared blob, non-UTF-8 blob, ContentDocumentLink `Failed`) | ❌ W0 | ⬜ pending |
| 16-xx-xx | xx | x | FIX-01 (D-04) | unit | `fixture.test.ts` or `guard.test.ts` (leak guard names object and field only) | ❌ W0 | ⬜ pending |
| 16-xx-xx | xx | x | FIX-01 (D-15) | integration | `pnpm archive-fixture:check` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*The planner fills in the task IDs, plans and waves once PLAN.md files exist.*

---

## Wave 0 Requirements

- [ ] `packages/archive/` (package.json, tsconfig.json, src/index.ts) plus root `tsconfig.json` reference and `vitest.config.ts` alias
- [ ] `test/db.ts` — export an always-pglite `openPgliteDb()` (the existing `openTestDb()` switches to Docker Postgres when `ORGLET_DATABASE_URL` is set)
- [ ] `packages/archive/src/{keys,columns,indexsql}.test.ts` — stubs for the pure Heimdall-format rules
- [ ] `packages/archive/src/fixture.test.ts` — determinism, MD5, structure, index load (vitest's include glob does not cover `scripts/`, so the generator test lives here and imports `buildFixture` from the script)
- [ ] `packages/engine/src/bootstrap.test.ts` — `BootstrapOptions` ids/now honoured, unchanged when absent
- [ ] Spikes before seed work: Summary-field acceptance in import mode; AutoNumber `Name` on BigTable__c in import mode; `Is_Overdue__c` formula inputs; tsx `--tsconfig` flag form

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `index.sql` runs unchanged on Postgres 16 (D-09) | FIX-01 | pglite is the CI path; a real Postgres 16 needs Docker | `pnpm db:up`, then `psql $ORGLET_DATABASE_URL -v ON_ERROR_STOP=1 -f examples/acme-archive/index.sql` into an empty schema; expect no errors |
| Fixture README is readable as the Phase 18 contract (D-11) | FIX-01 | Prose quality | Read `examples/acme-archive/README.md`; confirm layout, period story and regenerate command are described |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 90s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
