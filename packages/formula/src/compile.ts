/**
 * Compiles a Salesforce formula against an OrgSchema: parses and type-checks it with sigha,
 * resolves every field reference (including parent paths and `$User`-style globals) to a
 * FieldDef, and rewrites the record-state functions PRIORVALUE, ISCHANGED and ISNEW into
 * synthetic field references that evaluate.ts fills in from the record context. Typed
 * `Relationship:Object` segments (`Owner:User.Email`) pick one target of a polymorphic lookup. The
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

/** Global roots a formula can read; `$System` is the constant OriginDateTime. */
export type GlobalRoot = "$User" | "$Profile" | "$Organization" | "$RecordType" | "$UserRole" | "$Api" | "$Label" | "$CustomMetadata" | "$Setup" | "$System";

/** Fields read on one object: `path` is the relationship path from the formula's record ([] = the record itself). */
export interface ObjectFieldDependency {
  object: string;
  path: string[];
  fields: string[];
}

export interface FormulaDependencies {
  /** Own object first, then parents by path length and path text; field names canonical and sorted. */
  fields: ObjectFieldDependency[];
  /** Sorted, unique. */
  globals: GlobalRoot[];
  /** NOW/TODAY/TIMENOW or an evaluation-time global: the value can change without the record changing. */
  volatile: boolean;
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
  /** Structured dependency list for Phase 13 (D-14); no reverse index here. */
  dependencies: FormulaDependencies;
}

/** A field reference that does not resolve: the object it was looked up on and the missing name. */
export interface MissingField {
  object: string;
  field: string;
}

export class FormulaCompileError extends Error {
  /** The reference that does not resolve, when that is the failure (D-15): consumers never parse the message. */
  readonly missing: MissingField | undefined;
  constructor(
    message: string,
    readonly diagnostics: Diagnostic[] = [],
    missing?: MissingField,
  ) {
    super(message);
    this.name = "FormulaCompileError";
    this.missing = missing;
  }
}

const FATAL_CODES = new Set<Diagnostic["code"]>(["unknown-function", "wrong-arity", "function-not-available"]);

const GLOBAL_OBJECTS: Record<string, string> = {
  $user: "User",
  $profile: "Profile",
  $organization: "Organization",
  $recordtype: "RecordType",
};

const TIME_FUNCTIONS = new Set(["NOW", "TODAY", "TIMENOW"]);

// `$System.OriginDateTime`, `$Label` and `$CustomMetadata` are constants fixed at metadata load, so they do not make a
// formula volatile (orglet choice for D-14; Phase 13 decides what a roll-up may use).
const EVALUATION_TIME_GLOBALS: ReadonlySet<GlobalRoot> = new Set<GlobalRoot>(["$User", "$Profile", "$Organization", "$RecordType", "$UserRole", "$Api", "$Setup"]);

interface Resolver {
  schema: OrgSchema;
  objectName: string;
  references: Map<string, FieldReference>;
  usesRecordState: boolean;
  /** Fields read per object, keyed by the canonical relationship prefix joined with "." ("" = own object). */
  fields: Map<string, ObjectFieldDependency>;
  globals: Set<GlobalRoot>;
  volatile: boolean;
}

type ResolvedPath = { path: string[]; field: FieldDef; hops: { object: string; field: string }[] };

function noteFields(r: Resolver, resolved: ResolvedPath): void {
  resolved.hops.forEach((hop, i) => {
    const path = resolved.path.slice(0, i);
    const key = path.join(".");
    let entry = r.fields.get(key);
    if (!entry) {
      entry = { object: hop.object, path, fields: [] };
      r.fields.set(key, entry);
    }
    if (!entry.fields.includes(hop.field)) entry.fields.push(hop.field);
  });
}

function fieldNotFound(name: string, missing?: MissingField): FormulaCompileError {
  return new FormulaCompileError(`Field ${name} does not exist. Check spelling.`, [], missing);
}

