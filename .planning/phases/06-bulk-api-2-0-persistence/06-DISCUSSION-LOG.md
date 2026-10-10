# Phase 6: Bulk API 2.0 Persistence - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-10-10
**Phase:** 06-bulk-api-2-0-persistence
**Areas discussed:** Reset and org scoping, Crash and InProgress, Retention purge, Query jobs and SOQL rules

---

## Area selection

| Option | Description | Selected |
|--------|-------------|----------|
| Reset och org-scoping | Does `orglet reset` delete the org's bulk jobs or do they survive like key prefixes? | ✓ |
| Krasch och InProgress | When is InProgress persisted, what does a reconciled Failed job look like, what does unprocessedrecords return? | ✓ |
| Retention-purge | 7 days from what, when does the purge run, can it be disabled locally? | ✓ |
| Query-jobb och SOQL-regler | POST response state, 400 vs Failed job for unsupported SOQL, where the rule set lives | ✓ |

**Todos reviewed:** three matches (OwnerId baseline, ROADMAP phase 7 wording, sigha colon syntax); user chose "Ingen" — none folded.

---

## Reset and org scoping

| Option | Description | Selected |
|--------|-------------|----------|
| Raderas alltid (rekommenderat) | `reset` deletes the org's bulk rows without a flag; jobs are data referencing dropped records | ✓ |
| Överlever som prefixes | Rows survive reset, consistent with phase 2 D-07 but leave CSVs referencing deleted Ids | |
| Egen flagga | Keep by default, delete with `reset --drop-bulk-jobs` | |

**User's choice:** Raderas alltid.

| Option | Description | Selected |
|--------|-------------|----------|
| Per org + skapande user (rekommenderat) | Row stores org_schema and creating user; findJob and list semantics unchanged | ✓ |
| Per org, alla users | Every user in the org sees and controls every job | |

**User's choice:** Per org + skapande user.
**Notes:** Continuation check → "Nästa område"; table-creation placement and row structure left to Claude within the research frame.

---

## Crash and InProgress

| Option | Description | Selected |
|--------|-------------|----------|
| Synkront svar, InProgress persisteras före (rekommenderat) | Persist UploadComplete → InProgress → terminal; PATCH responds with the terminal state as today | ✓ |
| Svara UploadComplete, bearbeta efter svaret | Respond immediately, process in-process after the reply, client polls | |

**User's choice:** Synkront svar, InProgress persisteras före.

| Option | Description | Selected |
|--------|-------------|----------|
| Per chunk (rekommenderat) | Persist success/failed rows and counters after every 200-row chunk; unprocessedrecords = input minus (success + failed) | ✓ |
| En gång vid slutet | Render and store results once at completion; a crashed job has no results | |

**User's choice:** Per chunk.

| Option | Description | Selected |
|--------|-------------|----------|
| Claude formulerar (rekommenderat) | Salesforce-style message about the restart, pointing at the result endpoints; wording locked in the plan | ✓ |
| Jag vill ange lydelsen | User supplies the text | |

**User's choice:** Claude formulerar.
**Notes:** Continuation check → "Nästa område"; abort rules, unprocessedrecords for Aborted (all input rows) and the reconcile step's place in `up()` left to Claude.

---

## Retention purge

| Option | Description | Selected |
|--------|-------------|----------|
| Research avgör, fallback createdDate (rekommenderat) | Researcher reads the Bulk API 2.0 guide; createdDate if not unambiguous | ✓ |
| Alltid createdDate | Lock to creation time regardless of docs | |
| Alltid sluttillståndet | Count from terminal state; needs completed_at and an extra rule for open jobs | |

**User's choice:** Research avgör, fallback createdDate.

| Option | Description | Selected |
|--------|-------------|----------|
| Boot + varje bulk-request (rekommenderat) | One DELETE at `up()` and in a shared pre-handler for /jobs/*; no timers | ✓ |
| Bara vid boot | Simplest; old jobs stay fetchable until restart | |
| Boot + timer | setInterval cleared on close | |

**User's choice:** Boot + varje bulk-request.

| Option | Description | Selected |
|--------|-------------|----------|
| Nej, hårdkodat 7 dagar (rekommenderat) | No override; tests backdate rows or inject a clock | ✓ |
| Env-variabel | ORGLET_BULK_RETENTION_DAYS, 0 = keep forever | |

**User's choice:** Nej, hårdkodat 7 dagar.
**Notes:** Continuation check → "Nästa område"; open jobs purged under the same rule, boot logging of purged counts left to Claude.

---

## Query jobs and SOQL rules

| Option | Description | Selected |
|--------|-------------|----------|
| Som ingest: alla tillstånd persisteras, svaret visar slutet (rekommenderat) | UploadComplete → InProgress → terminal persisted; POST responds with the terminal state | ✓ |
| POST svarar UploadComplete, kör efter svaret | Client polls | |

**User's choice:** Som ingest.

| Option | Description | Selected |
|--------|-------------|----------|
| Research avgör form; fallback 400 vid POST (rekommenderat) | Researcher settles 400-at-POST vs Failed job plus the documented error; fallback keeps today's 400 | ✓ |
| Alltid 400 vid POST | Lock the form now | |
| Alltid Failed-jobb | Create the job and fail it with errorMessage | |

**User's choice:** Research avgör form; fallback 400 vid POST.

| Option | Description | Selected |
|--------|-------------|----------|
| AST-baserad check i packages/api/src/bulk (rekommenderat) | Parse with soql-parser-js, reject via AST, REST compiler untouched, regex replaced | ✓ |
| Profil i @orglet/soql | A "bulk" profile inside the compiler | |

**User's choice:** AST-baserad check i packages/api/src/bulk.
**Notes:** Final check → "Redo för context".

---

## Claude's Discretion

- Table layout and column types; CSV as one text column; query results as jsonb header/rows.
- Allowed Aborted transitions; DELETE on query jobs.
- Boot log lines; restart-test mechanics (two server instances over one pool).
- Placement of the TOAST-ceiling and permissive-auth documentation notes.
- Reconciliation errorMessage wording.

## Deferred Ideas

- Async Bulk processing, PK chunking, parallel results, platform events (out of milestone scope).
- Bulk API v1.
- Conformance README updates and un-excluding jsforce `bulk2.test.ts` (Phase 7).
- Streaming large CSV payloads (documented limit only).
