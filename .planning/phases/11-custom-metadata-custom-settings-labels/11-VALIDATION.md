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
| 11-01-T1 | 11-01 | 1 | CMDT-01..04, CSET-01, CSET-02 (fixture + seed scaffold) | fixture lint + scaffold | `xmllint --noout` on fixture XML && `pnpm vitest run packages/engine/src/seed.test.ts` && `pnpm lint` | ❌ W0 creates `conformance/cmdt-check/project`, `seed.test.ts` | ⬜ pending |
| 11-01-T2 | 11-01 | 1 | CMDT-04, CSET-01 (SDK legs) | syntax | `node --check conformance/cmdt-check/jsforce.mjs && python3 -m py_compile conformance/cmdt-check/sf_cmdt.py` | ❌ W0 creates both | ⬜ pending |
| 11-02-T1 | 11-02 | 1 | CSET-02, CMDT-03 (contracts) | unit | `pnpm vitest run packages/metadata/src/schema.test.ts && pnpm build` | ❌ new `schema.test.ts` | ⬜ pending |
| 11-02-T2 | 11-02 | 1 | CMDT-02, CMDT-03, CSET-01, CSET-02 | unit | `pnpm vitest run packages/metadata/src/sfdx.test.ts` | ✅ extend | ⬜ pending |
| 11-03-T1 | 11-03 | 2 | CMDT-01, CMDT-03 | unit | `pnpm vitest run packages/metadata/src/build.test.ts` | ✅ extend | ⬜ pending |
| 11-03-T2 | 11-03 | 2 | CSET-01, CSET-02 | unit | `pnpm vitest run packages/metadata/src/build.test.ts packages/engine/src/upgrade.test.ts` | ✅ extend | ⬜ pending |
| 11-04-T1 | 11-04 | 2 | CMDT-02 (Ids), CSET-01 (unique index) | unit | `pnpm vitest run packages/schema/src/ids.test.ts packages/schema/src/ddl.test.ts` | ✅ extend + ❌ new `ddl.test.ts` | ⬜ pending |
| 11-04-T2 | 11-04 | 2 | CMDT-01 (m pool) | unit/integration | `pnpm vitest run packages/schema/src/prefixes.test.ts` | ✅ extend | ⬜ pending |
| 11-05-T1 | 11-05 | 3 | CMDT-04 (guard: isdeleted) | unit + integration | `pnpm vitest run packages/soql/src/compile.test.ts packages/engine/src/soft-delete.test.ts` | ✅ extend + ❌ new `soft-delete.test.ts` | ⬜ pending |
| 11-05-T2 | 11-05 | 3 | CMDT-03 | unit | `pnpm vitest run packages/soql/src/compile.test.ts` | ✅ extend | ⬜ pending |
| 11-06-T1 | 11-06 | 3 | CMDT-02, CMDT-03 (plan) | unit (no DB) | `pnpm vitest run packages/engine/src/seed.test.ts -t planCustomMetadataSeed` | ✅ from W0 | ⬜ pending |
| 11-06-T2 | 11-06 | 3 | CMDT-02 (sync) | integration (pglite) | `pnpm vitest run packages/engine/src/seed.test.ts` | ✅ from W0 | ⬜ pending |
| 11-07-T1 | 11-07 | 4 | CMDT-01, CMDT-04, CSET-01 | integration (Fastify inject) | `pnpm vitest run packages/api/src/custom-metadata.test.ts packages/api/src/api.test.ts` | ❌ new `custom-metadata.test.ts` | ⬜ pending |
| 11-07-T2 | 11-07 | 4 | CMDT-04 (bulk, routes, query) | integration (Fastify inject) | `pnpm vitest run packages/api` | ✅ extend | ⬜ pending |
| 11-08-T1 | 11-08 | 4 | CSET-01, CSET-02, CMDT-02 (CLI) | unit | `pnpm vitest run packages/cli/src/main.test.ts` | ✅ extend | ⬜ pending |
| 11-08-T2 | 11-08 | 4 | (guard) upgrade contract, setting upgrade | integration | `pnpm vitest run packages/engine/src/upgrade.test.ts packages/schema/src/migrate.test.ts` | ✅ extend | ⬜ pending |
| 11-09-T1 | 11-09 | 5 | CMDT-04, CSET-01 (harness) | syntax | `bash -n conformance/run-all.sh` | ✅ extend | ⬜ pending |
| 11-09-T2 | 11-09 | 5 | CMDT-04, CSET-01 (SDKs, phase gate) | conformance (jsforce, simple-salesforce) | `pnpm build && pnpm test && pnpm lint && conformance/run-all.sh` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Filled by the planner on 2026-10-19. Test files differ from the draft where a dedicated file is cleaner: `packages/engine/src/soft-delete.test.ts` replaces the query.test.ts row, `packages/api/src/custom-metadata.test.ts` replaces the api.test.ts/bulk.test.ts block, `packages/metadata/src/schema.test.ts` and `packages/schema/src/ddl.test.ts` are new.*

---

## Wave 0 Requirements

- [ ] `packages/engine/src/seed.test.ts` — covers CMDT-02, CMDT-03 (new)
- [ ] `conformance/cmdt-check/project/force-app/main/default/` — dedicated SFDX fixture (`__mdt` types with Text/Number/Checkbox/Picklist/MetadataRelationship fields, mdt-to-mdt relationship incl. a cycle, Hierarchy and List settings, `customMetadata/` records covering `"007"`, `xsi:nil`, dangling target, unknown field, unknown type, `labels/CustomLabels.labels-meta.xml`); neutral names only
- [ ] `conformance/cmdt-check/jsforce.mjs` and `conformance/cmdt-check/sf_cmdt.py` — covers CMDT-04 through the SDKs (new), created in Wave 0 (11-01), wired into `conformance/run-all.sh` on a second server in 11-09
- [ ] Temp-SFDX-project helper: reuse the existing `project({...})` pattern in sfdx.test.ts/main.test.ts; no shared helper needed (fixture tests read `conformance/cmdt-check/project` directly)
- [ ] Framework install: none (vitest, pglite already present)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| — | — | — | — |

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [ ] Feedback latency < 30s (holds per task and per wave; 11-09 Task 2 is the declared phase gate, full build + test + lint + conformance, and is exempt)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
