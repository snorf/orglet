# Phase 1: Test Infrastructure & CI - Research (Part A: pglite + vitest)

**Researched:** 2026-09-30
**Domain:** Embedded Postgres for tests (`@electric-sql/pglite` 0.5.8 + `@electric-sql/pglite-socket` 0.2.11), vitest 3.2.7 worker/globalSetup model
**Confidence:** HIGH (all claims below are empirically verified by running real code against the pinned versions, not read from documentation)
**Method note:** Per the research brief, this file is built almost entirely from installing the pinned packages in a scratchpad and running probes, not from web docs. Web access was not used at all (0 of the allotted 3 fetches) — everything needed was answered by reading `.d.ts` files, minified source, and running Node/vitest directly.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (relevant excerpt — see 01-CONTEXT.md for the full set including D-01..D-08, D-14..D-18 which are GitHub/CI scope, covered in Part B)

**Test backend selection**
- **D-09:** Env-var auto-detect. If `ORGLET_DATABASE_URL` is set, tests run against that
  Postgres. If it is not set, the test bootstrap starts pglite and points the pool at it.
- **D-10:** The current default of `postgres://orglet:orglet@localhost:5433/orglet` in
  `databaseUrlFromEnv()` moves to the server path (`orglet up`, CLI) and no longer applies
  to tests. Tests never silently reach for a Docker Postgres.
- **D-11:** CI's Postgres job selects the real backend simply by setting
  `ORGLET_DATABASE_URL` to the service container; no other switch.
- **D-12:** pglite runs in memory. Every test run starts empty. The existing
  one-random-schema-per-file pattern (`test_<hex>`) is kept as is to keep the diff to the
  five DB-backed test files minimal.
- **D-13:** `README.md` Development section is rewritten so Docker is optional: Node 22 and
  pnpm are required; Docker is needed only to run the server (`orglet up`) or to test against
  real Postgres.

**Import-mode fallback (session_replication_role on pglite)**
- **D-19:** A dedicated early test exercises `SET LOCAL session_replication_role = replica`
  and the `information_schema` queries `migrate.ts` relies on, against pglite. Its outcome
  (pass or fail, with date) is recorded in `.planning/codebase/TESTING.md`.
- **D-20:** If it fails on pglite, the affected import-mode tests are tagged to run only on
  real Postgres. The mechanism is a runtime skip with a reason string (the test file still
  runs, calls skip when the backend is pglite, and the reason appears in the report). No
  separate file glob. Production code is not changed to work around pglite.
- **D-21:** The pglite-vs-Postgres detection used for the skip is the same signal as D-09
  (`ORGLET_DATABASE_URL` set or not), exposed through one small test helper, not re-derived
  per file.

### Claude's Discretion
- Whether pglite runs as one shared instance via vitest `globalSetup` or one instance per
  test file. Research disagrees (STACK.md: per file, because vitest runs files in parallel
  workers and pglite is single-connection; ARCHITECTURE.md: shared via globalSetup). Decide
  by what actually works with vitest's worker model; prefer per file if a shared instance
  serialises or flakes.
- Exact shape and location of the test bootstrap helper (research suggests a ~20-line local
  helper over any third-party wrapper such as `pglite-pool`).
- Action pinning style (major tag vs SHA), workflow file name, job names, pnpm cache setup.
- Exact wording of the README Development section and badge placement.

### Deferred Ideas (OUT OF SCOPE)
- Conformance suites (jsforce, simple-salesforce) as a CI job or `workflow_dispatch` —
  phase 7 or later.
- Node 24 in the CI matrix — revisit when Node 24 becomes the active LTS and `engines` is
  widened.
- Concurrency tests that need multiple real Postgres connections — pglite is
  single-connection; such tests would be Postgres-only via the same skip mechanism (D-20).
</user_constraints>

<phase_requirements>
## Phase Requirements (this file's scope: INFRA-01, INFRA-02, INFRA-03)

| ID | Description | Research Support |
|----|-------------|------------------|
| INFRA-01 | `pnpm test` runs the full suite on a machine without Docker; Postgres-backed tests run against embedded pglite reached through the existing `pg` pool over the pglite socket server | Probe results below prove the `pg.Pool` -> `pglite-socket` -> `PGlite` path works unmodified for every SQL feature the codebase's test files exercise (schema/table/sequence DDL, `information_schema`, `ALTER TABLE`, `SAVEPOINT`, `ILIKE`, FK constraints). Recommendation section gives the concrete per-file bootstrap mechanism. |
| INFRA-02 | `session_replication_role` and `information_schema` schema diffing are verified to work on pinned pglite, or affected tests are tagged Postgres-only with a recorded reason | Probe steps d, e1, e2 directly answer this: **it works**, no skip/tag is needed. vitest facts section documents the exact `skip(condition, reason)` / `skipIf` mechanism to use if a *future* pglite upgrade regresses this, satisfying D-20's required mechanism even though it isn't invoked today. |
| INFRA-03 | `orglet up` / Docker Compose keep using real Postgres; no production code path depends on pglite | Default-URL relocation table below lists every site touching `databaseUrlFromEnv()`/`5433` and the exact split between "server path keeps the 5433 default" and "test path stops defaulting" (D-10). |
</phase_requirements>

