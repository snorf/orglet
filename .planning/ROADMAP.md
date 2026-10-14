# Roadmap: orglet

## Milestones

- ✅ **v1.0 hardening** — Phases 1-7 (shipped 2026-10-12) — [archive](milestones/v1.0-ROADMAP.md)
- 🚧 **v1.1 real-org fidelity** — Phases 8-14 (in progress)

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

### 🚧 v1.1 real-org fidelity (Phases 8-14) — IN PROGRESS

**Milestone goal:** A large, real enterprise-org retrieve loads with zero warnings for everything it itself references. Standard objects nothing references are reported as information, not warnings.

- [x] **Phase 8: Upgrade Safety Net & Nullable Key Prefixes** - A populated v1.0 database upgrades without data loss; FK violations downgrade to warnings; objects may have no key prefix (completed 2026-10-13)
- [ ] **Phase 9: Baseline Generator, Parity & OwnerId Narrowing** - A deterministic generator reproduces the 35 existing objects, then adds every documented field and per-object OwnerId targets
- [ ] **Phase 10: Business Standard Objects** - The 18 sales/service objects exist with documented DML flags; referenced-versus-unreferenced objects are told apart
- [ ] **Phase 11: Custom Metadata, Custom Settings & Labels** - `__mdt` types and records, `MetadataRelationship`, custom settings and custom labels load
- [ ] **Phase 12: sigha Resync & Formula Globals** - `!`, colon syntax, `$UserRole`, `$Api`, `$Label`, `$CustomMetadata` and hierarchy `$Setup` work in formulas
- [ ] **Phase 13: Roll-Ups over Formula Fields** - COUNT/SUM/MIN/MAX over same-object non-volatile formula fields
- [ ] **Phase 14: Check Report & Enterprise Acceptance** - A root-cause `orglet check` report, `--summary`/`--json`, the `examples/enterprise` fixture and the real-org acceptance run

## Phase Details

### Phase 8: Upgrade Safety Net & Nullable Key Prefixes
**Goal**: A database created by v1.0 can be upgraded by any later baseline change without data loss or an aborted `orglet up`, and a standard object without a confirmed key prefix is a first-class citizen.
**Depends on**: Nothing (first v1.1 phase; must land before any baseline change)
**Requirements**: MIGR-01, MIGR-02, MIGR-04, BASE2-05
**Success Criteria** (what must be TRUE):
  1. A test builds a database from the v1.0 baseline files (taken from git) holding Group-owned rows and `--import` rows, runs `orglet up` with the current code on pglite and Postgres 16, finds every row intact afterwards, and asserts the exact resulting warning set.
  2. When a new single-target lookup foreign key would be added over rows that violate it, `orglet up` completes, prints one `UNSUPPORTED:schema-fk` warning per column naming the table, column and offending row count, and deletes or rewrites nothing.
  3. A second `orglet up` on an up-to-date database prints no warnings and executes no `CREATE INDEX` for indexes that already exist.
  4. A standard object with a `null` key prefix (source-labelled) loads, appears in describe, is accepted as a reference target by `orglet check`, and is excluded from prefix-based polymorphic matching; no prefix is ever invented.
  5. Groundwork for later phases is observable: structured diagnostic records (`Diagnostic`/`SkippedItem`/`FormulaFailure`) exist beside the unchanged warning strings and are covered by a test; `scripts/sync-sigha.sh` runs on Linux in CI (no BSD-only `sed`) and orglet-side expectation tests for `!`, `!=`, colon syntax and `:`/`!` inside string literals exist (red until Phase 12); the upstream sigha PR links are recorded in `packages/sigha/VENDOR.md`; and a Group-owned test audit list (every test, fixture and conformance check that relies on a Group owner) is committed in the phase directory for Phase 9.
