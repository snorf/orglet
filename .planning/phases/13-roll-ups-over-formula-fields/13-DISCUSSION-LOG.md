# Phase 13: Roll-Ups over Formula Fields - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-24
**Phase:** 13-roll-ups-over-formula-fields
**Areas discussed:** Allowed formula set, What "skip the field" means, Backfill on upgrade, Recompute triggers and cost

---

## Allowed formula set

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, if the whole chain qualifies | Formula-on-formula allowed; dependencies followed transitively; requires topological formula ordering | ✓ |
| No, only formulas over stored fields | Simplest; deviates from Salesforce | |
| Research decides | Follow documentation | |

**User's choice:** Formula-on-formula allowed when every formula in the chain is same-object and non-volatile.

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, as a chain | Formula reading a roll-up on the same child is summarizable; treated like ROLL-06 chains, cycles reported | ✓ |
| No, UNSUPPORTED | Simpler graph | |

**User's choice:** Allowed as a chain.

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, they are constants | `$Label`, `$CustomMetadata`, `$System.OriginDateTime` allowed; roadmap criterion 3 amended | ✓ |
| No, all $-roots blocked | Literal reading of criterion 3 | |
| Research decides | Follow documentation | |

**User's choice:** Compile-time constants allowed; `$Label` dropped from the forbidden list in ROADMAP/REQUIREMENTS.

| Option | Description | Selected |
|--------|-------------|----------|
| All types Phase 5 already filters on | Formula return type decides the family, same operator rules | ✓ |
| Only number and date | Stricter than Salesforce | |

**User's choice:** All Phase 5 filter families.

| Option | Description | Selected |
|--------|-------------|----------|
| Round to declared scale first | Sum matches sum of displayed child values; verified in research | ✓ |
| Raw value, round result only | Mathematically exact, may not match visible rows | |
| Research decides | | |

**User's choice:** Round to the formula's declared scale before aggregating (research verifies).
**Notes:** None.

---

## What "skip the field" means

| Option | Description | Selected |
|--------|-------------|----------|
| Gone from the schema entirely | Phase 5 D-06/D-07 pattern; no column, not in describe | ✓ |
| Present but inert | Column exists, always null/0 | |

**User's choice:** Gone from the schema.

| Option | Description | Selected |
|--------|-------------|----------|
| In the build, via diagnostics | `pushDiagnostic` with object/field/cause; needs the build to reach the formula compiler | ✓ |
| In FormulaRegistry (engine) | Simpler layering, but field cannot be removed from the schema | |

**User's choice:** Build-time diagnostic.

| Option | Description | Selected |
|--------|-------------|----------|
| Warning + skip, as rollup-cycle today | Full cycle path in message; roll-ups on the cycle skipped | ✓ |
| Hard error, load stops | Like Phase 5 D-08 | |

**User's choice:** Warning + skip.

| Option | Description | Selected |
|--------|-------------|----------|
| Name the rule and the field | e.g. "reads Account__r.Rating (cross-object)"; inner formula named for chains | ✓ |
| Rule only | Shorter | |

**User's choice:** Name the rule and the field.
**Notes:** None.

---

## Backfill on upgrade

| Option | Description | Selected |
|--------|-------------|----------|
| Engine step right after migrate | `migrate()` returns pending backfills; `orglet up` runs the engine backfill before listening; D-10 restated | ✓ |
| Move all backfill to engine | Uniform but touches working Phase 5 code and transaction boundary | |

**User's choice:** Engine step after migrate.

| Option | Description | Selected |
|--------|-------------|----------|
| Marker table in `_orglet` | Row written after success; crash-safe; second `up` silent | ✓ |
| New column is enough | No new table; crash after migrate leaves column empty forever | |

**User's choice:** Marker table.

| Option | Description | Selected |
|--------|-------------|----------|
| Write values without rules, log errors | Backfill is a data load; DB error aborts `up`, marker unwritten | ✓ |
| Run parent rules and stop on failure | One old parent could block startup | |

**User's choice:** No parent rules/hooks during backfill.

| Option | Description | Selected |
|--------|-------------|----------|
| Same as today: backfill runs in import mode too | New column has no org value to keep | ✓ |
| Skip in import mode | Risk of never-corrected 0/null | |

**User's choice:** Backfill runs regardless of `--import`.
**Notes:** None.

---

## Recompute triggers and cost

| Option | Description | Selected |
|--------|-------------|----------|
| The formula's transitive input fields | Followed through formula-on-formula and formula-on-roll-up to stored fields | ✓ |
| Every change on the child | Always correct, recomputes needlessly | |

**User's choice:** Transitive input fields.

| Option | Description | Selected |
|--------|-------------|----------|
| Accept O(children), document | No cap; noted in PROJECT.md Known gaps | ✓ |
| Cap with warning | Extra code for a rare local case | |

**User's choice:** Accept O(children).

| Option | Description | Selected |
|--------|-------------|----------|
| Only formula-dependent fields | Stored roll-ups keep the pure SQL path | ✓ |
| Whole group via TS path | One code path, slower | |

**User's choice:** Only formula-dependent fields take the TS path.

| Option | Description | Selected |
|--------|-------------|----------|
| Out of scope, unchanged | ROLLX-01 stays in backlog; backfill function shaped for later reuse | ✓ |
| Include the command now | Scope expansion | |

**User's choice:** `orglet rollup --recompute` stays deferred.
**Notes:** None.

---

## Todo cross-reference

| Option | Description | Selected |
|--------|-------------|----------|
| No, leave it | Standard-field gaps todo is a keyword match only | ✓ |
| Yes, fold it in | Scope expansion | |

**User's choice:** Not folded; recorded as reviewed.

## Claude's Discretion

- Mechanism for the build-time admission check (resolver hook vs post-pass before migrate).
- Dependency graph data shape and topological formula ordering.
- Pending-backfill contract and marker table DDL.
- Where the derived-table SQL lives.
- Test fixtures (test-local, neutral names; `examples/acme` untouched).

## Deferred Ideas

- `orglet rollup --recompute` (ROLLX-01).
- Formula fields in SOQL WHERE/ORDER BY/GROUP BY.
- Conformance and acceptance-fixture extension (Phase 14).
