# examples/enterprise

A public, enterprise-shaped fixture for the v1.1 acceptance run (Phase 14). Every name is invented and generic; nothing
comes from a real org. It is a superset of `examples/acme`: the second `packageDirectories` entry pulls in
`../acme/force-app`, so BigTable__c, UpsertTable__c, Project__c, Milestone__c and `Account.Customer_Number__c` are
unchanged and the SDK conformance suites can run against either project.

**orglet-only:** the second `packageDirectories` entry points outside the project root (`../acme/force-app`), which `sf`
tooling may reject. orglet joins each path onto the project root, so it resolves.

```bash
orglet check --strict --project examples/enterprise   # exit 0, no warning: line
```

`packages/cli/src/enterprise.test.ts` pins the category coverage below, so the fixture cannot pass `--strict` by omission.

## Category map

| v1.1 category | Artefact | Phase |
|---|---|---|
| Custom metadata types with MetadataRelationship, EntityDefinition, FieldDefinition | `Service_Level__mdt` (Region__c, Target_Object__c, Target_Field__c), `Service_Region__mdt`, 4 records in `customMetadata/` (one with `xsi:nil`) | 11 |
| Hierarchy custom setting | `Org_Defaults__c` | 11 |
| List custom setting | `Country_Code__c` | 11 |
| Custom labels | `labels/CustomLabels.labels-meta.xml` (`Service_Greeting`, `Support_Hours`) | 11 |
| `$Label`, `$Setup`, `$CustomMetadata`, `$User`, `$UserRole`, `$Organization`, `$Profile`, `$Api` | formula fields on `Service_Order__c`, validation rule `Discount_Within_Cap` | 12 |
| Colon syntax `Owner:User.` / `Owner:Queue.` | `Case.Owner_User_Email__c`, `Case.Owner_Queue_Name__c` (queue-enabled OwnerId) | 12 |
| Unary `!` operator | validation rule `Discount_Within_Cap` | 12 |
| Roll-up over a same-object formula field | `Service_Order__c.Total_Lines__c` sums `Service_Order_Line__c.Line_Total__c` (`Quantity__c * Unit_Price__c`) | 13 |
| Lookups to the 18 business objects | Quote, Order, Location (`Service_Order__c`), OrderItem (`Service_Order_Line__c`); formula `Order.Quote_Name__c` over the standard Order -> Quote lookup | 10 |
| Owner traversal on a User-only object | `Account.Owner_Email__c` (`Owner.Email`; Account OwnerId is User-only) | 9 |
| Feature-gated standard field in a formula | `Account.Gated_Check__c` reads `FirstName` (first feature-gated Account field in code-point order; Text) | 8-9 |
| Nullable key prefixes | covered by unit tests only: no baseline object has a null key prefix, so a public fixture cannot exercise it | 8 |

## Notes

- `$Api.Partner_Server_URL_590` (`Service_Order__c.Api_Endpoint__c`): evaluated outside a request, a `$Api` formula logs
  `UNSUPPORTED:formula-global ... $Api values are blank` once at runtime. `orglet check` never evaluates formulas, so check
  stays clean.
- Custom-setting data is not part of a retrieve, so `check` prints an `info:` line (not a warning) for the two settings.
  Seeding them is done by a separate script (plan 14-05).

## Authored from public documentation

Metadata API Developer Guide pages for CustomObject, CustomField, CustomMetadata, CustomLabels and ValidationRule
(`developer.salesforce.com/docs/atlas.en-us.api_meta.meta/api_meta/`), and the Salesforce Help articles "Global
Variables", "Formula Operators and Functions" and "Roll-Up Summary Field". XML element order follows `examples/acme` and
`conformance/cmdt-check/project`.
