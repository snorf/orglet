# Phase 7: Conformance Re-Run & Milestone Acceptance - Research

**Researched:** 2026-10-12
**Domain:** SDK conformance harnesses (jsforce 3.10.26 Jest e2e, simple-salesforce), CLI flag, GitHub Actions job, doc hygiene
**Confidence:** MEDIUM (static analysis of jsforce source and orglet source; NO harness was run during research, so every "expected PASS/FAIL" below is a prediction, marked as such)

<user_constraints>
## User Constraints (from CONTEXT.md)

Locked decisions D-01..D-19 are in `.planning/phases/07-conformance-re-run-milestone-acceptance/07-CONTEXT.md` and
must be honoured verbatim by the planner. Short form:

- D-01 include `test/bulk2.test.ts` (17 tests); `test/bulk.test.ts` (Bulk v1) stays excluded; every non-passing bulk2 test classified individually.
- D-02 no patches to upstream jsforce tests, no `sed` rewriting in `run.sh`. Keep excluded: Query#update/destroy tests that call `insertAccounts` (Bulk v1), `search records`, layouts, list views, tabs, theme, recent, identity (https assert), `already existing` upsert, `randomly-waiting`.
- D-03 `-t` regex becomes v1-specific (see FINDING F-1: cannot be done in one Jest invocation).
- D-04 pin jsforce to a sha; README records sha + package version.
- D-05 `run.sh` default run IS the README run; broader run via args after `--`.
- D-06 target 0 failed; anything unpassable is excluded with a documented reason.
- D-07..D-11 python: create README.md, add Bulk 2.0 checks (26 + N), pin simple-salesforce, env vars for BASE_URL/USERNAME/API_VERSION, delete stale "expected to FAIL" comment.
- D-12..D-15 one separate CI job (job key only, no `name:`), same triggers, not a required check, cache `conformance/jsforce/.cache/jsforce` keyed on pinned sha.
- D-16 `orglet check --strict`: exit 1 when any warning printed.
- D-17/D-18 new `conformance/README.md`; dated tables in harness READMEs with classification per exclusion.
- D-19 fix every stale statement (inventory in section 7).

### Claude's Discretion
Number/shape of python bulk2 checks; exact `-t` regex and mechanism for the v1 re-registration quirk; CI via dist or tsx, token acquisition, seed handling; table layout and classification vocabulary; order of work (DE check last).

### Deferred Ideas (OUT OF SCOPE)
Required status check on main; patching jsforce tests; Bulk API v1; Heimdall; `orglet check --json`; the two reviewed-not-folded todos.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ACCEPT-01 | `orglet check` on DE retrieve: zero UNSUPPORTED warnings | `--strict` flag (section 5), DE procedure (section 8) |
| ACCEPT-02 | simple-salesforce script + jsforce subset re-run and green, Bulk tests classified | sections 1-4, 6 |
| ACCEPT-03 | conformance READMEs updated with dated numbers + reasons | sections 1, 2, 7, 9 |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- TypeScript strict, Node 22, pnpm 10+, ESM, relative imports end in `.js`, `import type` enforced by ESLint.
- Anything unimplemented is `UNSUPPORTED:<area>`; reuse existing areas.
- No behaviour diffing against a real org (Developer MSA). Using jsforce's public test source as the expected-behaviour oracle is fine; contacting an org is not.
- Level 1 data only. Do not read `~/Development.nosync/devrandom-metadata`; the DE check is executed by the executor with `orglet check` only, recording counts and warning lines only.
- Repo-local git identity Johan Karlsteen <johan@karlsteen.com>. Creating the GitHub repo / pushes / ruleset changes need Johan's OK (D-14).
- CI job keys carry no `name:` (phase 1 convention).
- GSD workflow: edits go through GSD commands.

## Summary

Three things shape the plan. First, **a single Jest invocation cannot include `bulk2.test.ts` while excluding Bulk v1** (F-1): Jest's `-t` is a global name filter, and 12 of the 17 `bulk2.test.ts` names are character-identical to names in `bulk.test.ts`, which `connection-crud.test.ts` and `query.test.ts` re-register through `import { insertAccounts } from './bulk.test'`. D-03's premise (a v1-specific regex) is therefore only achievable by running **two Jest invocations**: run 1 = the four core files with today's `bulk|Bulk` filter (extended by the two `insertAccounts`-based Query tests), run 2 = `test/bulk2.test.ts` alone with its own filter. No upstream patching is needed.

Second, static reading of orglet's Bulk 2.0 code against `bulk2.test.ts` predicts **at least three real incompatibilities** (F-2): (a) `failedResults` `sf__Error` is formatted `CODE:message:fields--` but the jsforce test asserts `...:Name --` (space before `--`); (b) empty-input ingest jobs end `Failed` ("no header row") so jsforce's two "empty input" tests throw; (c) the `successfulResults` shape for `delete`/`update` and the upsert-by-`Id` path are unverified. These are predictions; the executor's first task should be an unfiltered run of `bulk2.test.ts` to confirm before writing exclusions. The planner must decide (Open Question 1) between a ~1-line fidelity fix for (a) and excluding it as `fidelity-gap`.

Third, the jsforce clone in `.cache/jsforce` is already at `9bae14ea0f1b9dff3b0cb0862a3e5f525f25a29f` (package version **3.10.26**, `engines.node >=22`, committed 2026-09-22) which is the sha the README already cites, so pinning to it changes no numbers. `run.sh` currently does `fetch origin main && reset --hard origin/main` plus `npm ci` and `tsc` on every run, so the CI cache needs a guard.

**Primary recommendation:** pin jsforce to 9bae14e; restructure `run.sh` into two Jest runs (core files with filter; bulk2 with its own filter), aggregate exit codes; run bulk2.test.ts unfiltered once before deciding exclusions; add `--strict` via `parseArgs` boolean; add one `conformance` CI job modelled on `test-postgres`.

## Standard Stack

