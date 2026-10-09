---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: verifying
stopped_at: 05-07 Tasks 1-2 done; awaiting Task 3 devrandom checkpoint
last_updated: "2026-10-09T08:14:40.830Z"
last_activity: 2026-10-09
progress:
  total_phases: 7
  completed_phases: 5
  total_plans: 25
  completed_plans: 25
  percent: 0
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-09-29)

**Core value:** A Salesforce client pointed at orglet cannot tell the difference for the surface
orglet claims to support, and anything it does not support is logged as `UNSUPPORTED:<area>`
rather than faked.
**Current focus:** Phase 05 — roll-up-summary-fields

## Current Position

Phase: 05 (roll-up-summary-fields) — EXECUTING
Plan: 7 of 7
Status: Phase complete — ready for verification
Last activity: 2026-10-09

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
| Phase 04 P07 | 20min | 2 tasks | 5 files |
| Phase 05 P01 | 5 min | 2 tasks | 7 files |
| Phase 05 P02 | 8 min | 2 tasks | 3 files |
| Phase 05 P03 | 9 min | 2 tasks | 5 files |
| Phase 05 P04 | 8 min | 2 tasks | 12 files |
| Phase 05 P05 | 9 min | 2 tasks | 3 files |
| Phase 05 P06 | 8 min | 2 tasks | 2 files |
| Phase 05 P07 | 10 min | 2 tasks | 5 files |

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
- [Phase 04]: POLY-01 recorded Partial (formula leg deferred per D-16); POLY-02..06 complete
- [Phase 05]: No Summary member in FieldType; resolved roll-up is a typed FieldDef carrying rollup — Keeps exhaustive switches in formula/schema intact
- [Phase 05]: Roll-up resolver runs after both merge loops and before the dangling-reference pass; resolved roll-ups are pushed onto SObjectDef.fields so chains resolve in a fixpoint loop (rollup-cycle when stalled)
- [Phase 05]: Roll-up filter on a child roll-up field or any valueField problem is rollup-filter; unknown filter field is rollup-target; date literals in roll-up filters deferred with a rollup-filter warning
- [Phase 05]: ROLL-03/06/09 not marked complete by 05-02: load halves only; computation (05-03+) and the DE retrieve check (05-07) finish them
- [Phase 05]: Roll-up SQL builder lives in @orglet/schema as correlated scalar subqueries (COUNT(*), COALESCE(SUM,0), plain MIN/MAX) with every literal a typed positional parameter; same expression serves engine SELECT and migrate UPDATE
- [Phase 05]: migrate backfill of new roll-up columns is the last step of the transaction: a second UPDATE of a row in one transaction queues a deferred FK check and Postgres refuses DDL on that table until commit (pending trigger events)
- [Phase 05]: ROLL-03 marked complete by 05-03 (aggregates and all operators computed on both backends); ROLL-06 and ROLL-08 withheld until engine recompute (05-05) and SOQL surface (05-06)
- [Phase 05]: 05-04: roll-up fixture lives in examples/acme (blast-radius gate passed); describe calculated covers roll-ups; ROLL-08/09 withheld
- [Phase 05]: 05-05: D-03 attribution via SAVEPOINT rollup_batch with bounded replay of surviving children; per-parent SAVEPOINT rollup_parent kept around the parent UPDATE and after-hooks
- [Phase 05]: 05-05: roll-up recompute is SELECT-first (rollupSelectSql per parent object and chain level), writes only changed columns, skips unchanged parents (no hooks/rules), stamps no LastModifiedDate and publishes no ChangeBus event
- [Phase 05]: 05-05: ROLL-05 and ROLL-06 marked complete (chain Milestone->Project->Account proven); ROLL-04 withheld until 05-06 wires delete/undelete
- [Phase 05]: 05-06: deleteBatch carries a deleting skip set through the cascade (new Set([...deleting, ...ids])) so a parent being deleted is never recomputed, rule-checked or hooked; undeleteBatch recomputes with NO_IDS because the parent is made live before its children recompute
- [Phase 05]: 05-06: ROLL-04 and ROLL-08 marked complete; reparent and undelete recompute triggers implemented per ROLL-04 without a primary Salesforce quote (ROADMAP research flag, note for verify-work); ROLL-09 stays with 05-07
- [Phase 05]: 05-07: rollup-check SDK legs reuse describe-check venv; ROLL-09 left open until Johan's devrandom checkpoint

### Pending Todos

- Reword ROADMAP phase 7 to validate against the DE retrieve, not the org (planning, 2026-10-01)

### Blockers/Concerns

- Phase 3: Key prefix and name-equivalent field for `IdeaTheme` (prefix, single-source) and `DandBCompany`/`Entitlement`/`ServiceContract`/`SocialPost` (name field, unconfirmed) need verification against the Object Reference before writing baseline JSON.
- Phase 4: Exact `FieldTypeof` AST shape from `@jetstreamapp/soql-parser-js` needs reading from its `.d.ts` during implementation; not verified during research.
- Phase 5: Roll-up reparent and undelete recompute triggers are not confirmed by a direct official Salesforce quote (scope is not in question, only edge-case sourcing).

## Session Continuity

Last session: 2026-10-09T08:14:40.827Z
Stopped at: 05-07 Tasks 1-2 done; awaiting Task 3 devrandom checkpoint
Resume file: None
