# v1.1 baseline snapshot (test fixture)

Verbatim copy of `packages/metadata/standard/objects/*.json` (53 files) and `standardValueSets.json`
as shipped in orglet v1.1 (tag `v1.1`, commit `281831bfd5be9343410f61638dd5b16a61919052`), extracted with:

    git archive v1.1 packages/metadata/standard/objects packages/metadata/standard/standardValueSets.json | tar -x

Used by `packages/engine/src/upgrade-v11.test.ts` (Phase 15 D-02) to build a database the way v1.1 did, including
ContentVersion rows without a ContentDocumentId, and upgrade it with the current baseline. Hermetic: it cannot
drift when the live baseline changes.

**Never edit these files.**
