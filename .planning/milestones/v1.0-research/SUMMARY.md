# Project Research Summary

**Project:** orglet — Milestone 1 ("hardening")
**Domain:** Salesforce platform emulator — test infrastructure (Docker-free Postgres + CI),
polymorphic SOQL (`TYPEOF`), roll-up summary fields, standard-object baseline expansion,
Bulk API 2.0 persistence, stable key prefixes
**Researched:** 2026-09-29
**Confidence:** MEDIUM-HIGH (mixed — see per-area breakdown below; several Salesforce facts
rest on secondary sources because `developer.salesforce.com`/`help.salesforce.com` returned
HTTP 403 to automated fetches)

## Executive Summary

This is not greenfield research — it is six additions layered onto an existing, working
pnpm/TypeScript/Postgres monorepo, and all four researchers grounded their findings in direct
reads of this codebase's own source rather than generic advice. The consistent conclusion
across STACK, ARCHITECTURE, FEATURES and PITFALLS is that **every one of the six hardening
features fits inside an existing seam and needs no new package, ORM, or architectural
detour**: `@electric-sql/pglite` + `@electric-sql/pglite-socket` slot under the existing
`createPool()`/`ORGLET_DATABASE_URL` seam with zero source changes; `TYPEOF` is already parsed
by `@jetstreamapp/soql-parser-js` and only needs a compiler case; roll-ups need a new
`packages/engine/src/rollups.ts` module (no DB trigger, per the project's own "business rules
live in the app" decision); key prefixes and Bulk jobs both need a small persisted table in the
already-reserved-but-unused `_orglet` internal schema; and the 14 thin standard objects are
just JSON files the existing loader already picks up automatically.

The recommended approach is architecture-first, not feature-first: stand up the pglite test
seam and CI before touching any of the five feature areas, so that infrastructure risk
(WASM/ESM loading under vitest, `session_replication_role` compatibility, CI memory pressure)
surfaces against the known-good 119-test baseline rather than after new Postgres-backed tests
for roll-ups/TYPEOF/Bulk pile on top of it. From there, ARCHITECTURE.md recommends key-prefix
persistence and the 14 thin baselines as fast, self-contained, low-risk wins before the two
harder engine-pipeline changes (polymorphic/TYPEOF, then roll-ups), with Bulk API 2.0
persistence last as the most isolated feature. The milestone's own acceptance criteria (zero
`UNSUPPORTED` warnings on Johan's real Developer Edition retrieve, both conformance suites
green with updated numbers) make a final "conformance re-run" step a mandatory last phase, not
optional cleanup — PITFALLS.md names this explicitly as Pitfall 20, "believing the suites are
green because nobody re-ran them."

The key risks worth carrying into planning are: (1) roll-up recomputation has at least three
distinct correctness traps (reparent-both-parents, undelete, filter-field-only changes,
recursion/savepoint interaction) that are each individually easy to half-implement and ship
looking done; (2) polymorphic-field fixes are scattered across three independent call sites
(`soql/compile.ts`, `soql/shape.ts`, `formula/compile.ts`) that must converge on one shared
"resolve by key prefix" helper or the read path will disagree with the already-correct write
path; (3) pglite is real Postgres in WASM but is not risk-free — `session_replication_role`
(used by import mode) has an unresolved, only-partially-corroborated compatibility question
that STACK.md calls "works" on architectural grounds while PITFALLS.md flags as an open,
third-party-reported risk; and (4) several Salesforce facts this milestone depends on (roll-up
reparent/undelete recompute triggers, most of the 14 objects' key prefixes and name fields, the
exact `TYPEOF` AST shape from the SOQL parser) were not verified against a live, fetchable
official page and are flagged below as things to confirm at implementation time, not to treat
as settled.

## Key Findings

### Recommended Stack

*Source: `.planning/research/STACK.md`, confidence HIGH overall.* This file only covers
**additions** to the already-established stack (pnpm 12.6.0, TypeScript 5.9, Fastify 5.12.5,
`pg` 8.23.0, `@jetstreamapp/soql-parser-js` 8.1.0, vitest 3.2.7, Postgres 16). No existing
dependency changes.

**Core additions:**
- `@electric-sql/pglite@0.5.8` + `@electric-sql/pglite-socket@0.2.11` (exact peer-pinned pair) —
  embedded, real Postgres-in-WASM for Docker-free tests, exposed over the genuine Postgres wire
  protocol so the existing `createPool()` needs zero changes. Chosen explicitly over `pg-mem`
  (hand-rolled SQL engine, ~7 months stale, 206 open issues, real fidelity risk against exactly
  the features this codebase's tests exercise: `SAVEPOINT`, `session_replication_role`,
  `information_schema`-diff-driven `ALTER TABLE`).
