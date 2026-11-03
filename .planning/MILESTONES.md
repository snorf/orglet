# Milestones

## v1.1 real-org fidelity (Shipped: 2026-11-01)

**Delivered:** A large, real enterprise-org retrieve loads with every remaining warning inside a documented
exclusion category, a public enterprise-shaped fixture loads clean in CI, and a populated v1.0 database
upgrades to the new generated baseline without data loss.

**Phases completed:** 7 phases (8-14), 62 plans, 139 tasks
**Timeline:** 2026-10-12 → 2026-11-01 (20 days), 300 commits, PRs #11–#17 all merged with green CI
**Code:** 607 files changed (+145 908 / −4 082, mostly generated baseline JSON and fixtures); ~10 900 lines of
TypeScript in `packages/*/src` (excl. vendored sigha and tests) plus ~2 100 in `scripts/`; 922 tests in 55
files on pglite, 924 on Postgres 16

**Key accomplishments:**

1. Upgrade safety net: a populated v1.0 database upgrades to the new baseline with no data loss on pglite and
   Postgres 16; a foreign key that rows would violate is skipped with `UNSUPPORTED:schema-fk`; a second
   `orglet up` is silent; standard objects may carry a `null` key prefix; structured diagnostics exist beside
   the unchanged warning strings (Phase 8).
2. The standard-object baseline is generator output (`scripts/gen-baseline`, CI drift gate): the 35 v1.0
   objects grew from 659 to 2 536 fields with v1.0 fields byte-identical, 135 feature-gated fields tagged, a
   MasterDetail refusal and v1-vs-v2 diff gate, per-object `ownerTargets` so plain `Owner.X` compiles; 18
   business objects (Quote, Order, OrderItem, ContentVersion, ...) with DE-confirmed prefixes and documented
   DML flags; `orglet check` separates referenced from unreferenced unmodelled objects (Phases 9-10).
3. Custom metadata types load as read-only `__mdt` objects with their `customMetadata/` records seeded under
   hash-derived stable Ids, `MetadataRelationship` fields load, List/Hierarchy custom settings and custom
   labels load; new `conformance/cmdt-check` legs on both SDKs (Phase 11).
4. The vendored sigha is resynced to a pinned fork commit that lexes unary `!` and `Relationship:Object.Field`;
   `Owner:User.Email` evaluates against the typed target; new globals `$UserRole`, `$Api`, `$Label`,
   `$CustomMetadata` and hierarchy `$Setup`; every compiled formula carries a dependency list (Phase 12).
5. Roll-ups over same-object, non-volatile formula fields: Salesforce's admission rules enforced by
   `admitFormulaRollups`, recompute over TypeScript-evaluated child values bound as an `unnest` derived table,
   crash-safe one-time backfill behind `_orglet.rollup_backfills` (Phase 13).
6. `orglet check` is a report: census, verdict, per-area table and root-cause groups, `--summary` redacted to
   counts, `--json` for tooling; the public fixture `examples/enterprise` (63 objects, 3 742 fields) passes
   `check --strict` and 11/11 conformance legs in CI beside acme 10/10; the author's DE retrieve: exit 0,
   0 warnings; the large real-org retrieve: 94 warnings, all counted exclusions (Phase 14).

**Known gaps (accepted as tech debt, see `milestones/v1.1-MILESTONE-AUDIT.md`):**

- Upstream sigha PRs (`feat/unary-bang`, `feat/polymorphic-colon-ref`) are pushed to `snorf/sigha` but not
  opened; orglet is pinned to the fork's `integration/phase-12`; re-pin is a quick task once they merge.
- ACC2-03 met with counted exclusions rather than literal zero: 94 warnings on the large retrieve (platform
  events, `$Permission`, unretrieved managed package, custom-metadata records of unretrieved types, incomplete
  retrieve, accepted standard fields).
- ContentVersion.ContentDocumentId nullable by override until file upload is done properly (999.10); formula
  fields through parent relationships in SOQL unsupported (999.12); `$Permission` and List `$Setup` stay
  `UNSUPPORTED:formula-global`.
- Formula roll-up recompute is O(children of affected parents) with no cap; the backfill reads all live child
  rows into memory.
