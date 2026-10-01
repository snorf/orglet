# Phase 1: Test Infrastructure & CI - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-29
**Phase:** 01-test-infrastructure-ci
**Areas discussed:** GitHub repo setup, Test backend selection, CI triggers & scope, Import-mode fallback

---

## GitHub repo setup

| Option | Description | Selected |
|--------|-------------|----------|
| snorf/orglet | Personal account, name orglet | ✓ |
| Another organisation | User-named org | |

**User's choice:** snorf/orglet

| Option | Description | Selected |
|--------|-------------|----------|
| Public from day one | Matches INFRA-04, free Actions, clean history | ✓ |
| Private first, public later | Run CI privately, switch later | |

**User's choice:** Public from day one

| Option | Description | Selected |
|--------|-------------|----------|
| Full history incl. .planning/ | All 23 commits as is | ✓ |
| Full history, .planning/ ignored going forward | commit_docs false from now on | |

**User's choice:** Full history incl. .planning/

| Option | Description | Selected |
|--------|-------------|----------|
| Description + topics | From package.json; salesforce, emulator, postgres, typescript, soql, localstack | ✓ |
| CI badge in README | Actions status badge | ✓ |
| Branch protection on main | Require green CI before merge | ✓ |
| None of these | Repo and code only | |

**User's choice:** all three

| Option | Description | Selected |
|--------|-------------|----------|
| Phase branches + PR | GSD branching_strategy = phase, PR to main per phase | ✓ |
| Protection with admin bypass | Checks required, admin pushes directly | |
| Skip branch protection | Undo the choice | |

**User's choice:** Phase branches + PR
**Notes:** Follow-up raised by Claude because GSD currently commits straight to main.

---

## Test backend selection

| Option | Description | Selected |
|--------|-------------|----------|
| Env-var auto-detect | ORGLET_DATABASE_URL set = real Postgres, unset = pglite | ✓ |
| Separate scripts | test = pglite, test:pg = Docker | |
| Both | Auto-detect plus convenience script | |

**User's choice:** Env-var auto-detect

| Option | Description | Selected |
|--------|-------------|----------|
| Docker optional for tests | README: Docker only for the server or real-Postgres tests | ✓ |
| Keep Docker as requirement | README unchanged | |

**User's choice:** Docker optional for tests

| Option | Description | Selected |
|--------|-------------|----------|
| In-memory | Fastest, nothing to clean | ✓ |
| You decide | Claude picks | |

**User's choice:** In-memory

---

## CI triggers & scope

| Option | Description | Selected |
|--------|-------------|----------|
| Push to any branch + PRs to main | CI on every push, PR status before merge | ✓ |
| PRs to main + push to main only | Fewer runs | |

**User's choice:** Push to any branch + PRs to main

| Option | Description | Selected |
|--------|-------------|----------|
| Node 22 only | Matches .nvmrc and engines | ✓ |
| Node 22 + 24 | Four jobs | |

**User's choice:** Node 22 only

| Option | Description | Selected |
|--------|-------------|----------|
| Not in this phase | Lint, typecheck, vitest only; conformance is phase 7 | ✓ |
| Add as optional third job | Start orglet and run both suites | |

**User's choice:** Not in this phase

---

## Import-mode fallback

| Option | Description | Selected |
|--------|-------------|----------|
| Tag tests to Postgres job only | Skip on pglite with reason, run in Docker job | ✓ |
| Change the mechanism | DEFERRABLE constraints or DROP/ADD | |
| You decide | Claude decides after the isolated check | |

**User's choice:** Tag tests to Postgres job only

| Option | Description | Selected |
|--------|-------------|----------|
| Runtime skip with reason | Test runs, calls skip on pglite, visible as skipped | ✓ |
| Separate file glob | Postgres-only files only the Docker job includes | |
| You decide | Claude picks | |

**User's choice:** Runtime skip with reason

| Option | Description | Selected |
|--------|-------------|----------|
| Dedicated test + note in TESTING.md | Small test plus dated outcome in the codebase map | ✓ |
| Just the test | Test is the documentation | |

**User's choice:** Dedicated test + note in TESTING.md

---

## Claude's Discretion

- Shared pglite instance via globalSetup vs one per test file (research disagrees)
- Shape and location of the test bootstrap helper
- Action pinning style, workflow file and job names, pnpm cache setup
- README wording and badge placement

## Deferred Ideas

- Conformance suites in CI (phase 7 or later, workflow_dispatch)
- Node 24 in the matrix
- Multi-connection concurrency tests (Postgres-only via the skip mechanism)
