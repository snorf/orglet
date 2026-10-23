# Phase 12: sigha Resync & Formula Globals - Context

**Gathered:** 2026-10-23
**Status:** Ready for planning

<domain>
## Phase Boundary

The vendored sigha formula front end is resynced to a pinned commit that lexes unary `!` as NOT and
the `Relationship:Object.Field` colon syntax, with the corpus pass count locked so it cannot regress.
On top of that, orglet resolves typed polymorphic references (`Owner:User.Email`, `Owner:Queue.Name`)
and the global variables `$UserRole`, `$Api`, `$Label`, `$CustomMetadata` and `$Setup` (hierarchy
settings), so formulas and validation rules that use them compile and evaluate instead of raising
`UNSUPPORTED:formula` / `UNSUPPORTED:formula-global`. The compiled formula gains a structured
dependency list that Phase 13 builds its roll-up rules on.

Still unsupported after this phase, by design: `$Permission.<name>` and `$Setup` on a List custom
setting (explicit `UNSUPPORTED:formula-global` with the reason stated). Not in this phase: roll-ups over
formula fields (Phase 13), the `orglet check` report redesign (Phase 14), label translations and
per-user language (v2, CSET-03), any `$Api` SOAP endpoints actually being served.

Requirements: FORM-01, FORM-02, FORM-03, FORM-04, FORM-05.

</domain>

<decisions>
## Implementation Decisions

