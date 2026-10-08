# Requirements: orglet — Milestone 1 (hardening)

**Defined:** 2026-09-29
**Core Value:** A Salesforce client pointed at orglet cannot tell the difference for the surface
orglet claims to support, and anything it does not support is logged as `UNSUPPORTED:<area>`
rather than faked.

## v1 Requirements

Requirements for this milestone. Each maps to a roadmap phase. "User" is a developer running
orglet or a Salesforce client (`jsforce`, `simple-salesforce`, curl) talking to it.

### Test Infrastructure & CI

- [x] **INFRA-01**: User can run the full unit and integration test suite with `pnpm test` on a
  machine without Docker; Postgres-backed tests run against an embedded pglite instance reached
  through the existing `pg` pool over the pglite socket server
- [x] **INFRA-02**: Import-mode behaviour (`SET LOCAL session_replication_role = replica`) and
  the `information_schema` schema differ are verified to work on the pinned pglite version, or
  the affected tests are explicitly tagged to run only on real Postgres with the reason recorded
- [x] **INFRA-03**: `orglet up` and the Docker Compose path continue to use a real Postgres 16;
  no production code path depends on pglite
- [x] **INFRA-04**: The project is published in a public GitHub repository under Johan's
  personal account with the repo-local git identity, after explicit confirmation of the
  repository name and the first push
- [x] **INFRA-05**: GitHub Actions runs lint, typecheck (`tsc -b`) and the full test suite
  against pglite on every push and pull request
- [x] **INFRA-06**: A second GitHub Actions job runs the same test suite against a Postgres 16
  service container, so pglite-only regressions cannot go unnoticed
- [x] **INFRA-07**: The vendored `sigha` sync script is never executed in CI; the vendored copy is
  what gets built and tested

### Custom-Object Key Prefixes

- [x] **PREFIX-01**: A custom object's key prefix is assigned the first time the object is seen
  by `orglet up` and stored in the org database (internal `_orglet` schema), so reloading with
  a new or renamed custom object never changes the prefix of an existing object
- [x] **PREFIX-02**: An existing org database whose prefixes were assigned by the old
  alphabetical scheme keeps those exact assignments as its initial persisted state on first
  upgrade; no existing Id changes meaning
- [x] **PREFIX-03**: A persisted custom prefix can never collide with a standard-object prefix
  or with another custom object's prefix; a collision fails the load with a clear error
- [x] **PREFIX-04**: `orglet check` (no database) reports provisional prefixes and states that
  they are provisional; `orglet reset` keeps prefix assignments unless the user asks to drop
  them

### Thin Standard-Object Baselines

- [x] **BASE-01**: The 14 standard objects a Developer Edition references but the baseline
  lacks (BusinessHours, BusinessProcess, CallCenter, DandBCompany, Entitlement,
  ExternalDataSource, IdeaTheme, Individual, OperatingHours, OpportunityHistory,
  ServiceAppointment, ServiceContract, SocialPost, UserLicense) exist as baseline objects with
  their documented key prefix, Id, name-equivalent field and system fields
- [x] **BASE-02**: Lookups to any of the 14 objects are reference-checked on save
  (`INVALID_CROSS_REFERENCE_KEY` on a bad Id) instead of accepted unchecked
- [x] **BASE-03**: Each of the 14 objects exposes `createable`, `updateable` and `deletable`
  in describe exactly as the public Object Reference documents (ExternalDataSource,
  OpportunityHistory and UserLicense read-only; CallCenter create-only; BusinessHours and
  BusinessProcess create/update only, no delete; the rest full CRUD),
  and DML that violates a flag is rejected with the Salesforce error code
- [x] **BASE-04**: Describe for a thin object still contains everything `jsforce` and
  `simple-salesforce` read (`keyPrefix`, `nameField`/`name`, `urls`, `fields[]`,
  `childRelationships[]`), so a thin object never breaks global describe or per-object describe
- [x] **BASE-05**: Loading Johan's Developer Edition retrieve produces zero
  `UNSUPPORTED:reference-target` warnings

### Polymorphic Lookups & SOQL TYPEOF

- [x] **POLY-01**: A polymorphic lookup (for example `OwnerId` → User or Group) resolves its
  target object per row from the Id key prefix in SOQL parent traversal, result shaping and
  formula parent references; the write path already does this and is the reference behaviour
- [ ] **POLY-02**: A polymorphic parent in a query result carries `attributes.type` of the
  concrete object for that row, and parent fields that do not exist on that concrete object
  are returned as `null`
