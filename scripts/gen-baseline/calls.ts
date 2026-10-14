/**
 * The Object Reference states object-level DML support only as a "Supported Calls" line. This module is the one
 * tokeniser shared by the manual snapshot step and the offline generator, so both agree on the vocabulary.
 */

export const KNOWN_SUPPORTED_CALLS: readonly string[] = [
  "create",
  "delete",
  "describeLayout",
  "describeSObjects",
  "getDeleted",
  "getUpdated",
  "query",
  "retrieve",
  "search",
  "undelete",
  "update",
  "upsert",
];

const CALL = /([A-Za-z]+)\(\)/g;

/** Tokens of the first "Supported Calls" block in one TOC-bounded section, sorted and unique; undefined when the section has none. */
export function parseSupportedCalls(lines: readonly string[]): string[] | undefined {
  const label = lines.findIndex((l) => l.trim() === "Supported Calls");
  if (label < 0) return undefined;
  const block: string[] = [];
  for (let i = label + 1; i < lines.length; i++) {
    const t = (lines[i] ?? "").trim();
    if (t === "") break;
    block.push(t);
  }
  // Tokenise on `name()`, not on commas: the PDF sometimes drops a comma (ContentDocument) or prints calls out of order (FeedItem).
  const found = [...block.join(" ").matchAll(CALL)].map((m) => m[1] as string);
  if (found.length === 0) throw new Error("Supported Calls label without any call");
  const unknown = found.filter((c) => !KNOWN_SUPPORTED_CALLS.includes(c));
  if (unknown.length > 0) throw new Error(`unknown Supported Call(s) ${[...new Set(unknown)].join(", ")}`);
  return [...new Set(found)].sort();
}
