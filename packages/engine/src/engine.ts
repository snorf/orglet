/**
 * The save pipeline: Salesforce's documented order of execution for insert, update, upsert,
 * delete and undelete, minus Apex and Flow (which plug in through TriggerExecutor).
 *
 * Per call: one transaction, or a savepoint inside the caller's transaction when one is supplied
 * (Bulk ingest commits a chunk and its results together); each record is written under its own
 * savepoint so partial success works, and allOrNone rolls the whole call back. Roll-up summaries are recomputed after
 * the batch's after-hooks, and a parent that refuses the recomputed row rolls back exactly the
 * children that point at it.
 */
import type { FieldDef, OrgSchema, SObjectDef } from "@orglet/metadata";
import { DEFAULT_ORG_SCHEMA, formatSalesforceDatetime, generateId, keyPrefixOf, matchTargetByPrefix, rollupSelectSql, type Pool, type PoolClient } from "@orglet/schema";
import { asString, evaluateCompiled, type EvaluationContext, type RecordData } from "@orglet/formula";
import { coerceRecord, coerceValue } from "./coerce.js";
import { Errors, failure, saveError, unknownSObject, type SaveError, type SaveResult } from "./errors.js";
import { ChangeBus, type ChangeEvent, type ChangeType } from "./events.js";
import { applyCompoundFields, applyFormulaFields, FormulaRegistry } from "./formulas.js";
import type { DmlOperation, Session, TriggerContext, TriggerExecutor } from "./hooks.js";
import { loadParents } from "./parents.js";
import { affectedParents, RollupRegistry, type ParentGroup, type RollupKind } from "./rollups.js";
import { formatAutoNumber, Store } from "./store.js";

export interface EngineOptions {
  orgSchema?: string;
  executors?: TriggerExecutor[];
  /**
   * Data-migration mode: records may carry their original Id and audit fields, lookups are
   * not checked (so parents and children can arrive in any order), object- and field-level
   * create/update/delete flags are not enforced, and validation rules and hooks are bypassed.
   * Postgres foreign keys are disabled for the session while it is on.
   */
  importMode?: boolean;
}

/**
 * A caller-owned transaction a DML call can join. The engine runs on `client` inside
 * `SAVEPOINT dml_run`, never issues BEGIN/COMMIT/ROLLBACK itself, and appends its change
 * events to `events` instead of publishing them; whoever commits publishes them afterwards
 * (DmlEngine.transaction does). In import mode the replica session_replication_role set by
 * the call lasts until the caller's transaction ends.
 */
export interface DmlTransaction {
  readonly client: PoolClient;
  readonly events: ChangeEvent[];
}

export interface DmlOptions {
  allOrNone?: boolean;
  /** Join the caller's open transaction instead of opening one (see DmlTransaction). */
  transaction?: DmlTransaction;
}

export interface RetrieveOptions {
  includeDeleted?: boolean;
}

interface Work {
  index: number;
  errors: SaveError[];
  /** Coerced client values (insert/update). */
  changes: RecordData;
  /** Previous row (update/delete/undelete). */
  old?: RecordData;
  /** Full new row as it will be written. */
  next: RecordData;
  id?: string;
  created?: boolean;
}

interface Globals {
  user?: RecordData;
  profile?: RecordData;
  organization?: RecordData;
}

type ObjectOperation = "insert" | "update" | "upsert" | "delete" | "undelete";

const isPgUniqueViolation = (err: unknown): err is { code: string; constraint?: string } =>
  typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";

const NO_IDS: ReadonlySet<string> = new Set<string>();
/** Chain levels a roll-up recompute may climb; load-time cycle detection makes this unreachable in practice. */
const MAX_ROLLUP_DEPTH = 16;

export class DmlEngine {
  readonly store: Store;
  readonly formulas: FormulaRegistry;
  readonly rollups: RollupRegistry;
  readonly bus = new ChangeBus();
  readonly executors: TriggerExecutor[];
  readonly orgSchema: string;
  readonly importMode: boolean;

  constructor(
    readonly pool: Pool,
    readonly schema: OrgSchema,
    options: EngineOptions = {},
  ) {
    this.orgSchema = options.orgSchema ?? DEFAULT_ORG_SCHEMA;
    this.store = new Store(schema, this.orgSchema);
    this.formulas = new FormulaRegistry(schema);
    this.rollups = new RollupRegistry(schema);
    this.executors = options.executors ?? [];
    this.importMode = options.importMode ?? false;
  }

  get warnings(): string[] {
    return this.formulas.warnings;
  }

  object(name: string): SObjectDef {
    const obj = this.schema.getObject(name);
    if (!obj) throw unknownSObject(name);
    return obj;
  }

