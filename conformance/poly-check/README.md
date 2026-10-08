# poly-check

Runs a small polymorphic-lookup check through the real SDKs (jsforce and simple-salesforce)
against a running orglet: a `Name`-object query on `Case.Owner`, an `Owner.Type` filter, a
`TYPEOF Owner` query and the rejection of an invalid `TYPEOF`. Each script creates a Queue
(Group), a Group-owned Case and a User-owned Case with a run tag in the names, and deletes them
again when done.

## Files

- `jsforce.mjs`: jsforce leg.
- `sf_poly.py`: simple-salesforce leg.

## Prerequisites

- Node 22 and the jsforce build that `../jsforce/run.sh` leaves in `../jsforce/.cache/jsforce`.
- Python 3.12 in a venv of its own (`conformance/poly-check/.venv`, or reuse `../describe-check/.venv`).

## Running

```sh
node packages/cli/dist/index.js up --project examples/acme --org-schema poly_check --port 8082 --quiet &
BASE_URL=http://localhost:8082 node conformance/poly-check/jsforce.mjs
/opt/homebrew/bin/python3.12 -m venv conformance/poly-check/.venv
SYSTEM_VERSION_COMPAT=0 conformance/poly-check/.venv/bin/pip install -r conformance/python/requirements.txt
BASE_URL=http://localhost:8082 conformance/poly-check/.venv/bin/python conformance/poly-check/sf_poly.py
```

Stop the server and remove the throwaway schema afterwards:

```sh
node packages/cli/dist/index.js reset --org-schema poly_check --drop-prefixes
```

Expected output: four PASS lines, a total, and exit code 0.

```
PASS name-object ...
PASS type-filter ...
PASS typeof ...
PASS typeof-invalid ...
jsforce: 4/4 passed
```

A failing check prints `FAIL <check> <reason>` and the script exits 1.

This check is manual. It is not run in CI until phase 7 decides on the conformance setup.
