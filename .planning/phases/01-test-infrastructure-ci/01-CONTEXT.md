# Phase 1: Test Infrastructure & CI - Context

**Gathered:** 2026-09-29
**Status:** Ready for planning

<domain>
## Phase Boundary

`pnpm test` runs the full unit and integration suite without Docker by starting an embedded
pglite and pointing the existing `pg` pool at it. The one open compatibility question
(`session_replication_role` and `information_schema` under the pinned pglite) is settled early
by a dedicated test. The project goes live in a public GitHub repository with two GitHub
Actions jobs (pglite, Postgres 16 service container) running lint, typecheck and the full
suite. `orglet up` and Docker Compose keep using real Postgres. Requirements INFRA-01..07.

Not in this phase: conformance suites in CI, any feature work, any change to what the
running server does.

</domain>

<decisions>
## Implementation Decisions

### GitHub repository
- **D-01:** Repository is `snorf/orglet` under Johan's personal GitHub account (`gh` is
  already authenticated as `snorf`). Re-verify the name is free at creation time.
- **D-02:** Public from the first push. Rationale: INFRA-04, free Actions minutes, history is
  already clean with the repo-local identity, LICENSE and non-affiliation notice exist.
- **D-03:** Push the full history as is, including `.planning/`. The secret scan of the
  planning docs was clean; DE-org warnings in them are Level 1 data.
- **D-04:** Set repository description from `package.json` and topics `salesforce`,
  `emulator`, `postgres`, `typescript`, `soql`, `localstack`.
- **D-05:** Add a GitHub Actions status badge at the top of `README.md`.
- **D-06:** Enable branch protection on `main` requiring green CI status checks before merge.
- **D-07:** Because of D-06, GSD switches to phase branching: `git.branching_strategy` is set
  to `phase` in `.planning/config.json` (template `gsd/phase-{phase}-{slug}`), each phase is
  merged to `main` via a pull request once verified. Phase 1 itself is the first phase to run
  on a branch. The branch protection is created after the first push (the repo must exist and
  CI must have run once so the status check name is known).
- **D-08:** Repository creation and the first push are outward-facing actions: the executor
  stops and confirms with Johan immediately before running them, even though the name and
  visibility are decided here.

### Test backend selection
- **D-09:** Env-var auto-detect. If `ORGLET_DATABASE_URL` is set, tests run against that
  Postgres. If it is not set, the test bootstrap starts pglite and points the pool at it.
- **D-10:** The current default of `postgres://orglet:orglet@localhost:5433/orglet` in
  `databaseUrlFromEnv()` moves to the server path (`orglet up`, CLI) and no longer applies
  to tests. Tests never silently reach for a Docker Postgres.
- **D-11:** CI's Postgres job selects the real backend simply by setting
  `ORGLET_DATABASE_URL` to the service container; no other switch.
- **D-12:** pglite runs in memory. Every test run starts empty. The existing
  one-random-schema-per-file pattern (`test_<hex>`) is kept as is to keep the diff to the
  five DB-backed test files minimal.
- **D-13:** `README.md` Development section is rewritten so Docker is optional: Node 22 and
  pnpm are required; Docker is needed only to run the server (`orglet up`) or to test against
  real Postgres.

### CI triggers and scope
- **D-14:** Workflow triggers on push to any branch and on pull requests targeting `main`.
- **D-15:** Node 22 only, matching `.nvmrc` and `engines`.
- **D-16:** Two jobs: `test-pglite` (no services) and `test-postgres` (Postgres 16 service
  container, `ORGLET_DATABASE_URL` set). Both run `pnpm install --frozen-lockfile`,
  `pnpm build` (`tsc -b`), `pnpm lint`, `pnpm test`. Build runs before lint because package
  `exports` resolve cross-package types from `dist/index.d.ts`, which does not exist on a
  fresh checkout; verified by CI run 36831399404 (2026-10-01).
- **D-17:** Conformance suites (jsforce, simple-salesforce) are not run in CI in this phase.
  Deferred to phase 7 or a later manual `workflow_dispatch`.
- **D-18:** `scripts/sync-sigha.sh` is never invoked by CI (INFRA-07). The vendored copy in
  `packages/sigha` is what gets built and tested.

### Import-mode fallback (session_replication_role on pglite)
- **D-19:** A dedicated early test exercises `SET LOCAL session_replication_role = replica`
  and the `information_schema` queries `migrate.ts` relies on, against pglite. Its outcome
  (pass or fail, with date) is recorded in `.planning/codebase/TESTING.md`.
- **D-20:** If it fails on pglite, the affected import-mode tests are tagged to run only on
  real Postgres. The mechanism is a runtime skip with a reason string (the test file still
  runs, calls skip when the backend is pglite, and the reason appears in the report). No
  separate file glob. Production code is not changed to work around pglite.
- **D-21:** The pglite-vs-Postgres detection used for the skip is the same signal as D-09
  (`ORGLET_DATABASE_URL` set or not), exposed through one small test helper, not re-derived
  per file.

### Claude's Discretion
- Whether pglite runs as one shared instance via vitest `globalSetup` or one instance per
  test file. Research disagrees (STACK.md: per file, because vitest runs files in parallel
  workers and pglite is single-connection; ARCHITECTURE.md: shared via globalSetup). Decide
  by what actually works with vitest's worker model; prefer per file if a shared instance
  serialises or flakes.