## Summary

`@electric-sql/pglite@0.5.8` + `@electric-sql/pglite-socket@0.2.11`, installed and driven with
the project's own `pg@8.23.0` client exactly as `packages/schema/src/db.ts` does today, pass
**every** SQL-level probe relevant to this codebase: schema/table/sequence DDL,
`information_schema.columns`/`information_schema.tables`, `SET LOCAL
session_replication_role = replica` (both the setting and the FK-bypass effect it produces),
FK enforcement when *not* in replica mode, `SAVEPOINT`/`ROLLBACK TO SAVEPOINT`, `ALTER TABLE
ADD/ALTER COLUMN`, and `ILIKE`. **INFRA-02's open question is answered: `session_replication_role`
and `information_schema` both work on pinned pglite 0.5.8. No Postgres-only tagging is needed.**

The one real limitation is concurrency, and it was reproduced directly: pglite-socket
multiplexes all connections through **one global, FIFO query queue** inside a single WASM
PGlite instance. Two `pool.connect()` clients can each open a transaction, but if client B
tries to run a query (even `BEGIN`) while client A's transaction is still open, client B's
query **blocks (queues) until client A commits or rolls back** — it does not error, and it
is not framework-detected as a deadlock. If the calling code's own sequencing creates a wait
cycle (as a naive "both open, then both commit" script does), the process hangs forever with
no error and no timeout from pglite-socket itself. A non-interleaved version of the identical
two-client pattern (client fully commits before the next client begins) completes normally.
This directly triggers the Claude's Discretion tie-breaker ("prefer per file if a shared
instance serialises or flakes") — a shared pglite instance measurably serialises concurrent
transactions from different vitest workers, and the existing codebase already opens one
`pg.Pool` per test file with no cross-file coordination, which is precisely the shape that
would trip this. This file also confirms empirically (not from docs) that a `globalSetup`
module runs to completion — including any `process.env` mutation — in the main Vitest
process **before** any `pool: "forks"` (the vitest 3.x default) worker process is spawned, so
env vars set there do reach worker test files; and that vitest's `skip(condition, reason)` /
`it.skipIf(condition)` / `describe.skipIf(condition)` all report as **skipped**, never green,
with the reason string visible in the run report — the exact mechanism D-20 requires.

**Primary recommendation:** give each of the five DB-backed test files its own pglite instance
and its own `PGLiteSocketServer` (bound to `port: 0`) inside that file's own `beforeAll`, torn
down in `afterAll` — not a single instance shared via `globalSetup`. This keeps the existing
per-file `test_<hex>` schema pattern (D-12) as pure defense-in-depth rather than the only
isolation mechanism, avoids the proven serialization/hang risk of a shared instance under
vitest's default parallel-file/forked-worker execution, and needs no `provide()`/`inject()`
plumbing across the globalSetup/worker process boundary at all.

## pglite-socket API (verified from `.d.ts` + source, not README paraphrase)

Installed and read directly: `node_modules/@electric-sql/pglite-socket/dist/index.d.ts` (the
type declarations) and the bundled `dist/index.js` (via `PGLiteSocketServer.prototype.start.toString()`
in a Node REPL, since the dist file is a single minified line and `grep` context doesn't work
on it).

**Exact import:**
```ts
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
```

**`PGLiteSocketServerOptions` (constructor options, from the `.d.ts`):**
| Option | Type | Default | Notes |
|---|---|---|---|
| `db` | `PGlite` | required | the instance to expose |
| `port` | `number` | `5432` | **`0` lets the OS assign a free port** — required for parallel test files so they don't collide on a fixed port |
| `host` | `string` | `127.0.0.1` | |
| `path` | `string` | `undefined` | Unix socket, takes precedence over host:port — not needed here |
| `maxConnections` | `number` | **`1`** | "no concurrency" per the CLI help text. The codebase's test files never open two simultaneous `pool.connect()` clients (verified: `grep -rn "Promise.all" packages/` returns nothing, no `test.concurrent`/`it.concurrent` anywhere), so the default of `1` is sufficient for every test file as currently written. Raising it does not remove the serialization behavior documented below — it only changes how many *sockets* can be attached, not how many queries run concurrently (there is exactly one query queue regardless). |
| `idleTimeout` | `number` (ms) | `0` (disabled) | fine to leave at default for a test-scoped instance |

