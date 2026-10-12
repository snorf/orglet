# Conformance

orglet's claim is that a Salesforce client cannot tell the difference for the surface orglet supports.
These checks run real client SDKs (jsforce, simple-salesforce) against a local orglet, plus a load check of
real-world metadata retrieved from the author's own Developer Edition.

## Overview

| Check | Date | orglet commit | SDK | Result | Details |
|---|---|---|---|---|---|
| DE retrieve check (`orglet check --strict`) | pending | pending | n/a | pending: filled in as the phase's last step | see below |
| jsforce e2e subset: core | 2026-10-12 | 3b6ad5a | jsforce 9bae14e (3.10.26) | 51 passed / 0 failed / 60 excluded | [jsforce/README.md](jsforce/README.md) |
| jsforce e2e subset: Bulk API 2.0 | 2026-10-12 | 3b6ad5a | jsforce 9bae14e (3.10.26) | 12 passed / 0 failed / 5 excluded | [jsforce/README.md](jsforce/README.md) |
| simple-salesforce script | 2026-10-12 | 3b6ad5a | simple-salesforce 1.12.10 | 29/29 passed | [python/README.md](python/README.md) |
| describe-check | 2026-10-12 | 3b6ad5a | jsforce 9bae14e (3.10.26), simple-salesforce 1.12.10 | jsforce 14/14, simple-salesforce 14/14 | [describe-check/README.md](describe-check/README.md) |
| poly-check | 2026-10-12 | 3b6ad5a | jsforce 9bae14e (3.10.26), simple-salesforce 1.12.10 | jsforce 4/4, simple-salesforce 4/4 | [poly-check/README.md](poly-check/README.md) |
| rollup-check | 2026-10-12 | 3b6ad5a | jsforce 9bae14e (3.10.26), simple-salesforce 1.12.10 | jsforce 5/5, simple-salesforce 5/5 | [rollup-check/README.md](rollup-check/README.md) |

Every row except the DE retrieve check runs against `examples/acme` on a fresh schema.

## Running everything

```sh
pnpm build
PORT=8094 ORG_SCHEMA=final7 PYTHON=conformance/describe-check/.venv/bin/python conformance/run-all.sh
```

`run-all.sh` starts its own server against `examples/acme`, runs every leg above and stops the server.
`PORT` (default 8093), `ORG_SCHEMA` (default `conformance_run`; must be a fresh schema, the script never
resets one) and `PYTHON` (default `conformance/python/.venv/bin/python`) are read from the environment.
Clean up afterwards with `node packages/cli/dist/index.js reset --org-schema <schema> --drop-prefixes`.

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
| 2026-10-12 | pending |
