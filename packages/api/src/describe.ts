/**
 * Global and per-object describe JSON in the shape of the REST API `sobjects` resources.
 */
import type { FieldDef, OrgSchema, SObjectDef } from "@orglet/metadata";

type Json = Record<string, unknown>;

function describeType(f: FieldDef): string {
  switch (f.type) {
    case "Id":
      return "id";
    case "Text":
    case "AutoNumber":
    case "Name":
      return "string";
    case "TextArea":
    case "LongTextArea":
    case "Html":
      return "textarea";
    case "Checkbox":
      return "boolean";
    case "Number":
      return (f.scale ?? 0) === 0 && !f.custom ? "int" : "double";
    case "Currency":
      return "currency";
    case "Percent":
      return "percent";
    case "Date":
      return "date";
    case "DateTime":
      return "datetime";
    case "Time":
      return "time";
    case "Email":
      return "email";
    case "Phone":
      return "phone";
    case "Url":
      return "url";
    case "Picklist":
      return "picklist";
    case "MultiselectPicklist":
      return "multipicklist";
    case "Lookup":
    case "MasterDetail":
      return "reference";
    case "Address":
      return "address";
    case "Location":
      return "location";
    case "EncryptedText":
      return "encryptedstring";
  }
}

function soapType(t: string): string {
  switch (t) {
    case "id":
    case "reference":
      return "tns:ID";
    case "boolean":
      return "xsd:boolean";
    case "int":
      return "xsd:int";
    case "double":
    case "currency":
    case "percent":
      return "xsd:double";
    case "date":
      return "xsd:date";
    case "datetime":
      return "xsd:dateTime";
    case "time":
      return "xsd:time";
    case "address":
      return "urn:address";
    case "location":
      return "urn:location";
    default:
      return "xsd:string";
  }
}

function extraTypeInfo(f: FieldDef): string | null {
  switch (f.type) {
    case "LongTextArea":
      return "plaintextarea";
    case "Html":
      return "richtextarea";
    case "Name":
      return "personname";
    case "Url":
      return f.name === "PhotoUrl" ? "imageurl" : null;
    default:
      return null;
  }
}

export function describeField(schema: OrgSchema, obj: SObjectDef, f: FieldDef): Json {
  const type = describeType(f);
  const numeric = f.type === "Number" || f.type === "Currency" || f.type === "Percent";
  const textual = ["string", "textarea", "email", "phone", "url", "picklist", "multipicklist", "encryptedstring"].includes(type);
  const length = textual ? (f.length ?? 255) : type === "id" || type === "reference" ? 18 : 0;
  const cascade = f.deleteConstraint === "Cascade";
  const child = f.referenceTo ? schema.childRelationships(f.referenceTo[0] ?? "").find((c) => c.childSObject === obj.name && c.field === f.name) : undefined;
  return {
    aggregatable: !["textarea", "address", "location"].includes(type),
    aiPredictionField: false,
    autoNumber: f.type === "AutoNumber",
    byteLength: textual ? length * 3 : 0,
    calculated: f.formula !== undefined || f.rollup !== undefined,
    calculatedFormula: f.formula ?? null,
    cascadeDelete: cascade,
    caseSensitive: f.caseSensitive,
    compoundFieldName: f.compoundFieldName ?? null,
    controllerName: null,
    createable: f.createable,
    custom: f.custom,
    defaultValue: f.type === "Checkbox" ? f.defaultValue === "true" : null,
    defaultValueFormula: f.type === "Checkbox" ? null : (f.defaultValue ?? null),
    defaultedOnCreate: f.defaultedOnCreate,
    dependentPicklist: false,
    deprecatedAndHidden: false,
    digits: type === "int" ? (f.precision ?? 0) : 0,
    displayLocationInDecimal: false,
    encrypted: false,
    externalId: f.externalId,
    extraTypeInfo: extraTypeInfo(f),
    filterable: f.filterable,
    filteredLookupInfo: null,
    groupable: f.groupable,
    highScaleNumber: false,
    htmlFormatted: f.type === "Html",
    idLookup: f.idLookup,
    inlineHelpText: f.inlineHelpText ?? null,
    label: f.label,
    length,
    mask: null,
    maskType: null,
    name: f.name,
    nameField: f.nameField,
    namePointing: f.name === "OwnerId" || (f.referenceTo?.length ?? 0) > 1,
    nillable: f.nillable,
    permissionable: !["Id", "IsDeleted", "CreatedDate", "CreatedById", "LastModifiedDate", "LastModifiedById", "SystemModstamp", "OwnerId"].includes(f.name) && !f.nameField,
    picklistValues: (f.picklist?.values ?? []).map((v) => ({ active: v.active, defaultValue: v.default, label: v.label, validFor: null, value: v.value })),
    polymorphicForeignKey: (f.referenceTo?.length ?? 0) > 1,
    precision: numeric ? (f.precision ?? 18) : 0,
    queryByDistance: f.type === "Location",
    referenceTargetField: null,
    referenceTo: f.referenceTo ?? [],
    relationshipName: f.relationshipName ?? null,
    relationshipOrder: f.relationshipOrder ?? null,
    restrictedDelete: f.deleteConstraint === "Restrict",
    restrictedPicklist: f.picklist?.restricted ?? false,
    scale: numeric ? (f.scale ?? 0) : 0,
    searchPrefilterable: false,
    soapType: soapType(type),
    sortable: f.sortable,
    type,
    unique: f.unique,
    updateable: f.updateable,
    writeRequiresMasterRead: f.type === "MasterDetail" ? false : null,
    // Documented for completeness; not part of describe but harmless.
    childRelationshipName: child?.relationshipName ?? undefined,
  };
}

