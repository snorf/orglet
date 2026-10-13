# Pitfalls Research

**Domain:** Self-hosted Salesforce platform emulator — roll-up summaries, polymorphic
lookups/TYPEOF, persisted key prefixes, persisted Bulk API 2.0, pglite test infra, GitHub
Actions CI, standard-object baseline expansion, conformance re-run
**Researched:** 2026-09-29
**Confidence:** MEDIUM-HIGH (Salesforce platform behavior and pglite claims verified against
official/primary sources where fetchable; some Salesforce Help pages returned errors under
WebFetch and are backed by secondary sources instead — flagged per pitfall)

This is a hardening milestone, not greenfield work. Every pitfall below is anchored to the
actual code paths in `packages/*` (read from `.planning/codebase/CONCERNS.md` and
`.planning/codebase/ARCHITECTURE.md`, cross-checked directly against source where it mattered)
rather than generic advice — each one names the exact bug class this codebase is positioned to
reintroduce.

## Critical Pitfalls

### Pitfall 1: Roll-up double-counting or stale totals on reparent

**What goes wrong:**
A child record's roll-up summary contribution is counted on both the old and new parent (double
count), or the old parent is never recalculated after the child leaves it (stale total), or the
new parent is never recalculated after the child arrives (missing count).

**Why it happens:**
`packages/metadata/src/types.ts:101` already models `reparentable?: boolean` on `FieldDef`,
mirroring Salesforce's real "Allow reparenting" checkbox on Master-Detail relationships — so
reparenting a roll-up child is an explicitly supported case here, not a theoretical one. The
naive implementation recomputes the roll-up for `next.ParentId` on every child save and forgets
that `old.ParentId` (the previous parent, on update) also needs recomputation. Salesforce
itself only allows roll-up summaries on Master-Detail relationships specifically because
reparenting is otherwise unconstrained on Lookup relationships; if orglet's roll-up
implementation is not restricted to `type === "MasterDetail"` children, this bug class widens
to every lookup-based parent-child pair.

**How to avoid:**
On child update, diff `old` vs `next` for every roll-up-eligible parent field on the object;
if the parent reference changed, recompute the roll-up for **both** the old and new parent,
not just the new one. Restrict roll-up summary fields to `MasterDetail` relationships (matching
real Salesforce), and make `reparentable: false` (the Salesforce default) the enforced
non-reparentable case explicit in tests — a reparent attempt on a non-reparentable
Master-Detail child should fail before recomputation is even a question.

**Warning signs:**
A test that reparents a child between two parents and asserts both parents' totals afterward
is the single highest-value test to write first; if it's missing, assume the bug exists.
Symptom in a running org: `SUM`/`COUNT` roll-ups that only ever grow, never shrink, across a
reparent-heavy workload.

**Phase to address:** Roll-up summary fields phase (own the reparent case explicitly in the
phase's acceptance criteria, not as a follow-up).

---

### Pitfall 2: Roll-up not recalculated on undelete or on a change to the filter field

**What goes wrong:**
(a) A child that was soft-deleted (excluded from the roll-up) is undeleted, but the parent's
roll-up is never recomputed to add it back. (b) A roll-up has a filter (e.g. `SUM(Amount)
WHERE StageName = 'Closed Won'`) and a child's `StageName` changes from outside the filter to
inside it (or vice versa) without changing any field the recompute logic watches — the roll-up
silently goes stale.

**Why it happens:** PROJECT.md's requirement text says roll-ups recompute "on child
insert/update/delete/undelete" — undelete is called out explicitly because Salesforce's own
soft-delete/undelete pipeline (which orglet already implements per
`packages/engine/src/engine.ts` `undeleteBatch()`) is a separate code path from `update()`, and
it's easy to wire recomputation into `saveBatch()`'s update path while forgetting
`undeleteBatch()` entirely. The filter-field case is a distinct failure mode: recompute logic
that triggers "when a roll-up source field changes" must also trigger when a field used only in
the roll-up's **filter clause** changes, even if the aggregated field itself (`Amount`) did not.

**How to avoid:** Recompute the roll-up on every one of the four child mutation paths
(`saveBatch` insert, `saveBatch` update, `deleteBatch`, `undeleteBatch`), not just the ones that
look most "roll-up-shaped." Derive the recompute trigger set from the roll-up's full definition
— aggregated field **and** every field referenced in the filter — not just the aggregated
field, so a filter-only field change still invalidates the cached total.

**Warning signs:** A test matrix with one row per (insert, update-aggregate-field,
update-filter-field-only, delete, undelete) × (in-filter, out-of-filter) is the concrete
acceptance test; if the test suite only covers insert/delete, filter-field and undelete gaps
will ship silently, matching exactly the class of "quiet field loss" this project already
flags via `UNSUPPORTED:*` for other gaps — a stale roll-up gives no warning at all, which is
worse.

**Phase to address:** Roll-up summary fields phase.

---

### Pitfall 3: Roll-up recursion and transaction-scope interaction with per-record savepoints

**What goes wrong:** A roll-up parent is itself a child of another roll-up (multi-level
Master-Detail), so updating a grandchild must cascade a recompute up two levels; a naive
recursive implementation either infinite-loops, recomputes the same ancestor multiple times
per transaction, or — because orglet wraps `saveBatch()` in one Postgres transaction with a
savepoint per record (`packages/engine/src/engine.ts:207`, per `ARCHITECTURE.md`) — a roll-up
update to the parent that fails validation rolls back to its savepoint and silently reverts
just that one record's roll-up write while the rest of the batch (including the child that
triggered it) commits, leaving parent and child inconsistent without either "insert" or
"update" ever reporting an error for the parent.

**Why it happens:** Salesforce's own documented behavior is that native roll-up summaries only
look one level down (see Sources) — multi-level cascading is explicitly a known limitation, not
an edge case anyone forgets to handle; a from-scratch implementation is exactly where a team
either (a) doesn't realize the limitation exists and builds unbounded recursion, hitting stack
depth or an actual infinite loop if two roll-ups reference each other in a cycle, or (b) copies
Salesforce's one-level restriction faithfully but doesn't decide what to do when a grandchild
insert happens inside the *same transaction* as its parent's insert (import mode, `Bulk API`
batch of 200, or a `/composite/tree` request) — savepoint rollback on the parent must not
silently drop the roll-up write without failing the batch's reported result for that record.

**How to avoid:** Bound recompute depth explicitly (one level, matching Salesforce) rather than
walking an arbitrary parent chain; detect and reject roll-up cycles at metadata-load time
(object A's roll-up depends on object B's roll-up which depends on object A) as an
`UNSUPPORTED:rollup-cycle` warning, following the project's existing degrade-not-crash
convention, rather than at runtime. For transaction scope: recompute the roll-up **inside** the
same savepoint as the triggering child write so that a rollback of the child's savepoint also
correctly reverts the roll-up recompute for that one record — verified by a test that inserts a
batch with `allOrNone: false` where one child fails validation and asserts the parent's roll-up
reflects only the children that actually committed.

**Warning signs:** Any roll-up recompute function that calls itself or walks
`childRelationships` without a depth counter; any roll-up recompute that runs outside the
triggering record's savepoint (i.e., as a separate top-level query after the transaction
commits) will show phantom totals under partial-success batches.

**Phase to address:** Roll-up summary fields phase — the transaction-scope test above should be
a named acceptance criterion, not implicit.

---

### Pitfall 4: Roll-up fields accepted as writable via the API instead of rejected like Salesforce

**What goes wrong:** A client `POST`s or `PATCH`es a record with a value for a roll-up summary
field and orglet either stores the client-supplied value (silently wrong until the next
recompute) or throws an unhelpful error, instead of matching Salesforce's documented behavior:
roll-up summary fields describe as `createable: false` and `updateable: false`, so real
Salesforce clients (jsforce, simple-salesforce) either never send the field or expect the
server to ignore/reject it the same way it does for any other non-createable system field.

