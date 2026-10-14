---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: real-org fidelity
status: executing
stopped_at: Completed 10-05-PLAN.md
last_updated: "2026-10-14T14:32:59.705Z"
last_activity: 2026-10-14
progress:
  total_phases: 17
  completed_phases: 2
  total_plans: 25
  completed_plans: 23
  percent: 14
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-10-12)

**Core value:** A Salesforce client pointed at orglet cannot tell the difference for the surface
orglet claims to support, and anything it does not support is logged as `UNSUPPORTED:<area>`
rather than faked.
**Current focus:** Phase 10 — business-standard-objects

## Current Position

Milestone: v1.1 "real-org fidelity" (started 2026-10-12)
Phase: 10 (business-standard-objects) — EXECUTING
Plan: 6 of 6
Status: Ready to execute
Last activity: 2026-10-14

Progress: [█░░░░░░░░░] 14%

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
| Phase 06 P01 | 12min | 2 tasks | 3 files |
| Phase 06 P02 | 8min | 2 tasks | 4 files |
| Phase 06 P03 | 15min | 2 tasks | 5 files |
| Phase 06 P04 | 25min | 3 tasks | 6 files |
| Phase 06 P05 | 20min | 2 tasks | 7 files |
| Phase 06 P06 | n/a | 4 tasks | 2 files |
| Phase 07 P02 | 15min | 2 tasks | 3 files |
| Phase 07 P01 | 10min | 2 tasks | 5 files |
| Phase 07 P03 | n/a | 3 tasks | 1 files |
| Phase 07 P04 | 15min | 2 tasks | 3 files |
| Phase 07 P06 | 20min | 3 tasks | 7 files |
| Phase 08 P01 | 15min | 2 tasks | 3 files |
| Phase 08 P04 | 15min | 3 tasks | 6 files |
| Phase 08 P02 | 12min | 2 tasks | 13 files |
| Phase 08 P08 | 15min | 2 tasks | 0 files |
| Phase 08 P03 | 15min | 2 tasks | 7 files |
| Phase 08 P09 | 10min | 3 tasks | 0 files |
| Phase 08 P10 | 15min | 3 tasks | 1 files |
| Phase 08 P05 | 20min | 3 tasks | 11 files |
| Phase 08 P06 | 10min | 2 tasks | 8 files |
| Phase 08 P07 | 10min | 2 tasks | 4 files |
| Phase 09 P01 | 20min | 3 tasks | 12 files |
| Phase 09 P03 | 31min | 2 tasks | 41 files |
| Phase 09 P04 | 14min | 3 tasks | 44 files |
| Phase 09 P05 | 10min | 2 tasks | 9 files |
| Phase 09 P06 | 17min | 1 tasks | 6 files |
| Phase 09 P07 | 17min | 3 tasks | 51 files |
| Phase 09 P08 | 14min | 2 tasks | 21 files |
| Phase 09 P09 | 6min | 1 tasks | 4 files |
| Phase 10 P02 | 15min | 2 tasks | 6 files |
| Phase 10 P01 | 25min | 2 tasks | 9 files |
| Phase 10 P04 | 35min | 3 tasks | 100 files |
| Phase 10 P05 | 25min | 2 tasks | 9 files |

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
- [Phase 06]: 06-01: DmlTransaction seam; DML joins caller transaction via SAVEPOINT dml_run, events published after outer COMMIT; import-mode replica role lasts until caller txn ends
- [Phase 06]: 06-02: Bulk query rejection wording is orglet's own (guide documents no error shape); WHERE semi-joins now accepted; parser strips FROM alias itself
- [Phase 06]: 06-03: setJobState is sole state writer (TRANSITIONS table); retention basis created_date, 7 days hard-coded; reconcile fails UploadComplete/InProgress with locked ServerRestarted messages
- [Phase 06]: Bulk ingest processing errors roll back the chunk and set job Failed with InternalServerError message; DELETABLE.ingest includes UploadComplete
- [Phase 06]: Bulk query rejection wording is orglet's own (undocumented by Salesforce); semi-joins accepted; query abort from UploadComplete/InProgress, delete from JobComplete/Aborted/Failed
- [Phase 07]: 07-01: --strict only affects check; Bulk sf__Error format is 'CODE:message:fields --'
- [Phase 07]: 07-03: empty Bulk 2.0 upload and Jigsaw* tests excluded as not-implemented, upsert-without-Id as test-defect; no orglet code change (07-04 branch B)
- [Phase 08]: 08-02: KeyPrefixProvenance type name; validateBaseline hard-fails in buildOrgSchema; m0 custom-metadata guard is a conservative assumption
- [Phase 08]: 08-08: sigha unary ! and Owner:User colon branches prepared locally in sigha-upstream (reuse NOT builtin; colon absorbed in scanIdentifier); nothing pushed
- [Phase 09]: 09-03: BusinessProcess is documented in the Object Reference as 'Business Process' and is extracted; NOT_IN_PDF is empty
- [Phase 09]: 09-03: PDF field-table labels are matched by text, not column position (bulleted field groups shift the details column); Limit: N characters also yields maxLength
- [Phase 09]: 09-04: 20 of 35 v1.0 files were not code-unit sorted; D-19 sort applied, parity test compares fields by name; reformat is whitespace plus field order, no content change
- [Phase 09]: 09-04: combobox -> Picklist, id skipped, Restricted picklist -> restrictedPicklist; 19 v1.0 fields kept via overrides keep entries, no keepObject (BusinessProcess is in the PDF)
- [Phase 09]: diffGate compares sqlTypeFor output with migrate()'s exported isWidening, so the gate and migrate() share one definition of narrowing (MIGR-03)
- [Phase 09]: MasterDetail refusal lives in pipeline.ts after pins and overrides; 'existed in v1.0' = object has a v1-pins entry, 'new' = no field pin; allowlist is never consulted
- [Phase 09]: 09-06: a new Lookup whose Refers To neither source states is skipped and reported as reference-target (none stated), never aborted; v1.0 fields keep the abort
- [Phase 09]: 09-06: Checkbox is exempt from the forced-nullable rule (engine defaults an absent Checkbox to false before the required check; v1.0 writes nillable:false on 65/80 Checkboxes)
- [Phase 09]: 09-06: system names excluded case-insensitively and emitted case collisions abort (columnName lower-cases); length conflicts on new fields settled by the larger value via 12 overrides
- [Phase 09]: 09-06 checkpoint: settle-conflicts, name rule for target-less lookups (13 fields via overrides set referenceTo in 09-07); accepted skip ratio 10.1% documented (83/818), 12.1% raw (99/818)
- [Phase 09]: 09-07: a sf-skills field_reference label ending a sentence or over 80 chars is prose; the generator emits the humanised name as guessed (87 Profile Permissions* labels)
- [Phase 09]: 09-07: pinned v1.0 names are always in the generator inventory, so a field both sources dropped aborts in full mode too
- [Phase 09]: 09-07: SKIP_RATIO_MAX 0.103 (84/818 documented; Product2.RecordTypeId is field_reference-only so Johan's 83 was off by one; raw 99/818 matches) - Johan to confirm
- [Phase 09]: 09-07: Postgres test leg runs vitest maxWorkers 3; a v2 org schema (~500 relations, ~190 FKs) in one migrate() transaction exhausted the default lock table with 10 parallel files
- [Phase 09]: 09-07: BASE2-02 and BASE2-03 ticked under amended wording (D-10); BASE2-01 left for 09-08 (ownerTargets overrides)
- [Phase 09]: 09-08: ownerTargets derived from both sources' OwnerId Refers To restricted to User/Group; override wins and is reported override-resolved; a missing or unmodelled target (Calendar, Organization) without an override aborts instead of being dropped by intersection
- [Phase 09]: 09-08: ownerTargets written only when narrower than [Group, User]; 8 objects User-only (Event by override), 8 stay polymorphic (Group, ServiceContract by override)
- [Phase 09]: 09-08: BASE2-01 ticked (owner targets now in overrides.json); BASE2-04 left pending for 09-09 (wording names unmodelled objects and Calendar on Event; poly-check re-run)
- [Phase 09]: 09-09: D-14 scenario lives in upgrade-owner.test.ts with its own schema so upgrade.test.ts EXPECTED_WARNINGS stays []; the Group-owned Account warns exactly once and the FK lands silently after correction
- [Phase 09]: 09-09: BASE2-04 wording amended to the 35 modelled objects (8 User-only incl. Event by D-12 override, 8 polymorphic incl. Group by override, 19 without OwnerId, Phase 10 forward clause) and ticked; conformance 8/8 PASS locally, poly-check 4/4 both legs
- [Phase 10]: 10-02: unreferenced unmodelled standard objects go to BuildResult.info and one quiet-gated info: line in check; warnings/diagnostics stay 1:1; --strict ignores it
- [Phase 10]: 10-01: de-describe key prefix source accepted with a ref (intentional reversal of the Phase 9 D-07 guard per D-01); rule 4 forced-nullable limited to objects with v1 pins (D-18)
- [Phase 10]: 10-03: OpportunitySplit 049 and all 18 prefixes confirmed from the author's own DE describe (no D-02); four labelPlural and the OpportunitySplit name field corrected from DE; ContentVersion.ContentDocumentId nullable override accepted as a stopgap, full file upload tracked as backlog 999.10
- [Phase 10]: 10-04: duplicate-spelling skips go on the field_reference-only spelling; Entitlement lookup on documented LocationID, OrderItem on RelatedOrderItemID
- [Phase 10]: 10-04: OpportunitySplit.Split generated as AutoNumber name field; merge added to known Supported Calls
- [Phase 10]: 10-04 fix: field names take the SDK (field_reference/describe) spelling where the Object Reference differs only by case; renameFrom override for PDF spellings without a twin (Quote.RecordTypeId, AccountTeamMember.PhotoUrl); DE describe 2026-10-14 is the evidence
- [Phase 10]: 10-05: OrderItem.QuoteLineItemId and RelatedOrderItemId overridden nillable:true (sf-skills required flag contradicts its own descriptions; OrderItem was uninsertable); engine/REST behaviour of the 18 proven without production code change

### Pending Todos

- Support Relationship:Object.Field colon syntax for polymorphic formula references (formula, 2026-10-08)
- v1.0 audit tech debt (see milestones/v1.0-MILESTONE-AUDIT.md): combined Bulk-ingest + roll-up test;
  roll-up re-backfill todo; refresh 04-VERIFICATION.md status after UAT; VALIDATION.md maps; make the
  `conformance` CI job required on main (ruleset change, Johan's call)

### Blockers/Concerns

- None open. The phase 3-5 research concerns were resolved during their phases (baseline facts confirmed
  in 03-RESEARCH, TYPEOF AST read in 04-02, reparent/undelete recompute implemented without a primary
  quote — documented in 05-07-SUMMARY).

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 261012-leq | Treat an empty metadata root (`<CustomObject/>`) as an empty node; name the object file in parse errors | 2026-10-12 | 3a7898f | [261012-leq-fix-parsemetadataxml-so-an-empty-metadat](./quick/261012-leq-fix-parsemetadataxml-so-an-empty-metadat/) |

## Session Continuity

Last session: 2026-10-14T14:32:59.702Z
Stopped at: Completed 10-05-PLAN.md
Resume file: None
