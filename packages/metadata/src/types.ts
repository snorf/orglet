/**
 * Internal representation of an org's metadata: objects, fields, picklists,
 * validation rules and record types. Built from the standard-object baseline
 * (packages/metadata/standard/*.json) merged with an SFDX project on disk.
 *
 * Naming follows the Metadata API where a concept exists there (field `type`
 * values are Metadata API `CustomField.type` names, e.g. "Text", "Lookup") and
 * the REST describe API otherwise (`nillable`, `createable`, `idLookup`, ...).
 */

export type FieldType =
  | "Id"
  | "AutoNumber"
  | "Checkbox"
  | "Currency"
  | "Date"
  | "DateTime"
  | "Time"
  | "Email"
  | "Phone"
  | "Url"
  | "Number"
  | "Percent"
  | "Picklist"
  | "MultiselectPicklist"
  | "Text"
  | "TextArea"
  | "LongTextArea"
  | "Html"
  | "EncryptedText"
  | "Lookup"
  | "MasterDetail"
  | "Address"
  | "Location"
  /** Compound person name (Contact/Lead/User `Name`). Components carry `compoundFieldName: "Name"`. */
  | "Name";

/** Metadata API `DeleteConstraint` for lookups. Master-detail always cascades. */
export type DeleteConstraint = "SetNull" | "Restrict" | "Cascade";

export type FormulaBlankTreatment = "BlankAsBlank" | "BlankAsZero";

export interface PicklistValue {
  value: string;
  label: string;
  default: boolean;
  active: boolean;
  /** OpportunityStage only. */
  probability?: number;
  forecastCategory?: string;
  closed?: boolean;
  won?: boolean;
  /** CaseStatus / LeadStatus: marks a closed / converted status. */
  isClosed?: boolean;
  isConverted?: boolean;
}

export interface PicklistDef {
  restricted: boolean;
  sorted: boolean;
  values: PicklistValue[];
  /** Set when the values come from a GlobalValueSet or StandardValueSet. */
  valueSetName?: string;
}

export interface FieldDef {
  /** API name, e.g. `Name`, `AccountId`, `Foo__c`. Canonical casing. */
  name: string;
  label: string;
  type: FieldType;
  custom: boolean;
  /** Text-like lengths; for Number/Currency/Percent use precision + scale. */
  length?: number;
  /** Total digits (Metadata API `precision`), not the Postgres precision. */
  precision?: number;
  scale?: number;
  /** REST describe semantics: `nillable === false` means required on insert. */
  nillable: boolean;
  createable: boolean;
  updateable: boolean;
  /** System sets a value if the client omits one (Id, OwnerId, CreatedDate, AutoNumber, defaults). */
  defaultedOnCreate: boolean;
  unique: boolean;
  externalId: boolean;
  /** Only meaningful with `unique`/`externalId`: comparison is case-sensitive. */
  caseSensitive: boolean;
  /** Usable as the record identifier in upsert and `sobjects/{T}/{field}/{value}`. */
  idLookup: boolean;
  /** This is the object's `Name` field (or its equivalent, e.g. Case `CaseNumber`). */
  nameField: boolean;
  /** Present when `type` is Lookup or MasterDetail. */
  referenceTo?: string[];
  /** Parent-side relationship name used in SOQL, e.g. `Account` for `AccountId`. */
  relationshipName?: string;
  /** Child-side relationship name on the parent, e.g. `Contacts`. */
  childRelationshipName?: string;
  relationshipLabel?: string;
  deleteConstraint?: DeleteConstraint;
  /** MasterDetail only: 0 or 1. */
  relationshipOrder?: number;
  reparentable?: boolean;
  picklist?: PicklistDef;
  /** Formula source. When set the field is calculated and never stored; `type` is the return type. */
  formula?: string;
  formulaTreatBlanksAs?: FormulaBlankTreatment;
  /** Formula-syntax default value expression from metadata (`<defaultValue>`). */
  defaultValue?: string;
  /** AutoNumber display format, e.g. `A-{0000}`. */
  displayFormat?: string;
  /** For components of a compound field: the compound field's API name (e.g. `BillingAddress`, `Name`). */
  compoundFieldName?: string;
  visibleLines?: number;
  inlineHelpText?: string;
  description?: string;
  /** Standard fields only: docs say the field exists but is read-only or rarely settable. */
  filterable: boolean;
  sortable: boolean;
  groupable: boolean;
}

