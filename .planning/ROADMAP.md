# Roadmap: orglet — Milestone 1 (hardening)

## Overview

Phase 0 (headless Salesforce-compatible API on Postgres) is complete and validated. This
milestone hardens it: make a real Developer Edition retrieve load with zero `UNSUPPORTED`
warnings, make the project buildable and testable without Docker, and put it on GitHub with CI.
The seven phases below follow the build order `research/SUMMARY.md` recommends: infrastructure first (so
new feature work lands on a Docker-free, CI-gated baseline), two small self-contained wins
(stable key prefixes, then thin standard-object baselines), the two harder engine-pipeline
changes (polymorphic lookups/TYPEOF, then roll-up summary fields, in that order because TYPEOF's
fix touches the same parent-loading code roll-ups also need), the most isolated feature last
before acceptance (Bulk API 2.0 persistence), and a final conformance re-run that validates the
sum of all six changes against Johan's real Developer Edition org and both SDK conformance
suites.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Test Infrastructure & CI** - Full test suite runs Docker-free via pglite; project is on GitHub with two CI jobs (completed 2026-10-01)
- [x] **Phase 2: Custom-Object Key-Prefix Persistence** - Custom object key prefixes are stable across reload and rename (completed 2026-10-02)
- [x] **Phase 3: Thin Standard-Object Baselines** - The 14 missing standard objects exist as reference-checkable baselines (completed 2026-10-08)
- [x] **Phase 4: Polymorphic Lookups & SOQL TYPEOF** - Polymorphic reads agree with the write path; TYPEOF compiles (completed 2026-10-08)
- [ ] **Phase 5: Roll-Up Summary Fields** - Summary fields load, recompute correctly, and are read-only
- [ ] **Phase 6: Bulk API 2.0 Persistence** - Bulk jobs and results survive a server restart
- [ ] **Phase 7: Conformance Re-Run & Milestone Acceptance** - Zero warnings on Johan's DE org; both conformance suites green and documented

## Phase Details

### Phase 1: Test Infrastructure & CI
**Goal**: Unit and integration tests run without Docker via embedded pglite, the one genuinely
open compatibility question (`session_replication_role` under the pinned pglite version) is
resolved early and explicitly, and the project is live on GitHub with CI enforcing lint,
typecheck and the full test suite — against both pglite and real Postgres — on every push.
**Depends on**: Nothing (first phase)
**Requirements**: INFRA-01, INFRA-02, INFRA-03, INFRA-04, INFRA-05, INFRA-06, INFRA-07
**Success Criteria** (what must be TRUE):
  1. `pnpm test` runs the full unit and integration suite on a machine without Docker installed, Postgres-backed tests running against embedded pglite through the existing `pg` pool.
  2. An early, isolated test confirms whether import mode's `SET LOCAL session_replication_role = replica` and the `information_schema`-based schema differ work correctly under the pinned pglite version; the result (pass, or an explicit real-Postgres-only tag with the reason recorded) is settled before later phases add more Postgres-backed tests on top.
  3. `orglet up` and the Docker Compose path continue to run against real Postgres 16, unaffected by the pglite test path.
  4. The project is live in a public GitHub repository under Johan's personal account with the repo-local git identity, its name and first push explicitly confirmed with Johan beforehand.
  5. GitHub Actions runs lint, typecheck and the full suite on every push/PR in two jobs — one against pglite, one against a Postgres 16 service container — and neither job ever invokes `scripts/sync-sigha.sh`.
**Plans**: 4 plans
Plans:
- [x] 01-01-PLAN.md — pglite test backend (`test/db.ts`), D-19 compat test recorded first, five DB-backed files migrated, 5433 default moved to CLI
- [x] 01-02-PLAN.md — `.github/workflows/ci.yml` (test-pglite, test-postgres), README badge + Docker-optional docs, .env.example/compose comments
- [x] 01-03-PLAN.md — local pre-flight on both backends + `orglet up` smoke, Johan-confirmed repo creation and pushes, first CI run green
- [x] 01-04-PLAN.md — Johan-confirmed ruleset on main, phase PR opened (not merged)
**Research flag**: yes — verify `session_replication_role` and `information_schema` behavior against the pinned `pglite@0.5.8` directly; treated by research as genuinely unresolved, not settled.

