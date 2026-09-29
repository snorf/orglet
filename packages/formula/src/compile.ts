/**
 * Compiles a Salesforce formula against an OrgSchema: parses and type-checks it with sigha,
 * resolves every field reference (including parent paths and `$User`-style globals) to a
 * FieldDef, and rewrites the record-state functions PRIORVALUE, ISCHANGED and ISNEW into
 * synthetic field references that evaluate.ts fills in from the record context. The
 * vendored evaluator is never modified.
 */
import type { FieldDef, OrgSchema } from "@orglet/metadata";
import { analyze, parse, type Diagnostic, type Expr, type FieldRef, type FunctionCall, type SfType } from "@orglet/sigha";
import { sfTypeOf } from "./values.js";

export type FormulaContextId = "formula_field" | "validation_rule" | "default_value";

export interface CompileOptions {
  schema: OrgSchema;
  /** Object the formula lives on. */
  objectName: string;
  context: FormulaContextId;
  /** Metadata `formulaTreatBlanksAs`; only formula fields have the toggle. */
  treatBlanksAs?: "BlankAsBlank" | "BlankAsZero";
}

export type ReferenceKind = "field" | "prior" | "changed" | "isNew" | "global";

export interface FieldReference {
  /** Key used in the evaluator's field map: the rewritten path joined with ".". */
  key: string;
  kind: ReferenceKind;
  /** Canonical path from the record: `["Account", "Name"]`. Empty for `isNew`. */
  path: string[];
  /** Global root for `kind: "global"`: `$User`, `$Profile`, `$Organization`, `$RecordType`. */
  global?: string;
  field?: FieldDef;
  type: SfType;
}

export interface CompiledFormula {
  source: string;
  objectName: string;
  context: FormulaContextId;
  blankMode: "zero" | "blank";
  ast: Expr;
  references: FieldReference[];
  /** Relationship paths (excluding the leaf field) that must be loaded before evaluation. */
  parentPaths: string[][];
  /** True when PRIORVALUE, ISCHANGED or ISNEW is used, i.e. the old record is needed. */
  usesRecordState: boolean;
  diagnostics: Diagnostic[];
}

export class FormulaCompileError extends Error {
  constructor(
    message: string,
    readonly diagnostics: Diagnostic[] = [],
  ) {
    super(message);
    this.name = "FormulaCompileError";
  }
}

const FATAL_CODES = new Set<Diagnostic["code"]>(["unknown-function", "wrong-arity", "function-not-available"]);

const GLOBAL_OBJECTS: Record<string, string> = {
  $user: "User",
  $profile: "Profile",
  $organization: "Organization",
  $recordtype: "RecordType",
};

interface Resolver {
  schema: OrgSchema;
  objectName: string;
  references: Map<string, FieldReference>;
  usesRecordState: boolean;
}

function fieldNotFound(name: string): FormulaCompileError {
  return new FormulaCompileError(`Field ${name} does not exist. Check spelling.`);
}

/** Resolve a dotted path from `objectName` and return the canonical path and leaf field. */
function resolvePath(schema: OrgSchema, objectName: string, path: readonly string[]): { path: string[]; field: FieldDef } {
  let current = schema.getObject(objectName);
  if (!current) throw new FormulaCompileError(`Object ${objectName} does not exist`);
  const canonical: string[] = [];
  for (let i = 0; i < path.length; i++) {
    const segment = path[i] ?? "";
    const last = i === path.length - 1;
    if (last) {
      const field = schema.getField(current.name, segment);
      if (!field) throw fieldNotFound(path.join("."));
      canonical.push(field.name);
      return { path: canonical, field };
    }
    const resolved = schema.resolveRelationship(current.name, segment);
    if (resolved === undefined) throw fieldNotFound(path.join("."));
    if (resolved === "polymorphic") {
      throw new FormulaCompileError(`UNSUPPORTED:formula-polymorphic ${path.join(".")}: polymorphic relationship ${segment} cannot be traversed`);
    }
    canonical.push(resolved.field.relationshipName ?? segment);
    current = resolved.target;
  }
  throw fieldNotFound(path.join("."));
}

function register(r: Resolver, ref: FieldReference): FieldRef {
  r.references.set(ref.key, ref);
  return { kind: "FieldRef", path: ref.key.split("."), isGlobal: ref.key.startsWith("$"), span: { start: 0, end: 0 } };
}

