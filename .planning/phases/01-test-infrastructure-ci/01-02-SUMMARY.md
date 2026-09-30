---
phase: 01-test-infrastructure-ci
plan: 02
subsystem: infra
tags: [github-actions, ci, pnpm, postgres, pglite, docker-compose, readme]

# Dependency graph
requires: []
provides:
  - ".github/workflows/ci.yml" with two jobs, test-pglite (no services) and test-postgres (postgres:16-alpine service container), both running install --frozen-lockfile, lint, build (tsc -b), test
  - README.md CI badge under the H1 and a Docker-optional Development section with both the pglite and real-Postgres test invocations
  - .env.example comment clarifying ORGLET_DATABASE_URL is for the server/Docker Compose path, with pnpm test opting in only when set
  - docker-compose.yml header comment clarifying it is for orglet up / real-Postgres test runs, not required for pnpm test
affects: [01-03-github-repo-and-push, 01-04-branch-protection-ruleset]

# Tech tracking
tech-stack:
  added: []
  patterns: [GitHub Actions two-job CI matrix (pglite vs real Postgres) keyed off ORGLET_DATABASE_URL presence, per D-09/D-11]

key-files:
  created: [.github/workflows/ci.yml]
  modified: [README.md, .env.example, docker-compose.yml]

key-decisions:
  - "ci.yml content copied verbatim from 01-RESEARCH-B-github.md per plan instruction; no name: fields on jobs so check contexts stay test-pglite / test-postgres for the plan 01-04 ruleset"
  - "No corepack enable step, no version: on pnpm/action-setup@v6 (reads packageManager from package.json), per research finding"

requirements-completed: [INFRA-05, INFRA-06, INFRA-07, INFRA-03]

# Metrics
duration: ~2min (commit-to-commit; file edits and verification took longer within the session)
completed: 2026-09-30
---

# Phase 1 Plan 02: GitHub Actions CI Workflow and Docker-Optional Docs Summary

**Two-job GitHub Actions CI workflow (`test-pglite`, `test-postgres` against a postgres:16-alpine service container) plus README/`.env.example`/`docker-compose.yml` updates documenting that Docker is optional for development and tests.**

## Performance

- **Duration:** ~2 min between first and last task commit (e1c77d3 → 2a7e09d)
- **Started:** 2026-09-30T21:28:01+02:00
- **Completed:** 2026-09-30T21:29:15+02:00
- **Tasks:** 2/2
- **Files modified:** 4 (1 created, 3 modified)

## Accomplishments
- `.github/workflows/ci.yml` created with the exact two-job shape from research: `test-pglite` (no `ORGLET_DATABASE_URL`, falls through to embedded pglite per D-09) and `test-postgres` (postgres:16-alpine service container, `ORGLET_DATABASE_URL` set per D-11), both running `install --frozen-lockfile → lint → build → test` (D-16 order), triggered on push to any branch and PRs to `main` (D-14)
- README.md gained a CI status badge directly under the `# orglet` H1 (D-05) and a rewritten Development section stating Docker is optional, with both the pglite-only `pnpm test` invocation and the real-Postgres `ORGLET_DATABASE_URL=... pnpm test` invocation (D-13)
- `.env.example` and `docker-compose.yml` comments updated to describe the D-10 relocation: the default Postgres URL is now the server/Docker-Compose path, not the test default

## Task Commits

Each task was committed atomically:

1. **Task 1: Add the two-job CI workflow** - `e1c77d3` (feat)
2. **Task 2: README badge and Docker-optional Development section; .env.example and compose comments** - `2a7e09d` (docs)

**Plan metadata:** pending (this SUMMARY's commit, created next)

## Files Created/Modified
- `.github/workflows/ci.yml` - Two-job CI: test-pglite, test-postgres (postgres:16-alpine service), install/lint/build/test on push (any branch) + PR to main
- `README.md` - CI badge under H1; Development section rewritten to make Docker optional, with pglite and real-Postgres test commands
- `.env.example` - Comment clarifies ORGLET_DATABASE_URL is the server/Docker-Compose default that `pnpm test` only uses when explicitly set
- `docker-compose.yml` - Header comment clarifies it's for `orglet up` / real-Postgres test runs, not required for `pnpm test`

## Decisions Made
- Followed the plan's instruction to copy `ci.yml` verbatim from `01-RESEARCH-B-github.md` (Part B), including omitting `name:` on jobs so GitHub Actions check-run context names default to the job keys `test-pglite` / `test-postgres` — required by the branch-protection ruleset in plan 01-04.
- No deviations beyond what the plan specified.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. One local verification quirk: BSD `grep` (no `-E`/`-F`) on macOS did not match a literal pattern containing `${...}` followed immediately by `:` due to its own BRE `$`-anchor handling, even though the underlying `docker-compose.yml` content (`"${ORGLET_PG_PORT:-5433}:5432"`) was unchanged and correct — confirmed correct via `grep -F` (fixed-string match, count 1), `grep -n` (line present, unmodified), and `docker compose config -q` succeeding. Not a deviation from the plan; a false negative in my own ad hoc verification command, not in the file.

## User Setup Required

None - no external service configuration required. (Repo creation, first push, and branch-protection ruleset are outward-facing actions owned by plans 01-03 and 01-04, requiring explicit confirmation with Johan at execution time — not part of this plan.)

## Next Phase Readiness
- `ci.yml` is ready for the first push (plan 01-03); its job keys (`test-pglite`, `test-postgres`) match what plan 01-04's branch-protection ruleset requires as status-check contexts.
- README/`.env.example`/`docker-compose.yml` now correctly describe the D-10 default-URL relocation and D-13 Docker-optional wording ahead of the repo going public.
- No blockers. This plan ran in parallel with 01-01 (pglite test infra) and shares no files with it; both must land before plan 01-03 pushes the repo, since CI needs both the workflow file (this plan) and the pglite bootstrap/tests (01-01) to go green.

---
*Phase: 01-test-infrastructure-ci*
*Completed: 2026-09-30*

## Self-Check: PASSED

All created/modified files found on disk (.github/workflows/ci.yml, README.md, .env.example, docker-compose.yml, this SUMMARY.md). Both task commits (e1c77d3, 2a7e09d) found in `git log --oneline --all`.