### Phase 2: Custom-Object Key-Prefix Persistence
**Goal**: A custom object's key prefix is assigned once and persisted, so adding, removing or
renaming custom objects never shifts the Id-meaning of existing records.
**Depends on**: Phase 1
**Requirements**: PREFIX-01, PREFIX-02, PREFIX-03, PREFIX-04
**Success Criteria** (what must be TRUE):
  1. A custom object's key prefix, once assigned on first `orglet up`, is unchanged across two consecutive reloads even when other custom objects are added, removed or renamed in between.
  2. An org database whose prefixes were previously assigned by the old alphabetical scheme keeps those exact assignments as its initial persisted state on first upgrade.
  3. Assigning a prefix that would collide with a standard-object prefix or another custom object's persisted prefix fails the load with a clear error instead of silently overlapping.
  4. `orglet check` (no database) labels any prefix it reports as provisional, and `orglet reset` preserves persisted prefix assignments unless the user explicitly asks to drop them.
**Plans**: 3 plans
Plans:
- [x] 02-01-PLAN.md — `@orglet/schema` prefix module: `internal.ts` (ensureInternalSchema), `prefixes.ts` (KeyPrefixError, pure two-pass planKeyPrefixes, parseKeyPrefixMapping, reconcileKeyPrefixes, dropKeyPrefixes), `prefixes.test.ts` (T1-T8, T10, T12)
- [x] 02-02-PLAN.md — CLI wiring (`up` reconcile + `--key-prefixes`, `check` provisional lines, `reset --drop-prefixes`, KeyPrefixError catch, USAGE) + `main.test.ts` (T9), `build.ts` doc comment, README section
- [x] 02-03-PLAN.md — API describe assertion (T11), full suite on pglite + Docker Postgres, acme CLI smoke sequence, Johan's devrandom checkpoint

### Phase 3: Thin Standard-Object Baselines
**Goal**: The 14 standard objects a Developer Edition references but the baseline lacks exist as
correctly-described, reference-checkable baseline objects with documented DML restrictions.
**Depends on**: Phase 2
**Requirements**: BASE-01, BASE-02, BASE-03, BASE-04, BASE-05
**Success Criteria** (what must be TRUE):
  1. All 14 named objects (BusinessHours, BusinessProcess, CallCenter, DandBCompany, Entitlement, ExternalDataSource, IdeaTheme, Individual, OperatingHours, OpportunityHistory, ServiceAppointment, ServiceContract, SocialPost, UserLicense) exist as baseline objects with their documented key prefix, name-equivalent field and system fields.
  2. A lookup pointing at any of the 14 objects with an invalid Id is rejected on save with `INVALID_CROSS_REFERENCE_KEY` instead of being accepted unchecked.
  3. DML against each of the 14 objects respects its documented createable/updateable/deletable flags (ExternalDataSource, OpportunityHistory and UserLicense read-only; CallCenter create-only; BusinessHours and BusinessProcess create/update only, no delete; the rest full CRUD), rejected with the correct Salesforce error code when violated.
  4. `describe()` for each thin object, exercised through both `jsforce` and `simple-salesforce`, returns everything those SDKs read (`keyPrefix`, `nameField`/`name`, `urls`, `fields[]`, `childRelationships[]`) without error.
  5. Loading Johan's Developer Edition retrieve produces zero `UNSUPPORTED:reference-target` warnings.
**Plans**: 4 plans
Plans:
- [x] 03-01-PLAN.md — 14 thin baseline JSON files (explicit flags), `build.test.ts` T1/T2 + name-field invariant, `main.test.ts` T3, `prefixes.test.ts` T12, BASE-03 wording fix
- [x] 03-02-PLAN.md — `Errors.invalidTypeForOperation` + object-flag guard for all five DML operations with import-mode bypass (T4/T5/T7/T8), bootstrap seed rows (`bootstrap.test.ts` T9), `migrate()` dangling-FK error (T13)
- [x] 03-03-PLAN.md — describe `idEnabled`, shared `conformance/describe-check` contract, `api.test.ts` T10 describe contract + T11 REST write protection, README section
- [x] 03-04-PLAN.md — describe-check scripts (jsforce, simple-salesforce), full suite both backends, M1/M2/M3, Johan's devrandom checkpoint
**Research flag**: yes — confirm per-object key prefix and name-equivalent field against the Object Reference before writing each of the 14 JSON baselines; `IdeaTheme`'s prefix and `DandBCompany`/`Entitlement`/`ServiceContract`/`SocialPost`'s name fields are single-source or unconfirmed per research.

