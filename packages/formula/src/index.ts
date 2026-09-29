// @orglet/formula: Salesforce formula language bound to record context (evaluator: vendored sigha)
export { compileFormula, FormulaCompileError } from "./compile.js";
export type { CompileOptions, CompiledFormula, FieldReference, FormulaContextId, ReferenceKind } from "./compile.js";
export { evaluateCompiled } from "./evaluate.js";
export type { EvaluationContext, FormulaResult } from "./evaluate.js";
export { formatDate, formatDatetime, formatTime, fromSfValue, recordValuesEqual, sfTypeOf, toSfValue } from "./values.js";
export type { RecordData, RecordValue } from "./values.js";
