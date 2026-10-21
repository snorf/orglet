# cmdt-check

Phase 11 success criteria 1-4 (custom metadata types, custom settings, MetadataRelationship fields, read-only DML)
checked through jsforce and simple-salesforce against a running orglet. It uses its own SFDX project, not
`examples/acme`, so the `a0x` provisional prefixes and the custom-object counts asserted elsewhere do not move.
All names are invented.

## Files

- `project/` - the SFDX fixture: two `__mdt` types (with an mdt-to-mdt cycle and `EntityDefinition` / `FieldDefinition`
  relationships), a Hierarchy and a List custom setting, a plain custom object, six record files and a `CustomLabels` file.
- `jsforce.mjs` - the jsforce leg (8 checks).
- `sf_cmdt.py` - the simple-salesforce leg (the same 8 checks).

## Running

`conformance/run-all.sh` runs both legs against a second server. By hand:

```bash
node packages/cli/dist/index.js up --project conformance/cmdt-check/project --org-schema cmdt_check --port 8095 --quiet &
BASE_URL=http://localhost:8095 node conformance/cmdt-check/jsforce.mjs
BASE_URL=http://localhost:8095 conformance/describe-check/.venv/bin/python conformance/cmdt-check/sf_cmdt.py
node packages/cli/dist/index.js reset --org-schema cmdt_check --drop-prefixes
```

## Expected facts

- Provisional prefixes on a fresh org: `App_Config__c a00`, `Region_List__c a01`, `Ticket__c a02`, `Support_Tier__mdt m00`, `Tier_Group__mdt m01`.
- Table `Support_Tier__mdt` rows (DeveloperName | MasterLabel | Code__c | Max_Seats__c | Is_Active__c | Region__c | Target_Object__c | Target_Field__c | Tier_Group__c | IsProtected):
  - `Bronze | Bronze | B-1 | null | false | APAC | null | null | null | false`
  - `Gold | Gold | 007 | 50 | true | EMEA | Account | Account.Industry | Id of Tier_Group__mdt.Premium | false`
  - `Silver | Silver Tier | null | 10 | false | null | Ticket__c | Ticket__c.Priority__c | Id of Tier_Group__mdt.Standard | true`
  - Every row: `Label` = MasterLabel, `Language` = `en_US`, `NamespacePrefix` = null, `QualifiedApiName` = DeveloperName.
- Table `Tier_Group__mdt` rows: `Premium | Premium | Sort_Order__c 1 | Default_Tier__c = Id of Support_Tier__mdt.Gold`; `Standard | Standard | Sort_Order__c null | Default_Tier__c = Id of Support_Tier__mdt.Silver`.
- Labels on the schema: `Welcome_Message` (value `Welcome to the support portal`, categories `Portal,Onboarding`) and `Terms_Link_Text` (value `Terms & Conditions <v2>`, protected true); 2 labels.
- Custom settings: `App_Config__c` (Hierarchy, has SetupOwnerId), `Region_List__c` (List).
- The eight expected warnings (as printed after `warning: `):

  ```
  UNSUPPORTED:custom-metadata-record <path>/Retired_Type.Old.md-meta.xml: Retired_Type__mdt is not a custom metadata type in objects/; record Old skipped
  UNSUPPORTED:custom-label welcome_message duplicates Welcome_Message; the first definition is kept
  UNSUPPORTED:custom-metadata-record Support_Tier__mdt.Unknown_Field__c is not a field of Support_Tier__mdt; values dropped (records: Bronze)
  UNSUPPORTED:custom-metadata-record Support_Tier__mdt.Max_Seats__c: values that cannot be stored as Number were stored as null (records: Bronze)
  UNSUPPORTED:custom-metadata-record Support_Tier__mdt.Region__c: values that cannot be stored as Picklist were stored as null (records: Silver)
  UNSUPPORTED:custom-metadata-record Support_Tier__mdt.Tier_Group__c: target Tier_Group__mdt record Missing_Group does not exist; stored as null (records: Bronze)
  UNSUPPORTED:reference-target Support_Tier__mdt.Target_Object__c: EntityDefinition target Solution is not modelled by orglet; stored as null (records: Bronze)
  UNSUPPORTED:reference-target Support_Tier__mdt.Target_Field__c: FieldDefinition target Account.No_Such_Field__c is not modelled by orglet; stored as null (records: Bronze)
  ```

- `orglet check` info line: `info: 2 custom settings loaded without data (custom-setting data is not part of a retrieve): App_Config__c, Region_List__c`.

## Results

| Date | orglet commit | SDK | Result |
|---|---|---|---|
