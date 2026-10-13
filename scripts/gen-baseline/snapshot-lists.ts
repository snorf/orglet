/**
 * Reviewed lists shared by the Object Reference snapshot step (snapshot-pdf.ts) and its committed-extraction
 * sanity test. Pure data: every entry carries a reason so the review of a re-snapshot is a diff of this file
 * plus the facts JSON, nothing else.
 */

/** Property tokens the Object Reference prints, exactly as printed. An unknown token fails the snapshot run. */
export const KNOWN_PROPERTY_TOKENS: readonly string[] = [
  "Aggregate",
  "Autonumber",
  "Create",
  "Defaulted on create",
  "Defaulted on create or filter",
  "Delete",
  "Filter",
  "Group",
  "Layout",
  "Namefield",
  "Nillable",
  "Query",
  "Restricted picklist",
  "Retrieve",
  "Search",
  "Sort",
  "Undelete",
  "Update",
  "aggregate",
  "idLookup",
];

/** object -> field -> reason: sf-skills `fields` entries the PDF extraction does not find. */
export const KNOWN_GAPS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  Profile: {
    Permissions: "placeholder for the per-permission boolean family (Permissions<Name>), not a field; the PDF prints it as PermissionsPermissionName",
  },
};

/**
 * object -> field -> reason: fields only the PDF documents (not in sf-skills `fields`, `field_reference` or
 * `ispersonaccount_fields`) that carry no gating keyword and were reviewed by hand.
 */
export const DOC_ONLY_REVIEWED: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  BusinessProcess: {
    Description: "no sf-skills file for BusinessProcess (missing upstream); the PDF section 'Business Process' is the only source",
    IsActive: "no sf-skills file for BusinessProcess (missing upstream); the PDF section 'Business Process' is the only source",
    Name: "no sf-skills file for BusinessProcess (missing upstream); the PDF section 'Business Process' is the only source",
    NamespacePrefix: "no sf-skills file for BusinessProcess (missing upstream); the PDF section 'Business Process' is the only source",
    TableEnumOrId: "no sf-skills file for BusinessProcess (missing upstream); the PDF section 'Business Process' is the only source",
  },
  Organization: {
    PreferencesPublicSectorTaxRevEnabled: "org preference boolean documented in the PDF but newer than the sf-skills pin; no feature keyword in its prose",
  },
  Profile: {
    PermissionsPermissionName: "placeholder name for the per-permission boolean family, not a field; the generator must skip it",
  },
};

/** object -> reason: objects.json names the Object Reference has no section for. */
export const NOT_IN_PDF: Readonly<Record<string, string>> = {};