**Why it happens:** The engine's existing `coerce.ts`/`checkRequired`/system-field-default
logic (per `ARCHITECTURE.md`'s save pipeline) was built before roll-up fields existed as a
concept; it's easy to add the `Summary` field type to the schema/DDL layer and forget to also
add it to whatever list currently drives "not createable" behavior for fields like `Id` or
`SystemModstamp`.

**How to avoid:** Treat `Summary`-type fields exactly like the existing read-only system
fields in the save pipeline — reuse the same `notWritable` error path
(`packages/engine/src/errors.ts:44-49`, already used for other non-updatable fields) rather
than inventing new logic, and strip/ignore client-supplied roll-up values before validation the
same way Salesforce silently ignores them on insert (Salesforce does not error on a supplied
roll-up value on `insert`/`update` calls that omit it from the field list; it only matters if
the field is explicitly included with a value — confirm exact behavior against describe
`updateable`/`createable` flags in a conformance check, since Salesforce's tolerance here is a
detail worth pinning down with a real describe call rather than assuming).

**Warning signs:** `describe` output for a roll-up field that reports `createable: true` or
`updateable: true` is a direct regression signal; a test that attempts to set a roll-up field
via `insert()`/`update()` and asserts the value is ignored (not stored, not erroring the whole
record) belongs in the engine's existing coercion test suite.

**Phase to address:** Roll-up summary fields phase.

---

### Pitfall 5: Fixing the SOQL join for polymorphic lookups but not the read-side `attributes.type` or formula parent path

**What goes wrong:** `OwnerId.referenceTo = ["User", "Group"]` is already correctly modelled
(`packages/metadata/src/build.ts:113`, and `Group` is one of the 21 baseline objects with
`keyPrefix: "00G"`), so this bug is concretely reproducible today: `resolveRelationship`
picks `targets[0]` (`"User"`) unconditionally
(`packages/metadata/src/types.ts:197-200`/`schema.ts:53-60`), the SOQL compiler joins `Owner`
against the `user` table unconditionally (`packages/soql/src/compile.ts:116`), **and**
`shape.ts` bakes `shape.type` in at compile time and stamps it onto every row's
`attributes.type` regardless of the row's actual key prefix
(`packages/soql/src/shape.ts:19,26` — confirmed by reading the file: `attributes(shape.type,
id, apiVersion)` where `shape.type` is fixed per query shape, not computed per row). A team
that fixes only the join (adds a `CASE`/branch join keyed on `keyPrefixOf`) will still return
`attributes.type: "User"` for a Group-owned record, and `packages/formula/src/compile.ts:97`'s
"first target" parent-path resolution is a **third**, independent place with the same bug that
is easy to forget because it lives in a different package.

**Why it happens:** Three call sites (`soql/compile.ts` join, `soql/shape.ts` row shaping,
`formula/compile.ts` parent traversal) all independently encode "polymorphic = pick index 0"
as a stopgap; there is no single seam that all three route through, so a partial fix (usually
just the SOQL join, since that's the one with the visible `TYPEOF is not supported yet` error)
is the natural failure mode.

**How to avoid:** Fix `resolveRelationship`'s callers to select the target by the row's actual
key prefix (via `keyPrefixOf`, already available per `packages/schema/src/ids.ts:40`) as a
**single shared helper** used by all three call sites, not three separate patches. Write one
test per call site against the same fixture (a Case or Account owned by a `Group`, not a
`User`): SOQL `SELECT Owner.Name FROM Case`, `attributes.type` on that same query's Owner
sub-object, and a formula referencing `Owner.Name` in a validation rule — all three must agree
on `"Group"`.

**Warning signs:** `checkReferences` (`packages/engine/src/engine.ts:487-509`) already resolves
polymorphic targets correctly per-row on the **write** path (`targets.find(t => t.keyPrefix ===
keyPrefixOf(id))`) — if the read-side fix doesn't converge on this exact same pattern, the
write and read paths will disagree about a record's owner type, which is a strong sign only one
side was fixed.

**Phase to address:** Polymorphic lookups / TYPEOF phase.

---

### Pitfall 6: TYPEOF parser support gaps and `WHERE` on the polymorphic parent itself

**What goes wrong:** `TYPEOF ... WHEN ... THEN ... ELSE ... END` currently throws
`unsupported("soql-typeof", ...)` unconditionally (`packages/soql/src/compile.ts:327`) — it is
parsed by `@jetstreamapp/soql-parser-js` but never compiled. Two distinct sub-bugs to watch for
once this is implemented: (1) a record whose runtime type matches none of the `WHEN` branches
must fall through to `ELSE` (documented Salesforce behavior — confirmed: unmatched types get
the `ELSE` field list, not an error and not an empty result) rather than being silently dropped
from results or crashing; (2) `WHERE Owner.Type = 'Group'` (filtering on the polymorphic
field's runtime type) is a separate, officially-documented pattern from `TYPEOF ... END` (which
only shapes the *selected* fields) — a compiler that implements `TYPEOF` in `SELECT` but not
`.Type` in `WHERE` will pass the "happy path" TYPEOF test and still fail any client that
filters by owner type, which is a common real-world query shape.

**Why it happens:** `TYPEOF` and `<Relationship>.Type` in `WHERE` are two independent grammar
productions in SOQL that happen to serve the same polymorphic-relationship feature; treating
"implement TYPEOF" as one task risks stopping at the `SELECT`-only case since that's the more
visible/discussed of the two in most Salesforce documentation and blog coverage.

**How to avoid:** Scope the phase to both productions explicitly. Confirm parser coverage
first — `@jetstreamapp/soql-parser-js` (already a dependency) needs to be checked for whether
it parses `WHERE Owner.Type = 'Group'` today; if the AST shape differs from what `compile.ts`
expects for a normal field comparison, that's a second parser-adjacency risk distinct from the
`TYPEOF` clause itself. jsforce's TypeScript types for query results on a `TYPEOF`-selected
field are typically loosely typed (`any`/`Record<string, unknown>` per branch) rather than a
discriminated union — this is a jsforce client-side characteristic, not something orglet needs
to defend against, but worth knowing so a "the jsforce test doesn't strongly type the result"
observation isn't mistaken for a orglet bug during conformance re-run.

**Warning signs:** A `TYPEOF` query against a fixture row whose owner is neither `User` nor
`Group` (not reachable for `OwnerId` today since both targets are modelled, but reachable for
`User.DelegatedApproverId` which is `["Group", "User"]` — both modelled too) is a weak test;
the strong test is `WHERE Owner.Type = 'Group'` returning exactly the Group-owned rows.

**Phase to address:** Polymorphic lookups / TYPEOF phase.

---

### Pitfall 7: Polymorphic-target-not-in-schema case is deferred but the TYPEOF/join fix must not assume all targets always exist

**What goes wrong:** For *this* milestone, every polymorphic field's targets are already
modelled: `OwnerId` → `User`/`Group`, `User.DelegatedApproverId` → `Group`/`User`,
`Group.RelatedId` → `User`/`UserRole` (all in the 21-object baseline). `Task.WhoId`/`WhatId`
and `Event.WhoId`/`WhatId` — whose targets include objects like `Lead` (modelled) but reference
patterns spanning many objects — are explicitly out of scope for this milestone per
`PROJECT.md`. The risk is writing the TYPEOF/join fix in a way that silently assumes "every
`referenceTo` entry has a matching object in the schema," which will throw an unhandled error
(not a graceful `UNSUPPORTED:*`) the moment a future milestone adds `Task`/`Event` with a
target not yet modelled, or the moment any custom polymorphic-adjacent scenario shows up.

**Why it happens:** It's easy to design and test the per-row target resolution helper (Pitfall
5) only against the two fields where all targets are guaranteed present, and never exercise the
"no target found for this key prefix" branch, because that branch is unreachable with current
fixtures.

**How to avoid:** Make the per-row resolution helper explicitly handle "key prefix has no
matching modelled target" as a degrade case (`UNSUPPORTED:reference-target` warning, matching
the existing convention at `packages/metadata/src/build.ts:461-466`) with a defined fallback
`attributes.type` (Salesforce's own key-prefix-to-object mapping is public and stable — even an
unmodelled target's *type* can often still be reported correctly from the ID prefix alone,
even if its fields can't be joined) rather than throwing. Add one test with a synthetic/fake key
prefix that matches nothing in the schema to exercise this branch now, even though no real
fixture hits it yet.

**Warning signs:** No test in the suite constructs an owner/parent ID whose prefix matches
nothing in `OrgSchema` — that gap is itself the warning sign.

**Phase to address:** Polymorphic lookups / TYPEOF phase (defensive-only scope; full
Task/Event support stays out of scope).

---

### Pitfall 8: Persisting key prefixes by renumbering instead of seeding from the current alphabetical assignment

**What goes wrong:** The migration from "recomputed alphabetically on every build"
(`packages/metadata/src/build.ts:1-8,20-24`) to "persisted" must treat the **first** run
against an existing org (including Johan's own Developer Edition retrieve, which already has
custom objects assigned prefixes today under the old scheme) as "freeze what's there now," not
"assign fresh prefixes as if this were a brand-new org." A naive persistence implementation
that just adds a table and populates it by running the existing alphabetical algorithm once
more will, by construction, reproduce the *current* correct assignment on the very first run
(no bug yet) — but the real risk surfaces on the *second* schema build after a custom object is
added or removed, if the persistence-write logic still recomputes-then-persists instead of
persist-then-only-assign-new-ones. The bug is invisible in a single-run test and only shows up
across two consecutive builds with a changed object set — precisely the scenario
`CONCERNS.md` already documents as unguarded by any existing test
(`packages/metadata/src/build.test.ts` "covers baseline+project merge but not multi-build
prefix drift").

**Why it happens:** "Persist the prefixes" sounds like "add a cache," and a cache that's
trivially derivable from existing inputs (alphabetical sort) tempts a same-answer-either-way
implementation that recomputes on every build and only *writes* the result — which passes every
single-build test while remaining exactly as broken as before across multi-build scenarios.

**How to avoid:** On first encounter with a custom object name, look up the org's persisted
prefix table; if the name exists, use its stored prefix unconditionally (never recompute it
from position). If the name is new, assign the next unused prefix in the persisted sequence
(not `customObjects.length` recomputed fresh) and persist it before returning the schema. The
correctness test is explicitly two-build, not one: build with objects [A, B], record prefixes;
build again with objects [A, B, Z-inserted-alphabetically-before-A]; assert A and B's prefixes
are unchanged and only the new object gets a new prefix — matching the exact scenario
`CONCERNS.md` calls out as currently untested.

**Warning signs:** Any implementation where the "assign new prefix" code path is reachable
without first consulting the persisted table is suspect; a two-build test (as above) is the
concrete acceptance gate.

**Phase to address:** Key-prefix persistence phase.

---

### Pitfall 9: `orglet reset` semantics and `orglet check` without a database left undefined for persisted prefixes

**What goes wrong:** Two behaviors need an explicit decision before implementation, not an
implicit one baked in by whatever's easiest to code: (1) does `orglet reset` (which drops the
org's Postgres schema per `ARCHITECTURE.md`'s CLI responsibilities) also clear the persisted
prefix table, or does it survive reset? If persisted prefixes live *inside* the dropped org
schema, reset naturally clears them (arguably correct — reset means "start over," and with no
records left, fresh alphabetical assignment on the next `up` is harmless). If they live
*outside* the org schema (a separate always-on system table, a local file), reset leaves them
stale, which quietly defeats the entire point of persistence: a `reset && up` cycle would then
get *different* prefixes than a truly fresh org, which is itself a correctness regression
relative to the pre-persistence behavior (which was at least *consistently* recomputed).
(2) `orglet check` validates an SFDX project **without touching Postgres**
(`ARCHITECTURE.md`) — but the true persisted prefix can only be known by reading Postgres, so
`check` running before any `up` has occurred cannot report the *real* prefix a subsequent `up`
would assign; it can only report a *provisional* one, and if `check`'s provisional guess is
allowed to diverge from what `up` later actually assigns, any output from `check` that surfaces
prefixes (warnings, describe-like output) is misleading.

**Why it happens:** These two commands were designed before persistence existed, under the
assumption that "the prefix" is a pure function of the object list computable anywhere; adding
persistence turns "the prefix" into "the prefix, conditional on what's already durably
recorded," which `check`'s no-database contract cannot honor, and `reset`'s "drop everything"
contract has to make an explicit choice about.

**How to avoid:** Decide and document explicitly (a design note, not just code): persisted
prefixes live inside the org's Postgres schema so `reset` clears them by construction (simplest,
matches "reset = start over," and is the only option consistent with `orglet check` running
without a database — there is no *other* place `check` could read from anyway). Make `orglet
check`'s output, if it shows prefixes at all, explicitly labeled as provisional/unverified
("would assign, pending `up`") rather than presented as fact.

