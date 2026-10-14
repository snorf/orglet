---
status: partial
phase: 09-baseline-generator-parity-ownerid-narrowing
source: [09-VERIFICATION.md]
started: 2026-10-14T07:55:31Z
updated: 2026-10-14T07:55:31Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Confirm SKIP_RATIO_MAX = 0.103 in packages/metadata/test/documented-fields.test.ts
expected: Johan accepted at the 09-06 checkpoint "the new, lower number after this rule" (recorded as 83/818 = 10.1% documented). The rule's 13 fields include Product2.RecordTypeId, which is field_reference-only (sdk-only), so the documented skip count is 84, not 83: 84/818 = 10.27%, and 09-07 set SKIP_RATIO_MAX = 0.103. The raw ratio 99/818 = 12.1% matches the accepted figure exactly. Johan confirms 0.103 as the accepted documented ratio (a decision, not a code fix).
result: [pending]

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
