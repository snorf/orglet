/**
 * Custom-object key prefixes are assigned once per org and persisted in `_orglet.key_prefixes`.
 * An Id's first three characters identify its object, so a prefix that moved with the object's
 * alphabetical position (which is all buildOrgSchema can offer) would change the meaning of every
 * stored Id the moment a custom object is added or renamed. The planner is pure so every
 * precedence and collision rule is unit-testable; the DB wrapper is a thin
 * read -> scan -> plan -> insert -> mutate transaction around it.
 */
import type { OrgSchema } from "@orglet/metadata";
import { DEFAULT_ORG_SCHEMA, INTERNAL_SCHEMA, quote, tableName } from "./columns.js";
import { withTransaction, type Pool } from "./db.js";
import { ensureInternalSchema } from "./internal.js";

export type KeyPrefixSource = "standard" | "persisted" | "records" | "mapping" | "provisional" | "next-free";

export interface KeyPrefixClaim {
  objectName: string;
  keyPrefix: string;
  source: KeyPrefixSource;
}

/** A contradiction between prefix sources (D-09). `claims` holds every party to the conflict so the CLI can name both objects and both values. */
export class KeyPrefixError extends Error {
  readonly claims: KeyPrefixClaim[];
  constructor(message: string, claims: KeyPrefixClaim[] = []) {
    super(message);
    this.name = "KeyPrefixError";
    this.claims = claims;
  }
}

export interface KeyPrefixPlanInput {
  /** Custom objects in the loaded schema, in name order, with the provisional prefix buildOrgSchema gave them. */
  custom: { name: string; provisional: string }[];
  /** Every standard object's documented prefix (D-03). */
  standard: { name: string; keyPrefix: string }[];
  /** Rows already in _orglet.key_prefixes for this org, keyed by lower-cased object name. */
  persisted: Map<string, { name: string; keyPrefix: string }>;
  /** Distinct left(id, 3) values per existing custom table, keyed by lower-cased object name; only for objects without a row (D-10). */
  observed: Map<string, string[]>;
  /** Parsed --key-prefixes mapping, keyed by lower-cased object name. */
  mapping: Map<string, string>;
}

export interface KeyPrefixAssignment {
  objectName: string;
  keyPrefix: string;
  source: "records" | "mapping" | "provisional" | "next-free";
}

export interface KeyPrefixPlan {
  assignments: KeyPrefixAssignment[];
  warnings: string[];
}

const PREFIX = /^[0-9A-Za-z]{3}$/;
const ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

function sourceLabel(source: KeyPrefixSource): string {
  switch (source) {
    case "records":
      return "existing records";
    case "mapping":
      return "--key-prefixes";
    default:
      return source;
  }
}

function describe(c: KeyPrefixClaim): string {
  switch (c.source) {
    case "standard":
      return `standard object ${c.objectName} (${c.keyPrefix})`;
    case "persisted":
      return `persisted prefix of ${c.objectName} (${c.keyPrefix})`;
    case "records":
      return `existing records of ${c.objectName} (${c.keyPrefix})`;
    case "mapping":
      return `--key-prefixes entry for ${c.objectName} (${c.keyPrefix})`;
    default:
      return `${c.objectName} (${c.keyPrefix})`;
  }
}

/** Lowest prefix in a00..azz not yet taken; same order as buildOrgSchema's provisional scheme. */
function nextFree(taken: Map<string, KeyPrefixClaim>): string {
  for (const hi of ALPHABET) {
    for (const lo of ALPHABET) {
      const candidate = `a${hi}${lo}`;
      if (!taken.has(candidate)) return candidate;
    }
  }
  throw new Error("too many custom objects: no free key prefix in a00..azz");
}

/**
 * Decide a prefix for every custom object without a persisted row. Precedence (D-08): existing
 * records, then the --key-prefixes mapping, then the provisional prefix, then the next free one.
 * Two passes, because a newcomer's provisional prefix may be the one an older object's records
 * already carry: every records/mapping claim is settled before any provisional prefix is handed out.
 */
