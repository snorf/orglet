# Phase 10: Business Standard Objects - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-14
**Phase:** 10-business-standard-objects
**Areas discussed:** Key prefix policy for the single-list objects; `orglet check` referenced vs unreferenced; Source of object-level facts; Companion objects and edge cases

---

## Pre-discussion: pending todo cross-reference

| Option | Description | Selected |
|--------|-------------|----------|
| No, leave it | Belongs in Phase 12 / backlog 999.7; recorded as reviewed-not-folded | ✓ |
| Yes, fold into Phase 10 | Adds sigha colon-syntax parser work to the phase | |

**User's choice:** No, leave it (todo: Support Relationship:Object.Field colon syntax for polymorphic formula references).

---

## Key prefix policy for the single-list objects

### Q1: How should the six single-list prefixes (01M, 068, 069, 0D5, 02s, 049) be verified?

| Option | Description | Selected |
|--------|-------------|----------|
| Second public source, else DE-describe | Research looks for a second independent public source; if none, execution checkpoint where Johan confirms from his own DE describe, stored as `de-describe` with ref | ✓ |
| Direct DE-describe checkpoint | Skip the search; all six confirmed from DE describe at a checkpoint | |
| String + unverified | Store like the existing 34; keeps objects createable but does not meet Phase 9 D-07 | |

**User's choice:** Second public source, else DE-describe.

### Q2: If a prefix stays single-source and the object is documented as createable, what wins?

| Option | Description | Selected |
|--------|-------------|----------|
| null + read-only, deviation note | Follow D-07/BASE2-05 strictly; createable false; dated deviation note on BASE2-07 | ✓ |
| String + unverified, stay createable | Store the prefix anyway; note the D-07 exception in CONTEXT | |

**User's choice:** null + read-only, deviation note.

### Q3: keyPrefixSource for the twelve prefixes where two community lists agree

| Option | Description | Selected |
|--------|-------------|----------|
| unverified + ref to both lists | Keep the four existing provenance values; ref in overrides.json names both lists | ✓ |
| New value `community-list` | Fifth provenance value as research suggested; changes the type, validateBaseline and describe contract | |
| `doc` if the Object Reference PDF confirms | Those present in the PDF extract get `doc` with ref, the rest unverified + ref | |

**User's choice:** unverified + ref to both lists. (CONTEXT D-03 also allows an upgrade to `doc`/`sdk-fixture` when research finds a documented source for an individual prefix.)

### Q4: When to take the prefix checkpoint

| Option | Description | Selected |
|--------|-------------|----------|
| In execution, as 09-06 | Plan contains a checkpoint task presenting the verification list | ✓ |
| Before planning | Johan runs describe now and supplies the prefixes in this discussion | |

**User's choice:** In execution, as 09-06.

---

## `orglet check`: what counts as referenced (BASE2-08)

### Q1: Which unmodelled standard objects go into the informational category?

| Option | Description | Selected |
|--------|-------------|----------|
| Retrieve objects + baseline-skipped targets | Both unreferenced retrieve objects and generator-skipped lookup targets (PROVENANCE skipped.referenceTarget) | ✓ |
| Only retrieve objects | Baseline-skipped targets not shown at all | |
| Only baseline-skipped targets | Retrieve objects keep today's standard-object warning | |

**User's choice:** Retrieve objects + baseline-skipped targets.

### Q2: A standard object present in the retrieve but referenced by nothing, absent from baseline

| Option | Description | Selected |
|--------|-------------|----------|
| Downgrade to info | Follows BASE2-08 wording; main noise reducer for large orgs | ✓ |
| Keep warning | Custom fields on it signal the org uses it | |
| Info for layout/listview only, warning if custom fields | Middle ground keyed on CustomField metadata | |

**User's choice:** Downgrade to info.

### Q3: How is the informational category rendered?

| Option | Description | Selected |
|--------|-------------|----------|
| One summary line on stdout, always | `info: N standard objects not modelled and unreferenced: A, B, C`; own Diagnostic severity; never `warning:`, never stderr | ✓ |
| One line per object, always | Grep-friendly, more noise on large orgs | |
| Hidden until --info/--verbose | Default output unchanged; adds a CLI flag Phase 14 must honour | |

**User's choice:** One summary line on stdout, always.

### Q4: Should roll-up/formula/VR references to an unmodelled object also raise a reference-target warning?

| Option | Description | Selected |
|--------|-------------|----------|
| No, classification only | Reference counts for referenced/unreferenced; no extra warning; strings byte-identical | ✓ |
| Yes, one reference-target per target | Uniform but duplicates counts | |

**User's choice:** No, classification only.

---

## Source of object-level facts for the 18

### Q1: Where do createable/updateable/deletable/undeletable/searchable come from?

