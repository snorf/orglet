# Phase 9: Baseline Generator, Parity & OwnerId Narrowing - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-13
**Phase:** 09-baseline-generator-parity-ownerid-narrowing
**Areas discussed:** Sources and the verified rule, Feature-gated fields, OwnerId narrowing and Group fallout, v1-vs-v2 diff gate and allowlist, follow-ups (key prefixes of the 35, missing lengths, v1-only fields)

Facts checked before the discussion: Object Reference PDF reachable (HTTP 200, 21 MB, Last-Modified
2026-10-09); `pdftotext` 26.04.0 installed; `forcedotcom/sf-skills` is Apache-2.0, `Account.json` 71 KB.

---

## Todos

| Option | Description | Selected |
|--------|-------------|----------|
| OwnerId narrowing | Narrow baseline OwnerId referenceTo per object; BASE2-04 verbatim | ✓ |
| Colon syntax | Relationship:Object.Field; needs sigha resync, Phase 12 | |

**User's choice:** fold the OwnerId todo only.

## Sources and the verified rule

| Option | Description | Selected |
|--------|-------------|----------|
| Committed extraction, not the PDF | pdftotext locally, commit facts-only per-object extraction; PDF never in repo | ✓ |
| Commit the PDF | 21 MB, Salesforce prose in repo | |
| No committed second source | one-off local cross-check, verified marks baked in | |

| Option | Description | Selected |
|--------|-------------|----------|
| Include with provenance mark | single-source fields included, marked sdk-only/doc-only | ✓ |
| Exclude unless overrides opt in | strict two-source rule per field | |
| Include only if v1.0 had it | no new single-source fields | |

| Option | Description | Selected |
|--------|-------------|----------|
| Separate committed report | PROVENANCE.json beside objects; object JSON keeps v1.0 shape | ✓ |
| Key in object JSON per field | provenance visible to loader, no-op diff must ignore it | |
| Only generator stdout | nothing committed | |

| Option | Description | Selected |
|--------|-------------|----------|
| Generator fully offline | two manual snapshot scripts; generator reads committed files; CI drift gate | ✓ |
| Generator may download | one command, network-dependent CI | |

**User's choice:** all four recommended options.

## Feature-gated fields

| Option | Description | Selected |
|--------|-------------|----------|
| Heuristic + overrides veto | committed keyword list, prose matched at generation time, overrides force on/off, report lists hits | ✓ |
| Manual list only | every gated field hand-listed | |
| Exactly the v1.0 README families | nothing beyond that list | |

| Option | Description | Selected |
|--------|-------------|----------|
| Documented flags, nillable forced true | createable/updateable from source; never REQUIRED_FIELD_MISSING | ✓ |
| Read-only | createable:false, updateable:false | |
| Writable + strict warning | check --strict warns on references | |

| Option | Description | Selected |
|--------|-------------|----------|
| Baseline JSON + check report, not describe | describe keeps exact Salesforce key set | ✓ |
| Extra key in describe | literal reading of SC3 | |
| Describe key behind a flag | opt-in exposure | |

**User's choice:** all three recommended options.
**Notes:** Data.com Jigsaw fields becoming gated nullable fields may let the excluded jsforce insert-from-file test pass (recorded in CONTEXT specifics).

## OwnerId narrowing and Group fallout

Stated as Claude's discretion without objection: `ownerTargets` as object-level key (README rule stays);
Group-owned tests move to Case/Lead with negative tests for INVALID_CROSS_REFERENCE_KEY; poly-check unchanged.

| Option | Description | Selected |
|--------|-------------|----------|
| Phase 8 behaviour: FK skipped with schema-fk warning | nothing rewritten; fixture not extended | ✓ |
| Never an FK on OwnerId | narrowing is metadata only | |
| Extend upgrade fixture with a queue-owned Account | allowlisted, asserted warning | |

| Option | Description | Selected |
|--------|-------------|----------|
| ["User"] with override reason | Calendar not modelled; widen later | ✓ |
| Thin Calendar object | new object in this phase | |
| Keep v1.0 ["User","Group"] | wrong per docs | |

| Option | Description | Selected |
|--------|-------------|----------|
| Keep ["User","Group"] for custom objects | as v1.0 and research | ✓ |
| Narrow unless a Queue lists the object | read queues/ metadata | |
| Defer | later phase | |

**User's choice:** all three recommended options.

## v1-vs-v2 diff gate and allowlist

Stated as Claude's discretion: alphabetical field order (v1.0 already is).

| Option | Description | Selected |
|--------|-------------|----------|
| Own file beside overrides | diff-allowlist.json {object, field, kind, reason} | ✓ |
| Key in overrides.json | one file | |
| Prose in fixture README | not machine-read | |

| Option | Description | Selected |
|--------|-------------|----------|
| Schema-level | removal, type change, length/precision/scale decrease (mirrors isWidening) | ✓ |
| Schema + nillable | also nillable true->false | |
| Schema + all flags | every tightening needs a reason | |

| Option | Description | Selected |
|--------|-------------|----------|
| Vitest test + CI drift step | test vs frozen v1.0 fixture + allowlist; CI `baseline:gen && git diff --exit-code` | ✓ |
| CI script only | generator exits 1 | |
| Vitest only | in-memory regeneration | |

**User's choice:** all three recommended options.

## Follow-ups asked with the closing question

| Option | Description | Selected |
|--------|-------------|----------|
| Keep all 35 prefixes, label best source | overrides.json; doc / sdk-fixture / unverified; none null | ✓ |
| Null unless two sources confirm | strict BASE2-05 for the 35 | |
| Two-source rule only for new objects | 35 labelled v1.0 | |

| Option | Description | Selected |
|--------|-------------|----------|
| 255 + guessed | default length, listed in provenance | ✓ |
| Require override | generator aborts | |
| Omit field | listed in report | |

| Option | Description | Selected |
|--------|-------------|----------|
| Keep via overrides with reason | provenance v1.0 | ✓ |
| Remove via allowlist | schema-drop warning on existing DBs | |
| Case by case | planner decides per field | |

**User's choice:** all three recommended options; "Ready for context".

## Claude's Discretion

Generator location/layout and script names; report and provenance file formats; SOAP-type mapping,
length extraction and single-source flag semantics (the research spike); pdftotext table parsing;
conflict handling (abort vs emit-and-mark); header comments in generated files.

## Deferred Ideas

Custom-object OwnerId narrowing from `queues/` metadata; thin Calendar object; re-enabling the excluded
jsforce insert-from-file test; colon-syntax todo stays with Phase 12.
