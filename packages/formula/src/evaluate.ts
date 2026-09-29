import { bool, evaluateFormula, isError, UnsupportedError, type SfValue } from "@orglet/sigha";
import type { CompiledFormula, FieldReference } from "./compile.js";
import { fromSfValue, recordValuesEqual, toSfValue, type RecordData, type RecordValue } from "./values.js";

export interface EvaluationContext {
  /** The record as it will be saved (new values), with parents nested by relationship name. */
  record: RecordData;
  /** The record before this change; undefined on insert. */
  old?: RecordData;
  isNew: boolean;
  user?: RecordData;
  profile?: RecordData;
  organization?: RecordData;
  recordType?: RecordData;
  /** Clock for TODAY()/NOW(); defaults to the real clock. */
  now?: Date;
}

export interface FormulaResult {
  value: RecordValue;
  /**
   * Set when the formula did not produce a value: Salesforce's `#Error!` (division by zero,
   * invalid date...) or `UNSUPPORTED:<construct>` when the evaluator refuses a construct.
   */
  error?: string;
}

function lookup(data: RecordData | undefined, path: string[]): RecordValue | RecordData | undefined {
  let current: RecordValue | RecordData | undefined = data;
  for (const segment of path) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = current[segment];
  }
  return current;
}

function globalRecord(ctx: EvaluationContext, global: string): RecordData | undefined {
  switch (global) {
    case "$User":
      return ctx.user;
    case "$Profile":
      return ctx.profile;
    case "$Organization":
      return ctx.organization;
    case "$RecordType":
      return ctx.recordType;
    default:
      return undefined;
  }
}

function valueFor(ref: FieldReference, ctx: EvaluationContext): SfValue {
  switch (ref.kind) {
    case "field":
      return toSfValue(lookup(ctx.record, ref.path), ref.type);
    case "global":
      return toSfValue(lookup(globalRecord(ctx, ref.global ?? ""), ref.path), ref.type);
    case "prior":
      // Documented: PRIORVALUE returns the current value while the record is being created.
      return toSfValue(ctx.isNew || !ctx.old ? lookup(ctx.record, ref.path) : lookup(ctx.old, ref.path), ref.type);
    case "changed":
      if (ctx.isNew || !ctx.old) return bool(false);
      return bool(!recordValuesEqual(lookup(ctx.old, ref.path), lookup(ctx.record, ref.path)));
    case "isNew":
      return bool(ctx.isNew);
  }
}

export function evaluateCompiled(compiled: CompiledFormula, ctx: EvaluationContext): FormulaResult {
  const fields = new Map<string, SfValue>();
  for (const ref of compiled.references) {
    fields.set(ref.key, valueFor(ref, ctx));
  }
  try {
    const result = evaluateFormula(compiled.ast, {
      fields,
      blankMode: compiled.blankMode,
      now: { epochMillis: (ctx.now ?? new Date()).getTime() },
    });
    if (isError(result)) return { value: null, error: result.reason };
    return { value: fromSfValue(result) };
  } catch (err) {
    if (err instanceof UnsupportedError) return { value: null, error: `UNSUPPORTED:formula-function ${err.functionName}` };
    throw err;
  }
}
