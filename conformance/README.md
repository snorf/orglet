# Conformance

orglet's claim is that a Salesforce client cannot tell the difference for the surface orglet supports.
These checks run real client SDKs (jsforce, simple-salesforce) against a local orglet, plus a load check of
real-world metadata retrieved from the author's own Developer Edition.

## Overview

| Check | Date | orglet commit | SDK | Result | Details |
|---|---|---|---|---|---|
| DE retrieve check (`orglet check --strict`) | 2026-10-16 | 00354b4 | n/a | exit 0, 0 warnings, 55 objects (2 custom), 3647 fields; info: 39 unreferenced | [DE retrieve check](#de-retrieve-check) |
| jsforce e2e subset: core | 2026-10-14 | fb9c397 | jsforce 9bae14e (3.10.26) | 51 passed / 0 failed / 60 excluded | [jsforce/README.md](jsforce/README.md) |
| jsforce e2e subset: Bulk API 2.0 | 2026-10-14 | fb9c397 | jsforce 9bae14e (3.10.26) | 12 passed / 0 failed / 5 excluded | [jsforce/README.md](jsforce/README.md) |
| simple-salesforce script | 2026-10-14 | fb9c397 | simple-salesforce 1.12.10 | 29/29 passed | [python/README.md](python/README.md) |
| describe-check | 2026-10-14 | fb9c397 | jsforce 9bae14e (3.10.26), simple-salesforce 1.12.10 | jsforce 32/32, simple-salesforce 32/32 | [describe-check/README.md](describe-check/README.md) |
| poly-check | 2026-10-14 | fb9c397 | jsforce 9bae14e (3.10.26), simple-salesforce 1.12.10 | jsforce 4/4, simple-salesforce 4/4 | [poly-check/README.md](poly-check/README.md) |
| rollup-check | 2026-10-14 | fb9c397 | jsforce 9bae14e (3.10.26), simple-salesforce 1.12.10 | jsforce 5/5, simple-salesforce 5/5 | [rollup-check/README.md](rollup-check/README.md) |
| cmdt-check | 2026-10-21 | 7660878 | jsforce 9bae14e (3.10.26), simple-salesforce 1.12.10 | jsforce 8/8, simple-salesforce 8/8 | [cmdt-check/README.md](cmdt-check/README.md) |

Every row except the DE retrieve check and cmdt-check runs against `examples/acme` on a fresh schema and, in CI, also against `examples/enterprise`; cmdt-check runs
against `conformance/cmdt-check/project` on its own server and schema. On enterprise the jsforce core subset is 50 passed / 0 failed / 61 excluded (one
enterprise-only classified exclusion, see [jsforce/README.md](jsforce/README.md)); the table above is the acme run.

## Running everything

```sh
pnpm build
PORT=8094 ORG_SCHEMA=final7 PYTHON=conformance/describe-check/.venv/bin/python conformance/run-all.sh
```

To run against the enterprise fixture instead:

```sh
PROJECT=examples/enterprise PORT=8096 ORG_SCHEMA=ent_run PYTHON=conformance/describe-check/.venv/bin/python conformance/run-all.sh
```

With `PROJECT=examples/enterprise` the script also seeds the enterprise custom settings (`examples/enterprise/seed.mjs`),
runs describe-check over `describe-check/objects-enterprise.txt` as well, and passes `FIXTURE=enterprise` to poly-check
and rollup-check; CI runs both projects as a matrix in the `conformance` job.

`run-all.sh` starts its own server against `examples/acme` plus a second one against `conformance/cmdt-check/project`
(port `CMDT_PORT`, default `PORT`+1; schema `CMDT_SCHEMA`, default `<ORG_SCHEMA>_cmdt`, also fresh), runs every leg
above and stops both servers.
`PORT` (default 8093), `ORG_SCHEMA` (default `conformance_run`; must be a fresh schema, the script never
resets one) and `PYTHON` (default `conformance/python/.venv/bin/python`) are read from the environment.
Clean up afterwards with `node packages/cli/dist/index.js reset --org-schema <schema> --drop-prefixes` and the same
for the second schema: `node packages/cli/dist/index.js reset --org-schema <schema>_cmdt --drop-prefixes`.

CI runs it in the `conformance` job of `.github/workflows/ci.yml` on every push and pull request. It is not a
required status check on `main`; it may become one after it has been stable for a while (changing the ruleset
needs the maintainer's explicit decision).

## DE retrieve check

The milestone acceptance check (ACCEPT-01) loads the metadata the author retrieved from his own Salesforce
Developer Edition (`sf project retrieve`) with `orglet check --strict`. It runs locally on the author's machine
only: the retrieved metadata is never stored in this repository or used in CI, no Salesforce org is contacted by
orglet, and orglet's behaviour is never compared with an org's. Only the exit code, the number of `warning:`
lines and the summary line are recorded.

| Date | Result |
|---|---|
| 2026-09-29 | 15 warnings (baseline) |
| 2026-10-09 | 0 warnings, 37 objects (2 custom), 983 fields |
| 2026-10-12 | exit 0, 0 warnings, 37 objects (2 custom), 983 fields |
| 2026-10-16 | exit 0, 0 warnings, 55 objects (2 custom), 3647 fields; info: 39 unreferenced |

## Accepted standard-field exclusions

Standard fields that a real retrieve can reference but the baseline does not model stay `UNSUPPORTED:standard-field`
(Phase 14, closing todo 2026-10-16). They are recorded as counts per reason, never as names.

| Reason | Count |
|---|---|
| Reference target outside the baseline | 8 |
| Field type not modelled (geolocation compound) | 1 |
| No public source and not in the author's DE describe | 10 |
