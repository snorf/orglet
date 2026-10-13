# Vendored: sigha

Source: https://github.com/rfaulhaber/sigha (MIT, see LICENSE and NOTICE)
Revision: 2abe5dbb3ca0ab17b7aa1443024562041336ca5f
Synced: 2026-09-25

Contents: the dependency-free engine layers `syntax/`, `registry/`, `analysis/`,
`engine/`, `i18n/` and the golden corpus. Nothing here is edited by hand; run
`scripts/sync-sigha.sh <rev>` to update. Behaviour changes belong upstream.

## Pending upstream changes

Changes orglet needs from sigha are proposed upstream, never patched into `src/` (D-18, D-19).
`scripts/sync-sigha.sh` carries this section over on every sync.

| Change | Branch | Pull request | Status |
|--------|--------|--------------|--------|
| Unary `!` as logical NOT (`!ISBLANK(x)`) | `snorf/sigha:feat/unary-bang` | not opened yet | pushed to fork, PR not opened yet |
| `Relationship:Object.Field` colon syntax (`Owner:User.Email`) | `snorf/sigha:feat/polymorphic-colon-ref` | not opened yet | pushed to fork, PR not opened yet |

Compare URLs (PRs to be opened by Johan):

- https://github.com/rfaulhaber/sigha/compare/main...snorf:sigha:feat/unary-bang
- https://github.com/rfaulhaber/sigha/compare/main...snorf:sigha:feat/polymorphic-colon-ref
