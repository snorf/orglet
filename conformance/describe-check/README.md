# describe-check

Runs the sObject describe calls through the real SDKs (jsforce and simple-salesforce) against a
running orglet, for a list of objects (default: the 14 thin standard objects of phase 3), and
checks that every property the SDKs declare is present. It complements the CI test in
`packages/api/src/api.test.ts`, which reads the same `contract.json`.

## Files

- `objects.txt`: the objects checked by default, one API name per line (`#` comments).
- `contract.json`: the describe key sets (global entry, sObject describe, field, child
  relationship, urls, system fields), taken from jsforce's describe type declarations.
- `jsforce.mjs`: jsforce leg (`describeGlobal`, `describe`, `sobject().describe`).
- `sf_describe.py`: simple-salesforce leg (`describe()`, `<Object>.describe()`).

Both scripts read `contract.json` and `objects.txt` from this directory; object names given as
arguments override `objects.txt`.

## Prerequisites

- Node 22 and the jsforce build that `../jsforce/run.sh` leaves in `../jsforce/.cache/jsforce`.
- Python 3.12 in a venv of its own (the `conformance/python/.venv` may not match your CPU).

## Running

```sh
node packages/cli/dist/index.js up --project examples/acme --org-schema describe_check --port 8081 --quiet &
BASE_URL=http://localhost:8081 node conformance/describe-check/jsforce.mjs
/opt/homebrew/bin/python3.12 -m venv conformance/describe-check/.venv
SYSTEM_VERSION_COMPAT=0 conformance/describe-check/.venv/bin/pip install -r conformance/python/requirements.txt
BASE_URL=http://localhost:8081 conformance/describe-check/.venv/bin/python conformance/describe-check/sf_describe.py
```

Expected output: one line per object, then a total, and exit code 0.

```
PASS UserLicense keyPrefix=100 nameField=Name fields=... childRelationships=...
...
jsforce: 14/14 passed
```

A failing object prints `FAIL <Object> <missing properties or the SDK error>` and the script exits 1.

This check is manual. It is not run in CI until phase 7 decides on the conformance setup.
