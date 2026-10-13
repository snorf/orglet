# Feature Research

**Domain:** Salesforce platform emulator — hardening milestone (SOQL TYPEOF, roll-up summary
fields, thin standard-object baselines, Bulk API 2.0 job persistence, stable key prefixes)
**Researched:** 2026-09-29
**Confidence:** HIGH for TYPEOF grammar/restrictions, roll-up metadata shape, and Bulk API 2.0
job lifecycle (all sourced from official Salesforce PDF references downloaded directly from
`resources.docs.salesforce.com`). MEDIUM for roll-up recalculation triggers and Bulk API 2.0
retention (corroborated across multiple sources but not quoted verbatim from an official page
in this pass). MEDIUM-LOW for standard-object key prefixes (no official published table exists;
cross-verified across 3 independent community sources for most objects, 1 source only for
`IdeaTheme`).

## Sourcing note

`developer.salesforce.com` and `help.salesforce.com` return HTTP 403 to automated fetches and
serve a client-rendered Aura/LWR shell respectively, so most citations below come from the
official PDF exports of the same documentation (`resources.docs.salesforce.com/.../pdf/*.pdf`),
downloaded and converted to text for this research. These are the same official reference guides
(SOQL and SOSL Reference, Bulk API 2.0 and Bulk API Developer Guide, Metadata API Developer
Guide, Object Reference for the Salesforce Platform, REST API Developer Guide), just not the HTML
rendering. Page/line references below are from the PDF text extraction, not from a live org —
consistent with the project's constraint to never diff behavior against a real org.

## Feature Landscape

