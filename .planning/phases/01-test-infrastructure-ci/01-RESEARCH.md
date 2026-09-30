# Phase 1: Test Infrastructure & CI - Research

**Researched:** 2026-09-30
**Confidence:** HIGH (all load-bearing claims verified empirically or via `gh`, not from docs alone)

This file is the entry point. The detail lives in two parts written by parallel researchers:

- `01-RESEARCH-A-pglite.md` — pglite-socket API, empirical probe results, vitest facts,
  shared-vs-per-file recommendation, default-URL relocation table (INFRA-01..03)
- `01-RESEARCH-B-github.md` — repo creation command sequence, ruleset JSON, complete
  `ci.yml`, action setup facts, badge, sync-sigha reachability (INFRA-04..07)

Downstream agents read all three.

## Summary

1. **INFRA-02 is settled: `session_replication_role` works on pglite 0.5.8.** Verified by
   installing the pinned packages in a scratchpad and running probes over the real wire
   protocol through `pg.Pool`: `SET LOCAL session_replication_role = replica` sets, reports,
   and bypasses FK enforcement (child insert with a missing parent succeeds under replica and
   fails with `23503` without it). `information_schema.columns`/`tables`, `SAVEPOINT`,
   `ALTER TABLE ADD/ALTER COLUMN`, `ILIKE`, `numeric`/`timestamptz`/`char(18)`, sequences
   all pass. No existing test needs the Postgres-only skip (D-20); the skip helper is still
   built because D-19/D-20 require the mechanism to exist, and the dedicated test asserts
   PASS.
2. **Per-file pglite instance, not a shared one.** pglite-socket funnels every connection
   through one FIFO query queue in the single WASM instance. Two clients holding open
   transactions in an interleaved order hang forever with no error (reproduced twice). vitest
   runs test files in separate forked processes, so a shared instance would expose the five
   DB-backed files to that hang. Each DB-backed test file starts its own `PGlite.create()`
   plus `PGLiteSocketServer({ port: 0 })` in `beforeAll`; the existing `test_<hex>` schema
   pattern stays as defence in depth. Startup is well under a second per file.
3. **Bound port:** `server.port` is `private` in the `.d.ts`. Use the public
   `server.getServerConn()` which returns `"host:port"`.
4. **vitest 3.2.7 facts (verified live):** `it.skipIf`, `describe.skipIf` and
   `ctx.skip(cond, "reason")` all report as skipped with the reason visible. `process.env`
   set in `globalSetup` does reach forked workers, but globalSetup is not used (see 2).
5. **Default-URL relocation (D-10):** `databaseUrlFromEnv()` returns `string | undefined`
   with no default. The `localhost:5433` fallback moves to `packages/cli/src/main.ts`
   (`common()`). All five test files switch to a shared test bootstrap helper. `.env.example`,
   `docker-compose.yml`, `README.md` and `.planning/codebase/TESTING.md` are updated
   accordingly (exact table in part A).
6. **GitHub:** `snorf/orglet` is free as of 2026-09-30. `main` (`574cd0a`) must be pushed
   before the phase branch, otherwise GitHub makes the phase branch the default. Repo
   creation and first push each carry a confirm-with-Johan checkpoint (D-08).
7. **CI:** `pnpm/action-setup@v6` needs no `version` input and no `corepack enable`; it reads
   `packageManager: pnpm@12.6.0`. `conformance/*` has no `package.json`, so `pnpm install`
   ignores it. `scripts/sync-sigha.sh` is not reachable from any script or hook. Step order
   lint → build (`tsc -b`) → test is safe: lint type-checks test files via
   `tsconfig.test.json`, build excludes them, so both are needed.
8. **Branch protection:** implemented as a repository ruleset requiring the `test-pglite`
   and `test-postgres` checks plus a pull request, with no bypass actors. Created only after
   the first green CI run, since required check names must have run at least once. The
   ruleset field names came from one docs fetch; trust the live `POST` response if they
   disagree.

## Decisions taken in research (Claude's Discretion items from CONTEXT.md)

| Item | Decision | Grounds |
|---|---|---|
| Shared vs per-file pglite | Per file | Concurrency hang reproduced (part A) |
| Bootstrap helper | Small in-repo helper, no third-party wrapper | STACK.md, codebase has no ORM/wrappers |
| CI job names | `test-pglite`, `test-postgres` | Referenced by the ruleset |
| Action pinning | Major tags (`@v7`, `@v6`) | Matches STACK.md verification |
| D-19 test location | Planner decides: new `packages/schema/src/pglite-compat.test.ts` or first `it()` in `migrate.test.ts` | No technical difference |
| PR merge strategy | Planner/executor discretion | Not covered by any requirement |

