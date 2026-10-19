/**
 * The design-spike answers of Phase 9 as data and small pure functions: SOAP/Object Reference type tokens to orglet
 * `FieldType`, property tokens to describe flags, the text-length precedence (D-05), the compound-address part rule and
 * the label humaniser. Every result carries a provenance tag so pipeline.ts can report what came from both sources,
 * from one, or was guessed. Nothing here reads files or knows about v1.0 pins: pins and overrides are layered on top
 * in pipeline.ts.
 */
import type { FieldType, StandardFieldJson } from "@orglet/metadata";
import { GeneratorError } from "./errors.js";
import type { SourceField } from "./sources.js";

/** Where a fact came from. `verified` means both sources state it and agree (they are not independent, see research). */
export type Provenance = "verified" | "sdk-only" | "doc-only" | "guessed";

export interface Fact<T> {
  value: T;
  provenance: Provenance;
}

type TypeRule =
  | { kind: "field"; type: FieldType; precision?: number; scale?: number; guessed?: boolean; readOnly?: boolean }
  | { kind: "textarea" }
  | { kind: "double" }
  | { kind: "reference" }
  | { kind: "skip"; reason: "system" | "unsupported" };

/** Lower-cased source type token -> rule. Unknown tokens abort: a new Salesforce type is a conscious table addition. */
export const TYPE_MAP: Readonly<Record<string, TypeRule>> = {
  string: { kind: "field", type: "Text" },
  textarea: { kind: "textarea" },
  picklist: { kind: "field", type: "Picklist" },
  // Salesforce combobox = picklist that also accepts free text (Event/Task Subject); Picklist is the nearest FieldType.
  combobox: { kind: "field", type: "Picklist" },
  multipicklist: { kind: "field", type: "MultiselectPicklist" },
  boolean: { kind: "field", type: "Checkbox" },
  int: { kind: "field", type: "Number", precision: 18, scale: 0, guessed: true },
  double: { kind: "double" },
  currency: { kind: "field", type: "Currency", precision: 18, scale: 2 },
  percent: { kind: "field", type: "Percent", precision: 5, scale: 2, guessed: true },
  date: { kind: "field", type: "Date" },
  datetime: { kind: "field", type: "DateTime" },
  time: { kind: "field", type: "Time" },
  phone: { kind: "field", type: "Phone" },
  url: { kind: "field", type: "Url" },
  email: { kind: "field", type: "Email" },
  reference: { kind: "reference" },
  address: { kind: "field", type: "Address", readOnly: true },
  id: { kind: "skip", reason: "system" },
  junctionidlist: { kind: "skip", reason: "unsupported" },
  base64: { kind: "skip", reason: "unsupported" },
  anytype: { kind: "skip", reason: "unsupported" },
  complexvalue: { kind: "skip", reason: "unsupported" },
  location: { kind: "skip", reason: "unsupported" },
  // Phase 10 tokens. CaseMilestone.TimeRemainingInHrs/Mins print "text".
  text: { kind: "field", type: "Text" },
  // sf-skills spells it timeOnly; mapType lower-cases.
  timeonly: { kind: "field", type: "Time" },
  // ContentVersion.ContentSizeLong.
  long: { kind: "field", type: "Number", precision: 18, scale: 0, guessed: true },
  // Location.
  integer: { kind: "field", type: "Number", precision: 18, scale: 0, guessed: true },
  // QuoteLineItem.Status: a picklist whose values depend on another field.
  "dynamic picklist": { kind: "field", type: "Picklist" },
};

export interface MappedType {
  type: FieldType;
  precision?: number;
  scale?: number;
  /** Address compounds are read-only in the API. */
  createable?: false;
  updateable?: false;
  /** precision/scale (or nothing) had to be guessed because neither source states them. */
  guessed: boolean;
}

export type TypeMapping = MappedType | { skip: "system" | "unsupported"; sourceType: string };

export const TEXT_TOKENS: ReadonlySet<string> = new Set(["string", "phone", "url", "email", "textarea", "text"]);

export function isTextType(type: FieldType): boolean {
  return type === "Text" || type === "TextArea" || type === "LongTextArea" || type === "Phone" || type === "Url" || type === "Email";
}

/**
 * Map one source type token. `length` decides TextArea vs LongTextArea; `relationshipType` (Object Reference) decides
 * Lookup vs MasterDetail. AutoNumber, Name, Html and EncryptedText are never derived: only pins/overrides produce them.
 */