### Table Stakes (Milestone Scope — Must Have)

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `TYPEOF ... WHEN ... THEN ... ELSE ... END` in `SELECT` | A real DE org's Task/Event/ContentDocumentLink-style polymorphic queries use it; jsforce/simple-salesforce clients expect it to work, not 400 | MEDIUM | Compiles to a per-row `CASE`-shaped join keyed by the row's actual key prefix (already available via `keyPrefixOf`). Grammar, restrictions and JSON result shape below are HIGH confidence, directly from the official SOQL and SOSL Reference PDF. |
| Per-row polymorphic resolution for `OwnerId`/`WhoId`/`WhatId`/`ParentId`-style fields (SOQL joins and formula parent traversal) | Today orglet always resolves to `targets[0]`; a `Task.WhoId` pointing at a `Lead` silently joins `Contact` and returns wrong/null data instead of erroring | MEDIUM | This is the prerequisite fix TYPEOF sits on top of — see Dependencies below. |
| `polymorphicField.Type` (e.g. `Owner.Type`, `Who.Type`) usable in `SELECT` and filterable in `WHERE` with any comparison operator, returning the object type as a string | Standard, documented, widely used alternative to `TYPEOF` for simple filtering; SDKs generate this pattern routinely | LOW-MEDIUM | `WHERE What.Type IN ('Account','Opportunity')` — string comparison against `.Type`, distinct from `TYPEOF`'s per-branch field shaping. Restriction: `TYPEOF` itself is *only* allowed in `SELECT`; filtering on type must go through `.Type` in `WHERE`, never `TYPEOF` in `WHERE`. |
| Roll-up summary fields (`Summary` type): load from metadata, compute COUNT/SUM/MIN/MAX with filter criteria, recompute on child DML, expose read-only via REST/SOQL | Today the field type is recognized then silently dropped (`UNSUPPORTED:field-type`); any DE org with a roll-up loses the field entirely, which breaks any client selecting it | HIGH | Must live in the engine's save pipeline (post-commit step keyed on `childRelationships`), not in `metadata` or as a formula. Requires `master-detail` relationship (see Dependencies). |
| Roll-up fields appear correctly in `describeSObject`: `calculated: true`, `calculatedFormula: null` (roll-ups aren't formulas), `createable: false`, `updateable: false`, `type` matching the underlying data (`double` for SUM/MIN/MAX on Number/Currency/Percent, `date`/`datetime` for MIN/MAX on Date/DateTime, `int`/`double` for COUNT) | Clients introspect describe to build forms/validate payloads; a roll-up field that appears writable will get rejected inserts with the wrong error shape | LOW | Confirmed describe field shape (`calculated`, `calculatedFormula`, `createable`, `updateable`) directly from the official REST API Developer Guide PDF. |
| Thin baselines for the 14 referenced-but-undefined standard objects: `BusinessHours`, `BusinessProcess`, `CallCenter`, `DandBCompany`, `Entitlement`, `ExternalDataSource`, `IdeaTheme`, `Individual`, `OperatingHours`, `OpportunityHistory`, `ServiceAppointment`, `ServiceContract`, `SocialPost`, `UserLicense` | A real DE org's `checkReferences` needs a real target row/table to validate FKs against; today these are unchecked free-text | MEDIUM (×14, but each is small) | Each needs: `Id`, a name-equivalent field (`Name` where documented as `idLookup`, otherwise the object's actual identifying field — several of these do *not* have a generic `Name` field, see per-object notes below), and standard audit fields (`CreatedDate`, `CreatedById`, `LastModifiedDate`, `LastModifiedById`, `SystemModstamp`). |
| Correct createable/updateable/deletable flags per thin-baseline object, matching documented `Supported Calls` | Getting this wrong either lets orglet silently accept writes Salesforce would reject, or blocks legitimate writes | LOW | 3 of the 14 are **read-only via the standard API** per the official Object Reference: `ExternalDataSource` (`describeSObjects(), query(), retrieve()` only), `OpportunityHistory` (same three plus `getDeleted()`/`getUpdated()`), `UserLicense` (same three, no `getDeleted`/`getUpdated`). `CallCenter` is create-only-no-update (`create(), describeSObjects(), getDeleted(), getUpdated(), query(), retrieve()` — no `update()`, no `upsert()`, no `delete()`). The remaining 10 support full `create()`/`update()`/`delete()`/`upsert()`. See table below for the complete per-object breakdown. |
| Custom-object key prefixes assigned once at creation and persisted forever, independent of alphabetical position or rename | Today `customKeyPrefix()` recomputes by alphabetical index on every build; inserting a new custom object earlier in the alphabet silently reassigns every later object's prefix and therefore its record IDs' meaning, causing `checkReferences` to accept wrong data or reject valid data after a reload | MEDIUM | Real Salesforce assigns `a0X` prefixes (starting `a00`) sequentially by **creation order** within the org, never alphabetically, and the prefix never changes even if the object is renamed. Needs a persisted prefix-assignment table (e.g. `object_key_prefixes(name, prefix, assigned_at)`), not a recomputation. MEDIUM confidence — well-established, cross-verified across multiple sources, but Salesforce doesn't publish one canonical doc page stating "never changes on rename" in those exact words. |
| Bulk API 2.0 job state persisted in Postgres, survives restart, correct state machine | Today `JobStore` is an in-memory `Map`; any restart during a long-running CI Bulk load loses the job with no trace, and polling clients get bare 404s instead of a state transition | MEDIUM | Job states (ingest): `Open` → `UploadComplete` → `InProgress` → `JobComplete` \| `Failed` \| `Aborted`. Query jobs skip `Open` (created directly in `UploadComplete` since the SOQL is supplied at creation). Full state table and transition rules below, HIGH confidence, quoted from the official Bulk API 2.0 and Bulk API Developer Guide PDF. |
| Bulk API 2.0 result endpoints (`successfulResults`, `failedResults`, `unprocessedrecords`) backed by persisted data, not just in-memory CSV caches | Clients call these *after* `UploadComplete`/`JobComplete`; if the process restarted in between, results must still be retrievable for the retention window | LOW-MEDIUM | `successfulResults`/`failedResults` follow the documented `sf__Id, sf__Created, ...` / `sf__Id, sf__Error, ...` CSV shape (already implemented per `ARCHITECTURE.md`); `unprocessedrecords` returns rows from the original upload that were never attempted (job aborted/failed mid-processing) — distinct from `failedResults` (processed but errored). |
| Job/result retention window (~7 days) reflected in behavior or at least documented as a limitation | Real clients and CI pipelines that poll late expect eventual 404s, not indefinite retention | LOW | MEDIUM confidence: the official PDF states this explicitly for Bulk API v1 ("job status and batch results sets for completed jobs are available for 7 days, after which the data is deleted permanently") and multiple independent sources confirm the same 7-day figure applies to Bulk API 2.0 job data; no verbatim Bulk-2.0-specific quote was retrievable in this pass (the dedicated "job lifespan" doc page returns 403). Not necessarily worth *enforcing* deletion in orglet (a local dev/CI tool benefits from *not* losing data), but worth documenting as a deliberate divergence if orglet keeps jobs indefinitely. |

