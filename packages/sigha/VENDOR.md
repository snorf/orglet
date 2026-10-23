# Vendored: sigha

Source: https://github.com/rfaulhaber/sigha (MIT, see LICENSE and NOTICE)
Repository: https://github.com/snorf/sigha.git
Revision: ff6c108786e086168c4e70797d23162fbab7e614
Synced: 2026-10-23

Contents: the dependency-free engine layers `syntax/`, `registry/`, `analysis/`,
`engine/`, `i18n/` and the golden corpus. Nothing here is edited by hand; run
`scripts/sync-sigha.sh <rev>` to update. Behaviour changes belong upstream.

## Pending upstream changes

Changes orglet needs from sigha are proposed upstream, never patched into `src/` (D-18, D-19).
`scripts/sync-sigha.sh` carries this section over on every sync.

The pinned revision above is the merge commit of both branches on `snorf/sigha:integration/phase-12` (D-01). Do not delete or force-push that branch while it is the pin.

| Change | Branch | Pull request | Status |
|--------|--------|--------------|--------|
| Unary `!` as logical NOT (`!ISBLANK(x)`) | `snorf/sigha:feat/unary-bang` | not opened yet | merged into integration/phase-12 (pinned); upstream PR not opened yet |
| `Relationship:Object.Field` colon syntax (`Owner:User.Email`) | `snorf/sigha:feat/polymorphic-colon-ref` | not opened yet | merged into integration/phase-12 (pinned); upstream PR not opened yet |

Compare URLs (PRs to be opened by Johan):

- https://github.com/rfaulhaber/sigha/compare/main...snorf:sigha:feat/unary-bang
- https://github.com/rfaulhaber/sigha/compare/main...snorf:sigha:feat/polymorphic-colon-ref

Re-pin follow-up (D-02, separate /gsd:quick task): once both PRs are merged into rfaulhaber/sigha main, run `SIGHA_REPO=https://github.com/rfaulhaber/sigha.git scripts/sync-sigha.sh <upstream main SHA containing both>`, confirm only `Revision:`/`Repository:`/`Synced:` change and the src/corpus diff is empty or explained, update the table above to the PR URLs and status merged, and keep the corpus baseline at or above the numbers below.

## Corpus baseline

Measured with `pnpm vitest run packages/sigha`, before (pin 2abe5dbb) and after (pin ff6c108, `integration/phase-12`) the resync; the tallies are identical:

- `corpus/salesforce-v2.json`: `pass 6312 · fail 0 · quarantine 1394 · unsupported 1982 · org-overruled 42 · total 9730`
- `corpus/org-verified.json`: `pass 664 · fail 0 · quarantine 0 · unsupported 6 · total 670` (not locked, D-04)

pass = rows where `runRow(row).status === "pass"`; quarantine, unsupported and org-overruled rows count as neither pass nor fail.

Locked by `packages/sigha/test/corpus-baseline.test.ts`: salesforce-v2.json >= 6312 pass of >= 9730 rows. This replaces the earlier undocumented 6 312 figure with a measurement.
