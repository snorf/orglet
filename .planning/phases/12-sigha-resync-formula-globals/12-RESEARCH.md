# Phase 12: sigha Resync & Formula Globals - Research

**Researched:** 2026-10-23
**Domain:** Vendored formula front end (sigha lexer/parser) plus orglet's formula compile/evaluate layer, engine globals, API request context
**Confidence:** MEDIUM-HIGH (code facts and fork contents HIGH; Salesforce documentation facts MEDIUM because developer.salesforce.com blocked direct fetch, so quotes come from search-result excerpts of the official pages)

## Summary

The resync is small and mechanically safe. Both fork branches are based exactly on the current pin (`2abe5dbb`, merge-base verified), upstream `rfaulhaber/sigha` main has moved by 7 commits since the pin but **none touch `src/` or `corpus/`** (dependabot bumps only), and the two branches merge with no conflict. Running `scripts/sync-sigha.sh` against a local merge clone changes exactly six vendored files (`analysis/checker.ts`, `engine/evaluator.ts`, `i18n/en/syntax.ts`, `syntax/ast.ts`, `syntax/lexer.ts`, `syntax/parser.ts`) and leaves both corpus files byte-identical. The "6 312" figure is real and reproducible: `salesforce-v2.json` gives `pass 6312 / fail 0 / quarantine 1394 / unsupported 1982 / org-overruled 42 / total 9730`. After the merge the AST for `Owner:User.Email` is one `FieldRef` with `path: ["Owner:User", "Email"]` (the colon is absorbed into the identifier token), so orglet only has to split a segment on `:` in `resolvePath` and `loadParents`.

Three things in the CONTEXT decisions need attention before planning. (1) **D-08 is wrong about the `$Api` suffix**: the documented name is `Partner_Server_URL_<xxx>` where `xxx` is the API version times ten (`_250` is 25.0, `_600` is 60.0), so `<n>` is not formatted as `<n>.0` but as `n/10` with one decimal. D-08 itself says the documented shape wins. (2) The fork's `scripts/sync-sigha.sh` and CI job `sigha-sync-check` hard-code `https://github.com/rfaulhaber/sigha.git`, so a fork commit is not fetchable by CI until the script takes a repository override and the CI step passes it. (3) `FormulaRegistry` is constructed from `OrgSchema` alone, but `$CustomMetadata` needs the loaded `CustomMetadataRecord` rows (they are not on `OrgSchema`), so the registry and `DmlEngine` constructors need a new input.

For request context, extending `Session` with an optional `request` object and populating it in the single `session(req)` helper in `packages/api/src/server.ts` is the least invasive option: every route already goes through that helper, the engine already threads `Session` into `loadGlobals`, and `Globals` already flows by spread into all three evaluation call sites. Bulk jobs persist only three Session fields and rebuild the Session from Postgres, so they naturally get no request context (D-09 blank plus warning).