| Tool | Version | Purpose | Source |
|------|---------|---------|--------|
| jsforce (upstream clone) | 3.10.26 @ 9bae14ea0f1b9dff3b0cb0862a3e5f525f25a29f | e2e Jest suite (MIT) | read from `.cache/jsforce/package.json`, `git log -1` (HIGH) |
| Jest | the repo's own devDependency inside the clone | runner (`npx jest --forceExit`) | existing `run.sh` |
| Node | 22 (jsforce `engines.node >=22`; repo `.nvmrc` 22). Default shell node on this machine is v18.20.8; v22.23.3 is in `~/.nvm` | | verified by `node --version`, `ls ~/.nvm/versions/node` |
| simple-salesforce | see section 4 (NOT VERIFIED at time of first write) | python leg | |
| `node:util` `parseArgs` | built in | CLI flag parsing (already used in `main.ts`) | `packages/cli/src/main.ts:8,180` |

No new npm dependencies are needed anywhere in the phase.

## Don't Hand-Roll

| Problem | Use instead | Why |
|---------|-------------|-----|
| Selecting v1 vs v2 tests | two Jest invocations | `-t` cannot scope by file (F-1) |
| Pinning jsforce | `git fetch --depth 1 origin <sha>` + `checkout --detach FETCH_HEAD` | works with shallow clones locally and in CI |
| CLI arg parsing | existing `parseArgs` options table | add `strict: {type:"boolean"}`; unknown options throw otherwise |
| Warning fixture for the exit-1 test | temp SFDX dir written in the test (pattern in `packages/metadata/src/sfdx.test.ts:6-14`) | no new `examples/` fixture |

## 1. bulk2.test.ts classification (D-01/D-03/D-06)

**Imports (lines 1-10):** `assert`, `path`, `./helper/fs`, `jsforce`, `./helper/connection-manager`, `./config`, `./util`, `./helper/env`, and **type-only** imports from `jsforce/lib/api/bulk` and `jsforce/lib/api/bulk2`. It does **not** import `./bulk.test`, so it does not suffer the re-registration quirk. It defines its own local `insertAccounts` (line 16) using `conn.bulk2.loadAndWaitForResults`. `conn.bulk2.pollTimeout = 90000` (line 14). `config.ts` reads `SF_LOGIN_URL`, `SF_ACCESS_TOKEN`, `bigTable: 'BigTable__c'`; the test needs the same env as the other files. Data files `test/data/Account_bulk2_test.csv` (537 lines incl. quoted multi-line fields, 100 records, UPPERCASE headers `NAME,TYPE,PARENTID,...`) and `Account_bulk2_test_backquote.csv` (11 lines, backquote delimiter, header `NAME`TYPE`PHONE`WEBSITE`ANNUALREVENUE`) exist in the clone.

**Client flow (jsforce `src/api/bulk2.ts`):** `POST /services/data/vXX/jobs/ingest` (JSON) -> `PUT .../{id}/batches` (`Content-Type: text/csv`, null serialised as `#N/A`, line 1051) -> `PATCH .../{id}` `{state:"UploadComplete"}` -> poll `GET .../{id}` every 1 s until `JobComplete` (throws on `Failed`/`Aborted`) -> `GET successfulResults|failedResults|unprocessedrecords` (parsed as CSV, `Accept`/responseType text/csv) -> on error `DELETE .../{id}`. Query: `POST jobs/query` -> poll `GET jobs/query/{id}` -> loop `GET jobs/query/{id}/results[?locator=X]` until response header `sforce-locator` is `'null'` (line 548). For delete, jsforce sends only `Id` (JobDataV2._write, line ~1100); for insert it strips `Id,type,attributes`; update/upsert send `{Id, ...rest}`.

orglet side (`packages/api/src/routes/bulk.ts`): all five operations, query/queryAll, results paging with `Sforce-Locator` (`"null"` on last page, line ~408), `columnDelimiter` and `lineEnding` honoured on input and output, `#N/A` -> null, blank -> null on insert and "unchanged" on update/upsert/delete, relationship columns (header containing `.`) fail with `UNSUPPORTED:bulk-relationship-column`.

**Predictions (NOT run; confirm with one unfiltered run of `test/bulk2.test.ts` first).** Test names are exactly as in the file (two share a name).