**Getting the bound port when `port: 0`:** the `.d.ts` declares `port` as `private` on the
class, so `server.port` **is a TypeScript compile error** from outside the class even though
it works at runtime (verified: reading it directly from plain `.mjs` returns the correct
number). The public, type-safe way is the `getServerConn()` method (present in the `.d.ts`
with no `private` modifier), which returns `` `${host}:${port}` `` and is guaranteed populated
by the time `start()` resolves (confirmed by reading the `start()` source: `this.port =
n.port` runs before the promise's `resolve()` call). Verified both ways return the identical,
correct port in a live run:
```
getServerConn(): 127.0.0.1:64444
server.port (runtime access): 64444
```

**Minimal, type-safe bootstrap snippet** (this is the shape recommended for the per-file test
helper — all methods/fields used here are public per the `.d.ts`):
```ts
import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";
import { createPool, type Pool } from "./db.js"; // existing seam, unchanged

async function startPglite(): Promise<{ pool: Pool; stop: () => Promise<void> }> {
  const db = await PGlite.create(); // in-memory by default (no dataDir argument)
  const server = new PGLiteSocketServer({ db, port: 0, host: "127.0.0.1" });
  await server.start();
  const [host, port] = server.getServerConn().split(":");
  const pool = createPool(`postgres://postgres:postgres@${host}:${port}/postgres`);
  return {
    pool,
    stop: async () => {
      await pool.end();
      await server.stop();
      await db.close();
    },
  };
}
```
Notes verified empirically, not assumed:
- `PGlite.create()` (static factory) returns an already-`waitReady`'d instance; no `dataDir`
  argument means in-memory (confirmed: no `CREATE EXTENSION`/persistence needed, matches D-12
  "runs in memory").
- Any username/password/database name works in the connection string — pglite-socket enforces
  no auth and no SSL (`postgres://postgres:postgres@.../postgres` connected with zero setup in
  every probe run below).
- `server.stop()` and `db.close()` are both `Promise`-returning and were called at the end of
  every probe run with no errors or dangling handles.
- **Node floor:** `PGLiteSocketServer` extends `EventTarget` and dispatches `new
  CustomEvent(...)` internally. Running the exact same code under Node 18.20.8 (accidentally,
  when a subshell lost the `nvm use 22` from a prior command) failed immediately with
  `ReferenceError: CustomEvent is not defined` — Node's global `CustomEvent` only exists from
  Node 19+. Irrelevant for this project (Node 22 pinned via `.nvmrc`/`engines`), but confirms
  pglite-socket has an undocumented implicit floor above Node 18 — worth a one-line code
  comment if anyone ever runs tests outside the pinned Node version.

## Probe results (verbatim)

Ran against pglite 0.5.8 + pglite-socket 0.2.11 + pg 8.23.0, installed fresh via `npm install`
in an isolated scratchpad (not the workspace), Node v22.23.3. Full probe script and raw output
preserved in the scratchpad for inspection if needed
(`/private/tmp/.../scratchpad/pglite-probe/probe.mjs`, `probe-concurrency.mjs`).

| # | Test | Result | Detail |
|---|------|--------|--------|
| a | `CREATE SCHEMA t1; CREATE TABLE t1.a(id char(18) primary key, n numeric(18,2), d timestamptz, s varchar(255)); CREATE SEQUENCE t1.seq;` | **PASS** | no error |
| b | `SELECT column_name, data_type, character_maximum_length FROM information_schema.columns WHERE table_schema='t1' AND table_name='a'` | **PASS** | 4 rows, exact types: `id`→`character`(18), `n`→`numeric`, `d`→`timestamp with time zone`, `s`→`character varying`(255) — matches what `migrate.ts`'s `normalizeType()` and `migrate.test.ts`'s `columns()` helper expect |
| c | `SELECT table_name FROM information_schema.tables WHERE table_schema='t1'` | **PASS** | returns `[{"table_name":"a"}]` |
| d | `BEGIN; SET LOCAL session_replication_role = replica; SHOW session_replication_role; COMMIT;` | **PASS** | `SHOW` returns `replica` inside the transaction |
| e1 | FK bypass: `t1.c.p_id` FK to `t1.p.id`; in a transaction with `SET LOCAL session_replication_role = replica`, insert a child row with a non-existent parent id | **PASS (bypass succeeds, as expected)** | insert + commit succeed with no error — this is the exact mechanism `engine.ts:215`'s import-mode relies on |
| e2 | Same insert, same tables, **without** replica role | **PASS (FK correctly enforced)** | fails with `code=23503 message=insert or update on table "c" violates foreign key constraint "c_p_id_fkey"` — real Postgres FK enforcement, not a no-op |
| f | `SAVEPOINT sp1; INSERT ...; ROLLBACK TO SAVEPOINT sp1; COMMIT;` | **PASS** | only the pre-savepoint row persists, exactly matching `engine.ts`'s per-record savepoint pattern |
| g | `ALTER TABLE t1.a ADD COLUMN x text; ALTER TABLE t1.a ALTER COLUMN s TYPE varchar(400);` | **PASS** | both columns visible with new types via `information_schema.columns` afterward |
| h | `SELECT 'Abc' ILIKE 'a%'` | **PASS** | returns `true` |
| i | Two `pool.connect()` clients, both `BEGIN`, both insert, both `COMMIT` (interleaved order, matching the brief exactly) | **HANGS INDEFINITELY — process had to be `kill -9`'d after >20s of zero CPU progress** | See "Concurrency finding" below for the instrumented re-run that pinpoints exactly where and why |