## Validation Architecture

### Test Framework
| Property | Value |
|---|---|
| Framework | vitest 3.2.7 (root devDependency) |
| Config file | `vitest.config.ts` (single, workspace-wide) |
| Quick run command | `pnpm vitest run <file>` |
| Full suite command | `pnpm test` (pglite when `ORGLET_DATABASE_URL` is unset) |
| Full suite, real Postgres | `pnpm db:up && ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test` |

### Phase Requirements → Validation Map
| Req ID | Behavior | Type | Command | Expected | Where |
|---|---|---|---|---|---|
| INFRA-01 | `pnpm test` passes with no `ORGLET_DATABASE_URL` and no Docker | integration | `unset ORGLET_DATABASE_URL; pnpm test` | all files pass, five DB-backed files on pglite | local, `test-pglite` job |
| INFRA-02 | `session_replication_role` + `information_schema` verified on pglite | integration | `pnpm vitest run packages/schema/src/pglite-compat.test.ts` (or the `it()` in `migrate.test.ts`) | PASS; outcome recorded in `.planning/codebase/TESTING.md` | local, both jobs |
| INFRA-03 | Server path untouched by pglite | typecheck + manual | `pnpm build`; then `pnpm db:up` and `orglet up` once | build green; server connects to Docker Postgres | local |
| INFRA-04 | Public repo, owner, description, topics | CLI check | `gh repo view snorf/orglet --json isPrivate,description,repositoryTopics,owner` | `isPrivate: false`, 6 topics, owner `snorf` | GitHub |
| INFRA-05 | `test-pglite` runs lint, build, test on push and PR | CI | `gh run view <id>` | job `success`, steps in order | `test-pglite` |
| INFRA-06 | `test-postgres` runs the same against Postgres 16 service | CI | `gh run view <id>` | job `success`, health check passed | `test-postgres` |
| INFRA-07 | sync-sigha never runs in CI | negative | `gh run view <id> --log \| grep -i sync-sigha` | no output | both jobs |

### Sampling Rate
- Per task commit: `pnpm vitest run <changed file>`
- Per wave: `pnpm test` (pglite)
- Phase gate: full suite green on both backends locally, then both CI jobs green on the phase
  branch, then the INFRA-07 negative grep once.
- Max feedback latency: about 60 s locally (per-file pglite startup under 1 s, existing
  `hookTimeout` 60 s unchanged).

### Wave 0 Gaps
- [ ] Test bootstrap helper (`startPglite()` shape from part A) used by the five DB-backed
  files; must exist before any file is migrated off the old default.
- [ ] D-19 dedicated compatibility test porting probes b, c, d, e1, e2 from part A.
- [ ] `.github/workflows/ci.yml` (the deliverable itself).
- [ ] `.planning/codebase/TESTING.md` entry recording the D-19 outcome (PASS, 2026-09-30,
  pglite 0.5.8).

### Manual-Only Verifications
| Behavior | Requirement | Why manual | Instructions |
|---|---|---|---|
| `orglet up` still reaches Docker Postgres | INFRA-03 | No e2e test for the server path in scope | `pnpm db:up`, run the CLI, hit `/services/data/` |
| Repo creation and first push | INFRA-04 | Outward-facing, confirmed with Johan (D-08) | Follow part B's command sequence, stop at each checkpoint |
| Ruleset creation | INFRA-05/06 | Needs one completed CI run first | Part B ruleset JSON via `gh api` after first green run |

## Sources
- Empirical probes against `@electric-sql/pglite@0.5.8`, `@electric-sql/pglite-socket@0.2.11`,
  `pg@8.23.0` in the scratchpad; verbatim output in part A
- Repo's installed vitest 3.2.7 typings and a live skip/globalSetup experiment (part A)
- `gh --help`, `gh api` on `pnpm/action-setup` and `actions/setup-node` READMEs, live
  `gh repo view snorf/orglet` (part B)
- One WebFetch of GitHub REST docs for rulesets (part B, MEDIUM-HIGH)
- `.planning/research/STACK.md` and `PITFALLS.md` for versions and pitfalls (reused, not
  re-verified)
