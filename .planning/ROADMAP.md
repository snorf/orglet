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
- [x] **Phase 9: Baseline Generator, Parity & OwnerId Narrowing** - A deterministic generator reproduces the 35 existing objects, then adds every documented field and per-object OwnerId targets (completed 2026-10-14)
- [x] **Phase 10: Business Standard Objects** - The 18 sales/service objects exist with documented DML flags; referenced-versus-unreferenced objects are told apart (completed 2026-10-16)
- [x] **Phase 11: Custom Metadata, Custom Settings & Labels** - `__mdt` types and records, `MetadataRelationship`, custom settings and custom labels load (completed 2026-10-21)
- [x] **Phase 12: sigha Resync & Formula Globals** - `!`, colon syntax, `$UserRole`, `$Api`, `$Label`, `$CustomMetadata` and hierarchy `$Setup` work in formulas (completed 2026-10-23)
- [x] **Phase 13: Roll-Ups over Formula Fields** - COUNT/SUM/MIN/MAX over same-object non-volatile formula fields (completed 2026-10-24)
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
- [x] 09-07-PLAN.md — step B landing: regenerate v2, SC3 proof, requirement wording aligned (BASE2-02, BASE2-03)
- [x] 09-08-PLAN.md — per-object ownerTargets and SC4 tests (BASE2-04)
- [x] 09-09-PLAN.md — D-14 upgrade case, Group-owned audit, conformance, todo (BASE2-04)
**Research flag**: design spike (not a full research phase) on type mapping, string-length rules and single-source flags.
*Wording of SC3 aligned with delivered scope on 2026-10-14 (09-07; CONTEXT D-10, phase 9 locked decision 4).*

### Phase 10: Business Standard Objects
**Goal**: The 18 business objects a typical sales/service org references exist as faithful baseline objects, and `orglet check` separates objects a retrieve references from objects nothing references.
**Depends on**: Phase 9
**Requirements**: BASE2-06, BASE2-07, BASE2-08
**Success Criteria** (what must be TRUE):
  1. A jsforce or simple-salesforce client can describe and query Quote, QuoteLineItem, Order, OrderItem, AccountContactRelation, AccountTeamMember, OpportunityTeamMember, OpportunityContactRole, OpportunitySplit, ContractLineItem, CaseContactRole, CaseMilestone, EmailMessage, ContentDocument, ContentVersion, FeedItem, Location and Address, with no blob fields exposed and the omissions listed in the generator report.
  2. DML that the documentation forbids is refused with `INVALID_TYPE_FOR_OPERATION` (OrderItem undelete; CaseMilestone create and delete; ContentDocument create; ContentVersion delete), and a lookup to any of the 18 with an unparsable Id is rejected with `MALFORMED_ID`, and with a well-formed Id of the wrong type or with no matching row with `INVALID_CROSS_REFERENCE_KEY` (wording adjusted 2026-10-14, D-20).
  3. `orglet check` treats a standard object that a lookup, roll-up, formula or validation rule references but orglet does not model as referenced: it keeps its warnings (`UNSUPPORTED:reference-target` for a lookup target, the existing roll-up and formula warnings otherwise, with no extra reference-target warning, D-09), and lists an unreferenced, unmodelled standard object in an informational category that never makes `--strict` exit 1 (wording adjusted 2026-10-14, D-09).
  4. The conformance run (`conformance/run-all.sh`) is green after the new objects land, and the plan records the expected warning-count shifts.