### Phase 4: Polymorphic Lookups & SOQL TYPEOF
**Goal**: A polymorphic lookup resolves its target object per row — in SOQL joins, row shaping
and formula parent traversal — in agreement with the already-correct write path, and SOQL
`TYPEOF` and `<relationship>.Type` filtering work per the documented grammar.
**Depends on**: Phase 3
**Requirements**: POLY-01, POLY-02, POLY-03, POLY-04, POLY-05, POLY-06
**Success Criteria** (what must be TRUE):
  1. For a polymorphic lookup such as `OwnerId`, a SOQL parent-field query result, that same row's `attributes.type`, and a formula referencing the parent all agree on the concrete target object (e.g. `Group`, not just the first-defined `User`) for the same fixture row.
  2. A polymorphic parent field that doesn't exist on the row's concrete object is returned as `null` rather than erroring.
  3. A polymorphic value whose key prefix matches no modelled object degrades to a `null` parent (or the `ELSE` branch in TYPEOF) instead of throwing.
  4. `SELECT TYPEOF <field> WHEN <Object> THEN <fields> [WHEN ...] [ELSE <fields>] END` compiles and returns the matching branch's fields shaped per row, and `<relationship>.Type` is filterable in `WHERE` as a string comparison against the concrete object name.
  5. The documented invalid TYPEOF forms (in `WHERE`, `GROUP BY`, `HAVING`, inside a semi-join, functions in `WHEN`, nested TYPEOF, with `COUNT()`) are rejected with a `MALFORMED_QUERY` error naming the restriction.
**Plans**: 7 plans
Plans:
- [x] 04-01-PLAN.md — Shared `matchTargetByPrefix` helper; checkReferences and loadParents use it (wave 1)
- [x] 04-02-PLAN.md — POLY-06: invalid TYPEOF forms rejected as MALFORMED_QUERY naming the restriction (wave 1)
- [x] 04-03-PLAN.md — Formula half of POLY-01 as the D-16 fallback; sigha and OwnerId todos (wave 1)
- [x] 04-04-PLAN.md — Polymorphic joins per target, Name pseudo-object, `<rel>.Type`, per-row attributes.type (wave 2)
- [x] 04-05-PLAN.md — TYPEOF compile and per-row branch shaping (wave 3)
- [x] 04-06-PLAN.md — Unmodelled-prefix warning plumbing, SC1 three-way and D-13 tests, REST log line (wave 4)
- [x] 04-07-PLAN.md — jsforce + simple-salesforce poly-check against live orglet; both backends green (wave 5)
**Research flag**: yes — read the exact `FieldTypeof` AST shape from `@jetstreamapp/soql-parser-js`'s `.d.ts` during implementation, and confirm parser AST coverage for `WHERE <rel>.Type = '...'` independently of `TYPEOF`.

### Phase 5: Roll-Up Summary Fields
**Goal**: `Summary` fields load from metadata, recompute correctly in the app-side save pipeline
across every child mutation path (including reparent and undelete), and are read-only and
queryable like any other field.
**Depends on**: Phase 4
**Requirements**: ROLL-01, ROLL-02, ROLL-03, ROLL-04, ROLL-05, ROLL-06, ROLL-07, ROLL-08, ROLL-09
**Success Criteria** (what must be TRUE):
  1. `Summary` fields load from SFDX metadata (`summarizedField`, `summaryForeignKey`, `summaryOperation`, `summaryFilterItems`) with the parent field typed correctly (Number for COUNT; the summarized field's own type for SUM/MIN/MAX), and a roll-up defined over a lookup (not master-detail) relationship fails metadata load with a clear error.
  2. COUNT, SUM, MIN and MAX recompute correctly with the documented filter operators (including field-to-field comparisons) over non-deleted children, triggered by every child insert, update (including a filter-only field change), delete, undelete and reparent — with both the old and new parent recomputed on reparent.
  3. Multi-level master-detail chains recompute upward without infinite recursion, and a partial-success batch's roll-up value reflects only the children that actually committed (recompute happens inside the triggering child's savepoint).
  4. Roll-up fields are read-only via REST and Bulk (`createable: false`, `updateable: false`, `calculated: true` in describe) and are selectable, filterable and sortable in SOQL like any other stored field.
  5. Loading Johan's Developer Edition retrieve produces zero `UNSUPPORTED:field-type` warnings for `Summary` fields.
