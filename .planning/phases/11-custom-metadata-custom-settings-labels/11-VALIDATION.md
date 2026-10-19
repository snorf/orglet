---
phase: 11
slug: custom-metadata-custom-settings-labels
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-10-19
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.2.7 (single root config, source aliases to `packages/*/src/index.ts`) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm vitest run packages/metadata packages/schema/src/prefixes.test.ts packages/engine/src/seed.test.ts` |
| **Full suite command** | `pnpm build && pnpm test && pnpm lint` (conformance: `bash conformance/run-all.sh`, needs built `dist`) |
| **Estimated runtime** | ~30 seconds per touched-package run on pglite; full suite a few minutes |

DB: pglite per test file by default; Postgres when `ORGLET_DATABASE_URL` is set (`test/db.ts`).

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run <the package's touched test files>` plus `pnpm lint`
- **After every plan wave:** Run `pnpm build && pnpm test && pnpm lint`
- **Before `/gsd:verify-work`:** Full suite green and `bash conformance/run-all.sh` green on a fresh schema
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | CMDT-01 | unit | `pnpm vitest run packages/metadata/src/build.test.ts` | ✅ extend | ⬜ pending |
| TBD | TBD | TBD | CMDT-01 | unit/integration | `pnpm vitest run packages/schema/src/prefixes.test.ts` | ✅ extend | ⬜ pending |
| TBD | TBD | TBD | CMDT-02 | unit | `pnpm vitest run packages/metadata/src/sfdx.test.ts` | ✅ extend | ⬜ pending |
| TBD | TBD | TBD | CMDT-02 | unit (no DB) + integration (pglite) | `pnpm vitest run packages/engine/src/seed.test.ts` | ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CMDT-03 | integration | `pnpm vitest run packages/soql/src/compile.test.ts packages/engine/src/seed.test.ts` | ✅ extend + ❌ W0 | ⬜ pending |
| TBD | TBD | TBD | CMDT-04 | integration (Fastify inject) | `pnpm vitest run packages/api/src/api.test.ts packages/api/src/bulk.test.ts` | ✅ extend | ⬜ pending |
| TBD | TBD | TBD | CMDT-04 | conformance (jsforce, simple-salesforce) | `bash conformance/run-all.sh` | ❌ W0 (`conformance/cmdt-check`) | ⬜ pending |
| TBD | TBD | TBD | CSET-01 | unit + integration | `pnpm vitest run packages/metadata/src/build.test.ts packages/engine/src/engine.test.ts` | ✅ extend | ⬜ pending |
| TBD | TBD | TBD | CSET-01 | unit | `pnpm vitest run packages/cli/src/main.test.ts` | ✅ extend | ⬜ pending |
| TBD | TBD | TBD | CSET-02 | unit | `pnpm vitest run packages/metadata/src/sfdx.test.ts packages/metadata/src/build.test.ts` | ✅ extend | ⬜ pending |
| TBD | TBD | TBD | (guard) | integration | `pnpm vitest run packages/engine/src/upgrade.test.ts` | ✅ existing, must stay green | ⬜ pending |
| TBD | TBD | TBD | (guard) | integration | `pnpm vitest run packages/soql/src/compile.test.ts packages/engine/src/query.test.ts` | ✅ extend | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*The planner fills Task ID / Plan / Wave once PLAN.md files exist.*

---

## Wave 0 Requirements

- [ ] `packages/engine/src/seed.test.ts` — covers CMDT-02, CMDT-03 (new)
- [ ] `conformance/cmdt-check/project/force-app/main/default/` — dedicated SFDX fixture (`__mdt` types with Text/Number/Checkbox/Picklist/MetadataRelationship fields, mdt-to-mdt relationship incl. a cycle, Hierarchy and List settings, `customMetadata/` records covering `"007"`, `xsi:nil`, dangling target, unknown field, unknown type, `labels/CustomLabels.labels-meta.xml`); neutral names only
- [ ] `conformance/cmdt-check/jsforce.mjs` and `conformance/cmdt-check/sf_cmdt.py` — covers CMDT-04 through the SDKs (new), wired into `conformance/run-all.sh` on a second server
- [ ] Temp-SFDX-project helper: reuse the `project({...})` pattern from `packages/cli/src/main.test.ts`, or add `test/project.ts` if a third file needs it
- [ ] Framework install: none (vitest, pglite already present)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| — | — | — | — |

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