**Plans**: 6 plans
Plans:
- [x] 10-01-PLAN.md — generator capability: Supported Calls extraction, object facts for objects without pins, de-describe source, rule 4 limited to v1.0 objects (D-18), new type tokens (BASE2-06, BASE2-07)
- [x] 10-02-PLAN.md — `orglet check` informational category: referenced vs unreferenced unmodelled standard objects, `info:` line outside --strict (BASE2-08)
- [x] 10-03-PLAN.md — checkpoint: key-prefix verification list (OpportunitySplit 049 mandatory), labels, name fields, AutoNumber format, length conflicts (BASE2-06)
- [x] 10-04-PLAN.md — the 18 objects as generated data with pinned inputs, overrides (D-19 lookups), loader and upgrade tests (BASE2-06, BASE2-07)
- [x] 10-05-PLAN.md — engine/SOQL/REST behaviour of the 18 (flags, required fields, lookup codes, case twins), describe-check 14 -> 32 (BASE2-06, BASE2-07)
- [x] 10-06-PLAN.md — conformance and both test backends, SC4 warning-count shifts, D-20 wording table, docs, DE retrieve check (BASE2-06..08)
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
**Plans**: 9 plans
Plans:
- [x] 11-01-PLAN.md — Wave 0: conformance/cmdt-check fixture + expected facts, jsforce/simple-salesforce legs, seed.test.ts scaffold (CMDT-01..04, CSET-01, CSET-02)
- [x] 11-02-PLAN.md — type contracts (MetadataRelationship, customMetadata/customSetting, labels) + SFDX reader for records, labels, customSettingsType (CMDT-02, CMDT-03, CSET-01, CSET-02)
- [x] 11-03-PLAN.md — buildOrgSchema: __mdt objects and m pool, MetadataRelationship fields, record matching, custom-setting shape and info item, labels (CMDT-01, CMDT-03, CSET-01, CSET-02)
- [x] 11-04-PLAN.md — deriveCustomMetadataId, m00..mzz key-prefix pool, unique-Lookup index and no FK for MetadataRelationship (CMDT-01, CMDT-02, CSET-01)
- [x] 11-05-PLAN.md — soft-delete filters only where IsDeleted exists; Rel__r.QualifiedApiName and the D-10 rejection in SOQL (CMDT-03, CMDT-04)
- [x] 11-06-PLAN.md — planCustomMetadataSeed (pure) + seedCustomMetadata full sync + D-04 summary (CMDT-02, CMDT-03)
- [x] 11-07-PLAN.md — describe flags, DML refusal incl. import mode and Bulk ingest, SetupOwnerId default, HTTP tests (CMDT-01, CMDT-04, CSET-01)
- [x] 11-08-PLAN.md — CLI: up seeds and reports, check settings info line and counts; upgrade and setting-migration tests (CMDT-02, CSET-01, CSET-02)
- [x] 11-09-PLAN.md — run-all.sh second server + cmdt-check legs, phase gate on fresh schemas (CMDT-04, CSET-01)
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
**Plans**: 8 plans
Plans:
- [x] 12-01-PLAN.md — corpus baseline guard, fork-aware sync script + CI, fork integration branch, Johan pushes it (FORM-01)
- [x] 12-02-PLAN.md — resync to the fork pin + VENDOR.md baseline; typed Rel:Object segments compile, regex fallback removed, it.fails flipped (FORM-01, FORM-02)
- [x] 12-03-PLAN.md — typed polymorphic parent loading (Owner:User / Owner:Queue), no relationship-key leak in retrieve (FORM-02)
- [x] 12-04-PLAN.md — FormulaDependencies on CompiledFormula + registry fieldDependencies/ruleDependencies/usesGlobal (D-14; FORM-03, FORM-05)
- [x] 12-05-PLAN.md — $Label and $CustomMetadata at compile time, aggregated custom-metadata-record warning, registry/CLI wiring (FORM-04)
- [x] 12-06-PLAN.md — $UserRole and Hierarchy $Setup (user -> profile -> org), List setting / $Permission reasons, gated loading (FORM-03, FORM-05)
- [x] 12-07-PLAN.md — $Api via Session.request, one-time no-request warning, Bulk keeps no token, HTTP end-to-end (FORM-03)
- [x] 12-08-PLAN.md — phase gate incl. check --strict and run-all.sh; close todo, PROJECT.md row, REQUIREMENTS (FORM-01..05)
**Research flag**: YES, small (`$Setup` null-field fall-through, `$Api` URL shapes, `$Label` casing).

### Phase 13: Roll-Ups over Formula Fields
**Goal**: A roll-up summary can aggregate or filter on a formula field in the cases Salesforce permits, and fails soft in the cases it does not.
**Depends on**: Phase 12 (structured formula registry and dependency list)
**Requirements**: ROLL2-01
**Success Criteria** (what must be TRUE):
  1. A COUNT, SUM, MIN or MAX roll-up whose summarized or filter field is a same-object, non-volatile formula loads, and inserting, updating, deleting or undeleting child rows changes the parent value exactly as for a stored-field roll-up (including when a field the formula reads changes).
  2. Upgrading a database that already holds children backfills the formula roll-up once, and a second `orglet up` is silent.
  3. A roll-up over a formula with a cross-object path, `NOW`/`TODAY`/`TIMENOW`, or a `$User`, `$Profile`, `$Setup` or `$Api` root loads without failing, logs `UNSUPPORTED:rollup-formula` and skips that field.
  4. A formula-to-roll-up-to-formula cycle is detected and reported rather than looping.
**Plans**: 8 plans

