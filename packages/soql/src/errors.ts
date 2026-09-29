/** SOQL errors in the shape the REST API reports them (`[{ message, errorCode }]`, HTTP 400). */
export class SoqlError extends Error {
  constructor(
    readonly errorCode: string,
    message: string,
  ) {
    super(message);
    this.name = "SoqlError";
  }
}

export const malformed = (detail: string): SoqlError => new SoqlError("MALFORMED_QUERY", detail);

export const invalidType = (name: string): SoqlError =>
  new SoqlError("INVALID_TYPE", `\nsObject type '${name}' is not supported. If you are attempting to use a custom object, be sure to append the '__c' after the entity name. Please reference your WSDL or the describe call for the appropriate names.`);

export const invalidField = (field: string, entity: string): SoqlError =>
  new SoqlError(
    "INVALID_FIELD",
    `\nNo such column '${field}' on entity '${entity}'. If you are attempting to use a custom field, be sure to append the '__c' after the custom field name. Please reference your WSDL or the describe call for the appropriate names.`,
  );

export const invalidRelationship = (rel: string, _entity: string): SoqlError =>
  new SoqlError("INVALID_FIELD", `\nDidn't understand relationship '${rel}' in field path. If you are attempting to use a custom relationship, be sure to append the '__r' after the custom relationship name. Please reference your WSDL or the describe call for the appropriate names.`);

export const unsupported = (area: string, detail: string): SoqlError => new SoqlError("UNSUPPORTED", `UNSUPPORTED:${area} ${detail}`);
