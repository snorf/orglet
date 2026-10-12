# simple-salesforce conformance

A self-contained script (`run.py`, no test framework) that drives the `simple_salesforce` Python SDK
against a running orglet and prints `[PASS]`/`[FAIL]` per check followed by a summary. It never stops at
the first failure; the exit code is 0 only if every check passed.

## What's here

- `run.py`: the harness (29 checks).
- `requirements.txt`: `simple-salesforce==1.12.10`; `cryptography==43.0.3` is pinned for a prebuilt
  macOS wheel (see the comment in the file).

## Prerequisites

- Node 22 and a built orglet (`pnpm build`), plus Postgres (`pnpm db:up`).
- A Python 3.12 venv:

  ```sh
  /opt/homebrew/bin/python3.12 -m venv conformance/python/.venv
  SYSTEM_VERSION_COMPAT=0 conformance/python/.venv/bin/pip install -r conformance/python/requirements.txt
  ```

  A `.venv` created with an x86 interpreter fails on Apple silicon with "bad CPU type": recreate it with
  an arm64 Python 3.12.

## Reproducing

```sh
node packages/cli/dist/index.js reset --org-schema pyconf --drop-prefixes
node packages/cli/dist/index.js up --project examples/acme --org-schema pyconf --port 8091 --quiet &
BASE_URL=http://localhost:8091 conformance/python/.venv/bin/python conformance/python/run.py
node packages/cli/dist/index.js reset --org-schema pyconf --drop-prefixes   # after stopping the server
```

| Variable          | Default                 |
| ----------------- | ----------------------- |
| `BASE_URL`        | `http://localhost:8180` |
| `ORGLET_USERNAME` | `admin@orglet.local`    |
| `API_VERSION`     | `59.0`                  |

Auth is permissive (password `x`). CI runs this script in the `conformance` job of
`.github/workflows/ci.yml`.

## Results

| Date | simple-salesforce | Python | orglet commit | Passed | Failed | Excluded |
| ---- | ----------------- | ------ | ------------- | ------ | ------ | -------- |
| 2026-10-12 | 1.12.10 | 3.12.13 | 93f32f4 | 29 | 0 | 0 |

No check is excluded.

## What is covered

1. describe and metadata (global describe, `Account.describe()`, `Account.metadata()`)
2. create (Account, Contact)
3. get, upsert (create and update) and `get_by_custom_id`
4. update
5. query, `query_all` and `query_more` including 210-row pagination
6. validation rule error
7. delete and `query_all` with `IsDeleted`
8. limits and search (SOSL answers the documented empty shape only)
9. composite sobjects and composite with `@{ref}` substitution
10. error envelopes (required field, invalid field, expired session)
11. Bulk API 2.0: ingest insert with per-row successful and failed results, query job, delete

## Known gaps

- SOSL (`sf.search`) returns a well-formed empty `searchRecords`; check 8b asserts the shape only.
- The `HttpRewriteSession` shim rewrites `https://` to `http://` because simple-salesforce always builds
  https URLs; orglet serves plain HTTP locally.
