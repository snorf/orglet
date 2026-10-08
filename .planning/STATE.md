---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: Completed 04-06-PLAN.md
last_updated: "2026-10-08T21:22:23.417Z"
last_activity: 2026-10-08
progress:
  total_phases: 7
  completed_phases: 3
  total_plans: 18
  completed_plans: 17
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-29)

**Core value:** A Salesforce client pointed at orglet cannot tell the difference for the surface
orglet claims to support, and anything it does not support is logged as `UNSUPPORTED:<area>`
rather than faked.
**Current focus:** Phase 04 — polymorphic-lookups-soql-typeof

## Current Position

Phase: 04 (polymorphic-lookups-soql-typeof) — EXECUTING
Plan: 7 of 7
Status: Ready to execute
Last activity: 2026-10-08

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
| Phase 01-test-infrastructure-ci P04 | 11min | 2 tasks | 1 files |
| Phase 02-custom-object-key-prefix-persistence P01 | 8min | 2 tasks | 4 files |
| Phase 02-custom-object-key-prefix-persistence P02 | 6min | 2 tasks | 5 files |
| Phase 02-custom-object-key-prefix-persistence P03 | 6min | 3 tasks | 1 files |
| Phase 03 P01 | 8min | 2 tasks | 19 files |
| Phase 03 P02 | 12min | 3 tasks | 7 files |
| Phase 03 P03 | 10min | 2 tasks | 5 files |
| Phase 03 P04 | n/a | 3 tasks | 4 files |
| Phase 04 P01 | 10min | 2 tasks | 7 files |
| Phase 04 P02 | 40min | 1 tasks | 3 files |
| Phase 04 P03 | 10min | 2 tasks | 4 files |
| Phase 04 P04 | 7min | 3 tasks | 6 files |
| Phase 04 P05 | 8min | 3 tasks | 7 files |
| Phase 04 P06 | 12min | 2 tasks | 5 files |

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
- [Phase 01-test-infrastructure-ci]: Ruleset 'require CI on main' (id 24295978) active on snorf/orglet main: pull_request + required_status_checks (test-pglite, test-postgres), strict policy true, bypass_actors empty
- [Phase 01-test-infrastructure-ci]: PR snorf/orglet#1 (gsd/phase-01-test-infrastructure-ci -> main) open with both required checks green; not merged, awaiting Johan after /gsd:verify-work
- [Phase 02-custom-object-key-prefix-persistence]: Task 2 stubs as non-async functions returning Promise.reject so @typescript-eslint/require-await stays green between TDD tasks
- [Phase 02-custom-object-key-prefix-persistence]: PREFIX-04 not marked complete by plan 02-01: storage half done (rows survive DROP SCHEMA, dropKeyPrefixes per org), CLI half (check/reset --drop-prefixes) is plan 02-02
- [Phase 02-custom-object-key-prefix-persistence]: BigTable__c.Name is an AutoNumber: record-seeding tests insert it with no fields (plan fixture { Name } was rejected by the engine)
- [Phase 02-custom-object-key-prefix-persistence]: reconcileKeyPrefixes runs before migrate (D-04) so a prefix conflict on a fresh database leaves no tables behind
- [Phase 02-custom-object-key-prefix-persistence]: KeyPrefixError in the CLI prints error: <message> plus one hint line and returns 1 without pool.end(), mirroring the Postgres-unreachable branch
- [Phase 02-custom-object-key-prefix-persistence]: The --key-prefixes file is read and validated before createPool so a bad file fails without touching the database
- [Phase 02-custom-object-key-prefix-persistence]: devrandom checkpoint approved 2026-10-02; both custom tables empty so the seed source was `provisional`, values identical to the old scheme
- [Phase 03]: Thin objects carry only name field, system fields, OwnerId when owned plus D-07 seed fields; flags explicit per JSON, no thin switch
- [Phase 03]: BusinessHours and BusinessProcess are create/update only, no delete; REQUIREMENTS and ROADMAP corrected (D-04)
- [Phase 03]: Object-flag violations return INVALID_TYPE_FOR_OPERATION (was INVALID_OPERATION); REST status stays 400; upsert needs createable+updateable, undelete needs undeletable
- [Phase 03]: Import mode bypasses object flags (D-08) via one DmlEngine.refuse() guard
- [Phase 03]: Bootstrap seeds Default BusinessHours and Salesforce UserLicense through Store, links admin profile only while UserLicenseId is NULL
- [Phase 03]: migrate() wraps FK 23503 into an error naming table, column and target; no NOT VALID
- [Phase 03]: SDK describe key sets live once in conformance/describe-check/contract.json, read by vitest and plan 03-04 scripts
- [Phase 03]: idEnabled added to describe summaries; only jsforce key orglet omitted
- [Phase 03]: devrandom upgrade approved 2026-10-08: 14 tables added, seed rows created once, FKs added without dangling-data errors, second start silent
- [Phase 04]: loadParents stops at a polymorphic parent and gates on referenceTo.length > 1; one matchTargetByPrefix helper shared by write and read paths
- [Phase 04]: TYPEOF parse errors diagnosed by text heuristic; child-subquery TYPEOF gated UNSUPPORTED:polymorphic-subquery
- [Phase 04]: Formula: polymorphism gated on declared referenceTo.length > 1; colon syntax classified UNSUPPORTED:formula from sigha's unexpected-character diagnostic (D-16 gap)
- [Phase 04]: Owner.Type is answered by the Id-prefix CASE before any column lookup so Group's own Type column never leaks
- [Phase 04]: Polymorphic parent shape carries type '' and takes attributes.type from the per-row typeAlias column; a row without one is a null parent (D-02, D-19)
- [Phase 04]: TYPEOF: a WHEN naming a declared but unmodelled target is dropped at compile time (D-13); Type inside WHEN Group is Group's own column
- [Phase 04]: TYPEOF: an unmodelled prefix is a null parent with or without ELSE, never a synthetic object (D-19); onUnmodelledPrefix fires once per row
- [Phase 04]: QueryPage.warnings is absent when nothing degraded; REST route logs it once per query via req.log.warn

### Pending Todos

- Reword ROADMAP phase 7 to validate against the DE retrieve, not the org (planning, 2026-10-01)

### Blockers/Concerns

- Phase 3: Key prefix and name-equivalent field for `IdeaTheme` (prefix, single-source) and `DandBCompany`/`Entitlement`/`ServiceContract`/`SocialPost` (name field, unconfirmed) need verification against the Object Reference before writing baseline JSON.
- Phase 4: Exact `FieldTypeof` AST shape from `@jetstreamapp/soql-parser-js` needs reading from its `.d.ts` during implementation; not verified during research.
- Phase 5: Roll-up reparent and undelete recompute triggers are not confirmed by a direct official Salesforce quote (scope is not in question, only edge-case sourcing).

## Session Continuity

Last session: 2026-10-08T21:22:23.409Z
Stopped at: Completed 04-06-PLAN.md
Resume file: None
