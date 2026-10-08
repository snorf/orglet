# Phase 4: Polymorphic Lookups & SOQL TYPEOF - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-08
**Phase:** 04-polymorphic-lookups-soql-typeof
**Areas discussed:** Name pseudo-object without TYPEOF, Formula syntax for polymorphic parents, Filtering/sorting on polymorphic parent fields, Fixtures and test scope

---

## Name pseudo-object without TYPEOF

### Readable fields on a polymorphic parent

| Option | Description | Selected |
|--------|-------------|----------|
| Strict Name object | Only the fields Salesforce exposes on the Name pseudo-object; others INVALID_FIELD; values per row, null where the concrete object lacks the field; research verifies the list | ✓ |
| Union of target fields | Any field on any target, null where missing; more permissive than Salesforce | |
| Common fields only | Intersection of all targets; stricter than Salesforce | |

**User's choice:** Strict Name object

### attributes.type on a polymorphic parent

| Option | Description | Selected |
|--------|-------------|----------|
| Concrete object per row | "Group"/"User" with matching url; POLY-02 wording | ✓ |
| Always "Name" | Pseudo-object name as type | |

**User's choice:** Concrete object per row

### Type in SELECT as well as WHERE

| Option | Description | Selected |
|--------|-------------|----------|
| Both SELECT and WHERE | Type is a Name-object field; value derived from the prefix in SQL | ✓ |
| WHERE only | SELECT Owner.Type gives INVALID_FIELD | |

**User's choice:** Both SELECT and WHERE

### TYPEOF result shape

| Option | Description | Selected |
|--------|-------------|----------|
| Only the matching branch's fields | attributes + the branch's fields; other branches absent, not null | ✓ |
| Uniform keys, null for other branches | Client-friendly, diverges from Salesforce | |

**User's choice:** Only the matching branch's fields

### No WHEN match and no ELSE

| Option | Description | Selected |
|--------|-------------|----------|
| Follow docs exactly, research verifies | Research cites the SOQL reference; planner locks it | ✓ |
| Parent becomes null | Lock now without verifying | |

**User's choice:** Follow docs exactly, research verifies

### Unmodelled prefix logging

| Option | Description | Selected |
|--------|-------------|----------|
| Log UNSUPPORTED:reference-target per query | req.log.warn once per query; never silent | ✓ |
| Silent degradation | Null only | |

**User's choice:** Log UNSUPPORTED:reference-target per query

---

## Formula syntax for polymorphic parents

### Syntax

| Option | Description | Selected |
|--------|-------------|----------|
| Faithful Owner:User.Name | Salesforce colon syntax; null when the type differs; sigha gap fixed upstream | ✓ |
| Faithful + permissive Owner.Name | Both; the extension could mask formulas invalid in a real org | |
| Only Owner.Name per row | No colon syntax; real-org metadata would not load | |

**User's choice:** Faithful Owner:User.Name

### If sigha lacks colon support and the upstream fix cannot land in time

| Option | Description | Selected |
|--------|-------------|----------|
| UNSUPPORTED:formula for colon formulas, ship the rest | SOQL half independent; formula half of POLY-01 recorded as a gap with a sigha todo | ✓ |
| Local pre-processing in packages/formula | Faster, but a parser workaround outside the parser, against the project rule | |

**User's choice:** UNSUPPORTED:formula for colon formulas, ship the rest

---

## Filtering and sorting on polymorphic parent fields

### WHERE/ORDER BY beyond Type

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, for Name-object fields | Join per target + COALESCE; research verifies the documented allowance | ✓ |
| Only Type in WHERE | Others MALFORMED_QUERY; diverges for common queries | |
| Accept but UNSUPPORTED | Clear gap instead of wrong semantics | |

**User's choice:** Yes, for Name-object fields

### SQL strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Join per target, Claude decides details | Static joins with prefix filter, CASE for Type, COALESCE for values | ✓ |
| Fetch parents per row after the main query | Simpler SQL; no WHERE/ORDER BY on parent fields; pagination harder | |

**User's choice:** Join per target, Claude decides details

---

## Fixtures and test scope

### Fields covered

| Option | Description | Selected |
|--------|-------------|----------|
| OwnerId as base + one Who/What case | Group- and User-owned rows; one Task.WhatId test (Account vs Opportunity) for a 7-target field and multi-WHEN TYPEOF | ✓ |
| Only OwnerId | Smallest fixture | |
| All six polymorphic fields | Most coverage, most fixture work | |

**User's choice:** OwnerId as base + one Who/What case

### POLY-03 test technique

| Option | Description | Selected |
|--------|-------------|----------|
| In-memory schema with a target removed | Second OrgSchema without Group; import-mode row with Group prefix; expect null parent, ELSE branch, UNSUPPORTED log | ✓ |
| Synthetic prefix via import mode | Prefix like zzz; write-path validation may need bypassing | |

**User's choice:** In-memory schema with a target removed

### SDK verification

| Option | Description | Selected |
|--------|-------------|----------|
| Vitest + targeted SDK script | Unit/API tests plus a small jsforce/simple-salesforce run (Name-object query, Type filter, TYPEOF) in the last plan; full conformance in phase 7 | ✓ |
| Vitest only | SDKs first in phase 7 | |

**User's choice:** Vitest + targeted SDK script

---

## Claude's Discretion

- Shape-model internals, Name-field-list location, shared prefix-match helper placement,
  exact SQL, test placement, SDK script name, MALFORMED_QUERY wording beyond the docs.

## Deferred Ideas

- Permissive Owner.Name in formulas; Task/Event full objects (HEAD-01); dedicated tests for
  DelegatedApproverId/RelatedId; stored type column (out of scope); Bulk TYPEOF rejection (phase 6).
