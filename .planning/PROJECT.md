# orglet

## What This Is

orglet is a self-hosted, single-tenant emulator of the Salesforce platform: "LocalStack, but for
Salesforce". Point it at an SFDX project (the output of `sf project retrieve`) and it builds the
org in Postgres and speaks the Salesforce REST API, so existing clients such as `jsforce` and
`simple-salesforce` work unchanged. It is Johan's personal open-source side project (Apache-2.0),
built to see how far a well-documented, old platform can be reproduced from public documentation
and SDK source alone. Users are developers who want a local org for development, integration
tests and CI, and eventually a small self-hosted CRM that can be migrated to the real thing.

## Core Value

A Salesforce client pointed at orglet cannot tell the difference for the surface orglet claims to
support, and anything it does not support is logged as `UNSUPPORTED:<area>` rather than faked.

## Current State

**Shipped:** v1.0 "hardening" on 2026-10-12 (phases 1-7, 37 plans, PRs #1-#7; archive in
`.planning/milestones/`). The headless Salesforce-compatible API on Postgres loads Johan's Developer
Edition retrieve with zero `UNSUPPORTED` warnings under `orglet check --strict`, runs its 431-test suite
on embedded pglite without Docker, and is verified by pinned jsforce and simple-salesforce conformance
runs executed in CI on every push. After v1.0 a large real enterprise-org retrieve was loaded locally:
it loads (141 objects, ~3 600 fields) but with several hundred warnings in a handful of areas, which
define the next milestone.

