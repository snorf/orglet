# Roadmap: orglet

## Milestones

- ✅ **v1.0 hardening** — Phases 1-7 (shipped 2026-10-12) — [archive](milestones/v1.0-ROADMAP.md)
- ✅ **v1.1 real-org fidelity** — Phases 8-14 (shipped 2026-11-01) — [archive](milestones/v1.1-ROADMAP.md)

## Phases

<details>
<summary>✅ v1.0 hardening (Phases 1-7) — SHIPPED 2026-10-12</summary>

- [x] Phase 1: Test Infrastructure & CI (4/4 plans) — completed 2026-10-01
- [x] Phase 2: Custom-Object Key-Prefix Persistence (3/3 plans) — completed 2026-10-02
- [x] Phase 3: Thin Standard-Object Baselines (4/4 plans) — completed 2026-10-08
- [x] Phase 4: Polymorphic Lookups & SOQL TYPEOF (7/7 plans) — completed 2026-10-08
- [x] Phase 5: Roll-Up Summary Fields (7/7 plans) — completed 2026-10-09
- [x] Phase 6: Bulk API 2.0 Persistence (6/6 plans) — completed 2026-10-10
- [x] Phase 7: Conformance Re-Run & Milestone Acceptance (6/6 plans) — completed 2026-10-12

Full phase details, goals and success criteria: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md).
Audit: [milestones/v1.0-MILESTONE-AUDIT.md](milestones/v1.0-MILESTONE-AUDIT.md).

</details>

<details>
<summary>✅ v1.1 real-org fidelity (Phases 8-14) — SHIPPED 2026-11-01</summary>

- [x] Phase 8: Upgrade Safety Net & Nullable Key Prefixes (10/10 plans) — completed 2026-10-13
- [x] Phase 9: Baseline Generator, Parity & OwnerId Narrowing (9/9 plans) — completed 2026-10-14
- [x] Phase 10: Business Standard Objects (6/6 plans) — completed 2026-10-16
- [x] Phase 11: Custom Metadata, Custom Settings & Labels (9/9 plans) — completed 2026-10-21
- [x] Phase 12: sigha Resync & Formula Globals (8/8 plans) — completed 2026-10-23
- [x] Phase 13: Roll-Ups over Formula Fields (8/8 plans) — completed 2026-10-24
- [x] Phase 14: Check Report & Enterprise Acceptance (12/12 plans) — completed 2026-10-31

Full phase details, goals and success criteria: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md).
Audit: [milestones/v1.1-MILESTONE-AUDIT.md](milestones/v1.1-MILESTONE-AUDIT.md).

</details>

### Next milestone

Not yet defined. Start with `/gsd:new-milestone`; candidates are the backlog items below.

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Test Infrastructure & CI | v1.0 | 4/4 | Complete | 2026-10-01 |
| 2. Custom-Object Key-Prefix Persistence | v1.0 | 3/3 | Complete | 2026-10-02 |
| 3. Thin Standard-Object Baselines | v1.0 | 4/4 | Complete | 2026-10-08 |
| 4. Polymorphic Lookups & SOQL TYPEOF | v1.0 | 7/7 | Complete | 2026-10-08 |
| 5. Roll-Up Summary Fields | v1.0 | 7/7 | Complete | 2026-10-09 |
| 6. Bulk API 2.0 Persistence | v1.0 | 6/6 | Complete | 2026-10-10 |
| 7. Conformance Re-Run & Milestone Acceptance | v1.0 | 6/6 | Complete | 2026-10-12 |
| 8. Upgrade Safety Net & Nullable Key Prefixes | v1.1 | 10/10 | Complete | 2026-10-13 |
| 9. Baseline Generator, Parity & OwnerId Narrowing | v1.1 | 9/9 | Complete | 2026-10-14 |
| 10. Business Standard Objects | v1.1 | 6/6 | Complete    | 2026-10-16 |
| 11. Custom Metadata, Custom Settings & Labels | v1.1 | 9/9 | Complete    | 2026-10-21 |
| 12. sigha Resync & Formula Globals | v1.1 | 8/8 | Complete    | 2026-10-23 |
| 13. Roll-Ups over Formula Fields | v1.1 | 8/8 | Complete    | 2026-10-24 |
| 14. Check Report & Enterprise Acceptance | v1.1 | 12/12 | Complete    | 2026-10-31 |