| # | line | Test name | Exercises | Predicted | Class / reason |
|---|------|-----------|-----------|-----------|----------------|
| 1 | 72 | should bulk insert records and return result status | insert 200 ok + 1 row missing Name; asserts `failedResult.sf__Error === 'REQUIRED_FIELD_MISSING:Required fields are missing: [Name]:Name --'` | **FAIL** | `fidelity-gap`: `formatSaveError` (bulk.ts ~line 70) emits `...:Name--` (no space); `bulk/store.test.ts:71,79` bake `Name--` in. Message text itself matches (`Errors.requiredMissing`, engine errors.ts:30). One-line fix + two test edits, or exclude. |
| 2 | 118 | should bulk update and return updated status | local insertAccounts(20), REST `find` with `$like`, bulk update with `Id,Name` | PASS (expected) | needs `sf__Created === 'false'` on update: `toResultRow` gives `created=false` for update. OK |
| 3 | 142 | should bulk update with empty input and not raise client input error | insert with `input: []` -> PUT with empty body | **FAIL (likely)** | `not-implemented`/`empty-csv`: `processIngestJob` marks the job `Failed` with "InvalidBatch : the uploaded CSV had no header row" when header is empty (bulk.ts ~line 123), so `poll` throws. Whether jsforce even issues the PUT for an empty stream is NOT VERIFIED. |
| 4 | 159 | should bulk delete and return deleted status | insert 20, REST find, bulk delete (Id only) | PASS (expected) | `created` must be `'false'` for delete: yes |
| 5 | 178 | should bulk delete with empty input and not raise client input error | same as 3 | **FAIL (likely)** | same as 3 |
| 6 | 197 | should bulk insert from file and return inserted results (1st) | 100-row quoted multi-line CSV, `lineEnding LF`, then bulk delete cleanup | PASS (expected) | depends on UPPERCASE headers (`NAME`, `NUMBEROFEMPLOYEES`, `PARENTID`, `JIGSAW`, `JIGSAWCOMPANYID`, `SICDESC`...) resolving case-insensitively to Account fields; **NOT VERIFIED**. `JIGSAW`/`JIGSAWCOMPANYID` may be absent from orglet's Account baseline -> would become `standard-field` failures |
| 7 | 228 | should bulk insert from file and return inserted results (2nd, identical name) | same | as 6 | same name as 6, so any filter hits both |
| 8 | 259 | should bulk upsert from CSV file using backquote as a delimiter | `columnDelimiter: BACKQUOTE`, `externalIdFieldName: 'Id'`, CSV has NO Id column, asserts 10 successes with `sf__Created === 'true'` | **FAIL (likely)** | upsert with externalId `Id` and no Id column: engine upsert path with blank `Id` must insert and report `created`; behaviour NOT VERIFIED. Also needs the Account `Type`/`Phone`/`Website`/`AnnualRevenue` fields (exist in baseline, NOT VERIFIED) |
| 9 | 274 | should bulk query and get records | `SELECT Id, Name FROM BigTable__c` (2500 seeded rows) | PASS (weakly) | assertions sit in an `.on('end')` handler that the test does not await, so the test passes if the job completes. `test-defect` (assertions unobserved). Requires `seed.mjs` BigTable__c rows only for the count |
| 10 | 293 | should call bulk api from invalid session conn with refresh fn, and return result | 401 `INVALID_SESSION_ID` -> `refreshFn` -> retry, 100 accounts | PASS (expected) | orglet returns 401 `INVALID_SESSION_ID` for bad token (phase-0 harness already relies on it for v1/REST); retry of a streamed PUT body NOT VERIFIED |
| 11 | 330 | should call bulk api from invalid session conn without refresh fn, and raise error | expects `err.name === 'INVALID_SESSION_ID'` | PASS (expected) | |
| 12 | 358 | should bulk update using Query#update and return updated status | bulk2 insert 250, `Query#update` with `bulkApiVersion: 2`, null -> `#N/A` | PASS (expected) | v2 path, NOT the Bulk-v1 `insertAccounts`; `BillingState: null` via `#N/A` handled by `buildRecord`. Note `find(...).update` first runs a SOQL query returning all fields |
| 13 | 408 | ...Query#update with unmatching query and return empty array records | `CreatedDate < 1970-01-01` | PASS (expected) | no job created when no records (query.ts line ~1108, `records.length > thresholdNum` is false with 0 > 200; falls to REST update of empty list) |
| 14 | 425 | should bulk delete using Query#destroy and return deleted status | 250 accounts, `destroy({bulkApiVersion: 2})` | PASS (expected) | |
| 15 | 444 | ...Query#destroy with unmatching query and return empty array records | | PASS (expected) | |
| 16 | 459 | ...Query#update with bulkThreshold modified and return updated status | `bulkThreshold: 0` forces bulk2 for 20 records | PASS (expected) | |
| 17 | 509 | ...Query#destroy with bulkThreshold modified and return deleted status | | PASS (expected) | |

Classification keywords for exclusions that remain after the first real run: `fidelity-gap` (orglet deviates from documented/jsforce-asserted behaviour), `not-implemented`, `test-defect`, `seed-data`, `bulk-v1-excluded`, `ui-api`, `sosl`.

Seed data: Account is standard (no seed needed); `BigTable__c` (test 9) comes from `examples/acme` metadata + `conformance/jsforce/seed.mjs` (2500 rows, REST composite). `seed.mjs` uses `API_VERSION` default `v62.0`.

## 2. The `-t` filter and `run.sh` (D-03/D-05)

### F-1: names collide across v1 and v2 (HIGH, from reading all test files)

Test names in `bulk.test.ts` (16): see grep in the harness; identical to bulk2 names: `should bulk insert records and return result status`, `should bulk update and return updated status`, `should bulk delete and return deleted status`, `should bulk insert from file and return inserted results`, `should call bulk api from invalid session conn with refresh fn, and return result`, `should call bulk api from invalid session conn without refresh fn, and raise error`, and all six `should bulk ... using Query#update|Query#destroy ...` names. v1-only names: `should bulk update with empty input and raise client input error`, `should bulk delete with empty input and raise client input error`, `should bulk delete from file and return deleted results`, `should bulk query and get records with yielding file output`. v2-only names: `... with empty input and not raise client input error` (x2), `should bulk upsert from CSV file using backquote as a delimiter`, `should bulk query and get records`.

Because `connection-crud.test.ts:5` and `query.test.ts:8` import `./bulk.test`, all 16 v1 names are registered inside both files (32 extra tests), and they collide with 12 bulk2 names. A `-t` negative lookahead that lets bulk2's names through also lets the v1 copies through (they would fail against a server with no `/services/async`). **Resolution without patching: two invocations.**

### Recommended `run.sh` structure

```bash
CORE_FILES=(test/connection-crud.test.ts test/connection-meta.test.ts test/sobject.test.ts test/query.test.ts)
# Run 1: today's README filter, unchanged in intent, plus the two Query tests whose setup calls Bulk v1 insertAccounts
CORE_FILTER='^(?!.*(bulk|Bulk|layout|list view|listup list|search records|tabs list|theme information|identity information|already existing|randomly-waiting|allowBulk|recently accessed|Query#update and return updated records|Query#destroy and return deleted status)).*'
# Run 2: bulk2 only, with a filter listing only classified exclusions (empty by default if all pass)
BULK2_FILES=(test/bulk2.test.ts)
BULK2_FILTER='...'   # filled after the first real run
rc=0
npx jest --forceExit "${CORE_FILES[@]}" -t "$CORE_FILTER" || rc=1
npx jest --forceExit "${BULK2_FILES[@]}" ${BULK2_FILTER:+-t "$BULK2_FILTER"} || rc=1
exit $rc
```

Why `bulk|Bulk` can stay in run 1: none of the four core files has a test name containing "bulk"/"Bulk" except the `allowBulk` ones and the re-registered v1 copies, all of which are to be excluded. The two additional patterns are the exact `insertAccounts` callers in `query.test.ts` that are not caught today: line 265 `should update queried records using Query#update and return updated records` (calls `insertAccounts` at 268) and line 314 `should delete queried records using Query#destroy and return deleted status` (317). The `allowBulk` ones are lines 361 and 398 (callers at 364, 401). `connection-crud.test.ts` `should search records` (line 199) calls `insertAccounts` at 202.

