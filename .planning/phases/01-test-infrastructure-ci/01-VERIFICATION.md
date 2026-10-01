---
phase: 01-test-infrastructure-ci
verified: 2026-10-01T10:30:00Z
status: passed
score: 7/7 must-haves verified
---

# Phase 1: Test Infrastructure & CI Verification Report

**Phase Goal:** Unit and integration tests run without Docker via embedded pglite, the one
genuinely open compatibility question (`session_replication_role` under the pinned pglite
version) is resolved early and explicitly, and the project is live on GitHub with CI enforcing
lint, typecheck and the full test suite — against both pglite and real Postgres — on every push.
**Verified:** 2026-10-01T10:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `pnpm test` runs the full suite on a Docker-free machine, Postgres-backed tests against embedded pglite | ✓ VERIFIED | `env -u ORGLET_DATABASE_URL pnpm test` run live: 13 test files, 123 passed, 1 skipped, matches expected exactly |
| 2 | The `session_replication_role`/`information_schema` compatibility question is settled before later phases add more Postgres-backed tests | ✓ VERIFIED | `packages/schema/src/pglite-compat.test.ts` exists, exercises `SET LOCAL session_replication_role = replica`, `information_schema.columns/tables`, `pg_constraint`; `.planning/codebase/TESTING.md` records "Outcome: PASS — 2026-09-30, `@electric-sql/pglite` 0.5.8 + `@electric-sql/pglite-socket` 0.2.11, `pg` 8.23.0, Node 22" with one Postgres-only test explicitly skipped with a reason string |
| 3 | `orglet up` / Docker Compose path continues to run against real Postgres 16, unaffected by pglite | ✓ VERIFIED | `packages/cli/src/main.ts` keeps the `localhost:5433` fallback; `docker-compose.yml` uses `postgres:16-alpine`; `grep -rl pglite packages/*/src --include="*.ts"` excluding `*.test.ts` returns nothing — no production code imports pglite |
| 4 | Project is live in a public GitHub repo under Johan's personal account, confirmed beforehand | ✓ VERIFIED | `gh repo view snorf/orglet`: `isPrivate: false`, owner `snorf`, `defaultBranchRef: main`, 6 topics set; all commits in local history authored `johan@karlsteen.com` (no tele2.com addresses) |
| 5 | GitHub Actions runs lint, typecheck and full suite on every push/PR in two jobs (pglite, Postgres 16), neither invoking `scripts/sync-sigha.sh` | ✓ VERIFIED | `.github/workflows/ci.yml`: jobs `test-pglite` and `test-postgres`, each runs install → build (`tsc -b`) → lint → test; `test-postgres` has a `postgres:16-alpine` service container; `grep -rn "sync-sigha\|conformance" .github/workflows/` empty; live run 36834230519 on `gsd/phase-01-test-infrastructure-ci` shows both jobs `success`; full run log grep for `sync-sigha` returns 0 matches |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `packages/schema/src/db.ts` | `databaseUrlFromEnv(): string \| undefined`, no default | ✓ VERIFIED | `return process.env["ORGLET_DATABASE_URL"];` — no fallback |
| `packages/cli/src/main.ts` | relocated `localhost:5433` fallback | ✓ VERIFIED | `databaseUrlFromEnv() ?? "postgres://orglet:orglet@localhost:5433/orglet"` |
| `test/db.ts` | `openTestDb()`/`usingPglite`, per-file pglite instance, `maxConnections` | ✓ VERIFIED | Exports `usingPglite`, `TestDb`, `openTestDb`; `PGlite.create()` called fresh per `openTestDb()` invocation (per-file via `beforeAll`); `PGLiteSocketServer` configured with `maxConnections: 10` |
| `packages/schema/src/pglite-compat.test.ts` | D-19 compat test | ✓ VERIFIED | 5 tests, 1 skipped (Postgres-only, reason recorded); ran successfully in live `pnpm test` |
| `.planning/codebase/TESTING.md` | D-19 outcome recorded | ✓ VERIFIED | "## pglite Compatibility (D-19)" section with explicit PASS outcome and version pins |
| `.github/workflows/ci.yml` | two-job CI, correct step order, no sigha | ✓ VERIFIED | See truth 5 above |
| `README.md` | badge under H1, Docker optional | ✓ VERIFIED | Badge is line 3, directly under `# orglet` H1; "Docker is optional: the tests run against an embedded Postgres (pglite)..." in Development section |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `test/db.ts` | `@orglet/schema databaseUrlFromEnv` | `usingPglite = databaseUrlFromEnv() === undefined` | ✓ WIRED | Line 14, exact match |
| `migrate.test.ts`, `engine.test.ts`, `query.test.ts`, `api.test.ts`, `bulk.test.ts` | `test/db.ts` | `openTestDb()` in `beforeAll` | ✓ WIRED | All five files import `openTestDb` from `../../../test/db.js` and call it in `beforeAll` |
| `test/db.ts` | `@electric-sql/pglite-socket` | `PGLiteSocketServer` port 0 → `createPool` | ✓ WIRED | `new PGLiteSocketServer({ db, port: 0, ... })`, pool built from `server.getServerConn()` |
| `.github/workflows/ci.yml test-postgres` | `test/db.ts openTestDb()` | env `ORGLET_DATABASE_URL` | ✓ WIRED | `ORGLET_DATABASE_URL: postgres://orglet:orglet@localhost:5432/orglet` set at job level; live Postgres-backed run (36834230519 `test-postgres` job) succeeded |
| ruleset `required_status_checks` | `.github/workflows/ci.yml` job keys | context names `test-pglite`, `test-postgres` | ✓ WIRED | `gh api repos/snorf/orglet/rulesets/24295978`: `required_status_checks` lists both contexts exactly, `bypass_actors: []`, `current_user_can_bypass: never` |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Full suite passes Docker-free | `source ~/.nvm/nvm.sh && nvm use 22 && env -u ORGLET_DATABASE_URL pnpm test` | 13 files, 123 passed, 1 skipped, 71.73s | ✓ PASS |
| Lint clean | `pnpm lint` | `eslint .` — no output, exit success | ✓ PASS |
| Build clean | `pnpm build` | `tsc -b` — no output, exit success | ✓ PASS |
| Latest CI run on phase branch both jobs green | `gh run view 36834230519 --repo snorf/orglet --json jobs` | `test-pglite: success`, `test-postgres: success` | ✓ PASS |
| CI log never runs sync-sigha | `gh run view 36834230519 --repo snorf/orglet --log \| grep -i sync-sigha \| wc -l` | `0` | ✓ PASS |
| Ruleset "require CI on main" active, no bypass | `gh api repos/snorf/orglet/rulesets` + ruleset detail | `enforcement: active`, required contexts `test-pglite`+`test-postgres`, `bypass_actors: []` | ✓ PASS |
| Phase PR open, not merged, mergeable | `gh pr view 1 --repo snorf/orglet --json state,baseRefName,mergeable` | `state: OPEN`, `baseRefName: main`, `mergeable: MERGEABLE` | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| INFRA-01 | 01-01 | Full suite runs via `pnpm test` without Docker, Postgres-backed tests on embedded pglite | ✓ SATISFIED | Live test run: 13/13 files, 123 passed, 1 skipped, no Docker running, no `ORGLET_DATABASE_URL` |
| INFRA-02 | 01-01 | `session_replication_role`/`information_schema` behavior verified on pinned pglite version or explicitly tagged Postgres-only | ✓ SATISFIED | `pglite-compat.test.ts` + TESTING.md D-19 PASS record with explicit skip reason for the one Postgres-only case |
| INFRA-03 | 01-01, 01-02, 01-03 | `orglet up`/Compose path keeps using real Postgres 16, no production code depends on pglite | ✓ SATISFIED | `main.ts` fallback unchanged apart from relocation; `docker-compose.yml` still `postgres:16-alpine`; no pglite import outside `*.test.ts` |
| INFRA-04 | 01-03 | Public GitHub repo under Johan's personal account, confirmed beforehand, repo-local identity | ✓ SATISFIED | `snorf/orglet` public, default branch `main`, topics set, all commits `johan@karlsteen.com` |
| INFRA-05 | 01-02, 01-03, 01-04 | CI runs lint, typecheck, full suite against pglite on every push/PR | ✓ SATISFIED | `test-pglite` job present, step order install→build→lint→test; live run green; required by ruleset |
| INFRA-06 | 01-02, 01-03, 01-04 | Second CI job runs suite against Postgres 16 service container | ✓ SATISFIED | `test-postgres` job with `postgres:16-alpine` service, `ORGLET_DATABASE_URL` set; live run green; required by ruleset |
| INFRA-07 | 01-02, 01-03 | `sync-sigha.sh` never executed in CI | ✓ SATISFIED | No reference anywhere in `.github/workflows/`; live run log grep returns 0 |

