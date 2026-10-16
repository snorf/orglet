---
phase: 10-business-standard-objects
verified: 2026-10-16T00:00:00Z
status: passed
score: 4/4 must-haves verified
---

# Phase 10: Business Standard Objects Verification Report

**Phase Goal:** The 18 business objects a typical sales/service org references exist as faithful baseline objects, and `orglet check` separates objects a retrieve references from objects nothing references.
**Status:** passed. Re-verification: No.

## Observable Truths

| # | Truth (ROADMAP SC) | Status | Evidence |
|---|---|---|---|
| 1 | 18 objects describable/queryable, no blob fields, omissions in generator report | VERIFIED | All 18 JSON files exist in packages/metadata/standard/objects with key prefixes (Quote 0Q0, QuoteLineItem 0QL, Order 801, OrderItem 802, ACR 07k, AccountTeamMember 01M, OTM 00q, OCR 00K, OpportunitySplit 049, ContractLineItem 811, CaseContactRole 03j, CaseMilestone 555, EmailMessage 02s, ContentDocument 069, ContentVersion 068, FeedItem 0D5, Location 131, Address 130). VersionData, ContentData, BccIds, ToIds and the Location.Location compound field are absent. Describe-check 32/32 on both SDKs is recorded in 10-06-SUMMARY (not re-run). |
| 2 | Forbidden DML refused with INVALID_TYPE_FOR_OPERATION; lookup MALFORMED_ID / INVALID_CROSS_REFERENCE_KEY (D-20) | VERIFIED | Flags in the JSON: OrderItem undeletable=false; CaseMilestone createable=false and deletable=false; ContentDocument createable=false; ContentVersion deletable=false. engine.test.ts has 17 references to the lookup error codes. The engine and REST legs are recorded green in 10-05/10-06 SUMMARY (not re-run here). |
| 3 | `orglet check` separates referenced from unreferenced unmodelled objects; the info line never fails --strict (D-09) | VERIFIED | packages/cli/src/main.ts:89 emits `info: N standard objects not modelled and unreferenced: ...`. main.test.ts asserts the INFO_LINE format. `pnpm vitest run packages/metadata packages/cli` on pglite with Node 22: 11 files, 215 tests, all pass. |
| 4 | Conformance green; warning-count shifts recorded | VERIFIED (from SUMMARY) | 10-06-SUMMARY records run-all.sh exit 0, describe-check 32/32 on both SDKs, and DE retrieve check exit 0 / 0 warnings / 55 objects. I did not re-run conformance or the Postgres suite, as instructed. |

**Score:** 4/4

## Requirements Coverage

| Requirement | Plans | Status | Evidence |
|---|---|---|---|
| BASE2-06 | 10-01, 10-03, 10-04, 10-05, 10-06 | SATISFIED | 18 generated baseline objects with prefixes and flags (above). The D-02 branch did not fire because OpportunitySplit has prefix 049. |
| BASE2-07 | 10-01, 10-04, 10-05, 10-06 | SATISFIED | DML flags in the baseline JSON. Lookup codes follow D-20 (REQUIREMENTS.md carries the dated deviation note). |
| BASE2-08 | 10-02, 10-06 | SATISFIED | Info category in the CLI plus tests. |

No orphaned requirements. REQUIREMENTS.md maps only BASE2-06..08 to Phase 10, and all three are claimed by plans. 10-03 declares BASE2-06 only. The traceability table marks all three Complete.

## Anti-Patterns

None found in the spot-checks. The Deviation fixes recorded in 10-04 and 10-06 (case-twin SDK spelling, Quote.OpportunityId roll-up allowlist with the Phase 5 D-08 reversal, Quote.hasOwner override) are documented in the SUMMARYs and are covered by the green metadata and cli tests.

## Human Verification

None required. Items I did not re-run, by instruction: the Postgres 16 suite (the orchestrator is running it) and conformance/run-all.sh. They rest on the evidence in 10-06-SUMMARY.

---
_Verifier: Claude (gsd-verifier)_
