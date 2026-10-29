# Conformance

orglet's claim is that a Salesforce client cannot tell the difference for the surface orglet supports.
These checks run real client SDKs (jsforce, simple-salesforce) against a local orglet, plus a load check of
real-world metadata retrieved from the author's own Developer Edition.

## Overview

| Check | Date | orglet commit | SDK | Result | Details |
|---|---|---|---|---|---|
| DE retrieve check (`orglet check --strict`) | 2026-10-29 | 05ddbe9 | n/a | exit 0, 0 warnings, 55 objects (2 custom), 3625 fields; info: 39 unreferenced | [DE retrieve check](#de-retrieve-check) |
| enterprise fixture check (`orglet check --strict --project examples/enterprise`) | 2026-10-29 | 05ddbe9 | n/a | exit 0, 0 warnings, 63 objects (10 custom, 53 standard), 3737 fields (57 custom, 3680 standard); info: 41 | [examples/enterprise/README.md](../examples/enterprise/README.md) |
| jsforce e2e subset: core | 2026-10-29 | 05ddbe9 | jsforce 9bae14e (3.10.26) | 51 passed / 0 failed / 60 excluded | [jsforce/README.md](jsforce/README.md) |
| jsforce e2e subset: Bulk API 2.0 | 2026-10-29 | 05ddbe9 | jsforce 9bae14e (3.10.26) | 12 passed / 0 failed / 5 excluded | [jsforce/README.md](jsforce/README.md) |
| simple-salesforce script | 2026-10-29 | 05ddbe9 | simple-salesforce 1.12.10 | 29/29 passed | [python/README.md](python/README.md) |
| describe-check | 2026-10-29 | 05ddbe9 | jsforce 9bae14e (3.10.26), simple-salesforce 1.12.10 | jsforce 32/32, simple-salesforce 32/32; enterprise 38/38 each | [describe-check/README.md](describe-check/README.md) |
| poly-check | 2026-10-29 | 05ddbe9 | jsforce 9bae14e (3.10.26), simple-salesforce 1.12.10 | jsforce 5/5, simple-salesforce 5/5; enterprise 6/6 each | [poly-check/README.md](poly-check/README.md) |
| rollup-check | 2026-10-29 | 05ddbe9 | jsforce 9bae14e (3.10.26), simple-salesforce 1.12.10 | jsforce 5/5, simple-salesforce 5/5; enterprise 6/6 each | [rollup-check/README.md](rollup-check/README.md) |
| cmdt-check | 2026-10-29 | 05ddbe9 | jsforce 9bae14e (3.10.26), simple-salesforce 1.12.10 | jsforce 8/8, simple-salesforce 8/8 | [cmdt-check/README.md](cmdt-check/README.md) |

Every row except the two fixture checks (DE retrieve, enterprise) and cmdt-check runs against `examples/acme` on a fresh schema and, in CI, also against `examples/enterprise`; cmdt-check runs
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
| 2026-10-29 | exit 0, 0 warnings, 55 objects (2 custom), 3625 fields; info: 39 unreferenced |

## Large real-org retrieve

ACC2-03: a large retrieve from a real org, run locally by the author only (never stored in this repository, never
used in CI, no org contacted by orglet, no behaviour compared). Recorded from `orglet check --summary`, which prints
counts only. Accepted standard-field exclusions are counted in the section above.

| Date | Census | Verdict | Areas (count) |
|---|---|---|---|
| 2026-10-29 | 181 objects (128 custom, 53 standard), 6702 fields (1907 custom, 4795 standard); 146 feature-gated standard fields included; custom metadata: 127 records in 22 types; 716 custom labels | 150 warnings to review (root causes: 150, dependents: 0, informational: 311) | UNSUPPORTED:custom-metadata-record 24; UNSUPPORTED:formula 28; UNSUPPORTED:object-kind 11; UNSUPPORTED:reference-target 50; UNSUPPORTED:standard-field 37; info:custom-setting-no-data 20; info:reference-target-skipped 36; info:standard-object-unmodelled 255 |

The ACC2-03 criterion (zero warnings for everything the retrieve references) is not met at commit 05ddbe9:
`UNSUPPORTED:standard-field` is 37 against 19 accepted exclusions, and four other warning areas are non-zero. The
warnings are being triaged into generic Salesforce areas for a follow-up gap-closure plan.

## Accepted standard-field exclusions

Standard fields that a real retrieve can reference but the baseline does not model stay `UNSUPPORTED:standard-field`
(Phase 14, closing todo 2026-10-16). They are recorded as counts per reason, never as names.

| Reason | Count |
|---|---|
| Reference target outside the baseline | 8 |
| Field type not modelled (geolocation compound) | 1 |
| No public source and not in the author's DE describe | 10 |
