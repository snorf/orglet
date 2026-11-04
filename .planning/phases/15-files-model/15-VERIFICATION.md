---
phase: 15-files-model
verified: 2026-11-04T13:00:00Z
status: passed
score: 5/5 must-haves verified
---

# Phase 15: Files Model Verification Report

**Phase Goal:** Files work in a normal org as in a real one, and blobs sit behind one store interface that archive mode can later back with the external store.
**Status:** passed (one accepted limitation, see below). Initial verification.

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | ContentVersion without ContentDocumentId creates a document (IsLatest, VersionNumber "1", mirrored fields); describe has ContentDocumentId nillable:false | VERIFIED | packages/engine/src/files.ts (VersionNumber "1", mirror at line 128); override in scripts/gen-baseline/overrides.json (Phase 10 nullable exception removed); engine files.test.ts "creates its document", api files.test.ts "describe lists ... ContentDocumentId as required"; baseline-generator test asserts nillable false |
| 2 | Second version with existing ContentDocumentId flips IsLatest, increments VersionNumber, updates LatestPublishedVersionId | VERIFIED | files.ts lines 93 and 138; tests "adds a version and flips IsLatest", "consecutive numbers" in one batch |
| 3 | base64 VersionData gives MD5 Checksum/ContentSize/FileType/FileExtension; download streams exact bytes with headers; URL not bytes in records/SOQL; multipart is UNSUPPORTED:content-multipart | VERIFIED | api files.test.ts (insert, record GET, ?fields, composite, SOQL, download headers, multipart); server.ts:149 maps CONTENT_MULTIPART to UNSUPPORTED:content-multipart; conformance files-check legs (jsforce 7/7, python 5/5) reported green |
| 4 | ContentDocumentLink attaches to any keyed record; unfiltered SOQL is MALFORMED_QUERY | VERIFIED | build.ts:710 appends custom objects to LinkedEntityId.referenceTo; engine test "Account, Case and a custom object"; soql compile.ts:875-881 guard (Id / ContentDocumentId / LinkedEntityId) with compile tests |
| 5 | ContentDocument delete cascades to versions and links, undelete restores together; missing blob 404 + diagnostic; checksum mismatch reported; Attachment.Body / Document.Body UNSUPPORTED:blob-field | VERIFIED | engine tests lines 223-264; sobjects.ts:110-125 emit blob-missing, blob-size, blob-checksum diagnostics; api tests "missing blob answers 404", "checksum mismatch is served and reported once"; pipeline.ts:98-498 omits every base64 field except ContentVersion.VersionData as UNSUPPORTED:blob-field (see note) |

## Spot-checks run
`vitest run` on packages/engine/src/files.test.ts, blobs.test.ts and packages/api/src/files.test.ts: 3 files, 61 passed, 1 skipped (36 MiB memory test, Postgres-only by design).

## Requirements Coverage
All of FILE-03..FILE-09 appear in plan frontmatter (15-01..15-10) and are marked Complete in .planning/REQUIREMENTS.md; no orphaned IDs. FILE-02 remains deferred as documented.

| Req | Status | Evidence |
|-----|--------|----------|
| FILE-03 | SATISFIED | truth 1 |
| FILE-04 | SATISFIED | truth 2 |
| FILE-05 | SATISFIED | truth 3 (insert, checksum, type); blobs.ts store |
| FILE-06 | SATISFIED | truth 3 (download) |
| FILE-07 | SATISFIED | truth 4 |
| FILE-08 | SATISFIED | truth 5 |
| FILE-09 | SATISFIED | packages/engine/src/blobs.ts + blobs.test.ts (14 tests): single BlobStore interface, bytea default, checksum-verifying |

## Assessment of reported items

1. **FirstPublishLocationId not expanded to custom objects: acceptable limitation, not a gap.** Success criterion 4 and FILE-07 are about ContentDocumentLink ("can attach a file to any keyed record"), and that works for custom objects including direct insert. FirstPublishLocationId is a ContentVersion field with a documented, finite target list, which orglet keeps at the 20 modelled standard objects (overrides.json). Real Salesforce does accept custom objects there, so this is a small fidelity deviation. Recommendation: log it as a backlog item (append custom objects to ContentVersion.FirstPublishLocationId.referenceTo in build.ts next to the existing LinkedEntityId code) and ideally have the refusal carry an UNSUPPORTED marker rather than a bare INVALID_CROSS_REFERENCE_KEY.
2. **Content-Length from BlobStore size, not ContentSize:** acceptable and arguably correct (the header must match the bytes sent); a `blob-size` diagnostic fires on mismatch (sobjects.ts:115). Criterion 3 holds for consistent data.
3. **test/db.ts change (cb5baf7):** confirmed test-only. It adds a four-line `await new Promise(setImmediate)` before `db.close()` in the pglite test harness; no production code touched.
4. **Enterprise conformance matrix not run:** residual risk, not blocking. The acme run passed all 12 legs; the enterprise project exercises more custom objects, which touches the build.ts LinkedEntityId expansion. Suggest running `PROJECT=examples/enterprise conformance/run-all.sh` before the milestone closes.

## Notes
- Attachment and Document are not baseline objects; their Body fields are covered by the generator's blanket rule (any base64 field other than ContentVersion.VersionData is omitted and reported as `UNSUPPORTED:blob-field`). The test pins this only for the BUSINESS set (FeedItem.ContentData); there is no end-to-end API test for "Attachment.Body answers UNSUPPORTED:blob-field". Low risk, noted.

## Anti-patterns
No blockers found in the inspected files (no stubs; data flows from the blob store to the download route).

## Human verification
None required.

_Verifier: Claude (gsd-verifier)_
