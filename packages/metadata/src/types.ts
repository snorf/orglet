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
  /** Custom metadata relationship (Metadata API CustomField.type): to another __mdt (stored as that record's Id) or to EntityDefinition/FieldDefinition (stored as the qualified API name, D-06..D-08). Never a Postgres FK. */
  | "MetadataRelationship"
  | "Address"
  | "Location"
  /** Compound person name (Contact/Lead/User `Name`). Components carry `compoundFieldName: "Name"`. */
  | "Name";

/** Metadata API `DeleteConstraint` for lookups. Master-detail always cascades. */
export type DeleteConstraint = "SetNull" | "Restrict" | "Cascade";

export type FormulaBlankTreatment = "BlankAsBlank" | "BlankAsZero";

/** Metadata API `summaryOperation`, normalised to upper case. AVG does not exist for roll-ups. */
export type RollupOperation = "COUNT" | "SUM" | "MIN" | "MAX";

/** The `FilterOperation` values a roll-up filter supports (includes/excludes/within do not apply to roll-ups). */
export type RollupFilterOperation = "equals" | "notEqual" | "lessThan" | "greaterThan" | "lessOrEqual" | "greaterOrEqual" | "contains" | "notContain" | "startsWith";

/** One `summaryFilterItems` entry, resolved against the child object. Several filters are ANDed. */
export interface RollupFilterDef {
  /** Child field API name, canonical casing. */
  field: string;
  operation: RollupFilterOperation;
  /** Tokenised literal(s), OR-ed for equals/contains/startsWith; [] means "blank". Checkbox tokens are "true"/"false". */
  values: string[];
  /** Field-to-field comparison: another field on the same child object, canonical casing. */
  valueField?: string;
}

/** Roll-up summary definition (`type: Summary` in metadata), resolved by buildOrgSchema. */
export interface RollupDef {
  /** Child object API name, canonical casing. */
  childObject: string;
  /** The child's master-detail (or whitelisted lookup) field pointing at the parent. */
  foreignKey: string;
  /** Absent for COUNT. */
  summarizedField?: string;
  operation: RollupOperation;
  filters: RollupFilterDef[];
}

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
  /** Present when `type` is Lookup, MasterDetail or MetadataRelationship. */
  referenceTo?: string[];
  /** Parent-side relationship name used in SOQL, e.g. `Account` for `AccountId`. */
  relationshipName?: string;
  /** Child-side relationship name on the parent, e.g. `Contacts`. */
  childRelationshipName?: string;
  relationshipLabel?: string;
  /** FieldDefinition MetadataRelationship only: the EntityDefinition field on the same custom metadata type whose value names the object of a bare field value (Metadata API metadataRelationshipControllingField, type prefix removed). Never in describe. */
  metadataRelationshipControllingField?: string;
  deleteConstraint?: DeleteConstraint;
  /** MasterDetail only: 0 or 1. */
  relationshipOrder?: number;
  reparentable?: boolean;
  picklist?: PicklistDef;
  /** Formula source. When set the field is calculated and never stored; `type` is the return type. */
  formula?: string;
  formulaTreatBlanksAs?: FormulaBlankTreatment;
  /** Roll-up summary: a stored, read-only column the engine recomputes on child DML. `type` is the resolved result type. */
  rollup?: RollupDef;
  /** Formula-syntax default value expression from metadata (`<defaultValue>`). */
  defaultValue?: string;
  /** AutoNumber display format, e.g. `A-{0000}`. */
  displayFormat?: string;
  /** For components of a compound field: the compound field's API name (e.g. `BillingAddress`, `Name`). */
  compoundFieldName?: string;
  visibleLines?: number;
  inlineHelpText?: string;
  description?: string;
  /** Standard field that exists only when an org feature is enabled (D-09). Never exposed in describe (D-10). */
  featureGated?: boolean;
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

/**
 * Where a standard object's key prefix comes from (D-11). Prefixes are data, never guessed: `doc` (public
 * documentation), `sdk-fixture` (open-source SDK test fixtures), `de-describe` (the author's own Developer
 * Edition describe), `unverified` (no public source; the prefix is null, as describe reports for prefix-less objects).
 */
