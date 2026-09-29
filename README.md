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

Phase 0, headless. Nothing works yet. The plan:

| Milestone | Scope |
|---|---|
| M0 | Repo skeleton, toolchain, Postgres via docker compose |
| M1 | SFDX source-format metadata parser, built-in standard objects |
| M2 | Postgres schema generation and migration, Salesforce IDs |
| M3 | Formula engine (validation rules, formula fields) |
| M4 | DML engine implementing the documented order of execution |
| M5 | SOQL to SQL compiler with Salesforce result shaping |
| M6 | REST API: login, sobjects, query, describe, composite |
| M7 | Conformance: `jsforce` e2e subset and `simple-salesforce` script pass |

Later phases: UI API + LWC/SLDS front end, Flows, change events to Kafka/SQS, Apex.

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
