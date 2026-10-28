// @orglet/formula: Salesforce formula language bound to record context (evaluator: vendored sigha)
export { compileFormula, FormulaCompileError } from "./compile.js";
export type {
  CompileOptions,
  CompiledFormula,
  CompileWarning,
  CustomMetadataValues,
  FieldReference,
  FormulaContextId,
  FormulaDependencies,
  GlobalRoot,
  MissingField,
  ObjectFieldDependency,
  ReferenceKind,
} from "./compile.js";
export { evaluateCompiled } from "./evaluate.js";
export type { EvaluationContext, FormulaResult } from "./evaluate.js";
export { asString, formatDate, formatDatetime, formatTime, fromSfValue, recordValuesEqual, sfTypeOf, toSfValue } from "./values.js";
export type { RecordData, RecordValue } from "./values.js";
export { dependencyOrder, formulaInputs } from "./rollup-inputs.js";
export type { FormulaInputs, FormulaLookup, OrderableFormula } from "./rollup-inputs.js";
export { admitFormulaRollups } from "./rollup-admission.js";