Plans:
- [x] 13-01-PLAN.md — Wave 0: relax metadata formula gates, add volatileReasons, probes, test scaffolds
- [x] 13-02-PLAN.md — formulaInputs / dependencyOrder dependency walk in @orglet/formula
- [x] 13-03-PLAN.md — admitFormulaRollups: UNSUPPORTED:rollup-formula / rollup-cycle at load
- [x] 13-04-PLAN.md — derived-table SQL (unnest) with scale rounding, isFormulaRollup
- [x] 13-05-PLAN.md — _orglet.rollup_backfills marker helpers, migrate pendingBackfills
- [x] 13-06-PLAN.md — dependency-ordered formulas, watched sets, recompute over evaluated values
- [x] 13-07-PLAN.md — DmlEngine.backfillFormulaRollups (once, chain order, crash-safe)
- [x] 13-08-PLAN.md — CLI wiring (check/up/reset), PROJECT.md docs, phase gate
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
**Plans**: 12 plans (7 executed, 5 gap closure)
Plans:
- [x] 14-01-PLAN.md — report core: field-type diagnostic gets its object, pure buildCheckReport (root-cause grouping, counts, code-point order), summary redaction and formatters (CHECK-01, CHECK-02)
- [x] 14-02-PLAN.md — examples/enterprise fixture (acme superset, every v1.1 category, generic names) + category-coverage and --strict test (ACC2-01)
- [x] 14-03-PLAN.md — close the standard-field-gaps todo: SyncedQuoteId lookup, reasoned overrides, DE-describe checkpoint, regenerate, exclusions as counts (ACC2-03)
- [x] 14-04-PLAN.md — wire the report into orglet check: --summary/--json, locked flag interplay, acme snapshots, byte-identical warning lines (CHECK-01, CHECK-02)
- [x] 14-05-PLAN.md — run-all.sh PROJECT/FIXTURE, enterprise seed script, describe-check enterprise objects, CI check --strict step and conformance matrix (ACC2-01, ACC2-02)
- [x] 14-06-PLAN.md — poly-check (OwnerId narrowing, colon syntax) and rollup-check (roll-up over formula) extensions through both SDKs (ACC2-02)
- [x] 14-07-PLAN.md — acceptance: full gate on both fixtures and backends, checkpoint for the author's DE and large retrieves, counts per area, ticks (ACC2-01..03, CHECK-01/02)
- [x] 14-08-PLAN.md — gap closure: bare FieldDefinition values resolved through metadataRelationshipControllingField (supersedes Phase 11 D-11), enterprise fixture case (ACC2-03)
- [x] 14-09-PLAN.md — gap closure: baseline relationshipName for 14 single-target lookups via overrides.json, generator guard for identifier-shaped relationship names (ACC2-03)
- [x] 14-10-PLAN.md — gap closure: report groups a formula on a standard field outside the baseline under an implied standard-field root (ACC2-03, CHECK-01)
- [ ] 14-11-PLAN.md — gap closure: standard-field round 2, author checkpoint for the 19 public field names, overrides or counted exclusions (ACC2-03)
- [ ] 14-12-PLAN.md — gap closure: full gate, author re-run of DE and large retrieves with per-category counts, counted exclusions in conformance/README.md, ACC2-03 tick if met (ACC2-03)
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
| 9. Baseline Generator, Parity & OwnerId Narrowing | v1.1 | 9/9 | Complete | 2026-10-14 |
| 10. Business Standard Objects | v1.1 | 6/6 | Complete    | 2026-10-16 |
| 11. Custom Metadata, Custom Settings & Labels | v1.1 | 9/9 | Complete    | 2026-10-21 |
| 12. sigha Resync & Formula Globals | v1.1 | 8/8 | Complete    | 2026-10-23 |
| 13. Roll-Ups over Formula Fields | v1.1 | 8/8 | Complete    | 2026-10-24 |
| 14. Check Report & Enterprise Acceptance | v1.1 | 10/12 | In Progress|  |

## Backlog

Unsequenced ideas captured for a later milestone. Source: gaps observed when loading a large real-org retrieve after v1.0 (reported by area only). Promote with `/gsd:review-backlog`.

### Phase 999.1: Narrow baseline OwnerId referenceTo per object (BACKLOG)

**Goal:** OwnerId is User-only on objects that cannot be queue-owned (Account, Opportunity, Contract, Contact, ...) and User|Group only where Salesforce allows queues (Case, Lead, custom objects with queues), so plain Owner.X formula traversal and Owner.X SOQL compile as in a real org. Folds the pending todo 2026-10-08-narrow-baseline-ownerid-per-object; the largest single source of formula warnings on a real retrieve.
**Requirements:** TBD
**Plans:** 10/12 plans executed

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
