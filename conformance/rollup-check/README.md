# rollup-check

Runs a small roll-up summary check through the real SDKs (jsforce and simple-salesforce)
against a running orglet: the describe flags of a roll-up field (`calculated`, not createable,
not updateable), the live recompute on insert, a SOQL filter and sort over a roll-up column, the
rejection of a direct write (`INVALID_FIELD_FOR_INSERT_UPDATE`) and the recompute on delete. Each
script creates an Account, a `Project__c` and two `Milestone__c` with a run tag in the names, and
deletes the Account (which cascades the rest) when done.

## Files

- `jsforce.mjs`: jsforce leg.
- `sf_rollup.py`: simple-salesforce leg.

## Prerequisites

- Node 22 and the jsforce build that `../jsforce/run.sh` leaves in `../jsforce/.cache/jsforce`.
- Python 3.12 in a venv of its own (`conformance/rollup-check/.venv`, or reuse `../describe-check/.venv`).

## Running

```sh
node packages/cli/dist/index.js up --project examples/acme --org-schema rollup_check --port 8083 --quiet &
BASE_URL=http://localhost:8083 node conformance/rollup-check/jsforce.mjs
/opt/homebrew/bin/python3.12 -m venv conformance/rollup-check/.venv
SYSTEM_VERSION_COMPAT=0 conformance/rollup-check/.venv/bin/pip install -r conformance/python/requirements.txt
BASE_URL=http://localhost:8083 conformance/rollup-check/.venv/bin/python conformance/rollup-check/sf_rollup.py
```

Stop the server and remove the throwaway schema afterwards:

```sh
node packages/cli/dist/index.js reset --org-schema rollup_check --drop-prefixes
```

Expected output: five PASS lines, a total, and exit code 0.

```
PASS describe-flags ...
PASS recompute-insert ...
PASS soql-filter-sort ...
PASS write-rejected ...
PASS recompute-delete ...
jsforce: 5/5 passed
```

A failing check prints `FAIL <check> <reason>` and the script exits 1.

This check is manual. It is not run in CI until phase 7 decides on the conformance setup.
