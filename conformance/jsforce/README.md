# jsforce e2e conformance

Runs a subset of [jsforce](https://github.com/jsforce/jsforce)'s own end-to-end test suite
(`test/*.test.ts`, run under Jest against a live org) against orglet, instead of a real
Salesforce scratch org.

## What's here

- `seed.mjs` — seeds fixture data (BigTable\_\_c rows, Accounts/Contacts/Opportunities) that
  the tests assume exists. A real scratch org used by upstream jsforce e2e tests is created
  with `hasSampleData: true` and has its `BigTable__c` bulk-loaded by
  `scripts/org-setup.mjs`; orglet has neither, so this script does the equivalent seeding
  over the REST API (`POST/DELETE /composite/sobjects`); the upstream script uses Bulk API v1, which orglet does not implement.
- `run.sh` — checks out jsforce at a pinned commit (`JSFORCE_SHA` in run.sh: `9bae14e`, jsforce 3.10.26) into
  `.cache/jsforce`, builds it once per pin (stamp file `.orglet-built`), optionally seeds, then runs two Jest
  invocations: the four core files with `CORE_FILTER`, then `test/bulk2.test.ts` with `BULK2_FILTER`. The default
  run is the run documented below. Upgrading the pin is a deliberate change that re-measures this README.

CI runs the default `run.sh` in the `conformance` job of `.github/workflows/ci.yml` on every push and pull
request (not a required check).

## Custom metadata added for this

`examples/acme/force-app/main/default/objects/` now includes two objects the jsforce suite
requires (from `test/config/index.ts` / `test/helper/env.ts` and
`test/package/JSforceTestSuite/objects/`):

- `BigTable__c` — no custom fields (AutoNumber Name only). Used to test query pagination
  (`queryMore`, `autoFetch`, `maxFetch`) against a table with >2000 rows.
- `UpsertTable__c` — one custom field, `ExtId__c` (Text, external ID). Used to test
  `sobject.upsert()`.

Standard objects (Account, Contact, Opportunity, Lead, Case, User) already existed in
examples/acme.

## Reproducing

### 1. Start orglet with its own schema

```sh
cd /Users/johankarlsteen/Development.nosync/local-salesforce
source ~/.nvm/nvm.sh && nvm use 22
node packages/cli/dist/index.js reset --org-schema jsconf
node packages/cli/dist/index.js up --project examples/acme --port 8081 --org-schema jsconf --quiet &
# wait until this returns JSON:
curl -s http://localhost:8081/services/data
```

### 2. Get an access token

Auth is permissive (any password is accepted unless `--users` is passed to `up`):

```sh
TOKEN=$(curl -s -X POST http://localhost:8081/services/oauth2/token \
  -d 'grant_type=password&client_id=x&client_secret=y&username=admin@orglet.local&password=x' \
  | node -pe 'JSON.parse(require("fs").readFileSync(0)).access_token')
```

### 3. Run the conformance subset

```sh
cd conformance/jsforce
./run.sh http://localhost:8081 "$TOKEN" --seed
```

`./run.sh` with no extra arguments reproduces the numbers below. `--seed` runs `seed.mjs` first. Omit it on repeat runs against the same org/schema if you
don't want more BigTable\_\_c/Account/Contact/Opportunity rows piled on top of the previous
run's (reset the schema instead — see step 1 — if you want a clean slate).

Arguments after `--` replace BOTH default runs with one `npx jest --forceExit <args>` (a broader run; its
numbers are not the documented ones), e.g. a different file subset:

```sh
./run.sh http://localhost:8081 "$TOKEN" -- test/query.test.ts
```

### 4. Stop the server

Stop the server with `kill <pid>` of the `up` process and clean up with
`node packages/cli/dist/index.js reset --org-schema jsconf --drop-prefixes`.

## Env vars jsforce's own test harness reads

From `test/helper/env.ts` / `test/config/index.ts`, picked up automatically by
`connection-manager.ts` (`conn._establish({ accessToken, instanceUrl: loginUrl })`):

| Var | Used as |
|---|---|
| `SF_LOGIN_URL` | `instanceUrl` (orglet's base URL, e.g. `http://localhost:8081`) |
| `SF_ACCESS_TOKEN` | `accessToken` |
| `SF_USERNAME` / `SF_PASSWORD` | only used by the SOAP/OAuth2 login describe blocks, which are `describe.skip`-ed in `connection-session.test.ts` — not needed here |

## Results

Measured with orglet commit `492c66a`, Node v22.23.3, after `seed.mjs` on a fresh org schema (2500
BigTable\_\_c rows, 8 Accounts x 2 Contacts x 2 Opportunities each). "Excluded by filter" counts tests Jest
reports as skipped; run 1 includes the Bulk v1 copies re-registered by the import quirk (16 per importing file).

### Run 1: core files (connection-crud, connection-meta, sobject, query)

| Date | jsforce | orglet commit | Node | Passed | Failed | Excluded by filter |
|---|---|---|---|---|---|---|
| 2026-10-12 | 9bae14e (3.10.26) | 492c66a | v22.23.3 | 51 | 0 | 60 |

### Run 2: test/bulk2.test.ts

| Date | jsforce | orglet commit | Node | Passed | Failed | Excluded by filter |
|---|---|---|---|---|---|---|
| 2026-10-12 | 9bae14e (3.10.26) | 492c66a | v22.23.3 | 12 | 0 | 5 |

### Run 1 against `examples/enterprise` (Phase 14, `PROJECT=examples/enterprise conformance/run-all.sh`)

Core files: 50 passed / 1 failed / 60 excluded (acme: 51 / 0 / 60); Bulk 2.0: 12 / 0 / 5 (unchanged). The one difference is
`sobject.test.ts` "should select records with asterisk and return records": `Opportunity.select('*, Account.*, Owner.Name')`
expands `Account.*` to every Account field, and the enterprise fixture adds formula fields to Account (`Gated_Check__c`,
`Owner_Email__c`). orglet refuses a formula field selected through a parent relationship
(`UNSUPPORTED:soql-formula formula field Account.Gated_Check__c on a parent relationship cannot be selected yet`,
`packages/soql/src/compile.ts`). Classification: known orglet gap (formula field on a parent relationship in SOQL), exposed
by the enterprise fixture, not a regression on acme.

## Exclusions

Every alternative in `CORE_FILTER` and `BULK2_FILTER` in run.sh has a row here.

| Pattern / test | Run | Classification | Reason |
|---|---|---|---|
| `bulk`, `Bulk`, `allowBulk` | 1 | bulk-v1-excluded | Bulk API v1 (`/services/async`) is out of scope; these are bulk.test.ts tests re-registered via the `insertAccounts` import, and Query tests forcing Bulk v1 |
| `Query#update and return updated records`, `Query#destroy and return deleted status` | 1 | bulk-v1-excluded | calls `insertAccounts`, which uses Bulk v1 (`DEFAULT_BULK_API_VERSION = 1` in jsforce `src/query.ts`) |
| `search records` | 1 | sosl | SOSL is a stub answering the documented empty shape; the test also calls `insertAccounts` (Bulk v1) |
| `layout`, `list view`, `listup list` | 1 | ui-api | describeLayouts family and list views are UI API territory, not implemented (404) |
| `tabs list`, `theme information`, `recently accessed` | 1 | not-implemented | `/tabs`, `/theme`, `/recent` answer 404 |
| `identity information` | 1 | plain-http | asserts an `https://` identity URL; orglet serves plain HTTP locally |
| `already existing` | 1 | test-defect | asserts `ret.id` on a 204 upsert-update, which jsforce's own `_upsertParallel` never populates; unsatisfiable by any spec-compliant server |
| `randomly-waiting` | 1 | timeout | streams with random per-record delays and exceeds the Jest timeout; not investigated |
| `with empty input and not raise client input error` (bulk update and bulk delete, 2 tests) | 2 | not-implemented | jsforce PUTs a 0-byte body; orglet marks the job Failed ("InvalidBatch : the uploaded CSV had no header row"); Salesforce behaviour for an empty upload is undocumented, so no change |
| `bulk insert from file and return inserted results` (2 tests with this name) | 2 | not-implemented | every row fails INVALID_FIELD on `JIGSAWCOMPANYID`; the Account baseline lacks the deprecated Data.com Jigsaw* fields |
| `bulk upsert from CSV file using backquote as a delimiter` | 2 | test-defect | the CSV has no Id column while `externalIdFieldName` is `Id`; every row fails REQUIRED_FIELD_MISSING [Id] on any server |

`should bulk query and get records` (run 2) passes but asserts inside an un-awaited `end` handler, so it proves
only that the job completes (test-defect noted; the simple-salesforce leg checks query rows).

## Jest import quirk

`connection-crud.test.ts` and `query.test.ts` both `import { insertAccounts } from './bulk.test'`. Because
jsforce's test files register `it()`/`describe()` at module top level, importing `bulk.test.ts` as a module
also re-registers *all of its own tests* into whichever file is currently running (a Jest/CommonJS quirk in
the upstream suite, not something specific to orglet). So a standalone run of `connection-crud.test.ts`
reports 31 tests (15 own + 16 from `bulk.test.ts`), and `query.test.ts` reports 37 (21 own + 16).

`bulk2.test.ts` does not import `bulk.test.ts`, but 12 of its 17 test names are identical to Bulk v1 names and
Jest's `-t` filter is global, so a single invocation cannot include Bulk 2.0 while excluding the re-registered
v1 copies. run.sh therefore runs Jest twice.

## Known gaps

- Bulk API v1 (`/services/async`) is not implemented.
- SOSL is a stub (`/search` answers `{"searchRecords":[]}`).
- UI API (layouts, list views), `/tabs`, `/theme` and `/recent` answer 404.
- Streaming, Metadata/Tooling API, Apex REST and Chatter are not exercised by this subset.