export type KeyPrefixProvenance = "doc" | "sdk-fixture" | "de-describe" | "unverified";

export interface SObjectDef {
  /** API name, canonical casing. */
  name: string;
  label: string;
  labelPlural: string;
  /** Null when no prefix is confirmed (D-08): such an object is never matched by Id prefix and never mints Ids. */
  keyPrefix: string | null;
  keyPrefixSource?: KeyPrefixProvenance;
  custom: boolean;
  createable: boolean;
  updateable: boolean;
  deletable: boolean;
  undeletable: boolean;
  queryable: boolean;
  searchable: boolean;
  /** Has `OwnerId` (User and/or Group, see StandardObjectJson.ownerTargets). Master-detail children inherit the parent's owner and have none. */
  hasOwner: boolean;
  /** Custom metadata type (__mdt, CMDT-01): read-only through the data API; rows come only from customMetadata/ record files. */
  customMetadata?: true;
  /** Custom setting (CustomObject.customSettingsType, CSET-01): describe customSetting true, no OwnerId; Hierarchy adds SetupOwnerId. */
  customSetting?: "List" | "Hierarchy";
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

/** One record file customMetadata/<Type>.<DeveloperName>.md-meta.xml (CMDT-02). */
export interface CustomMetadataRecord {
  /** Type API name with the __mdt suffix (the file name omits it); canonical casing once buildOrgSchema has matched it. */
  type: string;
  developerName: string;
  /** <label>, which becomes MasterLabel and Label; the DeveloperName when the file has none. */
  label: string;
  protected: boolean;
  /** <values> in file order; value "" means xsi:nil, an empty <value> or no <value> at all, all stored as null (D-05). */
  values: { field: string; value: string }[];
  /** The record file's path, for warnings. */
  file: string;
}

/** One entry of labels/CustomLabels.labels-meta.xml (CSET-02, D-21). Not an sObject; never in describe. */
export interface CustomLabelDef {
  fullName: string;
  value: string;
  language: string;
  /** Comma-separated as written in metadata (Metadata API CustomLabel.categories). */
  categories?: string;
  protected: boolean;
  shortDescription?: string;
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
  /** Custom labels keyed by lower-cased fullName (D-21). */
  labels: ReadonlyMap<string, CustomLabelDef>;
  /** Case-insensitive label lookup by fullName. */
  getLabel(fullName: string): CustomLabelDef | undefined;
  /** Lookup helpers, case-insensitive on API names as in Salesforce. */
  getObject(name: string): SObjectDef | undefined;
  getField(objectName: string, fieldName: string): FieldDef | undefined;
  childRelationships(objectName: string): ChildRelationship[];
  /**
   * Resolve a parent-side relationship name (`Account`, `Owner`, `Project__r`) on an object.
   * For polymorphic lookups `target` is only the first defined target; per-row resolution uses
   * `targets` with the Id's key prefix (`matchTargetByPrefix` in @orglet/schema). `polymorphic` counts
   * defined targets only; callers that must treat a lookup as polymorphic even when some targets are not
   * modelled check `field.referenceTo.length > 1`.
   */
  resolveRelationship(objectName: string, relationshipName: string): { field: FieldDef; target: SObjectDef; targets: SObjectDef[]; polymorphic: boolean } | undefined;
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
  keyPrefix: string | null;
  /** Optional for the existing files; required when keyPrefix is null. */
  keyPrefixSource?: KeyPrefixProvenance;
  createable?: boolean;
  updateable?: boolean;
  deletable?: boolean;
  undeletable?: boolean;
  queryable?: boolean;
  searchable?: boolean;
  hasOwner: boolean;
  /** OwnerId targets when narrower than the default ["User", "Group"] (D-11). Only with hasOwner. */
  ownerTargets?: ("User" | "Group")[];
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
  /** Exists only when an org feature is enabled; always nullable (D-09). Not a describe key (D-10). */
  featureGated?: boolean;
}
