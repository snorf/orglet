---
phase: 2
slug: custom-object-key-prefix-persistence
status: ready
nyquist_compliant: true
wave_0_complete: false
created: 2026-10-01
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.2.7, single root `vitest.config.ts` (`@orglet/*` aliased to `src/index.ts`) |
| **Config file** | `vitest.config.ts`; DB seam `test/db.ts` (pglite per file, or `ORGLET_DATABASE_URL`) |
| **Quick run command** | `pnpm vitest run packages/schema/src/prefixes.test.ts packages/cli/src/main.test.ts` |
| **Full suite command** | `pnpm build && pnpm lint && pnpm test`; then `pnpm db:up && ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test` |
| **Estimated runtime** | ~20 seconds quick, ~90 seconds full on pglite |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run packages/schema/src/prefixes.test.ts packages/cli/src/main.test.ts` (plus `pnpm lint` after CLI edits)
- **After every plan wave:** Run `pnpm build && pnpm lint && pnpm test`, then the same suite with `ORGLET_DATABASE_URL` against Docker Postgres
- **Before `/gsd:verify-work`:** Full suite must be green on both backends; both CI jobs (`test-pglite`, `test-postgres`) green on the phase branch
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

Task IDs are `<plan>-T<n>` from the PLAN.md files (filled in by the planner 2026-10-01). Test IDs (T1..T12) match `02-RESEARCH.md` §"Validation Architecture". There is no separate Wave 0: each test is written RED-first inside the same TDD task that implements it (plan 02-01 for the schema module, 02-02 for the CLI), which satisfies the Nyquist rule because every task carries an `<automated>` verify.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 02-01-T2 | 02-01 | 1 | PREFIX-01 | integration (T1 two-build drift, the gate) | `pnpm vitest run packages/schema/src/prefixes.test.ts -t "two-build"` | ❌ written in 02-01-T1/T2 (TDD, RED first) | ⬜ pending |
| 02-01-T2 | 02-01 | 1 | PREFIX-01 | integration (T2 removal, T3 rename) | `pnpm vitest run packages/schema/src/prefixes.test.ts -t "removal|rename"` | ❌ written in 02-01-T2 | ⬜ pending |
| 02-01-T2 | 02-01 | 1 | PREFIX-02 | integration (T4 existing records, T5 newcomer sorts first) | `pnpm vitest run packages/schema/src/prefixes.test.ts -t "existing records|sorts before"` | ❌ written in 02-01-T2 | ⬜ pending |
| 02-01-T1, 02-01-T2 | 02-01 | 1 | PREFIX-03 | unit (T6 planner collisions, 02-01-T1), integration (T7 nothing written, 02-01-T2) | `pnpm vitest run packages/schema/src/prefixes.test.ts -t "planKeyPrefixes|nothing written"` | ❌ written in 02-01-T1/T2 | ⬜ pending |
| 02-01-T1 | 02-01 | 1 | PREFIX-03 | unit (T8 mapping parser) | `pnpm vitest run packages/schema/src/prefixes.test.ts -t "parseKeyPrefixMapping"` | ❌ written in 02-01-T1 | ⬜ pending |
| 02-02-T1 | 02-02 | 2 | PREFIX-04 | unit, console spy (T9 `check` output + USAGE) | `pnpm vitest run packages/cli/src/main.test.ts` | ❌ written in 02-02-T1 | ⬜ pending |
| 02-01-T2 | 02-01 | 1 | PREFIX-04 | integration (T10 reset keeps rows, `dropKeyPrefixes` per org) | `pnpm vitest run packages/schema/src/prefixes.test.ts -t "drop"` | ❌ written in 02-01-T2 | ⬜ pending |
| 02-03-T1 | 02-03 | 3 | PREFIX-01 | integration (T11 describe + REST Id show persisted prefix) | `pnpm vitest run packages/api/src/api.test.ts -t "describe"` | ✅ file exists, assertion added | ⬜ pending |
| 02-01-T2 | 02-01 | 1 | D-05 | integration, Postgres-only (T12 concurrency, `skip(usingPglite)`) | `ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm vitest run packages/schema/src/prefixes.test.ts -t "concurrent"` | ❌ written in 02-01-T2 | ⬜ pending |
| 02-02-T2 | 02-02 | 2 | PREFIX-04 (docs) | unit (retitled build.test) + grep on README | `pnpm vitest run packages/metadata/src/build.test.ts && grep -c '^## Custom-object key prefixes' README.md` | ✅ file exists | ⬜ pending |
| 02-03-T2 | 02-03 | 3 | PREFIX-01..04 | full suite both backends + CLI smoke (automated shell sequence, `--org-schema smoke_phase2`) | `pnpm build && pnpm lint && pnpm test && ORGLET_DATABASE_URL=... pnpm test` | n/a | ⬜ pending |
| 02-03-T3 | 02-03 | 3 | PREFIX-02 | checkpoint:human-verify (Johan's devrandom org) | manual, see 02-03-PLAN.md Task 3 | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/schema/src/prefixes.test.ts` — T1–T8, T10 (T12 optional) for PREFIX-01..04; DB-backed blocks follow the `openTestDb` / `test_<hex>` / `afterAll` pattern and call `dropKeyPrefixes` in `afterAll`
- [ ] `packages/cli/src/main.test.ts` — T9 for PREFIX-04; first test in `packages/cli`, covered by the existing vitest glob and `tsconfig.test.json`
- [ ] No framework install, no new fixtures on disk: the second schema is built in memory with `buildOrgSchema(baseline, { ...project, objects: [...] })`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `orglet up` logs assignments once, then is silent | PREFIX-01, D-16 | End-to-end CLI against Docker Postgres with a real server start | `pnpm db:up`; `node packages/cli/dist/index.js up --project examples/acme` twice; first run prints 4 `assigned key prefix` lines, second prints none |
| Johan's devrandom org keeps its old `a00`/`a01` | PREFIX-02 | Real pre-existing org database, Level 1 data, local only | `orglet up --project ~/Development.nosync/devrandom-metadata --org-schema devrandom`; expect two `from existing records` lines and unchanged describe prefixes |
| `orglet reset` then `reset --drop-prefixes` | PREFIX-04 | CLI flag wiring end to end | After the acme runs: `reset` then `up` prints no assignments; `reset --drop-prefixes` then `up` prints 4 again |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (none: every test is written RED-first inside its TDD task)
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-10-01