**Plans**: 10 plans
Plans:
- [x] 08-01-PLAN.md — migrate() safety net: FK pre-check -> UNSUPPORTED:schema-fk, catalog-skip for existing indexes/sequences (MIGR-02, MIGR-04)
- [x] 08-02-PLAN.md — nullable keyPrefix + keyPrefixSource, baseline validation, null-prefix fixture, null-aware schema primitives (BASE2-05)
- [x] 08-03-PLAN.md — null-prefix ripple through engine, SOQL and describe; build green again (BASE2-05)
- [x] 08-04-PLAN.md — portable sync-sigha.sh + CI sigha-sync-check, VENDOR pending section, it.fails expectation tests, Group-owned audit (SC5)
- [x] 08-05-PLAN.md — Diagnostic/SkippedItem/FormulaFailure + shared formatter; metadata and schema sources emit diagnostics (SC5)
- [x] 08-06-PLAN.md — FormulaCompileError.missing; FormulaRegistry/runQuery/DmlEngine diagnostics (SC5)
- [x] 08-07-PLAN.md — v1.0 baseline snapshot fixture + populated upgrade test on both backends (MIGR-01, MIGR-04)
- [x] 08-08-PLAN.md — upstream sigha branches for unary ! and colon syntax in an external clone (SC5)
- [x] 08-09-PLAN.md — checkpoints: approve fork snorf/sigha, approve push (SC5)
- [x] 08-10-PLAN.md — push approved branches, Johan opens PRs, record links in VENDOR.md (SC5)
**Research flag**: none.

### Phase 9: Baseline Generator, Parity & OwnerId Narrowing
**Goal**: The standard-object baseline is produced by a deterministic, licence-attributed generator instead of by hand, the existing 35 objects keep their shape and gain every documented field, and `OwnerId` targets match each object's documentation.
**Depends on**: Phase 8
**Requirements**: BASE2-01, BASE2-02, BASE2-03, BASE2-04, MIGR-03
**Success Criteria** (what must be TRUE):
  1. Running the generator twice yields byte-identical JSON, CI fails when regeneration differs from the committed files, and the committed output contains no documentation prose.
  2. Regenerating only the existing 35 objects first produces a no-op diff against v1.0; the v1-vs-v2 diff gate then fails if a v1.0 field disappears or narrows without an allowlisted reason, and the generator refuses a new MasterDetail column on an object that existed in v1.0.
  3. `orglet check` on a retrieve using documented fields of those 35 objects reports zero `UNSUPPORTED:standard-field` for every documented field the baseline models; documented fields it cannot model (unsupported type, or a reference to an object outside the baseline) are skipped and listed in `PROVENANCE.json`. Feature-gated fields are nullable in describe and tagged `featureGated` in the baseline JSON and in `orglet check` (not a describe key, D-10).
  4. `Owner.Name` in a formula and in SOQL compiles on Account, Contact, Opportunity, Contract, Asset and Campaign, while Case, Lead and Task owner queries still return User and Group owners as in v1.0 (`conformance/poly-check` stays green).
  5. The Phase 8 populated-database upgrade test still passes with the v2 baseline, with only the expected, allowlisted warnings.
**Plans**: 9 plans
- [x] 09-01-PLAN.md — scaffolding, sf-skills vendoring at a pinned SHA with offline sha256 manifest, scripts typecheck in CI, key-prefix sources (BASE2-01)
- [x] 09-02-PLAN.md — loader contract: ownerTargets/featureGated; upgrade test admits additive growth (BASE2-03, BASE2-04, SC5)
- [x] 09-03-PLAN.md — facts-only Object Reference PDF extraction + gating keyword list (BASE2-01, BASE2-03, MIGR-03)
- [x] 09-04-PLAN.md — step A: deterministic generator + v1.0 pins reproduce the 35 objects; CI drift gate (BASE2-01, BASE2-02)
- [x] 09-05-PLAN.md — v1-vs-v2 diff gate with allowlist, MasterDetail refusal, failure modes, prose scan (MIGR-03)
- [x] 09-06-PLAN.md — step B rules in memory + decision checkpoint on the report (BASE2-02, BASE2-03)
- [ ] 09-07-PLAN.md — step B landing: regenerate v2, SC3 proof, requirement wording aligned (BASE2-02, BASE2-03)
- [ ] 09-08-PLAN.md — per-object ownerTargets and SC4 tests (BASE2-04)
- [ ] 09-09-PLAN.md — D-14 upgrade case, Group-owned audit, conformance, todo (BASE2-04)
**Research flag**: design spike (not a full research phase) on type mapping, string-length rules and single-source flags.
*Wording of SC3 aligned with delivered scope on 2026-10-14 (09-07; CONTEXT D-10, phase 9 locked decision 4).*