### Per-object breakdown: the 14 thin standard-object baselines

All key prefixes below are cross-verified across 2–3 independent community-maintained lists
(no single official Salesforce doc publishes a canonical prefix table — the official "Entity Key
Prefix Decoder" help page is a one-at-a-time interactive tool, not a static table, and returns a
client-rendered shell to automated fetches). Confidence is MEDIUM unless noted.

| Object | Key Prefix | API Access (Object Reference `Supported Calls`) | Name-equivalent field | Confidence |
|---|---|---|---|---|
| `BusinessHours` | `01m` | create/update, **no delete()** | `Name` (`idLookup`) | MEDIUM |
| `BusinessProcess` | `019` | create/update, **no delete()** | `Name` (`idLookup`) | MEDIUM |
| `CallCenter` | `04v` | **create-only** — no `update()`, `upsert()`, or `delete()` | `Name` (`idLookup`) | MEDIUM |
| `DandBCompany` | `06E` | full CRUD (`create/delete/update/upsert/search/undelete`) | not confirmed in this pass (object has `City`/`Country`/currency fields; likely `Name`) | MEDIUM |
| `Entitlement` | `550` | full CRUD | not confirmed in this pass (object references `AccountId`, `AssetId`, `BusinessHoursId`; has a `Name` field per general Entitlement conventions, not independently verified here) | MEDIUM |
| `ExternalDataSource` | `0XC` | **read-only** — `describeSObjects(), query(), retrieve()` only | `DeveloperName` (unique name; no generic `Name`) | MEDIUM |
| `IdeaTheme` | `0Bg` | full CRUD + `search()` | not confirmed (no `Name`-labeled field seen in this pass; likely uses `Title`/`MasterLabel`-style field, or none) | **LOW** — single source for the prefix (fishofprey.com); recommend validating before hardcoding |
| `Individual` | `0PK` | full CRUD + `merge()` | `FirstName`/`LastName` (person-shaped, no single `Name`) | MEDIUM |
| `OperatingHours` | `0OH` | full CRUD | `Name` (`idLookup`) | MEDIUM |
| `OpportunityHistory` | `008` | **read-only** — `describeSObjects(), getDeleted(), getUpdated(), query(), retrieve()` only | none — a history/audit-trail object (`Amount`, `CloseDate`, `ForecastCategory`, etc. keyed to the parent Opportunity) | MEDIUM |
| `ServiceAppointment` | `08p` | full CRUD | `AppointmentNumber` (`Autonumber`, `idLookup` — not a generic `Name`) | MEDIUM |
| `ServiceContract` | `810` | full CRUD | not confirmed in this pass | MEDIUM |
| `SocialPost` | `0ST` | full CRUD | no `Name`-labeled field seen (`Content`, `Classification`, `AttachmentUrl`, etc.) | MEDIUM |
| `UserLicense` | `100` | **read-only** — `describeSObjects(), query(), retrieve()` only | `MasterLabel` (no `Create` property — read-only, consistent with the object) | MEDIUM |

**3 of the 14 are read-only via the standard API** (`ExternalDataSource`, `OpportunityHistory`,
`UserLicense`) — this is a stronger claim than the milestone brief's own framing (which names only
`OpportunityHistory` and `UserLicense`), and worth carrying into requirements: `ExternalDataSource`
should also reject create/update/delete rather than silently accepting them. `CallCenter` is a
fourth partial case (createable, not updateable/deletable) worth a requirement of its own.