| Option | Description | Selected |
|--------|-------------|----------|
| Extract Supported Calls from the PDF | snapshot-pdf.ts gains object-level extraction; flags derived, PROVENANCE doc-only; only deviations hand-pinned | ✓ |
| Hand-pin in overrides.json with PDF ref | Object-level block per object; no extractor code; 18 hand facts | |
| Hand-pin in v1-pins.json | Same file as today's 35; filename misleading | |

**User's choice:** Extract Supported Calls from the PDF.

### Q2: label, labelPlural, hasOwner — same path?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, derive from sources | sf-skills label/labelPlural; hasOwner from OwnerId presence; pin only on gap or conflict | ✓ |
| No, hand-pin | Keep today's pin requirement; 18 hand pins | |

**User's choice:** Yes, derive from sources.

### Q3: ContentVersion update: REST guide says no, Object Reference lists update()

| Option | Description | Selected |
|--------|-------------|----------|
| Object Reference wins: updateable | Phase 3 D-04 precedent; conflict recorded as override reason | ✓ |
| REST guide wins: not updateable | Stricter; update attempts get INVALID_TYPE_FOR_OPERATION | |

**User's choice:** Object Reference wins: updateable.

### Q4: Object-level featureGated tag for feature-dependent objects?

| Option | Description | Selected |
|--------|-------------|----------|
| No, field level only as today | No new JSON key, no describe difference; dependency noted in standard/README.md | ✓ |
| Yes, object-level tag | featureGated: true on the object plus a check count line | |

**User's choice:** No, field level only as today.

---

## Companion objects and edge cases

### Q1: Add any object outside the 18?

| Option | Description | Selected |
|--------|-------------|----------|
| No, the 18 are fixed | OpportunitySplitType, Calendar, ContentDocumentLink stay in backlog 999.5 / FILE-01 | ✓ |
| Only OpportunitySplitType | Thin 19th object so SplitTypeId can be modelled | |
| OpportunitySplitType + Calendar | Both thin | |
| All three | Also ContentDocumentLink without blob | |

**User's choice:** No, the 18 are fixed.

### Q2: SC2 says malformed/wrong-type Id gives INVALID_CROSS_REFERENCE_KEY; v1 gives MALFORMED_ID for unparsable

| Option | Description | Selected |
|--------|-------------|----------|
| Research verifies in docs, else keep v1 | Researcher checks documented status codes; docs silent means v1 stands and SC2/BASE2-07 get a dated wording adjustment | ✓ |
| Keep v1 without research | Adjust SC2 wording directly | |
| Change to ICRK for everything | Follow SC2 literally; changes v1 behaviour and tests | |

**User's choice:** Research verifies in docs, else keep v1.

### Q3: Conformance coverage for the 18

| Option | Description | Selected |
|--------|-------------|----------|
| describe-check for all 18 + DML flags in vitest | objects.txt 14 → 32 on both SDK legs; forbidden DML and ICRK in engine/api vitest; no new leg | ✓ |
| describe-check + new dml-check leg | Ninth leg running forbidden operations through both SDKs | |
| Only describe-check | Minimal; DML flags covered only by existing vitest patterns | |

**User's choice:** describe-check for all 18 + DML flags in vitest.

### Q4: Seed rows in examples/acme for CaseMilestone and ContentDocument?

| Option | Description | Selected |
|--------|-------------|----------|
| No, empty is fine | SC1 needs describe and query, not rows; rows via --import or bootstrap seeds | ✓ |
| Yes, minimal seed rows | One row per read-only object so conformance proves query returns data | |

**User's choice:** No, empty is fine.

---

## Closing

| Option | Description | Selected |
|--------|-------------|----------|
| Ready for context | Write CONTEXT.md and DISCUSSION-LOG, commit, update STATE | ✓ |
| Explore more gray areas | Delivery order, circular FK, SKIP_RATIO_MAX, Postgres lock pressure | |

**User's choice:** Ready for context.

## Claude's Discretion

- Delivery order of the 18 objects
- Circular FK handling between ContentDocument and ContentVersion
- Re-examining SKIP_RATIO_MAX after the objects land
- Postgres lock pressure from 18 extra tables in one migrate() transaction
- Generator report shape for omitted blob fields
- Supported Calls extraction robustness and the search() → searchable mapping
- Diagnostic field names for the informational severity

## Deferred Ideas

- OpportunitySplitType thin object (backlog 999.5)
- Calendar thin object (carried from Phase 9)
- ContentDocumentLink (FILE-01 / 999.5)
- Object-level featureGated tag (rejected for now)
- `community-list` provenance value (rejected)
- Seed rows for read-only objects in examples/acme (Phase 14 fixture may want them)
- Re-enabling the excluded jsforce insert-from-file conformance test (Phase 14)
- PROJECT.md target-features list and BASE2-04 forward clause name a different object set than the 18 (doc alignment)
- Reviewed, not folded: sigha colon-syntax todo (Phase 12 / 999.7)