### Phase 10: Business Standard Objects
**Goal**: The 18 business objects a typical sales/service org references exist as faithful baseline objects, and `orglet check` separates objects a retrieve references from objects nothing references.
**Depends on**: Phase 9
**Requirements**: BASE2-06, BASE2-07, BASE2-08
**Success Criteria** (what must be TRUE):
  1. A jsforce or simple-salesforce client can describe and query Quote, QuoteLineItem, Order, OrderItem, AccountContactRelation, AccountTeamMember, OpportunityTeamMember, OpportunityContactRole, OpportunitySplit, ContractLineItem, CaseContactRole, CaseMilestone, EmailMessage, ContentDocument, ContentVersion, FeedItem, Location and Address, with no blob fields exposed and the omissions listed in the generator report.
  2. DML that the documentation forbids is refused with `INVALID_TYPE_FOR_OPERATION` (OrderItem undelete; CaseMilestone create and delete; ContentDocument create; ContentVersion delete), and a lookup to any of the 18 with a malformed or wrong-type Id is rejected with `INVALID_CROSS_REFERENCE_KEY`.
  3. `orglet check` keeps `UNSUPPORTED:reference-target` for a standard object that a lookup, roll-up, formula or validation rule references but orglet does not model, and lists an unreferenced, unmodelled standard object in an informational category that never makes `--strict` exit 1.
  4. The conformance run (`conformance/run-all.sh`) is green after the new objects land, and the plan records the expected warning-count shifts.
**Plans**: TBD
**Research flag**: none (verification list for single-list key prefixes lives in the plans).

### Phase 11: Custom Metadata, Custom Settings & Labels
**Goal**: Custom metadata types with their records, custom settings and custom labels in a retrieve load as the objects and data they are, so nothing needs to be skipped.
**Depends on**: Phase 9 (key-prefix and generator groundwork), Phase 10
**Requirements**: CMDT-01, CMDT-02, CMDT-03, CMDT-04, CSET-01, CSET-02
**Success Criteria** (what must be TRUE):
  1. After `orglet up`, a client can describe and SOQL-query an `__mdt` type through jsforce and simple-salesforce and sees the retrieved records with stable Ids across restarts (`"007"` stays text, `xsi:nil` is null), and a removed record disappears on reload.
  2. Create, update and delete against an `__mdt` object via the data API are rejected with an error and never accepted; describe flags show only describe, query and retrieve as supported.
  3. A `MetadataRelationship` field to another `__mdt` returns that record's Id, a relationship to an entity or field definition returns its qualified API name and `Rel__r.QualifiedApiName` is selectable, and a dangling target warns and stays null.
  4. A List or Hierarchy custom setting describes as `customSetting: true` with no `OwnerId`; a second hierarchy row for the same `SetupOwnerId` fails with `DUPLICATE_VALUE`; `orglet check` states that custom-setting data is not part of a retrieve.
  5. Custom labels from `CustomLabels.labels-meta.xml` are present on the loaded org schema with name, value, language and category.
**Plans**: TBD
**Research flag**: YES (`MetadataRelationship` stored value and describe spelling, the `customSetting` flag on `__mdt`, DML error code, `m00` prefix, nil handling).

### Phase 12: sigha Resync & Formula Globals
**Goal**: Formulas and validation rules that use `!`, `Relationship:Object.Field` and the extra global variables compile and evaluate instead of raising warnings.
**Depends on**: Phase 11 (labels, custom metadata and settings must exist; resync goes first in the phase), Phase 8 (portable sync script and expectation tests)
**Requirements**: FORM-01, FORM-02, FORM-03, FORM-04, FORM-05
**Success Criteria** (what must be TRUE):
  1. After the resync to a pinned full commit recorded in `VENDOR.md`, the formula corpus pass count is at least the v1.0 baseline of 6 312 cases and `sync-sigha.sh` runs on macOS and Linux; `!ISBLANK(x)` evaluates as NOT, and `!` or `:` inside string literals is unaffected.
  2. `Owner:User.Email` and `Owner:Queue.Name` evaluate against the named target of a polymorphic lookup and are blank when the row is owned by the other type; a qualifier the lookup cannot reference fails to compile with Salesforce's wording.
  3. `$UserRole.<field>` is blank for a user without a role, and `$Api.Partner_Server_URL_<n>`, `$Api.Enterprise_Server_URL_<n>` and `$Api.Session_ID` evaluate to the running server's URLs and the request's session.
  4. `$Label.<Name>` and `$CustomMetadata.<Type__mdt>.<Record>.<Field__c>` resolve from loaded data; an unknown label, type or field is a compile error, and an unknown record evaluates blank with one aggregated `UNSUPPORTED:custom-metadata-record` warning.
  5. `$Setup.<Setting__c>.<Field__c>` returns the user, profile or organization value in that order for a hierarchy setting, while `$Setup` on a list setting and `$Permission` still raise `UNSUPPORTED:formula-global` with the reason stated.
