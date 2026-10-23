/**
 * Compiles every validation rule, formula field and default-value expression in the schema
 * once, and computes read-time projections (formula and compound fields) on rows.
 */
import { formatDiagnostic, pushDiagnostic, type FieldDef, type FormulaFailure, type OrgSchema, type SObjectDef, type ValidationRuleDef } from "@orglet/metadata";
import { compileFormula, evaluateCompiled, FormulaCompileError, type CompiledFormula, type CustomMetadataValues, type EvaluationContext, type FormulaDependencies, type GlobalRoot, type RecordData, type RecordValue } from "@orglet/formula";

import type { CustomMetadataPlan } from "./seed.js";

export interface CompiledRule {
  rule: ValidationRuleDef;
  compiled: CompiledFormula;
}

export interface CompiledField {
  field: FieldDef;
  compiled: CompiledFormula;
}

export class FormulaRegistry {
  readonly warnings: string[] = [];
  /** Structured form of `warnings`, same order (D-15). */
  readonly diagnostics: FormulaFailure[] = [];
  private readonly rules = new Map<string, CompiledRule[]>();
  private readonly fields = new Map<string, CompiledField[]>();
  private readonly defaults = new Map<string, CompiledFormula>();
  /** Global roots read by any compiled rule, formula field or default; lets loaders skip globals nothing uses. */
  private readonly globalsUsed = new Set<GlobalRoot>();

  /** Lower-cased type -> lower-cased DeveloperName -> values, for `$CustomMetadata` references. */
  private readonly customMetadataValues: CustomMetadataValues | undefined;

  constructor(
    readonly schema: OrgSchema,
    customMetadata?: CustomMetadataPlan,
  ) {
    this.customMetadataValues = customMetadata
      ? new Map(customMetadata.types.map((t) => [t.object.name.toLowerCase(), new Map(t.rows.map((row) => [row.developerName.toLowerCase(), row.values]))]))
      : undefined;
    for (const obj of schema.objects.values()) {
      const key = obj.name.toLowerCase();
      this.rules.set(
        key,
        obj.validationRules
          .filter((r) => r.active)
          .flatMap((rule) => {
            const compiled = this.tryCompile(rule.errorConditionFormula, obj, "validation_rule", `validation rule ${obj.name}.${rule.name}`, undefined);
            return compiled ? [{ rule, compiled }] : [];
          }),
      );
      this.fields.set(
        key,
        obj.fields
          .filter((f) => f.formula !== undefined)
          .flatMap((field) => {
            const compiled = this.tryCompile(field.formula ?? "", obj, "formula_field", `formula field ${obj.name}.${field.name}`, field.name, field.formulaTreatBlanksAs);
            return compiled ? [{ field, compiled }] : [];
          }),
      );
      for (const field of obj.fields) {
        if (field.defaultValue === undefined || field.formula !== undefined) continue;
        const compiled = this.tryCompile(field.defaultValue, obj, "default_value", `default value ${obj.name}.${field.name}`, field.name);
        if (compiled) this.defaults.set(`${key}.${field.name.toLowerCase()}`, compiled);
      }
    }
  }

  private tryCompile(source: string, obj: SObjectDef, context: "validation_rule" | "formula_field" | "default_value", what: string, field: string | undefined, treatBlanksAs?: "BlankAsBlank" | "BlankAsZero"): CompiledFormula | undefined {
    try {
      const compiled = compileFormula(source, { schema: this.schema, objectName: obj.name, context, ...(treatBlanksAs ? { treatBlanksAs } : {}), ...(this.customMetadataValues ? { customMetadata: this.customMetadataValues } : {}) });
      for (const g of compiled.dependencies.globals) this.globalsUsed.add(g);
      // One structured diagnostic per compile warning keeps warnings == diagnostics.map(formatDiagnostic) (D-15).
      for (const w of compiled.warnings) {
        pushDiagnostic(this, { area: w.area, what, object: obj.name, ...(field !== undefined ? { field } : {}), message: `${what} ${w.message}` } satisfies FormulaFailure);
      }
      return compiled;
    } catch (err) {
      if (err instanceof FormulaCompileError) {
        const failure: FormulaFailure = {
          area: "formula",
          what,
          object: obj.name,
          ...(field !== undefined ? { field } : {}),
          ...(err.missing !== undefined ? { missing: err.missing } : {}),
          message: `${what} skipped: ${err.message}`,
        };
        this.diagnostics.push(failure);
        this.warnings.push(formatDiagnostic(failure));
        return undefined;
      }
      throw err;
    }
  }