export function planKeyPrefixes(input: KeyPrefixPlanInput): KeyPrefixPlan {
  const taken = new Map<string, KeyPrefixClaim>();
  for (const s of input.standard) taken.set(s.keyPrefix, { objectName: s.name, keyPrefix: s.keyPrefix, source: "standard" });
  for (const p of input.persisted.values()) taken.set(p.keyPrefix, { objectName: p.name, keyPrefix: p.keyPrefix, source: "persisted" });

  const decided = new Map<string, KeyPrefixAssignment>();

  // Pass 1: claims backed by evidence (records on disk, an explicit mapping).
  for (const { name } of input.custom) {
    const lower = name.toLowerCase();
    if (input.persisted.has(lower)) continue;

    let recordsClaim: KeyPrefixClaim | undefined;
    const values = input.observed.get(lower);
    if (values !== undefined && values.length >= 2) {
      throw new KeyPrefixError(
        `key prefix for ${name} is ambiguous: existing records carry ${values.join(", ")}`,
        values.map((v) => ({ objectName: name, keyPrefix: v, source: "records" })),
      );
    }
    const observedPrefix = values?.[0];
    if (observedPrefix !== undefined) recordsClaim = { objectName: name, keyPrefix: observedPrefix, source: "records" };

    let claim = recordsClaim;
    const m = input.mapping.get(lower);
    if (m !== undefined) {
      const mappingClaim: KeyPrefixClaim = { objectName: name, keyPrefix: m, source: "mapping" };
      if (recordsClaim !== undefined && recordsClaim.keyPrefix !== m) {
        throw new KeyPrefixError(
          `key prefix ${m} for ${name} (from --key-prefixes) contradicts existing records of ${name} (${recordsClaim.keyPrefix})`,
          [mappingClaim, recordsClaim],
        );
      }
      if (recordsClaim === undefined) claim = mappingClaim;
    }

    if (claim === undefined) continue;
    const other = taken.get(claim.keyPrefix);
    if (other !== undefined) {
      throw new KeyPrefixError(`key prefix ${claim.keyPrefix} for ${name} (from ${sourceLabel(claim.source)}) collides with ${describe(other)}`, [claim, other]);
    }
    taken.set(claim.keyPrefix, claim);
    if (claim.source === "records" || claim.source === "mapping") {
      decided.set(lower, { objectName: name, keyPrefix: claim.keyPrefix, source: claim.source });
    }
  }

  // Pass 1b (D-09): a mapping entry for an object that already has a row must agree with it.
  for (const [lower, m] of input.mapping) {
    const p = input.persisted.get(lower);
    if (p === undefined || m === p.keyPrefix) continue;
    throw new KeyPrefixError(`key prefix ${m} for ${p.name} (from --key-prefixes) contradicts persisted prefix of ${p.name} (${p.keyPrefix})`, [
      { objectName: p.name, keyPrefix: m, source: "mapping" },
      { objectName: p.name, keyPrefix: p.keyPrefix, source: "persisted" },
    ]);
  }

  // Pass 2: everything still undecided takes its provisional prefix, or the next free one.
  for (const { name, provisional } of input.custom) {
    const lower = name.toLowerCase();
    if (input.persisted.has(lower) || decided.has(lower)) continue;
    const assignment: KeyPrefixAssignment = taken.has(provisional)
      ? { objectName: name, keyPrefix: nextFree(taken), source: "next-free" }
      : { objectName: name, keyPrefix: provisional, source: "provisional" };
    taken.set(assignment.keyPrefix, { ...assignment });
    decided.set(lower, assignment);
  }

  const assignments: KeyPrefixAssignment[] = [];
  for (const { name } of input.custom) {
    const a = decided.get(name.toLowerCase());
    if (a !== undefined) assignments.push(a);
  }
  return { assignments, warnings: [] };
}

/** Validate a parsed --key-prefixes JSON document against the loaded schema; keys come back in canonical API-name casing. */
export function parseKeyPrefixMapping(raw: unknown, schema: OrgSchema): Record<string, string> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new KeyPrefixError("--key-prefixes: expected a JSON object mapping custom object API names to 3-character prefixes");
  }
  const result: Record<string, string> = {};
  const byPrefix = new Map<string, string>();
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "string" || !PREFIX.test(value)) {
      throw new KeyPrefixError(`--key-prefixes: ${key}: ${JSON.stringify(value)} is not a 3-character alphanumeric key prefix`);
    }
    const obj = schema.getObject(key);
    if (obj === undefined) throw new KeyPrefixError(`--key-prefixes: ${key} is not an object in the loaded metadata`);
    if (!obj.custom) throw new KeyPrefixError(`--key-prefixes: ${key} is a standard object; only custom objects take a mapped prefix`);
    const firstName = byPrefix.get(value);
    if (firstName !== undefined) {
      throw new KeyPrefixError(`--key-prefixes: ${firstName} and ${obj.name} both map to ${value}`, [
        { objectName: firstName, keyPrefix: value, source: "mapping" },
        { objectName: obj.name, keyPrefix: value, source: "mapping" },
      ]);
    }
    byPrefix.set(value, obj.name);
    result[obj.name] = value;
  }
  return result;
}

