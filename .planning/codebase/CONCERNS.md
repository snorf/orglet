# Codebase Concerns

**Analysis Date:** 2026-11-03

## Tech Debt

**Upstream sigha PRs deferred:**
- Issue: Two feature branches on the fork (snorf/sigha) are not opened upstream as pull requests; orglet pins to the integration branch (`integration/phase-12` merge commit ff6c108) rather than upstream main
- Files: `packages/sigha/VENDOR.md` (tracks pending upstream changes), `packages/sigha/src/` (vendored code), `scripts/sync-sigha.sh` (vendor sync script)
- Branches: `snorf/sigha:feat/unary-bang` (unary `!` operator), `snorf/sigha:feat/polymorphic-colon-ref` (relationship:object.field syntax)
- Impact: orglet cannot upgrade sigha until both PRs are merged upstream and integrated; re-pinning is a documented quick task (VENDOR.md D-02) once upstream accepts the changes
- Fix approach: Open both PRs against rfaulhaber/sigha main, await merge, then re-run `scripts/sync-sigha.sh` to pin to upstream main

**Test file type-checking outside CI gate:**
- Issue: `pnpm exec tsc -p tsconfig.test.json --noEmit` reports 36 errors as of 2026-11-03 (audit recorded 41): 19 are in vendored `packages/sigha/src/engine/{builtins,conformance}.ts` pulled in by `tsconfig.test.json`, 17 in real test files (`packages/metadata/src/diagnostics.test.ts` 9, `packages/schema/src/prefixes.test.ts` 3, one each in `migrate.test.ts`, `ddl.test.ts`, `baseline-generator.test.ts`, `null-prefix.test.ts`); `pnpm lint` and `pnpm typecheck:scripts` are CI gates but `typecheck:tests` is not (per v1.1-MILESTONE-AUDIT.md)
- Files: Test files across all packages (prefixed `*.test.ts`), `tsconfig.test.json` (non-composite config used only for test type-checking)
- Impact: Type errors in tests may not be caught until manual runs; errors were pre-existing and deferred (Phase 9 decision)
- Fix approach: Exclude or type the vendored sigha files in `tsconfig.test.json`, clear the 17 test-file errors, then add a `typecheck:tests` script to the CI gate (`pnpm lint`)

**Bookkeeping drift post-v1.1:**
- Issue: `.planning/STATE.md` and `.planning/ROADMAP.md` still carry Phase 14's counters under Phase 999.1; backlog items 999.1-999.7 were promoted into v1.1 and shipped but still listed in the Backlog section
- Files: `.planning/STATE.md` (lines 10-14 progress section), `.planning/ROADMAP.md` (lines 42-113, backlog section)
- Impact: Planning commands may read stale state; not a functional defect but creates confusion for next-milestone planning
- Fix approach: (Already on the v1.1 archive commit) Move delivered items out of the Backlog section, reset STATE.md phase pointer to none, and set percent to 0

**Documentation not refreshed after execution:**
- Issue: Phase 11 VALIDATION.md marked status draft with all Per-Task Verification Map rows still pending, even though the planned test files exist and 11-VERIFICATION.md passed 5/5
- Files: `.planning/milestones/v1.1-ROADMAP.md` (Phase 11 section), `.planning/phases/11-custom-metadata-custom-settings-labels/11-VALIDATION.md`
- Impact: Audit tool (nyquist_compliant) reports Phase 11 as partial; documentation does not match actual test completion
- Fix approach: Run `/gsd:validate-phase 11` to refresh the VALIDATION.md map (discovery-only command)

**Verification status not updated:**
- Issue: Phase 8 VERIFICATION.md still reports status `human_needed` although 08-HUMAN-UAT.md shows two of three human items passed (sigha-sync-check green in CI, upgrade.test.ts 3/3 on Postgres 16); the third is the deferred upstream PR item above
- Files: `.planning/phases/08-upgrade-safety-net-nullable-key-prefixes/08-VERIFICATION.md`
- Impact: Phase 8 VERIFICATION.md status misleads readers; audits currently treat it as passed with tech debt noted
- Fix approach: Update status to passed after both upstream sigha PRs are merged