`-t` is matched against the full name (describe titles + test title joined by space), so patterns must not accidentally match describe names: `recent records`, `identity`, `misc metadata` describe blocks are why `recently accessed`, `identity information`, `tabs list`, `theme information` are phrased on test titles. Keep as is.

Expected run-1 result: the README says 51 passed / 2 failed / 58 skipped; with the two failing tests moved into the filter expect **51 passed / 0 failed / 60 skipped** (the executor MUST re-measure; counts in this paragraph are derived, not run). Note the `updated/deleted` tests ("should get updated accounts...") are described as passing in the README; keep.

Arg handling: today `run.sh` takes `-- <jest args>` and, if given, REPLACES the default file list entirely (`JEST_ARGS` non-empty -> no defaults, no filter). Keep that semantic: anything after `--` bypasses both default runs (documented as "broader run"). Today's default file list (lines 32-41) includes `connection-session.test.ts` and `bulk.test.ts` and has no filter; it must change to the above. `connection-session.test.ts` contributes one real test (`urls`) and 11 `describe.skip`; recommend leaving it out to keep numbers comparable to the README history.

## 3. Pinning jsforce (D-04)

- Current clone: `HEAD 9bae14ea0f1b9dff3b0cb0862a3e5f525f25a29f`, committed 2026-09-22 17:08 UTC, message `chore(release): 3.10.26 [skip ci]`; `package.json` `"version": "3.10.26"`, `"engines": {"node": ">=22"}` (package.json:219). The working tree is clean; `lib/` and `node_modules/` (782 entries) are present (built).
- Proposed `run.sh` logic (works for a shallow clone, local and CI; GitHub allows fetching an exact sha):

