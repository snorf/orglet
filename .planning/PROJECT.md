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
- ✓ Bulk API 2.0 ingest and query jobs (in-memory, synchronous) — existing
  (`packages/api/src/bulk`, `packages/api/src/routes/bulk.ts`)
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

### Active

Milestone 1, "hardening": make a real Developer Edition retrieve load with zero warnings, make
the project buildable and testable without Docker, and put it on GitHub with CI. No GUI, no
Flows, no Apex in this milestone.

- [ ] Polymorphic lookups (`OwnerId`, `WhoId`, `WhatId` style) resolve per row instead of to the
  first defined target, and SOQL `TYPEOF ... WHEN ... THEN ... ELSE ... END` is supported in
  `SELECT`
- [ ] Roll-up summary fields (`Summary` type: COUNT, SUM, MIN, MAX with filters) are loaded from
  metadata, recomputed in the save pipeline on child insert/update/delete/undelete, and readable
  via REST and SOQL
- [ ] Thin baselines exist for the 14 standard objects a Developer Edition references but the
  baseline lacks (BusinessHours, BusinessProcess, CallCenter, DandBCompany, Entitlement,
  ExternalDataSource, IdeaTheme, Individual, OperatingHours, OpportunityHistory,
  ServiceAppointment, ServiceContract, SocialPost, UserLicense) so lookups to them are checked
- [ ] Custom-object key prefixes are persisted, so adding or renaming a custom object never
  changes the prefix (and therefore the Ids) of existing objects
- [ ] Bulk API 2.0 jobs are persisted in Postgres and survive a server restart
- [ ] Johan's Developer Edition retrieve loads with zero `UNSUPPORTED` warnings (today: 15)
- [ ] Both conformance suites are re-run after the changes, stay green, and the numbers in
  `conformance/` are updated (the jsforce README predates Bulk API 2.0)

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

**Codebase.** pnpm monorepo, TypeScript strict, Node 22, ESM. Layered packages
`metadata → schema → {formula, soql} → engine → api → cli`, plus the vendored `sigha` formula
engine synced by `scripts/sync-sigha.sh` and never hand-edited. 17 commits before GSD, 119 unit
tests in 12 files (vitest), five of them Postgres-backed using one random `test_<hex>` schema per
file. Full map in `.planning/codebase/` (STACK, INTEGRATIONS, ARCHITECTURE, STRUCTURE,
CONVENTIONS, TESTING, CONCERNS).

**Known gaps found by the codebase map** (`.planning/codebase/CONCERNS.md`):
- Polymorphic targets resolve to the first defined target in
  `packages/soql/src/compile.ts` and `packages/formula/src/compile.ts`
- `Summary`, `ExternalLookup`, `IndirectLookup`, `MetadataRelationship` field types are skipped
  at load in `packages/metadata/src/sfdx.ts`
- Custom-object key prefixes are recomputed by alphabetical index on every schema build in
  `packages/metadata/src/build.ts` with no persistence
- ID counter is process-local and unsynchronised (`packages/schema/src/ids.ts`)
- `/composite` with `allOrNone` does not roll back earlier committed subrequests
  (`packages/api/src/routes/composite.ts`)
- Bulk jobs are in-memory and synchronous; session tokens are in-memory and unbounded
- Default auth is permissive (any password); `sharingModel` is parsed but unused
- Formula evaluation is per row after fetch, child relationships compile to correlated subqueries
- No `.github`, no CI config, tests need Docker Postgres on port 5433

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
| Milestone 1 = hardening only (TYPEOF, roll-ups, thin baselines, key-prefix persistence, Bulk persistence, pglite, GitHub + CI) | Small milestone that makes a real DE org load clean and makes the project public and CI-tested before the GUI | — Pending |
| Persist custom-object key prefixes | Alphabetical recomputation shifts prefixes when objects are added; Ids must be stable | — Pending |
| pglite for tests, Docker Compose for the running server | CI without Docker, contributors without Docker; server path unchanged | ✓ Good (Phase 1; needed `maxConnections` on pglite-socket and build-before-lint in CI) |
| Phase branches with PR to a ruleset-protected `main` | Branch protection only means something if every change goes through CI | ✓ Good (Phase 1) |

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
*Last updated: 2026-10-01 after Phase 1*
