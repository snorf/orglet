---
phase: 14-check-report-enterprise-acceptance
plan: 05
subsystem: conformance
tags: [run-all, enterprise, ci, describe-check, custom-settings]
requires: ["14-02", "14-03", "14-06"]
provides:
  - "run-all.sh parameterised by PROJECT (FIXTURE derived and passed to poly/rollup legs)"
  - "examples/enterprise/seed.mjs: custom-setting seed plus $Setup user-row proof"
  - "describe-check over objects-enterprise.txt (38 objects) through both SDKs"
  - "CI: check --strict on enterprise; conformance matrix acme/enterprise"
key-files:
  created:
    - examples/enterprise/seed.mjs
    - conformance/describe-check/objects-enterprise.txt
  modified:
    - conformance/run-all.sh
    - conformance/describe-check/jsforce.mjs
    - conformance/describe-check/sf_describe.py
    - conformance/describe-check/README.md
    - conformance/jsforce/README.md
    - conformance/README.md
    - examples/enterprise/README.md
    - .github/workflows/ci.yml
key-decisions:
  - "describe-check exempts __mdt objects from the IsDeleted system-field requirement (no recycle bin, Phase 11 D-16) instead of faking the field or dropping the objects"
requirements-completed: [ACC2-02]
duration: 40min
completed: 2026-10-29
---

# Phase 14 Plan 05: Conformance harness for the enterprise fixture Summary

run-all.sh runs the whole conformance set against either fixture (`PROJECT=examples/enterprise`), seeds the enterprise custom settings over REST with a $Setup proof, and CI runs both fixtures. One leg does NOT pass on enterprise: jsforce-subset (1 core test, a known orglet SOQL gap exposed by the fixture, see Findings).

## Commits

- 8ce5f34: run-all.sh PROJECT/FIXTURE, seed.mjs, objects-enterprise.txt, describe-check mdt exemption, READMEs (Task 1)
- 6ae1c96: ci.yml check --strict step and conformance matrix, conformance/README.md (Task 2)

## Verification actually run

Built dist was used as it was (see "Build note"). Fresh schemas, Postgres on 5433, Python = describe-check arm64 venv.

Enterprise (`PROJECT=examples/enterprise ORG_SCHEMA=p14_ent2 PORT=8096`), exit 1:

```
FAIL jsforce-subset        (core: 50 passed / 1 failed / 60 skipped; Bulk 2.0: 12 passed / 5 skipped)
PASS simple-salesforce     29/29
PASS enterprise-seed       ok org-default / user-row / list-rows / setup-formula-reads-user-row Default_Region__c=NORDICS countries=2
PASS describe-check-jsforce        38/38
PASS describe-check-python         38/38
PASS poly-check-jsforce / python   6/6, 6/6  (information only here)
PASS rollup-check-jsforce / python 6/6, 6/6  (information only here)
PASS cmdt-check-jsforce / python   8/8, 8/8
```

Acme (`ORG_SCHEMA=p14_acme PORT=8093`), exit 0, same 10 legs as before: jsforce core 51/0/60, Bulk 2.0 12/5, simple-salesforce 29/29, describe-check 32/32 x2, poly-check 5/5 x2, rollup-check 5/5 x2, cmdt-check 8/8 x2.

`node packages/cli/dist/index.js check --strict --project examples/enterprise`: exit 0 (info lines only).

Also: `bash -n conformance/run-all.sh`, `node --check examples/enterprise/seed.mjs`. ci.yml: PyYAML is not installed, so no YAML parser was run; the edited blocks were checked by diff/read-back only (not machine-validated). The first enterprise run (schema `p14_ent`, before the mdt exemption) showed describe-check 36/38 and is superseded by the run above.

Not run: `pnpm test`, `pnpm lint`, the CI workflow itself.

## Findings

1. **jsforce-subset fails on enterprise (1 test), run-all.sh exits 1 for the enterprise fixture.** `sobject.test.ts` "should select records with asterisk": `Opportunity.select('*, Account.*, Owner.Name')` expands `Account.*`, and the enterprise fixture (14-02) has formula fields on Account (`Gated_Check__c`, `Owner_Email__c`). orglet raises `UNSUPPORTED:soql-formula formula field Account.Gated_Check__c on a parent relationship cannot be selected yet` (`packages/soql/src/compile.ts:345`). Classified in `conformance/jsforce/README.md`. This is a genuine orglet gap, not a harness fault; I did not weaken the suite or add a test exclusion (that would change the acme numbers). It means the CI `conformance` job for `examples/enterprise` will be red until a decision is made: (a) implement formula selection through parent relationships in the SOQL layer, (b) move/relocate the Account formulas in the fixture (but enterprise.test.ts pins those categories), or (c) add a documented jsforce exclusion applied only for FIXTURE=enterprise. Needs Johan's decision; gated by 14-07 Task 1.
2. **__mdt describe lacks IsDeleted by design (D-16).** describe-check's `systemFields` requirement is exempted for `__mdt` in both scripts (documented in its README); objects stay in the list.
3. The `$Setup` proof passed: the user-level `Org_Defaults__c` row wins (`NORDICS`) over the org default (`EU`).

## Deviations from Plan

**1. [Rule 1 - Harness bug] describe-check IsDeleted requirement for __mdt** - the check demanded a field orglet deliberately omits for custom metadata types. Fixed in jsforce.mjs and sf_describe.py (commit 8ce5f34).

**2. [Rule 4-adjacent, not fixed] jsforce core 50/51 on enterprise** - see Finding 1; classified rather than fixed.

## Build note

`pnpm build` failed in packages/cli (`main.ts(272,23)` TS2345) from plan 14-04's in-progress edit, not my files; per instructions I did not touch it. The runs used the dist already on disk (packages/cli/dist predates 14-04's edit), which is sufficient for check/up behavior exercised here but is not a fresh build of HEAD.

## Reset commands (not run; destructive, Johan's call)

```sh
for s in p14_ent p14_ent_cmdt p14_ent2 p14_ent2_cmdt p14_acme p14_acme_cmdt; do
  node packages/cli/dist/index.js reset --org-schema $s --drop-prefixes
done
```
(`p14_poly_ent` and `p14_poly_acme` from 14-06 also remain.)

## Known Stubs

None.

## Self-Check: PASSED

## Deviation after completion

Johan chose option (c) for the jsforce asterisk failure. `conformance/jsforce/run.sh` now reads an optional `FIXTURE` env var and, only when `FIXTURE=enterprise`, appends `with asterisk and return records` to `CORE_FILTER`; `conformance/run-all.sh` passes `FIXTURE` to the jsforce leg. Classified in `conformance/jsforce/README.md` as an orglet gap (formula field through a parent relationship in SOQL, `UNSUPPORTED:soql-formula`, enterprise fixture only). Acme is unchanged. Verified: `PROJECT=examples/enterprise conformance/run-all.sh` exits 0 with jsforce core 50 passed / 0 failed / 61 skipped and Bulk 2.0 12 / 0 / 5; the default acme run exits 0 with 51 / 0 / 60 and 12 / 0 / 5. The SOQL feature itself is tracked in the backlog.
