---
phase: 15
slug: files-model
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-11-03
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.2.7 (root `vitest.config.ts`, `@orglet/*` aliased to `src/index.ts`) |
| **Config file** | `vitest.config.ts` |
| **DB harness** | `test/db.ts` (`openTestDb`, `usingPglite`); pglite default, Postgres with `ORGLET_DATABASE_URL`; per-run schema |
| **Quick run command** | `pnpm vitest run <changed test file>` (Node 22 on PATH: `~/.nvm/versions/node/v22.23.3/bin`) |
| **Full suite command** | `pnpm build && pnpm test && pnpm lint && pnpm baseline:check` |
| **Phase gate** | Full suite on pglite + Postgres 16 (`ORGLET_DATABASE_URL`) + `conformance/run-all.sh` green |
| **Estimated runtime** | single file < 30 s; full suite several minutes (pglite migrations per test file) |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run <the new/changed test file>`; `pnpm baseline:check` after any generator input change; `pnpm lint`
- **After every plan wave:** Run `pnpm build && pnpm test && pnpm lint`
- **Before `/gsd:verify-work`:** Full suite must be green on pglite and Postgres 16; `conformance/run-all.sh` green (describe-check 33/33 per SDK, files-check legs PASS)
- **Max feedback latency:** 30 seconds per task

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 15-06-T1, 15-03-T2 | 15-06, 15-03 | 4, 2 | FILE-03 | engine integration + metadata unit | `pnpm vitest run packages/engine/src/files.test.ts -t "creates its document"`; `pnpm vitest run packages/metadata/test/baseline-generator.test.ts` | ❌ W0 (files.test.ts) | ⬜ pending |
| 15-06-T1 | 15-06 | 4 | FILE-03 (import mode exempt) | engine | `pnpm vitest run packages/engine/src/files.test.ts -t "import mode"` | ❌ W0 | ⬜ pending |
| 15-05-T2 (+15-05-T1 migrate.test) | 15-05 | 3 | FILE-03 / D-02 upgrade | upgrade integration | `pnpm vitest run packages/engine/src/upgrade-v11.test.ts` | ❌ W0 (new + fixture `baseline-v1.1`) | ⬜ pending |
| 15-06-T1 | 15-06 | 4 | FILE-04 | engine | `pnpm vitest run packages/engine/src/files.test.ts -t "adds a version"` | ❌ W0 | ⬜ pending |
| 15-07-T2 | 15-07 | 5 | FILE-04 (mirror on update) | engine | `pnpm vitest run packages/engine/src/files.test.ts -t "mirror"` | ❌ W0 | ⬜ pending |
| 15-01-T2, 15-06-T1, 15-09-T1 | 15-01, 15-06, 15-09 | 1, 4, 5 | FILE-05 | engine + api | `pnpm vitest run packages/engine/src/files.test.ts packages/api/src/files.test.ts` | ❌ W0 | ⬜ pending |
| 15-09-T1 | 15-09 | 5 | FILE-05 (multipart) | api `app.inject` | `pnpm vitest run packages/api/src/files.test.ts -t "multipart"` | ❌ W0 | ⬜ pending |
| 15-09-T3 (Postgres-only) | 15-09 | 5 | FILE-05 (memory bound) | api/engine perf | `pnpm vitest run packages/api/src/files.test.ts -t "large upload"` | ❌ W0 | ⬜ pending |
| 15-01-T1, 15-08-T1, 15-09-T1, 15-09-T2 | 15-01, 15-08, 15-09 | 1, 3, 5 | FILE-06 | api | `pnpm vitest run packages/api/src/files.test.ts` | ❌ W0 | ⬜ pending |
| 15-10-T1, 15-10-T2 | 15-10 | 6 | FILE-06 (SDK round trip) | conformance | `conformance/run-all.sh` legs `files-check-jsforce` / `files-check-python` | ❌ W0 (`conformance/files-check/`) | ⬜ pending |
| 15-03-T2, 15-04-T1, 15-07-T2 | 15-03, 15-04, 15-07 | 2, 3, 5 | FILE-07 (baseline + link DML) | metadata + engine | `pnpm vitest run packages/metadata/src/build.test.ts packages/engine/src/files.test.ts -t "link"` | build.test.ts ✅ (extend); files.test.ts ❌ W0 | ⬜ pending |
| 15-08-T2 | 15-08 | 3 | FILE-07 (SOQL filter) | soql unit | `pnpm vitest run packages/soql/src/compile.test.ts -t "ContentDocumentLink"` | ✅ (extend) | ⬜ pending |
| 15-07-T1 | 15-07 | 5 | FILE-08 | engine | `pnpm vitest run packages/engine/src/files.test.ts -t "delete"`; `packages/engine/src/engine.test.ts` | ❌ W0 / ✅ | ⬜ pending |
| 15-02-T1, 15-06-T2 | 15-02, 15-06 | 2, 4 | FILE-09 (`blobKey`) | pure unit | `pnpm vitest run packages/engine/src/blobs.test.ts` | ❌ W0 | ⬜ pending |
| 15-09-T2 | 15-09 | 5 | FILE-09 (missing blob, mismatch) | api | `pnpm vitest run packages/api/src/files.test.ts -t "missing blob" -t "checksum mismatch"` | ❌ W0 | ⬜ pending |
| 15-03-T2 | 15-03 | 2 | FILE-09 (`blob-field` report) | generator | `pnpm vitest run packages/metadata/test/baseline-generator.test.ts packages/metadata/test/baseline-gate.test.ts`; `pnpm baseline:check` | ✅ (update) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Task IDs filled in by the planner (2026-11-03). Extra Wave 0 file: `packages/engine/src/filetypes.test.ts` (15-02-T2). The FILE-05 memory test runs on Postgres only (pglite is in-process).*

---

## Wave 0 Requirements

- [ ] `packages/engine/src/files.test.ts` — FILE-03/04/05/07/08 engine behaviour, import-mode exemption, set-null cascade regression
- [ ] `packages/engine/src/blobs.test.ts` — `blobKey` vectors (traversal, case, length, NUL) in 15-02; `InlineBlobStore` put/open/no-bytes in 15-06
- [ ] `packages/engine/src/upgrade-v11.test.ts` + `packages/metadata/test/fixtures/baseline-v1.1/` (from `git archive v1.1 packages/metadata/standard`) — D-02 both branches
- [ ] `packages/api/src/files.test.ts` — download headers/bytes, URL-not-bytes in record/composite/SOQL/describe, multipart refusal, 413, missing blob 404, mismatch diagnostic, memory bound
- [ ] `packages/soql/src/compile.test.ts` — ContentDocumentLink filter cases (extend)
- [ ] `packages/schema/src/migrate.test.ts` — NOT NULL reconcile cases (extend)
- [ ] `conformance/files-check/{jsforce.mjs,sf_files.py,README.md}` + `files-check-*` legs in `conformance/run-all.sh`; `ContentDocumentLink` in `conformance/describe-check/objects.txt`
- [ ] Update: `baseline-generator.test.ts`, `build.test.ts`, `api.test.ts`, `engine.test.ts`, `object-reference-snapshot.test.ts`, `documented-fields.test.ts`
- Framework install: none (vitest present).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Postgres 16 run of the full suite | all | Docker daemon state not confirmed locally | CI `test-postgres` job, or `pnpm db:up && ORGLET_DATABASE_URL=... pnpm test` |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
