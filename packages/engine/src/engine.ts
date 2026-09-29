/**
 * The save pipeline: Salesforce's documented order of execution for insert, update, upsert,
 * delete and undelete, minus Apex and Flow (which plug in through TriggerExecutor).
 *
 * Per call: one transaction; each record is written under its own savepoint so partial
 * success works, and allOrNone rolls the whole call back.
 */
import type { FieldDef, OrgSchema, SObjectDef } from "@orglet/metadata";
import { DEFAULT_ORG_SCHEMA, formatSalesforceDatetime, generateId, keyPrefixOf, type Pool, type PoolClient } from "@orglet/schema";
import { asString, evaluateCompiled, type EvaluationContext, type RecordData } from "@orglet/formula";
import { coerceRecord, coerceValue } from "./coerce.js";
import { Errors, failure, unknownSObject, type SaveError, type SaveResult } from "./errors.js";
import { ChangeBus, type ChangeEvent, type ChangeType } from "./events.js";
import { applyCompoundFields, applyFormulaFields, FormulaRegistry } from "./formulas.js";
import type { DmlOperation, Session, TriggerContext, TriggerExecutor } from "./hooks.js";
import { loadParents } from "./parents.js";
import { formatAutoNumber, Store } from "./store.js";

export interface EngineOptions {
  orgSchema?: string;
  executors?: TriggerExecutor[];
}

export interface DmlOptions {
  allOrNone?: boolean;
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

const isPgUniqueViolation = (err: unknown): err is { code: string; constraint?: string } =>
  typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";

export class DmlEngine {
  readonly store: Store;
  readonly formulas: FormulaRegistry;
  readonly bus = new ChangeBus();
  readonly executors: TriggerExecutor[];
  readonly orgSchema: string;

  constructor(
    readonly pool: Pool,
    readonly schema: OrgSchema,
    options: EngineOptions = {},
  ) {
    this.orgSchema = options.orgSchema ?? DEFAULT_ORG_SCHEMA;
    this.store = new Store(schema, this.orgSchema);
    this.formulas = new FormulaRegistry(schema);
    this.executors = options.executors ?? [];
  }

  get warnings(): string[] {
    return this.formulas.warnings;
  }

  object(name: string): SObjectDef {
    const obj = this.schema.getObject(name);
    if (!obj) throw unknownSObject(name);
    return obj;
  }

  // ---------------------------------------------------------------------------------------
  // Public DML

  async insert(session: Session, sobject: string, inputs: Record<string, unknown>[], options: DmlOptions = {}): Promise<SaveResult[]> {
    const obj = this.object(sobject);
    if (!obj.createable) return inputs.map(() => failure([Errors.invalidOperation(`entity type ${obj.name} does not support insert`)]));
    return this.run(session, obj, "insert", options, async (client, globals) => {
      const work = inputs.map((input, index) => this.prepareInsert(obj, input, index));
      await this.saveBatch(client, session, obj, "insert", work, globals);
      return work;
    });
  }

  async update(session: Session, sobject: string, inputs: Record<string, unknown>[], options: DmlOptions = {}): Promise<SaveResult[]> {
    const obj = this.object(sobject);
    if (!obj.updateable) return inputs.map(() => failure([Errors.invalidOperation(`entity type ${obj.name} does not support update`)]));
    return this.run(session, obj, "update", options, async (client, globals) => {
      const work = inputs.map((input, index) => this.prepareUpdate(obj, input, index));
      await this.attachOld(client, obj, work);
      await this.saveBatch(client, session, obj, "update", work, globals);
      return work;
    });
  }

  async upsert(session: Session, sobject: string, externalIdField: string, inputs: Record<string, unknown>[], options: DmlOptions = {}): Promise<SaveResult[]> {
    const obj = this.object(sobject);
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
          const w: Work = { index, errors: [coerced.error ?? Errors.requiredMissing([extField.name])], changes: {}, next: {} };
          all.push(w);
          continue;
        }
        const matches = extField.name === "Id" ? [...(await this.store.loadByIds(client, obj, [String(coerced.value)])).values()] : await this.store.findByField(client, obj, extField, coerced.value);
        if (matches.length > 1) {
          const w: Work = { index, errors: [Errors.invalidOperation(`Duplicate external id specified: ${String(coerced.value)}`)], changes: {}, next: {} };
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
    if (!obj.deletable) return ids.map(() => failure([Errors.invalidOperation(`entity type ${obj.name} does not support delete`)]));
    return this.run(session, obj, "delete", options, async (client, globals) => {
      const work = ids.map((raw, index) => this.prepareId(obj, raw, index));
      await this.attachOld(client, obj, work);
      await this.deleteBatch(client, session, obj, work, globals);
      return work;
    });
  }

