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

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | ~12 | 7 | Adopted GSD on an existing phase-0 codebase; phase branches + PRs; sonnet executors from phase 4 on; conformance moved into CI |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | 427 (25 files) + 8 conformance legs | not measured | pglite (dev only), @electric-sql/pglite-socket (dev only); runtime deps unchanged |

### Top Lessons (Verified Across Milestones)

1. (first milestone — to be confirmed in v1.1) Measured, pinned, re-runnable evidence beats recorded numbers.
2. (first milestone — to be confirmed in v1.1) Human checkpoints belong where real data or outward-facing actions are involved, nowhere else.
