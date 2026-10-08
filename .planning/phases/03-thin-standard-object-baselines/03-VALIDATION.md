---
phase: 3
slug: thin-standard-object-baselines
status: draft
nyquist_compliant: false
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

Task IDs are filled in by the planner. Test IDs (T1..T13, M1..M3) match `03-RESEARCH.md` §"Validation Architecture".

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | BASE-01 | unit (T1 fact table for all 14) | `pnpm vitest run packages/metadata/src/build.test.ts -t "thin"` | ✅ file exists | ⬜ pending |
| TBD | TBD | TBD | BASE-01 | unit + integration (T12 standard-prefix interplay) | `pnpm vitest run packages/schema/src/prefixes.test.ts -t "standard"` | ✅ file exists | ⬜ pending |
| TBD | TBD | TBD | BASE-02 | integration (T4 reference check against thin targets) | `pnpm vitest run packages/engine/src/engine.test.ts -t "thin"` | ✅ file exists | ⬜ pending |
| TBD | TBD | TBD | BASE-02 | integration (T13 upgrade adds FKs; dangling-data error is clear) | `pnpm vitest run packages/schema/src/migrate.test.ts -t "thin"` | ✅ file exists | ⬜ pending |
| TBD | TBD | TBD | BASE-03 | integration (T5 flags per op, T7 upsert/undelete guards, T8 import-mode bypass) | `pnpm vitest run packages/engine/src/engine.test.ts -t "object flags\|upsert\|import mode"` | ✅ file exists | ⬜ pending |
| TBD | TBD | TBD | BASE-03 | integration (T11 REST write protection, HTTP 400 + `INVALID_TYPE_FOR_OPERATION`) | `pnpm vitest run packages/api/src/api.test.ts -t "write protection"` | ✅ file exists | ⬜ pending |
| TBD | TBD | TBD | D-05/D-06 | integration (T9 seed rows exist, linked, idempotent, upgrade) | `pnpm vitest run packages/engine/src/bootstrap.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | BASE-04 | integration (T10 describe shape for all 14, SDK key sets) | `pnpm vitest run packages/api/src/api.test.ts -t "thin objects"` | ✅ file exists | ⬜ pending |
| TBD | TBD | TBD | BASE-04 | manual (M1 describe-check via jsforce and simple-salesforce against a live orglet) | `node conformance/describe-check/jsforce.mjs` and `python conformance/describe-check/sf_describe.py` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | BASE-05 | unit (T2 zero reference-target warnings on baseline/acme; synthetic dangling lookup still warns) | `pnpm vitest run packages/metadata/src/build.test.ts -t "reference"` | ✅ file exists | ⬜ pending |
| TBD | TBD | TBD | BASE-05 | unit (T3 `check --project acme` prints no reference-target line) | `pnpm vitest run packages/cli/src/main.test.ts` | ✅ file exists | ⬜ pending |
| TBD | TBD | TBD | BASE-05 | manual (M2 `check` on Johan's DE retrieve: zero reference-target lines) | `node packages/cli/dist/index.js check --project ~/Development.nosync/devrandom-metadata` | n/a | ⬜ pending |
| TBD | TBD | TBD | D-05/D-06 | manual (M3 `up` twice on an isolated schema: seed rows once, then silence; devrandom human checkpoint) | CLI against Docker Postgres | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/engine/src/bootstrap.test.ts` — T9 (new file; `openTestDb` / `test_<hex>` pattern)
- [ ] `conformance/describe-check/` — M1 (new directory: `objects.txt`, `jsforce.mjs`, `sf_describe.py`, README); Python venv must be rebuilt for arm64 (`python3.12 -m venv`), container runtime must be running for the live server
- [ ] Checkpoint facts: resolved in CONTEXT.md D-03a (no further input needed)
- [ ] FK policy for upgraded orgs (research Pitfall 1): decided by the orchestrator — no `NOT VALID`; `migrate()` adds the FK normally and, when existing rows violate it, fails with a clear error naming table and column (wrapped from the Postgres 23503 error) so an `--import`ed org is cleaned up deliberately; T13 asserts the message
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

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
