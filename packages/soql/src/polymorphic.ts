/**
 * The Name pseudo-object (Object Reference, "Name"): without TYPEOF, a polymorphic parent such as
 * Owner or What exposes exactly these fields, each read from the row's concrete object. User-only
 * fields hold a value only when the parent is a User, even if another target has a same-named
 * column (Group.Email).
 */
import type { FieldDef } from "@orglet/metadata";

export interface NameObjectField {
  name: string;
  userOnly: boolean;
}

export const NAME_OBJECT_FIELDS: ReadonlyMap<string, NameObjectField> = new Map(
  (
    [
      ["Id", false],
      ["Alias", true],
      ["Email", true],
      ["FirstName", false],
      ["IsActive", true],
      ["LastName", false],
      ["LastReferencedDate", false],
      ["LastViewedDate", false],
      ["MiddleName", false],
      ["Name", false],
      ["Phone", true],
      ["Profile", true],
      ["ProfileId", true],
      ["Suffix", false],
      ["Title", false],
      ["Type", false],
      ["Username", true],
      ["UserRole", true],
      ["UserRoleId", true],
    ] as const
  ).map(([name, userOnly]) => [name.toLowerCase(), { name, userOnly }]),
);

/** A text field that exists on no table: Owner.Type, or a Name field no target has. */
export function pseudoField(name: string): FieldDef {
  return { name, label: name, type: "Text", custom: false, nillable: true, createable: false, updateable: false, defaultedOnCreate: false, unique: false, externalId: false, caseSensitive: false, idLookup: false, nameField: false, filterable: true, sortable: true, groupable: true };
}