**Direct answer to INFRA-02's question: does `session_replication_role` work on pglite 0.5.8?
YES.** Both the GUC setting itself (probe d) and its actual effect — bypassing FK enforcement
for import-mode (probe e1) while still enforcing FK normally outside that mode (probe e2) —
work correctly. `information_schema.columns` and `information_schema.tables` (probes b, c),
which `migrate.ts`'s diffing logic depends on, also work correctly, including exact type/length
reporting. **No Postgres-only tagging is required for these tests under D-20; the dedicated
D-19 test should assert PASS, not document a skip.**

### Concurrency finding (probe i, instrumented re-run)

The literal brief scenario (`await c1.query("BEGIN"); await c2.query("BEGIN"); ...`, fully
sequential `await`s) hangs forever with **zero error, zero timeout, zero CPU usage** — confirmed
by `ps` showing constant CPU time across a 20s window, then manually killed. This is a true
"never resolves" hang, not a slow query.

A version instrumented with a 4s client-side timeout per step (`probe-concurrency.mjs`) shows
*why*:
```
--- Instrumented concurrency probe: two pool.connect() clients, interleaved transactions ---
both pool.connect() resolved (2 separate TCP sockets to the same PGLiteSocketServer)
  OK   c1.query('BEGIN') (0ms)
  HANG c2.query('BEGIN')  <- c1 tx still open (>4002ms, still pending, gave up)
  OK   c1.query(INSERT ...c1)  <- c2 tx still open too (6ms)
  HANG c2.query(INSERT ...c2) (>4000ms, still pending, gave up)
  OK   c1.query('COMMIT') (3ms)
  OK   c2.query('COMMIT') (7ms)   <- resolves fast, right after c1 commits

--- Control: same two-client pattern but WITHOUT interleaving (c1 fully commits before c2 begins) ---
  OK   c3.query('BEGIN') (2ms)
  OK   c3.query(INSERT ...c3) (1ms)
  OK   c3.query('COMMIT') (0ms)
  OK   c4.query('BEGIN') (1ms)
  OK   c4.query(INSERT ...c4) (0ms)
  OK   c4.query('COMMIT') (1ms)

rows present after both phases: [{"id":"concurrenttest0001"},{"id":"concurrenttest0002"},{"id":"concurrenttest0003"},{"id":"concurrenttest0004"}]
```
Interpretation, cross-checked against the bundled source (`QueryQueueManager` — the `.d.ts`'s
own doc comment says "Ensures only one query executes at a time in PGlite", and the minified
`processQueue()` logic explicitly holds the queue for `this.lastHandlerId` while
`this.db.isInTransaction()` is true): client 2's `BEGIN` isn't rejected and isn't lost — it sits
queued, unprocessed, until client 1's transaction ends (`COMMIT`/`ROLLBACK`). Once client 1
committed, client 2's queued `BEGIN`, `INSERT`, and `COMMIT` all flushed through in ~7ms. **This
is serialization, not corruption or data loss** — the control run (non-interleaved) and the
final row count (4 rows, all four inserts landed) both confirm no data was silently dropped.
But it means: **if application code (or two vitest test files sharing one instance) ever holds
a transaction open on one connection while another connection tries to start its own
transaction, the second connection blocks until the first finishes — and if the two are
waiting on each other (the literal brief scenario: both `await` a `BEGIN` before either
`COMMIT`s), the process deadlocks with no error, ever.**

This is the direct evidence for the Claude's Discretion tie-breaker: a **shared** pglite
instance introduces exactly this risk across independent vitest worker processes any time
their transaction lifetimes overlap unpredictably (which is the normal case under parallel
file execution) — "prefer per file if a shared instance serialises or flakes" is satisfied:
it serializes, and can flake into a silent hang under adversarial-but-plausible timing. A
**per-file** instance has, by construction, exactly one file's transactions ever touching it,
so this failure mode cannot occur across files.

## vitest facts (vitest 3.2.7, as installed in the repo's `node_modules`, verified via `.d.ts` + a live run, not docs)

