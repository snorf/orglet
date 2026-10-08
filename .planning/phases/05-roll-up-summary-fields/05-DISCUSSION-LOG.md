# Phase 5: Roll-Up Summary Fields - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-09
**Phase:** 05-roll-up-summary-fields
**Areas discussed:** Parent rules on recompute, Standard-object relationships, Metadata-load strictness, Import mode and backfill

---

## Parent rules on recompute

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, Salesforce semantics | Parent validation rules run on the recomputed value; failure propagates to the triggering child with FIELD_CUSTOM_VALIDATION_EXCEPTION and the child rolls back | ✓ |
| No, write directly this milestone | Batched UPDATE after the child loop, no parent rules, log UNSUPPORTED:rollup-parent-rules | |
| Rules yes, hooks seam yes, but batched | Parent rules evaluated on the batch result; a failure fails the whole call | |

**User's choice:** Yes, Salesforce semantics

| Option | Description | Selected |
|--------|-------------|----------|
| After the child's after-hooks | Salesforce order of execution; then parent before/after hooks (seam, inert today) | ✓ |
| Before the child's after-hooks | Child after-hook sees the updated parent; deviates from documented order | |

**User's choice:** After the child's after-hooks

| Option | Description | Selected |
|--------|-------------|----------|
| COUNT/SUM = 0, MIN/MAX = null | As the platform shows; set at parent insert | ✓ |
| All null until first child | Simpler, deviates from Salesforce | |

**User's choice:** COUNT/SUM = 0, MIN/MAX = null

| Option | Description | Selected |
|--------|-------------|----------|
| Per parent group in a nested savepoint | One recompute per affected parent after the child loop; parent failure rolls back that parent and every child in the batch pointing at it | ✓ |
| Per child inside its own savepoint | Exact attribution, N recomputes per batch, parent hooks run N times | |

**User's choice:** Per parent group in a nested savepoint

---

## Standard-object relationships

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, exactly the three documented | Whitelist Opportunity.AccountId, OpportunityLineItem.OpportunityId, CampaignMember.CampaignId; everything else non-master-detail fails load (ROLL-02) | ✓ |
| No, master-detail only | Stricter than the platform | |
| All lookups allowed | Looser than the platform; ROLL-02 would need rewording | |

**User's choice:** Yes, exactly the three documented

---

## Metadata-load strictness

| Option | Description | Selected |
|--------|-------------|----------|
| Warn UNSUPPORTED and skip the field | Unsupported filter operation or MIN/MAX over a disallowed type: field not created, UNSUPPORTED:rollup-filter / rollup-type warning | ✓ |
| Fail the load with a clear error | Like ROLL-02 | |

**User's choice:** Warn UNSUPPORTED and skip the field

| Option | Description | Selected |
|--------|-------------|----------|
| Warn UNSUPPORTED:rollup-target, skip the field | Same degrade pattern as UNSUPPORTED:reference-target in phase 3 | ✓ |
| Fail the load | Treat as configuration error | |

**User's choice:** Warn UNSUPPORTED:rollup-target, skip the field

---

## Import mode and backfill

| Option | Description | Selected |
|--------|-------------|----------|
| Keep imported values, no recompute | Import mode already writes read-only fields directly; the org's value is the truth | ✓ |
| Recompute all roll-ups after import | Consistent with local children, deviates from the org on partial imports | |

**User's choice:** Keep imported values, no recompute

| Option | Description | Selected |
|--------|-------------|----------|
| Backfill at migrate for new columns | A newly added roll-up column is recomputed once; no new CLI command this phase | ✓ |
| Backfill at migrate + CLI command | Also `orglet rollup --recompute` | |
| No backfill | New columns start at 0/null until the next child mutation | |

**User's choice:** Backfill at migrate for new columns

---

## Todos reviewed

Three keyword matches (Narrow baseline OwnerId referenceTo, Reword ROADMAP phase 7, sigha colon syntax). User folded none.

## Claude's Discretion

RollupDef/RollupRegistry shape, filter operator semantics, multi-level recursion guard, fixture design, describe shape beyond the read-only flags.

## Deferred Ideas

`orglet rollup --recompute` CLI command; post-import recompute.
