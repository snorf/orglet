---
phase: 5
slug: roll-up-summary-fields
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-10-09
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.2.7 (single root config, `@orglet/*` aliased to `src`) |
| **Config file** | `vitest.config.ts` (root) |
| **Quick run command** | `pnpm vitest run packages/metadata/src packages/schema/src/rollup.test.ts packages/engine/src/rollups.test.ts` |
| **Full suite command** | `pnpm build && pnpm lint && pnpm test` (pglite), plus `ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test` at the phase gate |
| **Estimated runtime** | ~4 seconds for a single unit file; ~30 seconds quick run (pglite per file); full suite ~1-2 minutes |

All commands need Node 22 (`nvm use 22`). Embedded pglite per test file by default (no Docker); `ORGLET_DATABASE_URL` switches to real Postgres. CI runs both.

---

## Sampling Rate

- **After every task commit:** Run the task's `<automated>` command (one or two test files, under 30 s)
- **After every plan wave:** Run `pnpm test && pnpm lint`
- **Before `/gsd:verify-work`:** Full suite must be green on pglite and on real Postgres; SDK runs recorded verbatim in SUMMARY
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

See `05-RESEARCH.md` §"Validation Architecture" → "Phase Requirements to Test Map" for the requirement-level map (ROLL-01..ROLL-09, D-04, D-09, D-10, SDK). The planner fills the task-level rows below from the plans it writes.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 05-XX-NN | XX | N | ROLL-XX | unit / integration | `pnpm vitest run <file>` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `packages/metadata/src/rollup.ts` resolution pass with a file-less test seam (`buildOrgSchema(baseline, { ...project, objects })`, phase 4 D-13 pattern)
- [ ] `packages/schema/src/rollup.test.ts` — pure SQL-builder tests (operators, types, blank/multi-token/quoted values, `valueField`, LIKE escaping, param order)
- [ ] `packages/engine/src/rollups.test.ts` — integration tests over an `examples/acme` roll-up fixture (grep the ten acme-consuming tests for count/shape assertions before extending acme; otherwise a separate `examples/acme-rollups` project)
- [ ] A parent validation rule fixture referencing a roll-up field, for the ROLL-05 blocking test
- [ ] Replace the "skips Summary" assertion in `packages/metadata/src/sfdx.test.ts`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Johan's Developer Edition retrieve loads with zero `UNSUPPORTED:field-type` for `Summary` | ROLL-09 | The retrieve is Level 1 but local-only, never in repo or CI | `orglet check --project ~/Development.nosync/devrandom-metadata` on Johan's machine; expect no `warning: UNSUPPORTED:field-type ... Summary` line. In-repo proxy: a DE-shaped fixture (MAX over `CreatedDate`, picklist `equals`, master-detail) loads with zero warnings |
| jsforce + simple-salesforce see `calculated: true`, `createable: false`, `updateable: false` on a roll-up and get `INVALID_FIELD_FOR_INSERT_UPDATE` on a write | ROLL-07 | Needs a live server and the external SDKs | Extend `conformance/describe-check` or add a `conformance/rollup-check` pair, as in phase 4's `poly-check`; run in the last wave against a throwaway org schema |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
