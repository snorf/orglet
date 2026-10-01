---
phase: 01-test-infrastructure-ci
plan: 03
subsystem: infra
tags: [github, github-actions, gh-cli, ci, pnpm, lint, tsc-build, repo-creation]

# Dependency graph
requires:
  - phase: 01-test-infrastructure-ci (plan 01)
    provides: embedded pglite test backend, auto-detect via ORGLET_DATABASE_URL
  - phase: 01-test-infrastructure-ci (plan 02)
    provides: .github/workflows/ci.yml (two-job CI), README/docs updates
provides:
  - "Public repository github.com/snorf/orglet (owner snorf, default branch main, 6 topics, description from package.json)"
  - "gsd/phase-01-test-infrastructure-ci pushed; first CI run green on both test-pglite and test-postgres"
  - ".github/workflows/ci.yml step order corrected to install -> build -> lint -> test (both jobs) so package `exports` resolve cross-package types from dist/index.d.ts on a fresh checkout"
  - "01-CONTEXT.md D-16 and 01-RESEARCH-B-github.md corrected to record the verified step order and why the prior 'both orders are safe' research claim was wrong"
affects: [01-04-branch-protection-ruleset]

# Tech tracking
tech-stack:
  added: []
  patterns: ["CI step order install -> build -> lint -> test (build before lint) because package.json exports map types to dist/index.d.ts, which only exists after tsc -b runs"]

key-files:
  created: []
  modified:
    - .github/workflows/ci.yml
    - .planning/phases/01-test-infrastructure-ci/01-CONTEXT.md
    - .planning/phases/01-test-infrastructure-ci/01-RESEARCH-B-github.md

key-decisions:
  - "Reordered both CI jobs to install -> build -> lint -> test; the previously locked D-16 order (lint before build) was correct per the research's reasoning about tsconfig.test.json, but wrong in practice because ESLint's type-aware rules also resolve *cross-package* imports (@orglet/*) through package.json exports, which point at dist/*.d.ts, not source, and dist/ does not exist on a fresh clone"
  - "Corrected CONTEXT.md D-16 and RESEARCH-B-github.md in place rather than leaving the record wrong, citing CI run 36831399404 as the evidence"

requirements-completed: [INFRA-03, INFRA-04, INFRA-05, INFRA-06, INFRA-07]

# Metrics
duration: see Performance section (this continuation only; Task 1 ran in an earlier session turn)
completed: 2026-10-01
---

# Phase 1 Plan 03: Public Repo, First Push, and Green CI Summary

**snorf/orglet is live and public on GitHub with main as the default branch; after fixing a lint-before-build ordering bug found on the first CI run, both `test-pglite` and `test-postgres` are green on `gsd/phase-01-test-infrastructure-ci`, with zero `sync-sigha` references in the logs.**

## Performance

- **Fix iteration (this continuation):** commit `a52ed62` pushed 2026-10-01T07:51Z; CI run `36832808542` completed (success) a few minutes later
- **Tasks:** 3/3 (Task 1 auto, Task 2 checkpoint:decision, Task 3 auto) — Task 1 and Task 2 were completed in an earlier turn of this same execution; this continuation covers Task 3 from the CI-failure fix onward
- **Files modified (this continuation):** 3 (`.github/workflows/ci.yml`, `01-CONTEXT.md`, `01-RESEARCH-B-github.md`)

## Accomplishments