### Upstream strategy and corpus baseline
- **D-01:** The resync pins a commit in the `snorf/sigha` fork now and does not wait for upstream.
  Claude merges `feat/unary-bang` and `feat/polymorphic-colon-ref` into one integration branch in a
  clone outside this repo (Phase 8 D-18 still applies: no `gh pr create`, no pushes to the fork by
  Claude without Johan's say-so). `VENDOR.md` records the fork commit as the pinned revision and keeps
  the "Pending upstream changes" section pointing at the two branches; Johan opens the upstream PRs in
  parallel, at his own pace. FORM-01 explicitly allows the named-fork-commit form.
- **D-02:** Re-pinning from the fork to `rfaulhaber/sigha` once upstream merges is a separate
  `/gsd:quick` task later, not part of this phase. `VENDOR.md`'s pending section must describe exactly
  that follow-up (which branches, what to re-pin).
- **D-03:** The corpus baseline becomes checkable: before the resync the planner/executor runs the
  vendored conformance tests on the current pin and records pass/total per corpus file; after the resync
  the counts are compared, and an orglet-owned test (outside `packages/sigha/src`, which the sync script
  wipes) asserts a minimum pass count so a future resync that drops cases fails CI. The numbers and
  their composition (which file, what "pass" counts) are written into `VENDOR.md` and the plan SUMMARY,
  replacing the undocumented "6 312" figure with a measured one.
- **D-04:** `corpus/org-verified.json` and `org-conformance.test.ts` stay vendored exactly as today, but
  the locked minimum pass count covers only `corpus/salesforce-v2.json` (the BSD-3 formula-engine
  corpus). The org-verified file's provenance question (milestone research, open question 1) stays open
  and is not a Phase 12 blocker.
- **D-05:** The Phase 8 D-20 `it.fails` expectation tests in `packages/formula/src/expectations.test.ts`
  (`!ISBLANK`, `Owner:User.Email`, `Owner:Group.Name`, `Owner:Queue.Name`) flip to `it` in the resync
  plan; the Phase 8 D-21 tests asserting colon syntax gives `UNSUPPORTED:formula`
  (`packages/formula/src/formula.test.ts`, `packages/engine/src/query.test.ts`) are removed or
  rewritten to the new behaviour. The `compile.ts` regex fallback that classifies `unexpected-character`
  as `UNSUPPORTED:formula` goes away with them. Resync is the first plan of the phase so nothing else is
  built on the old lexer.

### `$Api` and request context
- **D-06:** The host part of `$Api.Partner_Server_URL_<n>` and `$Api.Enterprise_Server_URL_<n>` is the
  same request-derived base URL that login already returns as `instance_url` (`baseUrl(req)` in
  `packages/api/src/server.ts`: `x-forwarded-proto`/`x-forwarded-host`, else the request's protocol and
  `Host`). No new configuration variable.
- **D-07:** `$Api.Session_ID` evaluates to the request's bearer token, the same string the client got as
  `access_token` / SOAP `sessionId`. No masking.
- **D-08:** Every integer `n` is accepted and formatted directly:
  `<base>/services/Soap/u/<n>.0/<OrganizationId>` (partner) and
  `<base>/services/Soap/c/<n>.0/<OrganizationId>` (enterprise). No list of advertised API versions is
  consulted. The researcher confirms the exact path shape from public Salesforce documentation; if the
  documented shape differs, the documented one wins.
- **D-09:** When a formula is evaluated without a request (engine used directly, `orglet up --import`
  defaults and validation rules, seeding, tests), `$Api.*` evaluates blank and the engine emits one
  aggregated `UNSUPPORTED:formula-global` warning per formula (not per row) saying that no request context
  is available. The formula still compiles and the save is not blocked. How request context (base URL,
  token) reaches the engine is Claude's discretion (see below), but the `DmlEngine` and
  `FormulaRegistry` stay shared across requests; the values must be per evaluation.

### Colon syntax semantics
- **D-10:** `Owner:Queue.<field>` and `Owner:Group.<field>` both resolve against the `Group` object and
  match every Group row the record is owned by. `Queue` is a pure alias; the canonical path segment is
  `Owner:Group` (Phase 4 D-16, folded todo). No filtering on `Group.Type`.
- **D-11:** A typed qualifier ends the polymorphism: after `Owner:User` the path continues like an
  ordinary User lookup (`Owner:User.Manager.Email`, `Owner:User.Profile.Name`) with the same depth rules
  as today. `loadParents` no longer stops at a polymorphic parent when the segment carries a type; it
  loads the parent only when the Id's key prefix matches that object and attaches `null` otherwise, so
  every field under a wrong-type qualifier is blank (FORM-02).
- **D-12:** A qualifier naming an object that is among the lookup's declared targets is accepted even if
  the lookup has a single target (e.g. `Owner:User.Name` on an object whose `OwnerId` was narrowed to
  User in Phase 9), unless the researcher finds public documentation that Salesforce rejects colon syntax
  on non-polymorphic lookups, in which case the documented rule wins. A qualifier naming an object the
  lookup cannot reference is a compile error (FORM-02).
- **D-13:** Plain `Owner.Name` on a lookup that is still polymorphic keeps failing compilation as a real
  org does (Phase 4 D-08 unchanged). The compile-error wording for an invalid qualifier uses Salesforce's
  own text when the researcher finds it in public docs; otherwise a descriptive orglet message, recorded
  as an orglet choice in RESEARCH.md.

### Registry surface for Phase 13
- **D-14:** `CompiledFormula` gains a structured dependency list: referenced fields grouped per object
  (own fields plus the parent paths they hang off), the global roots used (`$User`, `$Profile`,
  `$Organization`, `$UserRole`, `$Api`, `$Label`, `$CustomMetadata`, `$Setup`, `$System`), and a
  volatility flag (`NOW`, `TODAY`, `TIMENOW` or any evaluation-time global). `FormulaRegistry` exposes it
  per object and field. The reverse index (which formulas read field X), cross-formula graph and cycle
  detection are Phase 13's work and are not built here.
- **D-15:** The `ReferenceKind` union and `FieldReference` are extended for the new kinds (label, custom
  metadata, setting, api, user role) rather than inventing a parallel structure; the invariant
  `registry.warnings == registry.diagnostics.map(formatDiagnostic)` (asserted by an existing test) holds
  for every new warning, and all of them stay visible to `orglet check --strict`.

### `$Setup`, `$Label`, `$CustomMetadata`, `$UserRole` (requirements already fix most of this)
- **D-16:** `$Setup.<Setting__c>.<Field__c>` on a Hierarchy setting resolves at evaluation time per
  field in the order user (`SetupOwnerId = session.userId`), profile (`session.profileId`), organization
  (`session.organizationId`). When no level has a non-null value, the researcher checks whether
  Salesforce falls through to the field's `defaultValue`; documented behaviour wins, otherwise the field
  is blank. `$Setup` on a List setting and `$Permission.<name>` remain `UNSUPPORTED:formula-global` with
  the reason in the message (FORM-05).
- **D-17:** `$Label.<Name>` and `$CustomMetadata.<Type__mdt>.<Record>.<Field__c>` resolve at compile
  time from `OrgSchema.labels` and the loaded custom-metadata records; unknown label, type or field is a
  compile error with Salesforce's wording, unknown record is blank with one aggregated
  `UNSUPPORTED:custom-metadata-record` warning (FORM-04). Staleness is acceptable: both change only when
  the metadata is reloaded, which already means a restart.
- **D-18:** `$UserRole.<field>` resolves like `$Profile`: the running user's `UserRoleId` is followed to
  the baseline `UserRole` object when globals are loaded per transaction, and every field is blank when
  the user has no role (FORM-03).

### Claude's Discretion
- How request context (base URL, bearer token) travels from the API layer to formula evaluation (extend
  `Session`, a per-call context object, or a scoped evaluation context); the constraint is D-09.
- The exact data shape of the dependency list (D-14) and how `FormulaRegistry` exposes it.
- Whether `$Label`/`$CustomMetadata` values are inlined as constants at compile time or kept as keyed
  references resolved from a static map at evaluation time; D-17 only fixes when errors are raised.
- `$Label` casing, namespaced `$Label.ns.Name`, the `$CustomMetadata` record-key form (DeveloperName
  only, case rules) and whether `__mdt` relationship fields are traversable in `$CustomMetadata` paths:
  the researcher settles these from public docs and records orglet choices where docs are silent.
- Which `UserRole` fields `$UserRole` exposes (all baseline fields unless docs restrict it).
- Name of the fork integration branch and how the sync is run against it (the script accepts a rev or a
  local clone directory).

### Folded Todos
- **Support Relationship:Object.Field colon syntax for polymorphic formula references**
  (`.planning/todos/pending/2026-10-08-sigha-colon-syntax-for-polymorphic-formula-references.md`).
  Problem: the vendored lexer rejects `:`, so Phase 4 shipped D-16 (colon syntax is
  `UNSUPPORTED:formula`). Fits FORM-01/FORM-02 exactly; its proposals (upstream fix then resync,
  `resolvePath` accepts a `Rel:Object` segment, `Queue` aliases `Group`, canonical `Owner:Group`,
  `loadParents` keeps only Ids whose prefix matches the named object) are adopted as D-01, D-05, D-10
  and D-11. The todo file is moved to done when the phase completes.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements and roadmap
- `.planning/REQUIREMENTS.md` — FORM-01..FORM-05 (lines ~120-137) are the acceptance text; also the
  traceability table rows to mark complete.
- `.planning/ROADMAP.md` — Phase 12 section (goal, five success criteria, research flag) and the
  Phase 13 section (what the registry/dependency list must enable).
- `.planning/PROJECT.md` — Key Decisions rows on the formula engine (vendored sigha, gaps fixed upstream,
  no own parser) and the "Polymorphic formula references deferred … Pending (Phase 4, D-16, todo)" row,
  which this phase closes.

### Prior phase decisions that bind this phase
- `.planning/phases/04-polymorphic-lookups-soql-typeof/04-CONTEXT.md` — D-08 (plain `Owner.Name`
  rejected), D-09 (no local pre-processing of formula text), D-16 (colon syntax gap, `Queue` alias),
  D-17 (polymorphic gating on `referenceTo.length > 1`).
- `.planning/phases/08-upgrade-safety-net-nullable-key-prefixes/08-CONTEXT.md` — D-17..D-21 (portable
  sync script, Claude authors the upstream fix outside the repo and never opens PRs, `VENDOR.md` pending
  section, `it.fails` expectation tests to flip, old UNSUPPORTED tests to remove). Also 08-08 SUMMARY for
  what was actually pushed to the fork.
- `.planning/phases/11-custom-metadata-custom-settings-labels/11-CONTEXT.md` — labels on
  `OrgSchema.labels`, `__mdt` derived Ids and seeding, custom settings shape (D-17..D-20), and the
  explicit deferral of `$Label`/`$CustomMetadata`/`$Setup` to this phase.
- `.planning/phases/07-conformance-re-run-milestone-acceptance/07-CONTEXT.md` — D-21: fidelity bugs are
  fixed only with a documented Salesforce basis; `--strict` counts `formula` and `formula-global`.

### Milestone research
- `.planning/research/STACK.md` §sigha (~lines 105-125) — upstream design of `!` (BANG → NOT) and the
  colon absorbed in `scanIdentifier`; fallback of pinning a fork commit.
- `.planning/research/SUMMARY.md` — Phase 12 delivery description ("resync goes first") and open
  question 1 on `org-verified.json`.
- `.planning/research/PITFALLS.md` — the corpus-regression pitfall around "6 312".

### Vendoring
- `packages/sigha/VENDOR.md` — pinned revision `2abe5dbb…` (synced 2026-09-25), the "Pending upstream
  changes" table with `snorf/sigha:feat/unary-bang` and `snorf/sigha:feat/polymorphic-colon-ref`.
- `scripts/sync-sigha.sh` — accepts `<rev>` or a local clone dir, wipes `src/` and `corpus/`, preserves
  the pending section; `.github/workflows/ci.yml` job `sigha-sync-check` re-runs it from the pinned
  revision, so the pin must be fetchable by CI.

### External public documentation (researcher re-reads and cites)
- Salesforce Help: "Formula Operators and Functions", "Global Variables" (`$Api`, `$Label`,
  `$CustomMetadata`, `$Setup`, `$UserRole`, `$Permission`) and the custom-settings hierarchy semantics
  (user → profile → organization, field-level fall-through).
- Salesforce Help on polymorphic references in formulas (`Owner:User.Field`, `Owner:Queue.Field`,
  `What:Account.Field`) and the compile errors for invalid qualifiers.
- rfaulhaber/sigha upstream repository and the two fork branches (MIT).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/formula/src/compile.ts`: `GLOBAL_OBJECTS` table (`$user`, `$profile`, `$organization`,
  `$recordtype`), `rewriteFieldRef` (where `UNSUPPORTED:formula-global` is thrown today), `resolvePath`
  (rejects polymorphic traversal per D-08), `register()` producing keyed `FieldReference`s whose synthetic
  key the evaluator looks up. New globals and typed segments slot into these three functions.
- `packages/formula/src/evaluate.ts`: `EvaluationContext {record, old?, isNew, user?, profile?,
  organization?, recordType?, now?}` and `globalRecord()`; values are fetched here at evaluation time.
  `$UserRole`, `$Setup` and `$Api` need new slots or a precomputed-value map; `$Label` and
  `$CustomMetadata` can be static.
- `packages/engine/src/formulas.ts`: `FormulaRegistry` compiles eagerly per object (rules, fields,
  defaults), keeps `warnings`/`diagnostics` 1:1, exposes `parentPaths(obj, kinds)`. The dependency list
  (D-14) hangs off `CompiledFormula` and is surfaced here.
- `packages/engine/src/engine.ts`: `loadGlobals(client, session)` loads User/Profile/Organization by Id
  once per transaction and `project()`; `$UserRole` is one more `loadByIds` from `User.UserRoleId`,
  `$Setup` three `findByField` lookups on `SetupOwnerId`.
- `packages/engine/src/parents.ts`: `loadParents` uses `matchLookupTarget(rel.targets, rel.declared, id)`
  (key-prefix match) and currently stops at polymorphic parents; the typed segment reuses the prefix match
  and continues.
- `packages/metadata/src/types.ts`: `OrgSchema.labels` / `getLabel(fullName)` (lower-cased key),
  `CustomMetadataRecord`, `SObjectDef.customSetting`, `SObjectDef.customMetadata`.
- `packages/engine/src/seed.ts`: `planCustomMetadataSeed` (pure, available at `check` time) and the
  seeded `__mdt` tables (available after `orglet up`).
- `packages/api/src/server.ts` `baseUrl(req)` and `packages/api/src/auth.ts` `SessionStore`
  (`LoginResult {session, token}`): the two sources `$Api` needs.
- `packages/formula/src/expectations.test.ts` (`it.fails` block), `packages/formula/src/formula.test.ts`
  (acme-based `rule()`/`field()`/`run()` helpers), `packages/engine/src/formulas.test.ts` (registry
  warnings/diagnostics equality) are the test files to extend.

### Established Patterns
- Compile-time resolution into keyed references, evaluation-time value lookup; the sigha evaluator never
  changes, orglet only fills the `fields` map.
- `UNSUPPORTED:<area>` messages are built once as structured `Diagnostic`/`FormulaFailure` records with
  the string form derived by `formatDiagnostic`; both must stay in lockstep.
- No hand edits under `packages/sigha/src`; the sync script is the only writer, CI diffs it against the
  pinned revision.
- Fidelity claims need a public-doc citation; undocumented behaviour is recorded as an orglet choice in
  RESEARCH.md.
- `Session` (`packages/engine/src/hooks.ts`) is `{userId, organizationId, profileId}`; it is the only
  per-request information the engine sees today.

### Integration Points
- `compile.ts` global table and `rewriteFieldRef` (new roots), `resolvePath` (typed segments),
  `evaluate.ts` context (new slots), `engine.ts` `loadGlobals` and the three evaluation call sites
  (`project`, `runValidationRules`, `defaults`), `parents.ts` (typed polymorphic loading), API routes that
  construct the engine session (request context for `$Api`), `cli/main.ts` `check`/`up` warning output,
  `scripts/sync-sigha.sh` + `VENDOR.md` + the `sigha-sync-check` CI job, and a new orglet-owned corpus
  baseline test.

</code_context>

<specifics>
## Specific Ideas

- Resync is the first plan of the phase (roadmap text); everything else assumes the new lexer.
- The measured corpus numbers replace the folklore "6 312": record pass/total per file before and after,
  lock only `salesforce-v2.json`.
- `$Api` values must match what the client already sees (`instance_url`, `access_token`) so a formula
  that builds an API link works against orglet unchanged.
- Formulas from real orgs commonly traverse `Owner:User.Profile.Name` / `Owner:User.Manager.*`; D-11
  exists for them.

</specifics>

<deferred>
## Deferred Ideas

- Re-pin from the `snorf/sigha` fork to `rfaulhaber/sigha` once the upstream PRs merge — own
  `/gsd:quick` task (D-02).
- Showing the formula dependency list in the `orglet check` report — Phase 14 (check report).
- `$Permission` — security/permission-set milestone; `$Setup` on List settings and label translations —
  v2 (CSET-03).
- Serving the `/services/Soap/u|c/<n>.0/<orgId>` endpoints that `$Api` URLs point at — out of scope;
  the URLs are values, not routes.

### Reviewed Todos (not folded)
- **Standard-field gaps on the 18 business objects seen in a large real-org retrieve**
  (`.planning/todos/pending/2026-10-16-standard-field-gaps-on-the-18-business-objects.md`) — baseline
  generator work (`overrides.json`, public-source evidence per field), not formulas; stays pending for
  Phase 14 or a quick task.

</deferred>

---

*Phase: 12-sigha-resync-formula-globals*
*Context gathered: 2026-10-23*