## Backlog

Unsequenced ideas captured for a later milestone. 999.1-999.7 (the gaps observed after v1.0) were promoted into v1.1 and shipped; the items below remain. Promote with `/gsd:review-backlog`.

### Phase 999.8: Platform events as publish-only objects (BACKLOG)

**Goal:** Load __e platform events as objects that accept POST /sobjects (publish) and describe correctly but store nothing queryable, with an optional change-event stream, as groundwork for EVT-01 (CDC/Platform Events to Kafka/SQS). Removes UNSUPPORTED:object-kind for __e.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

### Phase 999.9: Heimdall end-to-end backup run against orglet (BACKLOG)

**Goal:** Run the Java Salesforce backup tool (Bulk 2.0 query-only client) against an orglet org as a conformance target: needs client_credentials grant on /services/oauth2/token, /limits, the backup-config custom object through the tooling-API schema check, and ContentVersion VersionData download (baseline v2). Deferred since phase 6.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

### Phase 999.10: ContentVersion file upload done properly (BACKLOG)

**Goal:** Make file upload work as in a real org instead of through the Phase 10 ContentDocumentId nullable override: create the ContentDocument automatically on ContentVersion insert when ContentDocumentId is omitted (then drop the override so describe reports nillable: false as the DE does), store VersionData as a blob field (base64 over REST, bytea in Postgres) with the GET /sobjects/ContentVersion/{id}/VersionData download endpoint, and model ContentDocumentLink so a file can be attached to a record. Raised at the Phase 10 D-04 checkpoint (2026-10-14): file upload is a central capability and the override is a stopgap. Unblocks the ContentVersion half of 999.9.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

### Phase 999.11: Archive mode: read-only replica served from a Heimdall backup (BACKLOG)

**Goal:** Run orglet as a read-only replica of a former Salesforce org without copying the data into orglet's own tables: orglet loads the retrieve for schema, describe, SOQL and REST exactly as today, but record data is served from a Heimdall backup store (Heimdall owns the data, orglet owns the configuration). The schema layer emits views or foreign tables over the backup instead of tables; formula and roll-up fields are exposed as the stored values the org computed, never recomputed with `$User`/`NOW()`; every DML is refused with `INVALID_TYPE_FOR_OPERATION` except an explicit erasure path for GDPR deletes; SOSL-style search over names and emails covers the first question an archive gets. Heimdall keeps a central Postgres with metadata about every record and the record rows themselves as Bulk 2.0 query CSV in S3. Two candidate shapes to decide at discuss time: (a) serve straight from S3 (a query engine over CSV behind the SOQL compiler, no copy, no indexes, every query a scan), or (b) treat orglet's Postgres as a rebuildable cache: an `orglet archive load` streams the CSVs from S3 with `COPY` into tables driven by the Heimdall inventory, reusing the Bulk 2.0 CSV parsing and import-mode coercion, with FK checks deferred so lookup cycles need no ordering; SOQL, indexes, search and related lists then work unchanged. Open before planning: that choice, coverage of history, activity and file objects (needs 999.10 for ContentVersion), and real authentication plus an audit log for non-developer readers. Raised 2026-10-23; real-org data stays with the author, orglet is built and tested against public fixtures only.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

### Phase 999.12: Formula fields through parent relationships in SOQL (BACKLOG)

**Goal:** Selecting a formula field through a parent relationship (`Parent__r.Formula__c`, or a `Parent.*` expansion that includes formula fields) currently throws `UNSUPPORTED:soql-formula` in `packages/soql/src/compile.ts`; the same area also refuses formula fields in WHERE, ORDER BY and GROUP BY and in child subqueries. Formulas are evaluated app-side over the root record today, so a parent-context evaluation needs the parent row (and its own parent traversals) loaded or pushed into SQL. Found by the enterprise fixture in Phase 14 through jsforce's `Opportunity.select('*, Account.*, Owner.Name')`, where `Account.*` expands to the fixture's Account formula fields; excluded enterprise-only in conformance/jsforce until implemented. Raised 2026-10-29.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)