### Differentiators (Nice-to-Have, Not Required for This Milestone)

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| "Force a mass recalculation" equivalent for roll-up fields | Salesforce exposes this as an admin action in Setup when a roll-up drifts out of sync (e.g. after a bulk data load done with automation off); useful for orglet's own `--import` mode, which deliberately skips hooks/validation | LOW-MEDIUM | Natural fit as a `orglet` CLI subcommand or a flag on `up --import`, not a REST endpoint Salesforce itself exposes generally. |
| Bulk API 2.0 background/async processing (job returns from `UploadComplete` immediately, transitions `InProgress → JobComplete` on a worker) | Matches real Salesforce's actual async behavior more closely than orglet's current synchronous-in-request model; needed for very large CI loads that would otherwise block the HTTP request for the whole batch | HIGH | Explicitly out of scope for *this* milestone per `PROJECT.md` — persistence is required, true asynchrony is not. Can be added later without changing the persisted job schema if states/transitions are modeled correctly now. |
| PK chunking for Bulk API 2.0 query jobs | Real Salesforce auto-chunks large query jobs by primary key; not needed until orglet's own query jobs handle multi-million-row tables | HIGH | Documented (`isPkChunkingSupported`) but firmly a v2+ concern. |
| `Subscribe to Query Job Platform Events (Beta)` / `Get Parallel Results for a Query Job` | Lets clients start downloading before a query job fully completes | HIGH | Beta feature in real Salesforce itself; not worth chasing for a hardening milestone. |
| Full field parity (not just a "thin" baseline) for the 14 standard objects | Would make e.g. `ServiceAppointment`/`Entitlement`-heavy Field Service orgs load with zero warnings on every field, not just resolve lookups | HIGH (×14) | Explicitly deferred — "thin" is the correct scope; each object has 20–80+ documented fields in the real platform, most irrelevant to a headless CRUD/SOQL emulator. |
| `CallCenter` full lifecycle including CTI Toolkit XML import semantics | Would matter for orgs actually using computer-telephony integration | HIGH | Extremely unlikely to matter for this project's users (local dev/CI); thin baseline (createable, describe-correct) is sufficient. |

### Anti-Features (Explicitly Do Not Build)

| Feature | Why It Looks Appealing | Why It's Wrong Here | Alternative |
|---------|------------------------|----------------------|-------------|
| `TYPEOF` allowed in `WHERE`, `GROUP BY`/`GROUP BY ROLLUP`/`GROUP BY CUBE`/`HAVING`, inside a semi-join's `SELECT`, with functions in a `WHEN` field list, or nested inside another `TYPEOF`'s `WHEN` | Would feel "more complete" / more permissive than real Salesforce | Real Salesforce rejects every one of these with a compile error (`MALFORMED_QUERY`); silently allowing them makes orglet *more* permissive than the platform it emulates, which breaks the "cannot tell the difference" core value in the other direction — clients that correctly avoid these patterns won't notice, but conformance/regression tests that assert the error would fail against orglet | Reject with the same `MALFORMED_QUERY`-shaped error SOQL compilation already uses for other unsupported constructs (`packages/soql/src/errors.ts`), pointing at the specific restriction. |
| `TYPEOF` in Bulk API 2.0 query-job SOQL | Consistency — "if TYPEOF works in REST SOQL, why not Bulk SOQL?" | Explicitly and separately documented as unsupported in Bulk API 2.0 (`Bulk API 2.0 doesn't support SOQL queries that include ... TYPEOF clauses`), alongside `GROUP BY`, `OFFSET`, aggregate functions, compound fields, and parent-to-child (subquery) relationship queries | Bulk 2.0 query-job SOQL validation should reject `TYPEOF` (and the other listed constructs) even though the same query would be valid REST SOQL. |
| Roll-up summary fields settable via `create()`/`update()`/Bulk API | Would simplify data-migration/import scenarios (just write the precomputed value) | Roll-ups are read-only in real Salesforce by design — always server-computed, never accepted as input, regardless of API. Accepting a value would silently diverge from platform behavior and mask real bugs in a client's assumptions | Reject writes to roll-up fields the same way other calculated fields are rejected today (`Errors.notWritable`); `--import` mode should skip/ignore them rather than accept-and-store, then a recompute step (if built) brings them in line. |
| Roll-up summary fields on **lookup** relationships (only master-detail is real) | "Why not let admins roll up any child, not just master-detail children?" — third-party tools like Declarative Lookup Rollup Summaries (DLRS) do exactly this via Apex triggers | Native roll-up summary fields are a master-detail-only platform feature; building lookup-relationship roll-ups as a "native-looking" `Summary` field type would fabricate behavior real Salesforce doesn't have | If lookup-relationship aggregation is ever wanted, model it explicitly as a different, clearly-labeled feature (e.g. a formula/trigger-based convenience), never as the `Summary` field type. |
| Persisting the 14 thin objects' full historical/audit field sets (e.g. all of `OpportunityHistory`'s tracked-field-history semantics, `ServiceAppointment`'s full Field Service scheduling engine) | Would look more "complete" | Out of scope per milestone ("thin" baselines only, no Flow/Field Service scheduling); massive complexity for near-zero benefit to a headless SOQL/DML emulator's actual users | Id + name-equivalent + audit fields + the specific lookup-target fields other baseline objects already reference; nothing more. |
| Bulk API v1 (`/services/async/*`) | "Some old SDK code paths default to it" | Separate, larger surface (batches within jobs, different content-type negotiation, different limits); not requested by this milestone and not blocking the stated goal (zero-`UNSUPPORTED` DE retrieve) | Leave as a documented gap (`CONCERNS.md` already tracks it); pick up only if a real conformance target needs it. |
| A distributed/multi-process Bulk API 2.0 job store (Redis, horizontal scaling) | "Persisting in Postgres is halfway there anyway" | Explicitly out of scope — Postgres persistence solves "survives restart," which is what the milestone needs; distributed coordination is a different problem (matches the existing ID-generation fragility noted in `CONCERNS.md`, not something to solve incidentally here) | Postgres table keyed by job ID is sufficient; revisit only if orglet ever needs to run multiple API processes against one org. |

