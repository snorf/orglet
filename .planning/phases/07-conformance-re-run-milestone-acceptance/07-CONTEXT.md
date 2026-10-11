# Phase 7: Conformance Re-Run & Milestone Acceptance - Context

**Gathered:** 2026-10-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Verify milestone 1's acceptance bar (ACCEPT-01, ACCEPT-02, ACCEPT-03) and leave a dated,
reproducible record of it in the repository:

1. `orglet check` against Johan's Developer Edition **retrieve** (the local SFDX project at
   `~/Development.nosync/devrandom-metadata`, Level 1 data, never in the repo or CI) reports zero
   `UNSUPPORTED` warnings. The org itself is never contacted and orglet's behaviour is never
   compared with Salesforce's (Developer MSA).
2. Both SDK conformance harnesses (`conformance/jsforce`, `conformance/python`) are re-run after
   all six milestone changes and are green; jsforce's Bulk tests are classified (Bulk v1 stays
   excluded, Bulk API 2.0 is now included) and simple-salesforce gains Bulk 2.0 checks.
3. Both harness READMEs carry current, dated pass/fail/excluded numbers with the reason for every
   remaining exclusion; a new `conformance/README.md` summarises every check including the DE run.

Additionally in scope (decided here): a `--strict` flag on `orglet check`, a conformance job in
GitHub Actions, pinning both SDKs, and correcting every stale conformance/acceptance statement in
the repo and `.planning` docs (folded todo: reword ROADMAP line 14).

**Not in scope:** new emulator features, Bulk API v1 (`/services/async`), SOSL, UI API
(layouts, list views, tabs, theme, recent), patching upstream jsforce test files, changing the
`main` ruleset, running the DE retrieve anywhere but Johan's machine.

</domain>

<decisions>
## Implementation Decisions

### jsforce harness: Bulk 2.0 inclusion
- **D-01:** Include `test/bulk2.test.ts` (17 tests, `conn.bulk2.*` against `/jobs/ingest|query`)
  in the run. `test/bulk.test.ts` (16 tests, `conn.bulk.load` against Bulk v1 `/services/async`)
  stays excluded. Every bulk2 test that does not pass is classified individually and documented
  with its reason; a looser filter is never applied before classification (research Pitfall 21).
- **D-02:** No patches to upstream jsforce test files and no `sed` rewriting in `run.sh`.
  `Query#update` / `Query#destroy` ("and return updated/deleted status") and `search records`
  stay excluded with the reason "calls `insertAccounts`, which uses Bulk v1
  (`DEFAULT_BULK_API_VERSION = 1` in jsforce `src/query.ts`)". Also keep excluded: layouts,
  list views, tabs, theme, recent, identity (asserts `https://`), `already existing` upsert
  (asserts `ret.id` on a 204, unsatisfiable by any spec-compliant server), `randomly-waiting`.
- **D-03:** The Jest `-t` negative-lookahead regex must become v1-specific so that `bulk2` test
  names are no longer swallowed by `bulk|Bulk`. Note the Jest quirk: `connection-crud.test.ts`
  and `query.test.ts` import `insertAccounts` from `./bulk.test`, which re-registers all 16 v1
  tests into the importing file; the filter must still exclude those re-registered names.
- **D-04:** Pin jsforce to a specific commit sha (today's `main`) in `run.sh`; `README.md`
  records the sha and the resulting package version next to the numbers. Upgrading the pin is a
  deliberate, separate change.
- **D-05:** `run.sh`'s default run **is** the README run: the file list and the `-t` filter move
  into `run.sh` so `./run.sh <url> <token>` reproduces the documented numbers. A broader run
  (extra files, no filter) stays available through explicit arguments after `--`.
- **D-06:** Target is **0 failed**. Anything that cannot pass for a documented reason is
  excluded via the filter and listed in the README with its classification; a green run is the
  acceptance criterion. Expected-failure rows in the numbers are not acceptable.

### Python harness (simple-salesforce)
- **D-07:** `conformance/python/README.md` does not exist and must be created. It mirrors the
  jsforce README's structure (purpose, prerequisites, run command, pinned SDK version, dated
  results table, known gaps) so the two are comparable side by side.
- **D-08:** `run.py` gains a small number of Bulk 2.0 checks through simple-salesforce's `bulk2`
  client (at least: ingest insert with per-row results, and one query job). The documented total
  becomes 26 + N; the "Bulk now covered" statement then holds for both SDKs.