- `actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6` for GitHub Actions —
  standard, current, low-risk choices; order matters (checkout → pnpm install → setup-node with
  `cache: pnpm`).
- **No new dependency needed** for Bulk API 2.0 persistence (plain `pg` + hand-written SQL,
  matching the codebase's existing zero-ORM convention) or for SOQL `TYPEOF` (the parser already
  supports it — `packages/soql/src/compile.ts:327` throws `unsupported` unconditionally on an
  AST node that already arrives correctly parsed; the gap is orglet's own compiler, not the
  library).

### Expected Features

*Source: `.planning/research/FEATURES.md`, confidence HIGH for `TYPEOF` grammar/restrictions,
roll-up metadata shape and Bulk API 2.0 job lifecycle (official PDF references); MEDIUM for
roll-up recalculation triggers and Bulk 2.0 retention; MEDIUM-LOW for the 14 objects' key
prefixes (no official published table exists).*

**Must have (table stakes — matches `PROJECT.md` Active requirements exactly):**
- Per-row polymorphic resolution fixed, then `TYPEOF ... WHEN ... THEN ... ELSE ... END`
  compiling correctly, plus `<relationship>.Type` filterable in `WHERE` (a separate SOQL
  grammar production from `TYPEOF` — easy to implement one and assume it covers the other)
- Roll-up summary fields (`Summary` type): metadata load, COUNT/SUM/MIN/MAX with filters,
  recompute on child insert/update/delete, correct read-only `describe()` shape
