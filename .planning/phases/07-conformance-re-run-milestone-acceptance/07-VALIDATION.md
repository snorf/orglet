---
phase: 7
slug: conformance-re-run-milestone-acceptance
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-10-12
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.2.x (`pnpm test`, root `vitest.config.ts`); jsforce Jest and the python script are external harnesses under `conformance/` |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `pnpm vitest run packages/cli/src/main.test.ts` |
| **Full suite command** | `pnpm build && pnpm lint && pnpm test` |
| **Estimated runtime** | ~5 s quick; ~90 s full suite on pglite |

---

## Sampling Rate

- **After every task commit:** Run `pnpm vitest run packages/cli/src/main.test.ts` (CLI tasks) or `bash -n conformance/jsforce/run.sh` / `python -m py_compile conformance/python/run.py` (harness tasks)
- **After every plan wave:** Run `pnpm build && pnpm lint && pnpm test`, plus one local conformance run (`run.sh` + `run.py`) against a fresh `--org-schema` on a throwaway port
- **Before `/gsd:verify-work`:** Full suite green, CI `conformance` job green, DE retrieve check run last on the final commit
- **Max feedback latency:** 120 seconds (unit); one conformance run per wave

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 07-01 | 1 | ACCEPT-01 | unit (CLI `--strict`) | `pnpm vitest run packages/cli/src/main.test.ts` | ✅ (extend) | ⬜ pending |
| 07-01-02 | 07-01 | 1 | ACCEPT-02 | unit/integration (`sf__Error` ` --`) | `pnpm vitest run packages/api/src/bulk.test.ts packages/api/src/bulk/store.test.ts packages/api/src/bulk-persistence.test.ts` | ✅ (tighten) | ⬜ pending |
| 07-02-01 | 07-02 | 1 | ACCEPT-02 | syntax + grep | `conformance/describe-check/.venv/bin/python -m py_compile conformance/python/run.py` | ✅ (extend) | ⬜ pending |
| 07-02-02 | 07-02 | 1 | ACCEPT-02, ACCEPT-03 | external (python, fresh `pyconf7` :8091) | `BASE_URL=http://localhost:8091 conformance/describe-check/.venv/bin/python conformance/python/run.py` | ❌ README new | ⬜ pending |
| 07-03-01 | 07-03 | 2 | ACCEPT-02 | syntax + grep | `bash -n conformance/jsforce/run.sh` | ✅ (rewrite) | ⬜ pending |
| 07-03-02 | 07-03 | 2 | ACCEPT-02 | external (jsforce core + UNFILTERED bulk2, fresh `jsconf7` :8092) | `conformance/jsforce/run.sh http://localhost:8092 "$TOKEN" --seed` | ✅ | ⬜ pending |
| 07-03-03 | 07-03 | 2 | ACCEPT-02 | checkpoint:decision (empty-CSV, bulk2 dispositions) | `grep -c 'Decision (Task 3)' 07-03-SUMMARY.md` | n/a | ⬜ pending |
| 07-04-01 | 07-04 | 3 | ACCEPT-02 | unit (empty-CSV branch A) + syntax | `bash -n conformance/jsforce/run.sh && pnpm vitest run packages/api/src/bulk.test.ts` | ✅ | ⬜ pending |
| 07-04-02 | 07-04 | 3 | ACCEPT-02, ACCEPT-03 | external (jsforce final, 0 failed both runs) + grep README | `conformance/jsforce/run.sh http://localhost:8092 "$TOKEN" --seed` | ✅ (rewrite README) | ⬜ pending |
| 07-05-01 | 07-05 | 4 | ACCEPT-02 | external (all 8 legs, fresh `ciconf7` :8093) | `PORT=8093 ORG_SCHEMA=ciconf7 PYTHON=conformance/describe-check/.venv/bin/python conformance/run-all.sh` | ❌ W0 (new script) | ⬜ pending |
| 07-05-02 | 07-05 | 4 | ACCEPT-02 | grep / actionlint | `grep -nE '^  (test-pglite\|test-postgres\|conformance):$' .github/workflows/ci.yml` | ✅ (extend) | ⬜ pending |
| 07-05-03 | 07-05 | 4 | ACCEPT-02 | checkpoint:decision (push) | `grep -cE 'Johan: (push\|defer)' 07-05-SUMMARY.md` | n/a | ⬜ pending |
| 07-05-04 | 07-05 | 4 | ACCEPT-02 | CI job `conformance` | `gh run list --branch gsd/phase-07-conformance-re-run-milestone-acceptance --workflow CI --limit 1 --json conclusion` | n/a | ⬜ pending |
| 07-06-01 | 07-06 | 5 | ACCEPT-03 | grep sweep (stale text) | `grep -rnE "soql-for\|Bulk API is not implemented\|today: 15\|real Developer Edition org" README.md conformance .planning/ROADMAP.md .planning/PROJECT.md .planning/codebase` (expect none) | ✅ | ⬜ pending |
| 07-06-02 | 07-06 | 5 | ACCEPT-02, ACCEPT-03 | full suite + external re-run on final code (`final7` :8094) | `pnpm build && pnpm lint && pnpm test && PORT=8094 ORG_SCHEMA=final7 PYTHON=conformance/describe-check/.venv/bin/python conformance/run-all.sh` | ❌ conformance/README.md new | ⬜ pending |
| 07-06-03 | 07-06 | 5 | ACCEPT-01 | manual-local (DE retrieve, LAST) | `node packages/cli/dist/index.js check --strict --project ~/Development.nosync/devrandom-metadata` | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Task IDs filled by the planner 2026-10-12. Sampling: every task has an automated command; no 3 consecutive tasks without one (checkpoints 07-03-03 and 07-05-03 are each surrounded by automated tasks).*

---

## Wave 0 Requirements

- [ ] Unfiltered `bulk2.test.ts` run against a fresh org schema recorded (basis for every exclusion; D-21) — task 07-03-02
- [ ] `--strict` tests added to `packages/cli/src/main.test.ts` (exit 0 on acme, exit 1 on a temp project with an `ExternalLookup` field) — task 07-01-01
- [ ] Python `insert()` return keys and https→http session forwarding to `bulk2` confirmed in a first run — task 07-02-02 (session forwarding already confirmed from simple_salesforce 1.12.10 source: `Salesforce.__getattr__('bulk2')` passes `self.session`)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| DE retrieve loads with 0 warnings | ACCEPT-01 | Retrieve is Level 1, local only, never in repo or CI | On Johan's machine after `pnpm build` on the final commit: run the `check --strict` command above, redirect stdout/stderr to scratch files, record `exit=`, `warning:` count and the first stdout line only |
| devrandom dev server starts silently | ACCEPT-01 | Same data constraint | `orglet up --org-schema devrandom --port 8180` prints no `warning:` lines (optional human checkpoint) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