**v1.1 progress:** Phase 8 complete 2026-10-13 — upgrade safety net (populated v1.0 upgrade test on
pglite and Postgres 16, `UNSUPPORTED:schema-fk`, idempotent second `up`), nullable key prefixes end to
end, structured diagnostic records beside the unchanged warning strings, and the two upstream sigha
branches pushed to snorf/sigha (PRs not yet opened). Phase 9 complete 2026-10-14 — the standard-object
baseline is now generator output (`scripts/gen-baseline`, offline, from a pinned sf-skills snapshot and a
facts-only Object Reference extraction, with `overrides.json` hand facts and a CI drift gate): the 35
objects grew from 659 to 2 536 fields with v1.0 fields byte-identical, 135 fields tagged `featureGated`,
skips listed in `PROVENANCE.json` (accepted documented skip ratio 0.103), a v1-vs-v2 diff gate plus
MasterDetail refusal (MIGR-03), and per-object `ownerTargets` (eight User-only objects; Owner.X now
compiles in formulas and SOQL on Account, Contact, Opportunity, Contract, Asset, Campaign). 575 tests,
conformance 8/8 legs green locally. Phase 10 complete 2026-10-16 — the 18 business objects (Quote, QuoteLineItem, Order,
OrderItem, AccountContactRelation, AccountTeamMember, OpportunityTeamMember, OpportunityContactRole,
OpportunitySplit, ContractLineItem, CaseContactRole, CaseMilestone, EmailMessage, ContentDocument,
ContentVersion, FeedItem, Location, Address) are generated baseline objects with DE-confirmed key prefixes,
DML flags from the Object Reference "Supported Calls" line, documented-required fields kept required, and
blob/junction/geolocation fields omitted and reported; `orglet check` separates referenced from
unreferenced unmodelled standard objects (one `info:` line, never a `--strict` failure); roll-ups over
Quote.OpportunityId are allowed and a roll-up over an unlisted lookup degrades with
`UNSUPPORTED:rollup-relationship` instead of failing the load. 632 tests on Postgres 16, conformance
8/8 legs green with describe-check 32/32 on both SDKs, DE retrieve check exit 0 with 0 warnings over
55 objects. Stopgap: ContentVersion.ContentDocumentId is nullable until file upload is done properly
(backlog 999.10).
Phase 11 complete 2026-10-21 — custom metadata types load as read-only `__mdt` objects with their
`customMetadata/` records seeded as rows (Ids derived from a hash of type and DeveloperName, so they are
stable across restarts and `reset`; full sync per type on every `up`), `MetadataRelationship` fields load
(mdt-to-mdt as a lookup, EntityDefinition/FieldDefinition as the qualified API name with
`Rel__r.QualifiedApiName` selectable), DML on `__mdt` is refused everywhere including import mode and Bulk
ingest, `customSettingsType` objects load as List/Hierarchy settings (`customSetting: true`, no OwnerId,
unique `SetupOwnerId` defaulting to the org), and `CustomLabels` land on `OrgSchema.labels`. New
`conformance/cmdt-check` fixture and legs (8/8 on both SDKs), 725 tests on pglite, 727 on Postgres 16,
10/10 conformance legs green. Test infrastructure: `test/db.ts` filters pglite's premature ReadyForQuery
(electric-sql/pglite#958) so repeated unique violations no longer desync pg.
Phase 12 complete 2026-10-23 — the vendored sigha is resynced to a pinned fork commit
(`snorf/sigha` `integration/phase-12`, `ff6c108`) that lexes unary `!` and the `Relationship:Object.Field`
colon syntax; an orglet-owned corpus guard locks the measured baseline (6 312 pass of 9 730 rows on
`salesforce-v2.json`) and CI re-syncs from the `Repository:` line in `VENDOR.md`. `Owner:User.Email` and
`Owner:Queue.QueueName` load the typed parent only when the Id prefix matches (blank otherwise), traverse
further like an ordinary lookup, and loaded parents no longer leak into REST retrieve output. Every compiled
formula carries a dependency list (fields per object, global roots, volatility) exposed on
`FormulaRegistry`. New globals: `$Label` and `$CustomMetadata` at compile time (unknown record = blank plus
one aggregated warning), `$UserRole`, hierarchy `$Setup` merged per field user → profile → organization,
and `$Api` (`Partner_Server_URL_<n>`, `Enterprise_Server_URL_<n>` with version n/10, `Session_ID`) from an
optional `Session.request` that only REST requests carry; `$Permission` and `$Setup` on List settings stay
`UNSUPPORTED:formula-global` with the reason stated. 805 tests on pglite, 807 on Postgres 16, 10/10
conformance legs, CI green on Linux including `sigha-sync-check`.
Phase 13 complete 2026-10-24 — roll-ups over same-object, non-volatile formula fields: metadata admits them,
`admitFormulaRollups` in `@orglet/formula` removes the ones Salesforce forbids or orglet cannot keep consistent
(cross-object reads, NOW/TODAY and evaluation-time globals, formula cycles) with `UNSUPPORTED:rollup-formula` /
`rollup-cycle` / `rollup-target` diagnostics, the engine recomputes them over TypeScript-evaluated child values
bound as an `unnest` derived table (stored-field roll-ups keep the pure SQL path), and `orglet up` backfills
each formula roll-up once behind an `_orglet.rollup_backfills` marker so a second `up` is silent. 866 tests
on pglite, 869 on Postgres 16, 10/10 conformance legs.
Phase 14 complete 2026-10-31 — `orglet check` is a report: census line, verdict, per-area table and
root-cause groups (dependents folded under the diagnostic that caused them, including an implied
`standard-field` root for formulas on baseline-excluded standard fields), `--summary` redacted to counts and
area tokens, `--json` for tooling, `warning:` lines unchanged. Public enterprise-shaped fixture
`examples/enterprise` (63 objects, 3 742 fields, custom metadata, custom settings, labels, roll-ups,
polymorphic lookups) passes `check --strict` and the full conformance set (11/11 legs) beside acme (10/10).
Gap closure after the first acceptance: bare FieldDefinition values resolve through the controlling
EntityDefinition field, 14 baseline lookups gained relationshipNames behind a generator guard, and a second
standard-field round modelled 5 more fields and accepted 14 exclusions (16 + 1 + 16 counted exclusions in
total, names never recorded). Author's DE retrieve: exit 0, 0 warnings. Large real-org retrieve: 94 warnings,
every one inside a counted exclusion category documented in `conformance/README.md` (platform events,
`$Permission`, managed package not retrieved, retrieve incomplete, accepted standard fields). 922 tests on
pglite, 924 on Postgres 16.

## Current Milestone: v1.1 real-org fidelity

**Goal:** A large, real enterprise-org retrieve loads with zero warnings for everything it itself
references: every object and field that a lookup, formula, roll-up or validation rule points at exists,
is described correctly and behaves as in Salesforce. Standard objects nothing references are reported
in a quiet informational category, not as warnings.

**Target features:**
- Standard-object baseline v2 generated from the public Object Reference: field parity for the
  existing 35 objects (incl. the thin phase-3 ones) and the business objects a typical sales/service org
  references (Quote, QuoteLineItem, Order,
  OrderItem, AccountContactRelation, AccountTeamMember, OpportunityTeamMember, OpportunityContactRole,
  OpportunitySplit, ContractLineItem, CaseContactRole, CaseMilestone, EmailMessage, ContentDocument/ContentVersion,
  FeedItem, Location/Address).
- Formula coverage: `$UserRole`, `$Api`, `$Setup`, `$Label`, `$CustomMetadata` globals; OwnerId
  `referenceTo` narrowed per object so plain `Owner.X` compiles; `Relationship:Object.Field` colon
  syntax and the `!` operator fixed upstream in sigha and resynced. `$Permission` stays an explicit
  `UNSUPPORTED:formula-global` until the security milestone.
- Custom metadata types as read-only objects with rows from `customMetadata/` in the retrieve,
  `MetadataRelationship` fields; list/hierarchy custom settings with `$Setup` semantics.
- Roll-up summary over formula fields where Salesforce allows it.
- `orglet check` report quality: root-cause reporting for cascaded formula failures, a quiet category for
  unreferenced system objects, per-area summary counts.

**Acceptance:** a public fixture (an extended `examples/acme` or a new `examples/enterprise`, all custom
metadata under generic names) covers every category and runs in CI with `--strict`; Johan's Developer
Edition retrieve keeps loading clean; the large org is run only locally and reported, if at all, as
warning counts per area. Backlog items promoted: 999.1-999.7. Left in backlog: 999.8 platform events,
999.9 Heimdall end-to-end.

## Requirements

### Validated

Phase 0 (headless API) shipped 2026-09-25 and is verified by the upstream SDK suites in
`conformance/`. Everything below exists in the codebase today (see `.planning/codebase/`).

- ✓ SFDX source-format metadata parser: objects, fields, validation rules, record types, global
  and standard value sets — existing (`packages/metadata`)
- ✓ Built-in standard-object baseline of 21 objects with system fields, key prefixes and
  documented field lists — existing (`packages/metadata/standard/objects/*.json`)
- ✓ `OrgSchema` → Postgres DDL, additive migration on reload via `information_schema` diff,
  15/18-character Salesforce IDs with checksum — existing (`packages/schema`)
- ✓ Formula engine on vendored `sigha` (MIT) bound to record context (`$User`, `$Profile`,
  `$Organization`, PRIORVALUE/ISCHANGED/ISNEW, one-hop parent references) — existing
  (`packages/formula`, `packages/sigha`)
- ✓ SOQL → parameterised SQL with Salesforce result shaping: parent dot-notation, child
  subqueries, aggregates, semi-joins, date literals, `FIELDS()`, pagination via stateless
  `nextRecordsUrl`, `queryAll` — existing (`packages/soql`)
- ✓ DML pipeline with the documented order of execution: system validation, before/after hook
  interface (`TriggerExecutor`), custom validation rules, delete constraints (cascade /
  restrict / set-null), soft delete and undelete, upsert on external ID, all-or-none and
  partial success with per-record savepoints, Salesforce error codes — existing
  (`packages/engine`)
- ✓ Salesforce-compatible REST surface on Fastify: OAuth2 token (password, client_credentials,
  refresh_token), SOAP login, userinfo/identity, sobjects CRUD, describe, global describe,
  query/queryAll/explain, composite (`/composite`, `/composite/batch`, `/composite/tree`,
  `/composite/sobjects`), `updated`/`deleted`, limits, `Sforce-Limit-Info` — existing
  (`packages/api`)
- ✓ Bulk API 2.0 ingest and query jobs, synchronous in-request processing — existing
  (`packages/api/src/bulk`, `packages/api/src/routes/bulk.ts`); persisted since Phase 6
- ✓ Import mode (`orglet up --import`): keeps supplied Ids and audit fields, skips lookup checks,
  rules and hooks, FKs off via `session_replication_role` — existing
- ✓ CLI `orglet up | check | reset` and a built-in page at `/` with object browser and SOQL
  console — existing (`packages/cli`, `packages/api`)
- ✓ Conformance: `simple-salesforce` script 26/26, `jsforce` e2e subset 51 passing with Bulk,
  SOSL, layouts, list views, tabs, theme and recent items excluded — existing (`conformance/`)
- ✓ Johan's own Developer Edition retrieve (12 custom-touched objects, ~500 fields; now 23
  objects, 861 fields) loads and serves CRUD, hierarchy lookups and parent SOQL — verified
  2026-09-26 and re-verified 2026-09-29