- [ ] **POLY-03**: A polymorphic value whose key prefix maps to no object in the org schema
  degrades to a `null` parent (and `ELSE` branch in TYPEOF) instead of erroring
- [ ] **POLY-04**: `SELECT TYPEOF <field> WHEN <Object> THEN <fields> [WHEN ...] [ELSE <fields>]
  END` compiles and returns per-row shaped results according to the matching branch
- [ ] **POLY-05**: `<relationship>.Type` is selectable and filterable in `WHERE` as a string
  comparison against the concrete object name
- [x] **POLY-06**: The documented invalid TYPEOF forms (in `WHERE`, `GROUP BY`, `HAVING`, inside
  a semi-join subquery, functions in `WHEN`, nested TYPEOF, with `COUNT()`) are rejected with a
  `MALFORMED_QUERY` error whose message names the restriction

### Roll-Up Summary Fields

- [ ] **ROLL-01**: `Summary` fields are loaded from SFDX metadata (`summarizedField`,
  `summaryForeignKey`, `summaryOperation`, `summaryFilterItems`) instead of being skipped,
  with the parent field typed as the summarised field's type (Number, Currency, Percent, Date
  or DateTime for MIN/MAX; Number for COUNT)
- [ ] **ROLL-02**: A roll-up is only accepted on a master-detail relationship; a roll-up over a
  lookup fails metadata load with a clear error
- [ ] **ROLL-03**: COUNT, SUM, MIN and MAX are computed with the documented filter operators
  (including field-to-field `valueField` comparisons) over non-deleted children
- [ ] **ROLL-04**: A roll-up is recomputed inside the same transaction when a child is
  inserted, updated (including changes to filter-only fields), deleted, undeleted or moved to
  another parent, and in the reparent case both the old and the new parent are recomputed
- [ ] **ROLL-05**: Roll-up recomputation happens in the app-side save pipeline after the child
  record is written and before the parent's after-hooks, never as a Postgres trigger, and
  partial-success savepoints roll back the parent update together with the child
- [ ] **ROLL-06**: Multi-level master-detail chains recompute upward (a roll-up whose parent is
  itself a detail of a roll-up parent), and a roll-up that summarises another roll-up is
  handled without infinite recursion
- [ ] **ROLL-07**: Roll-up fields are read-only via REST and Bulk (`createable: false`,
  `updateable: false`, `calculated: true` in describe); a client value is ignored or rejected
  exactly as Salesforce documents
- [ ] **ROLL-08**: Roll-up values are stored as columns and are selectable, filterable and
  sortable in SOQL like any other field
- [ ] **ROLL-09**: Loading Johan's Developer Edition retrieve produces zero
  `UNSUPPORTED:field-type` warnings for `Summary` fields

### Bulk API 2.0 Persistence

- [ ] **BULK-01**: Ingest and query jobs, uploaded CSV data and results are stored in Postgres
  (internal `_orglet` schema) and are retrievable after a server restart
- [ ] **BULK-02**: The documented state machine is preserved (ingest: Open → UploadComplete →
  InProgress → JobComplete | Failed | Aborted; query jobs start in UploadComplete); only
  `UploadComplete` and `Aborted` can be set by the client
- [ ] **BULK-03**: `successfulResults`, `failedResults` and `unprocessedrecords` return CSV
  with the documented `sf__Id`, `sf__Created`, `sf__Error` columns from persisted results
- [ ] **BULK-04**: Jobs older than 7 days are purged, matching Salesforce retention
- [ ] **BULK-05**: A Bulk query job rejects SOQL that Bulk API 2.0 does not support (TYPEOF,
  GROUP BY, OFFSET, aggregates, compound fields, child subqueries) with the documented error,
  using a rule set separate from REST SOQL

### Acceptance

- [ ] **ACCEPT-01**: `orglet check` against Johan's Developer Edition retrieve reports zero
  `UNSUPPORTED` warnings (baseline 2026-09-29: 15)
- [ ] **ACCEPT-02**: The `simple-salesforce` conformance script and the `jsforce` e2e subset
  are re-run after all changes and stay green; previously excluded Bulk tests are included
  where Bulk API 2.0 now covers them
- [ ] **ACCEPT-03**: `conformance/` READMEs are updated with the current pass/fail/excluded
  numbers and the reason for every remaining exclusion

## v2 Requirements

Deferred to later milestones. Tracked but not in the current roadmap.