function rewriteFieldRef(node: FieldRef, r: Resolver): Expr {
  const root = node.path[0] ?? "";
  if (node.isGlobal || root.startsWith("$")) {
    if (root.toLowerCase() === "$system") return node; // $System.OriginDateTime is a constant in the evaluator
    const objectName = GLOBAL_OBJECTS[root.toLowerCase()];
    if (!objectName) throw new FormulaCompileError(`UNSUPPORTED:formula-global ${node.path.join(".")} is not available`);
    const resolved = resolvePath(r.schema, objectName, node.path.slice(1));
    const globalName = `$${objectName}`;
    const key = [globalName, ...resolved.path].join(".");
    return register(r, { key, kind: "global", path: resolved.path, global: globalName, field: resolved.field, type: sfTypeOf(resolved.field) });
  }
  const resolved = resolvePath(r.schema, r.objectName, node.path);
  const key = resolved.path.join(".");
  return register(r, { key, kind: "field", path: resolved.path, field: resolved.field, type: sfTypeOf(resolved.field) });
}

function expectFieldArg(call: FunctionCall): FieldRef {
  const arg = call.args[0];
  if (!arg || arg.kind !== "FieldRef" || call.args.length !== 1) {
    throw new FormulaCompileError(`${call.callee} requires a single field argument`);
  }
  return arg;
}

function rewriteCall(node: FunctionCall, r: Resolver): Expr {
  const name = node.callee.toUpperCase();
  if (name === "PRIORVALUE" || name === "ISCHANGED") {
    r.usesRecordState = true;
    const arg = expectFieldArg(node);
    if (arg.isGlobal || (arg.path[0] ?? "").startsWith("$")) throw new FormulaCompileError(`${name} cannot be used on a global variable`);
    const resolved = resolvePath(r.schema, r.objectName, arg.path);
    const kind: ReferenceKind = name === "PRIORVALUE" ? "prior" : "changed";
    const key = [kind === "prior" ? "$Prior" : "$Changed", ...resolved.path].join(".");
    return register(r, { key, kind, path: resolved.path, field: resolved.field, type: kind === "prior" ? sfTypeOf(resolved.field) : "Boolean" });
  }
  if (name === "ISNEW") {
    r.usesRecordState = true;
    return register(r, { key: "$Record.IsNew", kind: "isNew", path: [], type: "Boolean" });
  }
  return { ...node, args: node.args.map((a) => rewrite(a, r)) };
}

function rewrite(node: Expr, r: Resolver): Expr {
  switch (node.kind) {
    case "FieldRef":
      return rewriteFieldRef(node, r);
    case "FunctionCall":
      return rewriteCall(node, r);
    case "BinaryOp":
      return { ...node, left: rewrite(node.left, r), right: rewrite(node.right, r) };
    case "UnaryOp":
      return { ...node, operand: rewrite(node.operand, r) };
    case "Paren":
      return { ...node, expr: rewrite(node.expr, r) };
    default:
      return node;
  }
}

export function compileFormula(source: string, options: CompileOptions): CompiledFormula {
  const parsed = parse(source);
  const parseErrors = parsed.diagnostics.filter((d) => d.severity === "error");
  if (parseErrors.length > 0) {
    throw new FormulaCompileError(`Syntax error in formula: ${parseErrors.map((d) => d.message).join("; ")}`, parseErrors);
  }
  const analysis = analyze(parsed.ast, source, options.context);
  // sigha treats context availability as a warning because its field types are heuristic;
  // Salesforce rejects the save, so we do too.
  const analysisErrors = analysis.filter((d) => d.severity === "error" || FATAL_CODES.has(d.code));
  if (analysisErrors.length > 0) {
    throw new FormulaCompileError(`Error in formula: ${analysisErrors.map((d) => d.message).join("; ")}`, analysisErrors);
  }

  const resolver: Resolver = { schema: options.schema, objectName: options.objectName, references: new Map(), usesRecordState: false };
  const ast = rewrite(parsed.ast, resolver);
  const references = [...resolver.references.values()];
  const parentPaths = new Map<string, string[]>();
  for (const ref of references) {
    if (ref.kind === "global" || ref.kind === "isNew" || ref.path.length < 2) continue;
    const parent = ref.path.slice(0, -1);
    parentPaths.set(parent.join("."), parent);
  }

  return {
    source,
    objectName: options.objectName,
    context: options.context,
    blankMode: options.context === "formula_field" && options.treatBlanksAs === "BlankAsZero" ? "zero" : "blank",
    ast,
    references,
    parentPaths: [...parentPaths.values()],
    usesRecordState: resolver.usesRecordState,
    diagnostics: [...parsed.diagnostics, ...analysis],
  };
}