**Warning signs:** Any design where persisted-prefix storage lives outside the org's own
Postgres schema (e.g., a flat file next to the SFDX project, a global `orglet` config table
shared across orgs) is the concrete anti-pattern to catch in review before implementation
starts, since it breaks both the reset-consistency and check-without-DB constraints
simultaneously.

**Phase to address:** Key-prefix persistence phase — resolve as a design decision before
writing the migration, not discovered mid-implementation.

---

### Pitfall 10: Green pglite tests hiding real-Postgres regressions

**What goes wrong:** A test suite that passes entirely on pglite gives false confidence that
the Docker-Postgres path (the one the *running server* actually uses, per
`PROJECT.md`: "Docker Compose path still works for the running server") is also correct, when
pglite differs from real Postgres 16 in ways that matter to this codebase specifically:

- **`session_replication_role`**: import mode
  (`packages/engine/src/engine.ts:215`, `SET LOCAL session_replication_role = replica`) is
  used to disable FK enforcement during import. pglite's support for this session parameter has
  been reported as failing in at least one downstream project migrating SQLite→pglite data,
  with a `25P02` error surfaced ([electric-sql/pglite issue tracker discussion referenced via
  a downstream bug report](https://github.com/activepieces/activepieces/issues/10545);
  confidence: MEDIUM — this is a third-party bug report, not an official pglite compatibility
  matrix entry, so **verify directly against the pinned pglite version before relying on
  import-mode tests passing under pglite as proof the feature works**). If import mode's
  `SET LOCAL session_replication_role` silently no-ops or errors under pglite while genuinely
  working under real Postgres (or vice versa), tests for import mode are exactly where a false
  positive or false negative would hide.
- **`information_schema`/`pg_catalog` completeness**: pglite has had gaps in
  `information_schema.tables`/`pg_catalog.pg_tables` support (confirmed via
  [electric-sql/pglite#8](https://github.com/electric-sql/pglite/issues/8); status as of this
  research is that basic `information_schema` queries work but completeness relative to real
  Postgres is not guaranteed for every catalog view — confidence: MEDIUM, the specific issue
  is from 2024 and may be resolved in the current pglite version, but no authoritative "fully
  resolved" changelog entry was found). This directly threatens `packages/schema/src/migrate.ts`,
  which diffs a `TablePlan` against a live database **via `information_schema`** — if pglite's
  `information_schema` output shape (column order, type names, nullable representation) differs
  even slightly from real Postgres 16, the migration differ could report false
  drops/no-changes under pglite that a real Postgres run would report differently, or vice
  versa.
- **Single connection / no real concurrency**: pglite is explicitly single-connection by design
  (confirmed via [pglite GitHub repository description and multiple third-party writeups
  including the PGlite v0.4 announcement discussing "connection multiplexing" as new, partial
  functionality](https://electric.ax/blog/2026/03/25/announcing-pglite-v04); confidence: HIGH
  for the base single-connection architecture, MEDIUM for how far v0.4's multiplexing closes
  the gap for this project's needs since it's described as "not all cases might be covered").
  Any test relying on genuine transaction interleaving — e.g., two concurrent `DmlEngine.insert`
  calls racing on a unique constraint, or the per-record savepoint rollback behavior under real
  concurrent load — cannot be meaningfully exercised under pglite even with multiplexing,
  because statements are still serialized through one underlying engine.
- **Error message / SQLSTATE differences**: because pglite is a WASM build of real Postgres
  source (not a reimplementation), SQLSTATE codes are generally expected to match; the
  practical risk is narrower than "different SQLSTATEs" — it's *exact error message text* in
  cases where orglet's error mapping (e.g., `duplicateError()`,
  `packages/engine/src/engine.ts:514`, which parses the conflicting field name out of a
  `23505` error) depends on Postgres's constraint-name-in-message formatting, which could
  differ subtly across build/version skew between pglite's bundled Postgres and the Docker
  image's Postgres 16.

**Why it happens:** pglite's entire value proposition is "real Postgres, just embeddable" — it
is easy to treat it as behaviorally identical rather than as its own compatibility surface with
its own version, its own known gaps, and its own concurrency model, especially since the
happy-path DDL/DML the existing 119 tests exercise mostly avoids the specific features (import
mode, migration diffing, concurrent writes, exact error text) most likely to diverge.

**How to avoid:** Keep a Docker Postgres 16 CI job in addition to a pglite job (explicitly
listed as an "Active" requirement already — "pglite for tests, Docker Compose for the running
server" — but the *CI matrix*, not just the local dev workflow, needs both). Run the
**identical** test suite against both backends in CI (parameterize the Postgres connection
setup, don't duplicate test files), and treat any test that only passes under one backend as a
signal to investigate before merging, not a backend quirk to route around. Specifically target
import mode's `session_replication_role` test and the schema-migration differ tests
(`migrate.test.ts`) at both backends first, since those are the two highest-risk overlaps
identified above.

**Warning signs:** A CI config that runs pglite-backed tests only, with Docker Postgres reduced
to "developer convenience, not CI-gated," is the anti-pattern; watch for it explicitly during
GitHub Actions setup since it's the path of least resistance (pglite needs no service
container, Docker Postgres does).

**Phase to address:** pglite test infrastructure phase, with the Docker-Postgres CI job owned
by the same phase (not deferred to the GitHub Actions phase as an afterthought) since the two
are only safe together.

---

### Pitfall 11: pglite's WASM/ESM loading breaking under vitest's default bundler handling

**What goes wrong:** pglite ships WASM binaries loaded via bundler-sensitive patterns (`new
URL('./file', import.meta.url)`); vitest's default transform pipeline (esbuild-based) has been
reported to need explicit handling for this pattern in some setups, and vitest's own project
threads report needing plugin help (`vite-plugin-wasm` or manual
`WebAssembly.compileStreaming()`) for ESM+WASM integration
([vitest-dev/vitest discussion #4283](https://github.com/vitest-dev/vitest/discussions/4283);
confidence: MEDIUM — this is community-reported, not an official pglite/vitest compatibility
statement, and pglite's official bundler-support docs frame the requirement generically as
"the bundler must handle `new URL(...)` correctly" rather than vitest-specifically). Since this
repo's `vitest.config.ts` currently has zero bundler-plugin configuration (it's a plain
Node-environment vitest setup per `TESTING.md`), a first-time pglite integration attempt is a
plausible place to lose time to a WASM-loading error that looks unrelated to the actual test
code.

**Why it happens:** vitest's Node-environment test runner doesn't go through Vite's full
browser-oriented asset pipeline by default the same way a Vite app build does, so guidance
written for "using pglite in a Vite app" doesn't map 1:1 onto "using pglite in a vitest Node
test file."

**How to avoid:** Prototype the pglite import in isolation (one throwaway test file, `import {
PGlite } from "@electric-sql/pglite"`, `new PGlite()`, one query) before wiring it into the
existing test helper pattern (`beforeAll`/`afterAll` per `TESTING.md`), specifically to
isolate WASM-loading failures from schema/migration logic failures. If vitest's Node
environment turns out to load the WASM module directly via Node's native `fs`/`WebAssembly`
APIs without needing a bundler plugin (plausible, since vitest's Node pool doesn't necessarily
route through esbuild's browser-target asset handling the same way), this pitfall may not
materialize at all in this specific stack — treat the prototype step as the actual
verification, not the WebSearch results above.

**Warning signs:** Any error mentioning `import.meta.url`, `WebAssembly.instantiate`, or a
missing `.wasm` file path during the first pglite test run is this exact issue, not a logic
bug.

**Phase to address:** pglite test infrastructure phase.

---

### Pitfall 12: pglite memory growth across many test files exhausting CI runners

**What goes wrong:** Booting a fresh pglite instance per test file (mirroring the existing
per-file-random-schema isolation pattern in `TESTING.md`) multiplies WASM/initdb memory cost
across the 5 currently-Postgres-backed test files (and any new ones added by this milestone —
roll-ups, TYPEOF, and Bulk persistence will each likely need their own Postgres-backed test
file). Community reports describe pglite's `initdb` step failing under memory pressure when
multiple clusters boot concurrently, and one third-party project's test suite reportedly
consumed ~5GB across parallel vitest workers with multiple in-memory Postgres instances
(confidence: LOW-MEDIUM — these are individual project post-mortems found via search, not an
official pglite resource-usage benchmark; treat as "plausible failure mode to budget CI runner
memory for," not a precise number to plan around).

**Why it happens:** vitest's default pool runs test files in parallel worker processes/threads
for speed; each worker's pglite instance is independent memory, and GitHub Actions' standard
runners have a fixed, modest memory ceiling (typically 7GB on `ubuntu-latest` at time of
writing) shared across the whole job.

**How to avoid:** Either share one pglite instance across test files within a worker (requires
rethinking the current "fresh Postgres schema per file" isolation pattern, since pglite has no
Docker-container-level isolation the way a shared Postgres server does — a shared pglite
instance would need the *same* schema-namespacing trick already used against Docker Postgres:
`CREATE SCHEMA test_<hex>` per file, `DROP SCHEMA ... CASCADE` in `afterAll`, reusing one
`PGlite` connection), or explicitly cap vitest's worker/pool concurrency
(`vitest.config.ts`'s `pool`/`poolOptions` per [vitest pool
docs](https://vitest.dev/config/pool)) for the CI run specifically if per-file instances are
kept. Prefer the shared-instance-plus-schema-namespacing approach — it reuses the exact
isolation pattern already proven in this codebase rather than inventing a new one.

**Warning signs:** CI runs that pass locally (larger dev machine) but OOM or get killed on
GitHub-hosted runners specifically; a linear growth in CI wall-clock/memory usage as more
pglite-backed test files are added during this milestone (roll-ups, TYPEOF, Bulk persistence
each likely add one) is the leading indicator to watch during the milestone, not just at the
end.

**Phase to address:** pglite test infrastructure phase — decide the sharing/isolation strategy
before other phases start adding new Postgres-backed test files against it, since retrofitting
isolation strategy after several new test files exist is more work than deciding it first.

---

### Pitfall 13: pnpm/corepack/Node 22 mismatches and vendored-file drift breaking CI but not local dev

**What goes wrong:** `package.json` pins `"packageManager": "pnpm@12.6.0"` and
`"engines": {"node": ">=22", "pnpm": ">=10"}`. A GitHub Actions workflow that installs Node 22
and a *different* pnpm version (e.g., via a stale `actions/setup-node` cache key or a
`pnpm/action-setup` version pin that doesn't match `packageManager`) can produce lockfile-format
mismatches that only fail in CI, since local dev machines with corepack enabled resolve the
exact pinned version transparently. Separately: `pnpm-lock.yaml` drift (a dependency bumped
locally without `pnpm install` being re-run, or vice versa) fails differently in CI than
locally, because **pnpm refuses to update an existing lockfile when it detects the `CI` env var**
(set automatically by GitHub Actions), so a workflow using a plain `pnpm install` where a
contributor's machine would silently rewrite the lockfile will instead hard-fail in CI with no
local repro unless `CI=true` is set locally too.

**Why it happens:** Corepack + `packageManager` field is the correct modern pattern, but
`actions/setup-node`'s built-in caching assumes the version manager is already installed and
doesn't itself enforce corepack activation — mixing `actions/setup-node`'s Node-only setup with
a separate pnpm install step (rather than using it consistently with `pnpm/action-setup` or the
newer consolidated `pnpm/setup` action) is the most common source of drift, per the setup-node
issue tracker ([actions/setup-node#531](https://github.com/actions/setup-node/issues/531)).

**How to avoid:** Use `corepack enable` explicitly as an early workflow step (Node 22 ships
corepack but it is not enabled by default on GitHub-hosted runner images as of this research —
verify against the current `actions/setup-node` runner image notes at CI-authoring time), then
let corepack read `packageManager` from `package.json` rather than pinning a pnpm version
separately in the workflow YAML — this makes the workflow and `package.json` a single source of
truth instead of two. Run `pnpm install --frozen-lockfile` (not plain `install`) as the CI
install step specifically so lockfile drift fails fast with a clear message rather than
silently rewriting the lockfile in a CI context where nobody will commit the rewrite.

**Warning signs:** A CI failure that says "lockfile does not match package.json" or a pnpm
version-mismatch error on a PR where local `pnpm test` passed cleanly — this is definitionally
an environment-pinning gap, not a code bug, and re-running locally will falsely appear to
"work."

**Phase to address:** GitHub Actions / CI phase.

---

### Pitfall 14: Vendored `sigha` and `scripts/sync-sigha.sh` desynced from what CI actually checks out

**What goes wrong:** `packages/sigha/src` is generated by `scripts/sync-sigha.sh` from an
**external** upstream repo (`github.com/rfaulhaber/sigha`) and is explicitly "not edited by
hand" (`ARCHITECTURE.md`). Because the vendored output is committed to this repo (not
regenerated at build/CI time — confirm this assumption against the actual `.gitignore` before
relying on it, but `ARCHITECTURE.md`'s description implies committed vendored source, not a
build step), CI should simply be checking out committed files like any other source — the
actual risk is narrower and easier to miss: `sync-sigha.sh` clones upstream fresh
(`git clone -q https://github.com/rfaulhaber/sigha.git`) every time it's run, so if it is ever
invoked as part of a CI step (rather than only as a manual local maintenance script), CI
becomes dependent on an external GitHub repo's availability and current `main` branch content,
silently coupling build reproducibility to a third party the project doesn't control. This is
a "looks fine until upstream force-pushes or goes away" risk, not a subtle logic bug.

**Why it happens:** It is tempting, when wiring up a CI workflow from scratch, to include
"resync vendored dependencies" as a step for freshness, without registering that this
specific vendored package is a deliberate one-time-per-maintainer-action, not a build-time
step.

**How to avoid:** CI should never invoke `scripts/sync-sigha.sh`; it should only run
`pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` against whatever
`packages/sigha/src` is already committed in the checked-out ref. Explicitly exclude the sync
script from any "run all scripts" style CI step if one is ever added generically.

**Warning signs:** A CI workflow file that references `sync-sigha.sh` at all is the thing to
catch in review.

**Phase to address:** GitHub Actions / CI phase.

---

### Pitfall 15: Bulk API 2.0 persistence loosens the server-only state-transition guarantee

**What goes wrong:** The existing in-memory implementation already correctly enforces that a
client can only request `UploadComplete` or `Aborted` via `PATCH .../jobs/ingest/{id}`
(`packages/api/src/routes/bulk.ts:276-290`), rejecting any other client-requested state with
`INVALIDJOBSTATE`; the server alone drives `Open → UploadComplete → InProgress → JobComplete`
internally. When this state machine moves into Postgres, the risk is that persistence code
(an `UPDATE bulk_jobs SET state = $1 WHERE id = $2`-style helper) becomes reusable/callable
from more places than the original narrow state-transition functions were, and a future route
or test helper calls it directly with an arbitrary state string, bypassing the validation that
currently lives in the route handler rather than in a shared state-machine module.

**Why it happens:** Persistence work naturally centralizes "write job state to storage" into a
shared function; if that function is a raw setter rather than a guarded transition function, the
validation that used to be co-located with the only caller (the route handler) can quietly stop
being the only way to reach that code path.

**How to avoid:** Model the persisted state machine as a function that takes `(currentState,
requestedTransition)` and returns either the new state or a rejection, reusing exactly the
transition table already encoded in the current route handler's `if` chain — and make the
Postgres write happen *only* through that function, never via a raw `UPDATE ... SET state`
callable from elsewhere. Keep the existing test coverage for "client cannot set `InProgress` or
`JobComplete` directly" as a persisted-store test too, not just an in-memory one.

**Warning signs:** Any code path that writes to a `state` column without going through the
shared transition-guard function; a grep for direct `UPDATE.*bulk_jobs.*state` outside one
module is the concrete review check.

**Phase to address:** Bulk API 2.0 persistence phase.

---

### Pitfall 16: Persisted jobs "surviving restart" while synchronous processing still leaves them stuck mid-batch

**What goes wrong:** This milestone's scope is explicitly "jobs are persisted... and survive a
server restart" — not "processing becomes asynchronous/resumable" (that's a separate, larger
change `CONCERNS.md` already flags as a scaling limit, out of scope here). A job that a client
sees as `InProgress` when the server process dies mid-CSV-parse (between `CHUNK_SIZE = 200`
DML batches, per `packages/api/src/routes/bulk.ts:18` chunking) will, after persistence,
**restart in the `InProgress` state with no code path that ever revisits it** — because nothing
in a synchronous, request-triggered processing model resumes a half-finished job on server
boot. Before persistence, a restart correctly returned 404 for that job (honest failure, per
`CONCERNS.md`); after persistence, the same restart returns a job stuck at `InProgress`
forever with no error and no progress, which is a **worse** client experience than 404 —
polling clients get no error, no completion, no timeout, indefinitely.

**Why it happens:** "Persist so it survives restart" sounds strictly better than "in-memory,"
but survival-without-resumability for a job that was mid-flight at the moment of the crash is
not actually well-defined — the requirement, read literally, is really about
already-`JobComplete`/`Failed` jobs and their result data surviving restart, plus
`Open`/`UploadComplete` jobs (not yet started processing) being resumable simply by re-running
`UploadComplete` handling on next boot — not about resuming genuinely mid-batch `InProgress`
work.

**How to avoid:** On server startup, scan persisted jobs for `InProgress` state (which, given
synchronous processing, can only mean "the server crashed while processing this job") and
transition them to `Failed` with an explicit error message (e.g., "processing was interrupted
by a server restart") rather than leaving them stuck — this keeps the honest-failure property
the in-memory version had by construction, now made explicit instead of implicit. Confirm this
edge case against the milestone's actual acceptance bar before building resumable/async
processing, which is explicitly not required here.

**Warning signs:** No test kills the server process (or simulates process restart by
constructing a fresh `DmlEngine`/job store against the same persisted schema) mid-`InProgress`
and asserts the job's state after "restart" — that gap is the concrete thing to close.

**Phase to address:** Bulk API 2.0 persistence phase.

---

### Pitfall 17: Large CSV payloads stored as a single Postgres row/column

**What goes wrong:** `IngestJob.csvChunks`, `successRows`, `failedRows`, and `QueryJob.rows`
are currently in-memory arrays (`packages/api/src/bulk/jobs.ts:29,35,37`, per
`CONCERNS.md`). A straightforward persistence design stores the concatenated CSV as one
`text`/`bytea` column per job row. Postgres handles large text values via TOAST transparently
up to its hard 1GB-per-value limit, but this milestone's persistence work can still reintroduce
the exact "hold the whole payload in memory" problem `CONCERNS.md` already flags — reading a
large persisted CSV back out for the result-download endpoint still means loading the full
column value into the Node process's memory unless the read path streams it, which a naive
`SELECT csv_data FROM bulk_jobs WHERE id = $1` does not.

**Why it happens:** Persistence work is scoped as "don't lose jobs on restart," not
"stream large payloads" — it's easy to satisfy the literal restart-survival requirement while
leaving the memory-buffering behavior (now doubled: buffered once in the request handler,
again on the round-trip through Postgres) unchanged or worse.

**How to avoid:** Explicitly scope this phase to *not* attempt streaming (matching
`CONCERNS.md`'s existing framing of streaming as a separate, larger scaling fix) but do verify
the specific interaction: a single Postgres `text` column comfortably holds realistic CSV
sizes for this project's stated use case (local dev/CI-scale data, not enterprise bulk loads),
so this is a "confirm it's fine at this scale, document the ceiling" task, not a "must fix"
one. Put an explicit, documented row-size assumption/limit in code comments near the DDL for
the jobs table so a future contributor doesn't need to rediscover the 1GB TOAST ceiling by
hitting it.

**Warning signs:** Any test with a CSV payload sized to actually exercise TOAST behavior
(multi-MB) is a "nice to have, not required" for this milestone; the concrete minimum bar is a
code comment/doc note stating the assumption explicitly, since there's no requirement to fix
the underlying buffering.

**Phase to address:** Bulk API 2.0 persistence phase (document scope boundary explicitly, do
not silently expand scope to streaming).

---

### Pitfall 18: Thin standard-object baselines that break jsforce's `describe()` contract

**What goes wrong:** jsforce (and simple-salesforce) treat certain `describe()` fields as
structurally required for the SDK's own internal logic, not just informational — `nameField`
(which field is the record's display name), `keyPrefix`, and the `urls` map (`sobject`,
`describe`, `rowTemplate`, etc.) are the three the milestone context calls out explicitly. A
"thin" baseline built by stripping a real object down to its minimum fields can easily produce
JSON that's valid per this project's own `StandardObjectJson` schema but missing one of these —
e.g., an object with no field marked `nameField: true` (plausible for a genuinely minimal
object like `BusinessHours`, which doesn't have an obvious "Name" field) will describe
correctly by *this* codebase's own rules but may cause jsforce's list-view/record-name-display
logic (or simple-salesforce's equivalent) to throw or silently render blank where a real
Salesforce org always has exactly one `nameField: true` field per object.

**Why it happens:** The 14 objects being added exist in this milestone specifically to satisfy
*lookup validation* (`checkReferences`), not to be fully functional CRUD targets — the natural
temptation is to define the absolute minimum (system fields + whatever's referenced), which is
correct for the lookup-validation goal but risks being *too* thin for any conformance test that
happens to `describe()` one of these 14 objects directly.

**How to avoid:** For each of the 14, confirm real Salesforce's actual `nameField` (most
standard objects have one even if it's not obviously an editable "Name" — e.g. `CaseNumber` for
`Case`) via public describe references before deciding an object has none; if an object
genuinely has no user-facing name field (rare but real, e.g. some junction-like standard
objects), confirm what real Salesforce's describe returns in that case (an empty `nameField`
designation is itself a valid, documented state — don't invent a fake one) rather than
guessing. Run each new object through a `describe()` call in both conformance suites
(jsforce, simple-salesforce) as part of this phase's acceptance, not just orglet's own
`build.test.ts`.

**Warning signs:** Any of the 14 new objects with zero fields marked `nameField: true` *and*
no confirmation that real Salesforce agrees is a review flag; a jsforce or simple-salesforce
conformance run that throws (not just fails an assertion) when touching one of these 14 objects
is the concrete detection signal.

**Phase to address:** Thin baselines phase.

---

### Pitfall 19: Read-only-in-real-Salesforce objects silently accepting inserts in the thin baseline

**What goes wrong:** Several of the 14 objects (`OpportunityHistory` is the clearest example —
a system-managed audit trail of `Opportunity` stage changes, never directly insertable via the
API in real Salesforce) are read-only by nature. If the thin baseline defines them with the
same default `createable`/`insertable` posture as an ordinary custom-touched standard object
(since that's this codebase's existing default path through `build.ts`), a client `INSERT` into
`OpportunityHistory` will succeed against orglet where it would fail with
`CANNOT_INSERT_UPDATE_ACTIVATE_ENTITY` (or similar) against real Salesforce — a correctness gap
in the *opposite* direction from the project's stated design principle (`UNSUPPORTED:<area>`
for gaps, not silently-wrong-but-successful behavior).

**Why it happens:** The 14 objects are being added specifically to satisfy `checkReferences`
for **lookups pointing at them** — nobody is planning to insert `OpportunityHistory` rows
directly, so it's easy to not think about the object's own createability at all and let it
default to whatever the schema/DDL layer does for any other object.

**How to avoid:** For each of the 14, explicitly research (not assume) whether real Salesforce
allows direct DML against it; for the ones that don't (`OpportunityHistory` is the standout
case — history objects are consistently read-only across Salesforce's platform), mark the
object `createable: false`/`updateable: false`/`deletable: false` at the object level (if this
codebase's schema model supports object-level DML restriction — confirm; if it only supports
field-level `createable`/`updateable`, this may require adding object-level support, which is a
scope question worth raising explicitly rather than silently skipping the restriction) so an
insert attempt fails the same documented way it does against real Salesforce, rather than
succeeding.

**Warning signs:** A test that inserts a bare row into each of the 14 new objects and expects
success is the wrong test for the ones that are read-only in reality; if such a test exists and
passes, it's testing the wrong thing.

**Phase to address:** Thin baselines phase.

---

### Pitfall 20: Believing the conformance suites are green because nobody re-ran them

**What goes wrong:** `TESTING.md` documents the jsforce README as last verified 2026-09-25,
**before** Bulk API 2.0 support was added (`2fcdbc5 Add Bulk API 2.0 ingest and query jobs`)
and explicitly flags "this specific gap may be narrower now; re-run before relying on the exact
counts." This milestone adds six more changes (TYPEOF, roll-ups, thin baselines, key-prefix
persistence, Bulk persistence, pglite) any one of which can shift the conformance numbers in
either direction — new passes (Bulk tests that previously failed on the v1 vs v2 mismatch) and
new failures (a roll-up or TYPEOF change altering describe() output in a way an existing
passing test didn't expect) are both plausible. Treating "conformance was green in the last
recorded run" as still true without re-running is exactly the stale-numbers trap the milestone
context calls out by name.

**Why it happens:** The two conformance suites are explicitly **manual, not CI-gated**
(`TESTING.md`: "not part of `pnpm test` / CI... require a running orglet instance plus
network/tooling setup") — this is a deliberate design choice (external SDK e2e suites are slow
and need live-server setup unsuitable for every PR), but it means nothing *forces* a re-run,
unlike the vitest suite which fails loudly in CI on every push once GitHub Actions exists.

**How to avoid:** Make the conformance re-run an explicit, named task at the *end* of this
milestone (after all six other changes land), not something assumed to still be true from
the pre-milestone baseline — update both READMEs' documented pass/fail counts and dates as part
of the milestone's own completion criteria, matching this project's existing convention of
dated, numbered conformance records rather than vague "should still work" language.

**Warning signs:** A milestone completion review that doesn't include a fresh
`conformance/jsforce/run.sh` and `conformance/python/run.py` execution with updated numbers
committed to their respective READMEs is incomplete by this project's own documented standard.

**Phase to address:** Conformance re-run phase — sequenced last, after every other phase in
this milestone, by definition (it validates the sum of the milestone's changes).

---

### Pitfall 21: Previously-excluded Bulk tests now included may fail for reasons unrelated to Bulk itself

**What goes wrong:** The jsforce conformance run's Jest `-t` filter currently excludes "bulk"
by name in some capacity per the historical 58-skipped count, and the 2 known failures were
tied to Bulk API **v1** (`/services/async/*`, not implemented) rather than v2. Once Bulk API
2.0 persistence is added and the filter is revisited to include more Bulk-related tests, new
failures may surface that have nothing to do with persistence correctness — e.g., the seed data
script (`conformance/jsforce/seed.mjs`, which seeds via `/composite/sobjects` rather than Bulk,
per `TESTING.md`) may not provision fixture rows in a shape newly-enabled Bulk tests expect, or
newly-included tests may assume Bulk API v1 endpoints that remain genuinely out of scope for
this milestone (v1 is not being added — only v2 persistence).

**Why it happens:** "Re-run the conformance suite and include previously-excluded Bulk tests"
conflates two independent risks: (1) did Bulk API 2.0 persistence introduce a regression, and
(2) were the tests excluded for a reason that persistence doesn't actually address (v1 vs v2).
Newly-red tests get attributed to the wrong cause if this distinction isn't made explicit going
in.

**How to avoid:** Before broadening the Jest filter, read the specific excluded test names and
classify each one as "blocked by v1-not-implemented (stays excluded, this milestone doesn't
add v1)" vs "blocked by v2-not-persisted (now unblocked, should be included)" — don't do a
blanket "unexclude bulk" and then debug failures reactively. Document the classification in the
updated README alongside the refreshed pass/fail counts, continuing the existing "expected/
declared gaps" vs "other findings" table convention already used there.

**Warning signs:** A conformance re-run diff that shows new failures in Bulk-related tests
without a clear note on whether each failure is a real regression or an expected v1-still-out-
of-scope gap.

**Phase to address:** Conformance re-run phase.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|-----------------|------------------|
| Recompute-then-persist key prefixes (recompute alphabetically every build, just write the result) | Fast to implement, passes single-build tests | Reintroduces the exact prefix-drift bug persistence exists to fix, invisibly, until a second build with a changed object set | Never — this is the one shortcut this phase exists specifically to close |
| Roll-up recompute scoped to Master-Detail only, no reparenting support at all (reject reparenting outright rather than handling it) | Sidesteps Pitfall 1 entirely, smaller surface to test | Matches Salesforce's own default (`reparentable: false`) closely enough to be legitimate, not really a shortcut | Acceptable and arguably correct as the milestone's default; only a real shortcut if `reparentable: true` is left silently broken instead of explicitly rejected |
| pglite-only CI (no Docker Postgres job) | Simpler CI config, faster jobs, no service container needed | Hides exactly the class of pglite/Postgres divergence bugs described in Pitfall 10 | Never for this project, given `PROJECT.md` already commits to keeping the Docker path working |
| Persisting Bulk jobs without an `InProgress`-on-restart reconciliation step | Smaller diff, "just add a table" | Jobs stuck silently forever after any crash mid-processing — worse UX than the pre-persistence 404 | Never; the reconciliation step is small enough that skipping it isn't a meaningful time save |
| Thin baseline objects with default (non-restricted) DML posture for read-only-in-reality objects like `OpportunityHistory` | One less thing to research per object | Silent wrong-success on insert, violating the project's own `UNSUPPORTED:<area>` design principle | Never — directly contradicts the stated Core Value ("anything it does not support is logged... rather than faked") |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|-----------------|-------------------|
| jsforce `describe()` | Assuming any valid-looking JSON satisfies jsforce's internal expectations of `nameField`/`keyPrefix`/`urls` | Run every new/changed object through an actual jsforce `describe()` call as part of the phase, not just this project's own schema validation |
| simple-salesforce | Assuming Python SDK and jsforce agree on TYPEOF/polymorphic result shaping | Run both conformance suites against the same TYPEOF fixtures; don't treat one suite's pass as sufficient |
| pglite | Treating it as a drop-in Postgres 16 replacement for every code path | Verify `session_replication_role` (import mode) and `information_schema` (migration differ) specifically against the pinned pglite version before trusting green tests there |
| GitHub Actions service containers | Configuring the Postgres service container without a `pg_isready` health check, causing flaky "connection refused" failures on fast runners | Use `--health-cmd pg_isready --health-interval 10s --health-timeout 5s --health-retries 5` (or stricter) exactly as GitHub's own Postgres service container docs demonstrate |
| `@jetstreamapp/soql-parser-js` | Assuming TYPEOF and `WHERE <rel>.Type = '...'` are the same parser feature / land in the same effort | Verify parser AST coverage for both productions independently before scoping the TYPEOF phase |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|-----------------|
| Roll-up recompute via a fresh aggregate query per child-save, with no batching for bulk/composite-tree inserts | A `Bulk API` ingest of 200 rows into a roll-up child triggers 200 separate parent aggregate recomputes instead of one per distinct parent | Batch recompute by distinct parent ID within a chunk before writing, not per individual child row | Any Bulk ingest chunk (`CHUNK_SIZE = 200`) where many children share few parents |
| pglite instance-per-test-file multiplying memory (Pitfall 12) | CI runners OOM or slow down disproportionately as more Postgres-backed test files are added this milestone | Share one pglite instance per worker with schema-namespacing, or cap vitest pool concurrency in CI | Once roll-up/TYPEOF/Bulk-persistence tests each add their own Postgres-backed file on top of the existing 5 |
| Persisted Bulk job CSV read back into memory in full for result download (Pitfall 17) | Large result downloads block the event loop or spike memory | Explicitly scope this milestone to NOT fix (document the ceiling instead); revisit only if real usage exceeds it | Payloads approaching Postgres's ~1GB TOAST ceiling, or many concurrent large downloads |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Persisting Bulk job data (which may include arbitrary customer-shaped CSV rows from ingest jobs) without considering it now durable across restarts, combined with the existing permissive-auth default | Previously, an in-memory job's data vanished on restart; persisted job data now lives in Postgres indefinitely (until explicit job deletion) under the same permissive-by-default auth posture `CONCERNS.md` already flags | No new mitigation required for this milestone's stated goals (local dev/CI use), but explicitly note in the phase's own documentation that persisted Bulk job data inherits the existing permissive-auth risk profile, so it isn't rediscovered as a "new" finding later |
| Roll-up recompute or TYPEOF resolution accidentally exposing data across polymorphic targets a user shouldn't see (e.g., resolving `Owner` to a `Group` whose fields shouldn't be visible) | Low risk in this milestone specifically since there is no FLS/sharing model enforcement anywhere in the engine yet (`CONCERNS.md` already documents this as out of scope) | No new mitigation needed here either — just don't let TYPEOF/polymorphic work imply a false sense of access control that doesn't exist anywhere else in the engine |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|--------------|-------------------|
| `orglet check` silently showing a provisional key prefix as if it were final (Pitfall 9) | A developer trusts `check`'s output, then sees a different prefix after `up`, and doesn't know why | Label any prefix shown by `check` as provisional/unverified explicitly in its output text |
| Persisted Bulk job stuck at `InProgress` forever after a crash (Pitfall 16) | Client polling logic waits indefinitely with no error, no timeout signal | Reconcile `InProgress` jobs to `Failed` with an explicit restart-interruption message on server boot |
| Roll-up field silently ignoring a client-supplied value instead of a clear rejection (Pitfall 4) | A client that mistakenly tries to set a roll-up field gets no feedback that its value was dropped | Match Salesforce's exact behavior precisely (confirm via conformance test) rather than guessing between silent-ignore and hard-reject |

## "Looks Done But Isn't" Checklist

- [ ] **Roll-up summaries:** Often missing the reparent-both-parents case and the
      filter-field-only-changed case — verify with the two-build/two-parent test matrix in
      Pitfalls 1–2, not just insert/delete on a stable parent.
- [ ] **TYPEOF / polymorphic:** Often fixes the SOQL join but leaves `attributes.type` (shape.ts)
      or the formula parent path (formula/compile.ts) on the old "first target" behavior —
      verify all three call sites against the same Group-owned fixture (Pitfall 5).
- [ ] **Key-prefix persistence:** Often correct on the first build (recompute happens to match
      persisted state) but wrong on the second build with a changed object set — verify with a
      two-build test, not a one-build test (Pitfall 8).
- [ ] **pglite test infra:** Often "all tests pass under pglite" is treated as equivalent to
      "all tests pass under Docker Postgres" — verify the same suite runs against both in CI,
      not pglite alone (Pitfall 10).
- [ ] **Bulk API 2.0 persistence:** Often satisfies "survives restart" for completed jobs but
      leaves genuinely mid-flight `InProgress` jobs stuck forever — verify with a simulated
      restart during processing (Pitfall 16).
- [ ] **Thin baselines:** Often defines enough fields to satisfy this project's own schema
      validation but not enough to satisfy jsforce/simple-salesforce's `describe()` assumptions
      (`nameField`, `keyPrefix`, `urls`) — verify with an actual SDK `describe()` call per new
      object, not just `build.test.ts` (Pitfall 18).
- [ ] **Conformance re-run:** Often "should still be green" is assumed rather than re-verified
      after six concurrent feature changes — verify with an actual, dated re-run of both suites
      as an explicit milestone-completion task (Pitfall 20).

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|-----------------|------------------|
| Roll-up double-counting shipped (Pitfall 1) | MEDIUM | Add the missing old-parent recompute, then run a one-off recompute-all-roll-ups pass across existing data to correct already-wrong totals (needed once, not part of the save pipeline) |
| Key prefixes renumbered on a second build (Pitfall 8) | HIGH | Existing record IDs already stored under the old prefix cannot be un-issued; recovery requires either accepting the drift for already-created records and only fixing it going forward, or a data migration remapping IDs — expensive enough that prevention (two-build test before shipping) is far cheaper than recovery |
| pglite-only CI shipped and a real-Postgres-only bug reaches main (Pitfall 10) | LOW | Add the Docker Postgres CI job retroactively; not destructive, just delayed protection |
| Bulk job stuck at `InProgress` forever in production data (Pitfall 16) | LOW | A one-off script/migration to reconcile any currently-stuck `InProgress` jobs to `Failed`, then ship the boot-time reconciliation fix so it doesn't recur |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|-------------------|----------------|
| 1. Roll-up double-count/stale on reparent | Roll-up summary fields | Two-parent reparent test asserting both totals |
| 2. Roll-up missed on undelete/filter-field change | Roll-up summary fields | Full (insert/update-aggregate/update-filter-only/delete/undelete) × (in/out-filter) matrix |
| 3. Roll-up recursion + savepoint scope | Roll-up summary fields | Multi-level cycle rejected at load; partial-success batch test asserting roll-up matches only committed children |
| 4. Roll-up writable via API | Roll-up summary fields | `describe()` shows `createable: false`/`updateable: false`; insert/update with a roll-up value ignored, not stored |
| 5. TYPEOF fix incomplete across join/shape/formula | Polymorphic lookups / TYPEOF | Same Group-owned fixture asserted via SOQL, `attributes.type`, and a formula validation rule |
| 6. TYPEOF parser gaps / `WHERE <rel>.Type` | Polymorphic lookups / TYPEOF | `WHERE Owner.Type = 'Group'` test, independent of the `TYPEOF...END` test |
| 7. Unmodelled polymorphic target defensive gap | Polymorphic lookups / TYPEOF | Synthetic unmatched-prefix test degrades gracefully, doesn't throw |
| 8. Key prefixes renumbered on second build | Key-prefix persistence | Two-build test: unchanged prefixes for existing objects, new prefix only for the added object |
| 9. `reset`/`check` semantics undefined | Key-prefix persistence | Explicit design note + test: `reset` clears persisted prefixes; `check` output labeled provisional |
| 10. Green pglite hides real-Postgres bugs | pglite test infrastructure | Same suite run against both pglite and Docker Postgres 16 in CI; import-mode and migration-differ tests specifically |
| 11. pglite WASM/ESM loading breaks under vitest | pglite test infrastructure | Isolated one-file pglite prototype before wiring into existing test pattern |
| 12. pglite memory growth across test files | pglite test infrastructure | Shared-instance-plus-schema-namespacing decided before other phases add new Postgres-backed files |
| 13. pnpm/corepack/Node 22 CI drift | GitHub Actions / CI | `corepack enable` + `pnpm install --frozen-lockfile`; CI fails clearly on lockfile drift |
| 14. `sync-sigha.sh` accidentally run in CI | GitHub Actions / CI | Workflow review confirms only `install`/`typecheck`/`lint`/`test`/`build` run, never the sync script |
| 15. Bulk state machine loosened by persistence | Bulk API 2.0 persistence | Shared transition-guard function is the only writer of `state`; existing client-cannot-set-InProgress test ported to the persisted store |
| 16. Persisted job stuck at InProgress after restart | Bulk API 2.0 persistence | Simulated-restart test: `InProgress` job reconciled to `Failed` on boot |
| 17. Large CSV in a single Postgres row | Bulk API 2.0 persistence | Documented ceiling in code comments near the jobs table DDL; explicitly out of scope to fix streaming |
| 18. Thin baseline breaks jsforce `describe()` | Thin baselines | Real jsforce/simple-salesforce `describe()` call per new object, not just `build.test.ts` |
| 19. Read-only object accepts inserts | Thin baselines | Object-level DML restriction for `OpportunityHistory`-style objects; insert attempt fails the documented way |
| 20. Stale conformance numbers | Conformance re-run | Fresh dated run of both suites, README counts updated, sequenced last |
| 21. Newly-included Bulk tests fail for unrelated (v1) reasons | Conformance re-run | Each previously-excluded test classified v1-still-excluded vs v2-now-included before broadening the filter |

## Sources

- [Roll-Up Summary Field — Salesforce Help](https://help.salesforce.com/s/articleView?language=en_US&id=fields_about_roll_up_summary_fields.htm&type=0) (fetch blocked by site error page during this research; treat as MEDIUM confidence, corroborated by secondary sources below)
- [Salesforce Rollup Summary Field: 3 Limitations and Fixes — TractionComplete](https://tractioncomplete.com/articles/salesforce-rollup-summary-field-limitations/) — Master-Detail-only requirement, 40-field cap, single-level hierarchy visibility, COUNT/SUM/MIN/MAX-only operations
- [Understanding Relationship Fields and Polymorphic Fields — Salesforce Developers](https://developer.salesforce.com/docs/platform/salesforce-soql-sosl/guide/sforce-api-calls-soql-relationships-and-polymorph-keys.html) (fetch returned 403 during this research; TYPEOF syntax and `.Type` filtering corroborated via secondary source below)
- [Polymorphic Relationships in SOQL Queries: TYPEOF — Amit Salesforce](http://amitsalesforce.blogspot.com/2020/09/polymorphic-relationships-in-soql.html) — TYPEOF WHEN/THEN/ELSE syntax, unmatched-type ELSE fallback behavior, API version 46.0+ requirement, `WHERE <rel>.Type IN (...)` filtering pattern
- [Job States — Bulk API 2.0 and Bulk API Developer Guide](https://developer.salesforce.com/docs/atlas.en-us.api_asynch.meta/api_asynch/bulk_api_2_job_states.htm) (fetch returned 403 during this research; state machine corroborated via secondary source and directly against this repo's own already-correct implementation in `packages/api/src/routes/bulk.ts`)
- [electric-sql/pglite GitHub repository](https://github.com/electric-sql/pglite) — single-connection/single-user architecture
- [Announcing PGlite v0.4: connection multiplexing — Electric](https://electric.ax/blog/2026/03/25/announcing-pglite-v04) — confirms single-connection is the base architecture; v0.4 multiplexing is new and partial ("not all cases might be covered")
- [Missing pg_catalog.pg_tables and information_schema.tables — electric-sql/pglite#8](https://github.com/electric-sql/pglite/issues/8) — historical gap in system catalog completeness; current status not independently reconfirmed in this research, verify against pinned pglite version
- [PGlite Bundler Support docs](https://pglite.dev/docs/bundler-support) — `new URL(..., import.meta.url)` WASM loading pattern, `optimizeDeps.exclude` requirement for Vite-based bundlers
- [Issues Loading and Testing WebAssembly Modules in vitest — vitest-dev/vitest#4283](https://github.com/vitest-dev/vitest/discussions/4283) — community-reported ESM+WASM integration friction in vitest specifically
- [migration from SQLite to PGLite errors — activepieces/activepieces#10545](https://github.com/activepieces/activepieces/issues/10545) — third-party report of a `session_replication_role`-related error (`25P02`) under pglite; not an official pglite compatibility statement, verify directly against the pinned version
- [actions/setup-node — Corepack Support #531](https://github.com/actions/setup-node/issues/531) — corepack/setup-node interaction caveats
- [Creating PostgreSQL service containers — GitHub Docs](https://docs.github.com/actions/guides/creating-postgresql-service-containers) — `pg_isready` health check pattern for GitHub Actions Postgres service containers
- This repository's own source, read directly during this research: `packages/metadata/src/build.ts` (OwnerId `referenceTo = ["User", "Group"]`, `customKeyPrefix` alphabetical assignment), `packages/metadata/standard/objects/Group.json` (confirms Group is already modelled, `keyPrefix: "00G"`), `packages/metadata/src/types.ts` (`reparentable?: boolean`, `relationshipOrder` MasterDetail-only), `packages/soql/src/shape.ts` (`attributes(shape.type, ...)` fixed per compiled shape, not per row), `packages/soql/src/compile.ts` (TYPEOF unconditional `unsupported` throw, first-target join comment), `packages/api/src/bulk/jobs.ts` and `packages/api/src/routes/bulk.ts` (existing correct client-cannot-set-InProgress/JobComplete state machine), `package.json` (`packageManager: pnpm@12.6.0`, `engines.node >=22`), `scripts/sync-sigha.sh` (fresh external clone on every invocation)
- `.planning/codebase/CONCERNS.md`, `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/TESTING.md`, `.planning/PROJECT.md` (this project's own prior analysis, read as mandatory input per task instructions)

---
*Pitfalls research for: orglet milestone 1 (hardening) — roll-ups, TYPEOF, key-prefix persistence, Bulk API 2.0 persistence, pglite, GitHub Actions CI, thin baselines, conformance re-run*
*Researched: 2026-09-29*
