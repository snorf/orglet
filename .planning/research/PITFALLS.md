# Domain Pitfalls: v1.1 real-org fidelity

**Domain:** Salesforce platform emulator (orglet), adding docs-generated standard-object baseline v2,
custom metadata / custom settings, formula globals, OwnerId narrowing, sigha resync, roll-up over
formula fields, and a redesigned `orglet check` report to a shipped v1.0 system.
**Researched:** 2026-10-12
**Overall confidence:** MEDIUM. Code-level claims are HIGH (read directly from `packages/*`). Salesforce
semantics are MEDIUM or LOW where only secondary sources were reachable; each pitfall carries a
confidence tag. Salesforce help pages were not fetchable in v1.0 research either, so several platform
claims are reasoning plus secondary sources and must be re-verified in the phase that implements them.

Pitfalls of the v1.0 milestone (`.planning/milestones/v1.0-research/PITFALLS.md`) that still apply and are
NOT repeated here: #8/#9 (prefix persistence: now also constrains new standard prefixes, see B3), #10
(pglite vs Postgres divergence: the migrate differ gets much bigger input, see M3), #14 (never run
`sync-sigha.sh` in CI), #18/#19 (describe contract and read-only objects for thin baselines: apply to every
new object, see B5), #20/#21 (conformance re-run last, classify every exclusion).

Legend: **BLOCKER** = changes the roadmap order or must be decided before a phase starts.

## Critical Pitfalls

### B1. Treating the Object Reference as ground truth for describe (BLOCKER for phase 1 design)
**What goes wrong:** The generated baseline contains fields a real API describe does not return, or gets
flags wrong, so a client sees a different field list than Salesforce.
**Why it happens:** Object Reference pages list fields that are (a) gated behind a feature, permission or
licence (Territory, Person Accounts, Data.com `Jigsaw*`, Shield, Field Service), (b) gated by API version
("available in API version X and later") or "Lightning Experience only", (c) deprecated or "reserved for
future use", (d) edition-dependent, (e) documented with a flag line (Create/Filter/Group/Nillable/Sort/
Update) that is sometimes wrong or silent about `defaultedOnCreate`, `calculated`, `idLookup`, `unique`.
Docs never state `defaultedOnCreate`, `caseSensitive`, `length` for every field, relationship names,
child relationship names or delete constraints reliably. v1.0 already hit this: conformance excluded Data.com
`Jigsaw*` fields (PROJECT.md, Phase 7).
**Consequences:** Phantom columns forever (migrate never drops them without `--force`), clients that select
`FIELDS(ALL)` hit absent features, `nillable`/`createable` mismatches produce wrong `REQUIRED_FIELD_MISSING`
or wrong acceptance of writes.
**Prevention:**
- Generator (`scripts/`, committed, output committed) emits a per-field provenance record and a curated
  override file (`packages/metadata/standard/overrides/*.json`) that always wins. Never regenerate in CI and
  never fetch docs in tests; generated JSON is reviewed as a diff.
- Default policy: exclude fields marked feature-gated, reserved, deprecated or Lightning-only unless the
  override file opts them in. Include a field only when the same fact is stated in two places (field table +
  a second doc page, SDK fixture, or the org retrieve itself). Single-source flags: mark `unverified`.
- A guard test: every baseline field has `type`, explicit `nillable`, `createable`, `updateable`; objects
  without a Name field state `nameField` absence explicitly (see B5).
- Do not copy description prose from docs into JSON (documentation text is Salesforce copyright, not OSI
  licensed; names, types and flags are facts). Keep `description` out of generated output.
**Detection:** a retrieve references a standard field the baseline lacks (`UNSUPPORTED:standard-field`) or
the baseline has a field no retrieve ever mentions; count both in the generator report.
**Phase:** Baseline v2. Confidence: HIGH on mechanism, MEDIUM on specific gating examples.

### B2. Un-skipping an object un-skips all its retrieved metadata (cascade surprise)
**What goes wrong:** Today a retrieved `Quote.object-meta.xml` produces one `UNSUPPORTED:standard-object Quote
skipped` warning (`packages/metadata/src/build.ts:452-454`). Once Quote is in the baseline, the file's
validation rules, record types, custom fields, lookups, roll-ups and formulas all load and each may fail for
its own reason (missing globals, missing sibling objects, polymorphic `Owner`). Warning counts go UP in the
middle of a milestone that targets zero.
**Prevention:** order phases so baseline objects land together with the globals and `OwnerId` work they
unlock, or accept an interim non-strict state and record expected counts per area per phase. Do not judge the
baseline phase by total warning count; judge by "no `standard-object` / `reference-target` warnings left for
referenced objects". Write the expectation in the phase plan.
**Phase:** Baseline v2 and Check report. Confidence: HIGH (code read).