- Exact shape and location of the test bootstrap helper (research suggests a ~20-line local
  helper over any third-party wrapper such as `pglite-pool`).
- Action pinning style (major tag vs SHA), workflow file name, job names, pnpm cache setup.
- Exact wording of the README Development section and badge placement.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` — Phase 1 goal and the five success criteria
- `.planning/REQUIREMENTS.md` — INFRA-01..INFRA-07, the acceptance statements this phase closes
- `.planning/PROJECT.md` — Constraints (identity, outward-facing actions, licensing, no
  behaviour-diffing), working conventions

### Research for this phase
- `.planning/research/STACK.md` — pglite 0.5.8 + pglite-socket 0.2.11 (exact peer pin),
  action versions (checkout@v7, setup-node@v7, pnpm/action-setup@v6), compatibility table
  for the SQL features this codebase uses, what NOT to use (pg-mem, pglite-pg-adapter,
  SQLite), per-file vs shared instance discussion
- `.planning/research/ARCHITECTURE.md` §"Feature 5" / build-order step 1 — the existing DB
  seam, globalSetup proposal, why this phase goes first
- `.planning/research/PITFALLS.md` — pitfalls 10..12 (pglite: session_replication_role,
  information_schema gaps, green-pglite-hides-Postgres-regressions) and 13..14 (GitHub
  Actions: pnpm/corepack on Node 22, lockfile drift, sync-sigha in CI, rewritten history)
- `.planning/research/SUMMARY.md` — flagged disagreement on session_replication_role

### Existing code this phase changes
- `packages/schema/src/db.ts` — `createPool`, `databaseUrlFromEnv` (the single seam; D-10
  changes where the default lives)
- `vitest.config.ts` — the only vitest config; gains the pglite bootstrap
- `packages/schema/src/migrate.test.ts`, `packages/engine/src/engine.test.ts`,
  `packages/engine/src/query.test.ts`, `packages/api/src/api.test.ts`,
  `packages/api/src/bulk.test.ts` — the five DB-backed test files, all using the same
  `beforeAll` pattern
- `packages/engine/src/engine.ts` (around line 215) — the `SET LOCAL session_replication_role`
  call under test in D-19
- `.planning/codebase/TESTING.md` — record the D-19 outcome here
- `README.md` — Development section (D-13), badge (D-05)
- `.planning/config.json` — `git.branching_strategy` (D-07)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `createPool(connectionString)` and `databaseUrlFromEnv()` in `packages/schema/src/db.ts`
  are the only place a `pg.Pool` is constructed. Pointing tests at pglite is a connection
  string change, not a driver change.
- Every DB-backed test file already isolates itself with `test_<hex>` schema in `beforeAll`
  and drops it in `afterAll`; the same block is where the pool is created, so the pglite
  switch is confined to that block.
- `pg.types.setTypeParser` calls in `db.ts` run once at import and apply to any Postgres
  wire connection, including pglite via pglite-socket.

### Established Patterns
- No per-package vitest config; everything is in the root `vitest.config.ts` with
  `@orglet/*` aliases to `src/index.ts`, so tests run without a build.
- `testTimeout: 30_000`, `hookTimeout: 60_000` exist because Docker migrations are slow;
  pglite startup per file is faster, timeouts can stay.
- No Prettier, ESLint flat config with type-checked rules; new test helper files must pass
  `pnpm lint` (they are inside `packages/*/src` or a new root path that lint covers).
- Commit style from git log: imperative, capitalised, no scope prefix, English.
- `.gitignore` already ignores `.orglet/`, `coverage/`, `.env*`; nothing else needed for
  pglite in-memory.

### Integration Points
- CI needs `pnpm install --frozen-lockfile` to succeed with `packageManager: pnpm@12.6.0`
  read by `pnpm/action-setup`; `.npmrc` has `engine-strict=true`.
- `pnpm-workspace.yaml` includes `conformance/*`; CI must not try to install Python or run
  those suites (D-17).
- `git remote` is empty today; `gh` is authenticated as `snorf`. Repo creation is
  `gh repo create snorf/orglet --public --source . --push` or equivalent, after confirmation
  (D-08).
- Branch protection needs the status check names produced by the first CI run (D-07).

</code_context>

<specifics>
## Specific Ideas

- "Docker optional for tests" is the headline for contributors: clone, `pnpm install`,
  `pnpm test`, done.
- Skipped Postgres-only tests must be visible as skipped in the report, never as green.
- The `session_replication_role` question is resolved first, in isolation, before the five
  DB-backed files are migrated, so a failure is attributed correctly.

</specifics>

<deferred>
## Deferred Ideas

- Conformance suites (jsforce, simple-salesforce) as a CI job or `workflow_dispatch` —
  phase 7 or later.
- Node 24 in the CI matrix — revisit when Node 24 becomes the active LTS and `engines` is
  widened.
- Concurrency tests that need multiple real Postgres connections — pglite is
  single-connection; such tests would be Postgres-only via the same skip mechanism (D-20).

</deferred>

---

*Phase: 01-test-infrastructure-ci*
*Context gathered: 2026-09-29*