**Plans**: TBD
**Research flag**: YES, small (`$Setup` null-field fall-through, `$Api` URL shapes, `$Label` casing).

### Phase 13: Roll-Ups over Formula Fields
**Goal**: A roll-up summary can aggregate or filter on a formula field in the cases Salesforce permits, and fails soft in the cases it does not.
**Depends on**: Phase 12 (structured formula registry and dependency list)
**Requirements**: ROLL2-01
**Success Criteria** (what must be TRUE):
  1. A COUNT, SUM, MIN or MAX roll-up whose summarized or filter field is a same-object, non-volatile formula loads, and inserting, updating, deleting or undeleting child rows changes the parent value exactly as for a stored-field roll-up (including when a field the formula reads changes).
  2. Upgrading a database that already holds children backfills the formula roll-up once, and a second `orglet up` is silent.
  3. A roll-up over a formula with a cross-object path, `NOW`/`TODAY`/`TIMENOW`, or a `$User`, `$Profile`, `$Setup`, `$Api` or `$Label` root loads without failing, logs `UNSUPPORTED:rollup-formula` and skips that field.
  4. A formula-to-roll-up-to-formula cycle is detected and reported rather than looping.
**Plans**: TBD
**Research flag**: YES (return types and restriction set Salesforce allows; rounding to the formula's declared scale before aggregating).

### Phase 14: Check Report & Enterprise Acceptance
**Goal**: `orglet check` reads as an actionable report on a large retrieve, and the milestone is proven against a public enterprise-shaped fixture, both SDK suites and the author's real retrieves.
**Depends on**: Phases 8-13
**Requirements**: CHECK-01, CHECK-02, ACC2-01, ACC2-02, ACC2-03
**Success Criteria** (what must be TRUE):
  1. `orglet check` on `examples/acme` prints a census, a one-line verdict, a per-area table keyed by `UNSUPPORTED:<area>`, and groups cascaded formula failures under their root cause while listing every dependent and stating both counts; output order is deterministic (snapshot test) and the `warning:` line format is unchanged.
  2. `orglet check --summary` prints only census, verdict and per-area counts with no object, field or rule names; `--json` emits the same report including the informational category; `--strict` exits 1 on any warning and 0 when only informational entries exist.
  3. `examples/enterprise`, authored from the feature documentation under generic names and covering every v1.1 category, passes `orglet check --strict` with exit 0 in CI, and `conformance/run-all.sh` (describe-check, poly-check, rollup-check and both SDK suites, every exclusion still classified) is green against it.
  4. The author's Developer Edition retrieve still loads with `orglet check --strict` exiting 0, and the author's large real-org retrieve (local only) reports zero warnings for everything it references, recorded in `conformance/README.md` as counts per area, never names.
**Plans**: TBD
**Research flag**: none.

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
| 9. Baseline Generator, Parity & OwnerId Narrowing | v1.1 | 0/TBD | Not started | - |
| 10. Business Standard Objects | v1.1 | 0/TBD | Not started | - |
| 11. Custom Metadata, Custom Settings & Labels | v1.1 | 0/TBD | Not started | - |
| 12. sigha Resync & Formula Globals | v1.1 | 0/TBD | Not started | - |
| 13. Roll-Ups over Formula Fields | v1.1 | 0/TBD | Not started | - |
| 14. Check Report & Enterprise Acceptance | v1.1 | 0/TBD | Not started | - |

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
