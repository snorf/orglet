# orglet

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

## Layout

```
packages/metadata   SFDX source format + standard objects -> OrgSchema
packages/schema     OrgSchema -> Postgres DDL, migrations, ID generation
packages/formula    Salesforce formula language bound to record context
packages/soql       SOQL AST -> parameterised SQL, result shaping
packages/engine     DML pipeline, order of execution, trigger hook interface
packages/api        Salesforce-compatible REST and login endpoints
packages/cli        orglet up / reload / reset
examples/           SFDX fixture projects used by tests
conformance/        Runs upstream SDK test suites against orglet
```

## Development

Requires Node 22 (`.nvmrc`), pnpm via corepack, and Docker.

```sh
corepack enable pnpm
pnpm install
pnpm db:up        # Postgres 16 on localhost:5433
pnpm build
pnpm test
pnpm lint
```

## License

Apache-2.0. See `LICENSE`.