- ✓ Unit and integration tests run without Docker on embedded pglite (one instance per test file,
  `test/db.ts`); `session_replication_role` and `information_schema` verified on pglite 0.5.8;
  Docker Compose unchanged for the running server — Phase 1 (2026-10-01)
- ✓ Public repository `snorf/orglet` with GitHub Actions jobs `test-pglite` and `test-postgres`
  running build, lint and the full suite on every push and PR; `main` protected by a ruleset
  requiring both checks and a PR — Phase 1 (2026-10-01)
- ✓ Custom-object key prefixes are assigned once by `orglet up` and persisted in the sibling
  `_orglet.key_prefixes` schema (keyed by org schema), seeded from existing records or a
  `--key-prefixes` mapping, never shifted by adding, removing or renaming objects; every
  contradiction with a standard or persisted prefix fails the load; `orglet check` reports
  provisional prefixes and `orglet reset` keeps rows unless `--drop-prefixes` — Phase 2
  (2026-10-02)
- ✓ Thin baselines for the 14 standard objects a Developer Edition references (BusinessHours,
  BusinessProcess, CallCenter, DandBCompany, Entitlement, ExternalDataSource, IdeaTheme,
  Individual, OperatingHours, OpportunityHistory, ServiceAppointment, ServiceContract,
  SocialPost, UserLicense) with documented prefixes, name fields and explicit DML flags;
  lookups to them are reference-checked; writes that violate a flag return
  `INVALID_TYPE_FOR_OPERATION` (bypassed in import mode); bootstrap seeds a default
  BusinessHours and a "Salesforce" UserLicense; describe verified through jsforce and
  simple-salesforce via `conformance/describe-check`; the DE retrieve loads with zero
  `UNSUPPORTED:reference-target` — Phase 3 (2026-10-08)
