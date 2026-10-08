---
phase: 3
slug: thin-standard-object-baselines
status: ready
nyquist_compliant: true
wave_0_complete: false
created: 2026-10-08
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.2.7, single root `vitest.config.ts` (`@orglet/*` aliased to `src/index.ts`) |
| **Config file** | `vitest.config.ts`; DB seam `test/db.ts` (`openTestDb`, `usingPglite`) |
| **Quick run command** | `pnpm vitest run packages/metadata packages/cli` plus the single touched DB test file |
| **Full suite command** | `pnpm build && pnpm lint && pnpm test`; then `pnpm db:up && ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test` |
| **Estimated runtime** | ~5 seconds quick, ~90 seconds full on pglite |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run packages/metadata packages/cli` plus the touched test file
- **After every plan wave:** Run `pnpm build && pnpm lint && pnpm test`, then the same suite with `ORGLET_DATABASE_URL` against Docker Postgres
- **Before `/gsd:verify-work`:** Full suite green on both backends; both CI jobs green on the phase branch; M1–M3 outputs recorded in SUMMARY
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

Task IDs are `<plan>-T<n>` from the PLAN.md files (filled in by the planner 2026-10-08). Test IDs (T1..T13, M1..M3) match `03-RESEARCH.md` §"Validation Architecture". Each automated test is written RED-first inside the TDD task that implements it (T3/T12 in 03-01-T2 guard data that 03-01-T1 already produced, so their RED step is 03-01-T1's), which satisfies the Nyquist rule because every task carries an `<automated>` verify.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-T1 | 03-01 | 1 | BASE-01 | unit (T1 fact table for all 14 + retargeted name-field invariant) | `pnpm vitest run packages/metadata/src/build.test.ts -t "thin"` | ✅ file exists, tests added | ⬜ pending |
| 03-01-T1 | 03-01 | 1 | BASE-05 | unit (T2 zero reference-target warnings on baseline/acme; synthetic dangling lookup still warns) | `pnpm vitest run packages/metadata/src/build.test.ts -t "reference"` | ✅ file exists, L157 test rewritten | ⬜ pending |
| 03-01-T2 | 03-01 | 1 | BASE-05 | unit, console spy (T3 `check --project acme` prints no warning) | `pnpm vitest run packages/cli/src/main.test.ts -t "reference"` | ✅ file exists | ⬜ pending |
| 03-01-T2 | 03-01 | 1 | BASE-01 | unit (T12 standard-prefix interplay) | `pnpm vitest run packages/schema/src/prefixes.test.ts -t "standard:"` | ✅ file exists | ⬜ pending |
| 03-01-T2 | 03-01 | 1 | BASE-03 (D-04 wording) | grep | `grep -c 'BusinessHours and BusinessProcess create/update only, no delete' .planning/ROADMAP.md` | ✅ | ⬜ pending |
| 03-02-T1 | 03-02 | 2 | BASE-02 | integration (T4 reference check against thin targets) | `pnpm vitest run packages/engine/src/engine.test.ts -t "thin"` | ✅ file exists | ⬜ pending |
| 03-02-T1 | 03-02 | 2 | BASE-03 | integration (T5 flags per op, T7 upsert/undelete guards, T8 import-mode bypass) | `pnpm vitest run packages/engine/src/engine.test.ts -t "object flags"` | ✅ file exists | ⬜ pending |
| 03-02-T2 | 03-02 | 2 | D-05/D-06 | integration (T9 seed rows exist, linked, idempotent, upgrade, never modified) | `pnpm vitest run packages/engine/src/bootstrap.test.ts` | ❌ created in 03-02-T2 (TDD, RED first) | ⬜ pending |
| 03-02-T3 | 03-02 | 2 | BASE-02 | integration (T13 upgrade adds the 18 FKs; dangling data fails naming table and column, full rollback) | `pnpm vitest run packages/schema/src/migrate.test.ts -t "thin"` | ✅ file exists | ⬜ pending |
| 03-03-T1 | 03-03 | 3 | BASE-04 | integration (T10 describe shape for all 14, jsforce key sets from `conformance/describe-check/contract.json`) | `pnpm vitest run packages/api/src/api.test.ts -t "thin objects"` | ✅ file exists; contract.json/objects.txt created in 03-03-T1 | ⬜ pending |
| 03-03-T1 | 03-03 | 3 | BASE-03 | integration (T11 REST write protection, HTTP 400 + `INVALID_TYPE_FOR_OPERATION`) | `pnpm vitest run packages/api/src/api.test.ts -t "write protection"` | ✅ file exists | ⬜ pending |
| 03-03-T2 | 03-03 | 3 | BASE-03/BASE-04 (docs) | grep on README | `grep -c '^## Thin standard objects' README.md` | ✅ | ⬜ pending |
| 03-04-T1 | 03-04 | 4 | BASE-04 | syntax check of the SDK scripts | `node --check conformance/describe-check/jsforce.mjs && /opt/homebrew/bin/python3.12 -m py_compile conformance/describe-check/sf_describe.py` | ❌ created in 03-04-T1 | ⬜ pending |
| 03-04-T2 | 03-04 | 4 | BASE-02..05 | full suite both backends | `pnpm build && pnpm lint && pnpm test && ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test` | n/a | ⬜ pending |
| 03-04-T2 | 03-04 | 4 | BASE-04 | manual (M1 describe-check via jsforce and simple-salesforce against a live orglet on `smoke_phase3`) | `BASE_URL=http://localhost:8099 node conformance/describe-check/jsforce.mjs` and `conformance/describe-check/.venv/bin/python conformance/describe-check/sf_describe.py` | ❌ created in 03-04-T1 | ⬜ pending |
| 03-04-T2 | 03-04 | 4 | BASE-05 | manual (M2 `check` on Johan's DE retrieve: zero reference-target lines) | `node packages/cli/dist/index.js check --project ~/Development.nosync/devrandom-metadata` | n/a | ⬜ pending |
| 03-04-T2 | 03-04 | 4 | D-05/D-06, BASE-02 | manual (M3 `up` twice on `--org-schema smoke_phase3` against Docker Postgres: seed rows once, FKs present, second run 0 changes) | CLI against Docker Postgres, see 03-04-PLAN.md Task 2 step C | n/a | ⬜ pending |
| 03-04-T3 | 03-04 | 4 | D-05/D-06, BASE-02 | checkpoint:human-verify (Johan's devrandom upgrade) | manual, see 03-04-PLAN.md Task 3 | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/engine/src/bootstrap.test.ts` — T9 (new file; `openTestDb` / `test_<hex>` pattern), created RED-first in 03-02-T2
- [ ] `conformance/describe-check/` — M1 (new directory: `objects.txt` + `contract.json` in 03-03-T1, `jsforce.mjs`, `sf_describe.py`, README in 03-04-T1); Python venv rebuilt for arm64 (`python3.12 -m venv conformance/describe-check/.venv`) and Docker running (dynamic human-action gate) in 03-04-T2
- [ ] Checkpoint facts: resolved in CONTEXT.md D-03a (no further input needed)
- [ ] FK policy for upgraded orgs (research Pitfall 1), implemented in 03-02-T3: decided by the orchestrator — no `NOT VALID`; `migrate()` adds the FK normally and, when existing rows violate it, fails with a clear error naming table and column (wrapped from the Postgres 23503 error) so an `--import`ed org is cleaned up deliberately; T13 asserts the message
- [ ] No framework install; second schemas are built in memory with `buildOrgSchema`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Both SDKs describe all 14 objects without error | BASE-04 | Needs a live server and the real SDKs | Start orglet on an isolated org schema; run `conformance/describe-check` for jsforce and simple-salesforce; exit 0; paste output into SUMMARY |
| Zero `UNSUPPORTED:reference-target` on Johan's DE retrieve | BASE-05 | Level 1 data, local only | `pnpm build && node packages/cli/dist/index.js check --project ~/Development.nosync/devrandom-metadata`; only the one `UNSUPPORTED:field-type` (Summary, phase 5) remains |
| Seed rows appear once, then silence; devrandom upgrade | D-05/D-06 | Real pre-existing org | `up` twice on `--org-schema smoke_phase3`; then Johan runs `up` on devrandom and confirms one new BusinessHours and one UserLicense row, Profile linked, second start silent |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-10-08 (plan check iteration 1: 0 blockers, 1 wording warning fixed by the orchestrator)
