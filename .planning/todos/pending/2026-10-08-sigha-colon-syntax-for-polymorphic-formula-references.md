---
created: 2026-10-08T00:00:00.000Z
title: Support Relationship:Object.Field colon syntax for polymorphic formula references
area: formula
files:
  - packages/formula/src/compile.ts
  - packages/sigha/VENDOR.md
  - scripts/sync-sigha.sh
---

## Problem

Salesforce formulas reach polymorphic parents as `Owner:User.Alias` / `Owner:Queue.DeveloperName`.
The vendored sigha lexer rejects `:` (`unexpected-character`), and upstream `rfaulhaber/sigha` HEAD
equals the vendored revision, so phase 4 ships D-16: colon syntax raises `UNSUPPORTED:formula`,
and plain `Owner.Name` on a polymorphic lookup fails compilation (D-08). Success criterion 1's
formula leg is therefore a recorded gap.

## Solution

Land colon support upstream in sigha, then resync with `scripts/sync-sigha.sh`. Then in
`resolvePath` accept a `Rel:Object` segment and resolve the object among the field's declared
targets. Accept `Queue` as an alias of `Group` (real formulas write `Owner:Queue.QueueName` /
`DeveloperName`; orglet models queues as Group rows with Type Queue). Use the canonical path
segment `Owner:Group`, and make `loadParents` keep only Ids whose `matchTargetByPrefix` result is
that object (null otherwise). Per D-09, no local pre-processing in `packages/formula`.