- Thin baselines for all 14 referenced-but-missing standard objects, each with **documented,
  object-specific** createable/updateable/deletable flags — 3 of the 14 are read-only via the
  standard API (`ExternalDataSource`, `OpportunityHistory`, `UserLicense` — a stronger claim
  than the milestone brief's own framing, which names only two of the three) and `CallCenter`
  is create-only
- Custom-object key prefixes persisted once, stable across reload/rename
- Bulk API 2.0 job state and result data persisted in Postgres, correct state machine, survives
  restart

**Explicitly anti-features (do not build, even though they'd look "more complete"):** `TYPEOF`
permitted in `WHERE`/`GROUP BY`/`HAVING`/semi-joins/nesting (real Salesforce rejects all of
these with `MALFORMED_QUERY`); `TYPEOF` in Bulk 2.0 query-job SOQL (separately, explicitly
unsupported there); roll-ups writable via `create()`/`update()`/Bulk; roll-ups on lookup (not
master-detail) relationships; full historical/audit field parity for the 14 thin objects; Bulk
API v1; a distributed/multi-process Bulk job store.

**Defer (v2+, out of this milestone's scope per `PROJECT.md`):** roll-up "force recalculation"
CLI helper, >25 roll-ups/object, Bulk API 2.0 true async/background processing, PK chunking,
full field parity for the 14 objects.

### Architecture Approach

*Source: `.planning/research/ARCHITECTURE.md`, confidence HIGH for component boundaries and
data flow (every claim grounded in a direct read of the actual source file), MEDIUM for exact
SFDX XML tag names and pglite runtime limits (verified against public docs/ecosystem, not a
running instance).* The core structural finding: `INTERNAL_SCHEMA = "_orglet"` is already
defined in `packages/schema/src/columns.ts` but never used anywhere — a clear "reserved for
future use" seam that both key-prefix persistence and Bulk job persistence should use (as two
independent tables, not a shared "ensure internal schema" utility, since the two features have
nothing else in common).

**Major components touched:**
1. `packages/soql/src/compile.ts` / `shape.ts` and `packages/engine/src/parents.ts` /
   `packages/formula/src/compile.ts` — three independent "pick the polymorphic candidate"
   call sites that must converge on one shared key-prefix-matching helper
2. `packages/engine/src/rollups.ts` (new) — `RollupRegistry`, `affectedParents()`, one batched
   aggregate `UPDATE` per roll-up field per affected-parent batch, called after each child
   mutation's after-hooks in `saveBatch`/`deleteBatch`/`undeleteBatch`
3. `packages/schema/src/keyPrefixes.ts` (new) — persists/reconciles real prefixes against
   `_orglet.key_prefixes`, called in `orglet up` between the Postgres connectivity check and
   bootstrap; `orglet check` (no-DB path) keeps reporting a labeled-provisional prefix
4. `packages/api/src/bulk/store.ts` (new) — two `_orglet` tables (`bulk_ingest_jobs`,
   `bulk_query_jobs`) replacing the in-memory `JobStore`, owned entirely inside
   `packages/api/src/bulk`
5. `packages/metadata/standard/objects/*.json` (14 new files) — no other package needs to
   change; `loadBaseline()` already picks up every file in that directory automatically

**Anti-patterns explicitly called out:** recomputing roll-ups via a Postgres trigger (violates
the project's own "business rules live in the app, not DB triggers" decision — triggers can't
participate in `PRIORVALUE`/`ISCHANGED` ordering or be skipped in import mode); creating a new
package for any of the six features (every one fits an existing package's stated
responsibility).

### Critical Pitfalls

*Source: `.planning/research/PITFALLS.md`, 21 pitfalls total, confidence MEDIUM-HIGH.* Top 5:

1. **Roll-up double-counting or stale totals on reparent** — recompute both the old *and* new
   parent on a changed foreign key, not just the new one; restrict roll-ups to `MasterDetail`
   relationships, matching Salesforce's own constraint.
2. **Roll-up not recalculated on undelete, or on a filter-field-only change** — wire
   recomputation into all four child mutation paths (`saveBatch` insert/update, `deleteBatch`,
   `undeleteBatch`), and derive the trigger set from the roll-up's aggregated field **and**
   every field in its filter clause, not just the aggregated field.
3. **Polymorphic fix applied to the SOQL join but not `attributes.type` (shape.ts) or the
   formula parent path (formula/compile.ts)** — three independent call sites encode "pick
   index 0" today; a partial fix (usually just the join, since that's the one with the visible
   error) leaves the other two silently wrong. Test all three against the same Group-owned
   fixture.
4. **Green pglite tests hiding real-Postgres regressions** — pglite is real Postgres source in
   WASM, not a reimplementation, but has its own compatibility surface
   (`session_replication_role`, `information_schema` completeness, single-connection
   concurrency). Keep a Docker Postgres 16 CI job running the *identical* suite alongside
   pglite, not pglite-only.
5. **Believing the conformance suites are green because nobody re-ran them** — both suites are
   manual, not CI-gated; the jsforce README predates Bulk API 2.0 entirely. Make the re-run an
   explicit, named, dated last task, not an assumption carried over from the pre-milestone
   baseline.

## Implications for Roadmap

Based on combined research, the suggested phase structure follows ARCHITECTURE.md's explicit
build order (Section "Build Order"), cross-checked against PITFALLS.md's per-pitfall "Phase to
address" mapping. **The two documents agree on the bookends** (infrastructure first, conformance
re-run last) and do not actually conflict on the middle ordering, but see "Where the Documents
Disagree" below for nuances a roadmapper should not smooth over.

### Phase 1: Test & CI infrastructure (pglite + GitHub Actions)
**Rationale:** ARCHITECTURE.md ranks this first because it touches zero feature-package source
(`metadata`/`schema`/`engine`/`soql`/`api`), only test infrastructure — it validates the
existing 119 tests against pglite while the codebase is still today's size, and unblocks
meaningful CI (a milestone acceptance criterion on its own) immediately. PITFALLS.md
independently confirms this ordering: Pitfall 12 says the pglite sharing/isolation strategy
must be decided "before other phases start adding new Postgres-backed test files," and Pitfall
10 requires the Docker-Postgres CI job to ship in the *same* phase as pglite, not deferred.
**Delivers:** `@electric-sql/pglite` + `-socket` wired via vitest `globalSetup`, zero changes to
any Postgres-backed test file or `packages/schema/src/db.ts`; GitHub Actions running lint,
typecheck, build and the full suite on every push/PR, against both pglite (fast, default) and
Docker Postgres 16 (belt-and-braces, catches WASM-specific divergence).
**Avoids:** Pitfalls 10 (green pglite hiding real-Postgres bugs), 11 (WASM/ESM loading under
vitest), 12 (memory growth across test files), 13 (pnpm/corepack/Node version drift passing
locally, failing in CI), 14 (accidentally invoking `scripts/sync-sigha.sh` in CI).