export interface ValidationRuleDef {
  name: string;
  active: boolean;
  errorConditionFormula: string;
  errorMessage: string;
  errorDisplayField?: string;
  description?: string;
}

export interface RecordTypePicklistValues {
  picklist: string;
  values: { value: string; default: boolean }[];
}

export interface RecordTypeDef {
  name: string;
  label: string;
  active: boolean;
  description?: string;
  picklistValues: RecordTypePicklistValues[];
}

export interface SObjectDef {
  /** API name, canonical casing. */
  name: string;
  label: string;
  labelPlural: string;
  keyPrefix: string;
  custom: boolean;
  createable: boolean;
  updateable: boolean;
  deletable: boolean;
  undeletable: boolean;
  queryable: boolean;
  searchable: boolean;
  /** Has `OwnerId` (User/Group). Master-detail children inherit the parent's owner and have none. */
  hasOwner: boolean;
  /** Metadata API `sharingModel`; ignored by the engine in phase 0. */
  sharingModel?: string;
  fields: FieldDef[];
  validationRules: ValidationRuleDef[];
  recordTypes: RecordTypeDef[];
}

export interface StandardValueSetDef {
  name: string;
  sorted: boolean;
  values: PicklistValue[];
}

export interface GlobalValueSetDef {
  name: string;
  label: string;
  sorted: boolean;
  values: PicklistValue[];
}

/** Derived child relationship, computed from lookup/master-detail fields. */
export interface ChildRelationship {
  childSObject: string;
  field: string;
  relationshipName: string | undefined;
  cascadeDelete: boolean;
  restrictedDelete: boolean;
}

export interface OrgSchema {
  objects: ReadonlyMap<string, SObjectDef>;
  globalValueSets: ReadonlyMap<string, GlobalValueSetDef>;
  standardValueSets: ReadonlyMap<string, StandardValueSetDef>;
  /** Lookup helpers, case-insensitive on API names as in Salesforce. */
  getObject(name: string): SObjectDef | undefined;
  getField(objectName: string, fieldName: string): FieldDef | undefined;
  childRelationships(objectName: string): ChildRelationship[];
}

/**
 * On-disk shape of packages/metadata/standard/objects/<Name>.json.
 * Everything not listed defaults as documented on the field; the system fields
 * (Id, IsDeleted, CreatedDate, CreatedById, LastModifiedDate, LastModifiedById,
 * SystemModstamp, and OwnerId when `hasOwner`) are added by the loader and must
 * not be listed.
 */
export interface StandardObjectJson {
  name: string;
  label: string;
  labelPlural: string;
  keyPrefix: string;
  createable?: boolean;
  updateable?: boolean;
  deletable?: boolean;
  undeletable?: boolean;
  queryable?: boolean;
  searchable?: boolean;
  hasOwner: boolean;
  fields: StandardFieldJson[];
}

export interface StandardFieldJson {
  name: string;
  label: string;
  type: FieldType;
  length?: number;
  precision?: number;
  scale?: number;
  /** Defaults to true (optional). */
  nillable?: boolean;
  /** Defaults to true. */
  createable?: boolean;
  /** Defaults to true. */
  updateable?: boolean;
  defaultedOnCreate?: boolean;
  unique?: boolean;
  externalId?: boolean;
  caseSensitive?: boolean;
  idLookup?: boolean;
  nameField?: boolean;
  referenceTo?: string[];
  relationshipName?: string;
  childRelationshipName?: string;
  deleteConstraint?: DeleteConstraint;
  /** Name of a StandardValueSet whose values populate this picklist. */
  standardValueSet?: string;
  /** Inline picklist values when no StandardValueSet exists for the field. */
  picklistValues?: { value: string; label?: string; default?: boolean }[];
  restrictedPicklist?: boolean;
  formula?: string;
  defaultValue?: string;
  displayFormat?: string;
  compoundFieldName?: string;
  filterable?: boolean;
  sortable?: boolean;
  groupable?: boolean;
  description?: string;
}
