---
status: partial
phase: 04-polymorphic-lookups-soql-typeof
source: [04-VERIFICATION.md]
started: 2026-10-08T21:30:38Z
updated: 2026-10-08T21:30:38Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Run conformance/poly-check/jsforce.mjs and sf_poly.py against a running orglet
expected: jsforce and simple-salesforce see Owner.Type, attributes.type and TYPEOF branches agree for Group-owned rows
result: [pending]
note: Plan 04-07 ran both scripts against a throwaway `poly_check` org on port 8082 during execution; both legs printed 4/4 passed. Verbatim output is in 04-07-SUMMARY.md. Awaiting Johan's confirmation.

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
