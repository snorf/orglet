---
phase: 14
slug: check-report-enterprise-acceptance
status: draft
nyquist_compliant: false
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
| 14-01-* | 01 | 1 | CHECK-01 | unit | `pnpm vitest run packages/cli/src/report.test.ts` | ❌ W0 | ⬜ pending |
| 14-02-* | 02 | 1 | ACC2-01 | integration | `pnpm vitest run packages/cli/src/enterprise.test.ts` | ❌ W0 | ⬜ pending |
| 14-03-* | 03 | 2 | CHECK-01, CHECK-02 | snapshot + CLI | `pnpm vitest run packages/cli/src/main.test.ts` | ✅ (extend) | ⬜ pending |
| 14-04-* | 04 | 2 | ACC2-01, ACC2-02 | conformance | `PROJECT=examples/enterprise ORG_SCHEMA=ent_run PORT=8096 bash conformance/run-all.sh` | ✅ (extend) | ⬜ pending |
| 14-05-* | 05 | 3 | ACC2-02, ACC2-03 | manual + conformance | `node packages/cli/dist/index.js check --strict --project <retrieve>` | n/a | ⬜ pending |

*Filled in detail by the planner; see RESEARCH.md "Validation Architecture" for the requirement-to-test map.*

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/cli/src/report.test.ts` — grouping, counts, ordering, redaction (CHECK-01/02)
- [ ] `packages/cli/src/__snapshots__/check-acme.txt` — committed file snapshot (CHECK-01)
- [ ] failing-first tests for root-cause cases (skipped field / rollup / object) reusing the `project()` helpers from `main.test.ts`
- [ ] `examples/enterprise/` + `packages/cli/src/enterprise.test.ts` (ACC2-01)
- [ ] no framework install needed

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Author's Developer Edition retrieve loads with `check --strict` exit 0 | ACC2-03 | Retrieve is local-only, never in repo or CI | `node packages/cli/dist/index.js check --strict --project <de-retrieve>`; record exit code |
| Author's large real-org retrieve reports zero warnings for everything it references | ACC2-03 | Local-only data; README records counts per area, never names | `node packages/cli/dist/index.js check --summary --project <large-retrieve>`; copy per-area counts into `conformance/README.md` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
