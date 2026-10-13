---
phase: 9
slug: baseline-generator-parity-ownerid-narrowing
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-10-13
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.2.7 (single root config) |
| **Config file** | `vitest.config.ts` (include covers `packages/*/test/**/*.test.ts`) |
| **Quick run command** | `pnpm vitest run packages/metadata` |
| **Full suite command** | `pnpm lint && pnpm test && pnpm baseline:check` (plus `ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test` and `conformance/run-all.sh` at phase gate) |
| **Estimated runtime** | ~9 seconds |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run packages/metadata` (plus the task's own `<automated>` command)
- **After every plan wave:** Run `pnpm lint && pnpm test && pnpm baseline:check` (baseline:check from wave 3 on)
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 9 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 9-01-01 | 01 | 1 | BASE2-01 | static | `bash -n scripts/sync-sfdocs.sh && grep -q '"scripts/**/*.ts"' tsconfig.test.json` | ❌ W0 (creates) | ⬜ pending |
| 9-01-02 | 01 | 1 | BASE2-01 | unit (offline manifest) | `pnpm vitest run packages/metadata/test/sfdocs-vendor.test.ts` | ❌ W0 (creates) | ⬜ pending |
| 9-01-03 | 01 | 1 | BASE2-01 (D-07) | data check | node check: 35 keyPrefix entries, valid source, ref when not unverified | ❌ W0 (creates) | ⬜ pending |
| 9-02-01 | 02 | 1 | BASE2-03, BASE2-04 | unit | `pnpm vitest run packages/metadata/src/build.test.ts` | ✅ extend | ⬜ pending |
| 9-02-02 | 02 | 1 | SC5 | integration | `pnpm vitest run packages/engine/src/upgrade.test.ts` | ✅ edit | ⬜ pending |
| 9-03-01 | 03 | 2 | BASE2-01, BASE2-03 | static | `pnpm lint && pnpm typecheck:scripts` | ❌ W0 (creates) | ⬜ pending |
| 9-03-02 | 03 | 2 | BASE2-01, MIGR-03 | unit (committed data) | `pnpm vitest run packages/metadata/test/object-reference-snapshot.test.ts` | ❌ W0 (creates) | ⬜ pending |
| 9-04-01 | 04 | 3 | BASE2-01 | unit | `pnpm vitest run packages/metadata/test/gen-baseline-typemap.test.ts` | ❌ W0 (creates) | ⬜ pending |
| 9-04-02 | 04 | 3 | BASE2-01 | static | `pnpm typecheck:scripts && pnpm lint` | ❌ W0 (creates) | ⬜ pending |
| 9-04-03 | 04 | 3 | BASE2-01, BASE2-02 | unit + CI | `pnpm vitest run packages/metadata && pnpm baseline:check` (after commit; CI `baseline-gen-check`) | ❌ W0 (creates) | ⬜ pending |
| 9-05-01 | 05 | 4 | MIGR-03 | unit | `pnpm vitest run packages/metadata/test/baseline-gate.test.ts packages/schema/src/migrate.test.ts` | ❌ W0 (creates) | ⬜ pending |
| 9-05-02 | 05 | 4 | MIGR-03, BASE2-01 | unit | `pnpm vitest run packages/metadata` | ❌ W0 (creates) | ⬜ pending |
| 9-06-01 | 06 | 5 | BASE2-02, BASE2-03 | unit (in memory) | `pnpm vitest run packages/metadata && pnpm typecheck:scripts && pnpm baseline:check` | ✅ extend | ⬜ pending |
| 9-06-02 | 06 | 5 | BASE2-02, BASE2-03 | checkpoint:decision | n/a (Johan reviews `generate.ts --report` numbers) | n/a | ⬜ pending |
| 9-07-01 | 07 | 6 | BASE2-02, MIGR-03, SC5 | full suite | `pnpm baseline:check && pnpm test && pnpm lint` (after commit) | ✅ | ⬜ pending |
| 9-07-02 | 07 | 6 | BASE2-03 (SC3) | unit | `pnpm vitest run packages/metadata/test/documented-fields.test.ts packages/api/src/describe.test.ts packages/cli/src/main.test.ts` | ❌ W0 (creates documented-fields) | ⬜ pending |
| 9-07-03 | 07 | 6 | BASE2-02, BASE2-03 (wording) | doc grep | `grep -q "not a describe key, D-10" .planning/ROADMAP.md && grep -q "not modellable" .planning/REQUIREMENTS.md` | ✅ | ⬜ pending |
| 9-08-01 | 08 | 7 | BASE2-04 | unit | `pnpm baseline:check && pnpm vitest run packages/metadata` | ✅ extend | ⬜ pending |
| 9-08-02 | 08 | 7 | BASE2-04 (SC4) | unit + engine | `pnpm vitest run packages/formula packages/soql packages/engine packages/api packages/schema` | ✅ extend | ⬜ pending |
| 9-09-01 | 09 | 8 | BASE2-04 (D-14, SC4 conformance) | integration + conformance | `pnpm vitest run packages/engine/src/upgrade-owner.test.ts`; audit completeness loop; `conformance/run-all.sh` | ❌ W0 (creates upgrade-owner) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `tsconfig.test.json` include `scripts/**/*.ts` and `tsconfig.scripts.json` + `pnpm typecheck:scripts` CI step (09-01 Task 1) — lint/typecheck of generator code
- [ ] `packages/metadata/test/sfdocs-vendor.test.ts` (09-01 Task 2) — offline sha256 manifest check of the vendored sf-skills copy
- [ ] Committed inputs before any generator test can run on real data: `scripts/gen-baseline/source/sf-skills/` (09-01), `scripts/gen-baseline/source/object-reference/` (09-03)
- [ ] `packages/metadata/test/object-reference-snapshot.test.ts` (09-03)
- [ ] `packages/metadata/test/gen-baseline-typemap.test.ts`, `packages/metadata/test/baseline-generator.test.ts` (09-04)
- [ ] `packages/metadata/test/baseline-gate.ts` + `baseline-gate.test.ts` (09-05)
- [ ] `packages/metadata/test/documented-fields.test.ts` (09-07)
- [ ] `packages/engine/src/upgrade-owner.test.ts` (09-09)
- [ ] Framework install: none (vitest present)

Each test file is created by the same task that first needs it (TDD tasks), so no task's `<automated>` command points at a missing file.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Running the two network snapshot steps (sf-skills sync, PDF extraction) | BASE2-01 | Need network and a local pdftotext; never in CI by design (D-02) | 09-01 Task 2 and 09-03 Task 2 run them once; sf-skills reproducibility is checked once by hand (re-sync + diff) and its integrity offline in CI via the sha256 manifest test; the PDF extraction is reviewed by its committed diff |
| Key-prefix citations are genuine public sources | BASE2-01 (D-07) | Judging a web page or SDK fixture as evidence | Review the 09-01 SUMMARY table (object, prefix, source, ref); default `unverified` is valid |
| Legal acceptance of the facts-only PDF extraction | BASE2-01 | Licence judgement (Research: MEDIUM) | Johan confirms in the PR that only facts are committed (sanity test enforces no prose) |
| Conformance legs (poly-check) when Docker is not available locally | BASE2-04 | Needs Postgres + Python venv | CI `conformance` job; 09-09 SUMMARY records local PASS/FAIL or "not run" |
| Step-B report review (conflicts, skip ratio, forced nullable) | BASE2-02, BASE2-03 | Judgement on locked-decision consequences | 09-06 Task 2 checkpoint:decision; accepted ratio becomes SKIP_RATIO_MAX in 09-07 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [ ] Feedback latency < 9s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
