import { describe, expect, it } from "vitest";
import { formatDiagnostic, pushDiagnostic, type Diagnostic, type DiagnosticSink, type FormulaFailure, type SkippedItem } from "./diagnostics.js";

const cases: Array<[string, Diagnostic, string]> = [
  [
    "field-type",
    { area: "field-type", kind: "field", field: "Ext__c", message: "objects/Foo__c/fields/Ext__c.field-meta.xml: field type ExternalLookup is not supported yet; field skipped" } satisfies SkippedItem,
    "UNSUPPORTED:field-type objects/Foo__c/fields/Ext__c.field-meta.xml: field type ExternalLookup is not supported yet; field skipped",
  ],
  ["object-kind", { area: "object-kind", kind: "object", object: "Order__e", message: "Order__e skipped" } satisfies SkippedItem, "UNSUPPORTED:object-kind Order__e skipped"],
  ["standard-object", { area: "standard-object", kind: "object", object: "Quote", message: "Quote skipped" } satisfies SkippedItem, "UNSUPPORTED:standard-object Quote skipped"],
  [
    "standard-field",
    { area: "standard-field", kind: "field", object: "Account", field: "Foo", message: "Account.Foo is not in the baseline and was skipped" } satisfies SkippedItem,
    "UNSUPPORTED:standard-field Account.Foo is not in the baseline and was skipped",
  ],
  [
    "reference-target (build)",
    { area: "reference-target", object: "NoSuchObject__c", message: "NoSuchObject__c is referenced but not defined; lookups to it are unchecked" },
    "UNSUPPORTED:reference-target NoSuchObject__c is referenced but not defined; lookups to it are unchecked",
  ],
  ["reference-target (query)", { area: "reference-target", message: "0Xx matches no object in the org schema" }, "UNSUPPORTED:reference-target 0Xx matches no object in the org schema"],
  [
    "rollup-target",
    { area: "rollup-target", kind: "rollup", object: "A__c", field: "X__c", message: "A__c.X__c: child object is unknown; field skipped" } satisfies SkippedItem,
    "UNSUPPORTED:rollup-target A__c.X__c: child object is unknown; field skipped",
  ],
  [
    "rollup-type",
    { area: "rollup-type", kind: "rollup", object: "A__c", field: "X__c", message: "A__c.X__c: type is unsupported; field skipped" } satisfies SkippedItem,
    "UNSUPPORTED:rollup-type A__c.X__c: type is unsupported; field skipped",
  ],
  [
    "rollup-filter",
    { area: "rollup-filter", kind: "rollup", object: "A__c", field: "X__c", message: "A__c.X__c: filter is unsupported; field skipped" } satisfies SkippedItem,
    "UNSUPPORTED:rollup-filter A__c.X__c: filter is unsupported; field skipped",
  ],
  [
    "rollup-cycle",
    { area: "rollup-cycle", kind: "rollup", object: "A__c", field: "X__c", message: "A__c.X__c: roll-up summaries summarise each other in a cycle; field skipped" } satisfies SkippedItem,
    "UNSUPPORTED:rollup-cycle A__c.X__c: roll-up summaries summarise each other in a cycle; field skipped",
  ],
  [
    "schema-drop (column)",
    { area: "schema-drop", object: "Project__c", field: "Code__c", message: "column project__c.code__c is no longer in the metadata; kept (use --force to drop)" },
    "UNSUPPORTED:schema-drop column project__c.code__c is no longer in the metadata; kept (use --force to drop)",
  ],
  [
    "schema-drop (table)",
    { area: "schema-drop", message: "table old_thing is no longer in the metadata; kept (use --force to drop)" },
    "UNSUPPORTED:schema-drop table old_thing is no longer in the metadata; kept (use --force to drop)",
  ],
  [
    "schema-narrow",
    { area: "schema-narrow", object: "Project__c", field: "Code__c", message: "column project__c.code__c is text in the database but integer in the metadata; kept (use --force to convert)" },
    "UNSUPPORTED:schema-narrow column project__c.code__c is text in the database but integer in the metadata; kept (use --force to convert)",
  ],
  [
    "schema-fk",
    {
      area: "schema-fk",
      object: "Case",
      field: "BusinessHoursId",
      message: "foreign key fk_case_businesshoursid not added: case.businesshoursid holds 1 value(s) with no matching row in businesshours; correct or clear them and run orglet up again",
    },
    "UNSUPPORTED:schema-fk foreign key fk_case_businesshoursid not added: case.businesshoursid holds 1 value(s) with no matching row in businesshours; correct or clear them and run orglet up again",
  ],
  [
    "formula (nested prefix)",
    {
      area: "formula",
      what: "formula field Case.X__c",
      message:
        "formula field Case.X__c skipped: UNSUPPORTED:formula polymorphic reference Owner:User.Email needs the Relationship:Object.Field syntax, which the vendored sigha formula parser does not support yet",
    } satisfies FormulaFailure,
    "UNSUPPORTED:formula formula field Case.X__c skipped: UNSUPPORTED:formula polymorphic reference Owner:User.Email needs the Relationship:Object.Field syntax, which the vendored sigha formula parser does not support yet",
  ],
];

describe("formatDiagnostic", () => {
  it.each(cases)("formats %s exactly as the pre-existing warning string", (_name, record, expected) => {
    expect(formatDiagnostic(record)).toBe(expected);
  });
});

describe("pushDiagnostic", () => {
  it("appends the record and its formatted string to the sink in the same order", () => {
    const sink: DiagnosticSink = { warnings: [], diagnostics: [] };
    const a: Diagnostic = { area: "a-area", message: "first" };
    const b: Diagnostic = { area: "b-area", message: "second" };
    pushDiagnostic(sink, a);
    pushDiagnostic(sink, b);
    expect(sink.diagnostics).toEqual([a, b]);
    expect(sink.warnings).toEqual(["UNSUPPORTED:a-area first", "UNSUPPORTED:b-area second"]);
  });
});