  async undelete(session: Session, sobject: string, ids: string[], options: DmlOptions = {}): Promise<SaveResult[]> {
    const obj = this.object(sobject);
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
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const globals = await this.loadGlobals(client, session);
      const work = await body(client, globals);
      work.sort((a, b) => a.index - b.index);
      const failed = work.some((w) => w.errors.length > 0);
      if (allOrNone && failed) {
        await client.query("ROLLBACK");
        results = work.map((w) => {
          if (w.errors.length > 0) return failure(w.errors);
          const r: SaveResult = { success: false, errors: [Errors.rolledBack()] };
          if (w.id) r.id = w.id;
          return r;
        });
        return results;
      }
      await client.query("COMMIT");
      results = work.map((w) => {
        if (w.errors.length > 0) return failure(w.errors);
        const r: SaveResult = { success: true, errors: [] };
        if (w.id) r.id = w.id;
        if (w.created !== undefined) r.created = w.created;
        return r;
      });
      events.push(...this.eventsFor(obj, operation, work, session));
    } catch (err) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw err;
    } finally {
      client.release();
    }
    await this.bus.publish(events);
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
    const coerced = coerceRecord(obj, input, "insert", (n) => this.schema.getField(obj.name, n));
    return { index, errors: coerced.errors, changes: coerced.values, next: { ...coerced.values } };
  }

  private prepareUpdate(obj: SObjectDef, input: Record<string, unknown>, index: number): Work {
    const coerced = coerceRecord(obj, input, "update", (n) => this.schema.getField(obj.name, n));
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
        w.id = generateId(obj.keyPrefix);
        w.next = { ...(await this.defaults(client, obj, w.changes, session, globals)), ...w.changes };
        Object.assign(w.next, { Id: w.id, IsDeleted: false, CreatedDate: now, CreatedById: session.userId, LastModifiedDate: now, LastModifiedById: session.userId, SystemModstamp: now });
        if (obj.hasOwner && w.next["OwnerId"] === undefined) w.next["OwnerId"] = session.userId;
      } else {
        w.next = { ...(w.old ?? {}), ...w.changes, LastModifiedDate: now, LastModifiedById: session.userId, SystemModstamp: now };
      }
    }

    // Before hooks may change `next`; anything they touch counts as a change.
    await this.runHooks(session, obj, operation, "before", work.filter((w) => w.errors.length === 0));
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
    await this.checkReferences(client, obj, live());

    // Custom validation rules.
    const rules = this.formulas.validationRules(obj);
    if (rules.length > 0) {
      const candidates = live();
      const rows = candidates.map((w) => ({ ...w.next }));
      await loadParents(client, this.store, obj, rows, this.formulas.parentPaths(obj, ["rules"]));
      candidates.forEach((w, i) => {
        const ctx: EvaluationContext = { record: rows[i] as RecordData, isNew: operation === "insert", ...globals, ...(w.old ? { old: w.old } : {}) };
        for (const { rule, compiled } of rules) {
          const result = evaluateCompiled(compiled, ctx);
          // A rule that errors at runtime blocks the save, like the platform does.
          if (result.value === true || result.error !== undefined) w.errors.push(Errors.customValidation(rule.errorMessage, rule.errorDisplayField));
        }
      });
    }

    // Write, one savepoint per record so a unique violation only fails that record.
    for (const w of live()) {
      await client.query(`SAVEPOINT rec`);
      try {
        if (operation === "insert") await this.store.insert(client, obj, w.next);
        else await this.store.update(client, obj, w.id as string, { ...w.changes, LastModifiedDate: now, LastModifiedById: session.userId, SystemModstamp: now });
        await client.query(`RELEASE SAVEPOINT rec`);
      } catch (err) {
        await client.query(`ROLLBACK TO SAVEPOINT rec`);
        if (!isPgUniqueViolation(err)) throw err;
        w.errors.push(await this.duplicateError(client, obj, w, err.constraint));
      }
    }

    await this.runHooks(session, obj, operation, "after", live());
  }

  private async defaults(client: PoolClient, obj: SObjectDef, changes: RecordData, session: Session, globals: Globals): Promise<RecordData> {
    const out: RecordData = {};
    for (const field of obj.fields) {
      if (changes[field.name] !== undefined && changes[field.name] !== null) continue;
      if (field.type === "AutoNumber") {
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
        const target = targets.find((t) => t.keyPrefix === keyPrefixOf(id));
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
    const field = obj.fields.find((f) => f.unique && constraint?.endsWith(f.name.toLowerCase()));
    if (!field) return Errors.duplicateValue(constraint ?? "unique", "");
    const value = w.next[field.name];
    const rows = value === undefined || typeof value === "object" ? [] : await this.store.findByField(client, obj, field, value);
    return Errors.duplicateValue(field.name, asString(rows[0]?.["Id"]));
  }

  // ---------------------------------------------------------------------------------------
  // Delete / undelete

  private async deleteBatch(client: PoolClient, session: Session, obj: SObjectDef, work: Work[], globals: Globals): Promise<void> {
    const live = () => work.filter((w) => w.errors.length === 0);
    await this.runHooks(session, obj, "delete", "before", live());
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
        await this.deleteBatch(client, session, childObj, childWork, globals);
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
  }

  private async undeleteBatch(client: PoolClient, session: Session, obj: SObjectDef, work: Work[], globals: Globals): Promise<void> {
    const live = () => work.filter((w) => w.errors.length === 0);
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
