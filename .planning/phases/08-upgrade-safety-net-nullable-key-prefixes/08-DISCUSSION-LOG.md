# Phase 8: Upgrade Safety Net & Nullable Key Prefixes - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-13
**Phase:** 08-upgrade-safety-net-nullable-key-prefixes
**Areas discussed:** Todo cross-reference, FK violations & upgrade test, Null-prefix objects, sigha upstream PR & red tests, Diagnostic shape

---

## Todo cross-reference

| Option | Description | Selected |
|--------|-------------|----------|
| None — keep roadmap split | Colon todo → Phase 12, OwnerId todo → Phase 9; Phase 8 only groundwork | ✓ |
| Fold colon-syntax todo | Phase 8 would land colon support upstream and resync | |
| Fold OwnerId-narrowing todo | Phase 8 would narrow OwnerId.referenceTo per object | |

**User's choice:** None — keep roadmap split.

---

## FK violations & upgrade test

### Behaviour on the next `up` after a skipped FK

| Option | Description | Selected |
|--------|-------------|----------|
| Re-evaluate every up | Pre-check runs again each `up`; warns while violated, adds FK silently once fixed; no new state | ✓ |
| One-shot warning, remember skip | Skipped FK recorded in `_orglet`; later ups silent; only `--force` adds it | |

**User's choice:** Re-evaluate every up.

### Source of the v1.0 baseline files for the upgrade test

| Option | Description | Selected |
|--------|-------------|----------|
| Committed snapshot copy in repo | 35 v1.0 JSON files copied into a test fixture dir with README naming the commit | ✓ |
| `git show` at test time | Read from git history by tag; depends on fetch depth and tag presence | |

**User's choice:** Committed snapshot copy.

### How the test populates the v1.0 database

| Option | Description | Selected |
|--------|-------------|----------|
| Through DmlEngine and import mode | Real write path: engine insert for Group-owned Case, importMode for rows with own Ids | ✓ |
| Raw SQL inserts | Faster, but does not prove a database really created by v1.0 survives | |
| You decide | Claude picks in planning | |

**User's choice:** Through DmlEngine and import mode.

---

## Null-prefix objects

### Create against an object with no key prefix

| Option | Description | Selected |
|--------|-------------|----------|
| Baseline rule: null prefix requires createable:false | Loader rejects null+createable:true as hard baseline error; DML hits Phase 3 flag check → INVALID_TYPE_FOR_OPERATION | ✓ |
| Keep documented flags, engine refuses | Engine returns an error mentioning UNSUPPORTED:key-prefix; describe would promise createable:true | |
| You decide | Claude picks in planning | |

**User's choice:** Baseline rule.

### Where the source label lives

| Option | Description | Selected |
|--------|-------------|----------|
| Field in the object's JSON | `"keyPrefix": null, "keyPrefixSource": "unverified"` side by side | ✓ |
| Separate keyPrefixes.json | Registry map as research suggested; duplicates object names | |

**User's choice:** Field in the object's JSON.

### Labelling the 35 existing prefixes

| Option | Description | Selected |
|--------|-------------|----------|
| Only the shape now, Phase 9 fills in | Phase 8 makes the type nullable, defines label values, tests null with a test object | ✓ |
| Hand-label all 35 now | From Phase 3 fact tables; generator must reproduce byte for byte later | |

**User's choice:** Only the shape now.

---

## sigha upstream PR & red tests

### Who writes the fix and opens the PR

| Option | Description | Selected |
|--------|-------------|----------|
| Claude writes fix in Johan's fork, Johan opens PR | Branch in a fork Johan owns; corpus rows from BSD-3 formula-engine; Johan opens PR | ✓ |
| Claude opens PR after a checkpoint | `gh pr create` after OK; PR text goes out under Johan's name unseen in UI | |
| Defer fix to Phase 12 | Phase 8 only portable script, red tests, "pending" in VENDOR.md | |

**User's choice:** Claude writes the fix, Johan opens the PR.

### Expressing "red until Phase 12"

| Option | Description | Selected |
|--------|-------------|----------|
| vitest `it.fails` | Passes while failing, fails when resync makes it green; new pattern, built-in | ✓ |
| Expectation table with drift guard | JSON status per expression and a test failing on drift either way | |
| You decide | Claude picks in planning | |

**User's choice:** vitest `it.fails`.

### Existing tests that assert colon syntax throws UNSUPPORTED:formula

| Option | Description | Selected |
|--------|-------------|----------|
| Keep unchanged | Document current behaviour; removed in Phase 12 | ✓ |
| Replace with red tests now | Fewer tests but current classification loses protection | |

**User's choice:** Keep unchanged.

### Fork of rfaulhaber/sigha

| Option | Description | Selected |
|--------|-------------|----------|
| Create snorf/sigha at a checkpoint | Claude asks OK before `gh repo fork` and before pushing; work in a separate clone | ✓ |
| Fork already exists | — | |
| Johan creates the fork first | Claude waits for it | |

**User's choice:** Create at a checkpoint.

---

## Diagnostic shape

### Type shape

| Option | Description | Selected |
|--------|-------------|----------|
| One base plus two specialisations | `Diagnostic {area, message, object?, field?, cause?}` + `SkippedItem` + `FormulaFailure` | ✓ |
| One flat type | Only the base type | |
| You decide | Claude picks within roadmap names | |

**User's choice:** One base plus two specialisations.

### Relation between warning string and record

| Option | Description | Selected |
|--------|-------------|----------|
| String derived from the record | Shared formatter renders today's exact string; existing toEqual tests stay | ✓ |
| Record beside, string untouched | Two sources that can drift | |

**User's choice:** String derived from the record.

### Which sources emit records in Phase 8

| Option | Description | Selected |
|--------|-------------|----------|
| All existing sources | build, rollup, sfdx, prefixes, migrate (incl. schema-fk), FormulaRegistry, query | ✓ |
| Only migrate and FormulaRegistry | Rest retrofitted by later phases | |

**User's choice:** All existing sources.

---

## Claude's Discretion

- Catalog query for existing indexes; sequences treatment
- Hint line on the schema-fk warning
- Name/encoding of orglet's Diagnostic type vs sigha's Diagnostic
- Final keyPrefixSource value set and null-prefix test object placement
- Audit list and fixture README layout
- How sync-sigha.sh is exercised on Linux in CI without touching the vendored copy

## Deferred Ideas

- Colon evaluation and `!` as NOT — Phase 12
- OwnerId narrowing — Phase 9
- Labelling all 35 prefixes — Phase 9 generator
- Diagnostics renderer — Phase 14
- Re-deciding Phase 5 D-10 for formula roll-ups — Phase 13
