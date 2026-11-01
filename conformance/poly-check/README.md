# poly-check

Runs a small polymorphic-lookup check through the real SDKs (jsforce and simple-salesforce)
against a running orglet: a `Name`-object query on `Case.Owner`, an `Owner.Type` filter, a
`TYPEOF Owner` query and the rejection of an invalid `TYPEOF`, plus `owner-narrowed` (`Account.OwnerId` describes `[User]`,
`Case.OwnerId` describes `[Group, User]`) on every fixture. With `FIXTURE=enterprise` it also runs
`owner-colon-formula`: the Case formulas `Owner_User_Email__c` (`Owner:User.Email`) and
`Owner_Queue_Name__c` (`Owner:Queue.Name`) read on a User-owned and a Queue-owned Case (the
segment that does not match the owner's type is blank). Each script creates a Queue
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

Set `FIXTURE=enterprise` (and start orglet with `--project examples/enterprise`) to add the colon
check. Each script exits non-zero unless exactly the expected number of checks ran and passed:
`5/5` on acme (the default), `6/6` on enterprise.

```
PASS name-object ...
PASS type-filter ...
PASS typeof ...
PASS owner-narrowed ...
PASS owner-colon-formula ...   (FIXTURE=enterprise only)
PASS typeof-invalid ...
jsforce: 6/6 passed            (5/5 on acme)
```

A failing check prints `FAIL <check> <reason>` and the script exits 1.

CI runs both legs of this check on every push and pull request, in the `conformance` job of `.github/workflows/ci.yml` (through `conformance/run-all.sh`); it is not a required status check. The commands above remain the way to run it by hand.