**Plans**: 7 plans
Plans:
- [x] 05-01-PLAN.md — RollupDef contracts, Summary parsing (array-safe filter values), filter-value tokenizer
- [x] 05-02-PLAN.md — resolveRollups: types, D-05 whitelist / D-08 lookup failure, D-06/D-07 warnings, chains/cycles, DE-shaped proxy
- [x] 05-03-PLAN.md — roll-up SQL builder in @orglet/schema, migrate() backfill of new roll-up columns (D-10)
- [x] 05-04-PLAN.md — acme roll-up fixture chain + parent rule, describe `calculated`, REST/Bulk read-only tests
- [x] 05-05-PLAN.md — engine recompute on insert/update/upsert with parent rules and hooks, batch replay for D-03, D-04 defaults, D-09
- [x] 05-06-PLAN.md — delete/undelete recompute (cascade-safe), chain and filter-operator integration, SOQL over roll-ups
- [ ] 05-07-PLAN.md — phase gate: both backends, jsforce + simple-salesforce rollup-check, DE check, devrandom checkpoint
**Research flag**: yes — reparent and undelete recompute triggers are logically implied by Salesforce's documented behavior but not confirmed by a direct official quote; verify against Salesforce Help article `000391766` or equivalent before finalizing edge-case mechanics (scope itself is not in question).

### Phase 6: Bulk API 2.0 Persistence
**Goal**: Bulk ingest and query jobs, their uploaded data and their results persist in Postgres
and survive a server restart, with the documented state machine, retention and query
restrictions preserved.
**Depends on**: Phase 5
**Requirements**: BULK-01, BULK-02, BULK-03, BULK-04, BULK-05
**Success Criteria** (what must be TRUE):
  1. Ingest and query jobs, uploaded CSV data and results persist in Postgres and are retrievable through the same endpoints after a server restart.
  2. The documented ingest state machine (Open → UploadComplete → InProgress → JobComplete | Failed | Aborted; query jobs start in UploadComplete) is preserved, only `UploadComplete` and `Aborted` are settable by the client, and any job left `InProgress` when the server restarts is reconciled to `Failed` on boot.
  3. `successfulResults`, `failedResults` and `unprocessedrecords` return correctly formatted CSV (`sf__Id`, `sf__Created`, `sf__Error`) from persisted results, and jobs older than 7 days are purged.
  4. A Bulk query job rejects SOQL that Bulk API 2.0 doesn't support (TYPEOF, GROUP BY, OFFSET, aggregates, compound fields, child subqueries) with the documented error, using a rule set kept separate from REST SOQL.
**Plans**: TBD

### Phase 7: Conformance Re-Run & Milestone Acceptance
**Goal**: The milestone's acceptance bar is verified directly against Johan's real Developer
Edition org and both SDK conformance suites, with results committed and dated.
**Depends on**: Phase 6
**Requirements**: ACCEPT-01, ACCEPT-02, ACCEPT-03
**Success Criteria** (what must be TRUE):
  1. `orglet check` against Johan's Developer Edition retrieve reports zero `UNSUPPORTED` warnings of any kind (baseline 2026-09-29: 15).
  2. The `simple-salesforce` conformance script and the `jsforce` e2e subset are both re-run after all milestone changes and stay green, with previously-excluded Bulk tests classified (v1-still-excluded vs v2-now-included) and included where Bulk API 2.0 now covers them.
  3. Both `conformance/` READMEs are updated with current, dated pass/fail/excluded numbers and the reason for every remaining exclusion.
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Test Infrastructure & CI | 3/4 | Complete    | 2026-10-01 |
| 2. Custom-Object Key-Prefix Persistence | 3/3 | Complete | 2026-10-02 |
| 3. Thin Standard-Object Baselines | 4/4 | Complete | 2026-10-08 |
| 4. Polymorphic Lookups & SOQL TYPEOF | 7/7 | Complete | 2026-10-08 |
| 5. Roll-Up Summary Fields | 0/TBD | Not started | - |
| 6. Bulk API 2.0 Persistence | 0/TBD | Not started | - |
| 7. Conformance Re-Run & Milestone Acceptance | 0/TBD | Not started | - |