## Feature Dependencies

```
Per-row polymorphic resolution (fix "always targets[0]")
    └──requires──> keyPrefixOf() per-row branching (already exists, packages/schema/src/ids.ts)
    └──enables──> TYPEOF compiles to a real per-branch CASE/join
                       └──requires──> WHEN's referenced object exists in OrgSchema
                                          └──requires (for WhatId/WhoId-style fields)──>
                                             Thin baselines for the 14 objects
                                             (a WHEN branch or a resolved row whose prefix
                                             maps to e.g. ServiceContract must find a real
                                             table, or the branch silently returns nulls)

Roll-up summary fields
    └──requires──> Master-detail relationship support (already exists — cascade/restrict
                   delete already models master-detail per ARCHITECTURE.md)
    └──requires──> Engine post-commit hook over childRelationships (new — the recompute
                   step; lives in packages/engine, not packages/metadata)
    └──enhances──> describeSObject correctness (calculated/createable/updateable flags)

Thin standard-object baselines (14 objects)
    └──enables──> checkReferences() validates lookups to these objects instead of accepting
                   any string (packages/engine/src/engine.ts)
    └──enables──> SOQL joins/subqueries through these objects become possible
    └──partially enables──> correct per-row polymorphic resolution when a WhatId/OwnerId/
                   WhoId-style field's real-world target is one of these 14

Custom-object key prefix persistence
    └──independent of the above──> same architectural shape (persisted prefix assignment,
                   not recomputed) as would be needed if the 14 standard baselines' prefixes
                   were ever made project-overridable, but they are NOT — standard prefixes
                   are fixed constants, custom prefixes are the only ones assigned at runtime

Bulk API 2.0 job persistence
    └──independent of the above──> shares no feature dependency, but shares the milestone's
                   infrastructure dependency (pglite-testable schema/migration path)
```

### Dependency Notes

- **TYPEOF requires per-row polymorphic resolution:** `TYPEOF` is meaningless without first
  knowing, per row, which concrete object a polymorphic field actually points to. Today's
  `targets[0]`-always behavior (`packages/soql/src/compile.ts:116`, `packages/formula/src/compile.ts:97`)
  must be fixed first; `TYPEOF` compilation is the next layer on top of that fix, not a
  parallel, independent task.
- **TYPEOF (and per-row resolution generally) partially requires the 14 thin baselines:**
  Salesforce's own polymorphic fields (`WhatId` especially) can point at dozens of object
  types across editions. Several of the 14 objects in this milestone's list are plausible
  `WhatId`/`OwnerId` targets in a real org (e.g. `ServiceContract`, `Entitlement`). If a
  polymorphic field resolves to a key prefix with no backing table, the `TYPEOF` branch (or
  the plain relationship join) must degrade to `ELSE`/null gracefully rather than error —
  worth an explicit requirement either way.
- **Roll-ups require master-detail relationships**, which orglet already models structurally
  (cascade/restrict/set-null delete constraints already require identifying master-detail
  vs. lookup). No new relationship-type work is needed, only the recompute step and the
  metadata load path currently skipping `Summary` fields entirely.
- **Bulk API 2.0 persistence and custom-object key-prefix persistence are independent
  features** with no shared code path, but both are instances of the same underlying lesson
  this milestone is built around: *derived/assigned state that must survive a restart cannot
  live only in a process-local structure (a `Map`, or a recomputed alphabetical index) — it
  needs a Postgres row.* Worth solving with a consistent pattern (e.g. both as small,
  purpose-built tables with straightforward migrations) rather than two bespoke persistence
  mechanisms.