- **D-09:** Pin `simple-salesforce` to an exact version in `requirements.txt` (the version the
  local venv resolves today, 1.12.x, unless the planner finds a reason to pick another); the
  README states the version beside the numbers.
- **D-10:** `BASE_URL`, `USERNAME`, `API_VERSION` in `run.py` become environment variables with
  today's hard-coded values as defaults, matching the jsforce harness's `SF_LOGIN_URL` /
  `SF_ACCESS_TOKEN` pattern. Running as today needs no change.
- **D-11:** The stale `run.py` comment claiming the two create checks are "expected to FAIL"
  (trailing slashes, fixed in commit `1c4d433`) is removed.

### CI: conformance job
- **D-12:** Add one separate GitHub Actions job (e.g. `conformance`) to `.github/workflows/ci.yml`
  that starts `orglet up` against a Postgres 16 service container with `examples/acme`, then
  runs: `conformance/python/run.py`, the jsforce subset via `run.sh`, and the describe-, poly-
  and rollup-check scripts (both SDK legs each). The DE retrieve is never part of it.
- **D-13:** Trigger is the same as `test-pglite` / `test-postgres`: every push and PR.
- **D-14:** The job is **not** added as a required status check on the `main` ruleset in this
  phase. The README notes it may become required once it has been stable for a while; changing
  the ruleset is an outward-facing action that happens only on Johan's explicit OK.
- **D-15:** Cache `conformance/jsforce/.cache/jsforce` (clone + `npm ci` + `tsc` output) with
  `actions/cache` keyed on the pinned sha (D-04). Job keys follow the phase 1 convention (job
  key only, no `name:` field) so ruleset contexts stay predictable if it is ever made required.

### Acceptance evidence
- **D-16:** Add `--strict` to `orglet check`: exit 1 when any warning (metadata-load or
  `FormulaRegistry`) was printed, exit 0 otherwise; default behaviour unchanged (always 0).
  Covered by a CLI test (acme → 0 with `--strict`; a fixture producing a warning → 1). The
  ACCEPT-01 criterion is literally
  `node packages/cli/dist/index.js check --strict --project ~/Development.nosync/devrandom-metadata`
  returning 0 with zero `warning:` lines on stderr.
- **D-17:** New top-level `conformance/README.md`: a dated overview table with one row per
  check (DE retrieve check, jsforce subset, simple-salesforce script, describe-check,
  poly-check, rollup-check) giving date, orglet commit, SDK version/sha, result, and a link to
  the harness README. It states that the DE row comes from the author's own retrieved metadata,
  run locally, never stored in the repo or run in CI, and that no org is contacted or compared.
  The raw `orglet check` output (counts and warning lines only) is recorded in `.planning` as in
  phases 3 and 5; nothing from the retrieve is copied into the repo.
- **D-18:** Harness READMEs present numbers as a dated table: date, pinned SDK version/sha,
  orglet commit, passed / failed / excluded, followed by one row per excluded test with a
  classification (`bulk-v1-excluded`, `ui-api`, `test-defect`, `not-implemented`, ...) and the
  reason. The old undated per-file table in `conformance/jsforce/README.md` (commit `9bae14e`,
  "Bulk API is not implemented") is removed.
- **D-19:** Fix every stale conformance/acceptance statement found: jsforce README's
  `UNSUPPORTED:soql-for` (now accepted), "404 on `/updated` / `/deleted`", "Bulk 404 on
  `/services/data/*/jobs/ingest`", "phase 1" references; `.planning/codebase/TESTING.md` and
  `INTEGRATIONS.md` conformance numbers and "cli has no tests"; `PROJECT.md` Active list
  "today: 15"; root `README.md` status line "Bulk ... excluded". Each stays truthful and dated.

### Folded Todos
- **Reword ROADMAP phase 7 to validate against the DE retrieve, not the org** (planning,
  2026-10-01). Problem: `.planning/ROADMAP.md` line 14 says the re-run validates "against
  Johan's real Developer Edition org", which contradicts the Developer MSA constraint and
  PROJECT.md. Fix: change to "against the metadata retrieved from Johan's Developer Edition and
  both SDK conformance suites"; add one sentence to the root README's non-affiliation/legal note
  stating the author's own retrieved metadata is used as local test input and no org is
  contacted or compared. Fits D-17/D-19.

### Claude's Discretion
- Exact number and shape of the Python bulk2 checks (D-08), as long as ingest and query are
  both exercised and results are asserted per row.
- Exact `-t` regex and the mechanism for the v1 re-registration quirk (D-03), as long as D-02
  holds (no upstream patches).
