---
phase: 10-business-standard-objects
plan: 06
subsystem: conformance, docs
status: in-progress (Task 3, the human DE retrieve check, is pending)
tags: [base2-06, base2-07, base2-08, conformance, sc4, wording]
requires: ["10-05"]
key-files:
  modified:
    - conformance/README.md
    - .planning/REQUIREMENTS.md
    - .planning/ROADMAP.md
    - .planning/PROJECT.md
    - packages/metadata/standard/README.md
requirements-completed: []
---

# Phase 10 Plan 06: Conformance, SC4 shifts and wording Summary (DRAFT, Task 3 pending)

Tasks 1 and 2 are done and committed. Task 3 (Johan's DE retrieve check) is not. The BASE2-06/07 ticks in Task 2 were made before the human DE-retrieve leg, on the strength of the automated evidence; whether Task 3 confirms them must be stated here by the continuation agent (any DE warning is a finding that may reopen a tick). BASE2-08 was already ticked.

## Commits

| Task | Commit | What |
|---|---|---|
| 1 | d7da546 | conformance/README.md overview rows (2026-10-14, orglet fb9c397, describe-check 32/32 each) |
| 2 | 0a81adf | REQUIREMENTS (BASE2-07 wording + ticks 06/07, traceability), ROADMAP SC2/SC3, PROJECT.md list of 18, standard/README.md notes |

## Verification actually run (Node 22.23.3 via nvm)

- `pnpm build && pnpm lint && pnpm typecheck && pnpm typecheck:scripts && pnpm baseline:check`: all exit 0; baseline:check "checked 54 files".
- `pnpm test` on pglite: 38 files passed, 629 tests passed, 3 skipped (632). 0 failed. The unexplained flake from 10-05 did not recur in this single run (not diagnosed).
- `ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test` on Postgres 16: 38 files passed, 631 passed, 1 skipped (632). 0 failed; no `out of shared memory`, so `vitest.config.ts` is unchanged (maxWorkers stays).
- `ORGLET_DATABASE_URL=... ORG_SCHEMA=conformance_p10 PORT=8093 PYTHON=conformance/describe-check/.venv/bin/python conformance/run-all.sh`: exit 0.

```
jsforce core:      Tests: 60 skipped, 51 passed, 111 total
jsforce bulk2:     Tests: 5 skipped, 12 passed, 17 total
simple-salesforce: 29/29 passed
describe-check:    jsforce: 32/32 passed;  simple-salesforce: 32/32 passed
poly-check:        jsforce 4/4;  simple-salesforce 4/4
rollup-check:      jsforce 5/5;  simple-salesforce 5/5
PASS jsforce-subset
PASS simple-salesforce
PASS describe-check-jsforce
PASS describe-check-python
PASS poly-check-jsforce
PASS poly-check-python
PASS rollup-check-jsforce
PASS rollup-check-python
```

Postgres schema `conformance_p10` was created in the local dev database and left in place (destructive drop is Johan's call). Reset command:

```sh
node packages/cli/dist/index.js reset --org-schema conformance_p10 --drop-prefixes
```

(with `ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet`).

## SC4 table (measured)

| Measure | Before | After |
|---|---|---|
| `orglet check --strict` on Johan's DE retrieve | exit 0, 0 warnings, 37 objects (2 custom), 983 fields | PENDING Task 3 [expected exit 0, 0 warnings, 55 objects (2 custom)] |
| `orglet check` on examples/acme | 0 warnings | 0 `warning:` lines, exit 0, plus one `info:` line naming 39 objects |
| `UNSUPPORTED:standard-object` for an unreferenced retrieve object | 1 warning each | 0, listed on the info line |
| `UNSUPPORTED:reference-target` for referenced objects | 0 | 0 (asserted by documented-fields.test.ts) |
| PROVENANCE `skipped.referenceTarget` entries | 94 | 140 (10-04 reported 143; 3 fewer after the later case-twin merge in the 10-04 deviation fix) |
| distinct unmodelled skipped targets (excluding "(none stated)") | 22 (plan quoted 23) | 37 by my count (10-04 said 39 before the case-twin fix; the acme info line also names 39 objects, a different population: unreferenced unmodelled standard objects) |
| documented skip ratio | 84/818 = 0.1027 | 121/1410 = 0.0858 (measured with the generator `generate()` totals via a scratchpad script); bound 0.103 unchanged |
| describe-check | 14/14 each | 32/32 each |
| jsforce subset core / bulk2, simple-salesforce, poly-check, rollup-check | 51 / 12, 29/29, 4/4, 5/5 | 51 / 12, 29/29, 4/4, 5/5 (unchanged) |

SC4 is judged by "no standard-object or reference-target warning remains for a referenced object", not raw totals. The plan's expected [~150], [~39], [~126/1410 = 0.0894] differ from measured 140, 37, 121/1410 = 0.0858; all in the favourable direction and within the bound. Note: the 10-04 summary's ratio of 122/1410 is also superseded by 121/1410.

Not a measurement of the DE retrieve: the 55-object figure is the research expectation only.

## Wording changes (before/after)

Date of all adjustments: 2026-10-14. D-02 did not fire, so there is no OpportunitySplit note.

| Line | Old text | New text | Reason | Evidence |
|---|---|---|---|---|
| BASE2-07 (D-20) | "...as in v1.0; lookups to any of them with an invalid Id are rejected with `INVALID_CROSS_REFERENCE_KEY`." | "...as in v1.0; a lookup to any of them with an unparsable Id is rejected with `MALFORMED_ID`, and with a well-formed Id of the wrong object type or with no matching row with `INVALID_CROSS_REFERENCE_KEY`, as in v1.0." plus a dated deviation note (D-15/D-20) | The engine returns MALFORMED_ID for an unparsable Id (documented) and keeps v1.0's INVALID_CROSS_REFERENCE_KEY for wrong type and missing row; one official REST example returns MALFORMED_ID for a wrong-type Id, deferred | 10-05 engine.test.ts D-20 table over Case.FeedItemId, Asset.LocationId, Order.QuoteId, OrderItem.OrderId (`"abc"` gives MALFORMED_ID; unknown Id and Account Id give INVALID_CROSS_REFERENCE_KEY, each with `fields: [field]`) |
| ROADMAP SC2 (D-20) | "...a lookup to any of the 18 with a malformed or wrong-type Id is rejected with `INVALID_CROSS_REFERENCE_KEY`." | "...an unparsable Id is rejected with `MALFORMED_ID`, and with a well-formed Id of the wrong type or with no matching row with `INVALID_CROSS_REFERENCE_KEY` (wording adjusted 2026-10-14, D-20)." | same as above | same tests |
| ROADMAP SC3 (D-09) | "`orglet check` keeps `UNSUPPORTED:reference-target` for a standard object that a lookup, roll-up, formula or validation rule references but orglet does not model, and lists..." | "`orglet check` treats a standard object that a lookup, roll-up, formula or validation rule references but orglet does not model as referenced: it keeps its warnings (`UNSUPPORTED:reference-target` for a lookup target, the existing roll-up and formula warnings otherwise, with no extra reference-target warning, D-09), and lists... (wording adjusted 2026-10-14, D-09)" | SC3 is read through D-09: roll-up, formula and validation-rule references count for the referenced/unreferenced classification only; formula references are classified through the lookup they traverse | 10-02 build.test.ts (referenced vs unreferenced classification, formula case classifies identically to the plain lookup), 10-02 main.test.ts (info line, --strict unaffected) |

Ticks made: BASE2-06 `[x]` (10-04 loader/generator tests, 10-05 describe tests, conformance describe-check 32/32; VersionData omitted and listed in the generator report), BASE2-07 `[x]` under the adjusted wording (10-05 engine and api tests), traceability rows for 06 and 07 now Complete. BASE2-08 was already `[x]`.

Flagged, not changed: BASE2-08's text still says "a referenced-but-unmodelled object stays an `UNSUPPORTED:reference-target` warning"; it is consistent with SC3 for lookup targets but narrower than the D-09 reading for roll-up and formula references. The plan did not ask to edit it; raise if Johan wants it aligned.

## Docs aligned

- PROJECT.md target-features list now names all 18 (adds OpportunitySplit, CaseContactRole, CaseMilestone).
- packages/metadata/standard/README.md Rules gain the Supported Calls / hand facts note, the feature-dependent objects note (D-13) and the "Known gap" on child relationship names.

## Deviations from Plan

None in behaviour. Notes:
- The first attempt to measure the skip ratio by temporarily editing `documented-fields.test.ts` was blocked by the permission system; nothing was changed in that file (checked by reading it afterwards). The ratio was instead measured with a scratchpad tsx script calling the generator's `generate()`; no repo file was touched.
- Line-wrapping of the BASE2-07 text was chosen so the plan's one-line grep (`with an unparsable Id is rejected with \`MALFORMED_ID\``) matches.

## Known Stubs

None.

## Pending (Task 3)

Johan runs `node packages/cli/dist/index.js check --strict --project <his DE retrieve>` and reports exit code, number of `warning:` lines, the summary line and the info count. The continuation agent then adds the row to the DE retrieve table and the Overview DE row in conformance/README.md, fills the DE cell above, states whether the result confirms the BASE2-06/07 ticks, marks the plan complete, and finalises STATE.md/ROADMAP.md (check `git diff .planning/ROADMAP.md` for the Phase 999.1 "Plans:" line quirk after `roadmap update-plan-progress`).

## Deviation fix (Task 3 finding): roll-up over Quote.OpportunityId and D-08 degrade

Found at the Task 3 checkpoint: a real-org retrieve carries a roll-up summary over Quote.OpportunityId, which metadata load rejected (Phase 5 D-08 threw for any roll-up over a lookup outside the allowlist). Johan approved two changes on 2026-10-15 ("1+2"); commit 1bfe9e4.

1. [Rule 1 - Bug] `quote.opportunityid` added to `LOOKUP_WHITELIST` in `packages/metadata/src/rollup.ts`. The Object Reference documents Quote.OpportunityId as `Create, Filter` only (required, not updateable, not nillable), the same relationship signature as OpportunityLineItem.OpportunityId, and a real-org retrieve carries a roll-up over it, so the platform allows it. The allowlist is now four lookups.
2. Phase 5 D-08 reversed: a roll-up over a lookup that is neither master-detail nor allowlisted no longer throws. It is skipped with a new `UNSUPPORTED:rollup-relationship` diagnostic (via `drop`, `DropArea`, `pushDiagnostic`), the detail being the old message updated to list the four lookups. Warnings and diagnostics stay 1:1. The throw for a roll-up on an unregistered object stays (internal invariant).

Tests (`packages/metadata/src/build.test.ts`): "roll-ups on standard objects resolve over the four whitelisted lookups" (adds Opportunity roll-up over Quote.OpportunityId); the old throw test is rewritten to "a roll-up over a lookup that is not whitelisted is skipped with rollup-relationship and the load continues" (parent object still loads, warnings == diagnostics.map(formatDiagnostic)).

Verification (Node 22): `pnpm lint` clean, `pnpm typecheck` clean, `pnpm test` 38 files passed, 629 passed / 3 skipped, `pnpm build` clean (packages/cli/dist current). No living doc outside .planning lists the rollup-* areas, so none was updated. Task 3 (Johan's DE retrieve check) is still pending.


## Deviation fix (Task 3 finding): Quote.hasOwner

**Root cause:** `objectFactsFor` (scripts/gen-baseline/pipeline.ts) derives `hasOwner` only from OwnerId in the sf-skills `fields` or the Object Reference `fields` (D-21). For Quote, OwnerId appears only in the sf-skills `field_reference` SDK list, so the generated baseline had `hasOwner: false` and no OwnerId column.

**Evidence:** the author's own Developer Edition describe (2026-10-15) shows OwnerId on Quote and confirms the other 17 Phase 10 objects already match (Order, ContentDocument, ContentVersion and Location owned; the rest not).

**What changed:** a per-object `hasOwner` override in overrides.json (`value: true`, `reason`, `ref`), validated like the other overrides (rejected without value true, reason and ref, and on objects with v1 pins) and reported as `Quote.hasOwner` in `overrideResolved` when the sources alone would not state it. D-21 itself is untouched. Quote also got an `ownerTargets` override keeping the polymorphic User/Group default (neither source states Refers To for Quote.OwnerId; the describe evidence recorded here covers only the field's existence, so the target list was not narrowed). Regenerated: Quote.json (`hasOwner: true`) and PROVENANCE.json (Quote ownerTargets: override). Tests: generator test on synthetic input in baseline-gate.test.ts, Quote OwnerId loader assertion and owner-set update in build.test.ts, Quote owner flag in api.test.ts.

**Verification (Node 22):** `pnpm baseline:gen`, `baseline:check`, `lint`, `typecheck`, `typecheck:scripts`, `build` clean; `pnpm test` 38 files, 630 passed / 3 skipped (includes upgrade.test.ts).