## MVP Definition

### Launch With (v1) — matches the milestone's Active requirements in PROJECT.md

- [ ] Per-row polymorphic resolution fixed (prerequisite for everything else polymorphic)
- [ ] `TYPEOF ... WHEN ... THEN ... ELSE ... END` compiles and shapes results correctly,
      rejecting the documented invalid forms (`WHERE`, `GROUP BY`/`HAVING`, semi-join
      `SELECT`, functions in `WHEN`, nesting) with a `MALFORMED_QUERY`-shaped error
- [ ] `.Type` filterable in `WHERE` for polymorphic fields (string comparison)
- [ ] Roll-up summary fields load from metadata (`summarizedField`, `summaryForeignKey`,
      `summaryOperation`, `summaryFilterItems`), compute COUNT/SUM/MIN/MAX with filters,
      recompute on child insert/update/delete, and are read-only via REST/SOQL/describe
- [ ] Thin baselines for all 14 objects, each createable/updateable/deletable exactly as
      documented (3 read-only, 1 create-only, 10 full CRUD)
- [ ] Custom-object key prefixes persisted (assigned once, stable across reloads/renames)
- [ ] Bulk API 2.0 job state and result data persisted in Postgres, correct state machine,
      survives restart

### Add After Validation (v1.x)

- [ ] Roll-up "force recalculation" CLI/import-mode helper — trigger once orglet's own
      `--import` mode is exercised against data with roll-ups and drift is observed
- [ ] Extend beyond 25 roll-ups per object (documented soft cap, extendable to 40 on real
      Salesforce) — only if a real retrieve ever needs it
- [ ] Reparenting recalculation semantics verified against a written test suite — the docs
      corroborate create/update/delete recompute strongly; reparenting and undelete triggers
      are logically implied but not independently confirmed by an official quote in this
      research pass (see Gaps below)

### Future Consideration (v2+)

- [ ] Bulk API 2.0 true async/background processing (worker-based `InProgress` transitions)
- [ ] Bulk API 2.0 PK chunking, parallel query results, platform-event job subscriptions
- [ ] Bulk API v1 (`/services/async/*`)
- [ ] Full (non-thin) field parity for the 14 standard objects
- [ ] Distributed/multi-process Bulk job store

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Per-row polymorphic resolution fix | HIGH | MEDIUM | P1 |
| `TYPEOF` in SELECT | HIGH | MEDIUM | P1 |
| `.Type` in WHERE | MEDIUM | LOW | P1 |
| Roll-up summary fields (compute + describe) | HIGH | HIGH | P1 |
| 14 thin standard-object baselines | HIGH | MEDIUM | P1 |
| Correct createable/updateable flags per thin baseline | MEDIUM | LOW | P1 |
| Custom-object key prefix persistence | HIGH | MEDIUM | P1 |
| Bulk API 2.0 job persistence (Postgres-backed) | HIGH | MEDIUM | P1 |
| Roll-up "force recalculation" helper | LOW | LOW | P3 |
| Bulk API 2.0 async/background processing | MEDIUM | HIGH | P3 |
| Full field parity for the 14 objects | LOW | HIGH | P3 |
| Bulk API v1 | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for this milestone (matches `PROJECT.md` Active requirements)
- P3: Explicitly deferred; revisit only if a concrete conformance or usage need arises

## Fidelity Target (in place of Competitor Feature Analysis)