- Whether the CI job runs orglet from `dist` or via `tsx`, how the OAuth token for the
  harnesses is obtained in CI, and how `seed.mjs` data is handled there.
- Column layout of the tables (D-17/D-18) and the classification vocabulary, as long as every
  exclusion has a reason.
- Order of work within the phase (e.g. `--strict` first, DE check last after everything else
  is merged into the phase branch), subject to the DE check being re-run on the final code.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase scope and requirements
- `.planning/ROADMAP.md` — Phase 7 goal and success criteria (section "Phase 7"); line 14 is
  the sentence the folded todo rewords.
- `.planning/REQUIREMENTS.md` — ACCEPT-01, ACCEPT-02, ACCEPT-03 (lines 130-138) and the
  traceability table (lines 229-231).
- `.planning/PROJECT.md` — Constraints (Legal: no behaviour-diffing against a real org; Data:
  Level 1 only), Key Decisions table, Active list ("today: 15" to correct), verified baseline
  2026-09-29 (lines 170-173).
- `.planning/todos/pending/2026-10-01-reword-roadmap-phase-7-to-validate-against-the-de-retrieve-not-the-org.md`
  — the folded todo with exact wording.

### Prior phase hand-offs
- `.planning/phases/06-bulk-api-2-0-persistence/06-CONTEXT.md` — `<deferred>` section:
  `bulk2.test.ts` decision handed to phase 7; Bulk v1 out of scope; "classify each previously
  excluded test before broadening the filter"; lines 248-250 describe today's conformance state.
- `.planning/research/PITFALLS.md` — Pitfall 21 (line ~804): classify excluded Bulk tests
  before widening the filter; newly included tests may expect v1 or differently shaped seed data.
- `.planning/phases/05-roll-up-summary-fields/05-07-PLAN.md` — line 139: the exact DE check
  command and the handling rules (line 73: Level 1, local only, record counts and warning lines
  only).
- `.planning/phases/05-roll-up-summary-fields/05-07-SUMMARY.md` — lines 105-115: latest DE
  result (2026-10-09: exit 0, 0 `warning:` lines, `37 objects (2 custom), 983 fields`).
- `.planning/phases/03-thin-standard-object-baselines/03-CONTEXT.md` — D-11: the
  `conformance/describe-check` pattern the later checks copy; D-03a on how Johan may consult his
  own org's describe (orglet never does).

### Conformance harnesses (current state to update)
- `conformance/jsforce/README.md` — authoritative "Expected results (phase 0, verified
  2026-09-25)" section (lines 152-188): 51 passed / 2 failed / 58 skipped; the `-t` filter on
  line 160; exclusion list lines 172-183; stale per-file table lines 95-102; Jest import quirk
  lines 104-110; stale "declared gaps" lines 114-116.
- `conformance/jsforce/run.sh` — clone/reset of jsforce `main`, default file list lines 32-41
  (includes `bulk.test.ts`, omits `bulk2.test.ts`), no filter.
- `conformance/jsforce/seed.mjs` — seed data (2500 `BigTable__c`, 8 Accounts × 2 Contacts × 2
  Opportunities), API `v62.0`.
- `conformance/python/run.py` — 26 `check()` cases; constants at top; stale "expected to FAIL"
  comment lines 103-108; no README exists.
- `conformance/python/requirements.txt` — `simple-salesforce` unpinned, `cryptography==43.0.3`.
- `conformance/describe-check/`, `conformance/poly-check/`, `conformance/rollup-check/` — the
  targeted SDK checks (both legs each) and their READMEs saying "manual until phase 7 decides".
- `conformance/describe-check/contract.json` — shared with `packages/api/src/api.test.ts`.

### Code touched by this phase
- `packages/cli/src/main.ts` — `check` command (lines 72-84): always `return 0`, options
  `--project` / `--quiet`, warnings to stderr as `warning: ...`; `--strict` goes here.
- `packages/cli/src/main.test.ts` — existing CLI test (asserts exit 0 on acme) to extend.
- `packages/api/src/routes/bulk.ts` — Bulk 2.0 routes (lines 239-426); nothing serves
  `/services/async`.
- `.github/workflows/ci.yml` — jobs `test-pglite`, `test-postgres`; step order
  install → build → lint → test; no `name:` fields (phase 1 decision for ruleset contexts).

### Codebase maps to correct
- `.planning/codebase/TESTING.md` — lines 148-179 (conformance description, 51/2/58, 26/26),
  lines 48/175 ("cli has no tests", outdated).