- **Task 1 — Local pre-flight (both backends):**
  - pglite: `Test Files 13 passed (13)`, `Tests 123 passed | 1 skipped (124)` (the Postgres-only dual-open-transaction compat test correctly skipped on pglite's single-connection query queue)
  - Real Postgres (Docker, port 5433): `Test Files 13 passed (13)`, `Tests 124 passed (124)` (no skips — the compat test runs for real against Postgres)
  - INFRA-03 server smoke: `orglet up` with no `--db`/env var reached real Postgres via the CLI default on a throwaway `phase1_smoke` schema/port 8099; `http://localhost:8099/services/data` returned HTTP 200 with a `"version"` field; `orglet reset` printed `dropped schema "phase1_smoke"`
  - Identity: `git log --all --format='%ae%n%ce' | sort -u` printed exactly `johan@karlsteen.com`, no `tele2.com` address anywhere
  - Name free: `gh repo view snorf/orglet` failed with "Could not resolve to a Repository" before creation; `gh auth status` showed account `snorf`
- **Task 2 — Johan's confirmation (D-08):** Johan approved repo creation and the pushes (the checkpoint's `approve` path). The exact verbatim reply from that checkpoint round-trip is not available to this continuation agent (it was exchanged with the orchestrator in an earlier turn, outside this agent's context); the repo's existence, its push history, and the now-pushed phase branch are the durable evidence that approval was given and acted on, consistent with PROJECT.md's outward-facing-action constraint. Johan separately and explicitly approved the step-order fix push covered by this continuation (quoted in the objective passed to this agent: push a fix that runs `pnpm build` before `pnpm lint`, re-run CI, and drive it to green).
- **Task 3 — Repo creation, first push, CI fix, green run:**
  - `snorf/orglet` created public, `gh repo view` confirms `{isPrivate: false, owner: "snorf", defaultBranch: "main", topics: 6}` and description `Self-hosted, Salesforce-compatible CRM platform emulator`
  - Topics set: `salesforce`, `emulator`, `postgres`, `typescript`, `soql`, `localstack`
  - `main` pushed first (23 commits), so it became the default branch; `git rev-parse origin/main` == `git rev-parse main` == `574cd0a`
  - `gsd/phase-01-test-infrastructure-ci` pushed (16 commits ahead of `main` after this continuation's fix commit)
  - **First CI run `36831399404`** (https://github.com/snorf/orglet/actions/runs/36831399404): both `test-pglite` and `test-postgres` **failed** at the `Run pnpm lint` step (`Run pnpm build` was skipped as a consequence, since it came after lint in the original order). Root cause: on a fresh clone, `packages/*/dist/*.d.ts` does not exist yet, and every package's `package.json` `exports` map resolves cross-package `@orglet/*` types to `./dist/index.d.ts`. ESLint's type-aware rules follow those `exports` for cross-package imports, so with no `dist/` present they fell back to `any`, producing 81 `@typescript-eslint/no-unsafe-*` errors concentrated in `packages/cli/src/main.ts` (which imports from the most other packages). Locally reproduced by moving all `packages/*/dist` aside and running `pnpm build && pnpm lint` under Node 22 before the fix — same failure; after reordering to `build` then `lint`, both commands exited 0.
  - **Fix:** `.github/workflows/ci.yml` step order changed from `install -> lint -> build -> test` to `install -> build -> lint -> test` in both jobs (and only that — no other lines changed), committed as `a52ed62` ("Build before lint in CI so cross-package types resolve on a fresh checkout"), pushed to `gsd/phase-01-test-infrastructure-ci`
  - **Green run `36832808542`** (https://github.com/snorf/orglet/actions/runs/36832808542): both jobs `success`.
    - `test-pglite` steps: Set up job, Run actions/checkout@v7, Run pnpm/action-setup@v6, Run actions/setup-node@v7, Run pnpm install --frozen-lockfile, **Run pnpm build**, **Run pnpm lint**, Run pnpm test, Post Run actions/setup-node@v7, Post Run pnpm/action-setup@v6, Post Run actions/checkout@v7, Complete job
    - `test-postgres` steps: same list plus `Initialize containers` after `Set up job` and `Stop containers` before `Complete job` (the `postgres:16-alpine` service container)
  - INFRA-07 negative check: `gh run view 36832808542 --repo snorf/orglet --log | grep -ci sync-sigha` → `0`

## Task Commits

Each task was committed atomically:

1. **Task 1: Local pre-flight on both backends, server-path smoke, identity and name checks** — no commit (read-only checks; one throwaway Postgres schema created and dropped again)
2. **Task 2: Johan confirms repo creation and the first pushes (D-08)** — no commit (checkpoint:decision, resolved `approve` in an earlier turn)
3. **Task 3: Create the repo, push main, set topics, push the phase branch and drive CI to green**
   - Repo creation, topic-setting, `main` push, phase-branch push — no local commit (these are `gh`/`git push` operations against existing commits, not new commits)
   - CI-order fix — `a52ed62` (fix): `.github/workflows/ci.yml` step order install → build → lint → test in both jobs; `01-CONTEXT.md` D-16 and `01-RESEARCH-B-github.md` corrected to match

**Plan metadata:** pending (this SUMMARY's commit, created next)

## Files Created/Modified

- `.github/workflows/ci.yml` — both jobs reordered from `install → lint → build → test` to `install → build → lint → test`; nothing else changed
- `.planning/phases/01-test-infrastructure-ci/01-CONTEXT.md` — D-16 updated to state the correct step order and why (`exports` resolve types from `dist/index.d.ts`, absent on a fresh checkout), citing CI run `36831399404`
- `.planning/phases/01-test-infrastructure-ci/01-RESEARCH-B-github.md` — one-paragraph correction appended next to the "both orders are safe" claim, noting it was wrong on a dist-less checkout

## Decisions Made

- Fixed the step order directly in `ci.yml` (D-16 effectively superseded by this finding) rather than adding a separate typecheck-only step or weakening lint rules — the simplest correct fix, and the one Johan explicitly approved.
- Corrected the historical record (`01-CONTEXT.md`, `01-RESEARCH-B-github.md`) in place instead of leaving a known-wrong claim standing, per CLAUDE.md's "say ifrån högt" and "no shortcuts" rules.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] CI step order (`lint` before `build`) caused both jobs to fail on a fresh checkout**
- **Found during:** Task 3, step 5 (first CI run, `36831399404`)
- **Issue:** `.github/workflows/ci.yml` ran `pnpm lint` before `pnpm build` per the originally locked D-16 order. On a clean clone with no `dist/`, ESLint's type-aware rules resolve `@orglet/*` cross-package imports through `package.json` `exports`, which point at `./dist/index.d.ts` — absent until `tsc -b` runs. Result: 81 `@typescript-eslint/no-unsafe-*` errors, concentrated in `packages/cli/src/main.ts`, failing lint in both jobs (`test-pglite`, `test-postgres`); `build` was skipped as a consequence of the step order, not independently broken.
- **Fix:** Reordered both jobs' steps to `install → build → lint → test`. Reproduced locally first (moved `packages/*/dist` aside, confirmed `pnpm lint` fails the same way; ran `pnpm build && pnpm lint` under Node 22 after reordering, both exited 0) before pushing.
- **Files modified:** `.github/workflows/ci.yml`, `.planning/phases/01-test-infrastructure-ci/01-CONTEXT.md`, `.planning/phases/01-test-infrastructure-ci/01-RESEARCH-B-github.md`
- **Verification:** CI run `36832808542` — both jobs `success`; step order confirmed via `gh run view --json jobs`; `sync-sigha` grep on the full log returns `0`
- **Committed in:** `a52ed62` (pushed and verified green; approved by Johan per this continuation's objective before pushing)

---

**Total deviations:** 1 auto-fixed (1 bug, Rule 1)
**Impact on plan:** Necessary correctness fix for CI to pass at all; no scope creep — only the step order changed, no other workflow content touched.

## Issues Encountered

None beyond the deviation above. Fix verified both locally (dist removed, `pnpm build && pnpm lint` exit 0) and in CI (green run) before being recorded as done.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `snorf/orglet` is public, `main` is the default branch, `gsd/phase-01-test-infrastructure-ci` is pushed with a green CI run (`36832808542`) on both required jobs (`test-pglite`, `test-postgres`) — the status-check names plan 01-04's branch-protection ruleset needs now exist and have run successfully, satisfying the ruleset's soft precondition.
- INFRA-03 (real Postgres server path), INFRA-04 (public repo, confirmed), INFRA-05/06 (both CI jobs green), INFRA-07 (no `sync-sigha` in logs) are all observably true as of this plan.
- No blockers for plan 01-04 (branch protection ruleset + PR to `main`). This commit (`a52ed62`) is on the phase branch, pushed; the SUMMARY/STATE/ROADMAP commit below is local-only, as instructed — plan 01-04 pushes remaining commits after Johan's next confirmation.

---
*Phase: 01-test-infrastructure-ci*
*Completed: 2026-10-01*

## Self-Check: PASSED

All files referenced in this SUMMARY found on disk (`.github/workflows/ci.yml`, `01-CONTEXT.md`, `01-RESEARCH-B-github.md`, this SUMMARY.md itself). Fix commit `a52ed62` found in `git log --oneline --all`. CI run `36832808542` confirmed `success` for both `test-pglite` and `test-postgres` via `gh run view`; `sync-sigha` log grep returns `0`; `origin/main` == `main` == `574cd0a`.