const TABLE = `${quote(INTERNAL_SCHEMA)}.${quote("key_prefixes")}`;
const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS ${TABLE} (
  org_schema  text        NOT NULL,
  object_name text        NOT NULL,
  key_prefix  char(3)     NOT NULL,
  source      text        NOT NULL,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_schema, object_name),
  UNIQUE (org_schema, key_prefix)
)`;

export interface ReconcileKeyPrefixesOptions {
  orgSchema?: string;
  /** Output of parseKeyPrefixMapping (canonical object names). */
  mapping?: Record<string, string>;
}

export interface ReconcileKeyPrefixesResult {
  /** Rows written this run, in custom-object name order; empty when every custom object already had a row. */
  assignments: KeyPrefixAssignment[];
  warnings: string[];
}

/**
 * Give every custom object in `schema` its persisted key prefix, writing rows for the ones that
 * have none, and set `SObjectDef.keyPrefix` in place so bootstrapOrg, the DML engine and describe
 * all see the persisted value. One transaction: a KeyPrefixError rolls back every row.
 */
export async function reconcileKeyPrefixes(pool: Pool, schema: OrgSchema, options: ReconcileKeyPrefixesOptions = {}): Promise<ReconcileKeyPrefixesResult> {
  const orgSchema = options.orgSchema ?? DEFAULT_ORG_SCHEMA;
  return withTransaction(pool, async (client) => {
    // Lock order is fixed: the constant _orglet lock first, then this org's lock (deadlock-free, D-05).
    await ensureInternalSchema(client);
    await client.query(CREATE_TABLE);
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))", ["orglet.key_prefixes", orgSchema]);

    const all = [...schema.objects.values()];
    const customObjects = all.filter((o) => o.custom).sort((a, b) => a.name.localeCompare(b.name));
    const standard = all.filter((o) => !o.custom).map((o) => ({ name: o.name, keyPrefix: o.keyPrefix }));

    const persistedRows = await client.query<{ object_name: string; key_prefix: string }>(`SELECT object_name, key_prefix FROM ${TABLE} WHERE org_schema = $1`, [orgSchema]);
    const persisted = new Map(persistedRows.rows.map((r) => [r.object_name.toLowerCase(), { name: r.object_name, keyPrefix: r.key_prefix }]));

    const tableRows = await client.query<{ table_name: string }>("SELECT table_name FROM information_schema.tables WHERE table_schema = $1", [orgSchema]);
    const tables = new Set(tableRows.rows.map((r) => r.table_name));

    // Records already on disk are the strongest evidence of an object's prefix (D-08); soft-deleted
    // rows count too, so no WHERE. Only objects without a row and with an existing table are scanned.
    const observed = new Map<string, string[]>();
    for (const obj of customObjects) {
      const lower = obj.name.toLowerCase();
      if (persisted.has(lower) || !tables.has(tableName(obj))) continue;
      const res = await client.query<{ p: string }>(`SELECT DISTINCT left(id, 3) AS p FROM ${quote(orgSchema)}.${quote(tableName(obj))}`);
      observed.set(lower, res.rows.map((r) => r.p));
    }

    const plan = planKeyPrefixes({
      custom: customObjects.map((o) => ({ name: o.name, provisional: o.keyPrefix })),
      standard,
      persisted,
      observed,
      mapping: new Map(Object.entries(options.mapping ?? {}).map(([k, v]) => [k.toLowerCase(), v])),
    });

    for (const a of plan.assignments) {
      await client.query(`INSERT INTO ${TABLE} (org_schema, object_name, key_prefix, source) VALUES ($1, $2, $3, $4)`, [orgSchema, a.objectName, a.keyPrefix, a.source]);
    }

    const assigned = new Map(plan.assignments.map((a) => [a.objectName.toLowerCase(), a.keyPrefix]));
    for (const obj of customObjects) {
      const lower = obj.name.toLowerCase();
      const value = persisted.get(lower)?.keyPrefix ?? assigned.get(lower);
      if (value !== undefined) obj.keyPrefix = value;
    }

    return { assignments: plan.assignments, warnings: plan.warnings };
  });
}

/** Remove one org's prefix rows; safe on a database that never ran `up`, and leaves other orgs' rows and the `_orglet` schema in place (D-07). */
export async function dropKeyPrefixes(pool: Pool, orgSchema: string): Promise<number> {
  const exists = await pool.query<{ t: string | null }>("SELECT to_regclass($1)::text AS t", [`${INTERNAL_SCHEMA}.key_prefixes`]);
  if (exists.rows[0] === undefined || exists.rows[0].t === null) return 0;
  const res = await pool.query(`DELETE FROM ${TABLE} WHERE org_schema = $1`, [orgSchema]);
  return res.rowCount ?? 0;
}
