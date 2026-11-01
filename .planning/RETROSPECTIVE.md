# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — hardening

**Shipped:** 2026-10-12
**Phases:** 7 | **Plans:** 37 | **Sessions:** ~12 (one or two per phase, 2026-09-29 → 2026-10-12)

### What Was Built
- Docker-free test suite on embedded pglite; public repo with CI (`test-pglite`, `test-postgres`, `conformance`) and a ruleset on `main`.
- Persisted custom-object key prefixes; 14 thin standard-object baselines with DML flags.
- Polymorphic lookups by key prefix (write path, formula parents, SOQL joins) and `TYPEOF`.
- Roll-up summary fields with pipeline recompute, chain attribution and one-time migrate backfill.
- Persisted Bulk API 2.0 jobs with atomic per-chunk results and boot reconciliation.
- Measured, dated, reproducible conformance: DE retrieve 0 warnings under `--strict`, jsforce 51/0/60 + bulk2 12/0/5, simple-salesforce 29/29, all in CI.

### What Worked
- Discuss → research → plan → check → execute → verify per phase kept every phase to one or two sessions; plan checkers caught real hazards (parallel `pnpm build` sharing `dist`, brittle verify gates) before execution.
- Running plumbing plans on sonnet and core-engine plans (SOQL compiler, roll-up pipeline) on the main model held cost down without quality loss.
- Human checkpoints at the right spots: devrandom org upgrades, the Bulk restart smoke, the empty-CSV decision, the push to CI.
- "Withhold the requirement ID until it is actually true" (phase 5 executors) and reverting eager ACCEPT ticks (phase 7) kept traceability honest.
- Measured numbers over predicted ones: the research's 51/0/60 prediction was labelled as such until phase 7 measured it.

### What Was Inefficient
- A researcher stalled with nothing written (600 s watchdog); resuming it worked, but "write the file early and append" should be in every researcher prompt.
- GSD bookkeeping drifted: `phase complete` misses the ROADMAP checkbox and progress row, VALIDATION.md maps were never updated after execution, `04-VERIFICATION.md` kept `human_needed` after the UAT passed, STATE.md kept stale blockers. Each needed manual correction at audit time.
- Parallel executors in one working tree both ran `state advance-plan`, so counters needed a check after each wave.
- `gsd-tools config-set` strips the trailing newline of config.json; `gsd-tools commit` omits trailers.
- `MILESTONES.md` auto-generation dumps every one-liner (incl. deviation headings); rewritten by hand.

### Patterns Established
- Level 1 data rule in practice: the DE retrieve is read only through `orglet check`; only exit code, warning count and the summary line are recorded; never in repo or CI.
- `UNSUPPORTED:<area>` for orglet gaps vs. real Salesforce codes (`FEATURE_NOT_ENABLED`, `INVALID_TYPE_FOR_OPERATION`) for things Salesforce also rejects.
- Phase branches `gsd/phase-N-slug` → PR → ruleset-protected `main`; milestone bookkeeping also goes through a PR branch.
- Conformance evidence is only evidence if the command that produced it is pinned and re-runnable (`run.sh` default = README run; `run-all.sh` shared by CI and local).
- Fidelity bugs exposed by SDK suites are fixed only with a documented Salesforce basis; otherwise excluded with a classification and reason.

### Key Lessons
1. Put "write output early, append incrementally" in every long-running agent prompt; resume a stalled agent before relaunching.
2. Never let an executor tick a requirement that a later plan is supposed to prove; state it in the executor prompt.
3. Check STATE/ROADMAP counters after every parallel wave; GSD's state commands are not concurrency-safe.
4. Before a milestone audit, refresh VERIFICATION/VALIDATION files that human checkpoints resolved, or the audit will report bookkeeping debt.
5. Jest's `-t` filter is global across files; identically named tests in two files cannot be separated without separate invocations.

### Cost Observations
- Model mix (by agent count): roughly 60% sonnet (executors, checkers, verifiers, most researchers), 40% main model (orchestration, core-engine plans in phases 4-5, discussion).
- Sessions: ~12.
- Notable: phase 7 (docs/harness heavy) ran entirely on sonnet executors with no quality issues; the costliest single item was the phase 7 planner (~220k tokens) producing six plans that passed the checker first time.

---

## Milestone: v1.1 — real-org fidelity

**Shipped:** 2026-11-01
**Phases:** 7 (8-14) | **Plans:** 62 | **Sessions:** not counted; roughly one to three per phase plus a gap-closure round in Phase 14 (2026-10-12 → 2026-11-01)

### What Was Built
- Upgrade safety net: populated v1.0 database upgrades without data loss, `UNSUPPORTED:schema-fk` instead of an aborted `up`, idempotent second `up`, nullable key prefixes, structured diagnostics beside the warning strings.
- Generator-produced baseline: 35 objects at field parity (659 → 2 536 fields, v1.0 fields byte-identical), 18 business objects, per-object `ownerTargets`, MasterDetail refusal, v1-vs-v2 diff gate, CI drift check.
- Custom metadata types with seeded records, `MetadataRelationship`, List/Hierarchy custom settings, custom labels; `conformance/cmdt-check`.
- sigha resynced to a fork pin for unary `!` and colon syntax; `$UserRole`, `$Api`, `$Label`, `$CustomMetadata`, hierarchy `$Setup`; formula dependency lists.
- Roll-ups over same-object non-volatile formula fields with Salesforce's admission rules and a crash-safe backfill.
- `orglet check` as a root-cause report with `--summary`/`--json`; `examples/enterprise` in CI; DE retrieve 0 warnings; large retrieve 94 counted exclusions.

