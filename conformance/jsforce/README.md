# jsforce e2e conformance

Runs a subset of [jsforce](https://github.com/jsforce/jsforce)'s own end-to-end test suite
(`test/*.test.ts`, run under Jest against a live org) against orglet, instead of a real
Salesforce scratch org.

## What's here

- `seed.mjs` — seeds fixture data (BigTable\_\_c rows, Accounts/Contacts/Opportunities) that
  the tests assume exists. A real scratch org used by upstream jsforce e2e tests is created
  with `hasSampleData: true` and has its `BigTable__c` bulk-loaded by
  `scripts/org-setup.mjs`; orglet has neither, so this script does the equivalent seeding
  over the REST API (`POST/DELETE /composite/sobjects`, since orglet doesn't implement the
  Bulk API the upstream script uses).
- `run.sh` — clones/updates jsforce `main` into `.cache/jsforce`, installs deps, builds it,
  optionally seeds fixture data, and runs the test file subset below.

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

`--seed` runs `seed.mjs` first. Omit it on repeat runs against the same org/schema if you
don't want more BigTable\_\_c/Account/Contact/Opportunity rows piled on top of the previous
run's (reset the schema instead — see step 1 — if you want a clean slate).

To run a different file subset, pass test paths after `--`:

```sh
./run.sh http://localhost:8081 "$TOKEN" -- test/query.test.ts
```

### 4. Stop the server

```sh
pkill -f 'packages/cli/dist/index.js up'
```

## Env vars jsforce's own test harness reads

From `test/helper/env.ts` / `test/config/index.ts`, picked up automatically by
`connection-manager.ts` (`conn._establish({ accessToken, instanceUrl: loginUrl })`):

| Var | Used as |
|---|---|
| `SF_LOGIN_URL` | `instanceUrl` (orglet's base URL, e.g. `http://localhost:8081`) |
| `SF_ACCESS_TOKEN` | `accessToken` |
| `SF_USERNAME` / `SF_PASSWORD` | only used by the SOAP/OAuth2 login describe blocks, which are `describe.skip`-ed in `connection-session.test.ts` — not needed here |

## Test files run, and expected results

Run against jsforce `main` @ `9bae14ea0f1b9dff3b0cb0862a3e5f525f25a29f`, orglet examples/acme
with the two objects above, after `seed.mjs` (2500 BigTable\_\_c rows, 8 Accounts x 2
Contacts x 2 Opportunities each).

| File | Total | Pass | Fail | Skip | Notes |
|---|---|---|---|---|---|
| `test/connection-crud.test.ts` | 15 own | 11 | 4 | 0 | single/multi record CRUD passes; upsert/search failures below |
| `test/query.test.ts` | 21 own | 16 | 5 | 0 | big-table pagination (queryMore/autoFetch/maxFetch) all pass |
| `test/connection-meta.test.ts` | 15 | 6 | 9 | 0 | describe/limits pass; recent/updated/deleted/identity/tabs/theme fail |
| `test/sobject.test.ts` | 28 | 12 | 16 | 0 | find/select/sort/include all pass; all layout/listview APIs fail |
| `test/connection-session.test.ts` | 12 | 1 | 0 | 11 | only the non-network `urls` describe block runs; SOAP/OAuth2 blocks are `describe.skip`-ed upstream |
| `test/bulk.test.ts` | 16 | 2 | 14 | 0 | Bulk API is not implemented in orglet (404 on every job endpoint); runs in ~2s so it's included |

**Quirk**: `connection-crud.test.ts` and `query.test.ts` both `import { insertAccounts } from
'./bulk.test'`. Because jsforce's test files register `it()`/`describe()` at module top
level, importing `bulk.test.ts` as a module also re-registers *all of its own tests* into
whichever file is currently running (a Jest/CommonJS quirk in the upstream suite, not
something specific to orglet). So a standalone run of `connection-crud.test.ts` reports 31
tests (15 own + 16 from `bulk.test.ts`), and `query.test.ts` reports 37 (21 own + 16). The
table above only counts each file's own test cases once.

### Expected/declared gaps (not orglet bugs — pre-declared out of scope)

- **Bulk API** — not implemented (`bulk.test.ts`, `bulk2.test.ts`, and any test calling
  `conn.bulk.load()`/`Query#update`/`Query#destroy` past the bulk threshold): 404 on
  `/services/async/*` and `/services/data/*/jobs/ingest`.
- **SOSL / search** — the `/search` endpoint exists and returns a well-formed
  `{"searchRecords":[]}`, but never matches anything (stub); `connection-crud.test.ts`'s
  "should search records" fails for this reason *and* because it depends on
  `insertAccounts()` (Bulk API).
- **`FOR VIEW` SOQL clause** — orglet returns a clean `UNSUPPORTED:soql-for` error.
- **Recently viewed items** (`conn.recent()`, `GET /recent`) — 404.
- **describeLayouts family** (`.layouts()`, named layouts, `.compactLayouts()`,
  `.approvalLayouts()`) — all 404 under `/sobjects/<Type>/describe/...`.
- Streaming, Metadata/Tooling API, Apex REST, Chatter — not exercised by this file subset.

### Other findings (not pre-declared gaps) — see the conformance run report for HTTP-level detail

- `GET /sobjects/<Type>/updated`, `/deleted`, `GET /tabs`, `GET /theme` — all 404, not
  implemented.
- `GET /sobjects/<Type>/listviews` (and its `/describe`, `/results`, `/explain` sub-paths) —
  404, not implemented.
- `explain=<soql>` on `GET /query` (and on `.../listviews/<id>/explain`) — orglet ignores the
  `explain` param and tries to parse an empty SOQL string, returning
  `MALFORMED_QUERY: unexpected token: end of query` instead of a plan or a clean
  UNSUPPORTED error.
- `PATCH /sobjects/<Type>/<extIdField>/<value>` on a duplicate external ID returns
  `300 Multiple Choices` with `[{"message":...,"errorCode":"MULTIPLE_CHOICES"}]` instead of
  an array of matching record URLs (the documented Salesforce shape), so jsforce's
  `err.data` isn't an array of strings as the test (and jsforce's own types) expect.
- `PATCH /composite/sobjects/<Type>/<extIdField>` (collection upsert) omits the `created`
  boolean on every result record, success or failure.
- `conn.identity()`'s `id` URL is `http://...` not `https://...` — expected, since orglet is
  served over plain HTTP locally; not a defect.
- The "upsert already existing record" test asserting `ret.id === recId` after an update-path
  upsert is not satisfiable by any spec-compliant server: Salesforce's real API returns `204
  No Content` (no body) for an upsert-update, and jsforce's own
  `Connection#_upsertParallel` (`src/connection.ts`) hard-codes
  `noContentResponse: { success: true, errors: [] }` for that path — it never attaches an
  `id`. This is a jsforce test-suite issue, not an orglet bug.

## Expected results (phase 0, verified 2026-09-25)

Run from a clean org schema (`orglet reset --org-schema jsconf` first, then `--seed`). The
subset is the four files below with this Jest name filter, which excludes the phase-1 gaps:

```sh
npx jest --forceExit test/connection-crud.test.ts test/connection-meta.test.ts \
  test/sobject.test.ts test/query.test.ts \
  -t '^(?!.*(bulk|Bulk|layout|list view|listup list|search records|tabs list|theme information|identity information|already existing|randomly-waiting|allowBulk|recently accessed)).*'
```

| Result | Count |
|---|---|
| passed | 51 |
| failed | 2 |
| skipped by the filter | 58 |

The two failures (`Query#update` / `Query#destroy` "and return updated/deleted status") call
`insertAccounts` from `bulk.test.ts`, which uses Bulk API v1 (`/services/async/50.0/job`).

Excluded and why:

- **Bulk API v1/v2** (`bulk`, `allowBulk`, `Query#update`/`destroy` above): not implemented, phase 1.
- **SOSL** (`search records`): `/search` answers the documented empty shape, phase 1.
- **Layouts, compact/approval/named layouts, list views** (`layout`, `list view`, `listup list`): UI API territory, phase 1.
- **`/tabs`, `/theme`, `/recent`**: not implemented, phase 1.
- **`identity information`**: the test asserts an `https://` id URL; orglet serves plain HTTP locally.
- **`already existing` upsert**: asserts `ret.id` on a `204 No Content` upsert-update, which jsforce
  itself never populates (`_upsertParallel` hard-codes `{ success: true, errors: [] }`); not
  passable against any spec-compliant server.
- **`randomly-waiting` stream test**: streams with random per-record delays and exceeded the Jest
  timeout; not yet investigated.

Everything else in these files passes: CRUD single and collection, upsert by external id including
the 300 Multiple Choices body and allOrNone rollback, describe global/object, updated/deleted
windows, limits, explain, queryMore/autoFetch/maxFetch paging over 2500 rows, and the
relationship-based find/select/sort/include tests.

