---
phase: 7
slug: conformance-re-run-milestone-acceptance
status: draft
nyquist_compliant: false
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
| 07-XX-XX | — | — | ACCEPT-01 | unit (CLI `--strict`) | `pnpm vitest run packages/cli/src/main.test.ts` | ✅ (extend) | ⬜ pending |
| 07-XX-XX | — | — | ACCEPT-01 | manual (DE retrieve) | `node packages/cli/dist/index.js check --strict --project ~/Development.nosync/devrandom-metadata` | n/a | ⬜ pending |
| 07-XX-XX | — | — | ACCEPT-02 | external (jsforce) | `conformance/jsforce/run.sh <url> <token> --seed` | ✅ (rewrite) | ⬜ pending |
| 07-XX-XX | — | — | ACCEPT-02 | external (python) | `conformance/python/.venv/bin/python conformance/python/run.py` | ✅ (extend) | ⬜ pending |
| 07-XX-XX | — | — | ACCEPT-02 | CI job `conformance` | push / PR | ❌ W0 | ⬜ pending |
| 07-XX-XX | — | — | ACCEPT-03 | grep | `grep -c` for date, pinned sha/version, each exclusion keyword in the three READMEs | ❌ (python README new) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*The planner fills Task IDs, plan and wave columns.*

---

## Wave 0 Requirements

- [ ] Unfiltered `bulk2.test.ts` run against a fresh org schema recorded (basis for every exclusion; D-21)
- [ ] `--strict` tests added to `packages/cli/src/main.test.ts` (exit 0 on acme, exit 1 on a temp project with an `ExternalLookup` field)
- [ ] Python `insert()` return keys and https→http session forwarding to `bulk2` confirmed in a first run

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
