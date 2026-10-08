# Phase 3: Thin Standard-Object Baselines - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-03 to 2026-10-08 (discussion resumed across sessions)
**Phase:** 03-thin-standard-object-baselines
**Areas discussed:** Field surface per thin object, Seed rows at bootstrap, Write protection in import mode, SDK verification of describe

---

## Pre-discussion: todo cross-reference

| Option | Description | Selected |
|--------|-------------|----------|
| No, leave it for phase 7 | Keyword-only match; the todo is about phase 7 wording | ✓ |
| Yes, fold the wording fix into phase 3 | One ROADMAP line fixed as part of phase 3 | |

**User's choice:** No, leave it for phase 7

---

## Field surface per thin object

### How thin is thin?

| Option | Description | Selected |
|--------|-------------|----------|
| Strict minimum | Id, documented name-equivalent field, system fields, OwnerId only where owned; exactly BASE-01; HEAD-06 is v2 | ✓ |
| Minimum plus documented lookups | Also relationship fields to existing baseline objects (Entitlement.AccountId, ...) | |
| Minimum plus what the DE retrieve touches | Only fields the DE metadata references; likely zero extra | |

**User's choice:** Strict minimum

### Name-equivalent field where Name is absent

| Option | Description | Selected |
|--------|-------------|----------|
| Follow the Object Reference exactly | nameField on the designated field; none where Salesforce has none; browser falls back to Id | ✓ |
| Synthetic Name everywhere | Simpler for UI/tests but describe diverges from a real org | |

**User's choice:** Follow the Object Reference exactly

### Handling unconfirmed facts (IdeaTheme prefix, four name fields)

| Option | Description | Selected |
|--------|-------------|----------|
| Verify in research, otherwise stop | Two independent public sources per fact; unconfirmed items become a checkpoint, never a guess | ✓ |
| Best public source is enough | One source; uncertainty noted | |
| Johan checks in his own DE org | sf sobject describe for the uncertain ones; his decision | |

**User's choice:** Verify in research, otherwise stop

---

## Seed rows at bootstrap

### Which rows

| Option | Description | Selected |
|--------|-------------|----------|
| Default BusinessHours + one UserLicense | Mirrors a real org; read-only objects otherwise never get rows; Profile.UserLicenseId set | ✓ |
| Only BusinessHours | Smallest bootstrap change | |
| No seed rows | Strict "thin"; tables empty until written/imported | |

**User's choice:** Default BusinessHours + one UserLicense

### Idempotence on an existing org

| Option | Description | Selected |
|--------|-------------|----------|
| Create if missing, never touch existing | Same pattern as Organization/User; Profile.UserLicenseId set only when null | ✓ |
| Only at first bootstrap | Existing orgs get no seed rows until reset | |

**User's choice:** Create if missing, never touch existing

---

## Write protection in import mode

### Should --import bypass object flags?

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, import mode bypasses object flags | Consistent with field flags, lookups, rules, hooks; only way to migrate OpportunityHistory etc. | ✓ |
| No, object flags always apply | Rows only via bootstrap seed | |
| Only insert bypassed | Middle ground | |

**User's choice:** Yes, import mode bypasses object flags

### Error code in normal mode

| Option | Description | Selected |
|--------|-------------|----------|
| Let research verify against docs | Keep invalidOperation only if documented; otherwise the documented code; no invented codes | ✓ |
| Keep today's code as is | Fastest; risk of diverging from a real org | |

**User's choice:** Let research verify against docs

---

## SDK verification of describe (BASE-04)

(The first attempt to ask this was interrupted on 2026-10-03; re-asked on 2026-10-08 with the script-placement sub-question folded into the recommended option.)

| Option | Description | Selected |
|--------|-------------|----------|
| Unit test + targeted SDK run | Vitest for all 14 objects on the SDK-read properties, plus a reusable describe-check script in conformance/ run against a live orglet; full conformance stays phase 7 | ✓ |
| Unit test only | SDKs first exercised in phase 7 | |
| Leave to Claude | Recommendation written as Claude's own choice | |

**User's choice:** Unit test + targeted SDK run

---

## Claude's Discretion

- JSON layout details; seed-row discovery queries and constants; import-bypass implementation
  shape; describe-check script name/interface and README timing; codebase-map updates.

## Deferred Ideas

- Full field sets (HEAD-06); documented lookups on thin objects; a generic `thin` JSON flag;
  describe-check in CI.
