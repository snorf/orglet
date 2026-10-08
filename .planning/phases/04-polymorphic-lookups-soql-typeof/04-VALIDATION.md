---
phase: 4
slug: polymorphic-lookups-soql-typeof
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-10-08
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 3.2.7 (single root config, `@orglet/*` aliased to `src`) |
| **Config file** | `vitest.config.ts` (root) |
| **Quick run command** | `pnpm vitest run packages/soql/src packages/formula/src/formula.test.ts packages/engine/src/query.test.ts` |
| **Full suite command** | `pnpm build && pnpm lint && pnpm test` (pglite), plus `ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test` at the phase gate |
| **Estimated runtime** | ~4 seconds for a single unit file; ~30 seconds quick run (pglite per file); full suite ~1-2 minutes |

---

## Sampling Rate

- **After every task commit:** Run the task's `<automated>` command (one or two test files)
- **After every plan wave:** Run `pnpm test && pnpm lint`
- **Before `/gsd:verify-work`:** Full suite green on pglite and Docker Postgres, plus the plan 04-07 SDK legs
- **Max feedback latency:** ~30 seconds per task (pure compiler/formula tests ~4 seconds)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 4-01-01 | 01 | 1 | POLY-01 | unit | `pnpm vitest run packages/schema/src/ids.test.ts` | ✅ (extend) | ⬜ pending |
| 4-01-02 | 01 | 1 | POLY-01 | integration (pg) | `pnpm vitest run packages/engine/src/engine.test.ts packages/schema/src/ids.test.ts` | ✅ (extend) | ⬜ pending |
| 4-02-01 | 02 | 1 | POLY-06 | unit (no DB) | `pnpm vitest run packages/soql/src/compile.test.ts` | ✅ (extend); `typeof.ts` new | ⬜ pending |
| 4-03-01 | 03 | 1 | POLY-01 (formula half, D-16) | unit | `pnpm vitest run packages/formula/src/formula.test.ts` | ✅ (update line 42-45) | ⬜ pending |
| 4-03-02 | 03 | 1 | POLY-01 (gap record) | file check | `test -f .planning/todos/pending/2026-10-08-sigha-colon-syntax-for-polymorphic-formula-references.md` | ❌ created by task | ⬜ pending |
| 4-04-01 | 04 | 2 | POLY-01, POLY-02, POLY-05 | unit (generated SQL) | `pnpm vitest run packages/soql/src/compile.test.ts` | ✅ (update line 31 test + extend) | ⬜ pending |
| 4-04-02 | 04 | 2 | POLY-01, POLY-02, POLY-05 | unit + integration (pg) | `pnpm vitest run packages/soql/src packages/engine/src/query.test.ts` | `shape.test.ts` ❌ created by task; `query.test.ts` ✅ | ⬜ pending |
| 4-05-01 | 05 | 3 | POLY-04, POLY-03 | unit | `pnpm vitest run packages/soql/src` | ✅ | ⬜ pending |
| 4-05-02 | 05 | 3 | POLY-04 | integration (pg) | `pnpm vitest run packages/engine/src/query.test.ts` | ✅ | ⬜ pending |
| 4-06-01 | 06 | 4 | POLY-01 (SC1 three-way), POLY-03 | integration (pg, second OrgSchema, import mode) | `pnpm vitest run packages/engine/src/query.test.ts` | ✅ | ⬜ pending |
| 4-06-02 | 06 | 4 | POLY-03 (D-07 log), POLY-01/05 over REST | api | `pnpm vitest run packages/api/src/api.test.ts` | ✅ | ⬜ pending |
| 4-07-01 | 07 | 5 | POLY-01..06 | syntax check | `node --check conformance/poly-check/jsforce.mjs && python3 -m py_compile conformance/poly-check/sf_poly.py` | ❌ created by task | ⬜ pending |
| 4-07-02 | 07 | 5 | POLY-01..06 | full suite + live SDK | `pnpm build && pnpm lint && pnpm test` (+ Postgres run, + both SDK legs) | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

Success criteria to tests:
- SC1 (three-way agreement on one Group-owned Case): 4-06-01 `owner type agrees across SOQL Owner.Type, attributes.type and the write-path prefix rule ...`; formula leg asserts the recorded D-16 outcome (UNSUPPORTED:formula).
- SC2 (missing field -> null): 4-04-02 `user-only Name fields are null on a Group owner ...`; 4-05-02 ELSE `Name: null` on a Case.
- SC3 (unmodelled prefix degrades): 4-04-02 shape unit, 4-05-01 shape unit, 4-06-01 second-schema test, 4-06-02 REST log line.
- SC4 (TYPEOF + `.Type` filter): 4-04-01/02 (`Owner.Type` select/filter/sort/group), 4-05-01/02 (TYPEOF).
- SC5 (invalid TYPEOF forms): 4-02-01 (12+ cases).

---

## Wave 0 Requirements

No separate Wave 0 plan: every task writes its tests in the same task (RED first for `tdd="true"` tasks), on existing infrastructure (vitest, `test/db.ts` with embedded pglite).

- [ ] `packages/soql/src/shape.test.ts` — new, created by 4-04-02 (pure row-shaping tests)
- [ ] Group (Type Queue) + Group-owned / User-owned Case fixture in `packages/engine/src/query.test.ts` — created by 4-04-02, reused by 4-05-02 and 4-06-01
- [ ] Task fixtures (WhatId -> Account / Opportunity / Case) — created by 4-05-02
- [ ] Second in-memory `OrgSchema` without Group + import-mode engine — created by 4-06-01
- [ ] `conformance/poly-check/` scaffold — created by 4-07-01

*Existing infrastructure covers all phase requirements; no framework install.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| jsforce and simple-salesforce see the polymorphic surface against a live orglet | POLY-01..06 | Needs a running `orglet up` on Docker Postgres and the jsforce build / Python venv; not in CI until phase 7 | `conformance/poly-check/README.md`; run by the executor in 4-07-02, output recorded verbatim in 04-07-SUMMARY.md |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [ ] Feedback latency < 4s (pure unit files yes; pglite-backed files ~10-30s, accepted as in phases 1-3)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