function sobjectUrls(obj: SObjectDef, version: string): Json {
  const base = `/services/data/v${version}/sobjects/${obj.name}`;
  return {
    compactLayouts: `${base}/describe/compactLayouts`,
    rowTemplate: `${base}/{ID}`,
    approvalLayouts: `${base}/describe/approvalLayouts`,
    describe: `${base}/describe`,
    quickActions: `${base}/quickActions`,
    layouts: `${base}/describe/layouts`,
    sobject: base,
  };
}

function objectSummary(obj: SObjectDef, version: string): Json {
  return {
    activateable: false,
    associateEntityType: null,
    associateParentEntity: null,
    createable: obj.createable,
    custom: obj.custom,
    customSetting: false,
    deepCloneable: false,
    deletable: obj.deletable,
    deprecatedAndHidden: false,
    feedEnabled: false,
    hasSubtypes: false,
    idEnabled: true,
    isInterface: false,
    isSubtype: false,
    keyPrefix: obj.keyPrefix,
    label: obj.label,
    labelPlural: obj.labelPlural,
    layoutable: true,
    mergeable: ["Account", "Contact", "Lead"].includes(obj.name),
    mruEnabled: true,
    name: obj.name,
    queryable: obj.queryable,
    replicateable: true,
    retrieveable: true,
    searchable: obj.searchable,
    triggerable: true,
    undeletable: obj.undeletable,
    updateable: obj.updateable,
    urls: sobjectUrls(obj, version),
  };
}

export function globalDescribe(schema: OrgSchema, version: string): Json {
  const objects = [...schema.objects.values()].sort((a, b) => a.name.localeCompare(b.name));
  return { encoding: "UTF-8", maxBatchSize: 200, sobjects: objects.map((o) => objectSummary(o, version)) };
}

export function basicInfo(obj: SObjectDef, version: string): Json {
  return { objectDescribe: objectSummary(obj, version), recentItems: [] };
}

export function objectDescribe(schema: OrgSchema, obj: SObjectDef, version: string, recordTypeIds: ReadonlyMap<string, string>): Json {
  const recordTypeInfos = obj.recordTypes.map((rt) => {
    const id = recordTypeIds.get(`${obj.name}.${rt.name}`.toLowerCase()) ?? "";
    return {
      active: rt.active,
      available: rt.active,
      defaultRecordTypeMapping: obj.recordTypes[0] === rt,
      developerName: rt.name,
      master: false,
      name: rt.label,
      recordTypeId: id,
      urls: { layout: `/services/data/v${version}/sobjects/${obj.name}/describe/layouts/${id}` },
    };
  });
  const fields = obj.fields.map((f) => {
    const d = describeField(schema, obj, f);
    delete d["childRelationshipName"];
    return d;
  });
  return {
    ...objectSummary(obj, version),
    actionOverrides: [],
    childRelationships: schema.childRelationships(obj.name).map((c) => ({
      cascadeDelete: c.cascadeDelete,
      childSObject: c.childSObject,
      deprecatedAndHidden: false,
      field: c.field,
      junctionIdListNames: [],
      junctionReferenceTo: [],
      relationshipName: c.relationshipName ?? null,
      restrictedDelete: c.restrictedDelete,
    })),
    compactLayoutable: true,
    dataTranslationEnabled: null,
    defaultImplementation: null,
    extendedBy: null,
    extendsInterfaces: null,
    fields,
    implementedBy: null,
    implementsInterfaces: null,
    listviewable: null,
    lookupLayoutable: null,
    namedLayoutInfos: [],
    networkScopeFieldName: null,
    recordTypeInfos,
    searchLayoutable: true,
    sobjectDescribeOption: "FULL",
    supportedScopes: [{ label: "All " + obj.labelPlural.toLowerCase(), name: "everything" }, { label: "My " + obj.labelPlural.toLowerCase(), name: "mine" }],
  };
}