No orphaned requirements — all 7 INFRA IDs from REQUIREMENTS.md appear in at least one plan's `requirements` frontmatter and all are covered by verified evidence above.

### Anti-Patterns Found

None. Grep for `TODO|FIXME|XXX|HACK|PLACEHOLDER|not yet implemented|not available` across `test/db.ts`, `packages/schema/src/db.ts`, `packages/cli/src/main.ts`, `packages/schema/src/pglite-compat.test.ts`, `.github/workflows/ci.yml` returned nothing.

### Human Verification Required

None. All must-haves verified programmatically against the local codebase and live GitHub state (repo visibility/topics, CI run conclusions and job/step details, ruleset configuration, PR state) without needing subjective or visual judgment.

### Gaps Summary

No gaps. All 5 observable truths, all 7 required artifacts, all 5 key links, and all 7 requirement
IDs (INFRA-01 through INFRA-07) verified against the actual codebase and live GitHub state:

- `pnpm test` (13 files, 123 passed, 1 skipped), `pnpm lint`, and `pnpm build` all run clean locally.
- `databaseUrlFromEnv()` has no default in `packages/schema/src/db.ts`; the `localhost:5433` fallback
  lives only in `packages/cli/src/main.ts`.
- `test/db.ts` starts a fresh pglite instance per `openTestDb()` call (i.e. per test file via
  `beforeAll`), exports `usingPglite`, and configures `maxConnections: 10` on the socket server.
- D-19 is resolved and recorded in `.planning/codebase/TESTING.md` with an explicit PASS verdict,
  exact dependency versions, and a named, skipped Postgres-only exception.
- `.github/workflows/ci.yml` has exactly the two required jobs in the required step order, a
  Postgres 16 service container in `test-postgres`, and no reference to `sync-sigha` or `conformance/`
  anywhere in the workflow directory.
- Live on GitHub: `snorf/orglet` is public with the default branch `main` and correct topics; the
  latest CI run on the phase branch has both jobs green; the branch ruleset requiring both checks is
  active with no bypass actors; PR #1 (`gsd/phase-01-test-infrastructure-ci` → `main`) is open,
  mergeable, and not merged.
- README has the CI badge directly under the H1 and documents Docker as optional.

No source files were modified and nothing was pushed, merged, or changed on GitHub during this
verification.

---

*Verified: 2026-10-01T10:30:00Z*
*Verifier: Claude (gsd-verifier)*