- `.planning/codebase/INTEGRATIONS.md` — line 137 (Bulk v1 not implemented), lines 169-201
  (harness description and numbers).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `conformance/jsforce/run.sh` + `.cache/jsforce` build: reused by describe/poly/rollup
  jsforce legs; the CI cache (D-15) serves all of them.
- `conformance/python/requirements.txt` + venv: reused by the python legs of the targeted checks.
- `conformance/describe-check` layout: the template for how a targeted SDK check is structured
  and documented; `conformance/README.md` (D-17) links to each.
- `packages/cli/src/main.ts` `check` branch already collects `result.warnings` and
  `FormulaRegistry` warnings in one place; `--strict` is a counter plus a return value.
- `.github/workflows/ci.yml` Postgres 16 service-container setup from `test-postgres` is the
  model for the conformance job's database.

### Established Patterns
- `UNSUPPORTED:<area>` is printed by `orglet check` as `warning: UNSUPPORTED:<area> ...` on
  stderr; areas reachable from a metadata load today: `object-kind`, `standard-object`,
  `standard-field`, `reference-target`, `field-type`, `rollup-target`, `rollup-type`,
  `rollup-filter`, `rollup-cycle`, `formula`, `formula-global`. `--strict` must count all of
  them (and any non-UNSUPPORTED warning).
- CI job keys without `name:` so ruleset status-check contexts match (phase 1).
- Conformance harnesses are external, manual, and not part of `pnpm test`; the phase changes
  the "manual" half, not the "external" half.
- Phase branches `gsd/phase-07-conformance-re-run-milestone-acceptance`, PR to ruleset-protected
  `main`; both existing checks must stay green.

### Integration Points
- `conformance/jsforce/run.sh` file list and `-t` regex (D-03/D-05) — single place that decides
  what the jsforce numbers mean.
- `conformance/python/run.py` `check()` list — where bulk2 checks are appended (D-08).
- `.github/workflows/ci.yml` — new job (D-12..D-15).
- `packages/cli/src/main.ts` `check` + USAGE text — `--strict` (D-16).
- Docs: `conformance/README.md` (new), `conformance/jsforce/README.md`,
  `conformance/python/README.md` (new), root `README.md` (status line + legal note),
  `.planning/ROADMAP.md` line 14, `.planning/PROJECT.md`, `.planning/codebase/TESTING.md`,
  `.planning/codebase/INTEGRATIONS.md`, `.planning/REQUIREMENTS.md` (ACCEPT-0x checkboxes).

</code_context>

<specifics>
## Specific Ideas

- The jsforce README and `run.sh` must agree: "run `run.sh`" produces the README numbers.
- Every exclusion carries a classification keyword plus a one-line reason; a reader should be
  able to tell "Salesforce feature orglet lacks" from "test defect" from "Bulk v1 by design".
- The DE retrieve check is the last thing run in the phase, on the final phase-branch code, and
  the recorded line is the `N objects (M custom), F fields` summary plus `0 warnings`, nothing
  else from the retrieve.
- Johan's running `devrandom` dev server (port 8180) may serve as a final human checkpoint for
  the harnesses as in earlier phases, but CI and the documented numbers use `examples/acme`.

</specifics>

<deferred>
## Deferred Ideas

- Making the conformance CI job a required status check on `main` (D-14) — revisit after it has
  been stable; needs Johan's explicit OK (ruleset change).
- Patching or forking jsforce e2e tests so `Query#update`/`destroy` and `search records` run
  through Bulk 2.0 — rejected for this phase (D-02); could be an upstream contribution to
  jsforce (make `insertAccounts` use `bulk2`) later.
- Bulk API v1 (`/services/async`) — out of milestone scope (phase 6 deferred).
- Running Heimdall (`../heimdall`) as an end-to-end backup target — later conformance target
  (phase 6 deferred; prerequisites listed in `06-CONTEXT.md`).
- `orglet check --json` machine-readable output — not needed for acceptance; `--strict` suffices.

### Reviewed Todos (not folded)
- "Narrow baseline OwnerId referenceTo per object" (metadata, 2026-10-08) — a metadata
  behaviour change; the DE retrieve already loads with 0 warnings (2026-10-09), so ACCEPT-01
  does not depend on it. Belongs in a later milestone.
- "Support Relationship:Object.Field colon syntax for polymorphic formula references" (formula,
  2026-10-08) — needs an upstream sigha change plus resync; not required for ACCEPT-01.
  Phase 4 D-16 follow-up, later milestone.

</deferred>

---

*Phase: 07-conformance-re-run-milestone-acceptance*
*Context gathered: 2026-10-11*
