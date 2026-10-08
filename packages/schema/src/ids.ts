/**
 * Salesforce record IDs: 15 characters, case-sensitive, base-62; the first three are the
 * object's key prefix. The 18-character form appends a 3-character case-safe checksum so
 * the ID survives case-insensitive systems. Both forms identify the same record.
 */
import { randomInt } from "node:crypto";

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const CHECKSUM_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ012345";
const ID15 = /^[0-9A-Za-z]{15}$/;
const ID18 = /^[0-9A-Za-z]{18}$/;

/** Append the case-safe checksum to a 15-character ID. */
export function toCaseSafeId(id15: string): string {
  if (!ID15.test(id15)) throw new Error(`not a 15-character ID: ${id15}`);
  let suffix = "";
  for (let chunk = 0; chunk < 3; chunk++) {
    let bits = 0;
    for (let i = 0; i < 5; i++) {
      const c = id15.charAt(chunk * 5 + i);
      if (c >= "A" && c <= "Z") bits |= 1 << i;
    }
    suffix += CHECKSUM_ALPHABET.charAt(bits);
  }
  return id15 + suffix;
}

/**
 * Accept a 15- or 18-character ID and return the canonical 18-character form, or undefined
 * when the input is not an ID (wrong length, bad characters, or a checksum that does not
 * match its first 15 characters, compared case-insensitively as Salesforce does).
 */
export function normalizeId(input: string): string | undefined {
  if (ID15.test(input)) return toCaseSafeId(input);
  if (!ID18.test(input)) return undefined;
  const canonical = toCaseSafeId(input.slice(0, 15));
  return canonical.slice(15).toUpperCase() === input.slice(15).toUpperCase() ? canonical : undefined;
}

export function keyPrefixOf(id: string): string {
  return id.slice(0, 3);
}

/**
 * The object a lookup value points at: the target whose key prefix is the Id's first three
 * characters. This is the one rule for polymorphic lookups (Owner -> User|Group, What, Who):
 * the write path's reference check, the formula parent loader and the SOQL compiler's
 * prefix joins all agree on it. Undefined when no target in `targets` has that prefix.
 */
export function matchTargetByPrefix<T extends { readonly keyPrefix: string }>(targets: readonly T[], id: string): T | undefined {
  const prefix = keyPrefixOf(id);
  return targets.find((t) => t.keyPrefix === prefix);
}

function base62(n: number, width: number): string {
  let out = "";
  let v = n;
  for (let i = 0; i < width; i++) {
    out = BASE62.charAt(v % 62) + out;
    v = Math.floor(v / 62);
  }
  return out;
}

let lastMillis = 0;
let counter = randomInt(0, 62 ** 3);

/**
 * Generate a new 18-character ID for the given key prefix. IDs are monotonic within a
 * process (millisecond timestamp + counter), which mirrors Salesforce closely enough that
 * "later record has a greater ID" holds, and a random seed keeps separate processes apart.
 * Layout: prefix(3) + "00" (instance) + timestamp(7) + counter(3).
 *
 * The timestamp is a logical clock: it only moves forward. When the counter wraps inside one
 * millisecond, or the wall clock steps backwards, the timestamp is advanced instead, so a
 * later ID always sorts after an earlier one.
 */
export function generateId(keyPrefix: string): string {
  if (!/^[0-9A-Za-z]{3}$/.test(keyPrefix)) throw new Error(`invalid key prefix: ${keyPrefix}`);
  const now = Date.now();
  if (now > lastMillis) {
    lastMillis = now;
  } else {
    counter = (counter + 1) % 62 ** 3;
    if (counter === 0) lastMillis++;
  }
  return toCaseSafeId(`${keyPrefix}00${base62(lastMillis, 7)}${base62(counter, 3)}`);
}
