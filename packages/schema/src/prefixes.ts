/**
 * Custom-object key prefixes are assigned once per org and persisted in `_orglet.key_prefixes`.
 * An Id's first three characters identify its object, so a prefix that moved with the object's
 * alphabetical position (which is all buildOrgSchema can offer) would change the meaning of every
 * stored Id the moment a custom object is added or renamed. The planner is pure so every
 * precedence and collision rule is unit-testable; the DB wrapper is a thin
 * read -> scan -> plan -> insert -> mutate transaction around it.
 */
import type { OrgSchema } from "@orglet/metadata";
import type { Pool } from "./db.js";

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

export interface ReconcileKeyPrefixesOptions {
  orgSchema?: string;
  mapping?: Record<string, string>;
}

export interface ReconcileKeyPrefixesResult {
  /** Rows written this run, in custom-object name order; empty when every custom object already had a row. */
  assignments: KeyPrefixAssignment[];
  warnings: string[];
}

export function reconcileKeyPrefixes(_pool: Pool, _schema: OrgSchema, _options: ReconcileKeyPrefixesOptions = {}): Promise<ReconcileKeyPrefixesResult> {
  return Promise.reject(new Error("not implemented"));
}

export function dropKeyPrefixes(_pool: Pool, _orgSchema: string): Promise<number> {
  return Promise.reject(new Error("not implemented"));
}
