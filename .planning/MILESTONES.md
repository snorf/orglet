# Milestones

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