## Known Bugs & Issues

**pglite premature ReadyForQuery desync (electric-sql/pglite#958):**
- Symptoms: Tests occasionally fail with `Received unexpected parseComplete message from backend` after unique-key violations; affects both pglite and acme/enterprise runs but intermittent (about 2 runs in 3)
- Files: `test/db.ts` (contains workaround filter), affected tests: any that trigger duplicate-value errors
- Trigger: Insert a duplicate into a unique-constraint column on pglite-backed database
- Workaround: `test/db.ts` filters premature ReadyForQuery messages per connection (commit 13bc0c2, documented with upstream issue number)
- Fix approach: Upstream fix is pglite PR #1144 (not yet merged); re-test when pglite > 0.5.10 ships (current pin is exactly 0.5.8)

**Conformance CI job not a required status check:**
- Issue: The `conformance` job in `.github/workflows/ci.yml` runs on every push and PR but is not a required status check on `main` (inherited from v1.0 D-14)
- Files: `.github/workflows/ci.yml` (conformance job definition), `conformance/run-all.sh` (conformance harness)
- Impact: Conformance regressions can merge undetected; the job validates jsforce/simple-salesforce and real enterprise fixture against orglet
- Current status: Conformance runs both acme and enterprise fixtures in a matrix; README acknowledges this needs "maintainer's explicit decision" to become required
- Fix approach: Add `conformance` to required status checks in GitHub branch rules (Johan's call on timing)

## Performance Bottlenecks

**Roll-up recompute is O(children of affected parents) with no cap:**
- Problem: Formula roll-up recompute loads *all live child rows into memory* for the affected parent ids (Phase 13 D-15), then evaluates formulas in TypeScript before aggregating
- Files: `packages/engine/src/rollups.ts` (lines 639-660, `computeRollups` method), `packages/engine/src/engine.ts` (line 639, comment on cost), `packages/formula/src/index.ts` exports
- Cause: Formula fields must be evaluated in TS with Salesforce semantics (not SQL); child rows are joined via derived table in SQL but fetched en masse
- Current capacity: One-time backfill in `orglet up` before listening; no per-transaction limit enforced
- Improvement path: Cap the batch size per recompute (e.g. 1000 children at a time) and re-do multiple passes if needed; or pre-aggregate formula fields during schema design to detect expensive cases

**Roll-up admission stricter than Salesforce minimum:**
- Issue: Evaluation-time globals (NOW, TODAY, TIMENOW) are rejected in roll-up formulas even though Salesforce allows them with per-run recompute (Phase 13 D-01)
- Files: `packages/formula/src/rollup-admission.ts`, `packages/formula/src/rollup-admission.test.ts`
- Impact: Some valid roll-ups cannot be admitted; workaround is to move time-dependent logic to validation rules or Apex
- Fix approach: Document the restriction or open a future phase to recompute these roll-ups more frequently than static fields

## Fragile Areas

**In-memory session token storage (SessionStore.tokens map):**
- Files: `packages/api/src/auth.ts` (line 25, private tokens map)
- Why fragile: Tokens are stored in memory with no timeout or eviction; a long-running server can accumulate millions of LoginResult objects if tokens are issued faster than they expire
- Safe modification: Add token TTL with a background cleanup task (e.g., every hour drop tokens older than 24 hours); or use a WeakMap keyed by session if GC pressure allows
- Test coverage: `packages/api/src/auth.ts` has no tests; SessionStore is tested only through API routes

**ApiContext.locators map for live query pagination:**
- Files: `packages/api/src/server.ts` (line 39, unsupported: Set<string> and locators: Map<string>), `packages/api/src/routes/query.ts` (assumed, not read in this sweep)
- Why fragile: Locators are keyed by query ID and hold `{ q, all, created }` with creation timestamp but no expiry; if a client never calls `nextRecordsUrl` to completion, locators accumulate forever
- Safe modification: Add a background task to expire locators older than 6 hours; or set an explicit limit (e.g., max 10,000 locators per instance) and evict LRU
- Test coverage: Pagination is tested in conformance runs; explicit locator cleanup is not

**ApiContext.unsupported Set for warning deduplication:**
- Files: `packages/api/src/server.ts` (line 37), populated in `packages/api/src/routes/*.ts` (bulk.ts, composite.ts, misc.ts)
- Why fragile: The set grows monotonically and is never cleared; a production instance running for months will retain every unique `UNSUPPORTED:*` message ever logged
- Safe modification: Clear the set on server restart (already done implicitly), or cap it at a fixed size (e.g., 100 areas) and evict oldest on overflow
- Test coverage: Warnings are tested at the CLI level; API-level unsupported tracking is not explicitly tested

## Scaling Limits

**Formula roll-up backfill reads all children into memory:**
- Current capacity: No measured limit; one real-org test fixture passed (enterprise 63 objects) but load test not run
- Limit: A parent with 100,000 children and 10 formula roll-ups would load 100,000 rows × 10 fields × formula-evaluation cost into memory before any aggregation
- Scaling path: Batch recompute by chunks (see Performance section above), or pre-check child count and warn/fail if > threshold

**SOQL query result set pagination (nextRecordsUrl):**
- Current capacity: One `locator` entry per live query; no hard limit measured
- Limit: Unbounded accumulation in the locators map (see Fragile Areas above)
- Scaling path: Add TTL-based eviction (see in-memory state fixes above)

**Session token accumulation:**
- Current capacity: Unbounded in memory
- Limit: Memory exhaustion if millions of tokens issued and never cleaned
- Scaling path: Add TTL + cleanup task (see Fragile Areas above)

## Security Considerations

**Permissive authentication by default:**
- Risk: Auth mode is `permissive` (accept any username/password) unless explicitly configured; any client can log in as any user
- Files: `packages/api/src/auth.ts` (line 34, AuthConfig.mode default), `packages/api/src/server.ts` (line 91, SessionStore instantiation with default)
- Current mitigation: Documented as dev-only; production deployments must explicitly set `auth: { mode: "list", users: [...] }` at startup
- Recommendations: (a) Fail CI if default-auth is used in production (require explicit config), (b) Log a warning on server start if permissive mode is active, (c) Consider changing default to `"list"` if no users are configured (but blocking note that startup would fail)

**Bearer tokens used as both access and refresh tokens:**
- Risk: Same token serves both `access_token` and `refresh_token` in OAuth responses; if either is compromised the other is too
- Files: `packages/api/src/routes/login.ts` (lines 68-69, both set to `login.token`)
- Current mitigation: Tokens are session IDs (opaque); rotating refresh_token does issue a new access_token but the old one remains valid until the session expires
- Recommendations: Issue distinct access and refresh tokens with different TTLs; refresh_token should only be usable for the `/services/oauth2/token` endpoint with grant `refresh_token`

**No explicit session timeout:**
- Risk: Sessions live indefinitely once created (no timeout mechanism visible)
- Files: `packages/api/src/auth.ts` (SessionStore.resolve does not check age)
- Current mitigation: Server restart clears all sessions; individual sessions can be revoked only by outside action (e.g., deleting the User record)
- Recommendations: Add session age check in `resolve()` or a background eviction task (see Fragile Areas above); document session lifecycle

**Permissive query parser with limited input validation:**
- Risk: SOQL compiler accepts syntax but does not pre-validate against schema until late in the pipeline
- Files: `packages/soql/src/compile.ts` uses `@jetstreamapp/soql-parser-js` (third-party parser)
- Current mitigation: All errors are caught and returned as `UNSUPPORTED:*` or `INVALID_FIELD` to the client; no bare exceptions leak
- Recommendations: (None urgent; error handling is well-designed)

## Unsupported Features (By Design)

These areas are intentionally not implemented and marked with `UNSUPPORTED:` messages:

**Formula field access through parent relationships (UNSUPPORTED:soql-formula):**
- Areas: Selecting formula fields via parent relationship (e.g., `SELECT Parent__r.Formula__c`), formula fields in WHERE/ORDER BY/GROUP BY, formula fields in child subqueries
- Files: `packages/soql/src/compile.ts` (lines 240, 345, 543)
- Backlog: 999.12 (Formula fields through parent relationships in SOQL)
- Status: Excluded enterprise-only in conformance/jsforce until implemented

**Formula globals (UNSUPPORTED:formula-global):**
- Areas: `$Permission` (requires custom permissions/permission sets), `$Setup` on List custom settings (accessible only from Apex), unknown global objects
- Files: `packages/formula/src/compile.ts` (lines 278, 290, 301)
- Status: `$Permission` deferred to security milestone; `$Setup` on List correctly rejected per Salesforce rules

**Platform events (UNSUPPORTED:object-kind):**
- Areas: Objects with `__e` suffix (publish-only objects)
- Files: Metadata parser rejects them; conformance README lists 11 in a large real-org retrieve
- Backlog: 999.8 (Platform events as publish-only objects)

**SOSL search (UNSUPPORTED:sosl):**
- Area: SOSL (Salesforce Object Search Language) is not implemented; returns empty results with a warning
- Files: `packages/api/src/routes/misc.ts` (line 71)
- Status: Search is not a Phase 1 priority; backlog not yet assigned

**Bulk API 2.0 relationship columns (UNSUPPORTED:bulk-relationship-column):**
- Area: Bulk API requests with relationship columns (e.g., Account.Name instead of AccountId) are rejected
- Files: `packages/api/src/routes/bulk.ts` (line 153)
- Current behavior: Returns INVALID_FIELD error per record

**Composite API allOrNone without full rollback (UNSUPPORTED:composite-rollback):**
- Area: `/composite` with `allOrNone: true` does not roll back earlier subrequests if a later one fails
- Files: `packages/api/src/routes/composite.ts` (line 182)
- Behavior: Warning logged, operation proceeds but is not atomic

**Schema narrowing and dropping (UNSUPPORTED:schema-drop, schema-narrow, schema-fk):**
- Areas: Dropping columns, narrowing varchar length, etc. with existing data
- Files: `packages/schema/src/migrate.ts` (lines 5-6)
- Current behavior: Migrations skip these operations and log warnings; data is preserved

## Missing Critical Features

**ContentVersion file upload (stopgap in place until backlog 999.10):**
- What's missing: File data is not stored; ContentDocumentId is nullable as an override (should be required)
- Files: Baseline definition for ContentVersion (generated from standard metadata)
- Blocks: File attachment workflows, ContentVersion VersionData download endpoint
- Backlog: 999.10 (ContentVersion file upload done properly)

**Archive mode (backlog 999.11):**
- What's missing: orglet as read-only replica from a Heimdall backup store instead of live data
- Blocks: Snapshot/read-only orgs, GDPR-safe archive deployments without copying data
- Notes: Requires file upload (999.10) for complete implementation

## Test Coverage Gaps

**SessionStore and AuthConfig not unit tested:**
- What's not tested: Password comparison logic, token generation, session resolution, permissive vs. list auth modes, client_credentials grant
- Files: `packages/api/src/auth.ts`
- Risk: Auth logic changes may not be caught until integration test
- Priority: Medium (auth is critical but tested via API routes)

**Query locator pagination (nextRecordsUrl) cleanup:**
- What's not tested: Locator TTL expiration, memory cleanup, overflow eviction
- Files: `packages/api/src/server.ts` (locators map initialization)
- Risk: Memory leak if pagination is used extensively
- Priority: Medium (pagination works in conformance but cleanup is not validated)

**Unsupported warnings deduplication in API:**
- What's not tested: Set growth over time, clearing, overflow behavior
- Files: `packages/api/src/server.ts` (unsupported set)
- Risk: Low (set is small and only lives per-request context in logging)
- Priority: Low

---

*Concerns audit: 2026-11-03*
