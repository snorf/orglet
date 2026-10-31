# describe-check

Runs the sObject describe calls through the real SDKs (jsforce and simple-salesforce) against a
running orglet, for a list of objects (default: the 14 thin objects of phase 3 and the 18 business objects of phase 10, 32 in all), and
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

`objects-enterprise.txt` lists the extra objects of the enterprise fixture (custom metadata types, custom settings and custom
objects). `conformance/run-all.sh` appends them to `objects.txt` and passes the combined list as arguments when
`PROJECT=examples/enterprise`; the expected total for that run is `38/38` (32 + 6) for each SDK. Both legs skip the `IsDeleted` system-field requirement for `__mdt` objects: custom metadata types have no recycle bin (Phase 11 D-16), and orglet does not fake the field.

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
jsforce: 32/32 passed
```

A failing object prints `FAIL <Object> <missing properties or the SDK error>` and the script exits 1.

CI runs both legs of this check on every push and pull request, in the `conformance` job of `.github/workflows/ci.yml` (through `conformance/run-all.sh`); it is not a required status check. The commands above remain the way to run it by hand.