  validationRules(obj: SObjectDef): CompiledRule[] {
    return this.rules.get(obj.name.toLowerCase()) ?? [];
  }

  formulaFields(obj: SObjectDef): CompiledField[] {
    return this.fields.get(obj.name.toLowerCase()) ?? [];
  }

  defaultValue(obj: SObjectDef, field: FieldDef): CompiledFormula | undefined {
    return this.defaults.get(`${obj.name.toLowerCase()}.${field.name.toLowerCase()}`);
  }

  /** Dependency list of a formula field on `obj` (name case-insensitive), or undefined when it is not a compiled formula field. */
  fieldDependencies(obj: SObjectDef, fieldName: string): FormulaDependencies | undefined {
    const wanted = fieldName.toLowerCase();
    return this.formulaFields(obj).find((f) => f.field.name.toLowerCase() === wanted)?.compiled.dependencies;
  }

  /** Dependency list of an active validation rule on `obj`, or undefined when it is unknown or did not compile. */
  ruleDependencies(obj: SObjectDef, ruleName: string): FormulaDependencies | undefined {
    return this.validationRules(obj).find((r) => r.rule.name === ruleName)?.compiled.dependencies;
  }

  /** True when any compiled rule, formula field or default value reads the global root. */
  usesGlobal(root: GlobalRoot): boolean {
    return this.globalsUsed.has(root);
  }

  /** Parent paths any validation rule or formula field on `obj` needs loaded. */
  parentPaths(obj: SObjectDef, kinds: ("rules" | "fields")[]): string[][] {
    const out = new Map<string, string[]>();
    const sources = [...(kinds.includes("rules") ? this.validationRules(obj).map((r) => r.compiled) : []), ...(kinds.includes("fields") ? this.formulaFields(obj).map((f) => f.compiled) : [])];
    for (const c of sources) for (const p of c.parentPaths) out.set(p.join("."), p);
    return [...out.values()];
  }
}

/** Compute formula fields onto `record` (parents must already be attached). */
export function applyFormulaFields(registry: FormulaRegistry, obj: SObjectDef, record: RecordData, ctx: Omit<EvaluationContext, "record" | "isNew">): void {
  for (const { field, compiled } of registry.formulaFields(obj)) {
    record[field.name] = evaluateCompiled(compiled, { ...ctx, record, isNew: false }).value;
  }
}

/** Build compound values (`BillingAddress`, `Name`) from their stored components. */
export function applyCompoundFields(obj: SObjectDef, record: RecordData): void {
  for (const field of obj.fields) {
    if (field.type === "Address") {
      const prefix = field.name.replace(/Address$/, "");
      const component = (suffix: string): RecordValue => {
        const f = obj.fields.find((c) => c.compoundFieldName === field.name && c.name.toLowerCase() === `${prefix}${suffix}`.toLowerCase());
        const v = f ? record[f.name] : undefined;
        return v === undefined || typeof v === "object" ? null : v;
      };
      const address = {
        city: component("City"),
        country: component("Country"),
        geocodeAccuracy: component("GeocodeAccuracy"),
        latitude: component("Latitude"),
        longitude: component("Longitude"),
        postalCode: component("PostalCode"),
        state: component("State"),
        street: component("Street"),
      };
      record[field.name] = Object.values(address).every((v) => v === null) ? null : (address);
    } else if (field.type === "Name") {
      const parts = ["FirstName", "LastName"].map((n) => record[n]).filter((v): v is string => typeof v === "string" && v !== "");
      record[field.name] = parts.length > 0 ? parts.join(" ") : null;
    } else if (field.type === "Location") {
      record[field.name] = null;
    }
  }
}
