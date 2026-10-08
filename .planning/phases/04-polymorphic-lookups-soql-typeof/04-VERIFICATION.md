---
phase: 04-polymorphic-lookups-soql-typeof
verified: 2026-10-08T00:00:00Z
status: human_needed
score: 4/5 truths verified fully; 1 documented partial (formula leg, D-16)
gaps: []
human_verification:
  - test: "Run conformance/poly-check/jsforce.mjs and sf_poly.py against a running orglet"
    expected: "jsforce and simple-salesforce see Owner.Type, attributes.type and TYPEOF branches agree for Group-owned rows"
    why_human: "Needs a live server and external clients; not run by the verifier"
---

# Phase 4: Polymorphic lookups and SOQL TYPEOF Verification Report

**Goal:** A polymorphic lookup resolves its target object per row (SOQL joins, row shaping, formula parent traversal) in agreement with the write path; TYPEOF and <relationship>.Type work per the documented grammar.
**Status:** human_needed (all automated checks pass; one documented partial)
**Re-verification:** No

## Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Parent-field result, attributes.type and formula agree on concrete target | PARTIAL (accepted, D-16) | SOQL + attributes.type + write-path prefix rule agree: query.test.ts "owner type agrees across SOQL Owner.Type, attributes.type and the write-path prefix rule" passes. Formula leg deferred: formula/compile.ts raises UNSUPPORTED:formula for colon syntax (line ~173-179) and rejects plain Owner.Name through a polymorphic lookup (line ~97). Recorded in REQUIREMENTS.md (Partial) and todo under .planning/todos/pending/. |
| 2 | Field missing on concrete object is null | VERIFIED | query.test.ts "user-only Name fields are null on a Group owner even though Group has an Email column" passes |
| 3 | Unmodelled prefix gives null parent, no throw | VERIFIED | query.test.ts "an owner Id whose prefix matches no modelled object is a null parent and one reference-target warning" and TYPEOF-with-ELSE yields null owner (D-19 wins over SC wording). api/routes/query.ts logs the warning once per query |
| 4 | TYPEOF compiles and shapes per row; Type filterable | VERIFIED | query.test.ts TYPEOF tests (Owner, What, combined with Owner.Type filter, two TYPEOFs); compile.test.ts "filters Owner.Type on the Id prefix CASE"; implementation in soql/typeof.ts, polymorphic.ts, shape.ts |
| 5 | Invalid TYPEOF forms are MALFORMED_QUERY naming the restriction | VERIFIED | soql/typeof.ts TYPEOF_RESTRICTIONS; compile.test.ts covers WHERE, ORDER BY, GROUP BY, HAVING, nested, COUNT(), semi-join, functions |

**Score:** 4 verified, 1 documented partial.

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full suite on embedded pglite | pnpm test | 17 files passed, 251 passed, 2 skipped (Postgres-only concurrency tests, intentional) | PASS |

## Requirements Coverage

| Requirement | Plans | Status | Evidence |
|-------------|-------|--------|----------|
| POLY-01 | 01,03,04,05,06 | PARTIAL (D-16) | SOQL leg done; formula leg deferred, recorded as "Partial (formula leg deferred per D-16)" |
| POLY-02 | 04,05 | SATISFIED | Truth 2, attributes.type tests |
| POLY-03 | 05,06,07 | SATISFIED | Truth 3 |
| POLY-04 | 05,07 | SATISFIED | Truth 4 |
| POLY-05 | 04,05 | SATISFIED | Owner.Type filter tests |
| POLY-06 | 02,05 | SATISFIED | Truth 5 |

All six IDs appear in plan frontmatter and REQUIREMENTS.md; no orphans. Note: REQUIREMENTS.md checkbox for POLY-01 is [x] while the traceability table says Partial; minor inconsistency.

## Anti-Patterns
None blocking found in the changed source files via test evidence; not an exhaustive grep. Two items in the suite are skipped by design.

## Human Verification Required
1. Run conformance/poly-check (jsforce.mjs, sf_poly.py) against a live orglet; expect agreement of Owner.Type, attributes.type and TYPEOF output. Needs live server and external clients.

## Gaps Summary
No gaps beyond the accepted D-16 partial on POLY-01 (formula leg; blocked on sigha colon syntax, todo pending).

_Verified: 2026-10-08_
_Verifier: Claude (gsd-verifier)_
