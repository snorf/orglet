---
created: 2026-10-08T00:00:00.000Z
title: Narrow baseline OwnerId referenceTo per object
area: metadata
files:
  - packages/metadata/src/build.ts
  - packages/api/src/api.test.ts
  - packages/formula/src/formula.test.ts
---

## Problem

Baseline gives every `hasOwner` object `OwnerId.referenceTo = ["User", "Group"]`
(`packages/metadata/src/build.ts`, ~line 109-114). Real Account/Contact/Opportunity owners are
User only, so after phase 4 (D-15) `Account.Owner.Department` in SOQL is INVALID_FIELD (Name
pseudo-object) and `Owner.Alias` in an Account formula fails compilation, both of which a real
org accepts. The describe test (~line 170 of `api.test.ts`) and `formula.test.ts` encode the
current behaviour.

## Solution

Decide per object which owners can be queues (Case, Lead, custom objects, ...) and narrow the
rest to `["User"]`. Update the describe test and the phase 3 fact tables. Run `orglet check` on
Johan's DE retrieve to find formulas that use `Owner.` on User-only objects.
