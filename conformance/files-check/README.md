# files-check

Runs the Files surface (Phase 15, FILE-03..08) through the real SDKs, jsforce and simple-salesforce,
against a running orglet. Each script deletes the records it creates (deleting the ContentDocument
cascades to versions and links).

## Files

- `jsforce.mjs`: jsforce leg, 7 checks.
- `sf_files.py`: simple-salesforce leg, 5 checks.

## What each check proves

jsforce (expected 7/7):

- `upload-json`: a ContentVersion with base64 `VersionData` and `FirstPublishLocationId` is created.
- `computed-fields`: `Checksum` (MD5), `ContentSize`, `FileType` TEXT, `VersionNumber` 1, `IsLatest` and the `VersionData` URL are server-computed.
- `blob-download`: `record(id).blob('VersionData')` returns the uploaded bytes exactly.
- `second-version`: a version on the same ContentDocument becomes version 2 and latest; the document's `LatestPublishedVersionId` follows.
- `link-query`: the publish location produced one ContentDocumentLink (`ShareType` V, `Visibility` AllUsers), found with a `LinkedEntityId` filter.
- `link-filter-required`: an unfiltered ContentDocumentLink query fails with `MALFORMED_QUERY`.
- `multipart-refused`: a multipart create is refused with `UNSUPPORTED:content-multipart`. Multipart upload is FILE-10 (deferred), so the leg asserts the refusal.

simple-salesforce (expected 5/5):

- `upload-json`: 64 KiB of random bytes uploaded as base64 (`PathOnClient` `files-check.bin`).
- `computed-fields`: checksum, size, `FileType` UNKNOWN (`.bin` has no mapping) and the `VersionData` URL.
- `get-base64`: `get_base64(id, 'VersionData')` returns the exact bytes.
- `link-filter-required`: unfiltered ContentDocumentLink query gives `MALFORMED_QUERY`.
- `delete-cascade`: deleting the ContentDocument leaves no ContentVersion behind.

## Running

```sh
node packages/cli/dist/index.js up --project examples/acme --org-schema files_check --port 8082 --quiet &
BASE_URL=http://localhost:8082 node conformance/files-check/jsforce.mjs
BASE_URL=http://localhost:8082 conformance/python/.venv/bin/python conformance/files-check/sf_files.py
```

Stop the server and remove the schema afterwards:

```sh
node packages/cli/dist/index.js reset --org-schema files_check --drop-prefixes
```

Each script exits non-zero unless exactly the expected number of checks ran and passed (jsforce also
exits 2 when the jsforce build is missing; run `conformance/jsforce/run.sh` once to create it).