### Phase 2: Custom-object key-prefix persistence
**Rationale:** Self-contained (`packages/schema` + one `packages/cli` call site), and
foundational — every subsequent feature's tests create records, and unstable prefixes make
every other phase's tests harder to reason about while they're being written.
**Delivers:** `_orglet.key_prefixes` table; `reconcileKeyPrefixes()` called in `orglet up`
before bootstrap; `orglet check`'s existing alphabetical scheme kept as an explicitly-labeled
provisional guess (it has no DB access by design and must not silently claim to be authoritative).
**Addresses:** the "Custom-object key prefixes are persisted" Active requirement.
**Avoids:** Pitfall 8 (recompute-then-persist, which passes single-build tests but reintroduces
drift on the second build with a changed object set — needs an explicit two-build acceptance
test), Pitfall 9 (`reset`/`check` semantics left undefined — decide explicitly that reset clears
persisted prefixes since they live inside the org's own Postgres schema).

### Phase 3: Thin standard-object baselines (14 objects)
**Rationale:** ARCHITECTURE.md places this third for two reasons: it's the fastest, lowest-risk
feature (14 JSON files + two small `build.ts`/`types.ts` edits, no other package touched), and
it directly reduces Johan's Developer Edition warning count (14 of today's 15) — worth
validating early. See "Where the Documents Disagree" below regarding the second stated reason
(giving TYPEOF more real targets).
**Delivers:** 14 new `packages/metadata/standard/objects/*.json` files, each with correct
key prefix, name-equivalent field, and per-object createable/updateable/deletable flags (3
read-only, 1 create-only, 10 full CRUD — per FEATURES.md's per-object table); a `thin?: boolean`
marker on `StandardObjectJson` that defaults DML flags to `false` unless overridden.
**Addresses:** the "Thin baselines exist for the 14 standard objects" Active requirement; zero
remaining `UNSUPPORTED:reference-target` warnings.
**Avoids:** Pitfall 18 (baseline satisfies this project's own schema validation but breaks
jsforce/simple-salesforce's `describe()` contract on `nameField`/`keyPrefix`/`urls` — verify
with an actual SDK `describe()` call per object, not just `build.test.ts`), Pitfall 19
(read-only-in-reality objects like `OpportunityHistory` silently accepting inserts because the
default DML posture wasn't overridden).

### Phase 4: Per-row polymorphic lookups + SOQL `TYPEOF`
**Rationale:** The write path (`checkReferences()`) already resolves polymorphic targets
correctly per row; this phase brings the read path (SOQL joins, row shaping, formula parent
traversal) into agreement with it. Ordered after thin baselines per ARCHITECTURE.md, though see
the disagreement note below on how load-bearing that ordering actually is.
**Delivers:** a shared "resolve target by key prefix" helper (recommended home:
`packages/schema/src/ids.ts`, next to `keyPrefixOf`) used by `soql/compile.ts` (N candidate
joins + `COALESCE`/discriminator column), `soql/shape.ts` (per-row `attributes.type`),
`engine/parents.ts` (grouped `loadByIds` per candidate — flagged by ARCHITECTURE.md as
mattering *more* than the SOQL fix for runtime correctness), and `formula/compile.ts`
(field-existence search across all candidates); `TYPEOF` compiled as a real case reusing the
same primitive; `.Type` filterable in `WHERE`.
**Addresses:** "Polymorphic lookups resolve per row... TYPEOF is supported" Active requirement.
**Avoids:** Pitfall 5 (fixing only the join, not shape.ts or formula/compile.ts — test all three
against one Group-owned fixture), Pitfall 6 (implementing `TYPEOF` in `SELECT` but not
`<rel>.Type` in `WHERE`, treating them as one task when they're two independent grammar
productions), Pitfall 7 (assuming every `referenceTo` target always has a modelled backing
table — must degrade gracefully via `UNSUPPORTED:reference-target`, not throw).
**Research flag:** the exact `FieldTypeof` AST shape from `@jetstreamapp/soql-parser-js` needs
to be read from its `.d.ts` during implementation — ARCHITECTURE.md names this explicitly as
"the one sub-task likely to need its own short research pass." See Open Questions.

### Phase 5: Roll-up summary fields
**Rationale:** ARCHITECTURE.md places this after Phase 4 for a pedagogical reason (both touch
`engine`'s save pipeline and parent-loading code; the smaller Phase 4 change builds familiarity
with code roll-ups also need) and after Phase 1 because it needs the most new DB-backed test
cases of any of the six features (insert/update/delete/undelete/reparent/filter-change, each
needing real Postgres assertions).
**Delivers:** new `packages/engine/src/rollups.ts` (`RollupRegistry`, `affectedParents()`,
batched aggregate `UPDATE`); `packages/metadata/src/sfdx.ts` parses `<summarizedField>` etc.
instead of skipping `Summary` fields; second-pass resolution in `build.ts` sets the roll-up
field's real numeric/date type; roll-up fields default to `0` (not `NULL`) before any child
exists.
**Addresses:** the "Roll-up summary fields... are loaded from metadata, recomputed... and
readable" Active requirement.
**Avoids:** Pitfall 1 (reparent recomputes only the new parent, not the old — double-count/stale
total), Pitfall 2 (undelete or filter-field-only changes never trigger recompute), Pitfall 3
(unbounded multi-level recursion, or a recompute that escapes the triggering child's savepoint
and silently diverges from a partial-success batch's actual committed result), Pitfall 4
(roll-up fields accepted as writable instead of matching Salesforce's `createable: false`/
`updateable: false`).

### Phase 6: Bulk API 2.0 job persistence
**Rationale:** ARCHITECTURE.md places this last — it is the most isolated of the six features
(touches only `packages/api/src/bulk` and one `packages/cli` call site, no
`engine`/`soql`/`metadata` coupling beyond the already-precedented `ctx.engine.pool` direct-query
pattern), so it carries the least risk of blocking or being blocked by anything else, and none
of the milestone's headline acceptance criteria (DE zero-warnings, conformance green) depend on
it.
**Delivers:** `_orglet.bulk_ingest_jobs` / `_orglet.bulk_query_jobs` tables; `BulkStore`
replacing the in-memory `JobStore`; processing stays synchronous (explicitly acceptable per
milestone scope — no worker/queue); a boot-time reconciliation step that transitions any
persisted `InProgress` job to `Failed` (a crash-interrupted job, since nothing resumes mid-batch
processing on restart).
**Addresses:** "Bulk API 2.0 jobs are persisted in Postgres and survive a server restart."
**Avoids:** Pitfall 15 (persistence loosening the existing server-only state-transition
guarantee — keep one shared transition-guard function as the only writer of `state`), Pitfall 16
(jobs stuck at `InProgress` forever after a crash — worse than the pre-persistence honest 404),
Pitfall 17 (large CSV as a single Postgres column — explicitly scope out streaming, document the
TOAST ceiling instead of fixing it).

### Phase 7: Conformance re-run & milestone acceptance
**Rationale:** PITFALLS.md's Pitfall 20 states this explicitly: sequenced last "by definition —
it validates the sum of the milestone's changes." Not called out as its own numbered step in
ARCHITECTURE.md's Build Order, but required by `PROJECT.md`'s own Active requirements ("Both
conformance suites are re-run... and the numbers... are updated") and reinforced independently
by PITFALLS.md as a named phase.
**Delivers:** fresh, dated runs of both `conformance/jsforce` and `conformance/python` (`simple-
salesforce`) suites with updated pass/fail counts committed to their READMEs; Johan's Developer
Edition retrieve re-verified at zero `UNSUPPORTED` warnings (down from today's 15).
**Avoids:** Pitfall 20 (stale conformance numbers assumed still valid), Pitfall 21 (newly
un-excluded Bulk tests failing for reasons unrelated to this milestone's persistence work — e.g.
still-out-of-scope Bulk API v1 assumptions — classify each previously-excluded test explicitly
before broadening the Jest filter, rather than a blanket un-exclude followed by reactive
debugging).

### Where the Documents Disagree

Per the task's instruction to flag rather than smooth over disagreement, three tensions surfaced
while cross-checking ARCHITECTURE.md's build order against PITFALLS.md's phase mapping and the
other two documents:

1. **The stated reason for ordering "thin baselines" before "polymorphic/TYPEOF" is weaker than
   ARCHITECTURE.md claims, and its own example is inaccurate.** ARCHITECTURE.md's Build Order
   step 3 gives two reasons for building thin baselines before Feature 1; the second is "some
   existing `referenceTo` lists point at objects among these 14 or adjacent to them (e.g.
   `Group.RelatedId → User|UserRole`)." `UserRole` is not one of the 14 thin-baseline objects
   (`BusinessHours`, `BusinessProcess`, `CallCenter`, `DandBCompany`, `Entitlement`,
   `ExternalDataSource`, `IdeaTheme`, `Individual`, `OperatingHours`, `OpportunityHistory`,
   `ServiceAppointment`, `ServiceContract`, `SocialPost`, `UserLicense`) — it is "adjacent" but
   not actually in scope this milestone, and ARCHITECTURE.md's own example undercuts its
   argument. PITFALLS.md's Pitfall 7 states the opposite directly: "For *this* milestone, every
   polymorphic field's targets are already modelled" in the existing 21-object baseline (`User`,
   `Group`), and the fields that *would* reference the 14 (`Task.WhoId`/`WhatId`,
   `Event.WhoId`/`WhatId`) are explicitly out of scope per `PROJECT.md`. FEATURES.md's own
   dependency graph agrees: it marks the thin-baseline dependency as needed only "for
   WhatId/WhoId-style fields," i.e. the deferred ones. **Conclusion: build thin baselines before
   TYPEOF for the reasons that do hold up (fast, low-risk, reduces the DE warning count early) —
   not because TYPEOF's actual test fixtures need them. A roadmapper reordering these two phases
   would not break a real dependency.**

2. **`session_replication_role` under pglite: STACK.md says it "Works," PITFALLS.md says this is
   an open risk.** STACK.md's compatibility table marks `session_replication_role` (used only by
   import mode) as "Works" on architectural grounds ("Real Postgres GUC, not an extension; PGlite
   runs genuine Postgres backend code"). PITFALLS.md's Pitfall 10 treats the same question as
   unresolved: it cites a third-party bug report (a different project migrating SQLite→pglite
   data hit a `25P02` error) and explicitly instructs to "verify directly against the pinned
   pglite version before relying on import-mode tests passing under pglite as proof the feature
   works" (PITFALLS' own confidence tag: MEDIUM, third-party report, not an official
   compatibility matrix entry). **Conclusion: treat this as genuinely open, not settled by
   STACK.md's "Works" row — Phase 1 should include an explicit, early, isolated test of import
   mode's `SET LOCAL session_replication_role = replica` under the pinned `0.5.8` before trusting
   the rest of the pglite migration.**

3. **Minor granularity difference, not a contradiction: PITFALLS.md splits "pglite test
   infrastructure" and "GitHub Actions / CI" into two named phases (Pitfalls 10-12 vs. 13-14),
   while ARCHITECTURE.md folds CI standup into the tail of its pglite step** ("do that right
   after this step, not at the end"). Neither document assigns these two an explicit relative
   order beyond "early." This summary treats them as one Phase 1 (see above); a roadmapper who
   prefers a cleaner phase-per-concern split could equally split it into two without contradicting
   either source.

Separately, note that **PITFALLS.md's own top-to-bottom document ordering** (roll-up pitfalls
appear before TYPEOF pitfalls, which appear before key-prefix pitfalls, which appear before
pglite/CI pitfalls) is *not* a proposed build order — PITFALLS.md never claims this, and it does
not match ARCHITECTURE.md's explicit Build Order. Do not read section order in PITFALLS.md as
sequencing guidance; only its per-pitfall "Phase to address" column and the two explicit
sequencing statements (pglite before other DB-test-adding phases; conformance last) carry
ordering weight.

### Research Flags

Phases likely needing a short, targeted research pass during planning (per the Open Questions
below, several researchers flagged these as "verify at implementation time," not "known"):
- **Phase 4 (polymorphic/TYPEOF):** the exact `FieldTypeof` AST shape from
  `@jetstreamapp/soql-parser-js` needs reading from its `.d.ts` — ARCHITECTURE.md names this
  explicitly as needing its own short research pass. Also confirm the parser's AST coverage for
  `WHERE <rel>.Type = '...'` independently of `TYPEOF` (PITFALLS Pitfall 6, Integration Gotchas).
- **Phase 1 (pglite):** confirm `session_replication_role` behavior against the pinned
  `pglite@0.5.8` before trusting import-mode tests (see disagreement #2 above).
- **Phase 3 (thin baselines):** per-object key prefix and name-equivalent field for
  `DandBCompany`, `Entitlement`, `ServiceContract`, `SocialPost` (not confirmed in FEATURES.md's
  research pass) and especially `IdeaTheme` (single-source prefix, LOW confidence) — confirm
  against the Object Reference PDF before writing the JSON baseline files.
- **Phase 5 (roll-ups):** reparent and undelete recompute triggers are logically implied by
  Salesforce's documented behavior but not confirmed by a direct official quote (FEATURES.md
  Gaps; `help.salesforce.com` article `000391766` is the specific page to chase). PITFALLS.md
  treats both as hard requirements regardless (Pitfalls 1-2), since `PROJECT.md`'s own
  requirement text names them explicitly — the gap is sourcing, not scope.

Phases with standard, well-documented patterns (research-phase likely unnecessary):
- **Phase 2 (key-prefix persistence):** a straightforward persisted-table pattern; the risk is
  implementation discipline (two-build test), not missing information.
- **Phase 6 (Bulk persistence):** the job state machine is already correctly implemented
  in-memory and fully documented in the official Bulk API 2.0 PDF (HIGH confidence); this is a
  storage-migration task, not a research task.
- **Phase 7 (conformance re-run):** mechanical — run the existing suites, update the existing
  README tables.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions and compatibility verified directly against npm registry and GitHub API metadata (`pushed_at`, release tags) at research time; the one MEDIUM sub-item is a stylistic choice (`pnpm/action-setup` vs. the newer `pnpm/setup`), not a factual uncertainty. |
| Features | MIXED (HIGH for grammar/metadata shape, MEDIUM for recalculation timing and Bulk retention, MEDIUM-LOW for the 14 objects' key prefixes) | Official Salesforce PDF exports were used successfully as a workaround for `developer.salesforce.com`/`help.salesforce.com` returning 403 to automated fetches, which grounds the TYPEOF grammar and roll-up metadata shape claims in primary sources. Key prefixes have no official published table at all — every prefix is cross-verified across 2-3 community sources except `IdeaTheme` (1 source, explicitly flagged LOW). |
| Architecture | HIGH for component boundaries/data flow (every claim verified by directly reading the named source file in this repo); MEDIUM for exact SFDX `CustomField` roll-up XML tag names (single external source) and pglite runtime limits (public docs/ecosystem, not a running instance in this repo). |
| Pitfalls | MEDIUM-HIGH | Salesforce platform-behavior pitfalls anchored to official PDF/doc sources where fetchable; several pglite-specific pitfalls (Pitfalls 10-12) rest on third-party GitHub issue reports and blog post-mortems rather than an official pglite compatibility matrix — explicitly flagged MEDIUM or LOW-MEDIUM per pitfall, not overstated as settled. |

**Overall confidence:** MEDIUM-HIGH. The architectural plan (where code lives, what changes,
build order) is on solid ground — grounded in direct reads of this specific codebase. The
domain facts with the most residual uncertainty are narrow and well-isolated: a handful of
standard-object key prefixes/name fields, roll-up reparent/undelete recompute triggers, and one
pglite compatibility question — all individually small to verify and none blocking the overall
phase structure.

### Gaps to Address

The following open questions were explicitly flagged by the researchers as needing resolution
at implementation time, not before roadmap creation:

- **`soql-parser-js` `FieldTypeof` AST shape:** confirmed the library parses `TYPEOF` (has since
  v3.2.0, per its changelog), but the exact AST node shape orglet's compiler needs to switch on
  was not read from the `.d.ts` during this research pass. ARCHITECTURE.md names this as the one
  sub-task in the entire milestone likely to need its own short research pass during Phase 4
  planning. Separately, confirm parser AST coverage for `WHERE <rel>.Type = '...'` independently
  — it's a different grammar production that happens to serve the same feature.
- **pglite and `session_replication_role`:** STACK.md's compatibility table asserts this works
  (architectural reasoning: it's a real Postgres GUC, not an extension). PITFALLS.md treats it
  as an open, only third-party-corroborated risk (a `25P02` error reported in an unrelated
  project's SQLite→pglite migration). Resolve early in Phase 1 with a direct, isolated test
  against the pinned `pglite@0.5.8` before trusting any import-mode test that passes under
  pglite as proof the feature genuinely works — see disagreement #2 above.
- **Key prefixes and name-equivalent fields for the 14 thin standard objects:** no official
  Salesforce page publishes a canonical key-prefix table (the "Entity Key Prefix Decoder" is an
  interactive one-at-a-time tool, not a static list). Every prefix in FEATURES.md's per-object
  table is cross-verified across 2-3 independent community sources except `IdeaTheme`
  (single source, explicitly LOW confidence — verify before hardcoding). Name-equivalent fields
  for `DandBCompany`, `Entitlement`, `ServiceContract`, and `SocialPost` were not independently
  confirmed in this research pass at all (the PDF section extraction landed mid-alphabet).
  Getting a name/`idLookup` field wrong is a likely source of `INVALID_FIELD` surprises when
  Johan's real DE retrieve is re-checked — confirm against the Object Reference PDF before
  writing the 14 JSON files in Phase 3.
- **Roll-up recalculation on reparent and undelete:** create/update/delete recompute triggers
  are well corroborated (official Trailhead module + multiple independent sources: recompute
  happens "in the background during save execution"). Reparenting (when "Allow reparenting" is
  enabled) and undelete were not confirmed by a direct official quote in this research pass —
  FEATURES.md flags MEDIUM/LOW confidence and names `help.salesforce.com` article `000391766`
  as the specific page to validate against. This does not change scope: `PROJECT.md`'s own
  requirement text names both triggers explicitly, and PITFALLS.md's Pitfalls 1-2 treat them as
  mandatory regardless of citation strength — the gap is sourcing for the exact edge-case
  mechanics (e.g. does a filter-field-only change on an unrelated field also need to trigger
  recompute in every documented case), not whether to build the feature.

Other, lower-priority gaps worth a one-line note during planning rather than a dedicated
research pass:
- Roll-up stored-value rounding/scale behavior (full floating-point precision vs. 2-decimal
  display rounding) — MEDIUM confidence, community-sourced only.
- Bulk API 2.0's ~7-day job/result retention window — confirmed verbatim for Bulk API v1 only;
  the Bulk-2.0-specific doc page returned 403, so the 7-day figure for v2 rests on secondary
  corroboration. Not necessarily worth enforcing deletion in a local dev/CI tool either way —
  worth documenting as a deliberate divergence if orglet keeps jobs indefinitely.
- pglite's `information_schema`/`pg_catalog` completeness relative to real Postgres 16 — a 2024
  GitHub issue flagged gaps; current status not reconfirmed against the pinned version in this
  pass. Directly relevant to `packages/schema/src/migrate.ts`'s diff-based migrator.
- Whether this codebase's schema model supports **object-level** (not just field-level)
  createable/updateable/deletable restriction — needed to correctly reject inserts into
  `OpportunityHistory`-style read-only objects (Pitfall 19); ARCHITECTURE.md doesn't confirm
  this exists today and flags it as "a scope question worth raising explicitly."

## Sources

### Primary (HIGH confidence)
- Official Salesforce PDF exports (`resources.docs.salesforce.com/.../pdf/*.pdf`): SOQL and
  SOSL Reference v68.0, Bulk API 2.0 and Bulk API Developer Guide, Metadata API Developer Guide,
  Object Reference for the Salesforce Platform, REST API Developer Guide — used as a workaround
  for `developer.salesforce.com`/`help.salesforce.com` returning HTTP 403 to automated fetches
- npm registry metadata and GitHub REST API (`pushed_at`, release tags) for every package
  version cited in STACK.md
- Direct reads of this repository's own source (all four research files): `packages/schema/
  src/db.ts`, `ids.ts`, `columns.ts`, `migrate.ts`, `packages/engine/src/engine.ts`, `parents.
  ts`, `packages/soql/src/compile.ts`, `shape.ts`, `packages/formula/src/compile.ts`,
  `packages/metadata/src/build.ts`, `sfdx.ts`, `types.ts`, `packages/api/src/bulk/jobs.ts`,
  `routes/bulk.ts`, `package.json`, `scripts/sync-sigha.sh`
- `github.com/electric-sql/pglite` and `pglite-socket` READMEs (fetched raw)
- `github.com/jetstreamapp/soql-parser-js` CHANGELOG.md (fetched raw)

### Secondary (MEDIUM confidence)
- Community-maintained Salesforce key-prefix lists (gist, fishofprey.com, automationchampion.
  com, aegissoftworks.com) — cross-verified across 2-3 sources per object except `IdeaTheme`
- Trailhead "Optimize Roll-Up Summary Fields," `sfdcfanboy.com` rounding write-up, Salesforce
  Help article `000391766` (referenced, not directly fetchable) — roll-up recalculation timing
  and rounding behavior
- Third-party GitHub issue reports: `electric-sql/pglite#8` (`information_schema` gaps),
  `activepieces/activepieces#10545` (`session_replication_role` `25P02` error),
  `vitest-dev/vitest#4283` (WASM/ESM loading friction), `actions/setup-node#531`
  (corepack/setup-node interaction)
- `pnpm.io/continuous-integration` (official but newest-recommendation-not-most-battle-tested)
- `oguimbal/pg-mem` repo page/README — used only to justify *not* using it

### Tertiary (LOW confidence, flagged for validation)
- `IdeaTheme` key prefix (`0Bg`) — single source (fishofprey.com) only
- `DandBCompany`/`Entitlement`/`ServiceContract`/`SocialPost` name-equivalent fields — not
  independently confirmed in this research pass at all
- pglite memory-growth-under-CI claims — individual project post-mortems, not an official
  resource-usage benchmark

---
*Research completed: 2026-09-29*
*Ready for roadmap: yes*
