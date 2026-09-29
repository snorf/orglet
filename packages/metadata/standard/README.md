# Standard object baseline

One JSON file per standard object, shape `StandardObjectJson` in `src/types.ts`.
A retrieve from a real org only contains *customisations* of standard objects, so the
standard fields themselves must be known up front. They are transcribed from the public
Salesforce Object Reference (https://developer.salesforce.com/docs/atlas.en-us.object_reference.meta/object_reference/).

Rules:
- Do not list the system fields `Id`, `IsDeleted`, `CreatedDate`, `CreatedById`,
  `LastModifiedDate`, `LastModifiedById`, `SystemModstamp`, or `OwnerId`; the loader adds them.
- `nillable`, `createable`, `updateable` default to `true`; set them only when `false`.
- Lookups: `referenceTo` + `relationshipName` (parent side) + `childRelationshipName`
  (the name the parent uses for the child list, e.g. `Contacts` on Account).
- Picklists backed by a StandardValueSet name it in `standardValueSet`; the values live in
  `standard/standardValueSets.json`.
- Compound fields: list the compound field with type `Address`/`Name` and each component
  with `compoundFieldName` set.
- Skip fields that only exist when a feature is enabled (Person Accounts, Data.com,
  Territory Management, Knowledge, Omni-Channel, Field Service, Social, Chatter Answers).