export function mapType(object: string, name: string, token: string, context: { length?: number; relationshipType?: string }): TypeMapping {
  const rule = TYPE_MAP[token.toLowerCase()];
  if (!rule) throw new GeneratorError(`${object}.${name}: unknown source type ${JSON.stringify(token)}; add it to TYPE_MAP in scripts/gen-baseline/typemap.ts`);
  switch (rule.kind) {
    case "skip":
      return { skip: rule.reason, sourceType: token };
    case "textarea":
      return { type: (context.length ?? 255) <= 255 ? "TextArea" : "LongTextArea", guessed: false };
    case "double":
      // v1.0 geolocation convention: 18,15 for latitude/longitude parts; other doubles have no documented scale.
      return /(Latitude|Longitude)$/.test(name) ? { type: "Number", precision: 18, scale: 15, guessed: true } : { type: "Number", precision: 18, scale: 6, guessed: true };
    case "reference":
      return { type: context.relationshipType === "master-detail" ? "MasterDetail" : "Lookup", guessed: false };
    case "field": {
      const out: MappedType = { type: rule.type, guessed: rule.guessed ?? false };
      if (rule.precision !== undefined) out.precision = rule.precision;
      if (rule.scale !== undefined) out.scale = rule.scale;
      if (rule.readOnly) {
        out.createable = false;
        out.updateable = false;
      }
      return out;
    }
  }
}

/** Flag keys whose value is written only when `false` (the loader defaults them to true). */
export const NEGATIVE_FLAGS = ["createable", "updateable", "nillable"] as const;
/** Flag keys written only when `true`, keyed by the property token with spaces removed and lower-cased. */
const POSITIVE_FLAGS: Readonly<Record<string, keyof StandardFieldJson>> = {
  defaultedoncreate: "defaultedOnCreate",
  defaultedoncreateorfilter: "defaultedOnCreate",
  unique: "unique",
  idlookup: "idLookup",
  namefield: "nameField",
  casesensitive: "caseSensitive",
  externalid: "externalId",
  restrictedpicklist: "restrictedPicklist",
};
const NEGATIVE_TOKENS: Readonly<Record<string, (typeof NEGATIVE_FLAGS)[number]>> = { create: "createable", update: "updateable", nillable: "nillable" };

/** Property tokens -> describe flags. Absence of Create/Update/Nillable means false; undefined tokens mean "no facts". */
export function flagsFrom(tokens: readonly string[] | undefined): Partial<StandardFieldJson> {
  const out: Partial<StandardFieldJson> = {};
  if (tokens === undefined) return out;
  const present = new Set(tokens.map((t) => t.replace(/\s+/g, "").toLowerCase()));
  for (const [token, key] of Object.entries(NEGATIVE_TOKENS)) if (!present.has(token)) out[key] = false;
  for (const [token, key] of Object.entries(POSITIVE_FLAGS)) if (present.has(token)) (out as Record<string, unknown>)[key] = true;
  return out;
}

/** The sf-skills `field_reference.length` when that entry is text-typed (it also reports 18 for ids and 255 for picklists). */
export function sfTextLength(field: SourceField): number | undefined {
  const type = field.sf?.referenceType;
  return field.sf?.length !== undefined && type !== undefined && TEXT_TOKENS.has(type.toLowerCase()) ? field.sf.length : undefined;
}

/**
 * Text length precedence (D-05): sf-skills `field_reference.length` (only when that entry is itself text-typed; it
 * also reports 18 for ids and 255 for picklists) beats the Object Reference maximum, except for textarea where
 * `field_reference` reports the UI length and the documented maximum wins. Neither -> 255, guessed.
 */
export function lengthFor(field: SourceField, token: string): Fact<number> | undefined {
  const lower = token.toLowerCase();
  if (!TEXT_TOKENS.has(lower)) return undefined;
  const sfLength = sfTextLength(field);
  const docLength = field.doc?.maxLength;
  if (sfLength !== undefined && docLength !== undefined && sfLength === docLength) return { value: sfLength, provenance: "verified" };
  const [first, second]: [Fact<number> | undefined, Fact<number> | undefined] =
    lower === "textarea"
      ? [docLength === undefined ? undefined : { value: docLength, provenance: "doc-only" }, sfLength === undefined ? undefined : { value: sfLength, provenance: "sdk-only" }]
      : [sfLength === undefined ? undefined : { value: sfLength, provenance: "sdk-only" }, docLength === undefined ? undefined : { value: docLength, provenance: "doc-only" }];
  return first ?? second ?? { value: 255, provenance: "guessed" };
}

const ADDRESS_PARTS = ["Street", "City", "State", "PostalCode", "Country", "Latitude", "Longitude", "GeocodeAccuracy", "StateCode", "CountryCode"];

/** `BillingCity` -> `BillingAddress` when `BillingAddress` is an address field of the same object. */
export function compoundParent(name: string, addressFields: ReadonlySet<string>): string | undefined {
  for (const part of ADDRESS_PARTS) {
    if (name.endsWith(part) && name.length > part.length) {
      const parent = `${name.slice(0, -part.length)}Address`;
      if (addressFields.has(parent)) return parent;
    }
  }
  return undefined;
}

/** Label fallback when `field_reference` has none: split camel case, keep acronym runs, trailing `Id` -> `ID`. */
export function humanise(name: string): string {
  const base = name.endsWith("Id") && name.length > 2 ? name.slice(0, -2) : name;
  const words = base
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/_/g, " ")
    .trim();
  return base === name ? words : `${words} ID`;
}