### B3. Key prefixes are not in the Object Reference; wrong or invented prefixes mint wrong Ids
**What goes wrong:** `keyPrefix` is required by `StandardObjectJson` and drives Id minting, the shared
`matchTargetByPrefix` rule (polymorphic lookups, TYPEOF, formula parent loading) and describe. Object
Reference pages generally do not list key prefixes (they appear in describe output and in third-party
cheat sheets such as AutoRabit's, which are unofficial and incomplete). Some objects have no prefix at all
(history/share/feed child objects describe `keyPrefix: null`), and a few prefixes are shared or org-specific.
**Consequences:** A guessed prefix gives orglet Ids that look real but belong to another object after a
migration to a real org (the project's stated end goal), silently mis-resolves polymorphic parents, and may
collide with a persisted custom prefix.
**Prevention:**
- Prefix is data with a source label (`doc`, `sdk-fixture`, `unverified`). Take it only from public SDK test
  fixtures, public docs text, or open-source tools; if not found, set no prefix (null, as describe does for
  prefix-less objects) and exclude the object from polymorphic matching rather than invent one. This needs a
  small type change (`keyPrefix: string | null`) across `build.ts`, `ids.ts`, `prefixes.ts`, `api` describe.
- Add a baseline unit test: all standard prefixes unique, three characters, none in the custom allocation
  range orglet uses (`a00`.. via `customKeyPrefix` in `build.ts:420`), none equal to `m0x` used for custom
  metadata (C2).
- Upgrade hazard: `planKeyPrefixes` throws `KeyPrefixError` when a persisted prefix collides with a standard
  prefix (`packages/schema/src/prefixes.ts:104-110`). A new standard prefix that equals a prefix already
  persisted for a custom object makes `orglet up` fail on an existing database. Test: persist `a00..a0z`, load
  baseline v2, assert no throw. Real Salesforce also reserves letters for custom objects, so the check is
  cheap; do it for every added prefix.
**Phase:** Baseline v2, first task (decides the type change). Confidence: MEDIUM (docs absence confirmed
only by v1.0 experience and search; verify per object).

### M1. NOT NULL and FK additions on populated tables (migration hazard, BLOCKER for baseline and OwnerId work)
**What goes wrong:** `migrate()` is additive but two rules turn into hard failures on existing databases:
1. `columnFor` sets `notNull` for `MasterDetail` fields without a default (`packages/schema/src/columns.ts:99`).
   `ALTER TABLE ... ADD COLUMN ... NOT NULL` fails on any non-empty table. Baseline v2 adds fields to existing
   populated tables (Account, Contact, Opportunity...). If any added field is typed `MasterDetail` (e.g. a
   documented master-detail child relationship on an existing object) migration aborts mid-transaction.
2. `planTable` creates an FK only when `referenceTo.length === 1` and the target exists
   (`packages/schema/src/ddl.ts:38-44`). Two v1.1 changes add FKs to old columns: narrowing `OwnerId` from
   `[User, Group]` to `[User]` (no FK today, FK to `user` tomorrow), and modelling previously missing targets.
   Existing rows owned by a Group (legal today, e.g. loaded with `--import`) fail `foreignKeySql`. The error is
   already friendly (`migrate.ts:166`) but it is fatal for `orglet up`.
**Prevention:**
- Never derive DB `NOT NULL` from `nillable:false` for baseline fields (current rule; keep it). For new
  MasterDetail columns on existing tables add the column nullable and enforce in the engine, or refuse in the
  baseline generator (standard objects rarely gain MD fields; emit a generator error).
- Build an upgrade test: create a DB with v1.0 baseline + `examples/acme` data (including a Group-owned row and
  `--import` rows), run `migrate` with the v1.1 schema, assert success, zero data loss, and the exact warning
  set. This single test covers M1-M4.
- For OwnerId narrowing: pre-scan before `ALTER` and emit `UNSUPPORTED:schema-narrow` style warning naming
  the object and count, instead of aborting, OR document that `up` aborts and requires clearing the rows.
  Decide explicitly; do not leave it to the Postgres error. (Reasoning.)
**Detection:** `migrate.test.ts` has no populated-table upgrade case today.
**Phase:** Baseline v2 and OwnerId narrowing. Confidence: HIGH (code read).

### R1. Roll-up over a formula field: formulas are not stored (BLOCKER for the roll-up phase design)
**What goes wrong:** Phase 5 roll-ups are SQL correlated subqueries over stored child columns
(`packages/schema/src/rollup.ts`). Formula fields in orglet are evaluated per row after fetch and have no
column (`isVirtual`, `columns.ts`). A roll-up whose `summarizedField` is a formula has nothing to aggregate.
**Options and traps:**
- Materialise formula results into a hidden stored column maintained in the save pipeline before the roll-up
  recompute. Trap: `migrate()` backfill is SQL-only and `@orglet/schema` depends only on `metadata`; it cannot
  import `@orglet/formula` (layering `metadata -> schema -> formula`). Backfilling existing rows therefore
  must run in `engine` or `cli` after migrate, not inside the migrate transaction, and D-10 ("backfill is the
  last step of the migrate transaction") must be re-decided for this case.
- Translate the formula to SQL: semantic drift (Decimal.js vs `numeric` rounding, blank handling,
  `formulaTreatBlanksAs`, text/date functions). Not recommended beyond trivial arithmetic.
- Evaluate in the app by fetching children: correct but O(children) per recompute; acceptable only as a
  documented fallback.
**Prevention:** apply the stored value with the formula's declared `precision/scale` rounding (a Salesforce
number formula rounds to its scale before aggregation; reasoning, verify). Reject at load, with an explicit
error naming the formula, anything Salesforce forbids: cross-object references, time-dependent functions
(`TODAY`, `NOW`), and other non-deterministic or context-dependent inputs (`$User`, `$Setup`, `$Api`).
Secondary sources agree: formula fields in roll-ups must be idempotent, no related-object merge fields, no
`TODAY/NOW` (MEDIUM; Salesforce Help not reachable). Follow D-05: invalid roll-up definition fails load
rather than warning.
**Also:** a formula that depends on another roll-up field on the same record makes the depth ordering in
`rollupDepth` include formula dependencies; add a cycle test (formula -> roll-up -> formula).
**Phase:** Roll-up over formula. Confidence: HIGH on orglet side, MEDIUM on Salesforce rules.

## Moderate Pitfalls

### M2. Index and FK statement bloat on every `orglet up`
**What goes wrong:** `planTable` emits one index per Lookup/MasterDetail/unique/externalId field and one FK per
single-target lookup. `migrate` runs `indexSql` for every planned index on every start (idempotent, but one
round trip each) and checks FK names against `pg_constraint`. ~50 more objects with ~10 lookups each adds
hundreds of statements per boot, inside one transaction, multiplied by one pglite instance per test file
(`hookTimeout` 60 s).
**Prevention:** measure `up`/test-file setup time before and after baseline v2 (budget: no more than 2x);
skip indexes whose name already exists via the `existingConstraintNames`-style catalog query instead of
`IF NOT EXISTS` statements; do not index lookups on read-mostly baseline objects nobody queries unless the
retrieve references them. Do not lower Postgres limits claims: the per-table column cap is 1600 and a
standard object has well under 200 fields, so the cap is not a real risk, but check compound fields (below).
**Detection:** `statements.length` from `MigrateResult` in the upgrade test; track it as a number.
**Phase:** Baseline v2. Confidence: HIGH (code read), MEDIUM on timing (unmeasured).

### M3. Compound fields and virtual columns in generated baselines
**What goes wrong:** Docs list `BillingAddress` (Address) and its parts (`BillingStreet`...) as separate
fields. If the generator marks both as physical, data is stored twice and writes conflict. `Name`-type compound
fields (`Contact.Name`) and `Location` have the same shape.
**Prevention:** generator maps documented compound types to `Address`/`Name`/`Location` with `compoundFieldName`
on the parts (already supported in `fromStandardJson`); unit test that every part has a matching compound
parent and that `isVirtual` excludes the parent from DDL. Bulk query rejects Address/Location fields (Phase 6),
so keep the type exact.
**Phase:** Baseline v2. Confidence: HIGH.

### M4. Field renames, removals and type changes between baseline v1 and v2 leave permanent warnings
**What goes wrong:** Hand-written v1 fields that differ from generated v2 (renamed, dropped, changed length or
type) produce `UNSUPPORTED:schema-drop` and `UNSUPPORTED:schema-narrow` warnings on every `up` (the columns are
kept, `migrate.ts:140-143, 198-203`), which breaks `--strict` for every existing user. Data in the old column
is not moved.
**Prevention:** the generator produces a v1-vs-v2 diff report; CI fails if any v1 field disappears or narrows
unless an allowlist entry explains it. Widening is accepted (`isWidening`). Keep v1 fields that docs omit but
v1 conformance relies on, via overrides.
**Phase:** Baseline v2. Confidence: HIGH.

### B4. Standard picklist values are per-org; baking doc values makes them look authoritative
**What goes wrong:** `Account.Industry`, `Lead.Status`, `Case.Status`, `Opportunity.StageName` and most Type
picklists differ per org and are overridden by the retrieve's `standardValueSets`. Opportunity `StageName`
also carries probability/forecast category semantics; `Case.Status` carries open/closed. Doc values with
`restricted: true` reject values real orgs allow.
**Prevention:** baseline picklists are `restricted: false` unless the docs state "restricted picklist"; use
`standardValueSet` references whose names match the Metadata API StandardValueSet names exactly (an orphan
name means the retrieve override never applies); the retrieve always overrides wholesale (note the merge at
`build.ts:468-470` replaces values and drops the `valueSetName`, check it still behaves for the new sets);
generated defaults mark exactly the documented default. Add a test that loads each new object with a retrieve
override and asserts the override wins.
**Phase:** Baseline v2. Confidence: MEDIUM.

### B5. New objects that break describe or DML honesty
**What goes wrong:** Many of the listed objects have special semantics: `ContentDocument` is created via
`ContentVersion`, `ContentVersion.VersionData` is a blob with its own REST path, `FeedItem.ParentId` is
polymorphic over almost every object, `EmailMessage`, `OpportunityContactRole`, `AccountTeamMember` and
`AccountContactRelation` have no Name field, `Location/Address` are compound and feature-gated. A baseline that
treats them as ordinary CRUD objects returns success where Salesforce refuses.
**Prevention:** per-object explicit `createable/updateable/deletable/undeletable/queryable/searchable`
(Phase 3 mechanism, `INVALID_TYPE_FOR_OPERATION`); `base64` fields are `UNSUPPORTED:field-type` until blob
handling exists, not text; objects without a name field describe with no `nameField:true` (do not invent one);
extend `conformance/describe-check/objects.txt` to every new object and run both SDK legs (v1.0 #18).
Describe-global grows by ~50 entries: any queryable flag must be true only if SOQL works for the table.
**Phase:** Baseline v2 and conformance. Confidence: MEDIUM.

### C1. Custom metadata Ids: not in the retrieve, must be deterministic
**What goes wrong:** `customMetadata/Type.Record.md-meta.xml` carries no Id. The Id counter is process-local
(PROJECT.md Known Gaps), so Ids assigned in load order change between runs, and a reload that deletes and
re-inserts rows invalidates any Id a client or another `__mdt` row stored (MetadataRelationship values are
developer names in the XML, but Ids once inserted into columns).
**Prevention:** mint `__mdt` record Ids deterministically from (type API name, record DeveloperName) and
persist the mapping alongside key prefixes (`_orglet`), or derive a counter slice from a stable hash and
check collisions at load. Reload semantics: upsert by (type, DeveloperName); delete rows no longer in the
retrieve; never reuse an Id. Test: load twice and across a changed record order; Ids identical.
**Phase:** Custom metadata. Confidence: HIGH on mechanism, MEDIUM on the Id format (below).

### C2. Custom metadata key prefix is a separate namespace
**What goes wrong:** Records of custom metadata types start with `m0x`, allocated per type like custom objects
use `a0x` (secondary source: Apex Hours / AutoRabit; LOW-MEDIUM, no official statement found). `customKeyPrefix`
in `build.ts:420` is hard-coded to `a`, `isCustomObjectName` matches only `__c`, and the warning regex at
`build.ts:452` classifies `__mdt` as `object-kind` unsupported. Letting `__mdt` ride the existing custom path
gives them `a` prefixes.
**Prevention:** `planKeyPrefixes` takes an alphabet start per kind; persisted `source` column distinguishes
kinds; a test that custom metadata types never consume `a..` prefixes and vice versa. Verify the `m0x` claim
from a public fixture before shipping; if unverifiable, document as orglet's choice.
**Phase:** Custom metadata. Confidence: LOW-MEDIUM.

### C3. MetadataRelationship: load order, cycles, dangling targets, entity targets
**What goes wrong:** A `__mdt` record can reference another `__mdt` record (same type or other), including
cycles; targets can be missing from a partial retrieve; and `MetadataRelationship` can also target
`EntityDefinition`/`FieldDefinition` (which orglet does not model) rather than `__mdt`. Inserting in file
order with immediate FK checks fails or silently drops values.
**Prevention:** insert all `__mdt` rows in one transaction with FKs deferred (they already are
`DEFERRABLE INITIALLY DEFERRED`) or in import mode; resolve names to Ids in a second pass after all Ids are
minted (C1). Missing target record: store null and warn `UNSUPPORTED:custom-metadata-record` naming
type and developer name (once per target), never abort. EntityDefinition/FieldDefinition targets stay an
explicit `UNSUPPORTED:field-type` or `reference-target`. `fromSourceField` currently skips the type entirely
(`field-type` warning); the new branch must keep the skip for unsupported variants.
**Phase:** Custom metadata. Confidence: MEDIUM.

### C4. Custom metadata value parsing and read-only enforcement
**What goes wrong:** Values come as `<values><field>X__c</field><value xsi:type="xsd:double">` etc. Strings that
look numeric must stay strings (`"007"`), `xsi:nil` means null, booleans are `true/false`, picklists need
validation against the (possibly retrieved) value set, and a value for a field absent from the type (a field
deleted after the record was saved) must warn, not crash. Writes through REST/Bulk to `__mdt` are not
allowed by Salesforce DML; use the existing flag mechanism (`INVALID_TYPE_FOR_OPERATION`), bypassed only by
the loader. The exact Salesforce status code for REST DML on `__mdt` was not verified (LOW); confirm from SDK
tests or docs before asserting it in a conformance check.
**Phase:** Custom metadata. Confidence: MEDIUM.

### C5. Custom settings are `__c` objects with a different shape
**What goes wrong:** `<customSettingsType>List|Hierarchy</customSettingsType>` appears in an ordinary
`Name__c.object-meta.xml`. `fromSourceObject` treats it as a custom object: it grants `OwnerId`
(`hasOwner = !MasterDetail`), a `Name` field, record types, DML via REST like any object. Hierarchy settings
instead carry `SetupOwnerId` (polymorphic: Organization, Profile, User) and no owner. Setting data is not part
of an SFDX retrieve, so `$Setup` resolves against an empty table unless seeded.
**Prevention:** parse `customSettingsType` in `sfdx.ts`, build a separate `SObjectDef` shape
(`customSetting: "List" | "Hierarchy"`, no OwnerId, `SetupOwnerId` for hierarchy), assign key prefixes via the
persisted mechanism, and reject unsupported variants explicitly. Do not claim setting values exist when the
retrieve has none; `orglet check` must say "no data, `$Setup` evaluates to blank".
**Phase:** Custom settings. Confidence: MEDIUM.

### F1. `$Setup` hierarchy resolution order and blank semantics
**What goes wrong:** Hierarchy custom settings resolve per running user: user-specific row, else profile row,
else organization default, else blank (null fields). Implementing "first row found" or "org default only"
returns wrong values; implementing missing rows as an error breaks formulas Salesforce evaluates to blank.
List custom settings are not available through `$Setup` in formulas (verify from docs; MEDIUM) and must fail
as `UNSUPPORTED:formula-global` or a field-not-found, matching Salesforce, not silently resolve.
**Prevention:** one resolver `resolveHierarchySetting(user, setting)` with documented order, unit test for all
four outcomes plus a user with no profile. Load once per evaluation batch, not per row: the formula registry
evaluates after fetch, per row, so a naive global loader is N+1 queries. `$Setup` cannot be inlined at compile
time because settings are mutable data; compile once, bind per evaluation.
**Phase:** Formula globals. Confidence: MEDIUM.

### F2. `$CustomMetadata` and missing records
**What goes wrong:** `$CustomMetadata.Type__mdt.DeveloperName.Field__c` bound at compile time against records
that a partial retrieve lacks. Salesforce validates type/field at save and returns blank at run time for a
record that no longer exists; orglet's compile-time check against a retrieve can only say "not in the retrieve".
**Prevention:** unknown type or field: compile error with a clear message (metadata inconsistency, a root
cause, F5). Unknown record developer name: compile succeeds, evaluates to blank, plus one
`UNSUPPORTED:custom-metadata-record` warning per missing record (not per formula). Case-insensitive match on
developer name. Records are static between reloads, but do not cache compiled formulas across a reload.
**Phase:** Formula globals. Confidence: MEDIUM.

### F3. `$Label` and translations
**What goes wrong:** Labels live in `labels/CustomLabels.labels-meta.xml` (master `language`, `protected`,
`categories`), translations in `translations/*.translation-meta.xml`. Salesforce evaluates `$Label.X` in the
running user's language. orglet's user language is effectively fixed.
**Prevention:** resolve to the master value; if the retrieve contains a translation for the user's
`LanguageLocaleKey`, either implement it (small) or emit `UNSUPPORTED:formula-label-translation` once. Trim
nothing the XML preserved (whitespace inside `<value>` is meaningful), keep XML entity decoding, support the
`$Label.ns.Name` form, and treat built-in `$Label.Site.*` as `UNSUPPORTED:formula-global`. Label names are
case-insensitive. Missing label: compile error naming the label.
**Phase:** Formula globals. Confidence: MEDIUM.

### F4. `$Api` leaks the wrong host or a live session token
**What goes wrong:** `$Api.Partner_Server_URL_xxx`, `$Api.Enterprise_Server_URL_xxx` and `$Api.Session_ID` need
a base URL and a session. Building the URL from the incoming `Host` header gives `localhost:8180` or an
internal Docker hostname in data a client later stores; using the session token inside a compiled/cached
formula or a materialised roll-up column (R1) leaks it into persisted data. `Session_ID` is blank in contexts
without a user session (batch, bulk worker). (Syntax details from public formula docs; MEDIUM.)
**Prevention:** one configured public base URL (`ORGLET_BASE_URL`, default derived once at `up` from the
listening port), version taken from the request API version, org Id from the org; never persist `$Api`
values; reject `$Api` in roll-up formulas (R1); never log it. Test with `--host`/proxy-style `Host` header.
**Phase:** Formula globals. Confidence: MEDIUM.

### F5. `$UserRole` for users without a role
**What goes wrong:** `$UserRole.*` for a user with `UserRoleId` null must be blank, not an error; the loader
(parent loading currently assumes a row) may throw on null FK or issue a query with `NULL`.
**Prevention:** same loader as `$User`/`$Profile`; test with the default session user (no role) and a role with
a parent. Baseline `UserRole` exists already.
**Phase:** Formula globals. Confidence: HIGH.

### O1. OwnerId narrowing is per object, not global (BLOCKER for the OwnerId task)
**What goes wrong:** Narrowing every `OwnerId` to `[User]` breaks objects that really are polymorphic (Case,
Lead, and other queue-capable objects). `conformance/poly-check` creates a Case owned by a Group
(`sf_poly.py:61`, `jsforce.mjs:63`) and several unit tests use Group owners (`api.test.ts`, `engine.test.ts`,
`query.test.ts`, `shape.test.ts`, `compile.test.ts`). `systemFields()` in `build.ts:112-116` hard-codes
`["User","Group"]` for every baseline and custom object.
**Prevention:**
- Source the narrowing per object from the Object Reference "Reference To" line for `OwnerId`; encode it as
  `ownerTargets` in the standard JSON (default stays `["User","Group"]` so nothing changes silently). Custom
  objects stay as-is until a public source says otherwise (LOW on real behaviour).
- Audit tests first: grep Group-owned fixtures against the narrowed object list; change tests only where
  Salesforce itself would reject (reference: `INVALID_CROSS_REFERENCE_KEY`) and say so in the commit.
- `<rel>.Type` and `TYPEOF` on a now single-target relationship: Salesforce treats those as polymorphic-only;
  decide the behaviour (likely `INVALID_FIELD`) and test it; do not leave the Phase 4 code path accepting it
  by accident (reasoning, LOW).
- Narrowing adds an FK (M1); sequence with the migration upgrade test.
- Sequencing with sigha: while `Owner` stays polymorphic for Case/Lead, plain `Owner.Name` in formulas stays a
  compile-time rejection (D-08) until the colon syntax lands (S1); do not claim Case/Lead formulas fixed
  by narrowing.
**Phase:** OwnerId narrowing, before formula globals; after the upgrade test exists. Confidence: HIGH on
orglet side, MEDIUM on which objects are single-target.

### S1. Resyncing sigha: moving upstream HEAD, script portability, corpus drift
**What goes wrong:**
- `sync-sigha.sh` defaults to `main` (`SRC=${1:-main}`). "Identical to upstream HEAD" is a moving target; a
  resync pulls every unrelated upstream change (new functions, changed coercion), and `rm -rf src corpus`
  discards anything not on the script's hard-coded layer list (`syntax registry analysis engine i18n`): a new
  upstream layer is silently omitted and only `tsc` notices.
- `sed -i ''` is BSD/macOS-only; on Linux (CI, contributors) it treats `''` as a file name and fails.
- The corpus consists of `salesforce-v2.json` (BSD-3 derived from salesforce/formula-engine, attribution in
  `packages/sigha/NOTICE`) and `org-verified.json`. The provenance of `org-verified.json` is not stated in
  the NOTICE read; "org-verified" suggests upstream compared against a real org, which clashes with the
  project's no-behaviour-diffing rule if orglet ships it. Already shipped in v1.0; re-check provenance when
  resyncing and before adding more cases (LOW-MEDIUM; ask upstream or inspect its repo docs).
**Prevention:** always run `scripts/sync-sigha.sh <full-sha>` with the pinned revision, update `VENDOR.md`
(revision, date) in the same commit, keep the diff of `packages/sigha` reviewable (no hand edits, ever),
and run the whole workspace plus both corpus suites before and after, comparing pass counts (6 312 cases
baseline per PROJECT.md). Make the script portable (`sed -i.bak` or `perl -pi`) as a separate, reviewed change.
If the upstream fix is not merged, vendor from a named upstream PR commit, say so in `VENDOR.md`, and resync to
the merged commit afterward; never carry a local patch. Keep NOTICE/LICENSE intact; MIT plus BSD-3
attribution must survive the `rm -rf`.
**Phase:** sigha resync; do it before Formula globals so globals are not built on a lexer about to change.
Confidence: HIGH (script and VENDOR.md read).

### S2. Colon syntax and `!` change the AST that orglet's compiler consumes
**What goes wrong:** orglet builds reference keys by `.`-joining paths (`register` in
`packages/formula/src/compile.ts`: `ref.key.split(".")`) and resolves relationships with
`resolveRelationship`. `Owner:User.Name` introduces a type qualifier segment (and `Relationship:Object.Field`
in general); if sigha emits it inside `FieldRef.path` or as a new node, orglet may mis-key the reference, drop
the qualifier, or crash on `:`. `!` is the unary NOT (and part of `!=`); an upstream lexer fix that tokenises
`!` differently can regress `!=` or `{!Merge}` text in string literals.
**Prevention:** add orglet-side tests before the resync (expected-failing): `Owner:Group.Name`,
`Owner:User.Email`, `!ISBLANK(x)`, `x != y`, strings containing `!` and `:`; keep `Owner.X` rejection tests for
still-polymorphic fields. Let the qualifier select the target in `resolvePath` using the shared prefix/target
rule (single seam, v1.0 #5 lesson) and evaluate parent loading with that target only. Update D-16 in
PROJECT.md when done.
**Phase:** sigha resync then formula compile. Confidence: MEDIUM.

### K1. Root-cause grouping can hide real errors
**What goes wrong:** Cascades are real (a formula referencing a field that failed makes dependents fail),
but a grouping heuristic over strings can fold unrelated failures into one root cause, or drop dependents
that have a second, independent error. Warnings are plain `string[]` today (`BuildResult.warnings`,
`FormulaRegistry.warnings`, `packages/cli/src/main.ts:81-84`), so grouping would parse text.
**Prevention:** introduce structured diagnostics (`code`, `area`, `subject`, `cause?: key`) in parallel to the
string list; compute cause edges from the reference graph the compiler already builds, not from message text.
Every dependent keeps an entry (collapsed in default output, listed in `--verbose` or `--json`), and the summary
states both numbers ("412 warnings, 9 root causes"). `--strict` fails on the underlying set: it must never pass
because a group was collapsed. Test: two independent errors in one formula are both reported.
**Phase:** Check report, after the failure sources exist. Confidence: HIGH (design reasoning).

### K2. The quiet category swallows a referenced object
**What goes wrong:** "Unreferenced system objects" are classified quiet. If "referenced" is computed by a
different walk than the one that raises `reference-target`/`standard-object` warnings, an object referenced
only from a formula global, roll-up summary target, validation rule text, record type, picklist dependency or
`$ObjectType` falls through and its warning disappears.
**Prevention:** compute reference sets once (lookup `referenceTo`, formula `references`, rollup definitions,
metadata files naming the object) and use the same set for both warnings and quiet classification. Invariant
test: for every warning naming an object X, X is not quiet; for every quiet object X, no field, formula or
rule resolves to it. Quiet entries remain listed in a separate "informational" section and in `--json`; never
omitted. Quiet objects never count towards `--strict` failure, but referenced ones always do.
**Phase:** Check report. Confidence: HIGH.

### K3. Report redesign breaks scripts and acceptance records
**What goes wrong:** `warning: UNSUPPORTED:<area> ...` lines on stderr are parsed by CI (`--strict`), docs,
and tests; the v1.0 acceptance record cites exit code and a summary line.
**Prevention:** keep one `warning:` line per root-cause entry in the same format (stderr), add the summary on
stdout, keep exit-code semantics, update `examples/acme` and docs together, and add a snapshot test of the
exact output for the acme fixture.
**Phase:** Check report. Confidence: HIGH.

### G1. Fixture and docs leak real-org names (HARD CONSTRAINT)
**What goes wrong:** A public `examples/enterprise` made by "sanitising" the private retrieve keeps its shape:
object counts, field naming patterns, unusual relationship names, validation-rule logic. Also, warning text from
the large org pasted into planning docs, plans, issues or this agent's context discloses names. The large org
is an employer's metadata (CLAUDE.md levels apply: treat as Level 2+ and keep it out of Claude context and
the repo).
**Prevention:** author the fixture from the public documentation of each feature, never by editing a copy of
the retrieve; generic names (`Acme_*`, `Widget__c`), small counts per category; reviewers check names against
a private denylist kept outside the repo (a local pre-push script, not committed with the names inside).
Report the large run only as warning counts per area, per PROJECT.md. Planning artefacts and commit messages
carry no object names from it.
**Phase:** every phase; the fixture task owns the check. Confidence: HIGH (project constraint).

## Minor Pitfalls

### N1. Conformance describe suites against a bigger org
**What goes wrong:** `describeGlobal` gains ~50 entries; jsforce `connection-meta` tests and
`describe-check/contract.json` assert key sets. A new field type string, an absent `urls` key or a
`queryable:true` object that cannot be queried fails a suite that was green.
**Prevention:** run `conformance/run-all.sh` after the baseline phase, not only at milestone end; treat any
new red as a v1.1 regression until classified (v1.0 D-02 rule). Confidence: HIGH.

### N2. Generated JSON churn
**What goes wrong:** Non-deterministic generator output (map order, timestamps) makes every regeneration a
huge diff, and field order changes column ordinal positions in new databases and describe order.
**Prevention:** sort keys and fields by a documented rule, no timestamps, append-only field order for existing
objects (keep v1 order, add new fields after). Confidence: MEDIUM.

### N3. Child relationship name clashes
**What goes wrong:** Documented `childRelationshipName`s for new lookups (e.g. to Account) can duplicate each
other or an existing one; the compiler resolves subqueries by that name.
**Prevention:** build-time uniqueness check per parent object over baseline children; fail the generator.
Confidence: MEDIUM.

### N4. Compile-time vs data-time errors for globals
**What goes wrong:** Mixing "global does not exist" (compile, `UNSUPPORTED:formula-global` or field-not-found)
with "value is blank" (runtime) produces inconsistent `check` results.
**Prevention:** one rule: names and types validated at compile; data absence evaluates to blank, with at most
one aggregated warning. `$Permission` stays `UNSUPPORTED:formula-global`. Confidence: HIGH.

## Phase-Specific Warnings

| Phase topic | Likely pitfall | Mitigation |
|-------------|---------------|------------|
| Baseline v2 generator | B1, B3, B4, M3, M4, N2 | Provenance, overrides, null prefixes, v1-v2 diff gate |
| Baseline v2 migration | M1, M2 | Populated-DB upgrade test first; no NOT NULL from nillable |
| New business objects | B2, B5 | Plan expected warning shifts; per-object DML flags; describe-check list |
| OwnerId narrowing | O1, M1 | Per-object source, audit tests, FK pre-scan |
| sigha resync | S1, S2 | Pinned sha, portable script, tests written before resync |
| Formula globals | F1-F5, N4 | One resolver per global, per-batch loading, blank semantics |
| Custom metadata | C1-C4 | Deterministic Ids, `m` prefix namespace, two-pass load, read-only flag |
| Custom settings | C5, F1 | Separate shape, hierarchy resolver, no data claim |
| Roll-up over formula | R1 | Decide materialisation layer before coding; reject forbidden formulas at load |
| Check report | K1, K2, K3 | Structured diagnostics, shared reference set, stable output |
| Fixture and acceptance | G1, N1 | Doc-derived fixture, private denylist, conformance after each phase |

## Blockers for roadmap order
1. Upgrade (populated-DB) migration test exists before any baseline v2 or OwnerId change merges (M1).
2. `keyPrefix` nullability and source labelling decided before generating 50 objects (B3).
3. OwnerId narrowing is per-object data, after the audit of Group-owned tests and `poly-check` (O1).
4. sigha resync precedes formula-global and polymorphic-formula work (S1, S2).
5. Roll-up-over-formula layer decision (materialise in `engine`/`cli`, not in `@orglet/schema`) precedes its plan (R1).
6. Structured diagnostics precede the report redesign; the quiet category shares one reference walk (K1, K2).

## Sources
- Code read directly: `packages/metadata/src/build.ts`, `packages/schema/src/{migrate,ddl,columns,prefixes}.ts`,
  `packages/formula/src/compile.ts`, `scripts/sync-sigha.sh`, `packages/sigha/{VENDOR.md,NOTICE}`,
  `packages/cli/src/main.ts`, `conformance/poly-check`, `conformance/describe-check` (HIGH)
- `.planning/PROJECT.md`, `.planning/milestones/v1.0-research/PITFALLS.md` (HIGH)
- Roll-up over formula restrictions (idempotent, no cross-object, no TODAY/NOW):
  https://www.apexhours.com/aggregating-validating-data/ , https://www.janbasktraining.com/community/salesforce/why-cant-a-formula-number-field-be-used-in-the-rollup-summary-field-salesforce (secondary, MEDIUM; Salesforce Help not fetched)
- Custom metadata record Id prefix `m00` vs custom objects `a00`: https://www.apexhours.com/custom-metadata-types/ (secondary, LOW-MEDIUM)
- Third-party prefix list showing prefixes are not in official docs: https://www.autorabit.com/blog/salesforce-object-prefixes-cheat-sheet/ (LOW)
- Custom metadata XML shape: https://developer.salesforce.com/docs/atlas.en-us.264.0.api_meta.meta/api_meta/meta_custommetadata.htm (official, not re-fetched this session; verify in the phase)
- Everything marked "reasoning" or "verify" above is unverified against Salesforce documentation.