  /**
   * Object-level createable/updateable/deletable/undeletable flags (the Object Reference's
   * Supported Calls; upsert needs both create and update). Import mode bypasses them, as
   * coerce.ts bypasses field-level flags, so read-only objects can be migrated (D-08).
   */
  private refuse(obj: SObjectDef, operation: ObjectOperation, count: number): SaveResult[] | undefined {
    if (this.importMode) return undefined;
    const allowed: Record<ObjectOperation, boolean> = {
      insert: obj.createable,
      update: obj.updateable,
      upsert: obj.createable && obj.updateable,
      delete: obj.deletable,
      undelete: obj.undeletable,
    };
    if (allowed[operation]) return undefined;
    // A fresh error per result, so a caller that mutates one result cannot change another.
    return Array.from({ length: count }, () => failure([Errors.invalidTypeForOperation(`entity type ${obj.name} does not support ${operation}`)]));
  }

  // ---------------------------------------------------------------------------------------
  // Public DML

  async insert(session: Session, sobject: string, inputs: Record<string, unknown>[], options: DmlOptions = {}): Promise<SaveResult[]> {
    const obj = this.object(sobject);
    const refused = this.refuse(obj, "insert", inputs.length);
    if (refused) return refused;
    return this.run(session, obj, "insert", options, async (client, globals) => {
      const work = inputs.map((input, index) => this.prepareInsert(obj, input, index));
      await this.saveBatch(client, session, obj, "insert", work, globals);
      return work;
    });
  }

  async update(session: Session, sobject: string, inputs: Record<string, unknown>[], options: DmlOptions = {}): Promise<SaveResult[]> {
    const obj = this.object(sobject);
    const refused = this.refuse(obj, "update", inputs.length);
    if (refused) return refused;
    return this.run(session, obj, "update", options, async (client, globals) => {
      const work = inputs.map((input, index) => this.prepareUpdate(obj, input, index));
      await this.attachOld(client, obj, work);
      await this.saveBatch(client, session, obj, "update", work, globals);
      return work;
    });
  }

  async upsert(session: Session, sobject: string, externalIdField: string, inputs: Record<string, unknown>[], options: DmlOptions = {}): Promise<SaveResult[]> {
    const obj = this.object(sobject);
    const refused = this.refuse(obj, "upsert", inputs.length);
    if (refused) return refused;
    const extField = this.schema.getField(obj.name, externalIdField);
    if (!extField || !(extField.idLookup || extField.name === "Id")) {
      return inputs.map(() => failure([Errors.invalidField(externalIdField, obj.name)]));
    }
    return this.run(session, obj, "insert", options, async (client, globals) => {
      const inserts: Work[] = [];
      const updates: Work[] = [];
      const all: Work[] = [];
      for (const [index, input] of inputs.entries()) {
        const raw = input[extField.name] ?? input[externalIdField];
        const coerced = coerceValue(extField, raw);
        if (coerced.error || coerced.value === null) {
          const w: Work = { index, errors: [coerced.error ?? Errors.requiredMissing([extField.name])], changes: {}, next: {}, created: false };
          all.push(w);
          continue;
        }
        const matches = extField.name === "Id" ? [...(await this.store.loadByIds(client, obj, [String(coerced.value)])).values()] : await this.store.findByField(client, obj, extField, coerced.value);
        if (matches.length > 1) {
          const w: Work = { index, errors: [Errors.duplicateExternalId(extField.name, String(coerced.value), matches.map((m) => asString(m["Id"])))], changes: {}, next: {}, created: false };
          all.push(w);
        } else if (matches.length === 1) {
          const existing = matches[0] as RecordData;
          const w = this.prepareUpdate(obj, { ...input, Id: existing["Id"] }, index);
          w.old = existing;
          w.created = false;
          updates.push(w);
          all.push(w);
        } else {
          const w = this.prepareInsert(obj, { ...input, [extField.name]: coerced.value }, index);
          w.created = true;
          inserts.push(w);
          all.push(w);
        }
      }
      if (inserts.length > 0) await this.saveBatch(client, session, obj, "insert", inserts, globals);
      if (updates.length > 0) await this.saveBatch(client, session, obj, "update", updates, globals);
      return all;
    });
  }

  async delete(session: Session, sobject: string, ids: string[], options: DmlOptions = {}): Promise<SaveResult[]> {
    const obj = this.object(sobject);
    const refused = this.refuse(obj, "delete", ids.length);
    if (refused) return refused;
    return this.run(session, obj, "delete", options, async (client, globals) => {
      const work = ids.map((raw, index) => this.prepareId(obj, raw, index));
      await this.attachOld(client, obj, work);
      await this.deleteBatch(client, session, obj, work, globals);
      return work;
    });
  }