- **`globalSetup` config shape:** `test.globalSetup?: string | string[]` — a **path to a
  module**, not an inline function in `vitest.config.ts`. The module's default export is a
  function receiving a `GlobalSetupContext` (type alias: `GlobalSetupContext = TestProject`,
  confirmed in `node.d.ts`), and may return an async teardown function.
- **`provide`/`inject`:** `TestProject.provide: <T extends keyof ProvidedContext & string>(key: T, value: ProvidedContext[T]) => void`
  is available on the context object passed into `globalSetup`; `inject<T>(key)` (exported from
  `vitest`) reads it back inside worker test files. **Verified live** (own scratch vitest
  project, vitest 3.2.7, default config): a `globalSetup` module called `provide("probeInjectValue", "hello-from-provide")`,
  and a separate test file's `inject("probeInjectValue")` returned the exact value.
- **`process.env` set in `globalSetup` DOES reach worker test files** — verified live, not
  assumed. `globalSetup` ran in pid `25508`; the worker test file ran in pid `25513` (a
  genuinely different OS process, confirming the default `pool: "forks"`); `process.env.PROBE_ENV_VALUE`
  set inside `globalSetup` (before its `return` of the teardown function) was visible as the
  correct value inside the worker's `it()` body. This works because `globalSetup` runs to
  **completion** in the main Vitest orchestrator process before any worker is forked, and
  Node's `child_process.fork()` (which is what the `forks` pool uses) inherits the parent's
  `process.env` **at fork time** — so any mutation made before that point propagates
  automatically, no `provide()`/`inject()` needed for env vars specifically. (The caveat in the
  brief — "does NOT reach separate worker processes unless set before workers spawn" — is
  exactly what's happening here: it's set before workers spawn, so it does reach them.)
