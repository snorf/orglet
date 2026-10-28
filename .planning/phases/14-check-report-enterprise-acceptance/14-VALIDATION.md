---
phase: 14
slug: check-report-enterprise-acceptance
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-10-28
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.2.7 (single root `vitest.config.ts`) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm vitest run packages/cli/src` |
| **Full suite command** | `pnpm build && pnpm lint && pnpm test` (pglite, then once with `ORGLET_DATABASE_URL` set), then `bash conformance/run-all.sh` for acme and `PROJECT=examples/enterprise ... bash conformance/run-all.sh` on fresh schemas |
| **Estimated runtime** | ~20 s quick · ~3-5 min full suite · ~10 min conformance |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run packages/cli/src`
- **After every plan wave:** Run `pnpm build && pnpm lint && pnpm test`
- **Before `/gsd:verify-work`:** Full suite green (pglite and Postgres), `run-all.sh` green for acme and enterprise, then the human checkpoint for the author's local retrieves
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 14-01-01 | 01 | 1 | CHECK-01 | unit | `pnpm vitest run packages/metadata/src/sfdx.test.ts packages/metadata/src/diagnostics.test.ts packages/metadata/src/build.test.ts` | ✅ (extend) | ⬜ pending |
| 14-01-02 | 01 | 1 | CHECK-01 | unit + project-level (TDD) | `pnpm vitest run packages/cli/src/report.test.ts` | ❌ W0 (created RED first) | ⬜ pending |
| 14-01-03 | 01 | 1 | CHECK-01, CHECK-02 | unit (TDD, exact strings) | `pnpm vitest run packages/cli/src/report.test.ts && pnpm lint && pnpm build` | ❌ W0 | ⬜ pending |
| 14-02-01 | 02 | 1 | ACC2-01 | integration (coverage test RED) + CLI | `pnpm build && node packages/cli/dist/index.js check --strict --project examples/enterprise` | ❌ W0 (`enterprise.test.ts`) | ⬜ pending |
| 14-02-02 | 02 | 1 | ACC2-01 | integration | `pnpm vitest run packages/cli/src/enterprise.test.ts` | ❌ W0 | ⬜ pending |
| 14-03-01 | 03 | 1 | ACC2-03 | generator + unit + CLI | `pnpm baseline:gen && pnpm baseline:check && pnpm typecheck:scripts && pnpm vitest run packages/metadata && pnpm vitest run packages/cli/src/main.test.ts -t "SyncedQuote"` | ✅ (extend) | ⬜ pending |
| 14-03-02 | 03 | 1 | ACC2-03 | checkpoint:human-action (DE describe facts) | n/a (input only; SUMMARY lists class-C fields) | n/a | ⬜ pending |
| 14-03-03 | 03 | 1 | ACC2-03 | generator + scoped suite | `pnpm baseline:check && pnpm vitest run packages/metadata && pnpm vitest run packages/cli/src/main.test.ts -t "SyncedQuote"` (+ `pnpm vitest run packages/metadata` once with `ORGLET_DATABASE_URL` on 5433); full `pnpm test` gated in 14-04-02 / 14-07-01 | ✅ | ⬜ pending |
| 14-04-01 | 04 | 2 | CHECK-01, CHECK-02 | CLI (byte-identity, summary, json, strict matrix) | `pnpm vitest run packages/cli/src/main.test.ts packages/cli/src/report.test.ts` | ✅ (extend) | ⬜ pending |
| 14-04-02 | 04 | 2 | CHECK-01 | file snapshot | `pnpm vitest run packages/cli/src/main.test.ts -t "stable" && pnpm build && pnpm lint && pnpm test` | ❌ W0 (`__snapshots__/check-acme*.txt`) | ⬜ pending |
| 14-05-01 | 05 | 2 | ACC2-01, ACC2-02 | conformance (live) | `bash -n conformance/run-all.sh && node --check examples/enterprise/seed.mjs`; live: `PROJECT=examples/enterprise ORG_SCHEMA=p14_ent PORT=8096 PYTHON=conformance/describe-check/.venv/bin/python conformance/run-all.sh` gated on enterprise-seed, describe-check 38/38, both SDK suites, cmdt-check, plus `node packages/cli/dist/index.js check --strict --project examples/enterprise`; poly/rollup 6/6 gated in 14-07-01 | ✅ (extend) | ⬜ pending |
| 14-05-02 | 05 | 2 | ACC2-01 | CI config | `grep -q "check --strict --project examples/enterprise" .github/workflows/ci.yml && grep -q "matrix.project" .github/workflows/ci.yml` | ✅ (extend) | ⬜ pending |
| 14-06-01 | 06 | 2 | ACC2-02 | conformance (both SDKs) | `node --check conformance/poly-check/jsforce.mjs && python3 -m py_compile conformance/poly-check/sf_poly.py`; live 5/5 acme, 6/6 enterprise | ✅ (extend) | ⬜ pending |
| 14-06-02 | 06 | 2 | ACC2-02 | conformance (both SDKs) | `node --check conformance/rollup-check/jsforce.mjs && python3 -m py_compile conformance/rollup-check/sf_rollup.py`; live 5/5 acme, 6/6 enterprise | ✅ (extend) | ⬜ pending |
| 14-07-01 | 07 | 3 | ACC2-01, ACC2-02 | full gate + conformance | `pnpm test` (pglite + Postgres 16) and `run-all.sh` for acme and enterprise on fresh schemas | ✅ | ⬜ pending |
| 14-07-02 | 07 | 3 | ACC2-03 | checkpoint:human-verify | manual (author's local retrieves; `check --strict` / `check --summary`) | n/a | ⬜ pending |
| 14-07-03 | 07 | 3 | ACC2-03, CHECK-01, CHECK-02 | docs + ticks | `grep -q "## Large real-org retrieve" conformance/README.md` | ✅ | ⬜ pending |

Sampling continuity: no three consecutive tasks lack an automated command (the two checkpoints, 14-03-02 and 14-07-02, are each surrounded by automated tasks).

*Filled in detail by the planner; see RESEARCH.md "Validation Architecture" for the requirement-to-test map.*

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/cli/src/report.test.ts` — grouping, counts, ordering, redaction (CHECK-01/02)
- [ ] `packages/cli/src/__snapshots__/check-acme.txt` and `check-acme-summary.txt` — committed file snapshots (CHECK-01, CHECK-02), created in 14-04-02
- [ ] failing-first tests for root-cause cases (skipped field / rollup / cycle / standard Id field / skipped object) in `report.test.ts`, created RED in 14-01-02 (object rule follows the 14-01-01 probe)
- [ ] `examples/enterprise/` + `packages/cli/src/enterprise.test.ts` (ACC2-01)
- [ ] no framework install needed

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Author's Developer Edition retrieve loads with `check --strict` exit 0 | ACC2-03 | Retrieve is local-only, never in repo or CI | `node packages/cli/dist/index.js check --strict --project <de-retrieve>`; record exit code |
| Author's large real-org retrieve reports zero warnings for everything it references | ACC2-03 | Local-only data; README records counts per area, never names | `node packages/cli/dist/index.js check --summary --project <large-retrieve>`; copy per-area counts into `conformance/README.md`; Johan confirms privately that remaining standard-field warnings are inside the accepted exclusions |
| DE describe facts for standard fields in no pinned source | ACC2-03 | Author's own DE, not reachable by Claude | `sf sobject describe --sobject <Object> --json` per field (14-03-02) |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [ ] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
