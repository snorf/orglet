# v1.0 baseline snapshot (test fixture)

Verbatim copy of `packages/metadata/standard/objects/*.json` (35 files) and `standardValueSets.json`
as shipped in orglet v1.0, commit `1b737c12d8d10408fe5713a37d4d92557209f229`
("chore: complete v1.0 milestone"), extracted with:

    git archive 1b737c12d8d10408fe5713a37d4d92557209f229 packages/metadata/standard/objects packages/metadata/standard/standardValueSets.json | tar -x

Used by `packages/engine/src/upgrade.test.ts` (MIGR-01) to build a database the way v1.0 did and upgrade it
with the current baseline. The snapshot is hermetic: it works in a shallow CI checkout and cannot drift when
the live baseline changes.

**Never edit these files.** A baseline change goes into `packages/metadata/standard/`; its effect on an existing
v1.0 database is asserted by extending `EXPECTED_WARNINGS` in the upgrade test.
