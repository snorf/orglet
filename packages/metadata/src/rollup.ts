/**
 * Roll-up summary resolution helpers. Metadata writes roll-up references as dotted `Child.Field`
 * strings and filter values as comma lists with optional double quotes; these helpers turn them
 * into the canonical pieces the resolver (buildOrgSchema) checks against the schema.
 */

/** Split `Child__c.Field__c`; anything but exactly one dot is not a roll-up reference. */
export function splitRollupRef(ref: string): { object: string; field: string } | undefined {
  const parts = ref.split(".");
  if (parts.length !== 2) return undefined;
  const [object = "", field = ""] = parts;
  return object !== "" && field !== "" ? { object, field } : undefined;
}

/** Split a filter value on commas outside double quotes; trim; strip enclosing quotes; drop empty tokens. [] means blank. */
export function tokenizeFilterValue(raw: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of raw) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === "," && !inQuotes) {
      tokens.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  tokens.push(current);
  return tokens
    .map((t) => {
      const trimmed = t.trim();
      return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1).trim() : trimmed;
    })
    .filter((t) => t !== "");
}