There is no competing open-source product to benchmark against (per `PROJECT.md`, "No
open-source Salesforce emulator, SOQL→SQL translator or Flow executor exists"). The relevant
comparison is real Salesforce's own documented behavior, which is what every row above is
sourced against. Where real Salesforce itself has inconsistent or object-specific exceptions
(e.g. `CallCenter`'s missing `update()`, the three read-only objects among the 14), orglet's
correct behavior is to match the exception, not smooth it over into a uniform CRUD story.

## Gaps to Address

- **Roll-up recalculation on reparenting and undelete:** create/update/delete triggers for
  recalculation are well corroborated (official Trailhead module + multiple independent
  sources state recalculation happens "in the background during save execution" for child
  changes). Reparenting (changing a detail record's master when "Allow reparenting" is
  enabled) and undelete were not confirmed by a direct official quote in this pass — treat as
  MEDIUM/LOW confidence and validate against `help.salesforce.com` article `000391766`
  ("Recalculate Rollup Summary Fields") or equivalent before finalizing the exact recompute
  trigger list in requirements.
- **Rounding/scale behavior:** community sources agree the stored value has full
  floating-point precision (the UI rounds display to 2 decimal places, but the API/database
  value does not round) — MEDIUM confidence, not independently confirmed against an official
  page in this pass.
- **`IdeaTheme` key prefix (`0Bg`):** single-source confidence only (fishofprey.com). If a
  real DE org happens to reference `IdeaTheme`, verify before hardcoding.
- **`DandBCompany`, `Entitlement`, `ServiceContract`, `SocialPost` name-equivalent fields:**
  not independently confirmed in this research pass (the PDF section extraction landed
  mid-alphabet for several objects); worth a quick confirmation pass against the Object
  Reference PDF before writing the JSON baseline files, since getting the `idLookup`/primary
  display field wrong is a likely source of `INVALID_FIELD` surprises in a real retrieve.
- **7-day Bulk API 2.0 retention:** confirmed for Bulk API v1 verbatim in the official PDF;
  the Bulk-2.0-specific doc page (`asynch_api_jobs_lifespan.htm`) exists per search results
  but returned 403 to direct fetch, so the 7-day figure for Bulk 2.0 specifically rests on
  secondary-source corroboration, not a verbatim official quote.

## Sources

**Official Salesforce documentation (downloaded PDF exports, HIGH confidence unless noted):**
- SOQL and SOSL Reference, Version 68.0, Winter '27 —
  `https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/salesforce_soql_sosl.pdf`
  (TYPEOF grammar/restrictions, polymorphic relationship fields, `.Type` filtering)
- Bulk API 2.0 and Bulk API Developer Guide —
  `https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/api_asynch.pdf`
  (job states table, state transitions, result endpoints, SOQL restrictions incl. TYPEOF,
  7-day retention statement for Bulk API v1)
- Metadata API Developer Guide —
  `https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/api_meta.pdf`
  (`CustomField` roll-up fields: `summarizedField`, `summaryForeignKey`, `summaryOperation`,
  `summaryFilterItems`; `FilterItem` operator enum; `FieldType` enum confirming `Summary`)
- Object Reference for the Salesforce Platform —
  `https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/object_reference.pdf`
  (per-object `Supported Calls`, field lists, for all 14 thin-baseline objects plus
  `BusinessHours`)
- REST API Developer Guide —
  `https://resources.docs.salesforce.com/latest/latest/en-us/sfdc/pdf/api_rest.pdf`
  (describe field shape: `calculated`, `calculatedFormula`, `createable`, `updateable`; query
  response `attributes.type`/`attributes.url` JSON shape)

**Community-verified, cross-referenced (MEDIUM confidence — no single official doc page
publishes a canonical key-prefix table):**
- Salesforce Object Key Prefixes gist — `https://gist.github.com/conrjac/2a65daf24e06c205987451a0994d9115`
- Daniel Ballinger, "Obscure Salesforce object key prefixes" —
  `http://www.fishofprey.com/2011/09/obscure-salesforce-object-key-prefixes.html`
- Automation Champion, "Salesforce Object Key Prefix List" —
  `https://automationchampion.com/2024/01/22/salesforce-object-key-prefix-list-2/`
- Aegis Softworks, Salesforce ID Object Prefix List —
  `https://aegissoftworks.com/tools/sfid_prefix_list.php`

**Secondary sources for recalculation timing and rounding behavior (MEDIUM confidence,
corroborated across multiple independent write-ups but not quoted verbatim from an official
page in this pass):**
- Trailhead, "Optimize Roll-Up Summary Fields in Salesforce" —
  `https://trailhead.salesforce.com/content/learn/modules/point_click_business_logic/roll_up_summary_fields`
- Salesforce Help, "Recalculate Rollup Summary Fields" (id 000391766) — referenced via search,
  not directly fetchable
- sfdcfanboy.com, "Rollup Summary Decimals in Database" — rounding/precision behavior

**Project context read before research (not re-researched, per milestone scope):**
- `.planning/PROJECT.md`
- `.planning/codebase/CONCERNS.md`
- `.planning/codebase/ARCHITECTURE.md`

---
*Feature research for: Salesforce platform emulator hardening milestone*
*Researched: 2026-09-29*
