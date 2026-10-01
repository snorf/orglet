---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 01-test-infrastructure-ci-03-PLAN.md
last_updated: "2026-10-01T07:55:14.886Z"
last_activity: 2026-10-01
progress:
  total_phases: 7
  completed_phases: 0
  total_plans: 4
  completed_plans: 3
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-29)

**Core value:** A Salesforce client pointed at orglet cannot tell the difference for the surface
orglet claims to support, and anything it does not support is logged as `UNSUPPORTED:<area>`
rather than faked.
**Current focus:** Phase 1 — Test Infrastructure & CI

## Current Position

Phase: 1 (Test Infrastructure & CI) — EXECUTING
Plan: 4 of 4
Status: Ready to execute
Last activity: 2026-10-01

Progress: [░░░░░░░░░░] 0%

## Performance Metrics

**Velocity:**

- Total plans completed: 0
- Average duration: -
- Total execution time: 0 hours

**By Phase:**

| Phase | Plans | Total | Avg/Plan |
|-------|-------|-------|----------|
| - | - | - | - |

**Recent Trend:**

- Last 5 plans: -
- Trend: -

*Updated after each plan completion*
| Phase 01-test-infrastructure-ci P02 | 2min | 2 tasks | 4 files |
| Phase 01-test-infrastructure-ci P01 | 11min | 3 tasks | 11 files |
| Phase 01-test-infrastructure-ci P03 | continuation | 3 tasks | 3 files |

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- Milestone 1 scope: hardening only (TYPEOF, roll-ups, thin baselines, key-prefix persistence, Bulk persistence, pglite, GitHub + CI) — no GUI, no Flows, no Apex.
- Persist custom-object key prefixes inside the org's own Postgres schema (`_orglet` internal schema) so `orglet reset` clears them by construction.
- pglite for tests, Docker Compose stays for the running server; no production code path depends on pglite.
- Roll-ups and all business rules recompute in the app-side save pipeline, never as Postgres triggers.
- [Phase 01-test-infrastructure-ci]: ci.yml copied verbatim from research (job keys test-pglite/test-postgres, no name: fields) so branch-protection ruleset status-check contexts match
- [Phase 01-test-infrastructure-ci]: No corepack enable step and no version: on pnpm/action-setup@v6 in CI; reads packageManager from package.json
- [Phase 01-test-infrastructure-ci]: D-19 resolved PASS (2026-09-30): session_replication_role and information_schema work correctly on pglite 0.5.8, no production or test-assertion workaround needed
- [Phase 01-test-infrastructure-ci]: Per-file embedded pglite instance (not a shared globalSetup instance) to avoid the pglite-socket single-query-queue serialization hazard across vitest's parallel forked workers
- [Phase 01-test-infrastructure-ci]: ci.yml step order corrected to install -> build -> lint -> test (both jobs); package exports resolve cross-package types from dist/index.d.ts, absent on a fresh checkout
- [Phase 01-test-infrastructure-ci]: snorf/orglet is public, main is default branch, gsd/phase-01-test-infrastructure-ci pushed with green CI (run 36832808542) on both test-pglite and test-postgres

### Pending Todos

None yet.

### Blockers/Concerns

- Phase 1: GitHub repo creation and first push are outward-facing actions requiring explicit confirmation with Johan at execution time.
- Phase 3: Key prefix and name-equivalent field for `IdeaTheme` (prefix, single-source) and `DandBCompany`/`Entitlement`/`ServiceContract`/`SocialPost` (name field, unconfirmed) need verification against the Object Reference before writing baseline JSON.
- Phase 4: Exact `FieldTypeof` AST shape from `@jetstreamapp/soql-parser-js` needs reading from its `.d.ts` during implementation; not verified during research.
- Phase 5: Roll-up reparent and undelete recompute triggers are not confirmed by a direct official Salesforce quote (scope is not in question, only edge-case sourcing).

## Session Continuity

Last session: 2026-10-01T07:55:14.882Z
Stopped at: Completed 01-test-infrastructure-ci-03-PLAN.md
Resume file: None
