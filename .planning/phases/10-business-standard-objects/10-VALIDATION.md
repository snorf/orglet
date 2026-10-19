---
phase: 10
slug: business-standard-objects
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-10-14
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.2.7 (`vitest run`), single root config; pglite per file by default, Postgres 16 with `ORGLET_DATABASE_URL` (`maxWorkers: 3`) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm vitest run packages/metadata packages/cli` (no database) |
| **Full suite command** | `pnpm lint && pnpm typecheck && pnpm typecheck:scripts && pnpm baseline:check && pnpm test` |
| **Estimated runtime** | quick ~10 s; full pglite suite ~2-3 min; Postgres leg and `conformance/run-all.sh` several minutes (phase gate only) |

---

## Sampling Rate

- **After every task commit:** the task's `<automated>` command (touched package plus `pnpm baseline:check` when generator inputs changed)
- **After every plan wave:** `pnpm lint && pnpm typecheck && pnpm typecheck:scripts && pnpm test` (pglite)
- **Before `/gsd:verify-work`:** full suite on pglite and on Postgres 16 (`ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test`) and `conformance/run-all.sh` green (Plan 10-06)
- **Max feedback latency:** quick command ~10 s

Known red window (exact): from Plan 10-04 Task 1's commit to Task 2's commit, `pnpm baseline:check`,
`packages/metadata/test/baseline-generator.test.ts`, `packages/metadata/test/baseline-gate.test.ts` and
`packages/metadata/test/documented-fields.test.ts` fail, because objects.json lists 18 objects without overrides entries or
generated files. Task 2 also carries every existing-test update the new data forces (build.test.ts NO_NAME_FIELD and owner
lists, upgrade.test.ts NEW_TABLES, migrate.test.ts if needed), so the full pglite suite is green at Task 2's commit; Task 3
only adds tests. 10-04's SUMMARY records the two commit shas.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | BASE2-06, BASE2-07 | unit | `pnpm vitest run packages/metadata/test/gen-baseline-typemap.test.ts packages/metadata/test/object-reference-snapshot.test.ts && pnpm typecheck:scripts && pnpm baseline:check` | ✅ extend (calls.ts ❌ W0 new) | ⬜ pending |
| 10-01-02 | 01 | 1 | BASE2-06, BASE2-07 | unit | `pnpm vitest run packages/metadata && pnpm typecheck:scripts && pnpm baseline:check` | ✅ extend baseline-gate / typemap tests | ⬜ pending |
| 10-02-01 | 02 | 1 | BASE2-08 | unit | `pnpm vitest run packages/metadata packages/schema/src/migrate.test.ts packages/engine/src/formulas.test.ts` | ✅ extend build.test.ts | ⬜ pending |
| 10-02-02 | 02 | 1 | BASE2-08 | unit | `pnpm vitest run packages/cli` | ✅ extend main.test.ts | ⬜ pending |
| 10-03-01 | 03 | 1 | BASE2-06 | checkpoint | grep of the answer lines in `10-03-SUMMARY.md` (see plan) | n/a | ⬜ pending |
| 10-04-01 | 04 | 2 | BASE2-06 | unit + manual pinned network step | `pnpm vitest run packages/metadata/test/object-reference-snapshot.test.ts packages/metadata/test/sfdocs-vendor.test.ts` + pin checks | ✅ extend | ⬜ pending |
| 10-04-02 | 04 | 2 | BASE2-06, BASE2-07 | unit / drift gate / integration | `pnpm baseline:check && pnpm test` | ✅ extend baseline-generator / documented-fields / build.test lists / upgrade.test | ⬜ pending |
| 10-04-03 | 04 | 2 | BASE2-06 | unit | `pnpm vitest run packages/metadata && pnpm test` | ✅ extend build.test (BUSINESS table) | ⬜ pending |
| 10-05-01 | 05 | 3 | BASE2-07 | integration | `pnpm vitest run packages/engine/src/engine.test.ts packages/engine/src/query.test.ts` | ✅ extend | ⬜ pending |
| 10-05-02 | 05 | 3 | BASE2-06, BASE2-07 | integration | `pnpm vitest run packages/api` | ✅ extend api.test.ts | ⬜ pending |
| 10-06-01 | 06 | 4 | BASE2-06..08 (SC4) | full suite + conformance | `pnpm test` (pglite + Postgres 16) and `conformance/run-all.sh` | ✅ | ⬜ pending |
| 10-06-02 | 06 | 4 | BASE2-06..08 | docs grep | grep checks in the plan | ✅ | ⬜ pending |
| 10-06-03 | 06 | 4 | SC4 (DE leg) | human-verify | grep of the new DE row in `conformance/README.md` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Requirement -> test map

| Req | Behaviour | Where |
|-----|-----------|-------|
| BASE2-06 | 18 objects load with prefix/source/flags/owner/name field | `build.test.ts` BUSINESS table (10-04-03), `api.test.ts` business describe (10-05-02), describe-check 32 (10-06-01) |
| BASE2-06 | blob / junction / geolocation omissions listed in the generator report; polymorphic subsets exactly 19/10/20 | `baseline-generator.test.ts` (10-04-02), `build.test.ts` "business: blob ..." (10-04-03) |
| BASE2-06 | generated files == regeneration | `pnpm baseline:check` (CI `baseline-gen-check`) |
| BASE2-06 | Supported Calls extraction and vocabulary | `gen-baseline-typemap.test.ts`, `object-reference-snapshot.test.ts` (10-01-01, 10-04-01) |
| BASE2-07 | forbidden DML refused (engine, incl. undelete) | `engine.test.ts` BUSINESS_FLAGS + "five documented refusals" (10-05-01) |
| BASE2-07 | REST 400 envelope | `api.test.ts` "write protection ... business" (10-05-02) |
| BASE2-07 | lookup codes MALFORMED_ID / INVALID_CROSS_REFERENCE_KEY; case-twin routing | `engine.test.ts` D-20 + case twins (10-05-01) |
| BASE2-07 | D-18 required fields | `baseline-generator.test.ts` (10-04-02), `engine.test.ts` (10-05-01) |
| BASE2-07 | upgrade of populated v1.0 DB silent, only 18 CREATE TABLE | `upgrade.test.ts` NEW_TABLES (10-04-02) |
| BASE2-08 | referenced -> warning, unreferenced -> info, roll-up child, PROVENANCE read | `build.test.ts` (10-02-01) |
| BASE2-08 | info line, `--strict` exit 0, `--quiet` | `main.test.ts` (10-02-02) |

---

## Wave 0 Requirements

- [ ] `scripts/gen-baseline/calls.ts` (new) with `parseSupportedCalls` + tests in `gen-baseline-typemap.test.ts` (10-01-01)
- [ ] `object-reference-snapshot.test.ts` accepts and validates `supportedCalls` (10-01-01; tightened in 10-04-01)
- [ ] `baseline-gate.test.ts`: "never from an org" test rewritten for `de-describe` with ref (10-01-02)
- [ ] Describe-check null-keyPrefix guard (`contract.json` `nullKeyPrefix` + both scripts) only if 10-03 ends in D-02 (10-05-02)
- [ ] No framework install needed

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Key prefixes, labels, name fields confirmed from Johan's own DE describe | BASE2-06 (D-01..D-04) | Johan's org; orglet never contacts an org | Plan 10-03 checkpoint table |
| Pinned sync + snapshot of the sources | BASE2-06 | network, never CI | Plan 10-04 Task 1 commands with the SHA and cached PDF |
| `orglet check --strict` on Johan's DE retrieve | SC4 | retrieve is not in the repo | Plan 10-06 Task 3 |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s for the quick command
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
