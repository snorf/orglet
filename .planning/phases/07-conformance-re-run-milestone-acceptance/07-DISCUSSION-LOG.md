# Phase 7: Conformance Re-Run & Milestone Acceptance - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-11
**Phase:** 07-conformance-re-run-milestone-acceptance
**Areas discussed:** jsforce Bulk 2.0 inclusion, Python harness (README + Bulk coverage), CI wiring for conformance, Acceptance evidence (format and location)

---

## Pending todos matched to this phase

| Todo | Selected |
|------|----------|
| Reword ROADMAP phase 7 to validate against the DE retrieve, not the org (planning) | ✓ folded |
| Narrow baseline OwnerId referenceTo per object (metadata) | deferred |
| Support Relationship:Object.Field colon syntax for polymorphic formula references (formula) | deferred |

**Notes:** The DE retrieve already loads with 0 warnings (2026-10-09), so neither metadata/formula todo is needed for ACCEPT-01.

---

## jsforce Bulk 2.0 inclusion

### How far should Bulk 2.0 inclusion go?
| Option | Description | Selected |
|--------|-------------|----------|
| bulk2.test.ts + filter adjustment | Add bulk2.test.ts to run.sh, make regex v1-specific, no upstream patches, classify each failing bulk2 test; Query#update/destroy stay excluded (v1 default in jsforce) | ✓ |
| Also patch insertAccounts to bulk2 | Local sed/patch so Query#update/destroy and search records can be included; harness diverges from upstream | |
| Run Query#update/destroy with bulkApiVersion 2 | Still requires a test patch | |

### Pin jsforce instead of tracking main?
| Option | Description | Selected |
|--------|-------------|----------|
| Pin to a commit sha | run.sh checks out a fixed sha (today's main); README records it; upgrades are deliberate | ✓ |
| Pin to latest release tag | More readable, but e2e tests in a tag may lag main | |
| Keep tracking main | Numbers can change without orglet changing | |

### run.sh default vs README run
| Option | Description | Selected |
|--------|-------------|----------|
| run.sh runs exactly the README run | File list and -t regex move into run.sh as default; broad run via explicit args | ✓ |
| Keep broad default, document the filter | run.sh unchanged; README gives the filtered command | |

### Expected failures in the numbers
| Option | Description | Selected |
|--------|-------------|----------|
| Exclude via filter, target 0 failed | Anything that cannot pass for a documented reason is excluded and listed with its reason | ✓ |
| Run everything, report failed with reason | More tests run, README must explain each failure | |

**User's choice:** all recommended options.
**Notes:** No follow-up questions requested.

---

## Python harness: README + Bulk coverage

### Add Bulk 2.0 checks via simple-salesforce bulk2?
| Option | Description | Selected |
|--------|-------------|----------|
| Yes, a few bulk2 checks | Ingest insert + results, one query job; total becomes 26+N | ✓ |
| No, document 26/26 only | Minimal change; Bulk 2.0 unproven through simple-salesforce | |

### Pin simple-salesforce?
| Option | Description | Selected |
|--------|-------------|----------|
| Pin exact version | The version the venv has today; README states it | ✓ |
| Leave unpinned | Numbers describe an uncontrolled version | |

### Configuration of BASE_URL/USERNAME/API_VERSION
| Option | Description | Selected |
|--------|-------------|----------|
| Environment variables with today's values as defaults | Same pattern as jsforce harness; no behaviour change for existing usage | ✓ |
| Leave hard-coded | Surgical minimum | |

### Contents of conformance/python/README.md
| Option | Description | Selected |
|--------|-------------|----------|
| Mirror the jsforce README structure | Purpose, prerequisites, run command, pinned version, dated results table, known gaps | ✓ |
| Short: run command + numbers | Minimal file satisfying ACCEPT-03 | |

**User's choice:** all recommended options.

---

## CI wiring for conformance

### What runs in GitHub Actions?
| Option | Description | Selected |
|--------|-------------|----------|
| One separate conformance job, all harnesses | orglet up against Postgres service with examples/acme; python, jsforce subset, describe/poly/rollup checks; not required for main initially | ✓ |
| Only the fast ones (python + describe/poly/rollup) | jsforce stays manual | |
| No conformance in CI | Everything manual and dated in README | |

### Trigger
| Option | Description | Selected |
|--------|-------------|----------|
| Every push/PR like the other jobs | Same trigger as test-pglite/test-postgres | ✓ |
| Only PRs to main + workflow_dispatch | Less CI time on feature branches | |
| Only manual/scheduled | Low cost, low signal | |

### Required status check on main?
| Option | Description | Selected |
|--------|-------------|----------|
| No in phase 7, revisit later | Ruleset change is outward-facing; job is new | ✓ |
| Yes, as soon as green | Strongest guarantee; flaky jsforce clone would block merges | |

### Cache the jsforce build?
| Option | Description | Selected |
|--------|-------------|----------|
| Cache .cache/jsforce on sha | actions/cache keyed on the pinned sha | ✓ |
| Build every time | Simpler workflow, longer runtime | |

**User's choice:** all recommended options.

---

## Acceptance evidence: format and location

### Strict mode for orglet check?
| Option | Description | Selected |
|--------|-------------|----------|
| Add --strict: exit 1 on warnings | Small CLI change with test; default unchanged; usable in users' own CI | ✓ |
| No CLI change, grep stderr | Acceptance is a shell command | |

### Where is the DE retrieve run recorded?
| Option | Description | Selected |
|--------|-------------|----------|
| conformance/README.md + .planning | New top-level README with dated overview table incl. DE check; raw output in .planning as before | ✓ |
| Only .planning | Repo reader sees no evidence | |
| Root README | Mixes project presentation with test protocol | |

### Presentation of numbers in harness READMEs
| Option | Description | Selected |
|--------|-------------|----------|
| Dated table: passed/failed/excluded + reason per exclusion | Date, pinned SDK version, orglet commit; exclusions classified; old undated table removed | ✓ |
| Keep prose, update numbers | Risk of stale paragraphs remaining | |

### Fix all stale conformance/acceptance text?
| Option | Description | Selected |
|--------|-------------|----------|
| Yes, fix everything conformance/acceptance related | Includes ROADMAP line 14 (folded todo) and a sentence in README's legal note | ✓ |
| Only what ACCEPT-03 requires | Harness READMEs only; rest becomes a todo | |

**User's choice:** all recommended options.

---

## Claude's Discretion

- Exact shape/number of Python bulk2 checks.
- Exact -t regex and handling of the Jest re-registration quirk (no upstream patches).
- CI job mechanics: dist vs tsx, token acquisition, seed data handling.
- Table layout and classification vocabulary, as long as every exclusion has a reason.
- Order of work within the phase; DE check runs last on final code.

## Deferred Ideas

- Making the conformance job a required check on main (needs Johan's OK).
- Upstream contribution to jsforce so insertAccounts uses bulk2.
- Bulk API v1; Heimdall e2e target; `orglet check --json`.
- Todos not folded: OwnerId narrowing, sigha colon syntax.