- ✓ Polymorphic lookups resolve per row: one shared `matchTargetByPrefix` rule in `@orglet/schema`
  used by the write path and formula parent loading; SOQL joins each modelled target with a key
  prefix filter and shapes `attributes.type` from the concrete object; the Name pseudo-object
  returns `null` for user-only fields on a Group owner; `<rel>.Type` is filterable in `WHERE`;
  `TYPEOF ... WHEN ... THEN ... [ELSE ...] END` compiles and shapes the matching branch per
  row; an unmodelled key prefix is a `null` parent (ELSE or not, D-19) plus one
  `UNSUPPORTED:reference-target` warning per query; every documented invalid TYPEOF form is
  `MALFORMED_QUERY` naming the restriction; proven through jsforce and simple-salesforce via
  `conformance/poly-check`. Formula leg is a recorded partial: the vendored sigha lexer cannot
  parse `Owner:Group.Name`, so it raises `UNSUPPORTED:formula` and plain `Owner.Name` through a
  polymorphic lookup is rejected at compile time (D-16, todo pending) — Phase 4 (2026-10-08)

- ✓ Roll-up summary fields: `Summary` metadata resolves into stored, read-only columns typed per
  operation (COUNT/SUM/MIN/MAX, every documented filter operator incl. field-to-field, over
  non-deleted children); a roll-up over a plain lookup fails load unless it is one of the three
  documented standard relationships (D-05); recompute runs in the app-side save pipeline after the
  child's after-hooks on insert, update (incl. filter-only and reparent, both parents), delete,
  undelete and multi-level chains, through the parent's own hooks and validation rules under a
  batch savepoint with replay so a refusing parent fails exactly the children that point at it
  (D-01/D-03); `migrate()` backfills a newly added roll-up column once (D-10); describe reports
  `calculated`, REST/Bulk reject client values, SOQL selects/filters/sorts them; proven through
  jsforce and simple-salesforce via `conformance/rollup-check`, suite green on pglite and
  Postgres 16, DE retrieve loads with zero warnings — Phase 5 (2026-10-09)
- ✓ Bulk API 2.0 jobs persist in Postgres and survive a restart: ingest and query jobs,
  uploaded CSV, per-row results and query rows live in four `_orglet.bulk_*` tables keyed per
  org (D-01); `orglet reset` deletes the org's jobs (D-02); one guarded `setJobState` is the
  only writer of `state` and clients may set only `UploadComplete`/`Aborted` (D-08); each
  200-row chunk's DML and its result rows commit in one transaction through the new
  `DmlEngine.transaction` seam (D-19), so `unprocessedrecords` is crash-truthful; boot
  reconciles `UploadComplete`/`InProgress` rows to `Failed` (D-07/D-16); jobs older than 7
  days from `createdDate` are purged at boot and on every `/jobs` request, hard-coded
  (D-09..D-12); Bulk query SOQL rejects TYPEOF, GROUP BY, OFFSET, aggregates,
  Address/Location fields, `FIELDS()` and child subqueries via an AST check beside the Bulk
  code with `400 FEATURE_NOT_ENABLED`, no `UNSUPPORTED:` prefix (D-14..D-18); results pages
  always carry `Sforce-Locator`/`Sforce-NumberOfRecords` (D-20); proven by 11 HTTP restart,
  scoping, reset, reconcile and retention tests plus a real `orglet up` kill/restart smoke,
  suite green on pglite and Postgres 16 — Phase 6 (2026-10-10)

- ✓ Milestone acceptance verified and dated (2026-10-12): `orglet check --strict` (new flag, exit 1
  on any warning) against Johan's Developer Edition retrieve reports exit 0 and 0 warnings
  (`37 objects (2 custom), 983 fields`; baseline 2026-09-29: 15 warnings); jsforce e2e subset
  51/0/60 (core) plus Bulk API 2.0 `bulk2.test.ts` 12/0/5 with every exclusion classified
  (Bulk v1 by design, Data.com `Jigsaw*` fields, empty-upload semantics undocumented, two
  upstream test defects); simple-salesforce 29/29 incl. three Bulk 2.0 checks; describe/poly/
  rollup checks green on both SDKs; `conformance/run-all.sh` runs all eight legs in a new,
  non-required CI job `conformance` (green on first run); `conformance/README.md` holds the
  dated overview and both harness READMEs carry dated tables with a reason per exclusion;
  jsforce pinned to sha `9bae14e`, `simple-salesforce==1.12.10`; Bulk 2.0 `sf__Error`
  separator fixed to `:Name --` — Phase 7 (2026-10-12)

Validated in Phase 8 (v1.1, 2026-10-13):

- ✓ A populated v1.0 database upgrades under the current code without data loss: FK violations
  downgrade to `UNSUPPORTED:schema-fk` warnings and a second `orglet up` is silent — MIGR-01, MIGR-02, MIGR-04
- ✓ Standard objects without a confirmed key prefix load with `keyPrefix: null` plus a source label,
  describe correctly and never take part in prefix-based polymorphic matching — BASE2-05

Validated in Phase 10 (v1.1, 2026-10-16):

- ✓ The 18 business objects exist as generated baseline objects with documented key prefix, name
  field, system fields, documented API fields and explicit DML flags; blob fields are omitted and
  listed in the generator report — BASE2-06