- **`pool` default:** `test.pool?: Exclude<Pool, "browser">` — `@default 'forks'` (from the
  `.d.ts` doc comment, and confirmed live by the differing pids above). `BuiltinPool = "browser" | "threads" | "forks" | "vmThreads" | "vmForks" | "typescript"`.
  This project's `vitest.config.ts` sets no `pool` option, so it runs the default: separate
  child **processes** per worker, not `worker_threads`. This matters for the shared-vs-per-file
  decision: a plain module-level singleton (e.g. "create the PGlite instance once at import
  time in a shared TS module") would **not** work across files even if desired, because each
  forked worker process gets its own module registry — the only way to genuinely share one
  instance across files is a real out-of-process server (which is exactly what pglite-socket's
  TCP server is for) reachable via a connection string passed through `provide()`/`inject()` or
  env — and that's the shared-instance option this research recommends against, based on the
  concurrency finding above.
- **`skip(condition?, note?)` on the test context** — `TestContext.skip: { (note?: string): never; (condition: boolean, note?: string): void }`.
  Verified live: `it("...", ({ skip }) => { skip(true, "some reason"); throw new Error("unreachable") })`
  reports as **skipped**, with the reason string shown inline in the reporter output
  (`↓ skip.test.mjs > conditional skip with reason 1ms [some reason]`), and the thrown error
  after the `skip()` call never executes (the `skip` call throws internally to unwind the test).
  This is exactly the D-20 mechanism: "runtime skip with a reason string ... the test file
  still runs, calls skip when the backend is pglite, and the reason appears in the report."
- **`it.skipIf(condition)` / `describe.skipIf(condition)`** — both exist as chainable APIs on
  the exported `it`/`describe` (`.d.ts`: `skipIf: (condition: any) => ChainableTestAPI<...>` /
  `ChainableSuiteAPI<...>`). Verified live: both report as skipped, same as `ctx.skip()`.
- All three skip mechanisms show as `X skipped` in the final summary (`Tests 3 skipped (3)`
  in the live run) — never reported as passed/green, satisfying the "must be visible as
  skipped, never green" requirement from the Specific Ideas in CONTEXT.md.

## Recommendation: per-file pglite instance (not shared via `globalSetup`)

**Mechanism:** each of the five DB-backed test files (`migrate.test.ts`, `engine.test.ts`,
`query.test.ts`, `api.test.ts`, `bulk.test.ts`) keeps its existing `beforeAll`/`afterAll`
structure and its existing `test_<hex>` schema-per-file isolation (D-12, unchanged), but
replaces its `pool = createPool(databaseUrlFromEnv())` line with a call to a small shared test
helper (new file, exact location left to planner discretion per CONTEXT.md, e.g.
`packages/schema/src/test-db.ts` or a root `tests/` helper) implementing D-09's auto-detect:

```ts
export async function testPool(): Promise<{ pool: Pool; usingPglite: boolean; cleanup: () => Promise<void> }> {
  const url = process.env["ORGLET_DATABASE_URL"];
  if (url) {
    const pool = createPool(url);
    return { pool, usingPglite: false, cleanup: () => pool.end() };
  }
  const { pool, stop } = await startPglite(); // the bootstrap snippet above
  return { pool, usingPglite: true, cleanup: stop };
}
```
`usingPglite` (or an equivalent single boolean derived the same way, per D-21 "exposed through
one small test helper, not re-derived per file") is what the D-19/D-20 dedicated test and any
future Postgres-only test would call `skip(usingPglite, "reason")` with — though per the probe
results above, **no test needs this skip today**; the helper should exist so D-20's mechanism
is ready if a future pglite upgrade regresses `session_replication_role` or
`information_schema` behavior.

**Why per-file, not shared-via-`globalSetup`, given what was actually measured:**
1. **The concurrency probe is the deciding evidence.** A shared single pglite instance means
   all five test files' transactions funnel through one global FIFO query queue. Vitest's
   default `pool: "forks"` runs files in parallel, separate OS processes — there is no
   coordination between files about when they open/close transactions. The probe showed this
   queue does not error on overlap, it **blocks** — and blocks indefinitely if the blocking
   party is itself waiting on something that only resolves after the block clears (exactly
   what a naive shared setup risks: e.g. one file's slow `migrate()` call holding a transaction
   open while vitest's own timeout machinery is unrelated to and unaware of the pglite-level
   queue). This is a direct, measured instance of "serialises or flakes" — the Discretion
   section's own explicit tie-breaker.
2. **`pool: "forks"` (the project's default, unchanged) means a shared *in-process* singleton
   is structurally impossible anyway** — each worker is a separate process with its own memory,
   so "shared" can only mean "shared over the network via pglite-socket's TCP port passed
   through `provide()`/`inject()`" — which is precisely the configuration that hits the
   concurrency finding above. There is no shared-instance variant that avoids the queue.
3. **Per-file cost is low and bounded.** `PGlite.create()` + `PGLiteSocketServer.start()`
   completed in well under a second in every probe run (the whole 8-step SQL probe plus
   bootstrap ran in a few hundred ms total). With `hookTimeout: 60_000` already set in
   `vitest.config.ts` (originally for Docker-Postgres migrations, per its own comment), there
   is ample headroom for five independent in-memory instances to start in `beforeAll`.
4. **No `provide()`/`inject()` plumbing is needed at all** with this approach — each file is
   fully self-contained, matching the existing pattern ("the same `beforeAll` block is where
   the pool is created" per CONTEXT.md's Reusable Assets) almost unchanged. The only diff is
   swapping the pool-construction line for the new helper call.

**When a shared instance would be worth reconsidering:** if test file startup time (five
independent `PGlite.create()` calls) is ever measured to materially slow CI, and all five
files' `beforeAll`/`afterAll`/`it` bodies are audited to guarantee no two files ever hold
overlapping open transactions (which the schema-per-file pattern does *not* guarantee by
itself — it only isolates *data*, not the shared query queue) — that audit was not done here
and is out of scope for this research; the per-file approach sidesteps needing it.

## Default-URL relocation table (D-10: where `localhost:5433` and `databaseUrlFromEnv()`'s current default must move)

`databaseUrlFromEnv()` today (`packages/schema/src/db.ts:34-36`) is a single function used by
**both** the CLI/server path and all five test files, and it hard-codes the `5433` fallback
inside itself. D-10 requires the test path to stop defaulting to it while the server path
keeps a default. Since one function currently serves both callers, the fix is a signature
change (`databaseUrlFromEnv(): string` → `databaseUrlFromEnv(): string | undefined`, i.e. a
raw env reader with no fallback) plus pushing the `5433` default down to the one caller that
still needs it (the CLI). Every call site found by `grep -rn "databaseUrlFromEnv\|ORGLET_DATABASE_URL\|5433"`
(excluding `node_modules`/lockfile):

| Site | Current | Required change |
|---|---|---|
| `packages/schema/src/db.ts:34-36` (`databaseUrlFromEnv()` definition) | `return process.env["ORGLET_DATABASE_URL"] ?? "postgres://orglet:orglet@localhost:5433/orglet";` | Drop the `?? "..."` fallback; return `process.env["ORGLET_DATABASE_URL"]` (type becomes `string \| undefined`). This is the actual "default moves" step — the default is deleted from here, not relocated within this file. |
| `packages/schema/src/index.ts:3` (barrel re-export) | `export { createPool, databaseUrlFromEnv, ... }` | No code change; the exported type signature changes automatically. Downstream callers must be updated to match (next two rows) — `tsc -b` will fail loudly on any that aren't, which is a useful correctness check. |
| `packages/cli/src/main.ts:43` (`common()`) | `db: typeof values["db"] === "string" ? values["db"] : databaseUrlFromEnv()` | Add the fallback here: `... : (databaseUrlFromEnv() ?? "postgres://orglet:orglet@localhost:5433/orglet")`. This is where the default actually relocates **to** — "the server path". |
| `packages/cli/src/main.ts:25` (`--db` help text) | `--db Postgres URL (default ORGLET_DATABASE_URL or postgres://orglet:orglet@localhost:5433/orglet)` | No change needed — still accurate once the fallback moves to this file. |
| `packages/schema/src/migrate.test.ts:16,20` | `pool = createPool(databaseUrlFromEnv()); ... \`Postgres not reachable at ${databaseUrlFromEnv()} ...\`` | Stop calling `databaseUrlFromEnv()` directly for pool construction — replace with the new `testPool()` helper (see Recommendation). The error-message call site either goes away (pglite never "unreachable" the same way) or is rewritten to reflect which backend is active. |
| `packages/engine/src/engine.test.ts:22`, `packages/engine/src/query.test.ts:22`, `packages/api/src/api.test.ts:31`, `packages/api/src/bulk.test.ts:34` | Same `pool = createPool(databaseUrlFromEnv())` pattern | Same change as `migrate.test.ts` — all five files converge on the one new test helper (D-21: "exposed through one small test helper, not re-derived per file"). |
| `.env.example` (`ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet`, comment `# Postgres connection used by the engine and tests`) | Comment is now inaccurate — tests no longer use this by default | Update the comment to say it's for `orglet up`/real-Postgres testing/Docker Compose only (D-13); the value itself is unchanged (still the server-path default). |
| `docker-compose.yml:10` (`"${ORGLET_PG_PORT:-5433}:5432"`) | unchanged | No change — Docker Compose is explicitly the server/real-Postgres path (INFRA-03), keeps 5433. |
| `README.md:76` (`pnpm db:up # Postgres 16 on localhost:5433`) | Development section | Rewritten per D-13 to state Docker/5433 is optional, only needed for `orglet up` or testing against real Postgres — exact wording is Claude's Discretion per CONTEXT.md. |
| `.planning/codebase/TESTING.md:22,89,95,99` (planning doc, not code) | Describes the old "Postgres prerequisite ... default `postgres://orglet:orglet@localhost:5433/orglet`" behavior for tests | Not code, but will be stale after this phase; D-19 already requires this file to be updated with the pglite outcome — the executor should also correct this default-URL description while it's in there. |

No other source files reference `databaseUrlFromEnv` or the `5433` default (conformance/
harnesses and `packages/cli` other than the two lines above do not touch it).

## Validation Architecture (INFRA-01, INFRA-02, INFRA-03)

### Test Framework
| Property | Value |
|---|---|
| Framework | vitest 3.2.7 (root devDependency `^3.2.0`) |
| Config file | `vitest.config.ts` (single, workspace-wide) |
| Quick run command | `pnpm vitest run packages/schema/src/migrate.test.ts` (single-file, fastest signal for D-19's dedicated test once it exists) |
| Full suite command | `pnpm test` (root script, runs `vitest run`, per `passWithNoTests: true` config) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|---|---|---|---|---|
| INFRA-01 | `pnpm test` succeeds with no `ORGLET_DATABASE_URL` set and no Docker running | integration | `unset ORGLET_DATABASE_URL; pnpm test` — expect all five DB-backed files plus the rest of the suite to pass, using pglite | ✅ files exist (`migrate.test.ts`, `engine.test.ts`, `query.test.ts`, `api.test.ts`, `bulk.test.ts`); ❌ the pglite bootstrap helper itself — Wave 0 |
| INFRA-02 | `session_replication_role` + `information_schema` diffing verified on pglite | integration | A new dedicated test (D-19) — recommended location `packages/schema/src/pglite-compat.test.ts` or inline as the first `it()` in `migrate.test.ts` — asserting exactly probes b, c, d, e1, e2 above against the pglite-backed pool. Run: `pnpm vitest run packages/schema/src/pglite-compat.test.ts` | ❌ Wave 0 — this file does not exist yet; this research's probe script is the reference implementation to port into it |
| INFRA-03 | `orglet up`/Docker Compose never touch pglite; only the server-path default changes | manual + typecheck | `pnpm build` (i.e. `tsc -b`) must pass after the `databaseUrlFromEnv()` signature change (proves every caller was updated — see relocation table); manually run `pnpm db:up && ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm --filter @orglet/cli exec orglet up` (or equivalent) once to confirm the server path still reaches real Postgres | ✅ `docker-compose.yml`/CLI exist unchanged; ❌ no automated test currently exercises `orglet up` end-to-end (out of scope to add one in this phase per CONTEXT.md's phase boundary — "any change to what the running server does" is explicitly not in scope) |

### Sampling Rate
- **Per task commit:** `pnpm vitest run <changed test file>` (fast, single-file)
- **Per wave merge:** `pnpm test` (full suite, pglite-backed since no `ORGLET_DATABASE_URL` in local dev by default)
- **Phase gate:** Full suite green under **both** backends before `/gsd:verify-work` — `pnpm test` (pglite) and `pnpm db:up && ORGLET_DATABASE_URL=postgres://orglet:orglet@localhost:5433/orglet pnpm test` (real Postgres) — mirrors the eventual `test-pglite`/`test-postgres` CI split (D-16, Part B scope) but should be run once manually before the phase is considered done, per D-19's "outcome ... recorded" spirit.

### Wave 0 Gaps
- [ ] The pglite bootstrap helper module (`startPglite()` shape from this research) — needed before any of the five test files can be migrated off `databaseUrlFromEnv()`'s old default.
- [ ] The D-19 dedicated compatibility test (`session_replication_role` + `information_schema`) — port the probe script's assertions (probes b, c, d, e1, e2 above) into a real vitest test file; this is the "early test" the phase boundary requires to run *before* the five files are migrated.
- [ ] `.planning/codebase/TESTING.md` update recording the D-19 outcome (this research's probe results constitute that outcome: PASS, dated 2026-09-30, pinned pglite 0.5.8).

## Sources

### Primary (HIGH confidence — direct empirical verification, this research session)
- `node_modules/@electric-sql/pglite-socket/dist/index.d.ts` (installed fresh at pinned version 0.2.11) — full public API surface (`PGLiteSocketServer`, `PGLiteSocketServerOptions`, `PGLiteSocketHandler`)
- `node_modules/@electric-sql/pglite-socket/dist/index.js` (read via `PGLiteSocketServer.prototype.start.toString()` / `getServerConn.toString()` in a live Node REPL, since the bundled file is minified to one line) — exact `start()`/port-binding/`getServerConn()` behavior, and the `QueryQueueManager`'s transaction-aware queueing logic
- `node_modules/@electric-sql/pglite/dist/pglite-BdeXTuy6.d.ts` (pinned version 0.5.8) — `PGlite` class: constructor overloads, `static create()`, `close()`, `closed`, in-memory default
- `probe.mjs` / `probe-concurrency.mjs`, run against real installed packages, Node v22.23.3 — all 9 SQL-feature probes (a–i) and the instrumented concurrency re-run; raw output reproduced verbatim above
- `node_modules/vitest/dist/node.d.ts`, `node_modules/.pnpm/@vitest+runner@3.2.7/.../tasks.d-CkscK4of.d.ts` (repo's actual installed vitest 3.2.7) — `GlobalSetupContext`, `TestProject.provide`, `inject`, `TestContext.skip`, `skipIf`, `Pool`/default pool type
- Live vitest 3.2.7 run in an isolated scratch project — confirmed `globalSetup` pid ≠ worker pid (default `pool: "forks"`), `process.env` set in `globalSetup` visible in worker, `provide()`/`inject()` round-trip, `skip(condition, reason)`/`it.skipIf`/`describe.skipIf` all report as skipped with the reason visible
- Direct repo reads: `packages/schema/src/db.ts`, `vitest.config.ts`, `packages/schema/src/migrate.test.ts`, `packages/schema/src/migrate.ts`, `packages/engine/src/engine.ts:215`, `packages/cli/src/main.ts`, `.env.example`, `docker-compose.yml`, `README.md`, plus `grep -rn` across the repo for `databaseUrlFromEnv`, `ORGLET_DATABASE_URL`, `5433`, `Promise.all`, `.concurrent`

### Secondary / not used
- No WebSearch, WebFetch, or Context7 calls were made in this research session — the brief's "at most 3 fetches" budget was not needed because every question was answerable by installing and running the pinned versions directly.

## Metadata

**Confidence breakdown:**
- pglite-socket API / bootstrap mechanics: HIGH — read from installed `.d.ts` + minified source, cross-checked against a live run
- SQL feature compatibility (probes a–h): HIGH — direct execution against the pinned version, verbatim output recorded
- Concurrency/serialization behavior (probe i): HIGH — reproduced twice (naive hang + instrumented timeout version pinpointing the exact blocking step), cross-checked against the queue manager's own source and doc comment
- vitest globalSetup/env/skip mechanics: HIGH — verified with a standalone live vitest 3.2.7 run using the exact package version installed in this repo
- Default-URL relocation table: HIGH — exhaustive `grep -rn` across the repo, every hit read in context

**Research date:** 2026-09-30
**Valid until:** pinned to `@electric-sql/pglite@0.5.8` / `@electric-sql/pglite-socket@0.2.11` / `vitest@3.2.7` exactly — re-verify the concurrency/queue behavior and the `globalSetup` process-spawn-order finding if any of these three versions are bumped (pglite is still alpha-labeled per its own maintainers per STACK.md; vitest's `pool` default has changed across major versions before).
