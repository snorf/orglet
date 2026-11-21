---
phase: 16-archive-fixture-generator
verified: 2026-11-21T09:45:00Z
status: passed
score: 3/3 success criteria verified
---

# Phase 16: Archive fixture generator Verification Report

**Phase Goal:** A public, deterministic Heimdall-shaped backup of the acme org exists in the repo for every later archive test.
**Status:** passed. **Re-verification:** No.

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | One script under scripts/ boots orglet on examples/acme with a fixed clock and writes examples/acme-archive/ from Bulk 2.0 output in Heimdall field order | VERIFIED | scripts/gen-archive-fixture/{generate,build,org,seed,export,guard,indexrows,tree,readme}.ts; package.json scripts archive-fixture:gen/check; export.test.ts, seed.test.ts pass; bootstrapOrg takes options.now/ids (bootstrap.ts:20-22,55,68); openPgliteDb in test/db.ts |
| 2 | Two periods (202601, 202602), _deleted folders, Period=0/files blobs, index.sql dump of objects/csvfiles/backup_runs | VERIFIED | Tree has Period=202601 (16 CSVs) and 202602 (13 CSVs), Opportunity_deleted, Contact_deleted, UpsertTable__c_deleted, 4 blobs under Period=0/files/<cs[0:4]>/; index.sql creates backup_runs etc., ContentDocumentLink recorded as Failed run (MALFORMED_QUERY) |
| 3 | Byte-identical on repeat; blob MD5 equals ContentVersion Checksum | VERIFIED | fixture.test.ts (9 tests) passed incl. run under different system date; `pnpm archive-fixture:check` -> "checked 35 files", exit 0, git status clean; manual md5 of the 4 blobs equals the 32-hex Checksums in both ContentVersion CSVs |

**Score:** 3/3

## Must-haves by plan (01-06)
- 01: @orglet/archive package built (dist present), in root tsconfig.json references, vitest alias and tsconfig.test.json `@orglet/*` wildcard; keys/columns/csv/indexsql tests pass (12+9+4+8).
- 02: bootstrap fixed ids/clock tests pass (6 tests, "fixed ids and clock" group); openPgliteDb exported; guard.test.ts passes (5).
- 03: seed.test.ts passes (10); 16-03-SUMMARY has spike findings.
- 04: export.test.ts (4) and indexrows.test.ts (3) pass.
- 05: generate/check scripts work; .gitattributes marks `examples/acme-archive/** -text`; blobs keyed by checksum.
- 06: fixture.test.ts passes; README present in the fixture.

## Requirements Coverage

| ID | Plans | Status | Evidence |
|----|-------|--------|----------|
| FIX-01 | 16-01..16-06 (all declare it) | SATISFIED | REQUIREMENTS.md line 119 [x], traceability row "FIX-01 | Phase 16 | Complete"; no other IDs mapped to Phase 16, no orphans |

## 16-VALIDATION.md rows
All 15 task rows are closed by tests I ran (keys, columns, csv, indexsql, bootstrap, guard, seed, export, indexrows, fixture) or by `archive-fixture:check`. 16-03-01 (spike) closed by the SUMMARY findings. Manual-only rows: Postgres 16 load of index.sql (recorded in 16-06-SUMMARY as run by Johan 2026-11-21, no errors) and README readability (approved by Johan, README references Heimdall layout). Housekeeping: the VALIDATION.md frontmatter/table still show status planned/pending, wave_0_complete false and "Feedback latency < 90s" and "Approval" unchecked; documentation lag only, not a functional gap.

## Behavioral Spot-Checks
| Check | Result |
|-------|--------|
| `pnpm vitest run packages/archive packages/engine/src/bootstrap.test.ts` | 10 files / 70 tests pass (under heavy load, no reruns needed) |
| `pnpm archive-fixture:check` | exit 0, 35 files |
| md5 of Period=0 blobs vs Checksum cells | match (4/4) |

Not re-run by me: full `pnpm test`, build, lint, typecheck:scripts (16-06-SUMMARY records them green); Postgres 16 load relies on the recorded manual check.

## Anti-Patterns
None blocking found in scope; no spike file left behind (scripts/gen-archive-fixture has no spike.ts).

## Human Verification
None outstanding (manual items already approved per 16-06-SUMMARY).

_Verifier: Claude (gsd-verifier)_