  async undelete(session: Session, sobject: string, ids: string[], options: DmlOptions = {}): Promise<SaveResult[]> {
    const obj = this.object(sobject);
    const refused = this.refuse(obj, "undelete", ids.length);
    if (refused) return refused;
    return this.run(session, obj, "undelete", options, async (client, globals) => {
      const work = ids.map((raw, index) => this.prepareId(obj, raw, index));
      await this.attachOld(client, obj, work, true);
      for (const w of work) {
        if (w.errors.length === 0 && w.old && w.old["IsDeleted"] !== true) w.errors.push(Errors.invalidOperation("The record is not in the recycle bin"));
      }
      await this.undeleteBatch(client, session, obj, work, globals);
      return work;
    });
  }

  /** Run `fn` in one transaction that DML calls join via `{ transaction: tx }`; their change events are published after COMMIT. */
  async transaction<T>(fn: (tx: DmlTransaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    const tx: DmlTransaction = { client, events: [] };
    let result: T;
    try {
      await client.query("BEGIN");
      result = await fn(tx);
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    await this.bus.publish(tx.events);
    return result;
  }

  /** Load records by ID with formula and compound fields computed; missing IDs are absent. */
  async retrieve(session: Session, sobject: string, ids: string[], options: RetrieveOptions = {}): Promise<Map<string, RecordData>> {
    const obj = this.object(sobject);
    const client = await this.pool.connect();
    try {
      const rows = await this.store.loadByIds(client, obj, ids, options.includeDeleted ?? false);
      await this.project(client, session, obj, [...rows.values()]);
      return rows;
    } finally {
      client.release();
    }
  }

  /** Compute formula and compound fields on already-loaded rows (used by SOQL results too). */
  async project(client: PoolClient, session: Session, obj: SObjectDef, rows: RecordData[]): Promise<void> {
    if (rows.length === 0) return;
    const globals = await this.loadGlobals(client, session);
    await loadParents(client, this.store, obj, rows, this.formulas.parentPaths(obj, ["fields"]));
    for (const row of rows) {
      applyFormulaFields(this.formulas, obj, row, globals);
      applyCompoundFields(obj, row);
    }
  }

  // ---------------------------------------------------------------------------------------
  // Transaction wrapper

  private async run(session: Session, obj: SObjectDef, operation: DmlOperation, options: DmlOptions, body: (client: PoolClient, globals: Globals) => Promise<Work[]>): Promise<SaveResult[]> {
    const allOrNone = options.allOrNone ?? false;
    const events: ChangeEvent[] = [];
    let results: SaveResult[] = [];
    const external = options.transaction;
    const client = external ? external.client : await this.pool.connect();
    const begin = external ? "SAVEPOINT dml_run" : "BEGIN";
    const commit = external ? "RELEASE SAVEPOINT dml_run" : "COMMIT";
    const rollback = external ? ["ROLLBACK TO SAVEPOINT dml_run", "RELEASE SAVEPOINT dml_run"] : ["ROLLBACK"];
    try {
      await client.query(begin);
      // Import mode: no FK enforcement, so a child can be loaded before its parent.
      if (this.importMode) await client.query("SET LOCAL session_replication_role = replica");
      const globals = await this.loadGlobals(client, session);
      const work = await body(client, globals);
      work.sort((a, b) => a.index - b.index);
      const failed = work.some((w) => w.errors.length > 0);
      if (allOrNone && failed) {
        for (const s of rollback) await client.query(s);
        results = work.map((w) => {
          if (w.errors.length > 0) {
            const f = failure(w.errors);
            if (w.created !== undefined) f.created = w.created;
            return f;
          }
          const r: SaveResult = { success: false, errors: [Errors.rolledBack()] };
          if (w.id) r.id = w.id;
          if (w.created !== undefined) r.created = w.created;
          return r;
        });
        return results;
      }
      await client.query(commit);
      results = work.map((w) => {
        if (w.errors.length > 0) {
          const f = failure(w.errors);
          if (w.created !== undefined) f.created = w.created;
          return f;
        }
        const r: SaveResult = { success: true, errors: [] };
        if (w.id) r.id = w.id;
        if (w.created !== undefined) r.created = w.created;
        return r;
      });
      events.push(...this.eventsFor(obj, operation, work, session));
    } catch (err) {
      for (const s of rollback) await client.query(s).catch(() => undefined);
      throw err;
    } finally {
      if (!external) client.release();
    }
    if (external) external.events.push(...events);
    else await this.bus.publish(events);
    return results;
  }

  private eventsFor(obj: SObjectDef, operation: DmlOperation, work: Work[], session: Session): ChangeEvent[] {
    const ok = work.filter((w) => w.errors.length === 0 && w.id);
    if (ok.length === 0) return [];
    const stamp = formatSalesforceDatetime(new Date());
    const key = generateId("0e1"); // transaction key: any unique token
    const byType = new Map<ChangeType, Work[]>();
    for (const w of ok) {
      const type: ChangeType = operation === "insert" ? (w.created === false ? "UPDATE" : "CREATE") : operation === "update" ? "UPDATE" : operation === "delete" ? "DELETE" : "UNDELETE";
      byType.set(type, [...(byType.get(type) ?? []), w]);
    }
    return [...byType.entries()].map(([changeType, items]) => ({
      entityName: obj.name,
      changeType,
      recordIds: items.map((w) => w.id ?? ""),
      changedFields: changeType === "UPDATE" ? [...new Set(items.flatMap((w) => Object.keys(w.changes)))] : [],
      commitTimestamp: stamp,
      commitUser: session.userId,
      transactionKey: key,
    }));
  }

  private async loadGlobals(client: PoolClient, session: Session): Promise<Globals> {
    const load = async (name: string, id: string) => {
      const obj = this.schema.getObject(name);
      return obj ? (await this.store.loadByIds(client, obj, [id], true)).get(id) : undefined;
    };
    const globals: Globals = {};
    const user = await load("User", session.userId);
    if (user) globals.user = user;
    const profile = await load("Profile", session.profileId);
    if (profile) globals.profile = profile;
    const organization = await load("Organization", session.organizationId);
    if (organization) globals.organization = organization;
    return globals;
  }

  // ---------------------------------------------------------------------------------------
  // Preparation

  private prepareInsert(obj: SObjectDef, input: Record<string, unknown>, index: number): Work {
    const coerced = coerceRecord(obj, input, "insert", (n) => this.schema.getField(obj.name, n), this.importMode);
    const w: Work = { index, errors: coerced.errors, changes: coerced.values, next: { ...coerced.values } };
    const given = coerced.values["Id"];
    if (typeof given === "string") {
      if (keyPrefixOf(given) !== obj.keyPrefix) w.errors.push(Errors.malformedId("Id", "Id", given));
      else w.id = given;
      delete w.changes["Id"];
    }
    return w;
  }

  private prepareUpdate(obj: SObjectDef, input: Record<string, unknown>, index: number): Work {
    const coerced = coerceRecord(obj, input, "update", (n) => this.schema.getField(obj.name, n), this.importMode);
    const w: Work = { index, errors: coerced.errors, changes: coerced.values, next: {} };
    const rawId = input["Id"] ?? input["id"];
    if (rawId === undefined || rawId === null || rawId === "") {
      w.errors.push(Errors.missingId());
      return w;
    }
    const idField = this.schema.getField(obj.name, "Id") as FieldDef;
    const id = coerceValue(idField, rawId);
    if (id.error) w.errors.push(id.error);
    else w.id = String(id.value);
    return w;
  }

  private prepareId(obj: SObjectDef, raw: string, index: number): Work {
    const w: Work = { index, errors: [], changes: {}, next: {} };
    const id = coerceValue(this.schema.getField(obj.name, "Id") as FieldDef, raw);
    if (id.error) w.errors.push(id.error);
    else w.id = String(id.value);
    return w;
  }

  private async attachOld(client: PoolClient, obj: SObjectDef, work: Work[], includeDeleted = false): Promise<void> {
    const ids = work.filter((w) => w.id && w.errors.length === 0).map((w) => w.id as string);
    const rows = await this.store.loadByIds(client, obj, ids, true);
    for (const w of work) {
      if (!w.id || w.errors.length > 0) continue;
      if (keyPrefixOf(w.id) !== obj.keyPrefix) {
        w.errors.push(Errors.malformedId("Id", "Id", w.id));
        continue;
      }
      const old = rows.get(w.id);
      if (!old) w.errors.push(Errors.notFound());
      else if (old["IsDeleted"] === true && !includeDeleted) w.errors.push(Errors.entityDeleted());
      else w.old = old;
    }
  }

  // ---------------------------------------------------------------------------------------
  // Insert / update pipeline

  private async saveBatch(client: PoolClient, session: Session, obj: SObjectDef, operation: "insert" | "update", work: Work[], globals: Globals): Promise<void> {
    const now = formatSalesforceDatetime(new Date());
    const live = () => work.filter((w) => w.errors.length === 0);

    // Build the prospective row: defaults + system fields (insert) or old + changes (update).
    for (const w of live()) {
      if (operation === "insert") {
        w.id ??= generateId(obj.keyPrefix);
        w.next = { ...(await this.defaults(client, obj, w.changes, session, globals)), ...w.changes };
        const audit = { IsDeleted: false, CreatedDate: now, CreatedById: session.userId, LastModifiedDate: now, LastModifiedById: session.userId, SystemModstamp: now };
        // Import mode keeps supplied audit values; otherwise the platform sets them.
        for (const [k, v] of Object.entries(audit)) if (!this.importMode || w.changes[k] === undefined) w.next[k] = v;
        w.next["Id"] = w.id;
        if (obj.hasOwner && w.next["OwnerId"] === undefined) w.next["OwnerId"] = session.userId;
      } else {
        const stamps = this.importMode ? {} : { LastModifiedDate: now, LastModifiedById: session.userId, SystemModstamp: now };
        w.next = { ...(w.old ?? {}), ...w.changes, ...stamps };
      }
    }

    // Before hooks may change `next`; anything they touch counts as a change.
    if (!this.importMode) await this.runHooks(session, obj, operation, "before", work.filter((w) => w.errors.length === 0));
    for (const w of live()) {
      if (operation === "update") {
        for (const [k, v] of Object.entries(w.next)) {
          if (w.old && !(k in w.changes) && v !== w.old[k] && typeof v !== "object") w.changes[k] = v;
        }
      }
    }

    for (const w of live()) this.applyPlatformRules(obj, w);

    // System validation that needs the whole row: required fields and references.
    for (const w of live()) this.checkRequired(obj, w, operation);
    if (!this.importMode) await this.checkReferences(client, obj, live());

    // Custom validation rules (bypassed in import mode, like a data load with automation off).
    if (!this.importMode) await this.runValidationRules(client, obj, live(), operation === "insert", globals);

    // Write, one savepoint per record so a unique violation only fails that record.
    const write = async (): Promise<void> => {
      for (const w of live()) {
        await client.query(`SAVEPOINT rec`);
        try {
          if (operation === "insert") await this.store.insert(client, obj, w.next);
          else await this.store.update(client, obj, w.id as string, { ...w.changes, ...(this.importMode ? {} : { LastModifiedDate: now, LastModifiedById: session.userId, SystemModstamp: now }) });
          await client.query(`RELEASE SAVEPOINT rec`);
        } catch (err) {
          await client.query(`ROLLBACK TO SAVEPOINT rec`);
          if (!isPgUniqueViolation(err)) throw err;
          w.errors.push(await this.duplicateError(client, obj, w, err.constraint));
        }
      }
      if (!this.importMode) await this.runHooks(session, obj, operation, "after", live());
    };
    // D-02: roll-ups recompute after the children's after-hooks.
    await this.withRollups(client, obj, work.length, write, () => this.recomputeRollups(client, session, globals, obj, work, operation, NO_IDS));
  }

  // ---------------------------------------------------------------------------------------
  // Roll-up summaries

  /**
   * Runs a batch's writes and after-hooks together with the roll-up recompute under one savepoint. When a parent
   * refuses (rule or hook), the children it blames now carry errors: roll the batch back and replay the survivors,
   * so committed parents only ever reflect committed children (D-03). Terminates because every repeated pass
   * fails at least one more child. Postgres resolves a repeated savepoint name to the most recent one, so nested
   * batches (cascades) each get their own.
   */
  private async withRollups(client: PoolClient, obj: SObjectDef, size: number, body: () => Promise<void>, recompute: () => Promise<number>): Promise<void> {
    if (this.importMode || this.rollups.forChild(obj).length === 0) return body();
    for (let pass = 0; ; pass++) {
      if (pass > size) throw new Error(`roll-up replay on ${obj.name} did not converge`);
      await client.query("SAVEPOINT rollup_batch");
      await body();
      if ((await recompute()) === 0) {
        await client.query("RELEASE SAVEPOINT rollup_batch");
        return;
      }
      await client.query("ROLLBACK TO SAVEPOINT rollup_batch");
      await client.query("RELEASE SAVEPOINT rollup_batch");
    }
  }

  /**
   * Recompute every parent the batch touched, level by level up the master-detail chain, and save each parent whose
   * roll-up values changed through its own rules and hooks. A refusing parent puts its error on every child in the
   * batch that points at it (old or new FK); the chain's blame resolves back to those original children. Returns
   * how many children newly failed, so the caller can replay without them.
   */
  private async recomputeRollups(client: PoolClient, session: Session, globals: Globals, child: SObjectDef, works: Work[], kind: RollupKind, skip: ReadonlySet<string>): Promise<number> {
    const failedBefore = new Set(works.filter((w) => w.errors.length > 0));
    const newlyFailed = () => works.filter((w) => w.errors.length > 0 && !failedBefore.has(w)).length;
    // Parent work -> the original child works it answers for.
    const blame = new Map<Work, Set<Work>>();
    const childrenOf = (s: Set<Work>): Set<Work> => new Set([...s].flatMap((w) => [...(blame.get(w) ?? [w])]));

    let level = affectedParents(this.rollups.forChild(child), works, kind, skip);
    for (let depth = 1; level.length > 0; depth++) {
      if (depth > MAX_ROLLUP_DEPTH) throw new Error(`roll-up recompute on ${child.name} did not settle after ${MAX_ROLLUP_DEPTH} levels`);
      const written = new Map<SObjectDef, Work[]>();
      for (const group of level) {
        const ids = [...group.ids.keys()];
        const { sql, params } = rollupSelectSql(this.orgSchema, this.schema, group.parent, group.fields, ids);
        const fresh = new Map((await client.query<RecordData>(sql, params)).rows.map((r) => [asString(r["Id"]), r]));
        const current = await this.store.loadByIds(client, group.parent, ids);
        for (const id of ids) {
          const computed = fresh.get(id);
          const row = current.get(id);
          // A parent deleted meanwhile has nothing to recompute.
          if (!computed || !row) continue;
          const changes: RecordData = {};
          for (const f of group.fields) {
            const value = computed[f.name] ?? null;
            if (value !== (row[f.name] ?? null)) changes[f.name] = value;
          }
          // Unchanged values: no parent save, so no parent hooks or rules either.
          if (Object.keys(changes).length === 0) continue;
          const pw: Work = { index: 0, errors: [], changes, old: row, next: { ...row, ...changes }, id };
          const blamed = childrenOf(group.ids.get(id) ?? new Set<Work>());
          blame.set(pw, blamed);
          if (await this.saveRollupParent(client, session, globals, group.parent, pw)) {
            written.set(group.parent, [...(written.get(group.parent) ?? []), pw]);
          } else {
            for (const w of blamed) if (w.errors.length === 0) w.errors.push(...pw.errors.map((e) => saveError(e.statusCode, e.message)));
          }
        }
      }
      // The pass is rolled back and replayed anyway; climbing further would only run hooks for nothing.
      if (newlyFailed() > 0) break;
      const next: ParentGroup<Work>[] = [];
      for (const [parentObj, parents] of written) next.push(...affectedParents(this.rollups.forChild(parentObj), parents, "update", skip));
      level = next;
    }
    return newlyFailed();
  }

  /** The parent's save procedure for a roll-up change (D-01, D-02): before-hooks, its rules, the UPDATE, after-hooks. No audit stamps. */
  private async saveRollupParent(client: PoolClient, session: Session, globals: Globals, obj: SObjectDef, pw: Work): Promise<boolean> {
    await this.runHooks(session, obj, "update", "before", [pw]);
    for (const [k, v] of Object.entries(pw.next)) {
      if (pw.old && !(k in pw.changes) && v !== pw.old[k] && typeof v !== "object") pw.changes[k] = v;
    }
    if (pw.errors.length === 0) await this.runValidationRules(client, obj, [pw], false, globals);
    if (pw.errors.length > 0) return false;

    await client.query("SAVEPOINT rollup_parent");
    try {
      await this.store.update(client, obj, pw.id as string, pw.changes);
      await this.runHooks(session, obj, "update", "after", [pw]);
    } catch (err) {
      await client.query("ROLLBACK TO SAVEPOINT rollup_parent");
      await client.query("RELEASE SAVEPOINT rollup_parent");
      if (!isPgUniqueViolation(err)) throw err;
      pw.errors.push(await this.duplicateError(client, obj, pw, err.constraint));
      return false;
    }
    if (pw.errors.length > 0) {
      await client.query("ROLLBACK TO SAVEPOINT rollup_parent");
      await client.query("RELEASE SAVEPOINT rollup_parent");
      return false;
    }
    await client.query("RELEASE SAVEPOINT rollup_parent");
    return true;
  }

  /** Custom validation rules on prospective rows; failures go on each work item (shared by saveBatch and roll-up parents). */
  private async runValidationRules(client: PoolClient, obj: SObjectDef, candidates: Work[], isNew: boolean, globals: Globals): Promise<void> {
    const rules = this.formulas.validationRules(obj);
    if (rules.length === 0 || candidates.length === 0) return;
    const rows = candidates.map((w) => ({ ...w.next }));
    await loadParents(client, this.store, obj, rows, this.formulas.parentPaths(obj, ["rules"]));
    candidates.forEach((w, i) => {
      const ctx: EvaluationContext = { record: rows[i] as RecordData, isNew, ...globals, ...(w.old ? { old: w.old } : {}) };
      for (const { rule, compiled } of rules) {
        const result = evaluateCompiled(compiled, ctx);
        // A rule that errors at runtime blocks the save, like the platform does.
        if (result.value === true || result.error !== undefined) w.errors.push(Errors.customValidation(rule.errorMessage, rule.errorDisplayField));
      }
    });
  }

  private async defaults(client: PoolClient, obj: SObjectDef, changes: RecordData, session: Session, globals: Globals): Promise<RecordData> {
    const out: RecordData = {};
    for (const field of obj.fields) {
      if (changes[field.name] !== undefined && changes[field.name] !== null) continue;
      if (field.rollup) {
        // D-04: an empty parent counts and sums to 0; MIN/MAX stay null.
        if (field.rollup.operation === "COUNT" || field.rollup.operation === "SUM") out[field.name] = 0;
      } else if (field.type === "AutoNumber") {
        out[field.name] = formatAutoNumber(field.displayFormat, await this.store.nextAutoNumber(client, obj, field));
      } else if (field.type === "Checkbox") {
        out[field.name] = field.defaultValue === "true";
      } else if (field.picklist && field.type === "Picklist") {
        const def = field.picklist.values.find((v) => v.default && v.active);
        if (def) out[field.name] = def.value;
      } else if (field.name === "RecordTypeId" && obj.recordTypes.length > 0) {
        const first = obj.recordTypes.find((r) => r.active);
        if (first) {
          const rt = this.schema.getObject("RecordType");
          const rows = rt ? await this.store.findByField(client, rt, this.schema.getField("RecordType", "DeveloperName") as FieldDef, first.name) : [];
          const match = rows.find((r) => asString(r["SobjectType"]).toLowerCase() === obj.name.toLowerCase());
          if (match) out[field.name] = match["Id"];
        }
      }
      const compiled = this.formulas.defaultValue(obj, field);
      if (compiled && field.type !== "Checkbox") {
        const result = evaluateCompiled(compiled, { record: {}, isNew: true, ...globals });
        if (result.value !== null) out[field.name] = result.value;
      }
    }
    void session;
    return out;
  }

  /** Fields the platform derives from picklist metadata: Opportunity stage and Case status. */
  private applyPlatformRules(obj: SObjectDef, w: Work): void {
    if (obj.name === "Opportunity" && "StageName" in w.changes) {
      const stage = this.schema.getField("Opportunity", "StageName")?.picklist?.values.find((v) => v.value === w.next["StageName"]);
      if (stage) {
        if (!("Probability" in w.changes) && stage.probability !== undefined) w.next["Probability"] = stage.probability;
        if (stage.forecastCategory !== undefined) w.next["ForecastCategory"] = stage.forecastCategory;
        w.next["IsClosed"] = stage.closed ?? false;
        w.next["IsWon"] = stage.won ?? false;
        for (const k of ["Probability", "ForecastCategory", "IsClosed", "IsWon"]) if (w.next[k] !== w.old?.[k]) w.changes[k] = w.next[k];
      }
    }
    if (obj.name === "Case" && "Status" in w.changes) {
      const status = this.schema.getField("Case", "Status")?.picklist?.values.find((v) => v.value === w.next["Status"]);
      if (status) {
        const closed = status.isClosed ?? false;
        w.next["IsClosed"] = closed;
        w.changes["IsClosed"] = closed;
        if (closed && !w.old?.["IsClosed"]) {
          w.next["ClosedDate"] = w.next["LastModifiedDate"] ?? null;
          w.changes["ClosedDate"] = w.next["ClosedDate"];
        }
      }
    }
  }

  private checkRequired(obj: SObjectDef, w: Work, operation: "insert" | "update"): void {
    const missing: string[] = [];
    for (const field of obj.fields) {
      if (field.nillable || field.formula !== undefined || field.type === "Address" || field.type === "Name" || field.type === "Location") continue;
      if (operation === "insert" ? !field.createable || field.defaultedOnCreate : !(field.name in w.changes)) continue;
      const v = w.next[field.name];
      if (v === null || v === undefined || v === "") missing.push(field.name);
    }
    if (missing.length > 0) w.errors.push(Errors.requiredMissing(missing));
  }

  private async checkReferences(client: PoolClient, obj: SObjectDef, work: Work[]): Promise<void> {
    // Group referenced IDs by target object so each object costs one query.
    const wanted = new Map<string, Set<string>>();
    const refs: { w: Work; field: FieldDef; id: string; target: SObjectDef }[] = [];
    for (const w of work) {
      for (const field of obj.fields) {
        if ((field.type !== "Lookup" && field.type !== "MasterDetail") || !(field.name in w.changes)) continue;
        const id = w.next[field.name];
        if (typeof id !== "string") continue;
        const targets = (field.referenceTo ?? []).map((n) => this.schema.getObject(n)).filter((o): o is SObjectDef => o !== undefined);
        const target = matchTargetByPrefix(targets, id);
        if (!target) {
          // Unknown target object (e.g. Group): accept unchecked. Known targets: wrong prefix is a bad reference.
          if (targets.length === (field.referenceTo ?? []).length) w.errors.push(Errors.invalidCrossReference(field.name));
          continue;
        }
        refs.push({ w, field, id, target });
        wanted.set(target.name, (wanted.get(target.name) ?? new Set()).add(id));
      }
    }
    const existing = new Map<string, Set<string>>();
    for (const [name, ids] of wanted) existing.set(name, await this.store.existingIds(client, this.object(name), [...ids]));
    for (const { w, field, id, target } of refs) {
      if (!existing.get(target.name)?.has(id)) w.errors.push(Errors.invalidCrossReference(field.name));
    }
  }

  private async duplicateError(client: PoolClient, obj: SObjectDef, w: Work, constraint: string | undefined): Promise<SaveError> {
    if (constraint?.endsWith("_pkey")) return Errors.duplicateValue("Id", w.id ?? "");
    const field = obj.fields.find((f) => f.unique && constraint?.endsWith(f.name.toLowerCase()));
    if (!field) return Errors.duplicateValue(constraint ?? "unique", "");
    const value = w.next[field.name];
    const rows = value === undefined || typeof value === "object" ? [] : await this.store.findByField(client, obj, field, value);
    return Errors.duplicateValue(field.name, asString(rows[0]?.["Id"]));
  }

  // ---------------------------------------------------------------------------------------
  // Delete / undelete

  /** `deleting`: ids being deleted up the cascade stack; those parents are about to be soft-deleted, so they are never recomputed, rule-checked or hooked. */
  private async deleteBatch(client: PoolClient, session: Session, obj: SObjectDef, work: Work[], globals: Globals, deleting: ReadonlySet<string> = NO_IDS): Promise<void> {
    const live = () => work.filter((w) => w.errors.length === 0);
    await this.runHooks(session, obj, "delete", "before", live());
    if (live().length === 0) return;

    // Cascade + soft delete + after-hooks replay from the surviving state when a parent refuses the recompute (D-03).
    await this.withRollups(client, obj, work.length, async () => {
      const ids = live().map((w) => w.id as string);
      if (ids.length === 0) return;
      for (const child of this.schema.childRelationships(obj.name)) {
        const childObj = this.object(child.childSObject);
        const field = this.schema.getField(childObj.name, child.field) as FieldDef;
        const rows = await this.store.childrenOf(client, childObj, field, ids);
        if (rows.length === 0) continue;
        if (child.restrictedDelete) {
          for (const w of live()) {
            const mine = rows.filter((r) => r[field.name] === w.id).map((r) => asString(r["Id"]));
            if (mine.length > 0) w.errors.push(Errors.deleteRestricted(asString(w.old?.["Name"]) || (w.id ?? ""), childObj.labelPlural, mine));
          }
        } else if (child.cascadeDelete) {
          const childWork: Work[] = rows.map((r, index) => ({ index, errors: [], changes: {}, next: {}, id: asString(r["Id"]), old: r }));
          await this.deleteBatch(client, session, childObj, childWork, globals, new Set([...deleting, ...ids]));
          const failed = childWork.filter((c) => c.errors.length > 0);
          for (const c of failed) {
            const parent = live().find((w) => w.id === c.old?.[field.name]);
            parent?.errors.push(...c.errors);
          }
        } else {
          await client.query(`UPDATE ${this.store.table(childObj)} SET "${field.name.toLowerCase()}" = NULL WHERE "${field.name.toLowerCase()}" = ANY($1)`, [ids]);
        }
      }
      const stamp = { at: formatSalesforceDatetime(new Date()), by: session.userId };
      await this.store.setDeleted(client, obj, live().map((w) => w.id as string), true, stamp);
      await this.runHooks(session, obj, "delete", "after", live());
    }, () => this.recomputeRollups(client, session, globals, obj, work, "delete", deleting));
  }

  private async undeleteBatch(client: PoolClient, session: Session, obj: SObjectDef, work: Work[], globals: Globals): Promise<void> {
    const live = () => work.filter((w) => w.errors.length === 0);
    if (live().length === 0) return;
    // The parent is made live first, so a cascaded child's recompute already sees it; no skip set is needed.
    await this.withRollups(client, obj, work.length, async () => {
      const ids = live().map((w) => w.id as string);
      if (ids.length === 0) return;
      const stamp = { at: formatSalesforceDatetime(new Date()), by: session.userId };
      await this.store.setDeleted(client, obj, ids, false, stamp);
      for (const child of this.schema.childRelationships(obj.name)) {
        if (!child.cascadeDelete) continue;
        const childObj = this.object(child.childSObject);
        const field = this.schema.getField(childObj.name, child.field) as FieldDef;
        const rows = (await this.store.childrenOf(client, childObj, field, ids, true)).filter((r) => r["IsDeleted"] === true);
        if (rows.length === 0) continue;
        const childWork: Work[] = rows.map((r, index) => ({ index, errors: [], changes: {}, next: {}, id: asString(r["Id"]), old: r }));
        await this.undeleteBatch(client, session, childObj, childWork, globals);
      }
      await this.runHooks(session, obj, "undelete", "after", live());
    }, () => this.recomputeRollups(client, session, globals, obj, work, "undelete", NO_IDS));
  }

  // ---------------------------------------------------------------------------------------
  // Hooks

  private async runHooks(session: Session, obj: SObjectDef, operation: DmlOperation, timing: "before" | "after", work: Work[]): Promise<void> {
    if (this.executors.length === 0 || work.length === 0) return;
    const ctx: TriggerContext = {
      sobject: obj,
      operation,
      timing,
      records: operation === "delete" ? [] : work.map((w) => w.next),
      old: work.map((w) => w.old ?? {}),
      session,
      addError: (index, message, field) => {
        work[index]?.errors.push(Errors.customValidation(message, field));
      },
    };
    for (const executor of this.executors) await executor.run(ctx);
  }
}