- ✓ DML against the 18 respects the documented flags with `INVALID_TYPE_FOR_OPERATION`; a lookup with
  an unparsable Id is `MALFORMED_ID`, a wrong-type or missing Id is `INVALID_CROSS_REFERENCE_KEY` — BASE2-07
- ✓ `orglet check` keeps the warnings of a referenced-but-unmodelled standard object and reports an
  unreferenced one on an informational line that never fails `--strict` — BASE2-08

Validated in Phase 11 (v1.1, 2026-10-21):

- ✓ `__mdt` types load as read-only objects with the documented system fields, `m`-series key prefixes
  persisted like custom objects, and describe flags that claim only describe, query and retrieve — CMDT-01
- ✓ `customMetadata/` record files are seeded with hash-derived stable Ids, values coerced by the declared
  field type (`"007"` stays text, `xsi:nil` is null), removed records disappear on reload, anomalies warn
  and load — CMDT-02
- ✓ `MetadataRelationship` loads: mdt target as the record Id with ordinary `Rel__r` traversal,
  entity/field-definition target as the qualified API name with `Rel__r.QualifiedApiName` selectable,
  dangling targets null plus one warning — CMDT-03
- ✓ Describe, SOQL and REST retrieve of `__mdt` work through jsforce and simple-salesforce; insert, update,
  delete, upsert, composite and Bulk ingest are refused with `INVALID_TYPE_FOR_OPERATION` — CMDT-04
- ✓ `customSettingsType` objects load as List/Hierarchy settings (`customSetting: true`, no OwnerId,
  `SetupOwnerId` unique with the org as default, `DUPLICATE_VALUE` on a second row); `orglet check`
  states that setting data is not part of a retrieve — CSET-01
- ✓ `CustomLabels.labels-meta.xml` loads onto `OrgSchema.labels` with name, value, language, category,
  protected and short description — CSET-02

Validated in Phase 12 (v1.1, 2026-10-23):

- ✓ sigha resynced to a pinned fork commit recorded in `VENDOR.md` with `Repository:` + `Revision:` lines,
  `!` as NOT and colon syntax lexed, corpus baseline 6 312/9 730 locked by `packages/sigha/test/corpus-baseline.test.ts`,
  `sync-sigha.sh` proven on macOS locally and on Linux in CI — FORM-01
- ✓ `Rel:Object.Field` compiles against a declared target (`Queue` aliases `Group`, `QueueName`/`QueueEmail`
  alias `Name`/`Email`), evaluates blank for the other type, and an unreferenceable qualifier is a compile
  error `Field … does not exist. Check spelling.` — FORM-02
- ✓ `$UserRole.<field>` from the running user's role (blank without one); `$Api.*` from the request's base URL
  and bearer token, blank with one aggregated warning per formula when no request context exists — FORM-03
- ✓ `$Label` and `$CustomMetadata` resolved at compile time from loaded labels and records; unknown label,
  type or field is a compile error, unknown record is blank with one `UNSUPPORTED:custom-metadata-record`
  warning — FORM-04
- ✓ Hierarchy `$Setup` merged per field user → profile → organization → blank, queried only when a formula
  uses it; List `$Setup` and `$Permission` stay `UNSUPPORTED:formula-global` with the reason — FORM-05

Validated in Phase 14 (v1.1, 2026-10-31):

- ✓ `orglet check` prints census, verdict, per-area table and root-cause groups; deterministic output,
  `warning:` lines byte-identical to before — CHECK-01
- ✓ `--summary` carries counts and area tokens only, `--json` is the machine form, `--strict` exit code
  unchanged — CHECK-02
- ✓ `examples/enterprise` is a public enterprise-shaped fixture that passes `check --strict` with the full
  conformance set green against it — ACC2-01
- ✓ poly-check and rollup-check cover the v1.1 features (OwnerId narrowing, typed Owner traversal, formula
  roll-ups) on both SDKs — ACC2-02
- ✓ DE retrieve loads with exit 0 and 0 warnings; the large retrieve's 94 warnings are all counted exclusions
  documented by category in `conformance/README.md` (relaxation from literal zero recorded in
  REQUIREMENTS.md) — ACC2-03

### Active

Milestone v1.1 "real-org fidelity" (see Current Milestone above). Requirements are defined in
`.planning/REQUIREMENTS.md` and mapped to phases 8+ in `.planning/ROADMAP.md`.

### Out of Scope

- UI API, LWC/SLDS front end — own milestone after hardening; the built-in page at `/` is
  enough for now
- Flow interpreter, CDC/Platform Events to Kafka/SQS, Pub/Sub API, security model (profiles,
  permission sets, FLS, OWD) — planned phase 2, not needed for a clean headless load
- Apex runtime — planned phase 3, sits behind the existing `TriggerExecutor` interface
- Task/Event with polymorphic `WhoId`/`WhatId` as full objects, SOSL, Metadata API zip import,
  compound fields in SOQL select, record types per picklist — rest of the original phase 1,
  deferred to a later milestone so this one stays small