**Primary recommendation:** Plan 1 = resync (build integration branch in the persistent clone, make sync script/CI fork-aware, pin the merge SHA, flip expectation tests, add an orglet-owned `packages/sigha/test/corpus-baseline.test.ts` asserting `runRow` pass >= 6312). Plans 2..n layer the compile-time changes (typed segments, new global roots, dependency list), then evaluation-time globals (`$UserRole`, `$Setup`, `$Api`) via `Globals`/`EvaluationContext`, using `Session.request` for `$Api`.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Upstream strategy and corpus baseline**
- **D-01:** The resync pins a commit in the `snorf/sigha` fork now and does not wait for upstream. Claude merges `feat/unary-bang` and `feat/polymorphic-colon-ref` into one integration branch in a clone outside this repo (Phase 8 D-18 still applies: no `gh pr create`, no pushes to the fork by Claude without Johan's say-so). `VENDOR.md` records the fork commit as the pinned revision and keeps the "Pending upstream changes" section pointing at the two branches; Johan opens the upstream PRs in parallel, at his own pace. FORM-01 explicitly allows the named-fork-commit form.
- **D-02:** Re-pinning from the fork to `rfaulhaber/sigha` once upstream merges is a separate `/gsd:quick` task later, not part of this phase. `VENDOR.md`'s pending section must describe exactly that follow-up (which branches, what to re-pin).
- **D-03:** The corpus baseline becomes checkable: before the resync the planner/executor runs the vendored conformance tests on the current pin and records pass/total per corpus file; after the resync the counts are compared, and an orglet-owned test (outside `packages/sigha/src`, which the sync script wipes) asserts a minimum pass count so a future resync that drops cases fails CI. The numbers and their composition (which file, what "pass" counts) are written into `VENDOR.md` and the plan SUMMARY, replacing the undocumented "6 312" figure with a measured one.
- **D-04:** `corpus/org-verified.json` and `org-conformance.test.ts` stay vendored exactly as today, but the locked minimum pass count covers only `corpus/salesforce-v2.json` (the BSD-3 formula-engine corpus). The org-verified file's provenance question (milestone research, open question 1) stays open and is not a Phase 12 blocker.
- **D-05:** The Phase 8 D-20 `it.fails` expectation tests in `packages/formula/src/expectations.test.ts` (`!ISBLANK`, `Owner:User.Email`, `Owner:Group.Name`, `Owner:Queue.Name`) flip to `it` in the resync plan; the Phase 8 D-21 tests asserting colon syntax gives `UNSUPPORTED:formula` (`packages/formula/src/formula.test.ts`, `packages/engine/src/query.test.ts`) are removed or rewritten to the new behaviour. The `compile.ts` regex fallback that classifies `unexpected-character` as `UNSUPPORTED:formula` goes away with them. Resync is the first plan of the phase so nothing else is built on the old lexer.

**`$Api` and request context**
- **D-06:** The host part of `$Api.Partner_Server_URL_<n>` and `$Api.Enterprise_Server_URL_<n>` is the same request-derived base URL that login already returns as `instance_url` (`baseUrl(req)` in `packages/api/src/server.ts`: `x-forwarded-proto`/`x-forwarded-host`, else the request's protocol and `Host`). No new configuration variable.
- **D-07:** `$Api.Session_ID` evaluates to the request's bearer token, the same string the client got as `access_token` / SOAP `sessionId`. No masking.
- **D-08:** Every integer `n` is accepted and formatted directly: `<base>/services/Soap/u/<n>.0/<OrganizationId>` (partner) and `<base>/services/Soap/c/<n>.0/<OrganizationId>` (enterprise). No list of advertised API versions is consulted. The researcher confirms the exact path shape from public Salesforce documentation; if the documented shape differs, the documented one wins.
- **D-09:** When a formula is evaluated without a request (engine used directly, `orglet up --import` defaults and validation rules, seeding, tests), `$Api.*` evaluates blank and the engine emits one aggregated `UNSUPPORTED:formula-global` warning per formula (not per row) saying that no request context is available. The formula still compiles and the save is not blocked. How request context (base URL, token) reaches the engine is Claude's discretion (see below), but the `DmlEngine` and `FormulaRegistry` stay shared across requests; the values must be per evaluation.

**Colon syntax semantics**
- **D-10:** `Owner:Queue.<field>` and `Owner:Group.<field>` both resolve against the `Group` object and match every Group row the record is owned by. `Queue` is a pure alias; the canonical path segment is `Owner:Group` (Phase 4 D-16, folded todo). No filtering on `Group.Type`.
- **D-11:** A typed qualifier ends the polymorphism: after `Owner:User` the path continues like an ordinary User lookup (`Owner:User.Manager.Email`, `Owner:User.Profile.Name`) with the same depth rules as today. `loadParents` no longer stops at a polymorphic parent when the segment carries a type; it loads the parent only when the Id's key prefix matches that object and attaches `null` otherwise, so every field under a wrong-type qualifier is blank (FORM-02).
- **D-12:** A qualifier naming an object that is among the lookup's declared targets is accepted even if the lookup has a single target (e.g. `Owner:User.Name` on an object whose `OwnerId` was narrowed to User in Phase 9), unless the researcher finds public documentation that Salesforce rejects colon syntax on non-polymorphic lookups, in which case the documented rule wins. A qualifier naming an object the lookup cannot reference is a compile error (FORM-02).
- **D-13:** Plain `Owner.Name` on a lookup that is still polymorphic keeps failing compilation as a real org does (Phase 4 D-08 unchanged). The compile-error wording for an invalid qualifier uses Salesforce's own text when the researcher finds it in public docs; otherwise a descriptive orglet message, recorded as an orglet choice in RESEARCH.md.

**Registry surface for Phase 13**
- **D-14:** `CompiledFormula` gains a structured dependency list: referenced fields grouped per object (own fields plus the parent paths they hang off), the global roots used (`$User`, `$Profile`, `$Organization`, `$UserRole`, `$Api`, `$Label`, `$CustomMetadata`, `$Setup`, `$System`), and a volatility flag (`NOW`, `TODAY`, `TIMENOW` or any evaluation-time global). `FormulaRegistry` exposes it per object and field. The reverse index (which formulas read field X), cross-formula graph and cycle detection are Phase 13's work and are not built here.
- **D-15:** The `ReferenceKind` union and `FieldReference` are extended for the new kinds (label, custom metadata, setting, api, user role) rather than inventing a parallel structure; the invariant `registry.warnings == registry.diagnostics.map(formatDiagnostic)` (asserted by an existing test) holds for every new warning, and all of them stay visible to `orglet check --strict`.

**`$Setup`, `$Label`, `$CustomMetadata`, `$UserRole`**
- **D-16:** `$Setup.<Setting__c>.<Field__c>` on a Hierarchy setting resolves at evaluation time per field in the order user (`SetupOwnerId = session.userId`), profile (`session.profileId`), organization (`session.organizationId`). When no level has a non-null value, the researcher checks whether Salesforce falls through to the field's `defaultValue`; documented behaviour wins, otherwise the field is blank. `$Setup` on a List setting and `$Permission.<name>` remain `UNSUPPORTED:formula-global` with the reason in the message (FORM-05).
- **D-17:** `$Label.<Name>` and `$CustomMetadata.<Type__mdt>.<Record>.<Field__c>` resolve at compile time from `OrgSchema.labels` and the loaded custom-metadata records; unknown label, type or field is a compile error with Salesforce's wording, unknown record is blank with one aggregated `UNSUPPORTED:custom-metadata-record` warning (FORM-04). Staleness is acceptable: both change only when the metadata is reloaded, which already means a restart.
- **D-18:** `$UserRole.<field>` resolves like `$Profile`: the running user's `UserRoleId` is followed to the baseline `UserRole` object when globals are loaded per transaction, and every field is blank when the user has no role (FORM-03).

### Claude's Discretion
- How request context (base URL, bearer token) travels from the API layer to formula evaluation (extend `Session`, a per-call context object, or a scoped evaluation context); the constraint is D-09.
- The exact data shape of the dependency list (D-14) and how `FormulaRegistry` exposes it.
- Whether `$Label`/`$CustomMetadata` values are inlined as constants at compile time or kept as keyed references resolved from a static map at evaluation time; D-17 only fixes when errors are raised.
- `$Label` casing, namespaced `$Label.ns.Name`, the `$CustomMetadata` record-key form (DeveloperName only, case rules) and whether `__mdt` relationship fields are traversable in `$CustomMetadata` paths: the researcher settles these from public docs and records orglet choices where docs are silent.
- Which `UserRole` fields `$UserRole` exposes (all baseline fields unless docs restrict it).
- Name of the fork integration branch and how the sync is run against it (the script accepts a rev or a local clone directory).

### Deferred Ideas (OUT OF SCOPE)
- Re-pin from the `snorf/sigha` fork to `rfaulhaber/sigha` once the upstream PRs merge: own `/gsd:quick` task (D-02).
- Showing the formula dependency list in the `orglet check` report: Phase 14 (check report).
- `$Permission`: security/permission-set milestone; `$Setup` on List settings and label translations: v2 (CSET-03).
- Serving the `/services/Soap/u|c/<n>.0/<orgId>` endpoints that `$Api` URLs point at: out of scope; the URLs are values, not routes.
- Reviewed, not folded: standard-field gaps on the 18 business objects (baseline generator work, Phase 14 or a quick task).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FORM-01 | Resync to a pinned full commit recorded in VENDOR.md, corpus pass count >= v1.0 baseline, sync script on macOS and Linux; `!ISBLANK(x)` is NOT, `!`/`:` in strings unaffected | Fork branches verified, merge is conflict-free, sync run on macOS produced only 6 changed files, corpus unchanged; baseline measured as 6312; CI needs fork-aware repo override (Standard Stack, Pitfall 1, Validation) |
| FORM-02 | `Owner:User.Email` / `Owner:Queue.Name` evaluate against the named target; blank for the other type; invalid qualifier fails to compile | AST shape verified (`path: ["Owner:User","Email"]`); `resolvePath` and `loadParents` change points identified; documented syntax and queue field names (Pattern 2, Open Questions 2, 3) |
| FORM-03 | `$UserRole.<field>` blank without a role; `$Api` Partner/Enterprise URL and Session_ID evaluate to the server's URLs and the request's session | Doc shape of `$Api` names (version x10), `$UserRole` doc, transport options and recommendation (Patterns 4, 5, Q8) |
| FORM-04 | `$Label` and `$CustomMetadata` resolve from loaded data; unknown label/type/field compile error; unknown record blank plus aggregated `UNSUPPORTED:custom-metadata-record` | Registry lacks CMT records today (constructor change), doc facts on CMT syntax/limits, label key rules (Pattern 3) |
| FORM-05 | `$Setup.<Setting__c>.<Field__c>` user -> profile -> org per field; `$Setup` on list setting and `$Permission` stay `UNSUPPORTED:formula-global` with reason | Documented hierarchy merge semantics, List settings not formula-accessible, `$Permission` semantics (Pattern 6) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Build only from public documentation and open-source SDK source; never diff behaviour against a real org. Every fidelity claim needs a public-doc citation; undocumented behaviour is an explicit "orglet choice". (This research cites only public docs and the BSD-3 `salesforce/formula-engine` grammar. The vendored `org-verified.json` and the "org-verified" comments inside sigha have an open provenance question and are used as corroboration only, never as the sole basis.)
- TypeScript strict (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`), Node 22, pnpm 10+, Postgres 16, Fastify 5, vitest. Relative imports carry `.js`; cross-package imports use `@orglet/*` only; one barrel `index.ts` per package with explicit named exports (never `export *`).
- `UNSUPPORTED:<area>` is mandatory for anything not implemented; messages built as structured `Diagnostic`/`FormulaFailure` with the string derived by `formatDiagnostic`; the `warnings`/`diagnostics` 1:1 invariant must hold.
- Errors go through the existing factories (`Errors.*`, `apiError`, `sendErrors`); do not invent StatusCodes.
- Never hand-edit `packages/sigha/src`; never `gh pr create`; never push to the sigha fork or create repos without Johan's confirmation.
- Git identity for commits: repo-local Johan Karlsteen <johan@karlsteen.com>; the global config is a Tele2 service account. A fork clone used for the merge must have repo-local identity set before the merge commit.
- Level 1 data only (public docs and OSS code). No Tele2 names anywhere in repo artefacts.
- GSD workflow: all repo edits through GSD commands. Files in code are English; comments explain Salesforce-specific reasoning, every source file opens with a purpose block.
- No emojis in output.

## Standard Stack

No new runtime dependencies. Everything is existing code.

### Core
| Component | Version / ref | Purpose | Why Standard |
|-----------|---------------|---------|--------------|
| Vendored sigha | fork merge commit (to be created; `f06f3c7` in the scratch clone is a rehearsal only) | Lexer/parser/checker/evaluator | Decision D-01; both branches based on pin `2abe5dbb` |
| `@orglet/formula` `compile.ts` / `evaluate.ts` | in repo | Keyed-reference rewrite; evaluator never changes | Established pattern: compile to keyed refs, fill `fields` map at evaluation |
| `@orglet/engine` `FormulaRegistry`, `DmlEngine.loadGlobals` | in repo | Eager compile, per-transaction globals | Existing |
| vitest 3.2.x, pglite per file via `test/db.ts` | existing | Tests | Existing |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Merge commit on a fork branch | Rebase colon branch onto bang branch | Rebase rewrites SHAs of branches that Johan will open as upstream PRs; keep both original branches untouched and merge into a third branch |
| `SIGHA_REPO` env on the sync script | Clone fork by changing the hard-coded URL | Env override keeps the default upstream and makes the later re-pin (D-02) a one-line VENDOR.md change |
| `Session.request` | Per-call `DmlOptions.request`; AsyncLocalStorage | See Pattern 5 blast-radius table |

**Installation:** none. Fork integration branch is built with plain git in the persistent clone (`/Users/johankarlsteen/Development.nosync/sigha-upstream`, per 08-08 SUMMARY; it is outside the repo). The scratch rehearsal used `corepack pnpm install --frozen-lockfile` (pnpm 12.6.0), vitest 4.1.10 in the fork.

**Version verification:** n/a (no package versions). Revisions verified by git: merge-base of both branches with `upstream/main` is `2abe5dbb3ca0ab17b7aa1443024562041336ca5f`; upstream `main` HEAD is `7e60f75` (dependabot), `git diff 2abe5db upstream/main -- src corpus` is empty.

## Architecture Patterns

### Recommended change map (no new packages)
```
scripts/sync-sigha.sh                  # + SIGHA_REPO override, writes "Repository:" line
.github/workflows/ci.yml               # sigha-sync-check reads Repository: and passes SIGHA_REPO
packages/sigha/VENDOR.md               # pin = fork merge SHA, baseline numbers, follow-up text (written by script + hand-kept pending section)
packages/sigha/test/corpus-baseline.test.ts   # NEW orglet-owned guard (survives sync; script only rewrites src/, corpus/, VENDOR.md, LICENSE, NOTICE)
packages/formula/src/compile.ts        # typed segments, new global roots, dependencies, remove regex fallback
packages/formula/src/evaluate.ts       # new EvaluationContext slots, new ReferenceKind handling
packages/engine/src/formulas.ts        # constructor takes custom-metadata records; exposes dependencies, used globals/settings; runtime warning sink
packages/engine/src/engine.ts          # loadGlobals: $UserRole, $Setup (only if referenced), $Api from session.request
packages/engine/src/parents.ts         # typed segments
packages/engine/src/hooks.ts           # Session.request?
packages/api/src/server.ts             # session(req) attaches request context
packages/cli/src/main.ts               # pass loaded.customMetadata into FormulaRegistry (check) and DmlEngine (up)
```

### Pattern 1: Integration branch and fork-aware sync (FORM-01)
**What:** In the persistent clone: `git fetch origin`, create `integration/phase-12` (suggested name) from `feat/unary-bang`, `git merge --no-edit feat/polymorphic-colon-ref` (conflict-free, rehearsed). Set repo-local identity first (`user.email johan@karlsteen.com`, `user.name "Johan Karlsteen"`). Keep both original branches untouched (PR sources). The merge SHA is created once and recorded; re-merging later gives a different SHA.
**Script change:** `git clone -q "${SIGHA_REPO:-https://github.com/rfaulhaber/sigha.git}" "$CLONE"`; heading of generated VENDOR.md gets `Repository: <url>` (CI reads it) and the `Source:` line should name the repo actually used. Local-directory mode (`$1` is a dir) already works and was exercised here against the scratch clone.
**CI change:** in `sigha-sync-check`, `REPO=$(sed -n 's/^Repository: //p' packages/sigha/VENDOR.md)` and `SIGHA_REPO="${REPO:-https://github.com/rfaulhaber/sigha.git}" SIGHA_DEST=... bash scripts/sync-sigha.sh "$REV"`.
**Fetchability:** `git clone` fetches all branch heads, so a full SHA reachable from any pushed branch of the fork checks out. The integration branch must therefore be pushed (by Johan) and **never deleted or force-pushed** while it is the pin. Hence a human checkpoint: the plan cannot finish green in CI until Johan pushes `integration/phase-12` to `snorf/sigha`. Plan that checkpoint explicitly (also for the later PR #13-style merge ordering).
**Portability facts verified:** the script already uses `sed -i.bak`, BSD-safe `sed -E`, POSIX `find`; it ran cleanly on macOS (Darwin) here against a local clone. Linux is covered by the existing CI job (GNU userland).
**Sync result (rehearsed):** only `analysis/checker.ts`, `engine/evaluator.ts`, `i18n/en/syntax.ts`, `syntax/ast.ts`, `syntax/lexer.ts`, `syntax/parser.ts` differ; `corpus/*` identical; `features/field-extraction.ts` and formatter changes are not vendored (script copies only `syntax registry analysis engine i18n`).
**Doc-key removal:** `i18n/en/syntax.ts` loses `unexpectedBang`. No orglet code references it (grep over `packages` found none outside sigha).

### Pattern 2: Typed polymorphic segments (FORM-02)
**AST after resync (verified in fork `parser.test.ts`):** `Owner:User.Email` is a single `FieldRef` with `path: ["Owner:User", "Email"]`; `ISBLANK(Owner:User.Email)` has that FieldRef as its argument. The lexer absorbs `:Identifier` into the preceding identifier only when the colon is directly followed by an identifier start; string literals are lexed first so `'a!b:c'` and `"Owner:User.Email"` stay text.
**`resolvePath` (compile.ts):** when a non-leaf segment contains `:`, split into `rel` and `type`; look up `schema.resolveRelationship(current.name, rel)`; map `Queue` -> `Group` (case-insensitive; canonical `Group`); require `type` to be among `field.referenceTo` (case-insensitive) else throw the invalid-qualifier error; then `current = schema.getObject(typed)`; canonical segment `` `${field.relationshipName ?? rel}:${typed.name}` `` (so `Owner:Queue.Name` and `Owner:Group.Name` share the key `Owner:Group.Name`). Plain polymorphic traversal rejection (`referenceTo.length > 1`) stays for segments without `:`. A leaf segment containing `:` is not valid (error as unknown field).
**`loadParents` (parents.ts):** treat a segment with `:` as `(rel, typed)`. Use `relationship(schema, obj, rel)`, then `targets = [typedObj]` and the field's unchanged `declared` count, and call `matchLookupTarget([typedObj], rel.declared, id)`: for a polymorphic lookup it applies the key-prefix match; for a narrowed single-target lookup whose target has no key prefix it returns the only target (`matchLookupTarget`, `packages/schema/src/ids.ts:61`). Attach the parent under the **full typed segment key** (`r["Owner:User"]`), not under `Owner`, so `lookup(record, ["Owner:User","Email"])` in `evaluate.ts` works with no change and the plain `Owner` key cannot collide. Ids not matching get `null`, which `toSfValue` turns into blank. The "polymorphic stops traversal" `return` must apply only to un-typed segments in the middle of a path.
**Do this for intermediate and leaf prefixes alike** (`Owner:User.Manager.Email`): the prefix expansion loop in `loadParents` splits on `.`, which is safe because `:` is not a dot.
**Queue/Group fields:** `Group` baseline fields are `DeveloperName, Description, DoesIncludeBosses, DoesSendEmailToMembers, Email, Name, RelatedId, Type` plus `Id`.

### Pattern 3: `$Label` and `$CustomMetadata` (FORM-04)
- **Compile-time source:** `$Label` from `schema.getLabel(name)` (already case-insensitive via lower-cased key). `$CustomMetadata` needs the record rows. `FormulaRegistry(schema)` is built in three places that all lack them: `DmlEngine` constructor (`engine.ts:101`), CLI `check` (`main.ts:88`) and tests. `loadOrgSchema` returns `customMetadata: CustomMetadataRecord[]` separately from `schema`. Recommended: `planCustomMetadataSeed(schema, records)` already coerces values by declared type and dedupes, producing `CustomMetadataSeedRow { developerName, values: RecordData }` per type; give `FormulaRegistry` an optional second constructor argument `customMetadata?: CustomMetadataPlan` (or the rows map) and `EngineOptions.customMetadata?` for `DmlEngine`; `up` and `check` already compute the plan. When absent, every `$CustomMetadata.<type>.<record>` is an unknown record (blank plus warning), never a crash.
- **Inline vs keyed:** recommended **keyed references with a precomputed value** stored on the `FieldReference` (kind `label` / `customMetadata`, `value` set at compile time) and `valueFor` returns `toSfValue(ref.value, ref.type)`. Rationale: keeps `D-14` dependency list uniform (every global is a reference), allows `$Label` to be typed Text, and avoids AST rewriting into literal nodes (sigha `StringLit` spans/raw issues).
- **Key shape:** `register()` builds a `FieldRef` with `path = key.split(".")`, so keys must not contain extra dots in a segment. `$Label.X` and `$CustomMetadata.T__mdt.Rec.F__c` are fine (DeveloperName and API names have no dots).
- **Errors (D-17):** unknown label, unknown type, non-`__mdt` object, unknown field on the type: reuse `fieldNotFound(path.join("."))`, i.e. `Field $Label.Foo does not exist. Check spelling.` and `Field $CustomMetadata.T__mdt.Rec.Nope__c does not exist. Check spelling.` This is the same sentence Salesforce uses for any unresolvable reference (existing orglet wording in `compile.ts`, corroborated by a comment in sigha `registry/contexts.ts` about `$CustomMetadata`). Specific Salesforce text for unknown labels/types was not found in public docs: record as **orglet choice (reuse the generic wording)**, LOW-MEDIUM.
- **Unknown record:** compile succeeds; the reference has `value = null`; collect `(type, record)` pairs; registry emits **one** diagnostic per formula (aggregated, area `custom-metadata-record`, object/field of the formula) via `pushDiagnostic` so the 1:1 invariant holds. This is a *warning that coexists with a compiled formula*, a new situation for `tryCompile`, which today only records failures. Return the warnings from `compileFormula` (e.g. `CompiledFormula.warnings: Diagnostic-like[]`) and let `tryCompile` push them.
- **Casing orglet choices:** `$Label.Name` case-insensitive (matches `getLabel`). Namespaced `$Label.ns.Name` (3 segments): **not supported; compile error** with the generic wording. The docs found (Visualforce `$Label.labelName`) do not describe a namespaced form for formulas, and an unmanaged SFDX project has no namespace. Record type and record names case-insensitively (`mdtKey` in `seed.ts` lowercases both). `developerName` is the record key (docs: `$CustomMetadata.CustomMetadataTypeAPIName.RecordAPIName.FieldAPIName`, record API name = DeveloperName).
- **Relationship traversal:** Salesforce documents that spanning custom metadata relationships (`Tier_Group__c.Default_Tier__c`-style) is **not supported in formula fields** and long text area fields are not supported in formula references (help article "Custom Metadata Types and Advanced Formula Fields", help.salesforce.com `custommetadatatypes_formula_fields.htm` and `custommetadatatypes_limitations.htm`, via search excerpt). Therefore a 5th segment (`...Region__c.Name`) is a compile error (generic wording), the 4th segment is the field value itself (for a `MetadataRelationship` field this is the stored Id/DeveloperName text, `sfTypeOf` already maps definition-target relationships to Text), and `LongTextArea` fields are a compile error (orglet choice following the doc).
- **Protected records/labels:** ignored (single unmanaged org; `protected` has no meaning without packaging).

### Pattern 4: `$UserRole`, `$Setup`, `$Api` as evaluation-time values (FORM-03, FORM-05)
- **Extend `ReferenceKind`** with `"label" | "customMetadata" | "setup" | "api"`; `$UserRole` is `kind: "global"` with `global: "$UserRole"` and `GLOBAL_OBJECTS["$userrole"] = "UserRole"`, plus a `userRole?: RecordData` slot on `EvaluationContext` and a `case "$UserRole"` in `globalRecord()`. `resolvePath` against `UserRole` gives free field validation and typing.
- **Loading cost control:** `loadGlobals` runs once per transaction and per `project()` call. Only do the extra queries when the registry says some compiled formula uses the global (dependency list D-14: `registry.usesGlobal("$UserRole")`, `registry.settingsUsed()`); a schema without such formulas must pay zero extra queries.
- **`$UserRole`:** `user["UserRoleId"]` -> `loadByIds(client, UserRole, [id])`; null when no id. Every field blank (documented: "If a field in the database has no value, the corresponding global variable returns a blank value", Visualforce Developer Guide `$UserRole`).
- **`$Setup`:** compile: object must exist and have `customSetting`; `"List"` -> `FormulaCompileError("UNSUPPORTED:formula-global $Setup.X__c is a List custom setting; Salesforce exposes only Hierarchy custom settings to formulas ...")`; unknown setting/field -> generic wording; field must exist on the setting. Evaluation: load rows with `findByField(SetupOwnerId = userId | profileId | organizationId)` for each referenced setting (3 small queries or one `= ANY`), and **merge per field**: first non-null among user, profile, organization. Precompute one merged `RecordData` per setting in `loadGlobals` (stored in `Globals.setup[settingLower]`) and let `valueFor` read `merged[field]`.
- **`$Api`:** compile: names matched case-insensitively against `partner_server_url_<digits>`, `enterprise_server_url_<digits>`, `session_id`; anything else under `$Api` -> generic unknown-field wording. Reference kind `api` with `apiKind: "partner" | "enterprise" | "session"` and `apiVersion` parsed at compile. Evaluation: see Pattern 5.

### Pattern 5: Request-context transport for `$Api` (Q8)
Survey result. Everything that evaluates formulas goes through `DmlEngine.loadGlobals(client, session)` (`engine.ts:362`): `run()` for insert/update/upsert/delete/undelete, and `project()` for `retrieve`, SOQL formula fields (`query.ts:computeFormulaFields`) and the by-external-id GET (`sobjects.ts:152`). Callers: every route handler obtains its Session through the single helper `session(req)` in `packages/api/src/server.ts:68` (sobjects, query, composite, bulk handlers). `Globals` is spread into `EvaluationContext` at the three evaluation sites (`project` -> `applyFormulaFields(..., globals)`, `runValidationRules` `{...globals}`, `defaults` `{...globals}`) and reused by rollup recompute.

| Option | Change surface | Blast radius | Verdict |
|--------|----------------|--------------|---------|
| A. `Session.request?: { baseUrl; sessionId }`, filled in `session(req)` | `hooks.ts` type, `server.ts:session()`, `loadGlobals`/`Globals`, `evaluate.ts` | One helper in API; engine signatures unchanged; bootstrap/login/tests build Sessions without it (optional, so `exactOptionalPropertyTypes` fine). Hooks see it in `TriggerContext.session` (harmless). | **Recommended** |
| B. `DmlOptions.request` / extra param on `retrieve`/`project`/`runQuery` | 6+ engine methods, ~20 call sites in sobjects/composite/bulk/query | Large, easy to miss a path (composite sub-requests, SOQL formula fields) | Reject |
| C. `AsyncLocalStorage` set in an `onRequest` hook | one hook plus one reader | Smallest diff but implicit, invisible to tests, and bulk async jobs run outside the request scope with surprising results | Reject |

Option A details: `session(req)` returns `{ ...req.login.session, request: { baseUrl: baseUrl(req), sessionId: req.login.token } }`. **Bulk:** `createIngestJob`/`createQueryJob` persist only `userId/organizationId/profileId` and `store.ts` rebuilds Session from those columns (`bulk/store.ts:98,122,154`), so asynchronous bulk processing has no `request`; that gives D-09 behaviour (blank + warning) consistently. The `session: session(req)` passed at job creation (`routes/bulk.ts:257,355`) briefly holds the token in memory only; to keep it from ever being stored, strip `request` there or leave as is because the store ignores it. The token must not be logged and must not be written to Postgres. `organizationId` for the URL comes from `session.organizationId` (same value `login.ts` puts in `serverUrl`).
Runtime warning sink (D-09): the registry holds a `Set<string>` of formula identities already warned; on first evaluation of a `$Api` formula without `request` it `pushDiagnostic`s one `formula-global` diagnostic (e.g. `... evaluated without a request context; $Api values are blank`) onto the same `warnings`/`diagnostics` arrays (1:1 invariant). `DmlEngine.warnings` already returns the live array, so a caller reading it after the fact sees it; `check` never evaluates so it never sees runtime warnings. Evaluate-time access to the sink: `evaluateCompiled` stays pure and returns blank; the engine call sites (3) check `compiled.dependencies.globals.includes("$Api") && !globals.api` and notify the registry. Keep it in `FormulaRegistry` methods so the three sites share one helper.

### Pattern 6: Dependency list (D-14, D-15)
`resolvePath` should return the walked chain (`{ object, field }[]`) so `compileFormula` can build `dependencies.fields: { object: string; fields: string[] }[]` (own fields plus each parent hop, e.g. `Contact: [AccountId, Account]`? use relationship field names consistently: record both the lookup field and the leaf), `dependencies.globals: ("$User"|...)[]` (sorted unique), `dependencies.volatile: boolean`, and `dependencies.settings: string[]` / `customMetadata: {type, record}[]`/`labels: string[]` if useful. Volatility: AST walk for `FunctionCall` with callee in `NOW | TODAY | TIMENOW`, or any global root other than `$System`/`$Label`/`$CustomMetadata` (those are compile-time constants), or `usesRecordState`. `FormulaRegistry` exposes `dependencies(obj, fieldOrRule)` and the aggregate used-globals/settings sets that drive Pattern 4's load gating. No reverse index here (Phase 13).

### Anti-Patterns to Avoid
- **Hand-editing `packages/sigha/src`** or leaving the `compile.ts` regex fallback in place (D-05 removes it; `unexpected-character` must become a normal `Syntax error in formula`).
- **Formatting `n` directly as `<n>.0`** for `$Api` (see Q1: would produce `/u/600.0/`).
- **Attaching a typed parent under the plain `Owner` key** (collides with SOQL/REST shapes and with polymorphic handling).
- **Querying `UserRole`/`$Setup` on every transaction** whether or not any formula uses them.
- **Serialising `Session.request` anywhere** (bulk store, logs, events).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Unary `!` / colon lexing | A text pre-processor in orglet | Fork merge via vendored sigha | Phase 4 D-09 forbids local pre-processing; both are already implemented and tested in the fork |
| Key-prefix target matching | New ID parsing | `matchLookupTarget` / `matchTargetByPrefix` in `@orglet/schema` | Handles null-prefix single targets and polymorphic Ids |
| Warning/diagnostic strings | Hand-written `"UNSUPPORTED:..."` strings | `pushDiagnostic` / `formatDiagnostic` | 1:1 invariant is asserted by `formulas.test.ts` |
| CMT value coercion | Re-parsing `values: {field,value}[]` strings | `planCustomMetadataSeed` rows (already coerced per declared type) | Same typing as the seeded `__mdt` tables |
| Corpus tally | Own conformance runner | `runRow` from `packages/sigha/src/engine/conformance.ts` | Raw `runRow` pass count over `salesforce-v2.json` equals the locked 6312 (measured), no exclusion lists needed |
| Base URL / token | New config var or token generator | `baseUrl(req)` and `req.login.token` | D-06, D-07 |

**Key insight:** orglet never touches the sigha evaluator; every new feature is "resolve at compile into a keyed reference, fill the `fields` map at evaluation". Keep that shape for labels, CMT, settings, `$Api` and `$UserRole`.

## Runtime State Inventory

Not a rename/refactor phase in the data sense, but the resync does change vendored code. Explicit answers:

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | None. Formulas are compiled at startup from metadata; no formula text or compiled AST is stored in Postgres. | none (verified: `FormulaRegistry` constructor compiles eagerly, no persistence) |
| Live service config | None. | none |
| OS-registered state | None. | none |
| Secrets/env vars | New optional `SIGHA_REPO` env var for the sync script/CI only (not a secret). `$Api.Session_ID` surfaces the bearer token inside formula results (decision D-07, accepted); tokens are in-memory only (`SessionStore`). | document `SIGHA_REPO` in script header; do not log formula results containing tokens |
| Build artifacts | `packages/sigha/dist/` (tsc -b output) is stale after the resync; `pnpm build` regenerates. Tests alias `@orglet/*` to `src`, so unaffected. `scripts/sync-sigha.sh` leaves no `.bak` files (verified `find ... -name '*.bak' -delete`). | run `pnpm build` once in the verification step |

## Common Pitfalls

### Pitfall 1: CI cannot fetch a fork-only commit
**What goes wrong:** `sigha-sync-check` clones `rfaulhaber/sigha`; the merge SHA exists only in `snorf/sigha`, so `git checkout <sha>` fails.
**Why:** URL hard-coded in the script.
**How to avoid:** `SIGHA_REPO` override plus `Repository:` line (Pattern 1); human checkpoint for Johan to push the integration branch; never delete/force-push it.
**Warning signs:** CI job fails with `fatal: reference is not a tree`.

### Pitfall 2: Treating `n` in `$Api.*_URL_<n>` as the major version
**What goes wrong:** `Partner_Server_URL_600` rendered as `.../u/600.0/...`.
**How to avoid:** version string = `(n / 10).toFixed(1)` (documented examples: `_250` is 25.0, `_260` is 26.0; a real-world formula uses `_600` for 60.0). Reject `n` of 0 or non-digits at compile with the generic wording.

### Pitfall 3: Merge-commit SHA drift
**What goes wrong:** Re-running the merge produces a different SHA, so the SHA recorded in VENDOR.md, the one pushed by Johan and the one CI checks out differ.
**How to avoid:** create the merge once, record the SHA from `git rev-parse HEAD` of the pushed branch, and make the executor stop with a checkpoint showing the exact `git push` command for Johan (not run by Claude).

### Pitfall 4: Corpus baseline test deep-importing across packages
**What goes wrong:** An orglet test outside `packages/sigha` importing `.../sigha/src/engine/conformance.ts` violates the no-reach-in convention; the barrel does not export `runRow`.
**How to avoid:** put the guard inside the sigha package at `packages/sigha/test/corpus-baseline.test.ts` (matches vitest include `packages/*/test/**/*.test.ts` and `tsconfig.test.json`; the sync script never writes `packages/sigha/test`). It imports `../src/engine/conformance.js` and reads `../corpus/salesforce-v2.json`; asserts `pass >= 6312` and `rows.length >= 9730`. If that guard is linted, note `packages/sigha/tsconfig.json` includes only `src`, but ESLint's type-aware project list includes `tsconfig.test.json`, which covers `packages/*/test/**/*.ts`.

### Pitfall 5: Typed parent keys leaking into REST responses
**What goes wrong:** `loadParents` attaches parents on the row object; `retrieve` returns the same rows and `recordJson` emits every key (`routes/sobjects.ts:30`), so an `Owner:User` nested object could appear in `GET /sobjects/Case/{id}` just as other loaded parents (e.g. `Account`) already may.
**How to avoid:** add a test asserting the REST body of a record whose formula uses `Owner:User.Email` has no `Owner:User` key; if existing behaviour already leaks plain parents, decide in the plan whether to strip loaded parents after evaluation (small change in `project`) rather than ship a visibly odd key. This is unverified in the live code path; confirm with a test first.

### Pitfall 6: Registry constructor consumers
**What goes wrong:** `FormulaRegistry` and `DmlEngine` are constructed in ~12 test files with `(schema)` / `(pool, schema, {orgSchema})`. A required new argument breaks them all.
**How to avoid:** make the custom-metadata input optional on both (`EngineOptions.customMetadata?`).

### Pitfall 7: `$Api`, `$CustomMetadata` context availability
**What goes wrong:** sigha's registry marks `$Api` as available only in formula fields, flows and buttons, and the vendored comments say it is rejected in validation rules and default values; `analyze()` does **not** flag it (verified: no diagnostics for `$Api.Session_ID` in `validation_rule`/`default_value`).
**How to avoid:** do not add context gating (D-09 explicitly wants validation rules and defaults to compile and evaluate blank with a warning). Record as an orglet choice: more permissive than the org for `$Api` in rules/defaults.

### Pitfall 8: Nested `UNSUPPORTED` area in warnings
**What goes wrong:** `FormulaCompileError` messages starting with `UNSUPPORTED:formula-global ...` are wrapped by `tryCompile` into `area: "formula"`, giving `UNSUPPORTED:formula validation rule X skipped: UNSUPPORTED:formula-global ...`. This is existing behaviour (and `orglet check --strict` already counts it). New messages (`$Setup` list setting, `$Permission`) follow the same shape; do not try to change the area in this phase unless Phase 14 requires it.
**Warning signs:** a test that compares the whole warning string must keep the nested form.

### Pitfall 9: `!` precedence is "same level as unary minus"
`!a = b` parses as `(!a) = b`, then the checker demands a Boolean operand, so it is a type error rather than `NOT(a = b)`. This matches the grammar (below) and is not an orglet bug; tests should include `!(a = b)` and `!ISBLANK(x) && y`.

## Code Examples

### Sync script override (sketch)
```bash
# scripts/sync-sigha.sh (changed lines only)
SIGHA_REPO=${SIGHA_REPO:-https://github.com/rfaulhaber/sigha.git}
...
  git clone -q "$SIGHA_REPO" "$CLONE"
...
# VENDOR.md heredoc gains:  Repository: $SIGHA_REPO   (local-dir mode: keep previous Repository line from the old VENDOR.md)
```
Local-dir mode has no URL; carry the existing `Repository:` line over exactly like the pending section is carried (the script already reads the old `VENDOR.md`).

### CI step (sketch)
```bash
REV=$(sed -n 's/^Revision: //p' packages/sigha/VENDOR.md)
REPO=$(sed -n 's/^Repository: //p' packages/sigha/VENDOR.md)
SIGHA_REPO="${REPO:-https://github.com/rfaulhaber/sigha.git}" SIGHA_DEST="$RUNNER_TEMP/sigha" bash scripts/sync-sigha.sh "$REV"
```

### Corpus guard (sketch)
```ts
// packages/sigha/test/corpus-baseline.test.ts
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CorpusRow } from "../src/engine/corpus.js";
import { runRow } from "../src/engine/conformance.js";

const rows: CorpusRow[] = JSON.parse(readFileSync(new URL("../corpus/salesforce-v2.json", import.meta.url), "utf8"));

describe("vendored salesforce-v2 corpus", () => {
  it("passes at least the v1.0 baseline of 6312 rows, so a resync cannot silently lose cases", () => {
    const pass = rows.filter((r) => runRow(r).status === "pass").length;
    expect(rows.length).toBeGreaterThanOrEqual(9730);
    expect(pass).toBeGreaterThanOrEqual(6312);
  });
});
```
Measured with this exact logic: `salesforce-v2.json` raw `runRow` status counts `pass 6312, quarantine 1389, unsupported 1982, fail 47` (the vendored test additionally excludes 42 org-overruled and 5 expectation-quarantine rows, which are exactly the 47 raw fails, giving its `pass 6312 / fail 0 / quarantine 1394 / org-overruled 42`).

### Typed segment in `resolvePath` (sketch)
```ts
const [rel, typed] = segment.split(":", 2);          // "Owner:Queue" -> ["Owner", "Queue"]
const resolved = schema.resolveRelationship(current.name, rel ?? segment);
if (typed !== undefined) {
  const wanted = typed.toLowerCase() === "queue" ? "group" : typed.toLowerCase();
  const target = (resolved.field.referenceTo ?? []).find((t) => t.toLowerCase() === wanted);
  if (!target) throw fieldNotFound(path.join("."), { object: current.name, field: segment });
  canonical.push(`${resolved.field.relationshipName ?? rel}:${target}`);
  current = schema.getObject(target) ?? fail();
  continue;
}
```

### `$Api` value at evaluation (sketch)
```ts
case "api": {
  const r = ctx.api;                       // { baseUrl, sessionId, organizationId } | undefined
  if (!r) return blank("Text");
  if (ref.apiKind === "session") return text(r.sessionId);
  const letter = ref.apiKind === "partner" ? "u" : "c";
  return text(`${r.baseUrl}/services/Soap/${letter}/${ref.apiVersion}/${r.organizationId}`); // apiVersion "60.0" from _600
}
```

### Verified `!` grammar (BSD-3 `salesforce/formula-engine`, `Formula.g4`)
```
unaryExpression
    : primaryExpression       #unaryExpression_primary
    | PLUS unaryExpression    #unaryExpression_plus
    | MINUS unaryExpression   #unaryExpression_minus
    | NOT unaryExpression     #unaryExpression_not
    | BANG unaryExpression    #unaryExpression_bang
```
`LexerRules.g4`: `COLON : ':'`, `BANG : '!'`. `FormulaUtils.DOMAIN_DELIMETER = ":"` and `getNameAndDomainFromFieldName` splits `Owner:User` into `{"Owner","User"}`.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `Owner:User.x` reported `UNSUPPORTED:formula` via regex fallback | Real parse of the typed segment | This phase | Remove regex fallback; tests in `formula.test.ts` ~L45-61 and `query.test.ts` ~L182 change |
| `$Setup` / `$Label` / `$CustomMetadata` / `$UserRole` / `$Api` all `UNSUPPORTED:formula-global` | Resolved or specific errors | This phase | `$Setup` on List setting and `$Permission` remain unsupported with reasons |
| Cross-object owner formulas | Introduced Summer '13 with `Owner:User` / `Owner:Queue` | 2013 | Documented in Salesforce developer blog and Help "Tips for Building Cross-Object Formulas" |

## Specific Questions: Answers with Evidence

### Q1. `$Api` shapes (D-06..D-08)
- Names (HIGH, Visualforce Developer Guide "Global Variables: $Api", https://developer.salesforce.com/docs/atlas.en-us.pages.meta/pages/pages_variables_global_api.htm): `$Api.Partner_Server_URL_xxx` "the Partner WSDL SOAP endpoint where xxx represents the version of the API. For example, `{!$Api.Partner_Server_URL_250}` is the expression for the endpoint for version 25.0"; `$Api.Enterprise_Server_URL_xxx` likewise (`..._260` is 26.0); `$Api.Session_ID` "the session ID". **`xxx` is the version times ten**, confirmed by a real-world formula using `$Api.Partner_Server_URL_600` to derive the org base URL (https://www.linkedin.com/pulse/how-make-dynamic-site-urls-dont-break-between-samuel-assaf). **This overrides D-08's `<n>.0` reading.** Recommended rule: any `\d+`, version = `n / 10` with one decimal (`590` -> `59.0`, `255` -> `25.5`); this is an orglet choice for unusual values since only whole versions exist.
- Path shape (MEDIUM): the documentation page gives no rendered value. The SOAP login response `serverUrl` and the Identity URL docs use `https://<host>/services/Soap/u/<version>/<OrganizationId>` (partner) and `/services/Soap/c/<version>/<OrganizationId>` (enterprise); web sources show the formula renders that same shape with the org Id as final path segment (Salesforce Help article 000385590 and a community write-up via search). orglet's own login (`packages/api/src/routes/login.ts:38,105-107`) already emits exactly `${base}/services/Soap/u/<version>/${organizationId}`; using the same pattern keeps the formula value consistent with what clients see. Org Id length (15 vs 18) follows `session.organizationId` as in login: **orglet choice**.
- `$Api.Session_ID`: documented as the session ID ("returns an identifier for the current session in the current context"); D-07 (bearer token) is an orglet choice consistent with that.
- Registry note: sigha's context table puts `$Api` in formula fields, flow formulas and buttons only (corroboration only); orglet will not enforce this (Pitfall 7).

### Q2. `$Setup` hierarchy semantics (D-16)
- Documented (HIGH-MEDIUM): Apex Developer Guide "Custom Settings Methods": `getInstance()` "returns a custom setting data set record for the current user. The fields returned in the custom setting record are merged based on the lowest level fields that are defined in the hierarchy"; hierarchy logic "checks the organization, profile, and user settings for the current user and returns the most specific, or lowest, value"; `getValues` does not merge and returns null for unset fields. That is per-field fall-through user -> profile -> org (https://developer.salesforce.com/docs/atlas.en-us.apexref.meta/apexref/apex_methods_system_custom_settings.htm). Documentation for `$Setup` in formulas states usage `{!$Setup.CustomSettingName__c.CustomFieldName__c}` and that hierarchy settings resolve in that hierarchy; the formula-specific merge detail is not separately documented, so applying the Apex semantics to `$Setup` is an inference (MEDIUM).
- No level has a value: no documented read-time fallback to the field's default value. In Salesforce a custom setting field default is applied when a record is created, not when a missing value is read; orglet already applies field defaults at insert (`engine.ts defaults()`). **Orglet choice (LOW-MEDIUM): blank, `defaultValue` not consulted at read.** Checkbox: an unset checkbox column reads as stored (false or null); do not special-case.
- List settings (HIGH-MEDIUM): "List custom settings ... are accessible only through code"; hierarchy settings are "accessible through code, formula, validation rules, Apex, and the Web Services API" (Apex Developer Guide "Custom Settings"; Help "Define Custom Settings" `cs_define.htm`). Use as the reason text: `$Setup is available only for Hierarchy custom settings; List custom settings are accessible only from code`.

### Q3. `$Label` and `$CustomMetadata` (D-17)
- `$Label` doc (HIGH, Visualforce guide): `{!$Label.firstrun_helptext}`; value depends on the user's language: local translation, then packaged translation, then master label. orglet has no translations (v2, CSET-03), so it returns the master value from `OrgSchema.labels` (`CustomLabelDef.value`). Casing: Salesforce identifiers are case-insensitive; `getLabel` lower-cases the key. Namespaced form: not documented for formulas; unsupported (orglet choice).
- `$CustomMetadata` (MEDIUM, Help "Custom Metadata Types and Advanced Formula Fields" and "Custom Metadata Types Limitations", via search excerpts): syntax `$CustomMetadata.CustomMetadataTypeAPIName.RecordAPIName.FieldAPIName` with `__mdt` suffix on the type and `__c` on fields; usable in validation rules, default values, formula fields and Process Builder formulas; relationships spanning from a CMT are not supported in formula fields; long text area fields are not supported. Record key = record API name (DeveloperName); case rules undocumented: case-insensitive is an orglet choice matching `seed.ts`.
- Compile errors: no public text found for unknown label/type/field. Use the existing generic `Field <path> does not exist. Check spelling.` (orglet choice).

### Q4. `$UserRole`, `$Permission` (D-18, FORM-05)
- `$UserRole` (HIGH-MEDIUM, Visualforce guide `pages_variables_global_userrole`): references information about the current user's role (name, description, Id); "If a field in the database has no value, the corresponding global variable returns a blank value." The guide notes CaseAccessForAccountOwner, ContactAccessForAccountOwner, OpportunityAccessForAccountOwner and PortalType cannot be used **in Visualforce**; that restriction is not stated for formulas, so expose all baseline `UserRole` fields (`UserRole.json` has 14 fields; the object is always in the schema with key prefix `00E`; `User.UserRoleId` references it).
- `$Permission` (MEDIUM): returns true/false for whether the current user has access to a specific custom permission. orglet has no custom permission or permission set model, hence the reason string: `$Permission.<name> needs custom permissions and permission sets, which orglet does not model`.

### Q5. Colon syntax (D-10, D-12, D-13)
- Documented (MEDIUM, Salesforce developer blog "Cross-Object Owner Fields: A Powerful New Formula Option", 2013, and Help "Tips for Building Cross-Object Formulas", `fields_creating_cross_object_notes.htm`, via search excerpts; direct fetch of both is blocked with HTTP 403): on objects whose Owner can be a User or a Queue, formulas must name the type: `Owner:User.Email`, `Owner:Queue.QueueEmail`; example `IF(ISBLANK(Owner:User.Id), Owner:Queue.QueueEmail, Owner:User.Email)`; owner references count against the 10 unique relationships limit; owner references are not supported in Visualforce.
- **Queue field names differ from `Group`.** The documented examples use `Owner:Queue.QueueEmail` and `Owner:Queue.QueueName` (and `Owner:Queue.Id`), not `Group.Email`/`Group.Name`. D-10 resolves `Owner:Queue` against the `Group` object (so `Owner:Queue.Name` and `Owner:Queue.Email` work, matching the success criterion text). Recommendation, flagged as an open question for the planner: additionally accept `QueueName` -> `Name` and `QueueEmail` -> `Email` as field aliases when the qualifier is `Queue` or `Group`, so formulas copied from documentation compile (cheap: an alias map in `resolvePath`'s leaf lookup for a Group-typed hop). Canonical key must remain the `Group` field name so the evaluator finds the loaded value.
- Non-polymorphic lookups (D-12): no public documentation found that rejects or confirms `Owner:User.X` on objects where Owner is User only; the docs describe the colon syntax as the form for polymorphic owners and show plain `Owner.X` for User-only objects. D-12 stands: **accept (orglet choice, LOW)**.
- Invalid qualifier wording (D-13): no Salesforce text found. **Orglet choice:** `Field Owner:Contact.Name does not exist. Check spelling.` (generic wording with the typed segment), with `missing: { object, field: "Owner:Contact" }`.

### Q6. Unary `!`
Documented by the public grammar (BSD-3): `!` is a prefix operator at the same grammar level as unary `+`, `-` and `NOT`; the visitor rewrites it to NOT. `!=` is a separate token (`NOT_EQUAL`), unaffected (fork lexer keeps `!=`). Blank propagation: fork evaluator returns `blank("Boolean")` for a blank operand and delegates to `BUILTINS.NOT` otherwise, identical to `NOT()` as implemented in sigha. The checker requires a Boolean operand. Strings: lexer lexes string literals first, so `!`/`:` inside quotes are text (also asserted in the existing `expectations.test.ts` guards and fork lexer tests). No corpus row contains a lone `!` (measured with a regex over both corpus files), so corpus counts cannot change from the `!` branch.

### Q7. The two fork branches
- `feat/unary-bang` (`6b02be3`, 12 files, +108/-14): lexer `case "!"` emits an `operator` token when not followed by `=` (removes `unexpectedBang` message); `UnaryOperator` becomes `"-" | "+" | "!"`; `parseUnary` accepts `!` under the same depth guard as sign; evaluator `UnaryOp` with `!` returns `blank("Boolean")` for blank operand else `normalizeEmptyText(BUILTINS.NOT([operand], env))`; checker `expectBoolean` and type `Boolean`; `features/field-extraction.ts` infers Boolean for the operand (not vendored); tests: lexer, evaluator (incl. precedence vs `&&`/`||`, `!x` equals `NOT(x)` for blank in both blank modes), checker, field-extraction, formatter.
- `feat/polymorphic-colon-ref` (`8f93df6`, 3 files, +73): in `scanIdentifier`, after the identifier, if next char is `:` and the following char is an identifier start, absorb `:` plus the following identifier characters into the same token. No parser or AST change. Tests: lexer (one identifier `Owner:User`, a dot, `Email`; strings unaffected; colon not followed by identifier start keeps its diagnostic) and parser (`path: ["Owner:User","Email"]`, inside `ISBLANK(...)`). Absorption is only for one `:Type` (a second colon is not absorbed).
- Both touch `lexer.ts` in different regions; merge is automatic. Fork test result after merge in the scratch clone: `src/syntax src/engine src/analysis`: 9 files, 236 tests passed; conformance tests: `pass 6312 / fail 0` and org tier `pass 664/664`.
- Integration branch recipe (for the plan): in the persistent clone, `git switch -c integration/phase-12 origin/feat/unary-bang && git merge --no-edit origin/feat/polymorphic-colon-ref`, run the fork's `pnpm test` (vitest 4.1.10) and `pnpm typecheck`, record `git rev-parse HEAD`. Johan pushes the branch and (separately) opens the two PRs; Claude does neither.

### Q8. See Pattern 5 (options and blast radius).

## Open Questions

1. **D-08 `<n>.0` vs documented version-times-ten.** What we know: docs and a real formula (`_600`) show the suffix is version x 10. Recommendation: implement `n/10` with one decimal; update D-08's wording in the plan SUMMARY (the decision text itself defers to the documentation).
2. **Queue field aliases `QueueName` / `QueueEmail`.** What we know: documented examples use them; D-10 maps the object to `Group`. Recommendation: add the two aliases (tiny, additive, documented). Needs Johan's nod only if he wants D-10 kept literally.
3. **Wording of compile errors for unknown label/type/field and invalid qualifier.** No public Salesforce text found. Recommendation: generic `Field <ref> does not exist. Check spelling.`; recorded as orglet choices (LOW).
4. **Runtime `$Api` warning surfacing.** Runtime diagnostics pushed after startup are only visible via `engine.warnings`/`diagnostics`; nothing prints them. Recommendation: accept for this phase (D-09 only requires emission), and have the API layer log nothing extra; Phase 14's report can read them.
5. **Typed-parent key leakage in REST output (Pitfall 5).** Unverified in the live path; first task of that plan should be a failing test.
6. **Who pushes the integration branch and when.** Needs a checkpoint with Johan before the phase PR's CI can pass (Pitfall 1/3).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node 22 | tests, tsx | yes (nvm) | v22.23.3 (`export PATH="$HOME/.nvm/versions/node/v22.23.3/bin:$PATH"`; default shell node is older) | none needed |
| pnpm | repo and fork | yes via corepack | 12.6.0 | none |
| git | integration branch | yes | system git | none |
| gh | read-only inspection of forks | yes | authenticated | not used to push or open PRs |
| Docker | Postgres 16 tests / conformance | yes (binary present, daemon state not probed) | n/a | pglite default: tests run without Docker when `ORGLET_DATABASE_URL` is unset (it is unset) |
| Network to github.com | fork clone, CI | yes | n/a | local-dir mode of the sync script |
| developer.salesforce.com, help.salesforce.com | docs | blocked for direct fetch (403) | n/a | search-result excerpts of official pages used; flagged MEDIUM |

**Missing dependencies with no fallback:** none.
**Blocked on a human:** pushing the integration branch to `snorf/sigha` (Johan).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.7, single root config `vitest.config.ts`, `@orglet/*` aliased to `src` |
| Config file | `/Users/johankarlsteen/Development.nosync/local-salesforce/vitest.config.ts` (includes `packages/*/src/**/*.test.ts` and `packages/*/test/**/*.test.ts`) |
| DB | Per-test-file pglite behind pglite-socket via `test/db.ts`; real Postgres when `ORGLET_DATABASE_URL` is set (CI `test-postgres` job) |
| Quick run | `pnpm vitest run packages/formula packages/sigha` |
| Engine/API run | `pnpm vitest run packages/engine packages/api` |
| Full suite | `pnpm test` (plus `pnpm lint`, `pnpm build`) |

### Measured baseline (current pin `2abe5dbb`, run 2026-10-23, `pnpm vitest run packages/sigha`: 2 files, 5 tests passed)
| Corpus | Tally line |
|--------|-----------|
| `corpus/salesforce-v2.json` | `Conformance: 100.0% (6312/6312 comparable)` ; `pass 6312 · fail 0 · quarantine 1394 · unsupported 1982 · org-overruled 42 · total 9730` |
| `corpus/org-verified.json` (not locked, D-04) | `Org conformance: 100.0% (664/664 comparable)` ; `pass 664 · fail 0 · quarantine 0 · unsupported 6 · total 670` |
| Raw `runRow` (what the new guard counts) | salesforce-v2: pass 6312, quarantine 1389, unsupported 1982, fail 47 (the 47 = 42 org-overruled + 5 expectation-quarantine rows the vendored test excludes); org-verified: pass 664, unsupported 6 |
| After rehearsed resync (fork clone, merge `f06f3c7`) | identical: `6312/6312`, `664/664`; corpus files byte-identical to the pin |

"Pass" composition: rows where `runRow(row).status === "pass"`; quarantine, unsupported and org-overruled rows count in neither pass nor fail of the vendored percentage.

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FORM-01 | Corpus pass >= 6312, pin recorded, script runs on macOS/Linux | unit + CI | `pnpm vitest run packages/sigha`; CI job `sigha-sync-check`; local `SIGHA_DEST=$(mktemp -d) bash scripts/sync-sigha.sh <clone-dir>` | guard file Wave 0 |
| FORM-01 | `!ISBLANK(x)` is NOT; `!`/`:` in strings unaffected | unit | `pnpm vitest run packages/formula/src/expectations.test.ts` (flip `it.fails` to `it`, keep string guards) | exists |
| FORM-02 | `Owner:User.Email`, `Owner:Queue.Name`/`Owner:Group.Name` evaluate; blank on other type; invalid qualifier error; `Owner:User.Manager.Email` depth | unit (compile/eval) + integration (engine with Case owned by User and Group) | `pnpm vitest run packages/formula packages/engine/src/query.test.ts packages/engine/src/engine.test.ts` | extend `formula.test.ts`, `expectations.test.ts`; new engine test file Wave 0 |
| FORM-03 | `$UserRole` blank without role; `$Api` URL/session values and blank + one warning without request | unit + engine + API integration | `pnpm vitest run packages/formula packages/engine packages/api/src/api.test.ts` | new `packages/api/src/formula-globals.test.ts` Wave 0 |
| FORM-04 | `$Label`, `$CustomMetadata` resolve; unknown label/type/field compile error; unknown record blank + single aggregated warning | unit + engine | `pnpm vitest run packages/formula packages/engine/src/formulas.test.ts` (fixture `conformance/cmdt-check/project`) | extend `formulas.test.ts`; new `packages/formula/src/globals.test.ts` Wave 0 |
| FORM-05 | `$Setup` user -> profile -> org per field; List setting and `$Permission` still `UNSUPPORTED:formula-global` with reason | engine integration + unit | `pnpm vitest run packages/engine` | new test (App_Config__c hierarchy, Region_List__c list in cmdt-check project) Wave 0 |
| D-14/D-15 | Dependency list shape; `warnings == diagnostics.map(formatDiagnostic)` for every new warning | unit | `pnpm vitest run packages/engine/src/formulas.test.ts` | extend |

### Sampling Rate
- **Per task commit:** `pnpm vitest run packages/formula packages/sigha` (about 1-3 s each locally) plus the touched package.
- **Per wave merge:** `pnpm test && pnpm lint && pnpm build` (build needed because tsc -b checks `packages/sigha` composite and strict flags on the resynced files).
- **Phase gate:** full suite green on pglite and (CI) Postgres; `sigha-sync-check` green; `bash conformance/run-all.sh` (needs Docker Postgres, a fresh `ORG_SCHEMA`, built CLI) run once at the end.

### Conformance (`conformance/run-all.sh`) implications
- jsforce/simple-salesforce/poly-check/describe-check/rollup-check/cmdt-check legs hit REST; none depend on colon syntax today. Risk: any REST response change (Pitfall 5 key leakage) or a new always-on query in `loadGlobals` could alter counts. Phase gate should run the script once; add a cmdt-check or poly-check leg assertion only if cheap (optional: one `$Label`/`Owner:User` formula on `conformance/cmdt-check/project`'s `Ticket__c` read through REST).
- `orglet check --strict` on `examples/acme` and `conformance/cmdt-check/project` must still exit 0 (no new warnings from unchanged metadata); the registry now receives `customMetadata` in `check`.

### Wave 0 Gaps
- [ ] `packages/sigha/test/corpus-baseline.test.ts` - locks FORM-01 pass count (sync-proof location)
- [ ] `packages/formula/src/globals.test.ts` - compile/evaluate unit tests for `$Label`, `$CustomMetadata`, `$Setup`, `$Api` (name parsing, version x10), `$UserRole`, typed segments
- [ ] Engine test for typed polymorphic loading and `$Setup`/`$UserRole` loading (fixture needs a hierarchy setting, a role and a Case owned by a Group; reuse `conformance/cmdt-check/project` plus `examples/acme`)
- [ ] `packages/api/src/formula-globals.test.ts` - `$Api` end to end through login token and `Host`/`x-forwarded-*` headers, asserting equality with `instance_url` and `access_token`
- [ ] Fork integration branch and recorded SHA (not a test file, but gate for all CI)

## Sources

### Primary (HIGH confidence)
- Local code: `packages/formula/src/{compile,evaluate}.ts`, `packages/engine/src/{engine,formulas,parents,hooks,seed,query}.ts`, `packages/api/src/{server,auth}.ts`, `packages/api/src/routes/*.ts`, `packages/api/src/bulk/store.ts`, `scripts/sync-sigha.sh`, `.github/workflows/ci.yml`, `packages/sigha/**` (read and executed).
- `snorf/sigha` branches `feat/unary-bang` (6b02be3) and `feat/polymorphic-colon-ref` (8f93df6): cloned, diffed, merged, tested.
- `salesforce/formula-engine` (BSD-3) `Formula.g4`, `LexerRules.g4`, `FormulaUtils.java` via `gh api`.
- Salesforce Visualforce Developer Guide, Global Variables: `$Api` (https://developer.salesforce.com/docs/atlas.en-us.pages.meta/pages/pages_variables_global_api.htm), `$Label` (`.../pages_variables_global_label.htm`), `$UserRole` (`.../pages_variables_global_userrole.htm`) - content obtained from search excerpts; direct fetch blocked (403).

### Secondary (MEDIUM confidence)
- Apex Developer Guide, Custom Settings and Custom Settings Methods (https://developer.salesforce.com/docs/atlas.en-us.apexref.meta/apexref/apex_methods_system_custom_settings.htm; https://developer.salesforce.com/docs/atlas.en-us.apexcode.meta/apexcode/apex_customsettings.htm) - hierarchy merge semantics, list settings code-only.
- Salesforce developer blog "Cross-Object Owner Fields: A Powerful New Formula Option" (https://developer.salesforce.com/blogs/2013/06/cross-object-owner-fields-a-powerful-new-formula-option) and Help "Tips for Building Cross-Object Formulas" (https://help.salesforce.com/s/articleView?language=en_US&id=platform.fields_creating_cross_object_notes.htm&type=5) - `Owner:User` / `Owner:Queue.QueueEmail` syntax, 10-relationship limit.
- Salesforce Help "Custom Metadata Types and Advanced Formula Fields" and "Custom Metadata Types Limitations" (https://help.salesforce.com/s/articleView?id=sf.custommetadatatypes_formula_fields.htm&language=en_US&type=5 ; https://help.salesforce.com/s/articleView?id=platform.custommetadatatypes_limitations.htm&language=en_US&type=5).
- Salesforce Help "Global Variables" (https://help.salesforce.com/s/articleView?language=en_US&id=dev_understanding_global_variables.htm&type=5) - `$Permission` true/false, `$Setup` hierarchy.
- https://www.linkedin.com/pulse/how-make-dynamic-site-urls-dont-break-between-samuel-assaf - real formula using `$Api.Partner_Server_URL_600`.

### Tertiary (LOW confidence)
- Orglet choices where no public text exists: unknown label/type/field wording, invalid qualifier wording, `Owner:User` on single-target lookups, `$Setup` no-value behaviour, namespaced `$Label`, record-key case rules.

## Metadata

**Confidence breakdown:**
- Standard stack / resync mechanics: HIGH - executed (merge, sync run, test tallies measured)
- Architecture (change points, transport): HIGH for code facts, MEDIUM for the REST key-leak pitfall (not yet tested)
- Salesforce semantics: MEDIUM - official pages reached only through search excerpts; several items are explicit orglet choices
- Pitfalls: HIGH for CI/fork and `$Api` suffix; MEDIUM elsewhere

**Research date:** 2026-10-23
**Valid until:** 2026-11-22 (fork/pin facts stay valid until upstream `src/` changes; re-check `git diff <pin> upstream/main -- src corpus` before planning if more than a week passes)