### Headless completeness (rest of original phase 1)

- **HEAD-01**: Task and Event as full objects with polymorphic `WhoId`/`WhatId`
- **HEAD-02**: SOSL search
- **HEAD-03**: Metadata API zip import
- **HEAD-04**: Compound fields (Address, Name) selectable in SOQL
- **HEAD-05**: Record types per picklist value sets
- **HEAD-06**: Full field parity for the 14 thin baseline objects

### Bulk API

- **BULKX-01**: True asynchronous background processing of Bulk jobs
- **BULKX-02**: PK chunking and parallel query results

### Roll-ups

- **ROLLX-01**: Force-recalculation helper for import mode
- **ROLLX-02**: More than 25 roll-ups per object

### Platform

- **UI-01**: UI API and LWC/SLDS front end
- **FLOW-01**: Flow interpreter
- **EVT-01**: CDC / Platform Events to Kafka, SQS, webhooks; Pub/Sub API
- **SEC-01**: Profiles, permission sets, FLS, OWD enforcement
- **APEX-01**: Apex runtime behind `TriggerExecutor`

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Behaviour-diffing against a real Salesforce org | Developer MSA forbids benchmarking and competitive use; public docs and SDK source only |
| Roll-ups or other business rules as Postgres triggers | Order of execution needs PRIORVALUE/ISCHANGED and mutable before-hooks; rules live in the engine |
| `pg-mem` as the test database | Hand-written SQL engine, stale, cannot honour ALTER TABLE/SAVEPOINT/session_replication_role fidelity |
| A `<field>_type` companion column for polymorphic lookups | The Id key prefix already encodes the target; a column would drift |
| A new `Summary` field type in `packages/schema` | Resolving to the summarised type with a `rollup` marker leaves schema, coerce and required-checks untouched |
| Bulk API v1 (`/services/async/*`) | Not used by the target SDK versions; Bulk 2.0 is the documented path |
| Multi-process or distributed Bulk job store | Single-tenant, single-process by design |
| SLDS 2, `lightning-base-components`, Salesforce Sans | Non-OSI licence, deprecated, proprietary font |
| Running `scripts/sync-sigha.sh` in CI | Clones an external repo on every run; maintainer-only action |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| INFRA-01 | Phase 1 | Complete |
| INFRA-02 | Phase 1 | Complete |
| INFRA-03 | Phase 1 | Complete |
| INFRA-04 | Phase 1 | Complete |
| INFRA-05 | Phase 1 | Complete |
| INFRA-06 | Phase 1 | Complete |
| INFRA-07 | Phase 1 | Complete |
| PREFIX-01 | Phase 2 | Complete |
| PREFIX-02 | Phase 2 | Complete |
| PREFIX-03 | Phase 2 | Complete |
| PREFIX-04 | Phase 2 | Complete |
| BASE-01 | Phase 3 | Complete |
| BASE-02 | Phase 3 | Complete |
| BASE-03 | Phase 3 | Complete |
| BASE-04 | Phase 3 | Complete |
| BASE-05 | Phase 3 | Complete |
| POLY-01 | Phase 4 | Complete |
| POLY-02 | Phase 4 | Pending |
| POLY-03 | Phase 4 | Pending |
| POLY-04 | Phase 4 | Pending |
| POLY-05 | Phase 4 | Pending |
| POLY-06 | Phase 4 | Complete |
| ROLL-01 | Phase 5 | Pending |
| ROLL-02 | Phase 5 | Pending |
| ROLL-03 | Phase 5 | Pending |
| ROLL-04 | Phase 5 | Pending |
| ROLL-05 | Phase 5 | Pending |
| ROLL-06 | Phase 5 | Pending |
| ROLL-07 | Phase 5 | Pending |
| ROLL-08 | Phase 5 | Pending |
| ROLL-09 | Phase 5 | Pending |
| BULK-01 | Phase 6 | Pending |
| BULK-02 | Phase 6 | Pending |
| BULK-03 | Phase 6 | Pending |
| BULK-04 | Phase 6 | Pending |
| BULK-05 | Phase 6 | Pending |
| ACCEPT-01 | Phase 7 | Pending |
| ACCEPT-02 | Phase 7 | Pending |
| ACCEPT-03 | Phase 7 | Pending |

**Coverage:**
- v1 requirements: 39 total
- Mapped to phases: 39
- Unmapped: 0 ✓

---
*Requirements defined: 2026-09-29*
*Last updated: 2026-09-29 after roadmap creation*
