---
phase: 12
slug: sigha-resync-formula-globals
status: planned
nyquist_compliant: true
wave_0_complete: false
created: 2026-10-23
---

# Phase 12 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.2.x (single root config, `@orglet/*` aliased to `src`); pglite per test file via `test/db.ts`, real Postgres when `ORGLET_DATABASE_URL` is set |
| **Config file** | `vitest.config.ts` (includes `packages/*/src/**/*.test.ts` and `packages/*/test/**/*.test.ts`) |
| **Quick run command** | `pnpm vitest run packages/formula packages/sigha` |
| **Full suite command** | `pnpm build && pnpm test && pnpm lint` |
| **Estimated runtime** | ~12 seconds quick; full suite a few minutes (pglite migrations per file) |

Node 22 is required: `export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH"` (the default shell node is older).

---

## Sampling Rate

- **After every task commit:** `pnpm vitest run packages/formula packages/sigha` plus the touched package (`packages/engine`, `packages/api`)
- **After every plan wave:** `pnpm build && pnpm test && pnpm lint` (build is needed: `tsc -b` checks the resynced composite `packages/sigha`)
- **Before `/gsd:verify-work`:** full suite green, `orglet check --strict` clean on both fixtures, `bash conformance/run-all.sh` green (plan 12-08)
- **Max feedback latency:** 12 seconds for the quick run

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 12-01-01 | 01 | 1 | FORM-01 | unit + script | `pnpm vitest run packages/sigha && pnpm lint` (+ temp-dir sync diff at pin 2abe5dbb) | ❌ W0 (`packages/sigha/test/corpus-baseline.test.ts`) | ⬜ pending |
| 12-01-02 | 01 | 1 | FORM-01 | git (fork clone) | `git -C ../sigha-upstream merge-base --is-ancestor fork/feat/unary-bang HEAD` (+ fork `pnpm test`/`typecheck`) | n/a (outside repo) | ⬜ pending |
| 12-01-03 | 01 | 1 | FORM-01 | checkpoint (human-action) | `git ls-remote https://github.com/snorf/sigha.git refs/heads/integration/phase-12` equals local SHA | n/a | ⬜ pending |
| 12-02-01 | 02 | 2 | FORM-01 | unit + build | `pnpm build && pnpm vitest run packages/sigha` (+ CI-equivalent sync diff) | ✅ (guard from 12-01) | ⬜ pending |
| 12-02-02 | 02 | 2 | FORM-01, FORM-02 | unit | `pnpm vitest run packages/formula packages/sigha packages/engine/src/query.test.ts` | ✅ expectations/formula/query tests | ⬜ pending |
| 12-03-01 | 03 | 3 | FORM-02 | integration (pglite) RED | `pnpm vitest run packages/engine/src/polymorphic-formula.test.ts` (must fail) | ❌ W0 (`packages/engine/src/polymorphic-formula.test.ts`) | ⬜ pending |
| 12-03-02 | 03 | 3 | FORM-02 | integration | `pnpm vitest run packages/engine packages/api packages/formula` | ✅ (from 12-03-01) | ⬜ pending |
| 12-04-01 | 04 | 3 | FORM-03, FORM-05 (D-14) | unit | `pnpm vitest run packages/formula` | ❌ W0 (`packages/formula/src/dependencies.test.ts`) | ⬜ pending |
| 12-04-02 | 04 | 3 | FORM-03, FORM-05 (D-14) | unit | `pnpm vitest run packages/engine/src/formulas.test.ts packages/formula && pnpm build` | ✅ | ⬜ pending |
| 12-05-01 | 05 | 4 | FORM-04 | unit | `pnpm vitest run packages/formula` | ❌ W0 (`packages/formula/src/globals.test.ts`) | ⬜ pending |
| 12-05-02 | 05 | 4 | FORM-04 | unit | `pnpm vitest run packages/engine packages/formula packages/cli && pnpm build` | ✅ | ⬜ pending |
| 12-06-01 | 06 | 5 | FORM-03, FORM-05 | unit | `pnpm vitest run packages/formula` | ✅ (globals.test.ts from 12-05) | ⬜ pending |
| 12-06-02 | 06 | 5 | FORM-03, FORM-05 | integration (pglite) | `pnpm vitest run packages/engine packages/formula packages/api && pnpm build` | ❌ W0 (`packages/engine/src/formula-globals.test.ts`) | ⬜ pending |
| 12-07-01 | 07 | 6 | FORM-03 | unit | `pnpm vitest run packages/formula` | ✅ | ⬜ pending |
| 12-07-02 | 07 | 6 | FORM-03 | integration (pglite) | `pnpm vitest run packages/engine packages/formula` | ✅ (from 12-06) | ⬜ pending |
| 12-07-03 | 07 | 6 | FORM-03 | API integration (pglite + Fastify inject) | `pnpm vitest run packages/api packages/engine packages/formula && pnpm build` | ❌ W0 (`packages/api/src/formula-globals.test.ts`) | ⬜ pending |
| 12-08-01 | 08 | 7 | FORM-01..05 | phase gate + SDK conformance | `pnpm build && pnpm test && pnpm lint && orglet check --strict` (both fixtures) + `bash conformance/run-all.sh` | ✅ | ⬜ pending |
| 12-08-02 | 08 | 7 | FORM-01..05 | docs (grep) | grep checks on REQUIREMENTS.md, PROJECT.md, todo location | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Test files are created by the first task of the plan that needs them (test-first), not in a separate wave:

- [ ] `packages/sigha/test/corpus-baseline.test.ts` — locks salesforce-v2.json >= 6312 pass of >= 9730 rows (12-01-01, FORM-01); sync-proof location
- [ ] `packages/engine/src/polymorphic-formula.test.ts` — typed owners, wrong-type blank, typed hop continuation, relationship-key leak (12-03-01, FORM-02)
- [ ] `packages/formula/src/dependencies.test.ts` — FormulaDependencies shape and volatility (12-04-01, D-14)
- [ ] `packages/formula/src/globals.test.ts` — `$Label`, `$CustomMetadata`, `$UserRole`, `$Setup`, `$Permission`, `$Api` compile/evaluate (12-05-01, extended by 12-06-01 and 12-07-01; FORM-03..05)
- [ ] `packages/engine/src/formula-globals.test.ts` — `$UserRole`/`$Setup` loading and gating, `$Api` without request (12-06-02, 12-07-02; FORM-03, FORM-05)
- [ ] `packages/api/src/formula-globals.test.ts` — `$Api` end to end vs `instance_url`/`access_token` (12-07-03, FORM-03)
- [ ] Fork integration branch pushed by Johan and its SHA recorded (12-01-02/03): gate for CI `sigha-sync-check`, not a test file

No framework install needed: vitest, pglite and the fixtures (`examples/acme`, `conformance/cmdt-check/project`, both unmodified) exist.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Pushing `integration/phase-12` to `snorf/sigha` | FORM-01 | Outward-facing action reserved for Johan (D-01, Phase 8 D-18); Claude never pushes | Johan runs `git -C /Users/johankarlsteen/Development.nosync/sigha-upstream push -u fork integration/phase-12`; the automated `git ls-remote` check then confirms the SHA |
| CI job `sigha-sync-check` green on GNU userland | FORM-01 (Linux leg) | Runs only in GitHub Actions after Johan pushes the orglet branch | Plan 12-02 Task 1 step 6 reproduces the exact CI commands locally on macOS; the Linux run is observed on the PR |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 12s (quick run)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending (plan checker, then execution)
