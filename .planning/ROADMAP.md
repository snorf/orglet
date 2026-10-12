# Roadmap: orglet

## Milestones

- ✅ **v1.0 hardening** — Phases 1-7 (shipped 2026-10-12) — [archive](milestones/v1.0-ROADMAP.md)
- 📋 **v1.1** — not yet defined (`/gsd:new-milestone`)

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

### 📋 Next milestone (not yet planned)

Phase numbering continues from 8. Candidates (PROJECT.md Out of Scope and v2 requirements in the v1.0
requirements archive): UI API + LWC/SLDS front end, Flow interpreter, security model (profiles,
permission sets, FLS, OWD), Apex runtime, Task/Event with `WhoId`/`WhatId`, SOSL, Metadata API import,
plus the v1.0 tech-debt list.

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

## Backlog

Unsequenced ideas captured for a later milestone. Source: gaps observed when loading a large real-org retrieve after v1.0 (reported by area only). Promote with `/gsd:review-backlog`.

### Phase 999.1: Narrow baseline OwnerId referenceTo per object (BACKLOG)

**Goal:** OwnerId is User-only on objects that cannot be queue-owned (Account, Opportunity, Contract, Contact, ...) and User|Group only where Salesforce allows queues (Case, Lead, custom objects with queues), so plain Owner.X formula traversal and Owner.X SOQL compile as in a real org. Folds the pending todo 2026-10-08-narrow-baseline-ownerid-per-object; the largest single source of formula warnings on a real retrieve.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

### Phase 999.2: Formula global variables beyond User, Profile and Organization (BACKLOG)

**Goal:** Support $UserRole (Name, DeveloperName), $Api (Partner/Enterprise server URLs, Session_ID), $Setup (custom settings), $Label, and $CustomMetadata in formula fields and validation rules; $Permission depends on the permission-set model (security milestone) and $CustomMetadata on the custom-metadata backlog item. Each unsupported global keeps raising UNSUPPORTED:formula-global until modelled.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

### Phase 999.3: Custom metadata types and custom settings (BACKLOG)

**Goal:** Load __mdt custom metadata types as read-only objects whose rows come from customMetadata/*.md-meta.xml in the retrieve, support MetadataRelationship fields, and model list/hierarchy custom settings (customSettingsType) with their $Setup semantics; describe and SOQL work through the SDKs. Removes UNSUPPORTED:object-kind for __mdt and the MetadataRelationship field-type warnings.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

### Phase 999.4: Roll-up summary over formula fields (BACKLOG)

**Goal:** Allow SUM/MIN/MAX roll-ups whose summarized child field is a formula, in the cases Salesforce permits (same-object formula without cross-object references or time functions), evaluating the formula per child row inside the roll-up SQL; keep UNSUPPORTED:rollup-type for the disallowed cases with the Salesforce rule quoted.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

### Phase 999.5: Standard-object baseline v2 generated from the Object Reference (BACKLOG)

**Goal:** Replace hand-curated baseline JSON with a generator fed by the public Object Reference so field parity is systematic (closes HEAD-06 for the thin objects, and the Campaign/Product2/Asset field gaps), and add the business objects a typical sales/service org references: Quote, QuoteLineItem, Order, OrderItem, AccountContactRelation, AccountTeamMember, OpportunityTeamMember, OpportunityContactRole, OpportunitySplit, ContractLineItem, CaseContactRole, CaseMilestone, EmailMessage, ContentDocument/ContentVersion (incl. VersionData download), FeedItem, Location/Address. Prioritise by reference count in real retrieves.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

### Phase 999.6: orglet check report quality: root causes, system-object noise, summary (BACKLOG)

**Goal:** Make the warning report actionable on large retrieves: report cascaded formula failures by root cause (a field skipped upstream) instead of as separate 'does not exist' errors; classify setup/system standard objects nobody references (AI*, Devops*, Forecasting*, Learning*, Tenant*, Scratch org, ...) into a quieter category than business objects; add a per-area summary (counts per UNSUPPORTED area, optionally --summary or --json) so a 400-line report reads in ten.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

### Phase 999.7: sigha formula parser gaps: colon syntax and the ! operator (BACKLOG)

**Goal:** Upstream fixes in the vendored sigha parser then resync: Relationship:Object.Field colon syntax for polymorphic references (folds todo 2026-10-08-sigha-colon-syntax; phase 4 D-16), and the '!' token that real validation rules use (verify against the formula-engine corpus whether Salesforce accepts unary ! as NOT or whether != parsing is the gap) which currently fails with 'Unexpected !'.
**Requirements:** TBD
**Plans:** 0 plans

Plans:
- [ ] TBD (promote with /gsd:review-backlog when ready)

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
