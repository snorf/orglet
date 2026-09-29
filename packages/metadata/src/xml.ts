import { XMLParser } from "fast-xml-parser";

/** Elements that may repeat inside Salesforce metadata XML and must always parse as arrays. */
const REPEATED = new Set([
  "value",
  "values",
  "customValue",
  "standardValue",
  "picklistValues",
  "referenceTo",
  "valueSettings",
  "controllingFieldValue",
  "validationRules",
  "fields",
  "recordTypes",
]);

const parser = new XMLParser({
  ignoreAttributes: true,
  ignoreDeclaration: true,
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => REPEATED.has(name),
});

export type XmlNode = Record<string, unknown>;

/** Parse a metadata XML document and return the single root element's content. */
export function parseMetadataXml(xml: string, expectedRoot: string): XmlNode {
  const doc = parser.parse(xml) as Record<string, unknown>;
  const root = doc[expectedRoot];
  if (root === undefined || root === null || typeof root !== "object") {
    throw new Error(`Expected <${expectedRoot}> root element, found: ${Object.keys(doc).join(", ") || "nothing"}`);
  }
  return root as XmlNode;
}

export function str(node: XmlNode, key: string): string | undefined {
  const v = node[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v === "string") return v;
  if (typeof v === "object" && Object.keys(v).length === 0) return ""; // <tag/> or <tag></tag>
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return undefined;
}

export function bool(node: XmlNode, key: string): boolean | undefined {
  const v = str(node, key);
  if (v === undefined) return undefined;
  return v === "true";
}

export function num(node: XmlNode, key: string): number | undefined {
  const v = str(node, key);
  if (v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function list(node: XmlNode, key: string): XmlNode[] {
  const v = node[key];
  if (v === undefined || v === null) return [];
  if (Array.isArray(v)) return v as XmlNode[];
  return [v as XmlNode];
}

export function child(node: XmlNode, key: string): XmlNode | undefined {
  const v = node[key];
  if (v === undefined || v === null || typeof v !== "object" || Array.isArray(v)) return undefined;
  return v as XmlNode;
}