- SLDS 2 and `lightning-base-components` — non-OSI licence / deprecated; use SLDS 1 with system
  fonts when a GUI comes
- Behaviour-diffing against a real Salesforce org — the Developer MSA forbids benchmarking and
  competitive use; everything is built from public docs and SDK source
- Business rules as Postgres triggers — the Salesforce order of execution needs
  PRIORVALUE/ISCHANGED and before-hooks that can mutate the record, so rules live in the app

## Context

**Codebase (after v1.0).** pnpm monorepo, TypeScript strict, Node 22, ESM. Layered packages
`metadata → schema → {formula, soql} → engine → api → cli`, plus the vendored `sigha` formula
engine synced by `scripts/sync-sigha.sh` and never hand-edited. ~14 600 lines of source (excl. sigha),
427 tests in 25 files (vitest) running on embedded pglite by default and on Postgres 16 when
`ORGLET_DATABASE_URL` is set. CI: `test-pglite`, `test-postgres`, `conformance`. Conformance harnesses
under `conformance/` (jsforce pinned to `9bae14e`, `simple-salesforce==1.12.10`, describe/poly/rollup
checks, `run-all.sh`). Full map in `.planning/codebase/` (STACK, INTEGRATIONS, ARCHITECTURE, STRUCTURE,
CONVENTIONS, TESTING, CONCERNS); the codebase map predates v1.0 in places.

**Known gaps (updated after v1.0).** Closed in v1.0: polymorphic first-target resolution (phase 4),
`Summary` fields skipped at load (phase 5), alphabetical key-prefix recomputation (phase 2), no CI /
Docker-only tests (phase 1), in-memory Bulk jobs (phase 6). Still open:
- `ExternalLookup`, `IndirectLookup`, `MetadataRelationship` field types are skipped at load
  (`UNSUPPORTED:field-type`)
- ID counter is process-local (monotonic logical clock since phase 2, still unsynchronised across processes)
- `/composite` with `allOrNone` does not roll back earlier committed subrequests (`UNSUPPORTED:composite-rollback`)
- Bulk jobs are processed synchronously inside the request (no worker); CSV and results buffered in full
- Default auth is permissive (any password); session tokens in-memory and unbounded; `sharingModel` unused
- Formula evaluation is per row after fetch; polymorphic formula references need sigha colon syntax (D-16)
- Roll-ups: no re-backfill on definition change, no date-literal filters, no parent row locking
- Roll-ups over formula fields (Phase 13): recompute loads and evaluates in TS every live child of each affected parent (O(children of affected parents), no cap); the one-time backfill reads all live rows of the child object into memory for a single UPDATE (D-15). Formula values are rounded to the formula's scale before aggregation as an orglet choice (no public statement found, D-05). Admission is stricter than the documented minimum: evaluation-time globals ($User, $Profile, $Organization, $RecordType, $UserRole, $Setup, $Api) are rejected like NOW/TODAY (D-01)

**Verified baseline 2026-09-29.** `orglet check` against Johan's Developer Edition retrieve
(`~/Development.nosync/devrandom-metadata`, Level 1 data): 23 objects (2 custom), 861 fields,
15 warnings — one `UNSUPPORTED:field-type` for a Summary field and 14
`UNSUPPORTED:reference-target` for the missing standard objects listed above.

**Prior art.** Nimbus (Go, closed source, freemium) and aer (proprietary). No open-source
Salesforce emulator, SOQL→SQL translator or Flow executor exists.

**Original plan.** `~/.claude/plans/crystalline-dancing-scone.md` holds the phase-0 spec,
outcome and the phase 1–3 roadmap; this document supersedes it for scope, the plan stays as
reference for the per-package spec.

**Working conventions.** Chat in Swedish; code, commits and repo docs in English. Commit at every
milestone, only on green lint and tests. Sonnet subagents for plumbing and transcription, Fable
for the core engines (SOQL, formula, save pipeline). Tele2 metadata is never test input (Level
2+); only Johan's own Developer Edition or the `examples/acme` fixture. A dev server usually runs
on port 8180 with the `devrandom` org schema.

## Constraints

- **Legal**: Build only from public documentation and open-source SDK source; never diff
  behaviour against a real org — Developer MSA forbids benchmarking and competitive use of
  Developer Edition
- **Trademark**: Nominative "compatible with Salesforce" only; no "-force" naming; README carries
  the non-affiliation notice — Salesforce trademark rules
- **Licensing**: Apache-2.0 project; dependencies must be OSI-licensed (sigha MIT,
  soql-parser-js MIT, formula-engine corpus BSD-3); no SLDS 2, no Salesforce Sans
- **Tech stack**: TypeScript strict, Node 22, pnpm 10+, Postgres 16, Fastify 5, vitest — already
  established, do not fork conventions
- **Data**: Only Level 1 data in the emulator and in Claude context; Tele2 metadata excluded
- **Compatibility**: Existing conformance suites must stay green; the `UNSUPPORTED:<area>`
  convention is mandatory for anything not implemented
- **Identity**: Repo-local git identity Johan Karlsteen <johan@karlsteen.com>; the global config
  is a Tele2 service account and must not leak into commits