### What Worked
- Pinning every external input and gating it in CI: sf-skills snapshot, Object Reference extraction, fork SHA for sigha, SDK versions; `baseline-gen-check` and `sigha-sync-check` caught drift before it reached `main`.
- Human checkpoints exactly where the data or outward-facing action was: generator policy conflicts (09-06), DE-confirmed key prefixes (10-03), the fork/push decisions (08-09/08-10, 12-01), the `SKIP_RATIO_MAX` and round-2 standard-field decisions.
- Acceptance as a two-round loop: the first Phase 14 verification failed honestly (150 warnings), the gap-closure plans 14-08..14-12 were planned from a local triage and brought it to 94 with every remainder documented by category. "Counted exclusions, names never recorded" kept Level 1 data out of the repo while still giving a checkable number.
- The `info:` category for unreferenced standard objects and root-cause grouping made a 400-line report readable; `--summary` made it pasteable.
- Snapshot fixtures (`baseline-v1.0`) turned "an upgrade must not lose data" into a test that runs on both backends on every push.

### What Was Inefficient
- Bookkeeping drift repeated v1.0 lesson 4 instead of fixing it: 08-VERIFICATION.md stayed `human_needed` after two of three items passed, 11-VALIDATION.md was never refreshed after execution, STATE.md pointed at backlog phase 999.1 and ROADMAP's 999.1 entry got Phase 14's "12/12 plans" counter. All found at audit time again.
- `gsd-tools milestone complete` again produced an unusable MILESTONES.md entry (deviation headings as "accomplishments", 19 phases because backlog entries count, 17 tasks) and inserted blank lines into the v1.0 section; reverted and hand-written, as predicted in the v1.0 retrospective.
- The first Phase 14 acceptance ran before the large-retrieve gaps were triaged, so one extra planning round was needed; a triage plan slot before the acceptance plan would have saved it.
- Environment friction: Python conformance legs need an arm64 venv (Phase 12), the Postgres leg needed `maxWorkers: 3` for the ~500-relation schema (Phase 9), the integration checker's shell ran Node 18 and could not execute pglite tests.
- 41 pre-existing tsc errors in test files were noted in Phase 9 and still sit outside the CI gate.

### Patterns Established
- Generator + `overrides.json` + v1 pins + diff gate + CI check for any data derived from documentation.
- Counted exclusions: an acceptance against private data is recorded as counts per category with the categories documented publicly, never as names.
- Fork pin + orglet-owned guard outside the vendored tree (`packages/sigha/test/corpus-baseline.test.ts`) when upstream is slow.
- Derived, stable Ids for file-sourced rows (`__mdt` records) with a full sync per type instead of a state table.
- Diagnostics as structured records beside unchanged user-facing strings; exit codes derive from the strings.
- `info:` for things the user cannot act on, `warning:` only for referenced gaps, `--strict` ignores info.

### Key Lessons
1. Refresh VERIFICATION/VALIDATION files the moment a human checkpoint resolves, and check STATE.md's phase pointer after the last phase of a milestone; otherwise the audit reports the same bookkeeping debt a second time (v1.0 lesson 4, now confirmed twice).
2. Treat `gsd-tools milestone complete` output as scaffolding to revert: hand-write MILESTONES.md and STATE.md.
3. Plan a triage slot between "run the acceptance" and "tick the requirement" when the acceptance target is real data; expect a gap-closure round.
4. Pin and CI-gate every external input; a drift check is cheaper than a debugging session.
5. Put a staff-level "stricter than planned" check in executor prompts: several Phase 9/10 deviations (abort instead of drop, forced-nullable scope) were right, but each needed an orchestrator review to confirm.

### Cost Observations
- Model mix (by agent count, approximate): roughly 60-65% sonnet (executors, plan checkers, verifiers, integration checker, most researchers), 35-40% main model (orchestration, discussion, Phase 9 generator design, Phase 12/13 formula and roll-up core).
- Sessions: not counted (roughly 15-20).
- Notable: Phase 9 (generator, 51 files in one plan) and Phase 14 (two verification rounds, 12 plans) were the costliest; the baseline JSON diff (+145k lines) dominates the milestone's file churn but cost nothing in tokens because it is generated.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | ~12 | 7 | Adopted GSD on an existing phase-0 codebase; phase branches + PRs; sonnet executors from phase 4 on; conformance moved into CI |
| v1.1 | ~15-20 | 7 | Generator-driven baseline with CI drift gates; acceptance as a two-round loop with gap-closure plans; counted exclusions for private data; five CI jobs |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | 427 (25 files) + 8 conformance legs | not measured | pglite (dev only), @electric-sql/pglite-socket (dev only); runtime deps unchanged |
| v1.1 | 922 (55 files) + 21 conformance legs (acme 10, enterprise 11) | not measured | runtime deps unchanged; `scripts/gen-baseline` (tsx, dev only); test-only pglite ReadyForQuery filter |

### Top Lessons (Verified Across Milestones)

1. (confirmed v1.0, v1.1) Measured, pinned, re-runnable evidence beats recorded numbers; in v1.1 this extended to counted exclusions for private data.
2. (confirmed v1.0, v1.1) Human checkpoints belong where real data or outward-facing actions are involved, nowhere else.
3. (confirmed v1.0, v1.1) GSD bookkeeping (VERIFICATION/VALIDATION status, STATE phase pointer, `milestone complete` output) drifts unless refreshed at the moment a checkpoint resolves; budget a bookkeeping pass before every audit.
