# Phase 1: Test Infrastructure & CI — Research Part B (GitHub repo + Actions CI)

**Researched:** 2026-09-30
**Domain:** GitHub repository creation via `gh`, repository rulesets (branch protection), GitHub Actions workflow for a pnpm/Node 22 monorepo
**Confidence:** HIGH for everything verified directly against this repo or via `gh api`/`gh --help`; MEDIUM for the ruleset JSON schema (sourced via one WebFetch of GitHub's REST docs, not Context7 — treat field names as needing a live-API sanity check on first POST)

This is Part B of Phase 1 research, covering INFRA-04..07 (GitHub repo, branch protection, CI workflow,
sync-sigha exclusion). Part A (pglite test infra, INFRA-01..03) is a separate document. Read together
with `01-CONTEXT.md` (locked decisions D-01..D-08, D-14..D-21) and `.planning/research/STACK.md` §CI,
whose action versions (`actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6`) are
reused here unchanged, not re-verified.

## Summary

`snorf/orglet` is confirmed free as of this research session (`gh repo view snorf/orglet` returned a
GraphQL "could not resolve" error, live-checked during this research). The repo does not exist yet, no
`origin` remote is configured, and the local repo is currently on `gsd/phase-01-test-infrastructure-ci`
(2 commits ahead of `main`: the phase's CONTEXT.md and state docs). Because GitHub sets a new,
`--source`-based repo's default branch to whatever branch is first pushed, `main` must be checked out
and pushed **before** the phase branch, or the phase branch would become the default branch by accident.

For the ruleset, the two required check contexts must exist as check runs that have already
completed at least once — so the phase branch must be pushed and CI must run green before the
ruleset API call, not before. `pull_request` + `required_status_checks` are two separate rule types in
the same ruleset payload; `bypass_actors: []` means the ruleset binds the repo owner too, so pushes
straight to `main` are blocked for everyone, admin included, once it's active.

For the workflow: D-16 (locked) orders steps `install → lint → build (tsc -b) → test`, which differs
from the *build → lint* order suggested in `STACK.md` from a previous research pass — D-16 wins as a
locked decision from CONTEXT.md. This is safe: ESLint's type-aware linting reads `tsconfig.test.json`
directly (not compiled output), so it has no dependency on `tsc -b` running first. `pnpm build`
(`tsc -b`) excludes `*.test.ts` files (see `packages/schema/tsconfig.json`'s `exclude`), but
`tsconfig.test.json` includes them and is what `eslint.config.js`'s `parserOptions.project` points at —
so `pnpm lint` + `pnpm build` together typecheck the whole repo including tests; neither alone does.

`conformance/*` in `pnpm-workspace.yaml` is a live no-op today: `conformance/jsforce/` and
`conformance/python/` contain no `package.json` (verified: `ls` shows only `run.sh`/`seed.mjs`/`README.md`
and `run.py`/`requirements.txt`/`__pycache__` respectively). Directly confirmed by running
`pnpm list -r --depth -1` in the repo (via `corepack pnpm`, since the ambient shell's Node is 18, not
22): only the 8 `packages/*` workspace members are listed — `conformance/*` produces nothing. `pnpm
install --frozen-lockfile` in CI will not touch Python or attempt to install jsforce's own deps; that
happens only inside `conformance/jsforce/run.sh` (a separate, unrun-in-CI script per D-17).

`scripts/sync-sigha.sh` is reachable from nowhere in `package.json` (root or any package), `.npmrc`,
or any `prepare`/`postinstall`/`preinstall` hook (`grep` for those hook names across all `package.json`
files returned zero matches). It is referenced only inside its own script body (in the `VENDOR.md`
heredoc it *writes*, not in committed source) and its own filename. CI as designed in this document
never invokes it, satisfying INFRA-07 by construction — no exclusion step is needed because there is no
generic "run all scripts" step in the workflow to exclude it from.

## User Constraints (from CONTEXT.md)

Reproduced from `01-CONTEXT.md`, scoped to what this document (Part B) covers. See that file for the
full decision set including D-09..D-13, D-19..D-21 (pglite/test backend — Part A's domain).

### Locked Decisions (GitHub repo, CI)
- D-01: Repo is `snorf/orglet`, personal account, `gh` authenticated as `snorf`. Re-verify name free at creation time.
- D-02: Public from first push.
- D-03: Push full history as-is, including `.planning/`.
- D-04: Description from `package.json`; topics `salesforce`, `emulator`, `postgres`, `typescript`, `soql`, `localstack`.
- D-05: GitHub Actions status badge at top of `README.md`.
- D-06: Branch protection on `main` requiring green CI status checks before merge.
- D-07: `git.branching_strategy` set to `phase` (`gsd/phase-{phase}-{slug}`); protection created after first push once the check name is known.
- D-08: Repo creation and first push are outward-facing — confirm with Johan immediately before running them.
- D-14: Workflow triggers on push to any branch + PR targeting `main`.
- D-15: Node 22 only.
- D-16: Two jobs `test-pglite` (no services), `test-postgres` (Postgres 16 service container, `ORGLET_DATABASE_URL` set). Both run `pnpm install --frozen-lockfile`, lint, `tsc -b`, `pnpm test`, in that order.
- D-17: Conformance suites not run in CI this phase.
- D-18: `scripts/sync-sigha.sh` never invoked by CI (INFRA-07).

### Claude's Discretion (relevant to this document)
- Action pinning style (major tag vs SHA), workflow file name, job names, pnpm cache setup.
- Exact wording of the README Development section and badge placement.

### Deferred Ideas (out of scope)
- Conformance suites as a CI job or `workflow_dispatch` — later phase.
- Node 24 in the CI matrix.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-------------------|
| INFRA-04 | Project published in a public GitHub repo under Johan's personal account, repo-local git identity, after explicit confirmation of name and first push | Repo creation command sequence below, with the D-08 confirm checkpoint marked |
| INFRA-05 | GitHub Actions runs lint, typecheck (`tsc -b`) and the full test suite against pglite on every push and PR | `test-pglite` job in the complete `ci.yml` below |
| INFRA-06 | Second GitHub Actions job runs the same suite against a Postgres 16 service container | `test-postgres` job in the complete `ci.yml` below |
| INFRA-07 | Vendored `sigha` sync script never executed in CI | sync-sigha reachability finding below: confirmed unreachable from any script CI runs |

## Repo Creation Command Sequence

**Current state (verified live in this session):** no `origin` remote configured; local branches
`main` (574cd0a) and `gsd/phase-01-test-infrastructure-ci` (ee5445d, 2 commits ahead of `main`,
strictly a fast-forward — `main` is an ancestor); repo-local git identity already correctly set to
`Johan Karlsteen <johan@karlsteen.com>` (`git config user.name`/`user.email`, not the Tele2 global
config) — no identity fix needed, PROJECT.md's constraint is already satisfied. Currently checked out:
`gsd/phase-01-test-infrastructure-ci`.

**Step 0 — re-verify the name is free (safe, read-only, run anytime):**
```bash
gh repo view snorf/orglet
```
Expect a GraphQL "Could not resolve to a Repository" error (this is `gh`'s 404-equivalent). Confirmed
this exact result live during this research session on 2026-09-30 — re-run at execution time since
state may have changed by then.

---
**>>> CONFIRM WITH JOHAN BEFORE THIS POINT (D-08) — repo creation is outward-facing. <<<**
---

**Step 1 — checkout `main` first, so it becomes the default branch:**
```bash
git checkout main
```
This matters: `gh repo create --source . --push` pushes whichever branch is currently checked out.
Since the new repo starts with zero refs, the *first* branch pushed becomes GitHub's default branch.
Running this from `gsd/phase-01-test-infrastructure-ci` would make the phase branch the default branch
by accident — wrong, and hard to fix cleanly after the fact (`gh repo edit --default-branch` exists
but there's no reason to create the problem in the first place).

**Step 2 — create the repo, public, with description, add `origin`, push `main`:**
```bash
gh repo create snorf/orglet \
  --public \
  --description "Self-hosted, Salesforce-compatible CRM platform emulator" \
  --source . \
  --remote origin \
  --push
```
Description text copied verbatim from `package.json`'s `"description"` field (D-04). This single
command creates the GitHub repo, adds `origin`, and pushes the current branch (`main`) with full
history (D-03 — nothing is squashed or filtered; the existing 25-commit history including
`.planning/` goes up as-is). `--public` satisfies D-02.

**Step 3 — set topics (D-04), independent step since `gh repo create` has no `--topic` flag (verified: not present in `gh repo create --help` output; topics are a `gh repo edit` concern):**
```bash
gh repo edit snorf/orglet \
  --add-topic salesforce \
  --add-topic emulator \
  --add-topic postgres \
  --add-topic typescript \
  --add-topic soql \
  --add-topic localstack
```

---
**>>> CONFIRM WITH JOHAN BEFORE THIS POINT (D-08) — pushing the phase branch is also an outward-facing first push. If Step 2 was already confirmed as covering "the first push" broadly, this can proceed without a second stop; if in doubt, treat it as covered by the same confirmation as Step 2 since both happen in the same sitting. <<<**
---

**Step 4 — push the phase branch, triggering the first CI run (D-14: push to any branch):**
```bash
git checkout gsd/phase-01-test-infrastructure-ci
git push -u origin gsd/phase-01-test-infrastructure-ci
```
This is the run whose two check names (`test-pglite`, `test-postgres`) the ruleset in the next section
depends on existing. Wait for it to go green (`gh run watch` or `gh run list --branch
gsd/phase-01-test-infrastructure-ci`) before creating the ruleset.

**Step 5 — continue phase 1 execution.** Further implementation commits land on
`gsd/phase-01-test-infrastructure-ci` as normal; each push re-triggers both CI jobs (D-14).

**Step 6 — create the branch protection ruleset** once step 4's run is green (see next section).

**Step 7 — PR flow to `main` once phase 1 is verified:**
```bash
gh pr create \
  --base main \
  --head gsd/phase-01-test-infrastructure-ci \
  --title "Phase 1: Test infrastructure & CI" \
  --body "..."
```
This triggers a **second** workflow run (the `pull_request` trigger, D-14), in addition to the `push`
run(s) already triggered by commits on the branch. This is a known, accepted consequence of D-14's
"push to any branch + PR to main" trigger combination — not a bug to fix here, since the two events
use different `github.ref` values (`refs/heads/gsd/phase-01-test-infrastructure-ci` for push,
`refs/pull/N/merge` for pull_request), so the `concurrency` group below cancels superseded runs of the
same event type/ref, not the push run because of the PR run. GitHub associates check-run results with
the PR's head commit SHA regardless of which trigger produced them, so the ruleset's required checks
are satisfied correctly either way. Once both `test-pglite` and `test-postgres` are green on the PR,
merge with `gh pr merge` (strategy — squash vs merge commit — not decided here; not required by
INFRA-04..07, a reasonable default for a solo-maintainer repeatedly merging phase branches is
`--squash`, but this is Claude's discretion per CONTEXT.md, not a locked requirement).

## Ruleset JSON

**Precondition:** the two check names below must have run at least once (Step 4 above). GitHub's
ruleset API validates `required_status_checks[].context` values only loosely at creation time (it will
accept a name that has never run — the rule simply never becomes "satisfied" until a matching check
appears), so this is a soft precondition for correctness, not a hard API-side block; still follow the
locked-decision order (D-07) rather than relying on that leniency.

Confidence note: the JSON shape below was verified via one WebFetch of GitHub's official REST API docs
(`docs.github.com/en/rest/repos/rules`) — MEDIUM-HIGH confidence (official source, but summarized by
the fetch tool rather than read as raw doc text). If the first `POST` returns a 422 with a field-level
validation error, treat that response as authoritative over this document and adjust field names
accordingly; it is the live schema, this is a research-time snapshot.

```bash
cat > /tmp/orglet-main-ruleset.json <<'JSON'
{
  "name": "require CI on main",
  "target": "branch",
  "enforcement": "active",
  "bypass_actors": [],
  "conditions": {
    "ref_name": {
      "include": ["~DEFAULT_BRANCH"],
      "exclude": []
    }
  },
  "rules": [
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "test-pglite" },
          { "context": "test-postgres" }
        ]
      }
    }
  ]
}
JSON

gh api repos/snorf/orglet/rulesets \
  --method POST \
  --input /tmp/orglet-main-ruleset.json
```

Notes on the choices baked into this JSON:
- **`bypass_actors: []`** — per the question's ask, nobody bypasses, including the owner (`snorf`).
  Once active, direct pushes to `main` are rejected for everyone; all changes go through a PR with
  both checks green.
- **`pull_request` rule with `required_approving_review_count: 0`** — enforces "changes to `main` must
  come via a merged PR" (blocks direct pushes) without requiring a second human reviewer, appropriate
  for a solo-maintainer repo with no `CODEOWNERS` file. This is the mechanism that actually blocks
  direct pushes; `required_status_checks` alone would only gate PR merge button state, not push access.
- **`strict_required_status_checks_policy: true`** — requires the PR's branch to be up to date with
  `main` before the checks are considered satisfied (classic "require branches up to date"). Given
  D-07's sequential phase-branching workflow (one phase branch open against `main` at a time, `main`
  only advances via that phase's merge), this should rarely force an extra rebase in practice.
  Claude's discretion per CONTEXT.md — flip to `false` if it proves to add friction.
- **`context` names** — `test-pglite` and `test-postgres` match the two job **keys** in `ci.yml` below.
  GitHub Actions check-run names default to the job's `name:` field if set, otherwise the job id
  (the YAML key) verbatim — since neither job below sets an explicit `name:`, the check names are
  exactly `test-pglite` and `test-postgres`. No `integration_id` is specified (optional; omitting it
  matches against any app reporting that context, which for Actions-produced checks is unambiguous).

**Verification after creation:**
```bash
gh ruleset list --repo snorf/orglet
gh ruleset view --repo snorf/orglet <id> --web   # visual confirmation
gh ruleset check main --repo snorf/orglet         # shows rules that would apply to main
```

## Complete `.github/workflows/ci.yml`

```yaml
name: CI

on:
  push:
  pull_request:
    branches:
      - main

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  test-pglite:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm build
      - run: pnpm test

  test-postgres:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgres:16-alpine
        env:
          POSTGRES_USER: orglet
          POSTGRES_PASSWORD: orglet
          POSTGRES_DB: orglet
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
    env:
      ORGLET_DATABASE_URL: postgres://orglet:orglet@localhost:5432/orglet
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm lint
      - run: pnpm build
      - run: pnpm test
```

Design notes, each answering a specific question from the brief:

- **`on: push` (all branches) + `pull_request: branches: [main]`** — matches D-14 exactly. Bare
  `push:` with no filter triggers on every branch (and tag) push; scoping `pull_request` to `main`
  avoids a redundant run for PRs opened against any other base (none expected under the phase-branch
  workflow, but harmless to be explicit).
- **`permissions: contents: read`** — workflow-wide, matches the ask; no job needs more (no releases,
  no PR comments, no package publishing in this phase).
- **`concurrency`** keyed on `${{ github.workflow }}-${{ github.ref }}` — a new push to the same branch
  (or the same PR) cancels the in-flight run for that ref, standard pattern, unchanged for years
  (HIGH confidence, no verification needed beyond STACK.md's existing confirmation of this pattern's
  stability).
- **Step order per job: checkout → `pnpm/action-setup@v6` → `actions/setup-node@v7` → install → lint →
  build → test.** `pnpm/action-setup` must precede `actions/setup-node` because `cache: pnpm` needs
  pnpm already on `PATH` to fingerprint the lockfile (confirmed via `actions/setup-node`'s own README:
  "Package manager should be pre-installed" for the `cache` input) — this order was already verified in
  `STACK.md` and is unchanged here.
- **`node-version-file: .nvmrc`** instead of a hardcoded `node-version: 22` — `.nvmrc` pins `22`
  (verified: `cat .nvmrc` → `22`) and `actions/setup-node@v7`'s own usage docs list `.nvmrc` as a
  supported `node-version-file` format. Keeps one source of truth for the Node version instead of
  duplicating `22` into the workflow file (same reasoning as `packageManager`-driven pnpm version).
- **No `version:` input on `pnpm/action-setup@v6`** — confirmed by reading the action's own README
  (via `gh api repos/pnpm/action-setup/contents/README.md`): `version` is optional when
  `packageManager` is set in `package.json`, which it is (`pnpm@12.6.0`). Omitting it means the
  workflow and `package.json` never drift.
- **`test-postgres` service container** uses port `5432:5432` (container-internal port mapped to the
  same host port), not `5433` — deliberately different from `docker-compose.yml`'s `5433:5432` host
  mapping, since there is no separate local Postgres instance to avoid colliding with inside a
  GitHub-hosted runner; `ORGLET_DATABASE_URL` is set explicitly in the job's `env:` block to
  `postgres://orglet:orglet@localhost:5432/orglet`, matching D-11 ("CI's Postgres job selects the real
  backend simply by setting `ORGLET_DATABASE_URL` ... no other switch"). `test-pglite` sets no such
  variable, so `databaseUrlFromEnv()`'s D-09 auto-detect falls through to pglite there.
- **`pnpm build` as the typecheck step, confirmed correct:** `package.json`'s `"build": "tsc -b"`
  compiles via the root `tsconfig.json`'s project references to all 8 packages, each extending
  `tsconfig.base.json` (`strict: true` plus the extra strictness flags). `tsc -b` fails the process on
  any type error — it is a real typecheck gate, not just an emit step (verified by reading
  `tsconfig.base.json` and one package's `tsconfig.json`, `packages/schema/tsconfig.json`). One caveat
  worth recording: each package's `tsconfig.json` **excludes** `src/**/*.test.ts`
  (`packages/schema/tsconfig.json`: `"exclude": ["src/**/*.test.ts"]`), so `pnpm build` alone does not
  typecheck test files. Coverage gap is closed by `pnpm lint`: ESLint's `parserOptions.project`
  includes `./tsconfig.test.json` (`eslint.config.js`), and `tsconfig.test.json` explicitly `include`s
  `packages/*/src/**/*.test.ts` — so type-aware lint rules do typecheck test files. `pnpm lint` +
  `pnpm build` together give full-repo type coverage; neither alone does. D-16's locked step order
  (`lint` before `build`) is unaffected by this — lint's type-awareness comes from `tsconfig.test.json`
  via the TypeScript language service directly, not from `tsc -b`'s emitted output, so it has no
  ordering dependency on `build` running first. **This resolves an ordering discrepancy**: `STACK.md`
  (prior research pass) suggested `build` before `lint`; D-16 (locked, CONTEXT.md) says `lint` then
  `tsc -b`. D-16 wins as a locked decision — followed here — and both orders are functionally safe for
  the reason above, so there's no correctness cost to the resolution, only a note that the two research
  documents briefly disagreed on a non-binding stylistic point.
- **`pnpm test` needs no prior build, confirmed:** `vitest.config.ts` (read directly) aliases every
  `@orglet/<name>` import to `./packages/<name>/src/index.ts` — tests run against TypeScript source
  through vitest's own esbuild transform, never against `dist/`. No `pnpm build` dependency for `test`
  to pass; `build` is CI's typecheck gate, not a prerequisite for `test` to function.
- **`conformance/*` workspace packages, confirmed not a CI concern:** `pnpm-workspace.yaml` lists
  `conformance/*` alongside `packages/*`, but `conformance/jsforce/` and `conformance/python/` each
  lack a `package.json` — pnpm requires one to register a directory as a workspace member. Directly
  verified by running `pnpm list -r --depth -1` (via `corepack pnpm`, since the ambient dev shell runs
  Node 18, not 22) in this repo: only the 8 `packages/*` members are listed, nothing under
  `conformance/`. `pnpm install --frozen-lockfile` in CI installs exactly those 8 packages' deps — no
  Python packages, no jsforce npm deps (those are pulled separately, at runtime, by
  `conformance/jsforce/run.sh`'s own `git clone` + its own `npm install`, a script that is never
  invoked in this phase's CI per D-17). Confidence: HIGH, directly executed, not inferred.

## Action Setup Facts

Verified by reading `pnpm/action-setup`'s and `actions/setup-node`'s own READMEs
(`gh api repos/<owner>/<repo>/contents/README.md --jq .content | base64 -d`), not WebSearch:

1. **`pnpm/action-setup@v6` works with no `version:` input whenever `packageManager` (or
   `devEngines.packageManager`) is set in `package.json`.** Direct quote from the README: *"Optional
   when there is a `packageManager` or `devEngines.packageManager` field in the `package.json`...
   otherwise, this field is required."* `package.json` here has `"packageManager": "pnpm@12.6.0"`, so
   omitting `version:` is correct and intentional, not an oversight.
2. **No corepack step is needed before `pnpm/action-setup`.** This refines `PITFALLS.md`'s pitfall 13,
   which frames `corepack enable` as a recommended early step — that guidance describes the
   corepack-based installation *pattern* in general, but `pnpm/action-setup@v6`'s own `action.yml`
   (`runs: using: node24, main: dist/index.js`) shows it is a self-contained JS action that downloads
   pnpm's own package directly; its README states plainly: *"This action does not set up Node.js. Use
   actions/setup-node yourself."* — no mention of corepack anywhere in the README or action metadata.
   For pnpm v12 specifically, the README also notes *"pnpm v12 uses the plain pnpm package's native
   executable"* (i.e., not the corepack-shimmed path some older guidance assumes). **Conclusion:** do
   not add a `corepack enable` step to `ci.yml` — it is unnecessary for this action version and would
   be dead weight, not a safety net. (Pitfall 13's broader point about pnpm/Node version drift between
   local dev and CI remains valid and is addressed by `pnpm/action-setup` reading `packageManager`
   directly, giving the workflow and `package.json` one source of truth either way.)
3. **`actions/setup-node@v7`'s `cache: pnpm` requires pnpm already on `PATH`** — its own README states
   the package manager "Should be pre-installed" for the cache input to work, confirming the
   checkout → `pnpm/action-setup` → `setup-node` ordering used in `ci.yml` above (and already
   established in `STACK.md`).
4. **`node-version-file` supports `.nvmrc`** — confirmed in `actions/setup-node@v7`'s own usage block
   (`Examples: package.json, mise.toml, .nvmrc, .node-version, .tool-versions`).

## Badge

Placed immediately under the `# orglet` H1, before the current first paragraph:

```markdown
# orglet

[![CI](https://github.com/snorf/orglet/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/snorf/orglet/actions/workflows/ci.yml)

A self-hosted, single-tenant emulator of the Salesforce platform. ...
```

Standard GitHub Actions badge URL shape (`actions/workflows/<file>/badge.svg?branch=<branch>`,
linking to the workflow's Actions tab) — well-established, unchanged for years; no separate
verification beyond this being GitHub's documented, current badge URL format. Depends on the workflow
file being named `ci.yml` (as used throughout this document) and living at `.github/workflows/ci.yml`.

## `sync-sigha` Reachability Finding

**Finding: `scripts/sync-sigha.sh` is not reachable from anything CI runs. Confirmed, not assumed.**

Checked:
- `grep -n '"prepare"\|"postinstall"\|"preinstall"' package.json packages/*/package.json` → **zero
  matches** across the root and all 8 package manifests. No install-time hook exists at all, let alone
  one referencing the sync script.
- `grep -n "sync-sigha" package.json .npmrc packages/*/package.json` → **zero matches.** No `pnpm`
  script (root or per-package) invokes it.
- `.npmrc` contains only `engine-strict=true` and `auto-install-peers=true` — no `ignore-scripts`
  override or install hook wiring either.
- The only file in the repo referencing the string `sync-sigha` at all is `scripts/sync-sigha.sh`
  itself — and that's a self-reference (its own filename appears in a comment and in the `VENDOR.md`
  content it *generates at runtime*, not in any committed file).
- The `ci.yml` designed above runs exactly five commands per job (`pnpm install --frozen-lockfile`,
  `pnpm lint`, `pnpm build`, `pnpm test`, plus the setup actions) — none of them is, or transitively
  invokes, `scripts/sync-sigha.sh`. There is no generic "run all scripts in `scripts/`" step to exclude
  it from, because no such step exists or is proposed.

INFRA-07 is satisfied by omission: the vendored `packages/sigha/src` (already committed, per
`ARCHITECTURE.md` and confirmed by its presence and `VENDOR.md` on disk) is what CI builds and tests,
and nothing in the workflow re-syncs it from the upstream `rfaulhaber/sigha` repo.

## Environment Availability

No external dependency beyond what's already covered by "Action Setup Facts" — this phase's CI work
depends only on GitHub-hosted infrastructure (`ubuntu-latest` runners, GitHub Actions itself, the
`postgres:16-alpine` image pulled by the `services:` block) and `gh` for repo/ruleset setup, which is
already authenticated and working (`gh auth status` confirmed `snorf`, scopes `repo`, `workflow`,
`read:org`, `gist` — `workflow` scope specifically is required to push a `.github/workflows/*.yml` file
via `gh`/`git push`, and it is present). No fallback needed; nothing missing.

## Validation Architecture (INFRA-04..07)

Per `.planning/config.json`, `workflow.nyquist_validation` is `true` (not absent, not false) —
section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | N/A for this section — INFRA-04..07 are infrastructure/process requirements, not unit-testable application behavior. Validation is by direct command execution and `gh api`/`gh` inspection, not `vitest`. |
| Config file | `.github/workflows/ci.yml` (created by this phase) |
| Quick run command | see per-requirement commands below |
| Full suite command | `gh run list --branch gsd/phase-01-test-infrastructure-ci --limit 5` (confirms both jobs ran and their conclusions) |

### Phase Requirements → Validation Map
| Req ID | Behavior | Validation Type | Command | Expected Output | Which CI Job / Context |
|--------|----------|------------------|---------|------------------|--------------------------|
| INFRA-04 | Repo exists, public, correct owner, description, topics | manual/CLI check | `gh repo view snorf/orglet --json isPrivate,description,repositoryTopics,owner` | `isPrivate: false`, description matches `package.json`, 6 topics present, `owner.login: snorf` | N/A (repo-level, not a CI job) |
| INFRA-05 | `test-pglite` job runs lint, `tsc -b`, full suite, on push and PR | CI job success | `gh run list --branch <branch> --json name,conclusion --jq '.[] | select(.name=="CI")'` then inspect the `test-pglite` job specifically via `gh run view <run-id> --job=<job-id>` | job `test-pglite` conclusion `success`; log shows `pnpm lint`, `pnpm build`, `pnpm test` steps all green in order | `test-pglite` job in `ci.yml` |
| INFRA-06 | `test-postgres` job runs the same suite against a real Postgres 16 service container | CI job success | Same `gh run view`, inspect `test-postgres` job | job `test-postgres` conclusion `success`; `services.postgres` container started (log shows health check passing); same lint/build/test steps green | `test-postgres` job in `ci.yml` |
| INFRA-07 | `sync-sigha.sh` never runs in CI | negative check | `gh run view <run-id> --log \| grep -i sync-sigha` (both jobs) | **no output** — the string never appears in any CI job log | Both jobs (negative assertion) |

### Sampling Rate
- **Per commit push to the phase branch:** both CI jobs run automatically (D-14, `on: push`) — this
  *is* the "quick run" for this phase, there is no separate local equivalent since the requirements are
  about the CI environment itself, not local behavior.
- **Per PR to `main`:** both jobs re-run under the `pull_request` trigger; ruleset (once created) blocks
  merge until both are green.
- **Phase gate:** before `/gsd:verify-work`, confirm via `gh run list` that the most recent run on the
  phase branch has both jobs `success`, and run the INFRA-07 negative log-grep once as a final check.

### Wave 0 Gaps
- `.github/workflows/ci.yml` does not exist yet — created by this phase's implementation, not
  pre-existing. Not a gap in test infrastructure per se (there is no unit-test framework gap here); it
  is the deliverable itself.
- No gap in the sense the "Wave 0 Gaps" section is usually used (missing test files/fixtures) — this
  requirement group is process/infrastructure, validated by direct `gh`/CI inspection as tabulated
  above, not by `vitest` test files.

## Sources

### Primary (HIGH confidence — direct execution/reads in this repo, or `gh api`)
- Live `gh repo view snorf/orglet` run in this session — confirmed name currently free
- Live `gh auth status` — confirmed authenticated as `snorf`, scopes include `repo` and `workflow`
- Live `git branch -a` / `git rev-parse` / `git log main..gsd/phase-01-test-infrastructure-ci` — confirmed branch state, no origin remote, main is an ancestor of the phase branch
- `gh repo create --help`, `gh repo edit --help`, `gh ruleset --help`, `gh pr create --help`, `gh api --help` — flag surfaces for the command sequence
- `gh api repos/pnpm/action-setup/contents/README.md` (base64-decoded) — no-version-input behavior, no-corepack-needed finding, checkout-before-setup-node ordering
- `gh api repos/pnpm/action-setup/contents/action.yml` — confirms `runs: using: node24`, self-contained JS action, not a corepack shim
- `gh api repos/actions/setup-node/contents/README.md` (base64-decoded) — `cache: pnpm` pre-install requirement, `node-version-file` supported formats including `.nvmrc`
- Direct `Read` of `package.json`, `.npmrc`, `pnpm-workspace.yaml`, `vitest.config.ts`, `tsconfig.base.json`, `tsconfig.json`, `tsconfig.test.json`, `packages/schema/tsconfig.json`, `packages/sigha/package.json`, `eslint.config.js`, `.gitignore`, `docker-compose.yml`, `.nvmrc`, `scripts/sync-sigha.sh` — grounded every claim about build/lint/test ordering, workspace membership, and sync-sigha reachability in this repo's actual files, not generic advice
- Live `corepack pnpm list -r --depth -1` run in this repo — empirically confirmed `conformance/*` produces zero workspace members (no `package.json` in either subdirectory)
- Live `grep` across `package.json` + all `packages/*/package.json` for `prepare`/`postinstall`/`preinstall` and for `sync-sigha` — zero matches in both cases
- `find .github -type f` — confirmed no workflow files exist yet in this repo

### Secondary (MEDIUM-HIGH confidence — official docs via WebFetch, 1 of 4 allotted fetches used)
- `docs.github.com/en/rest/repos/rules` (WebFetch) — repository ruleset JSON schema (`pull_request` and `required_status_checks` rule `parameters` shapes, `conditions.ref_name`, `bypass_actors`). Treat the exact field list as a research-time snapshot; the live `POST` response is authoritative if it disagrees.

### Not independently re-verified (reused from prior research per the task's scope)
- `actions/checkout@v7`, `actions/setup-node@v7`, `pnpm/action-setup@v6` exact version numbers — per
  `STACK.md` §CI, already HIGH confidence there, not re-checked here.
- Pitfalls 13 and 14 from `PITFALLS.md` — read and cross-checked against this repo's actual files
  (pitfall 14's `sync-sigha` concern addressed above; pitfall 13's corepack framing refined by finding
  #2 in "Action Setup Facts" above, specific to `pnpm/action-setup@v6`'s actual current implementation).

## Metadata

**Confidence breakdown:**
- Repo creation command sequence: HIGH — every flag verified against `gh --help` output in this exact `gh` version, repo state verified live.
- Ruleset JSON: MEDIUM-HIGH — schema from one WebFetch of official docs, not Context7 or a raw API read; flagged for live-response verification at execution time.
- `ci.yml`: HIGH — every step's ordering/behavior justification is either a locked decision (D-14/D-15/D-16) or verified against this repo's own config files or the two setup actions' own READMEs.
- sync-sigha reachability: HIGH — direct grep across every relevant file, zero matches, not an absence-of-evidence inference.
- Badge: HIGH — standard, unchanged GitHub Actions badge URL format.
- Validation Architecture: MEDIUM — INFRA-04..07 are infrastructure requirements with no existing test-framework equivalent in this repo; the commands given are direct, reproducible `gh`/CI-log checks rather than a pre-existing pattern to mirror.

**Research date:** 2026-09-30
**Valid until:** ~30 days for the `gh` CLI flag surface and repo state (re-verify repo-free-name check at execution time regardless); action version pins should be re-checked if this phase's execution happens more than ~4-6 weeks after this research per the fast-moving nature of GitHub Actions marketplace actions (already flagged in `STACK.md`).