- **Outward-facing actions**: Creating the GitHub repository and the first push are confirmed
  with Johan before they happen

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Name "orglet" | "Localforce" violates Salesforce trademark rules and is taken; orglet free on npm/PyPI/GitHub | ✓ Good |
| TypeScript/Node 22 + pnpm monorepo, Postgres | Same language as the SDK ecosystem; Postgres gives FKs, savepoints, information_schema | ✓ Good |
| Formula engine = vendored sigha, gaps fixed upstream | Verified against the official formula-engine corpus (6 312 cases); no own parser | ✓ Good |
| Business rules in the app save pipeline, never DB triggers | Order of execution needs PRIORVALUE/ISCHANGED and mutable before-hooks | ✓ Good |
| Schema diff via information_schema, no own state table | Database is the source of truth; simpler reload | ✓ Good |
| Phase 0 headless, GUI later | Conformance against SDKs is the real acceptance test | ✓ Good |
| No behaviour-diffing against a real org | Developer MSA | ✓ Good |
| Milestone 1 = hardening only (TYPEOF, roll-ups, thin baselines, key-prefix persistence, Bulk persistence, pglite, GitHub + CI) | Small milestone that makes a real DE retrieve load clean and makes the project public and CI-tested before the GUI | ✓ Good (all 7 phases complete 2026-10-12; DE retrieve 0 warnings, both SDK suites green and dated) |
| Persist custom-object key prefixes | Alphabetical recomputation shifts prefixes when objects are added; Ids must be stable | ✓ Good (Phase 2; sibling `_orglet` schema so `reset` keeps rows, `--key-prefixes` seed for real-org Ids) |
| pglite for tests, Docker Compose for the running server | CI without Docker, contributors without Docker; server path unchanged | ✓ Good (Phase 1; needed `maxConnections` on pglite-socket and build-before-lint in CI) |
| Phase branches with PR to a ruleset-protected `main` | Branch protection only means something if every change goes through CI | ✓ Good (Phase 1) |
| Polymorphic target chosen by key prefix, one shared rule, per-target LEFT JOINs in SOQL | Read and write paths must agree on the concrete object; SQL cannot call TS, so both derive from `SObjectDef.keyPrefix` | ✓ Good (Phase 4) |
| Unmodelled key prefix is always a `null` parent, never a synthetic object, even in TYPEOF ELSE | Faking an object the org does not model would break `UNSUPPORTED` honesty (D-02/D-19); warning logged once per query | ✓ Good (Phase 4) |
| Polymorphic formula references deferred: colon syntax raises `UNSUPPORTED:formula`, plain traversal rejected at compile time | Vendored sigha lexer rejects `:`; no local rewriting of formula text; fix belongs upstream | ✓ Good (Phase 12: colon syntax resolved after the sigha resync to a fork pin; plain traversal still rejected as in a real org) |
| Roll-up recompute as SELECT-first correlated subqueries inside the child's batch savepoint, replaying survivors when a parent rule refuses | One SQL expression serves engine recompute and migrate backfill; a parent failure must blame exactly the children pointing at it (D-01/D-03) and a partial-success batch must count only committed children | ✓ Good (Phase 5) |
| Roll-ups over a plain lookup fail load, except the three documented standard relationships (Opportunity.AccountId, OpportunityLineItem.OpportunityId, CampaignMember.CampaignId) | Salesforce only allows roll-ups on master-detail plus those standard cases; faking others would hide a metadata error (D-05) | ✓ Good (Phase 5) |
| Migrate backfills a new roll-up column once as the last step of the migrate transaction; changing an existing roll-up's definition does not re-backfill | Deferred FK checks block `CREATE INDEX` after a second UPDATE of the same row, so backfill must come last; re-backfill deferred to a future `orglet rollup --recompute` (D-10) | ✓ Good (Phase 5; re-backfill pending) |
| Bulk jobs in `_orglet.bulk_*` tables owned by `packages/api/src/bulk`; `orglet reset` deletes the org's jobs, unlike key prefixes | Jobs are data pointing at the org's records, prefixes are identity; nothing outside `api` needs to know a job exists (D-01/D-02) | ✓ Good (Phase 6) |
| `DmlEngine.transaction(fn)` lets a DML call join a caller transaction (savepoint-isolated, events published after the outer commit) | Per-chunk Bulk results must commit atomically with the chunk's DML or `unprocessedrecords` lies after a crash (D-19); the only deliberate engine change in the phase | ✓ Good (Phase 6) |
| Bulk query restrictions as an AST check beside the Bulk code, `400 FEATURE_NOT_ENABLED` without `UNSUPPORTED:` prefix | REST SOQL must not drift when Bulk rules change; Salesforce rejects these constructs too, so they are not an orglet gap (D-15/D-17) | ✓ Good (Phase 6) |
| Retention hard-coded to 7 days from `createdDate`, purged at boot and on every `/jobs` request, no override | A client must not be able to tell orglet from Salesforce; no timers, deterministic and testable by backdating rows (D-09..D-12) | ✓ Good (Phase 6) |
| Conformance acceptance is measured, dated and reproducible: pinned SDK versions, `run.sh` default run equals the README run (two Jest invocations because Jest's `-t` filter cannot separate identically named v1/v2 tests), `conformance/run-all.sh` shared by CI and local runs | Numbers in a README are only evidence if the command that produced them is fixed and re-runnable (D-04/D-05/D-20) | ✓ Good (Phase 7) |
| Every excluded upstream test carries a classification and reason; no upstream test files are patched; fidelity bugs the suites expose are fixed only with a documented Salesforce basis (the `sf__Error` separator was; empty-upload semantics were not, so excluded) | Keeps the `UNSUPPORTED`/honesty principle for the conformance record itself (D-02/D-21) | ✓ Good (Phase 7) |
| `orglet check --strict` exits 1 on any warning; the DE retrieve check is run locally only, recording exit code, warning count and the summary line | Gives users and the acceptance record a machine-checkable gate without putting Level 1 metadata in the repo or CI (D-16/D-17) | ✓ Good (Phase 7) |
| Custom-metadata record Ids are derived (`m`-prefix + hash of type and DeveloperName), never allocated; reload is a full sync per type | A retrieve is the only source of `__mdt` rows, so the same files must yield the same Ids in every environment and after `reset`, with no new state table (Phase 11 D-01/D-03) | ✓ Good (Phase 11) |
| `EntityDefinition`/`FieldDefinition` are not modelled; a `MetadataRelationship` to them stores the qualified API name and only `QualifiedApiName` is selectable through `Rel__r` | orglet never points at something it cannot answer for; an unmodelled target is dangling by design, other paths are `INVALID_FIELD` + `UNSUPPORTED:entity-definition` (Phase 11 D-08..D-10) | ✓ Good (Phase 11) |
| `__mdt` DML refused even in import mode; custom settings share the `a` prefix pool and keep full DML | Record files are the only source of `__mdt` rows and the sync would overwrite imports; the setting prefix series is undocumented, so sharing is orglet's recorded choice (Phase 11 D-13/D-19) | ✓ Good (Phase 11) |
| Unique reference indexes on soft-delete objects are partial (`WHERE isdeleted = false`) | A deleted custom-setting row is gone for good in Salesforce, so its `SetupOwnerId` must not block a new org default; found by the cmdt-check conformance run | ✓ Good (Phase 11; existing schemas keep the old full index, no migration, phase unreleased) |
| Test harness filters pglite's premature ReadyForQuery per connection instead of upgrading pglite | electric-sql/pglite#958 is unfixed in released versions (0.5.10 / socket 0.2.13 tried, worse); the filter is test-only and documented for removal | ✓ Good (Phase 11; remove when PR #1144 ships) |
| sigha pinned to a named fork commit (`snorf/sigha` `integration/phase-12`), re-pin to upstream as a later quick task; corpus baseline locked by an orglet-owned test outside `packages/sigha/src` | Upstream PR latency must not block the phase; the sync script wipes `src/`, so the guard lives in `test/`; only `salesforce-v2.json` (BSD-3) counts | ✓ Good |
| Request context for `$Api` travels as an optional `Session.request {baseUrl, sessionId}` set only by the REST `session(req)` helper; Bulk jobs never hold the token | Engine and registry are shared across requests, so values must be per evaluation; one helper keeps the token out of persisted job state | ✓ Good |
| `CompiledFormula.dependencies {fields, globals, volatile}` is the registry's structured surface; graph, reverse index and cycle detection belong to Phase 13 | Phase 13 roll-up rules need roots and volatility, not a full graph; keeps Phase 12 bounded | ✓ Good |
| `$Setup` falls through per field user → profile → organization and then to blank, never to the field's `defaultValue`; `$Api` version suffix is API version × 10 | No public doc describes a default-value fall-through (orglet choice); `_600` = 60.0 is documented, superseding the discuss-phase guess | ✓ Good |
| CI `conformance` job added but not a required check on `main` yet | New job; promote to required once stable, as an explicit ruleset change (D-14) | — Pending |
| Roll-ups over formula fields are admitted after the build by `admitFormulaRollups` in @orglet/formula; rejected ones are removed with `UNSUPPORTED:rollup-formula` / `rollup-cycle` | metadata cannot compile formulas and compileFormula needs the finished schema; the field must be gone before DDL (D-06, D-07) | ✓ Good |
| Roll-ups over formula fields recompute over TS-evaluated child values bound as an `unnest` derived table; stored-field roll-ups keep the pure SQL path | one implementation of aggregate/filter semantics and one of formula semantics; no formula-to-SQL translation (D-15, D-16) | ✓ Good |
| Formula roll-up columns are backfilled by the engine after migrate, gated by `_orglet.rollup_backfills` (a formula roll-up with no marker row is backfilled; reset deletes the org's rows) | migrate has no formula engine; the marker makes the step crash-safe and a second up silent (D-10, D-11) | ✓ Good |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-10-31 after Phase 14 (check report and enterprise acceptance)*
