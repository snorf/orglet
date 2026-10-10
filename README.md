# orglet

[![CI](https://github.com/snorf/orglet/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/snorf/orglet/actions/workflows/ci.yml)

A self-hosted, single-tenant emulator of the Salesforce platform. Point it at an SFDX
project and it builds the org in Postgres and speaks the Salesforce REST API, so existing
clients such as `jsforce` and `simple-salesforce` work unchanged.

Think "LocalStack, but for Salesforce": a local org for development, integration tests and
CI, with the long-term goal of a small self-hosted CRM you can later migrate to the real thing.

orglet is not affiliated with, sponsored by or endorsed by Salesforce, Inc. Salesforce, Apex,
Lightning and SOQL are trademarks of Salesforce, Inc. Everything here is built from public
documentation and open-source client SDKs; no Salesforce service is used for benchmarking.

## Status

Phase 0, headless, is complete: the REST API works end to end against Postgres and the
upstream SDK suites pass for everything phase 0 covers (see `conformance/`).

| Milestone | Scope | State |
|---|---|---|
| M0 | Repo skeleton, toolchain, Postgres via docker compose | done |
| M1 | SFDX source-format metadata parser, built-in standard objects | done |
| M2 | Postgres schema generation and migration, Salesforce IDs | done |
| M3 | Formula engine (validation rules, formula fields) on vendored sigha | done |
| M4 | DML engine implementing the documented order of execution | done |
| M5 | SOQL to SQL compiler with Salesforce result shaping | done |
| M6 | REST API: login, sobjects, query, describe, composite | done |
| M7 | Conformance: `simple-salesforce` 26/26, `jsforce` e2e subset 51 passing (Bulk, SOSL, layouts excluded) | done |

Later phases: UI API + LWC/SLDS front end, Flows, change events to Kafka/SQS, Apex.

## Quick start

```sh
pnpm db:up
pnpm build
node packages/cli/dist/index.js up --project examples/acme
```

Then point any Salesforce client at `http://localhost:8080`:

```sh
curl -s -X POST http://localhost:8080/services/oauth2/token \
  -d 'grant_type=password&client_id=x&client_secret=y&username=admin@orglet.local&password=anything'
# -> { "access_token": "...", "instance_url": "http://localhost:8080", ... }

curl -s -H "Authorization: Bearer $TOKEN" \
  'http://localhost:8080/services/data/v59.0/query?q=SELECT+Id,Name+FROM+Account'
```

`--project` takes the output of `sf project retrieve` (SFDX source format). Objects, fields,
validation rules, record types and value sets are read from it; standard objects come from the
built-in baseline. Anything not supported is logged as `UNSUPPORTED:<area>` rather than faked.

## Custom-object key prefixes

The first three characters of a Salesforce Id identify the object (`001` is Account). Standard
objects use their documented prefixes. Custom objects get `a00`, `a01`, ... assigned the first
time `orglet up` sees them against a database, and the assignment is stored in the
`_orglet.key_prefixes` table next to the org schema. From then on it is permanent for that object
name in that org: adding, removing or renaming other custom objects never changes it, so no existing
Id changes meaning. A database created before this feature keeps the prefixes its records already
carry.

- `orglet check` has no database, so the prefixes it prints are labelled `(provisional)`.
- `orglet reset` drops the org's tables but keeps the prefix assignments; `orglet reset --drop-prefixes`
  forgets them too (the next `up` assigns fresh ones).
- A prefix that would collide with a standard object or with another custom object's assignment
  fails `orglet up` with an error naming both objects. Nothing is written in that case.

To import records from a real org and keep their Ids valid, seed the prefixes that org uses:

```sh
cat > key-prefixes.json <<'EOF'
{ "Project__c": "a0X", "Milestone__c": "a0Y" }
EOF
node packages/cli/dist/index.js up --project my-sfdx-project --key-prefixes key-prefixes.json --import
```

The file maps custom-object API names to 3-character prefixes. It is consulted only for objects
that have no assignment yet and never overrides a stored one. orglet never connects to Salesforce;
read the values from your own org, for example
`sf sobject describe --sobject Project__c --json | jq -r '.result.keyPrefix'`.

## Thin standard objects

Besides the fully modelled standard objects, the baseline carries 14 objects a Developer Edition
org references but orglet models only thinly: BusinessHours, BusinessProcess, CallCenter,
DandBCompany, Entitlement, ExternalDataSource, IdeaTheme, Individual, OperatingHours,
OpportunityHistory, ServiceAppointment, ServiceContract, SocialPost and UserLicense. Each has its
documented key prefix, its name field (OpportunityHistory has none), the system fields and, where
the object is owned, `OwnerId`; no other business fields yet. Lookups to them are checked on save
like any other lookup.

DML follows the Object Reference's supported calls. A call an object does not support fails with
`INVALID_TYPE_FOR_OPERATION` (HTTP 400 over REST):

| Object | create | update | delete |
|---|---|---|---|
| ExternalDataSource, OpportunityHistory, UserLicense | no | no | no |
| CallCenter | yes | no | no |
| BusinessHours, BusinessProcess | yes | yes | no |
| the other eight | yes | yes | yes |

- `orglet up --import` bypasses these rules, so rows of read-only objects can be migrated from a
  real org.
- `orglet up` creates one default BusinessHours ("Default") and one UserLicense ("Salesforce") and
  points the System Administrator profile at it, once; existing rows are never changed.
- Every object gets the same system fields, so BusinessHours, BusinessProcess, CallCenter and
  UserLicense describe an `IsDeleted` field the real objects lack, UserLicense also `CreatedById`
  and `LastModifiedById`, and OpportunityHistory `LastModifiedDate` and `LastModifiedById`.
- Upgrading an existing database adds foreign keys for lookups that were unchecked before. If a
  row already holds an Id with no matching record (typically a lookup loaded with `--import`
  whose target was not imported), `orglet up` stops with
  `cannot add foreign key <name>: <schema>.<table>.<column> holds values with no matching row in ...`;
  clear or fix those values and run it again.

## Bulk API 2.0

Ingest jobs (insert, update, upsert, delete, hardDelete) and query jobs (query, queryAll) are served
on `/services/data/vXX.X/jobs/ingest` and `/jobs/query`. Processing is synchronous inside the request
that completes the upload or creates the query job, which answers with the final state. Bulk API v1
(`/services/async`) is not implemented.

- Jobs, the uploaded CSV and all results are stored in Postgres, in the `_orglet` schema
  (`_orglet.bulk_ingest_jobs`, `bulk_ingest_results`, `bulk_query_jobs`, `bulk_query_rows`), keyed by
  org schema, and survive a restart. Each 200-record chunk commits together with its results.
- On startup `orglet up` marks jobs a previous run left in `UploadComplete` or `InProgress` as `Failed`
  (message starting `ServerRestarted :`); `unprocessedrecords` then lists exactly the rows that were
  not processed.
- Jobs older than 7 days (from `createdDate`, in any state) are deleted at startup and on every `/jobs`
  request, as Salesforce does. The window is not configurable.
- `orglet reset` deletes the org's jobs along with its records; key prefixes still survive unless
  `--drop-prefixes`.
- Query jobs reject what Bulk API 2.0 does not support (TYPEOF, GROUP BY, OFFSET, aggregate functions,
  compound address and geolocation fields, FIELDS(), parent-to-child subqueries) with
  `400 FEATURE_NOT_ENABLED`; REST `/query` is unaffected.
- Limit: a job's uploaded CSV is held in one Postgres `text` value and in memory while it is processed
  (Postgres caps a value at 1 GB); split very large loads across jobs.
- Security: job data, including uploaded CSV, now outlives restarts. With the default permissive login
  anyone who can reach the port can read it; use `--users` outside a local machine.

## Layout

```
packages/metadata   SFDX source format + standard objects -> OrgSchema
packages/schema     OrgSchema -> Postgres DDL, migrations, ID generation
packages/formula    Salesforce formula language bound to record context
packages/soql       SOQL AST -> parameterised SQL, result shaping
packages/engine     DML pipeline, order of execution, trigger hook interface
packages/api        Salesforce-compatible REST and login endpoints
packages/cli        orglet up / check / reset
examples/           SFDX fixture projects used by tests
conformance/        Runs upstream SDK test suites against orglet
```

## Development

Requires Node 22 (`.nvmrc`) and pnpm via corepack. Docker is optional: the tests run against an
embedded Postgres (pglite), so Docker is only needed to run the server with `orglet up` or to run the
tests against a real Postgres 16.

```sh
corepack enable pnpm
pnpm install
pnpm build
pnpm test         # embedded pglite, no Docker needed
pnpm lint
```

To run the same tests against real Postgres, as the `test-postgres` CI job does:

```sh
pnpm db:up        # Postgres 16 on localhost:5433
ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test
```

## License

Apache-2.0. See `LICENSE`.