```bash
JSFORCE_SHA=9bae14ea0f1b9dff3b0cb0862a3e5f525f25a29f
if [ ! -d "$CACHE_DIR/.git" ]; then
  mkdir -p "$CACHE_DIR" && git -C "$CACHE_DIR" init -q
  git -C "$CACHE_DIR" remote add origin https://github.com/jsforce/jsforce.git
fi
if [ "$(git -C "$CACHE_DIR" rev-parse HEAD 2>/dev/null)" != "$JSFORCE_SHA" ]; then
  git -C "$CACHE_DIR" fetch --depth 1 origin "$JSFORCE_SHA"
  git -C "$CACHE_DIR" checkout --detach -f FETCH_HEAD
  rm -f "$CACHE_DIR/.orglet-built"
fi
if [ ! -f "$CACHE_DIR/.orglet-built" ]; then
  (cd "$CACHE_DIR" && npm ci && npx tsc -p . --pretty) && touch "$CACHE_DIR/.orglet-built"
fi
```
  Guard = stamp file inside the cached dir, removed when the sha changes. This keeps a warm `actions/cache` hit from re-running `npm ci`/`tsc` (today's script always does). Whether `fetch --depth 1 origin <sha>` works against github.com: standard behaviour (uploadpack.allowReachableSHA1InWant is enabled on GitHub) but NOT VERIFIED here (no network write attempted).
- README/`conformance/README.md` records `jsforce @ 9bae14e (3.10.26)`.

## 4. simple-salesforce bulk2 (D-08/D-09/D-10)

**NOT VERIFIED in this research pass** (venv source `conformance/python/.venv/lib/python*/site-packages/simple_salesforce/bulk2.py` was not yet read). The executor/planner must, as a Wave 0 task: (1) `conformance/python/.venv/bin/pip show simple-salesforce cryptography`; (2) read `bulk2.py` for: `sf.bulk2.<Object>.insert(...)` signature (in 1.12.x it takes a `csv_file` path or `records=[...]` plus `batch_size`/`wait`; returns a list of dicts with `numberRecordsFailed`, `numberRecordsProcessed`, `numberRecordsTotal`, `job_id`), `download(...)` for query, whether results go to files, and which endpoints it polls (`/jobs/ingest/{id}`, `/successfulResults`, ...). Known orglet-side points that matter: `Sforce-Locator`/`Sforce-NumberOfRecords` are set on query results (bulk.ts ~407-408); `maxRecords` and `locator` query params are honoured (bulk.ts ~397-403); `contentType` is not validated; `lineEnding` LF/CRLF and all six `columnDelimiter` values are supported; PATCH accepts only `UploadComplete`/`Aborted`. `cryptography==43.0.3` purpose: NOT VERIFIED (likely a pin for `simple-salesforce[jwt]`/pyjwt-related install on this machine; check git blame/log of `requirements.txt` before dropping).

## 5. `orglet check --strict` (D-16)

Facts from `packages/cli/src/main.ts` (HIGH):
- `check()` is lines 72-83; warnings are printed at lines 80 (`result.warnings`) and 81 (`new FormulaRegistry(result.schema).warnings`), `return 0` at line 82. `--strict` = count both loops, `return strict && n > 0 ? 1 : 0`. `up()` also prints loader warnings but needs no change.
- Args: `parseArgs` at line 180 with an options table (lines 183-195); **unknown options throw**, so `strict: { type: "boolean" }` must be added, and `common()`/`check()` need the value passed (`check(c, values.strict === true)` at line 212).
- USAGE (lines 16-37): `orglet check [--project <sfdx-dir>]` at line 20 and the options list; add `--strict` to the usage line and an option description ("exit 1 if any warning was printed"). `--quiet` is not on the check usage line today. `main.test.ts:54-60` asserts specific usage substrings, so keep them intact.
- `--quiet` only gates `log()`; warnings use `console.warn` and still print, so `--strict --quiet` still reports and exits 1.
- Tests: `packages/cli/src/main.test.ts` calls `main([...])` directly (no spawn), spies `console.log`/`console.warn`, uses `ACME` fixture path (line 9). Existing check tests at lines 29-51; the "no warning at all for acme" test (41-45) is the base for `--strict` -> 0. For exit 1: write a temp SFDX project in the test, e.g. `objects/Foo__c/fields/Ext__c.field-meta.xml` with `<type>ExternalLookup</type>` (pattern and exact XML in `packages/metadata/src/sfdx.test.ts:6-14,103-111`), which yields an `UNSUPPORTED:field-type ... ExternalLookup` warning from `readSourceProject`. Whether `loadOrgSchema` forwards that warning into `result.warnings` was not read end-to-end (`packages/metadata/src/index.ts` lines 12-30); the test will prove it. Use `mkdtemp(join(tmpdir(), ...))` and clean up.
- The CLI test needs no database (check path never opens a pool).

## 6. CI conformance job (D-12..D-15)

Existing `ci.yml` (HIGH): triggers `push` + `pull_request` (branches main); `permissions: contents read`; concurrency group; jobs `test-pglite`, `test-postgres` with `actions/checkout@v7`, `pnpm/action-setup@v6`, `actions/setup-node@v7` (`node-version-file: .nvmrc`, `cache: pnpm`); Postgres service `postgres:16-alpine` user/password/db `orglet`, port 5432, `pg_isready` health options; job env `ORGLET_DATABASE_URL`.

Facts from `main.ts`: `up` takes `--project`, `--port` (or `PORT`, default 8080), `--db` (else `ORGLET_DATABASE_URL`), `--org-schema` (default `org`), permissive auth unless `--users`. Login for harnesses: `POST /services/oauth2/token` `grant_type=password&client_id=x&client_secret=y&username=admin@orglet.local&password=x` (jsforce README lines 49-53; permissive mode accepts any password, main.ts:150).

Sketch (job key only, no `name:`):

```yaml
  conformance:
    runs-on: ubuntu-latest
    services:
      postgres: { ...same as test-postgres... }
    env:
      ORGLET_DATABASE_URL: postgres://orglet:orglet@localhost:5432/orglet
    steps:
      - uses: actions/checkout@v7
      - uses: pnpm/action-setup@v6
      - uses: actions/setup-node@v7
        with: { node-version-file: .nvmrc, cache: pnpm }
      - uses: actions/setup-python@v5   # version NOT VERIFIED as current; check marketplace
        with: { python-version: "3.12" }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - uses: actions/cache@v4          # version NOT VERIFIED
        with:
          path: conformance/jsforce/.cache/jsforce
          key: jsforce-${{ hashFiles('conformance/jsforce/run.sh') }}-9bae14ea...   # key on the pinned sha
      - run: node packages/cli/dist/index.js up --project examples/acme --port 8081 --quiet &
      - run: for i in $(seq 1 30); do curl -sf http://localhost:8081/services/data && break; sleep 1; done
      - run: TOKEN=$(curl -s -X POST ...) ; echo "TOKEN=$TOKEN" >> $GITHUB_ENV
      - run: python3 -m venv conformance/python/.venv && conformance/python/.venv/bin/pip install -r conformance/python/requirements.txt
      - run: conformance/python/.venv/bin/python conformance/python/run.py
      - run: conformance/jsforce/run.sh http://localhost:8081 "$TOKEN" --seed
      - # describe-check / poly-check / rollup-check legs: NOT VERIFIED (READMEs not read; read them for invocation and prerequisites)
```

Readiness: `GET /services/data` returns JSON (jsforce README line 41-42 uses it); the existence of a dedicated health route in `routes/misc.ts` was NOT checked. Because backgrounded steps die with the step in GitHub Actions, start `up` inside the same `run:` block as the harness invocations (or use `nohup ... &` plus `disown`); verify by dry run. Fresh Postgres service means no `reset` is needed. Duration estimate (unverified): install+build ~1.5 min, jsforce `npm ci`+`tsc` ~1-2 min cold (cached afterwards), seed ~10 s, jsforce core ~1-2 min, bulk2 ~1-2 min, python <30 s; total about 6-9 min cold. `run.py` currently hard-codes `BASE_URL`/`USERNAME`/`API_VERSION` (D-10) and its login method was NOT read in this pass.

## 7. Stale text inventory (D-19)

NOT FULLY VERIFIED. Confirmed in `conformance/jsforce/README.md` (current text):
- lines 14, 114-116, 102, 174: "orglet doesn't implement the Bulk API", "Bulk API — not implemented ... 404 on `/services/async/*` and `/services/data/*/jobs/ingest`", table row `bulk.test.ts ... Bulk API is not implemented in orglet (404 on every job endpoint)`, "Bulk API v1/v2 ... not implemented, phase 1".
- line 121 `**FOR VIEW SOQL clause** — orglet returns a clean UNSUPPORTED:soql-for error.` (stale; now accepted per D-19)
- lines 129-130 `GET /sobjects/<Type>/updated, /deleted ... 404` (contradicted by lines 186-187 "updated/deleted windows" pass)
- lines 152, 174-177 "phase 0, verified 2026-09-25", "phase 1" references
- lines 95-102 undated per-file table (remove per D-18); lines 104-110 Jest quirk (keep, update to say bulk2 does not import bulk.test).
- line 15 "clones/updates jsforce `main`" -> pinned.
Still to grep by the executor (NOT VERIFIED here): `conformance/python/run.py` lines ~103-108 (stale "expected to FAIL" comment), `conformance/{describe,poly,rollup}-check/README.md` ("manual until phase 7 decides"), root `README.md` status/legal lines, `.planning/ROADMAP.md:14`, `.planning/PROJECT.md` "today: 15", `.planning/codebase/TESTING.md` (lines ~48, 148-179), `.planning/codebase/INTEGRATIONS.md` (lines ~137, 169-201), `.planning/REQUIREMENTS.md` ACCEPT checkboxes (lines 130-138) and traceability (229-231). Suggested sweep: `grep -rnE "soql-for|/updated|/deleted|not implemented|phase 1|jobs/ingest|has no tests|today: 15|real Developer Edition org" README.md conformance .planning/ROADMAP.md .planning/PROJECT.md .planning/codebase`.

## 8. DE check procedure (ACCEPT-01)

NOT VERIFIED in this pass (05-07-PLAN.md lines ~73/139 and 05-07-SUMMARY.md lines ~105-115 not yet quoted). From CONTEXT.md D-16/specifics: the literal command is

`node packages/cli/dist/index.js check --strict --project ~/Development.nosync/devrandom-metadata`

must exit 0 with zero `warning:` lines on stderr; record only the `N objects (M custom), F fields` summary line and `0 warnings`; latest recorded result 2026-10-09: exit 0, 0 warnings, `37 objects (2 custom), 983 fields`. Run last, on the final phase-branch code, build first (`pnpm build`), Node 22. The executor must quote 05-07-PLAN.md's wording verbatim when writing the plan. Researcher did not read or run anything against the retrieve directory.

## Common Pitfalls

1. **Widening the filter before classifying** (PITFALLS #21): run `bulk2.test.ts` unfiltered once, record per-test result, only then write `BULK2_FILTER`.
2. **Duplicate test names**: `-t` excludes by name across files and the two `should bulk insert from file...` tests share a name, so exclusions apply to both.
3. **Weak bulk2 query test** (#9): assertions in an un-awaited `end` handler; a "pass" does not prove row correctness. Document it as `test-defect`, and add the real row check to the python bulk2 check instead.
4. **Warm CI cache + `npm ci`/`tsc` every run** defeats D-15; use the stamp guard in section 3.
5. **Background server in Actions**: a `&` process started in a separate step does not reliably survive; start and use it in one step or use `nohup`.
6. **`parseArgs` strictness**: forgetting `strict` in the options table makes `check --strict` throw "Unknown option".
7. **Node version**: default shell node here is v18; jsforce and orglet need 22 (`nvm use 22`).
8. **Level 1 / Developer MSA**: DE result recorded as counts only; no org contact; the README must say so (D-17).

## State of the Art

jsforce 3.10.x ships `conn.bulk2` (Bulk API 2.0) and `Query#update/destroy` with `bulkApiVersion: 2`; the default remains v1 (`DEFAULT_BULK_API_VERSION = 1` in `src/query.ts`), which is why `query.test.ts` still needs `/services/async`.

## Environment Availability

| Dependency | Available | Version | Note |
|------------|-----------|---------|------|
| Node 22 | yes (via nvm) | v22.23.3 | default shell is v18.20.8 |
| Docker + Postgres | yes | postgres:16-alpine container on host port 5433 (Johan's dev DB; not touched by research) | |
| Johan's dev server | running on :8180 | | do not use for CI numbers (D-17 note) |
| Python venv | present at `conformance/python/.venv` | version NOT VERIFIED | |
| jsforce clone | present, built | 3.10.26 @ 9bae14e | |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest 3.2.x (`pnpm test`), root `vitest.config.ts`; jsforce Jest (external); python script (external) |
| Quick run command | `pnpm vitest run packages/cli/src/main.test.ts` |
| Full suite command | `pnpm build && pnpm lint && pnpm test` |

### Phase Requirements -> Test Map
| Req | Behaviour | Type | Command | Exists? |
|-----|-----------|------|---------|---------|
| ACCEPT-01 | `check --strict` exits 0 for acme, 1 when a warning prints | unit (CLI) | `pnpm vitest run packages/cli/src/main.test.ts` | extend existing file (Wave 0) |
| ACCEPT-01 | DE retrieve: exit 0, 0 warnings | manual (Johan's machine) | `node packages/cli/dist/index.js check --strict --project ~/Development.nosync/devrandom-metadata` | human only; record counts only |
| ACCEPT-02 | jsforce core + bulk2 green, 0 failed | external | `conformance/jsforce/run.sh <url> <token> --seed` (exit code = aggregate) | after run.sh rewrite |
| ACCEPT-02 | simple-salesforce script incl. bulk2 checks green | external | `conformance/python/.venv/bin/python conformance/python/run.py` | after run.py edit |
| ACCEPT-02 | same, reproducibly, in CI | CI job `conformance` | push/PR | new |
| ACCEPT-03 | READMEs contain dated numbers + a reason per exclusion | grep | `grep -c` for date, sha `9bae14e`, `3.10.26`, each exclusion keyword; no remaining `not implemented` Bulk text | docs |

### Sampling
Per task commit: `pnpm vitest run packages/cli/src/main.test.ts` (for CLI task) and `bash -n conformance/jsforce/run.sh`. Per wave: `pnpm build && pnpm lint && pnpm test` plus one local conformance run on a fresh `--org-schema` (jsforce README steps 1-3). Phase gate: full suite green, CI `conformance` job green, DE run last.

### Wave 0 Gaps
- [ ] unfiltered `bulk2.test.ts` run recorded (basis for exclusions)
- [ ] `pip show simple-salesforce` + read `bulk2.py` (section 4)
- [ ] `--strict` tests in `packages/cli/src/main.test.ts`

## Open Questions

1. **`sf__Error` format (`Name--` vs `Name --`)**: fix `formatSaveError` (1 line + `store.test.ts:71,79` + any bulk.test assertions) or exclude as `fidelity-gap`? Recommendation: fix, because the expected string comes from jsforce's public test source and the phase's purpose is conformance; needs Johan's OK since CONTEXT says no new features (this is a bug fix, not a feature).
2. **Empty-input ingest**: orglet fails the job (no header). Same decision: tiny fix (complete with zero records) vs exclusion as `not-implemented`.
3. **Upsert with `externalIdFieldName: 'Id'` and no Id column** (test 8): confirm by running.
4. **Single vs two Jest invocations** (F-1): confirm with Johan that D-03 is satisfied by two invocations.

## Sources

- HIGH: `.cache/jsforce` source (`test/bulk2.test.ts`, `src/api/bulk2.ts`, `src/query.ts`, `test/*.test.ts`, `package.json`), orglet `packages/api/src/routes/bulk.ts`, `packages/cli/src/main.ts`, `main.test.ts`, `.github/workflows/ci.yml`, `conformance/jsforce/{run.sh,README.md}`, `.planning/phases/06-*/06-VERIFICATION.md`.
- NOT consulted: simple-salesforce source, python `run.py`, describe/poly/rollup READMEs, 05-07 plan/summary, GitHub Actions marketplace versions.

## Metadata

**Confidence:** stack HIGH; bulk2 predictions MEDIUM-LOW (static); CI design MEDIUM; python section LOW (not researched).
**Research date:** 2026-10-12. **Valid until:** 2026-11-12 (jsforce pinned, so stable).

---

## ADDENDUM (2026-10-12): fills the "NOT VERIFIED" gaps in sections 4, 7, 8. Supersedes those paragraphs.

### 4'. simple-salesforce bulk2 (verified from the venv source)

- Installed: `simple_salesforce-1.12.10` (venv `conformance/python/.venv`, file `simple_salesforce/bulk2.py`), `cryptography-43.0.3`. Pin `simple-salesforce==1.12.10` (D-09).
- `cryptography==43.0.3` is NOT an SDK need: `requirements.txt` comment says it is a pin to a version with a prebuilt macOS wheel (otherwise pip builds the Rust extension against the wrong libcrypto when macOS reports 10.16; needs `SYSTEM_VERSION_COMPAT=0`). On ubuntu CI it is unnecessary but harmless; recommend keeping the pin and the comment for local parity (or a platform marker `; sys_platform == "darwin"`), planner's call.
- API: `sf.bulk2.<Object>.insert|update|upsert|delete(csv_file=None, records=None, batch_size=None, concurrency=1, column_delimiter=ColumnDelimiter.COMMA, line_ending=LineEnding.LF, quoting=csv.QUOTE_MINIMAL, wait=5)` (upsert also takes `external_id_field`), returning `List[Dict[str,int]]` (one dict per uploaded batch; the exact keys were NOT inspected: print them in the first run and assert on `numberRecordsProcessed`/`numberRecordsFailed` if present, else on the REST state). `records` is a list of dicts converted to CSV in memory (`_convert_dict_to_csv`), so no file is needed. `wait` is a sleep in seconds between job-state polls (default 5): use `wait=1` to keep run time low.
- Query: `sf.bulk2.<Object>.query(query, max_records=50000, column_delimiter, line_ending, wait=5)` is a generator yielding result chunks (docstring: locator, number_of_records, records); it creates the job, `wait_for_job`, then loops `get_query_results(job_id, locator, max_records)` with params `maxRecords` and `locator` (omitted when empty/"null"), reads response headers `Sforce-Locator` (`"null"` -> stop) and `Sforce-NumberOfRecords` (**required**: `int(result.headers["Sforce-NumberOfRecords"])`). orglet sets both on every results response (`routes/bulk.ts` ~407-408), so this path is served. `query_all` also exists.
- Per-row results: not returned by `insert`; they are fetched with `_client.download_ingest_results(file, job_id, "successfulResults"|"failedResults"|"unprocessedrecords")`, which writes a CSV FILE (headers `Content-Type: application/json`, `Accept: text/csv`). Via the handler this is `sf.bulk2.Account._client...`: a private attribute, acceptable in a conformance script but note it. Alternative that respects D-08 "results asserted per row" without private API: after insert, `sf.query("SELECT Id, Name FROM Account WHERE Name LIKE '<unique>%'")` and assert the count, plus one deliberately invalid row asserted through the returned job-summary `numberRecordsFailed`.
- Headers: `Authorization: Bearer`, `X-PrettyPrint: 1`; job create posts JSON incl. `lineEnding`, `columnDelimiter`, `contentType: "CSV"`; state changes use `PATCH` (`UploadComplete`, `Aborted`), which orglet permits. Any `Failed` state or HTTP error raises `SalesforceBulkV2LoadError`.
- Session: `run.py` builds `Salesforce(session_id=..., instance_url=BASE_URL, version=API_VERSION, session=HttpRewriteSession())` (run.py ~58-71). `SFBulk2Handler` takes `session=` too (bulk2.py:316), but that `Salesforce.__getattr__('bulk2')` forwards the custom session was seen only partially (`api.py:371-373`); verify that the https->http rewrite still applies, else bulk2 calls will go to https and fail.
- Mismatch risks vs orglet: (1) the same `Name--` formatting issue (section 1, Open Question 1) only matters if the python check asserts on `sf__Error`; avoid asserting on the error text. (2) blank-header/empty records: do not test. No other mismatch found.
- run.py facts: 27 `with check(` occurrences (D-08 says 26 `check()` cases; the 27th likely is the context-manager definition line or a duplicate grep hit, count NOT reconciled: executor must count PASS lines of a real run). Constants `BASE_URL = "http://localhost:8180"`, `USERNAME`, `API_VERSION = "59.0"` at lines 19-21 (default BASE_URL is Johan's dev server port 8180; for D-10 keep that default). Stale comment is lines 104-108 ("expected to FAIL"), mentioned in CONTEXT as lines 103-108.

### 6'. CI details confirmed

- `GET /services/data` is the readiness probe (routes/misc.ts:15 registers it); no separate health route found.
- Existing convention in phase 5 plan for throwaway servers: `--org-schema <x> --port <n> --quiet`, `curl -s http://localhost:<port>/services/data`, kill by recorded PID only. CI uses a fresh service container so reset is not needed.
- The describe/poly/rollup READMEs each say "This check is manual. It is not run in CI until phase 7 decides on the conformance setup." (`conformance/describe-check/README.md:44`, `poly-check/README.md:47`, `rollup-check/README.md:49`): update all three (D-12). Their jsforce legs load the clone via `createRequire(...)(join(HERE,'..','jsforce','.cache','jsforce'))` (exit 2 when missing), so run `run.sh` (which builds the clone) before them; env vars `BASE_URL`, `ORGLET_USERNAME`, `ORGLET_PASSWORD`, `API_VERSION` (default 59.0). Their python legs reuse the shared venv built from `conformance/python/requirements.txt` (`<venv>/bin/python conformance/<check>/sf_*.py` with `BASE_URL`). Exact script file names: `conformance/describe-check/{jsforce.mjs,sf_describe.py}`, `poly-check/{jsforce.mjs,sf_poly.py}`, `rollup-check/{jsforce.mjs,sf_rollup.py}`. Output contract: `PASS <check>`/`FAIL <check>` lines and `jsforce: N/M passed`, exit 1 on any FAIL. Their data prerequisites (e.g. whether poly/rollup need the jsforce `--seed` data or create their own) were NOT verified.
- The three targeted checks and jsforce core/bulk2 should run against separate org schemas or fresh state if they conflict (e.g. rollup-check used its own `--org-schema rollup_check`); in CI a single schema is acceptable only if the checks are independent: NOT VERIFIED, so order them: python run.py, describe, poly, rollup, then `run.sh --seed` last (seeds add rows; BigTable count must match the bulk2 query test only loosely).

### 7'. Stale text inventory (grep results, file:line)

| File:line | Current text (abridged) | Fix |
|-----------|--------------------------|-----|
| `conformance/jsforce/README.md:14` | "orglet doesn't implement the Bulk API the upstream script uses" | Bulk 2.0 exists; v1 not |
| `conformance/jsforce/README.md:15` | "clones/updates jsforce `main`" | pinned sha |
| `conformance/jsforce/README.md:95-102` | undated per-file table; bulk row "Bulk API is not implemented in orglet (404 on every job endpoint)" | remove (D-18) |
| `conformance/jsforce/README.md:114-116` | "Bulk API — not implemented ... 404 on `/services/async/*` and `/services/data/*/jobs/ingest`" | v1 only |
| `conformance/jsforce/README.md:121` | "`FOR VIEW` ... clean `UNSUPPORTED:soql-for` error" | now accepted |
| `conformance/jsforce/README.md:129-130` | "`/updated`, `/deleted`, `/tabs`, `/theme` — all 404" | updated/deleted now work (README:186-187 itself says so); tabs/theme remain 404 |
| `conformance/jsforce/README.md:152,155,174-177` | "Expected results (phase 0, verified 2026-09-25)", "phase-1 gaps", "not implemented, phase 1" | re-date, drop phase refs |
| `conformance/python/run.py:104-108` | "both are expected to FAIL" (trailing slash, fixed in 1c4d433) | delete (D-11) |
| `conformance/{describe,poly,rollup}-check/README.md:44/47/49` | "manual ... until phase 7 decides" | now in CI job |
| `README.md:30` | "M7 ... `simple-salesforce` 26/26, `jsforce` e2e subset 51 passing (Bulk, SOSL, layouts excluded)" | new numbers, Bulk 2.0 now included |
| `README.md:125` | "(`/services/async`) is not implemented." | already v1-specific: verify wording still true; keep |
| `.planning/ROADMAP.md:6,14` | "real Developer Edition org" (line 14 also: "sum of all six changes against Johan's real Developer Edition org and both SDK conformance") | line 14 per folded todo; line 6 says "a real Developer Edition retrieve" (fine) |
| `.planning/PROJECT.md:123` | "(today: 15)" | "0 as of 2026-10-09 (baseline 2026-09-29: 15)" then final result |
| `.planning/codebase/INTEGRATIONS.md:140,143` | line 140 already "Bulk v1 not implemented (Bulk 2.0 is)"; 143 "`FOR VIEW` ... `UNSUPPORTED:soql-for`" | fix 143; lines ~169-201 numbers (NOT located by grep) |
| `.planning/codebase/TESTING.md` ~48, 148-179 | "cli has no tests", 51/2/58, 26/26 | the grep patterns did not hit; executor must open the lines named in CONTEXT |
| `.planning/REQUIREMENTS.md:130-138` | ACCEPT-01..03 unchecked | tick at phase completion |

The root README legal/non-affiliation sentence to add (folded todo): author's own retrieved metadata is local test input; no org contacted or compared. Its exact current location in `README.md` was NOT checked.

### 8'. DE check, quoted

From `05-07-PLAN.md` (step 6, the ROLL-09 DE check): `node packages/cli/dist/index.js check --project ~/Development.nosync/devrandom-metadata > <scratch>/de-check.out 2> <scratch>/de-check.err; echo "exit=$?"`; "record the exit code, the `warning:` line count, every `warning:` line containing `UNSUPPORTED:field-type` or `UNSUPPORTED:rollup` verbatim, and the first summary line of stdout ... If the directory is absent, record 'DE retrieve not present ...'. Do not copy any file content beyond those lines." The safety block of the same plan (`<context>`): "Johan's DE retrieve ... is Level 1 and local only: read it only through `orglet check`, record only warning lines and counts in the SUMMARY, never copy files from it into the repo or into test fixtures." All commands need Node 22.
From `05-07-SUMMARY.md` "DE retrieve check": exit 0, `warning:` lines 0 (stdout and stderr), `UNSUPPORTED:field-type` lines 0, `UNSUPPORTED:rollup` lines 0; first stdout line `37 objects (2 custom), 983 fields`; the remaining stdout lines only list the two custom objects (`ObjectBackup__c`, `ObjectBackupRun__c`) with provisional prefixes. Johan's devrandom server (`--org-schema devrandom --port 8180`) started with no `warning:` lines on 2026-10-09.
Phase 7 repeat: same command with `--strict` added, run after `pnpm build` on the final phase-branch commit, redirect stdout/stderr to scratch files, record `exit=`, `warning:` count (must be 0), and the first stdout line only; write it into `.planning/phases/07-.../07-NN-SUMMARY.md`, and the date/commit into `conformance/README.md`.

### Items still NOT VERIFIED (planner must schedule as Wave 0 / first-task checks)

1. Actual pass/fail of every bulk2 test (static prediction only; no harness was run; run on a fresh `--org-schema` and port, never on Johan's :8180 server or the `org`/`devrandom` schemas).
2. Whether Account baseline contains every column of `Account_bulk2_test.csv` (e.g. `JIGSAW`, `JIGSAWCOMPANYID`, `SICDESC`, `ACCOUNTSOURCE`).
3. Python `insert()` return keys and whether `Salesforce(..., session=)` forwards the https->http rewrite session to bulk2.
4. `actions/*` current major versions beyond those already in ci.yml (`checkout@v7`, `pnpm/action-setup@v6`, `setup-node@v7`).
5. TESTING.md / INTEGRATIONS.md exact lines for harness numbers; root README legal paragraph location.
6. Whether `git fetch --depth 1 origin <sha>` succeeds from GitHub (standard, but not exercised).

## RESEARCH COMPLETE
