---
phase: 08-upgrade-safety-net-nullable-key-prefixes
verified: 2026-10-13T00:00:00Z
status: human_needed
score: 5/5 must-haves verified (SC5 PR-link clause is a documented, user-chosen partial)
human_verification:
  - test: "Open the two PRs to rfaulhaber/sigha from snorf/sigha (feat/unary-bang, feat/polymorphic-colon-ref) and record the links in packages/sigha/VENDOR.md (heading becomes `## Upstream changes`)"
    expected: "VENDOR.md lists PR links instead of 'pushed to fork, PR not opened yet'"
    why_human: "Johan answered the 08-10 checkpoint with 'later'; Claude must never run gh pr create (D-18)"
  - test: "Push the branch and confirm the `sigha-sync-check` CI job passes on ubuntu-latest"
    expected: "Job green: script runs with GNU sed and diff -r of src/ and corpus/ is empty"
    why_human: "Job has not run on GitHub yet; Linux sed path untested in CI"
  - test: "Run the upgrade test against Postgres 16 (ORGLET_DATABASE_URL set)"
    expected: "packages/engine/src/upgrade.test.ts passes on Postgres as well as pglite"
    why_human: "Postgres-backed variant was not observed by this verifier (orchestrator ran the full suite)"
---

# Phase 8: Upgrade safety net and nullable key prefixes - Verification Report

**Phase Goal:** A database created by v1.0 can be upgraded by any later baseline change without data loss or an aborted `orglet up`, and a standard object without a confirmed key prefix is a first-class citizen.
**Status:** human_needed
**Re-verification:** No, initial verification

## Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | v1.0 snapshot upgrade test with Group-owned and import rows, exact warning set | VERIFIED | `packages/metadata/test/fixtures/baseline-v1.0` (git-archive snapshot); `packages/engine/src/upgrade.test.ts` asserts rows byte-identical and `migration.warnings` toEqual `EXPECTED_WARNINGS` (empty); pglite default, Postgres via env |
| 2 | Violating new FK: up completes, one `UNSUPPORTED:schema-fk` per column, no row touched | VERIFIED | `packages/schema/src/migrate.ts` emits diagnostic area `schema-fk` (line ~202), skips FK; covered by migrate tests (orchestrator run green) |
| 3 | Second up is silent, no CREATE INDEX | VERIFIED | upgrade.test.ts third test asserts no index/sequence creation; migrate tests cover MIGR-04 |
| 4 | Null key prefix object loads, describes, accepted as reference target, excluded from polymorphic matching | VERIFIED | `keyPrefixSource` in `packages/metadata/src/types.ts` and `build.ts` (hard `invalid baseline:` validation); tests in `build.test.ts` plus engine tests per 08-01 plan; no prefix invented |
| 5 | Groundwork: diagnostics, Linux-safe sync script, red expectation tests, VENDOR.md, audit list | PARTIAL (accepted) | See below |

SC5 detail:
- Diagnostics: `packages/metadata/src/diagnostics.ts` exports Diagnostic/SkippedItem/FormulaFailure/formatDiagnostic/pushDiagnostic via `index.ts`; `diagnostics.test.ts` exists. VERIFIED.
- `scripts/sync-sigha.sh`: only `sed -i.bak` (portable to GNU and BSD), no `sed -i ''`. CI job `sigha-sync-check` present in `.github/workflows` (ubuntu-latest, SIGHA_DEST in RUNNER_TEMP, diff -r). VERIFIED statically; not yet run in CI.
- `packages/formula/src/expectations.test.ts`: `it.fails` expectations for `!`, colon syntax (Phase 12 resync). VERIFIED.
- `VENDOR.md`: `## Pending upstream changes` names both branches with compare URLs, status "pushed to fork, PR not opened yet". PARTIAL by user choice (not a code gap).
- `08-GROUP-OWNED-AUDIT.md` committed in the phase directory (99 lines). VERIFIED.

**Score:** 5/5 (with SC5 PR-link clause deferred to human)

## Requirements Coverage

| Requirement | Source Plans | Status | Evidence |
|-------------|--------------|--------|----------|
| MIGR-01 | 08-03, 08-06, 08-07 | SATISFIED | upgrade.test.ts, v1.0 snapshot |
| MIGR-02 | 08-02, 08-05 (and 08-08 per frontmatter) | SATISFIED | schema-fk warning in migrate.ts |
| MIGR-04 | 08-02, 08-06 | SATISFIED | idempotent second migrate |
| BASE2-05 | 08-01, 08-03, 08-04, 08-05, 08-07, 08-08, 08-09, 08-10 | SATISFIED | nullable keyPrefix, diagnostics, sigha groundwork |

All four IDs are marked Complete in REQUIREMENTS.md. No orphaned requirements (MIGR-03 maps to Phase 9).

## Anti-Patterns

None blocking. The `it.fails` tests are intentional red-until-Phase-12 expectations.

## Behavioral Spot-Checks

Not re-run by this verifier; relied on orchestrator: `pnpm build` and `pnpm lint` clean, 31 test files, 490 passed, 3 skipped (pre-existing Postgres-only skips).

## Gaps Summary

No code gaps. Open follow-ups: (1) upstream sigha PRs not yet opened (user-chosen "later"); (2) `sigha-sync-check` CI job unproven until branch is pushed; (3) Postgres 16 run of the upgrade test not observed here.

---
_Verified: 2026-10-13_
_Verifier: Claude (gsd-verifier)_
