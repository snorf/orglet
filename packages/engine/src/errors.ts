/**
 * Salesforce-shaped DML errors. `statusCode` values are the documented StatusCode enum
 * members; messages follow the platform's wording where it is documented or well known.
 */
export interface SaveError {
  statusCode: string;
  message: string;
  fields: string[];
  /** DUPLICATE_EXTERNAL_ID only: the records that matched. */
  matchingIds?: string[];
}

export interface SaveResult {
  id?: string;
  success: boolean;
  errors: SaveError[];
  /** Upsert only. */
  created?: boolean;
}

export function saveError(statusCode: string, message: string, fields: string[] = []): SaveError {
  return { statusCode, message, fields };
}

export function failure(errors: SaveError[]): SaveResult {
  return { success: false, errors };
}

export const Errors = {
  requiredMissing: (fields: string[]) => saveError("REQUIRED_FIELD_MISSING", `Required fields are missing: [${fields.join(", ")}]`, fields),
  stringTooLong: (label: string, field: string, value: string, max: number) =>
    saveError("STRING_TOO_LONG", `${label}: data value too large: ${value} (max length=${max})`, [field]),
  invalidType: (label: string, field: string, value: unknown) =>
    saveError("INVALID_TYPE_ON_FIELD_IN_RECORD", `${label}: value not of required type: ${String(value)}`, [field]),
  restrictedPicklist: (label: string, field: string, value: string) =>
    saveError("INVALID_OR_NULL_FOR_RESTRICTED_PICKLIST", `${label}: bad value for restricted picklist field: ${value}`, [field]),
  malformedId: (label: string, field: string, value: unknown) =>
    saveError("MALFORMED_ID", `${label}: id value of incorrect type: ${String(value)}`, [field]),
  invalidCrossReference: (field: string) => saveError("INVALID_CROSS_REFERENCE_KEY", "invalid cross reference id", [field]),
  entityDeleted: () => saveError("ENTITY_IS_DELETED", "entity is deleted"),
  notFound: () => saveError("NOT_FOUND", "The requested resource does not exist"),
  invalidField: (field: string, sobject: string) => saveError("INVALID_FIELD", `No such column '${field}' on sobject of type ${sobject}`, [field]),
  notWritable: (fields: string[]) =>
    saveError(
      "INVALID_FIELD_FOR_INSERT_UPDATE",
      `Unable to create/update fields: ${fields.join(", ")}. Please check the security settings of this field and verify that it is read/write for your profile or permission set.`,
      fields,
    ),
  duplicateValue: (field: string, existingId: string) =>
    saveError("DUPLICATE_VALUE", `duplicate value found: ${field} duplicates value on record with id: ${existingId}`, [field]),
  customValidation: (message: string, field?: string) =>
    saveError("FIELD_CUSTOM_VALIDATION_EXCEPTION", message, field ? [field] : []),
  deleteRestricted: (name: string, childLabelPlural: string, childIds: string[]) =>
    saveError(
      "DELETE_FAILED",
      `Your attempt to delete ${name} could not be completed because it is associated with the following ${childLabelPlural}.: ${childIds.join(", ")}`,
    ),
  rolledBack: () =>
    saveError("ALL_OR_NONE_OPERATION_ROLLED_BACK", "Record rolled back because not all records were valid and the request was using AllOrNone header"),
  missingId: () => saveError("MISSING_ARGUMENT", "Id not specified in an update call"),
  duplicateExternalId: (field: string, value: string, ids: string[]): SaveError => ({
    statusCode: "DUPLICATE_EXTERNAL_ID",
    message: `Duplicate external id specified: ${value}`,
    fields: [field],
    matchingIds: ids,
  }),
  invalidOperation: (message: string) => saveError("INVALID_OPERATION", message),
  /** The sObject's createable/updateable/deletable/undeletable flag forbids the call (SOAP API StatusCode table). */
  invalidTypeForOperation: (message: string) => saveError("INVALID_TYPE_FOR_OPERATION", message),
  unsupported: (area: string, message: string) => saveError("UNSUPPORTED", `UNSUPPORTED:${area} ${message}`),
};

/** A whole-request failure (unknown object, bad arguments), mapped to an HTTP status by the API layer. */
export class DmlError extends Error {
  constructor(
    readonly statusCode: string,
    message: string,
    readonly httpStatus = 400,
    readonly fields: string[] = [],
  ) {
    super(message);
    this.name = "DmlError";
  }
}

export function unknownSObject(name: string): DmlError {
  return new DmlError("NOT_FOUND", `The requested resource does not exist`, 404, [name]);
}