/** Resolve a dotted path from `objectName` and return the canonical path and leaf field. */
function resolvePath(schema: OrgSchema, objectName: string, path: readonly string[]): ResolvedPath {
  let current = schema.getObject(objectName);
  if (!current) throw new FormulaCompileError(`Object ${objectName} does not exist`);
  const canonical: string[] = [];
  const hops: ResolvedPath["hops"] = [];
  let groupHop = false;
  for (let i = 0; i < path.length; i++) {
    const segment = path[i] ?? "";
    const last = i === path.length - 1;
    if (last) {
      // Documented examples spell the Group leaves of Owner:Queue as QueueName / QueueEmail (D-10).
      const lower = segment.toLowerCase();
      const leaf = groupHop && lower === "queuename" ? "Name" : groupHop && lower === "queueemail" ? "Email" : segment;
      const field = schema.getField(current.name, leaf);
      if (!field) throw fieldNotFound(path.join("."), { object: current.name, field: segment });
      canonical.push(field.name);
      hops.push({ object: current.name, field: field.name });
      return { path: canonical, field, hops };
    }
    const colon = segment.indexOf(":");
    const relName = colon === -1 ? segment : segment.slice(0, colon);
    const typed = colon === -1 ? undefined : segment.slice(colon + 1);
    const resolved = schema.resolveRelationship(current.name, relName);
    if (resolved === undefined) throw fieldNotFound(path.join("."), { object: current.name, field: segment });
    hops.push({ object: current.name, field: resolved.field.name });
    if (typed !== undefined) {
      // Salesforce names the target of a polymorphic owner as Owner:User / Owner:Queue (Help "Tips for Building Cross-Object Formulas"); Queue is a Group row (D-10).
      const wanted = typed.toLowerCase() === "queue" ? "group" : typed.toLowerCase();
      const targetName = (resolved.field.referenceTo ?? []).find((t) => t.toLowerCase() === wanted);
      const target = targetName === undefined ? undefined : schema.getObject(targetName);
      if (target === undefined) throw fieldNotFound(path.join("."), { object: current.name, field: segment });
      canonical.push(`${resolved.field.relationshipName ?? relName}:${target.name}`);
      groupHop = target.name === "Group";
      current = target;
      continue;
    }
    // A polymorphic lookup (Owner: User|Group, What, Who) has no single parent object; plain
    // traversal fails like an unknown field (D-08). The typed form above reaches it.
    if ((resolved.field.referenceTo?.length ?? 0) > 1) throw fieldNotFound(path.join("."));
    canonical.push(resolved.field.relationshipName ?? segment);
    groupHop = false;
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
    if (root.toLowerCase() === "$system") {
      r.globals.add("$System");
      return node;
    } // $System.OriginDateTime is a constant in the evaluator
    const objectName = GLOBAL_OBJECTS[root.toLowerCase()];
    if (!objectName) throw new FormulaCompileError(`UNSUPPORTED:formula-global ${node.path.join(".")} is not available`);
    const resolved = resolvePath(r.schema, objectName, node.path.slice(1));
    const globalName = `$${objectName}` as GlobalRoot;
    r.globals.add(globalName);
    if (EVALUATION_TIME_GLOBALS.has(globalName)) r.volatile = true;
    const key = [globalName, ...resolved.path].join(".");
    return register(r, { key, kind: "global", path: resolved.path, global: globalName, field: resolved.field, type: sfTypeOf(resolved.field) });
  }
  const resolved = resolvePath(r.schema, r.objectName, node.path);
  noteFields(r, resolved);
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
    noteFields(r, resolved);
    const kind: ReferenceKind = name === "PRIORVALUE" ? "prior" : "changed";
    const key = [kind === "prior" ? "$Prior" : "$Changed", ...resolved.path].join(".");
    return register(r, { key, kind, path: resolved.path, field: resolved.field, type: kind === "prior" ? sfTypeOf(resolved.field) : "Boolean" });
  }
  if (name === "ISNEW") {
    r.usesRecordState = true;
    return register(r, { key: "$Record.IsNew", kind: "isNew", path: [], type: "Boolean" });
  }
  if (TIME_FUNCTIONS.has(name)) r.volatile = true;
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

  const resolver: Resolver = { schema: options.schema, objectName: options.objectName, references: new Map(), usesRecordState: false, fields: new Map(), globals: new Set(), volatile: false };
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
    dependencies: {
      fields: [...resolver.fields.values()]
        .map((e) => ({ ...e, fields: [...e.fields].sort() }))
        .sort((a, b) => a.path.length - b.path.length || (a.path.join(".") < b.path.join(".") ? -1 : a.path.join(".") > b.path.join(".") ? 1 : 0)),
      globals: [...resolver.globals].sort(),
      volatile: resolver.volatile,
    },
  };
}
