---
phase: 15-files-model
plan: 03
subsystem: metadata, baseline generator
tags: [baseline, content-document-link, base64, blob-field]
requires: ["15-01"]
provides:
  - "ContentDocumentLink generated baseline object (06A, unverified)"
  - "ContentVersion.VersionData as Base64 (not updateable); ContentVersion.ContentDocumentId required with cascade"
  - "UNSUPPORTED:blob-field generator area (MODELLED_BLOB_FIELDS allow-list)"
affects: [15-04, 15-05, 15-06, 15-07, 15-08]
key-files:
  modified:
    - scripts/gen-baseline/typemap.ts
    - scripts/gen-baseline/pipeline.ts
    - scripts/gen-baseline/overrides.json
    - scripts/gen-baseline/objects.json
    - packages/metadata/standard/objects/ContentVersion.json
    - packages/metadata/standard/PROVENANCE.json
  created:
    - packages/metadata/standard/objects/ContentDocumentLink.json
    - scripts/gen-baseline/source/sf-skills/ContentDocumentLink.json
    - scripts/gen-baseline/source/object-reference/ContentDocumentLink.json
key-decisions:
  - "CDL undeletable false derived from Supported Calls (source wins); no flags override"
  - "Blob skips stay in the fieldType buckets; only the reported token changes to blob-field"
duration: 25min
completed: 2026-11-04
---

# Phase 15 Plan 03: Files-model baseline Summary

ContentDocumentLink vendored and generated, VersionData modelled as Base64, ContentDocumentId made required with delete cascades, and the generator reports other base64 fields as UNSUPPORTED:blob-field.

## Tasks
1. Vendor ContentDocumentLink at the existing pins (no drift in other vendored files) - f098c7b
2. blob-field area, VersionData Base64, CDL and content overrides, regenerate - 86c0de7
3. Update loader, API, engine, CLI tests and describe-check list - a56157c

## Resulting baseline
- ContentDocumentLink: ContentDocumentId (required, cascade, child rel ContentDocumentLinks), LinkedEntityId (20 targets, cascade, no child relationship, featureGated tag emitted by the generator), ShareType (V/C/I restricted, required), Visibility (AllUsers/InternalUsers/SharedUsers restricted). Flags: create/update/delete true, undelete false.
- Only ContentVersion.json, ContentDocumentLink.json and PROVENANCE.json changed under standard/. FeedItem.ContentData is still omitted, now reported as UNSUPPORTED:blob-field.
- documented-fields skip ratio: 117/1414 = 0.0827, within the 0.103 bound (header comment updated).
- diff-allowlist.json unchanged; pnpm baseline:check green.

## Changed test expectations
- baseline-generator.test.ts: BASE2-06 split (junction/geolocation omitted set no longer contains VersionData or ContentData); new D-15, VersionData, ContentDocumentId and CDL tests; polymorphic count map gains CDL.LinkedEntityId = 20; BUSINESS list gains CDL.
- gen-baseline-typemap.test.ts: base64 maps to Base64.
- build.test.ts: NO_NAME_FIELD gains ContentDocumentLink; VersionData removed from the "not in schema" list; new files-model loader test.
- api.test.ts: CDL row, describe list 33. engine.test.ts: CDL flags. upgrade.test.ts: NEW_TABLES gains contentdocumentlink (EXPECTED_WARNINGS still []).
- object-reference-snapshot.test.ts: CDL Supported Calls. documented-fields.test.ts: header only.
- conformance/describe-check/objects.txt: ContentDocumentLink added.

## Deviations from Plan

**1. [Rule 3 - Blocking] CLI check snapshots needed updating**
- **Found during:** Task 3 full test run
- **Issue:** packages/cli/src/__snapshots__/check-acme*.txt encode object/field counts (57 -> 58 objects, 3649 -> 3661 fields, 146 -> 147 feature-gated); not listed in the plan.
- **Fix:** regenerated with vitest -u; diff reviewed, counts only.
- **Commit:** a56157c

**2. upgrade-owner.test.ts needed no change** (does not list created tables).

**3. ContentDocumentLink was not added to the BUSINESS table in build.test.ts**: that table asserts keyPrefixSource "de-describe" and a fixed length of 18; CDL is "unverified". A separate test covers it.

## Notes for Phase 18
ContentDocumentLink carries the generated CreatedDate/CreatedById/LastModifiedDate/LastModifiedById columns; a Heimdall CSV for it will not supply them, so the loader must synthesise them (e.g. from SystemModstamp).

## Verification
Run and green: pnpm build, pnpm test (57 files, 952 passed, 3 skipped pre-existing), pnpm lint, pnpm baseline:check, diff-allowlist unchanged. Not run: CI itself, conformance suites (jsforce/python/describe-check against a live server).

## Known Stubs
None.

## Self-Check: PASSED