- Bookkeeping: 08-VERIFICATION.md left at `human_needed`, 11-VALIDATION.md never refreshed after execution;
  41 pre-existing tsc errors in test files outside the CI gate; CI job `conformance` still not a required
  check on `main`.

**Archive:** `milestones/v1.1-ROADMAP.md`, `milestones/v1.1-REQUIREMENTS.md`, `milestones/v1.1-MILESTONE-AUDIT.md`

---

## v1.0 hardening (Shipped: 2026-10-12)

**Delivered:** A real Developer Edition retrieve loads with zero `UNSUPPORTED` warnings, the project
builds and tests without Docker, and it lives on GitHub with CI that also runs both SDK conformance
suites.

**Phases completed:** 7 phases, 37 plans, 125 tasks
**Timeline:** 2026-09-29 → 2026-10-12 (14 days), 211 commits, PRs #1–#7 all merged with green CI
**Code:** 233 files changed (+30 868 / −784); ~14 600 lines of TypeScript in `packages/*/src` (excl. vendored sigha); 427 tests in 25 files

**Key accomplishments:**

1. The full test suite runs Docker-free on embedded pglite (one instance per file via `test/db.ts`); the
   public repo `snorf/orglet` has CI jobs `test-pglite` and `test-postgres` and a ruleset on `main`
   requiring both (Phase 1).
2. Custom-object key prefixes are assigned once and persisted in `_orglet.key_prefixes`; adding,
   removing or renaming objects never shifts the meaning of existing Ids; `--key-prefixes` seeds real
   org values; `orglet reset` keeps them unless `--drop-prefixes` (Phase 2).
3. Fourteen thin standard objects (BusinessHours … UserLicense) exist as baselines with documented
   prefixes, name fields and DML flags; lookups to them are reference-checked and flag violations return
   `INVALID_TYPE_FOR_OPERATION` (Phase 3).
4. Polymorphic lookups resolve per row by key prefix through one shared rule used by the write path,
   formula parent loading and SOQL per-target joins; `TYPEOF … END` compiles; an unmodelled prefix is a
   `null` parent plus one `UNSUPPORTED:reference-target` warning (Phase 4).
5. Roll-up summary fields load as typed read-only columns, recompute in the app-side save pipeline on
   insert/update/reparent/delete/undelete through multi-level chains with savepoint attribution, and are
   backfilled once by `migrate()` (Phase 5).
6. Bulk API 2.0 jobs, uploaded CSV and results persist in `_orglet.bulk_*` and survive a restart; each
   chunk's DML and results commit atomically through the new `DmlEngine.transaction` seam; boot
   reconciliation and 7-day retention are deterministic (Phase 6).
7. Acceptance is measured and dated: `orglet check --strict` on the DE retrieve exits 0 with 0 warnings
   (`37 objects (2 custom), 983 fields`; baseline 15 warnings on 2026-09-29); jsforce e2e 51/0/60 +
   Bulk 2.0 12/0/5 with every exclusion classified; simple-salesforce 29/29; `conformance/run-all.sh`
   runs all eight legs in a new CI job `conformance` (Phase 7).

**Known gaps (accepted as tech debt, see `milestones/v1.0-MILESTONE-AUDIT.md`):**

- POLY-01 partial: the formula leg of polymorphic references (`Owner:Group.Name`) raises
  `UNSUPPORTED:formula` because the vendored sigha lexer rejects `:` (decision D-16; upstream fix).
- No combined test for Bulk 2.0 ingest of child rows recomputing parent roll-ups (code path shared).
- Roll-up re-backfill on definition change deferred (`orglet rollup --recompute`); date-literal roll-up
  filters unsupported; OwnerId stays `[User, Group]` on every owned object.
- Empty Bulk upload marks the job `Failed` (Salesforce behaviour undocumented); Data.com `Jigsaw*`
  fields absent from the Account baseline.
- CI job `conformance` is not yet a required check on `main`.

**Archive:** `milestones/v1.0-ROADMAP.md`, `milestones/v1.0-REQUIREMENTS.md`, `milestones/v1.0-MILESTONE-AUDIT.md`

---
