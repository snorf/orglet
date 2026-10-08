/**
 * SOQL -> parameterised Postgres SQL, plus a `Shape` describing how to turn the result
 * rows back into Salesforce records (nested parents, child subquery arrays, aggregates).
 */
import { parseQuery, type FieldType, type Query, type Subquery, type WhereClause, type Condition, type ConditionWithValueQuery, type OrderByClause, type GroupByClause, type HavingClause, type FunctionExp } from "@jetstreamapp/soql-parser-js";
import type { FieldDef, OrgSchema, SObjectDef } from "@orglet/metadata";
import { columnName, quote, tableName } from "@orglet/schema";
import { dateLiteralRange, dateNLiteralRange, toIsoDate, type DateRange } from "./dates.js";
import { invalidField, invalidRelationship, invalidType, malformed, unsupported } from "./errors.js";
import { NAME_OBJECT_FIELDS, pseudoField } from "./polymorphic.js";
import { TYPEOF_RESTRICTIONS, assertTypeofAllowed, diagnoseTypeofParseError } from "./typeof.js";

export interface CompileOptions {
  schema: OrgSchema;
  orgSchema: string;
  /** queryAll: include IsDeleted rows. */
  includeDeleted?: boolean;
  now?: Date;
}

/** One selected column of an sObject shape. */
export interface ShapeField {
  name: string;
  alias: string;
  /** Picklist whose label is wanted (toLabel). */
  labels?: Map<string, string>;
}

export interface SObjectShape {
  kind: "sobject";
  type: string;
  /** Column alias holding the record Id (present when Id is selected or needed). */
  idAlias: string;
  fields: ShapeField[];
  /** Formula fields requested; computed after the query by the caller, which needs the full row. */
  computed: string[];
  parents: Map<string, SObjectShape>;
  /** Child subqueries: column alias holding a JSON array of child rows (already shaped keys). */
  children: Map<string, { alias: string; shape: SObjectShape }>;
}

export interface AggregateShape {
  kind: "aggregate";
  columns: { name: string; alias: string }[];
}

export type Shape = SObjectShape | AggregateShape;

export interface CompiledQuery {
  sql: string;
  params: unknown[];
  shape: Shape;
  sobject: SObjectDef;
  /** `SELECT COUNT() FROM ...`: the only column is the count. */
  countOnly: boolean;
  /** Stored columns the caller must fetch to compute `computed` formula fields (always present when computed is non-empty). */
  fetchesAllColumns: boolean;
}

const TEXT_TYPES = new Set(["Text", "TextArea", "LongTextArea", "Html", "EncryptedText", "Email", "Phone", "Url", "Picklist", "MultiselectPicklist", "AutoNumber", "Name"]);
const isText = (f: FieldDef) => TEXT_TYPES.has(f.type);
const isDateTime = (f: FieldDef) => f.type === "DateTime";
const isDate = (f: FieldDef) => f.type === "Date";

interface PolyTarget {
  obj: SObjectDef;
  alias: string;
  prefix: string;
}

/** A polymorphic lookup (declared referenceTo length > 1, D-15): one LEFT JOIN per modelled target. */
interface PolyJoin {
  rel: FieldDef;
  fk: string;
  targets: PolyTarget[];
}

interface Join {
  alias: string;
  obj: SObjectDef;
  sql: string;
  poly?: PolyJoin;
}

interface Scope {
  obj: SObjectDef;
  alias: string;
  /** Parent joins keyed by lower-cased relationship path from this scope. */
  joins: Map<string, Join>;
  /** Child subquery: polymorphic parents are refused (D-17). */
  inChildSubquery?: boolean;
}

interface Resolved {
  field: FieldDef;
  obj: SObjectDef;
  alias: string;
  /** Per-row SQL for a polymorphic parent's field (COALESCE / CASE); overrides expr(). */
  sql?: string;
}

class Compiler {
  private params: unknown[] = [];
  private aliasCounter = 0;
  private columnCounter = 0;
  private readonly now: Date;

  constructor(private readonly options: CompileOptions) {
    this.now = options.now ?? new Date();
  }

  private param(value: unknown): string {
    this.params.push(value);
    return `$${this.params.length}`;
  }

  private nextAlias(): string {
    return `t${this.aliasCounter++}`;
  }

  private nextColumn(): string {
    return `c${this.columnCounter++}`;
  }

  private table(obj: SObjectDef): string {
    return `${quote(this.options.orgSchema)}.${quote(tableName(obj))}`;
  }

  // -------------------------------------------------------------------------------------
  // Field resolution

  /** Resolve a possibly dotted field path within `scope`, adding parent joins as needed. */
  private resolve(scope: Scope, path: string[]): Resolved {
    let obj = scope.obj;
    let alias = scope.alias;
    let key = "";
    for (let i = 0; i < path.length - 1; i++) {
      const seg = path[i] ?? "";
      key = key ? `${key}.${seg.toLowerCase()}` : seg.toLowerCase();
      let join = scope.joins.get(key);
      if (!join) {
        const resolved = this.options.schema.resolveRelationship(obj.name, seg);
        if (resolved === undefined) throw invalidRelationship(seg, obj.name);
        const { field: rel, target, targets } = resolved;
        const fk = `${alias}.${quote(columnName(rel))}`;
        if ((rel.referenceTo?.length ?? 0) > 1) {
          if (scope.inChildSubquery) throw unsupported("polymorphic-subquery", `polymorphic relationship ${rel.relationshipName ?? seg} in a child subquery is not supported yet`);
          const polyTargets: PolyTarget[] = targets.map((t) => ({ obj: t, alias: this.nextAlias(), prefix: t.keyPrefix }));
          const sql = polyTargets.map((t) => `LEFT JOIN ${this.table(t.obj)} ${t.alias} ON ${t.alias}.${quote("id")} = ${fk} AND left(${fk}, 3) = '${t.prefix}'`).join(" ");
          join = { alias: polyTargets[0]?.alias ?? "", obj: target, sql, poly: { rel, fk, targets: polyTargets } };
        } else {
          const joinAlias = this.nextAlias();
          join = { alias: joinAlias, obj: target, sql: `LEFT JOIN ${this.table(target)} ${joinAlias} ON ${joinAlias}.${quote("id")} = ${fk}` };
        }
        scope.joins.set(key, join);
      }
      if (join.poly) {
        if (i < path.length - 2) throw unsupported("polymorphic-traversal", `${path.join(".")}: fields past the polymorphic relationship ${seg} can't be traversed`);
        return this.polyLeaf(join.poly, path[path.length - 1] ?? "");
      }
      obj = join.obj;
      alias = join.alias;
    }
    const leaf = path[path.length - 1] ?? "";
    const field = this.options.schema.getField(obj.name, leaf);
    if (!field) throw invalidField(path.join("."), obj.name);
    return { field, obj, alias };
  }

  private sqlOf(r: Resolved): string {
    return r.sql ?? this.expr(r.alias, r.obj, r.field);
  }

  // Prefixes and object names come from the schema (3 alphanumerics, API names), never from user
  // input, so they are inlined as literals; params stay for user literals.
  private typeCase(poly: PolyJoin): string {
    return `CASE left(${poly.fk}, 3) ${poly.targets.map((t) => `WHEN '${t.prefix}' THEN '${t.obj.name}'`).join(" ")} END`;
  }

  private coalesce(parts: string[]): string {
    return parts.length === 0 ? "NULL" : parts.length === 1 ? (parts[0] ?? "NULL") : `COALESCE(${parts.join(", ")})`;
  }

  private polyId(poly: PolyJoin): string {
    return this.coalesce(poly.targets.map((t) => `${t.alias}.${quote("id")}`));
  }

  /** A field read through a polymorphic parent: the Name pseudo-object (D-01), each value from the row's concrete target. */
  private polyLeaf(poly: PolyJoin, leaf: string): Resolved {
    const first = poly.targets[0];
    const relName = poly.rel.relationshipName ?? poly.rel.name;
    if (!first) throw invalidRelationship(relName, poly.rel.name);
    // Type is the concrete object's API name from the Id prefix (D-03); checked before any column
    // lookup so Group's own Type column ('Queue') never answers Owner.Type.
    if (leaf.toLowerCase() === "type") return { field: pseudoField("Type"), obj: first.obj, alias: first.alias, sql: this.typeCase(poly) };
    const entry = NAME_OBJECT_FIELDS.get(leaf.toLowerCase());
    if (!entry) throw invalidField(leaf, "Name");
    if (entry.name === "Profile" || entry.name === "UserRole") throw unsupported("polymorphic-field", `${relName}.${entry.name} on a polymorphic relationship is not supported yet`);
    if (entry.name === "Id") return { field: this.options.schema.getField(first.obj.name, "Id") ?? pseudoField("Id"), obj: first.obj, alias: first.alias, sql: this.polyId(poly) };
    const contributors = poly.targets
      .filter((t) => !entry.userOnly || t.obj.name === "User")
      .flatMap((t) => {
        const f = this.options.schema.getField(t.obj.name, entry.name);
        return f && f.formula === undefined ? [{ t, f }] : [];
      });
    const sql = this.coalesce(contributors.map(({ t, f }) => this.expr(t.alias, t.obj, f)));
    return { field: contributors[0]?.f ?? pseudoField(entry.name), obj: first.obj, alias: first.alias, sql };
  }

  /** SQL expression reading `field` from table alias `alias`, including virtual fields. */
  private expr(alias: string, obj: SObjectDef, field: FieldDef): string {
    if (field.formula !== undefined) throw unsupported("soql-formula", `formula field ${obj.name}.${field.name} cannot be used in WHERE, ORDER BY or GROUP BY yet`);
    switch (field.type) {
      case "Name": {
        const parts = obj.fields.filter((f) => f.compoundFieldName === field.name && (f.name === "FirstName" || f.name === "LastName")).sort((a) => (a.name === "FirstName" ? -1 : 1));
        return `NULLIF(concat_ws(' ', ${parts.map((p) => `${alias}.${quote(columnName(p))}`).join(", ")}), '')`;
      }
      case "Address": {
        const prefix = field.name.replace(/Address$/, "");
        const comp = (suffix: string) => {
          const f = obj.fields.find((c) => c.compoundFieldName === field.name && c.name.toLowerCase() === `${prefix}${suffix}`.toLowerCase());
          return f ? `${alias}.${quote(columnName(f))}` : "NULL";
        };
        const pairs = ["city", "country", "geocodeAccuracy", "latitude", "longitude", "postalCode", "state", "street"].map((k) => `'${k}', ${comp(k.charAt(0).toUpperCase() + k.slice(1))}`);
        return `CASE WHEN ${["City", "Country", "PostalCode", "State", "Street"].map((s) => `${comp(s)} IS NULL`).join(" AND ")} THEN NULL ELSE json_build_object(${pairs.join(", ")}) END`;
      }
      case "Location":
        return "NULL";
      default:
        return `${alias}.${quote(columnName(field))}`;
    }
  }

  // -------------------------------------------------------------------------------------
  // SELECT

  private objectFor(name: string): SObjectDef {
    const obj = this.options.schema.getObject(name);
    if (!obj) throw invalidType(name);
    return obj;
  }

  compile(soql: string): CompiledQuery {
    let query: Query;
    try {
      query = parseQuery(soql.replace(/\s+ALL\s+ROWS\s*$/i, ""));
    } catch (err) {
      const detail = (err as Error).message;
      throw malformed(/\bTYPEOF\b/i.test(soql) ? (diagnoseTypeofParseError(soql) ?? detail) : detail);
    }
    if (!query.sObject) throw malformed("unexpected token: FROM");
    assertTypeofAllowed(query);
    // FOR VIEW / FOR REFERENCE only touch LastViewedDate; FOR UPDATE locks rows for the
    // transaction, which a single-statement REST query never observes. All three are accepted.
    if (query.withDataCategory || query.withSecurityEnforced || query.withAccessLevel) throw unsupported("soql-with", "WITH clauses are not supported yet");
    const obj = this.objectFor(query.sObject);
    const scope: Scope = { obj, alias: this.nextAlias(), joins: new Map() };
    const stripAlias = (name: string) => (query.sObjectAlias && name.toLowerCase().startsWith(`${query.sObjectAlias.toLowerCase()}.`) ? name.slice(query.sObjectAlias.length + 1) : name);

    const fields = query.fields ?? [];
    const countOnly = fields.length === 1 && fields[0]?.type === "FieldFunctionExpression" && fields[0].functionName.toUpperCase() === "COUNT" && fields[0].parameters.length === 0;
    const aggregate = !countOnly && (fields.some((f) => f.type === "FieldFunctionExpression" && f.isAggregateFn) || query.groupBy !== undefined);

    const selectItems: string[] = [];
    let shape: Shape;
    if (countOnly) {
      selectItems.push(`count(*) AS ${quote("c0")}`);
      shape = { kind: "aggregate", columns: [{ name: "expr0", alias: "c0" }] };
    } else if (aggregate) {
      shape = this.compileAggregateSelect(scope, fields, selectItems, stripAlias);
    } else {
      shape = this.compileSObjectSelect(scope, fields, selectItems, stripAlias);
    }

    const where = this.compileWhere(scope, query.where, stripAlias);
    const deletedFilter = this.options.includeDeleted ? undefined : `${scope.alias}.${quote("isdeleted")} = false`;
    const whereSql = [deletedFilter, where].filter(Boolean).join(" AND ");
    const groupBy = aggregate ? this.compileGroupBy(scope, query.groupBy, stripAlias) : "";
    const having = aggregate ? this.compileHaving(scope, query.having, stripAlias) : "";
    const orderBy = this.compileOrderBy(scope, query.orderBy, stripAlias, aggregate);

    const sql =
      `SELECT ${selectItems.join(", ")} FROM ${this.table(obj)} ${scope.alias}` +
      [...scope.joins.values()].map((j) => ` ${j.sql}`).join("") +
      (whereSql ? ` WHERE ${whereSql}` : "") +
      (groupBy ? ` GROUP BY ${groupBy}` : "") +
      (having ? ` HAVING ${having}` : "") +
      (orderBy ? ` ORDER BY ${orderBy}` : "") +
      (query.limit !== undefined ? ` LIMIT ${Number(query.limit)}` : "") +
      (query.offset !== undefined ? ` OFFSET ${Number(query.offset)}` : "");

    return { sql, params: this.params, shape, sobject: obj, countOnly, fetchesAllColumns: shape.kind === "sobject" && shape.computed.length > 0 };
  }

  private expandFieldsFn(obj: SObjectDef, which: string): FieldDef[] {
    switch (which.toUpperCase()) {
      case "ALL":
        return obj.fields;
      case "STANDARD":
        return obj.fields.filter((f) => !f.custom);
      case "CUSTOM":
        return obj.fields.filter((f) => f.custom);
      default:
        throw malformed(`FIELDS(${which}) is not valid`);
    }
  }

  private compileSObjectSelect(scope: Scope, fields: FieldType[], selectItems: string[], stripAlias: (n: string) => string): SObjectShape {
    const shape: SObjectShape = { kind: "sobject", type: scope.obj.name, idAlias: "", fields: [], computed: [], parents: new Map(), children: new Map() };
    const idAlias = this.nextColumn();
    selectItems.push(`${scope.alias}.${quote("id")} AS ${quote(idAlias)}`);
    shape.idAlias = idAlias;

    const addField = (target: SObjectShape, alias: string, obj: SObjectDef, field: FieldDef, labels?: Map<string, string>) => {
      if (field.formula !== undefined) {
        if (target !== shape) throw unsupported("soql-formula", `formula field ${obj.name}.${field.name} on a parent relationship cannot be selected yet`);
        if (!target.computed.includes(field.name)) target.computed.push(field.name);
        return;
      }
      if (target.fields.some((f) => f.name === field.name && !labels)) return;
      const col = this.nextColumn();
      selectItems.push(`${this.expr(alias, obj, field)} AS ${quote(col)}`);
      const sf: ShapeField = { name: field.name, alias: col };
      if (labels) sf.labels = labels;
      target.fields.push(sf);
    };

    const parentShape = (path: string[]): { shape: SObjectShape; alias: string; obj: SObjectDef } => {
      let current = shape;
      let obj = scope.obj;
      let alias = scope.alias;
      let key = "";
      for (const seg of path) {
        key = key ? `${key}.${seg.toLowerCase()}` : seg.toLowerCase();
        // Resolve through the scope (creates the join) to get the canonical relationship name.
        const resolved = this.options.schema.resolveRelationship(obj.name, seg);
        if (resolved === undefined) throw invalidRelationship(seg, obj.name);
        const rel = resolved.field;
        if (!rel.relationshipName) throw invalidRelationship(seg, obj.name);
        this.resolve(scope, [...key.split("."), "Id"]);
        const join = scope.joins.get(key);
        if (!join) throw invalidRelationship(seg, obj.name);
        let next = current.parents.get(rel.relationshipName);
        if (!next) {
          const pid = this.nextColumn();
          selectItems.push(`${join.alias}.${quote("id")} AS ${quote(pid)}`);
          next = { kind: "sobject", type: join.obj.name, idAlias: pid, fields: [], computed: [], parents: new Map(), children: new Map() };
          current.parents.set(rel.relationshipName, next);
        }
        current = next;
        obj = join.obj;
        alias = join.alias;
      }
      return { shape: current, alias, obj };
    };

    for (const f of fields) {
      switch (f.type) {
        case "Field": {
          const name = stripAlias(f.field);
          const field = this.options.schema.getField(scope.obj.name, name);
          if (!field) throw invalidField(name, scope.obj.name);
          addField(shape, scope.alias, scope.obj, field);
          break;
        }
        case "FieldRelationship": {
          const rels = f.relationships[0]?.toLowerCase() === scope.obj.name.toLowerCase() || (f.relationships[0] && stripAlias(`${f.relationships[0]}.x`) === "x") ? f.relationships.slice(1) : f.relationships;
          if (rels.length === 0) {
            const field = this.options.schema.getField(scope.obj.name, f.field);
            if (!field) throw invalidField(f.field, scope.obj.name);
            addField(shape, scope.alias, scope.obj, field);
            break;
          }
          const p = parentShape(rels);
          const field = this.options.schema.getField(p.obj.name, f.field);
          if (!field) throw invalidField(f.rawValue ?? f.field, p.obj.name);
          addField(p.shape, p.alias, p.obj, field);
          break;
        }
        case "FieldSubquery": {
          const { alias, childShape } = this.compileChildSubquery(scope, f.subquery);
          selectItems.push(alias.sql);
          shape.children.set(childShape.relationshipName, { alias: alias.column, shape: childShape.shape });
          break;
        }
        case "FieldFunctionExpression": {
          const fn = f.functionName.toUpperCase();
          if (fn === "FIELDS") {
            const which = f.parameters[0];
            for (const field of this.expandFieldsFn(scope.obj, typeof which === "string" ? which : "ALL")) addField(shape, scope.alias, scope.obj, field);
            break;
          }
          if (fn === "TOLABEL" || fn === "FORMAT" || fn === "CONVERTCURRENCY") {
            const name = f.parameters[0];
            if (typeof name !== "string") throw malformed(`${f.functionName}() needs a field argument`);
            const path = stripAlias(name).split(".");
            const r = this.resolve(scope, path);
            const target = path.length > 1 ? parentShape(path.slice(0, -1)).shape : shape;
            const labels = fn === "TOLABEL" && r.field.picklist ? new Map(r.field.picklist.values.map((v) => [v.value, v.label])) : undefined;
            addField(target, r.alias, r.obj, r.field, labels);
            break;
          }
          throw unsupported("soql-function", `${f.functionName}() in SELECT is not supported without GROUP BY`);
        }
        case "FieldTypeof":
          throw unsupported("soql-typeof", "TYPEOF is not supported yet");
        default:
          throw unsupported("soql-select", `unsupported select item ${JSON.stringify(f)}`);
      }
    }
    return shape;
  }

  private compileChildSubquery(parentScope: Scope, sub: Subquery): { alias: { sql: string; column: string }; childShape: { relationshipName: string; shape: SObjectShape } } {
    const rel = this.options.schema.childRelationships(parentScope.obj.name).find((c) => c.relationshipName?.toLowerCase() === sub.relationshipName.toLowerCase());
    if (!rel?.relationshipName) throw invalidRelationship(sub.relationshipName, parentScope.obj.name);
    const child = this.objectFor(rel.childSObject);
    const linkField = this.options.schema.getField(child.name, rel.field);
    if (!linkField) throw invalidRelationship(sub.relationshipName, parentScope.obj.name);
    const scope: Scope = { obj: child, alias: this.nextAlias(), joins: new Map(), inChildSubquery: true };
    const stripAlias = (name: string) => (sub.sObjectAlias && name.toLowerCase().startsWith(`${sub.sObjectAlias.toLowerCase()}.`) ? name.slice(sub.sObjectAlias.length + 1) : name);
    const selectItems: string[] = [];
    if (sub.fields?.some((f) => f.type === "FieldTypeof")) throw unsupported("polymorphic-subquery", `TYPEOF in child subquery ${sub.relationshipName} is not supported yet`);
    if (sub.fields?.some((f) => f.type === "FieldFunctionExpression" && f.isAggregateFn)) throw unsupported("soql-subquery-aggregate", "aggregate functions in child subqueries are not supported");
    const shape = this.compileSObjectSelect(scope, sub.fields ?? [], selectItems, stripAlias);
    if (shape.computed.length > 0) throw unsupported("soql-formula", `formula fields in child subquery ${sub.relationshipName} are not supported yet`);
    const where = this.compileWhere(scope, sub.where, stripAlias);
    const deleted = this.options.includeDeleted ? "" : ` AND ${scope.alias}.${quote("isdeleted")} = false`;
    const orderBy = this.compileOrderBy(scope, sub.orderBy, stripAlias, false);
    const inner =
      `SELECT ${selectItems.join(", ")} FROM ${this.table(child)} ${scope.alias}` +
      [...scope.joins.values()].map((j) => ` ${j.sql}`).join("") +
      ` WHERE ${scope.alias}.${quote(columnName(linkField))} = ${parentScope.alias}.${quote("id")}${deleted}${where ? ` AND (${where})` : ""}` +
      (orderBy ? ` ORDER BY ${orderBy}` : "") +
      (sub.limit !== undefined ? ` LIMIT ${Number(sub.limit)}` : "") +
      (sub.offset !== undefined ? ` OFFSET ${Number(sub.offset)}` : "");
    const column = this.nextColumn();
    const sql = `(SELECT json_agg(row_to_json(sub)) FROM (${inner}) sub) AS ${quote(column)}`;
    return { alias: { sql, column }, childShape: { relationshipName: rel.relationshipName, shape } };
  }

  private compileAggregateSelect(scope: Scope, fields: FieldType[], selectItems: string[], stripAlias: (n: string) => string): AggregateShape {
    const shape: AggregateShape = { kind: "aggregate", columns: [] };
    let exprIndex = 0;
    for (const f of fields) {
      if (f.type === "Field" || f.type === "FieldRelationship") {
        const raw = f.type === "Field" ? stripAlias(f.field) : `${f.relationships.join(".")}.${f.field}`;
        const r = this.resolve(scope, raw.split("."));
        const col = this.nextColumn();
        selectItems.push(`${this.sqlOf(r)} AS ${quote(col)}`);
        shape.columns.push({ name: ("alias" in f && f.alias) || r.field.name, alias: col });
      } else if (f.type === "FieldFunctionExpression") {
        const col = this.nextColumn();
        selectItems.push(`${this.compileFunction(scope, f, stripAlias)} AS ${quote(col)}`);
        shape.columns.push({ name: f.alias ?? `expr${exprIndex++}`, alias: col });
      } else {
        throw unsupported("soql-aggregate", `unsupported select item in aggregate query: ${JSON.stringify(f)}`);
      }
    }
    return shape;
  }

  private compileFunction(scope: Scope, fn: FunctionExp, stripAlias: (n: string) => string): string {
    const name = (fn.functionName ?? "").toUpperCase();
    const argExpr = () => {
      const p = fn.parameters?.[0];
      if (typeof p !== "string") throw malformed(`${name}() needs a field argument`);
      const r = this.resolve(scope, stripAlias(p).split("."));
      return this.sqlOf(r);
    };
    switch (name) {
      case "COUNT":
        return fn.parameters && fn.parameters.length > 0 ? `count(${argExpr()})` : "count(*)";
      case "COUNT_DISTINCT":
        return `count(DISTINCT ${argExpr()})`;
      case "SUM":
        return `sum(${argExpr()})`;
      case "AVG":
        return `avg(${argExpr()})`;
      case "MIN":
        return `min(${argExpr()})`;
      case "MAX":
        return `max(${argExpr()})`;
      case "CALENDAR_YEAR":
      case "FISCAL_YEAR":
        return `EXTRACT(YEAR FROM ${argExpr()})::int`;
      case "CALENDAR_MONTH":
      case "FISCAL_MONTH":
        return `EXTRACT(MONTH FROM ${argExpr()})::int`;
      case "CALENDAR_QUARTER":
      case "FISCAL_QUARTER":
        return `EXTRACT(QUARTER FROM ${argExpr()})::int`;
      case "DAY_IN_MONTH":
        return `EXTRACT(DAY FROM ${argExpr()})::int`;
      case "DAY_IN_WEEK":
        return `(EXTRACT(DOW FROM ${argExpr()})::int + 1)`;
      case "DAY_IN_YEAR":
        return `EXTRACT(DOY FROM ${argExpr()})::int`;
      case "DAY_ONLY":
        return `(${argExpr()})::date`;
      case "HOUR_IN_DAY":
        return `EXTRACT(HOUR FROM ${argExpr()})::int`;
      case "WEEK_IN_YEAR":
        return `EXTRACT(WEEK FROM ${argExpr()})::int`;
      case "TOLABEL":
      case "FORMAT":
      case "CONVERTCURRENCY":
        return argExpr();
      default:
        throw unsupported("soql-function", `${fn.functionName ?? "?"}() is not supported`);
    }
  }

  // -------------------------------------------------------------------------------------
  // WHERE / HAVING

  private compileWhere(scope: Scope, clause: WhereClause | undefined, stripAlias: (n: string) => string): string {
    if (!clause) return "";
    let sql = "";
    let current: WhereClause | undefined = clause;
    while (current) {
      if ("left" in current && current.left !== null && "field" in current.left) {
        sql += this.compileCondition(scope, current.left, stripAlias);
      } else if ("left" in current && current.left !== null && "fn" in current.left) {
        sql += this.compileCondition(scope, current.left, stripAlias);
      } else if ("left" in current && current.left !== null && "openParen" in current.left) {
        // NegationCondition: NOT followed by an opening parenthesis count.
        sql += "NOT " + "(".repeat(current.left.openParen);
        current = "right" in current ? current.right : undefined;
        continue;
      } else if ("operator" in current && current.operator === "NOT") {
        sql += "NOT ";
        current = current.right;
        continue;
      }
      if ("operator" in current && current.operator !== "NOT") {
        sql += ` ${current.operator} `;
        current = current.right;
      } else {
        current = undefined;
      }
    }
    return sql;
  }

  private compileHaving(scope: Scope, clause: HavingClause | undefined, stripAlias: (n: string) => string): string {
    if (!clause) return "";
    let sql = "";
    let current: HavingClause | undefined = clause;
    while (current) {
      sql += this.compileCondition(scope, current.left, stripAlias);
      if ("operator" in current) {
        sql += ` ${current.operator} `;
        current = current.right;
      } else {
        current = undefined;
      }
    }
    return sql;
  }

  private compileCondition(scope: Scope, cond: ConditionWithValueQuery | Condition, stripAlias: (n: string) => string): string {
    const open = "(".repeat("openParen" in cond ? (cond.openParen ?? 0) : 0);
    const close = ")".repeat("closeParen" in cond ? (cond.closeParen ?? 0) : 0);
    if (!("operator" in cond)) return open + close;

    let lhs: string;
    let field: FieldDef | undefined;
    if ("fn" in cond) {
      lhs = this.compileFunction(scope, cond.fn, stripAlias);
    } else {
      const r = this.resolve(scope, stripAlias(cond.field).split("."));
      field = r.field;
      lhs = this.sqlOf(r);
    }

    if ("valueQuery" in cond) {
      const inner = new Compiler({ ...this.options });
      inner.params = this.params;
      inner.aliasCounter = this.aliasCounter + 100;
      const q = cond.valueQuery;
      if (!q.sObject) throw malformed("semi-join needs an object");
      const innerObj = this.objectFor(q.sObject);
      const innerScope: Scope = { obj: innerObj, alias: inner.nextAlias(), joins: new Map() };
      if (q.fields?.some((f) => f.type === "FieldTypeof")) throw malformed(TYPEOF_RESTRICTIONS.semiJoin);
      const innerField = q.fields?.[0];
      if (!innerField || innerField.type !== "Field" || (q.fields?.length ?? 0) !== 1) throw malformed("semi-join subquery must select a single Id or lookup field");
      const r = inner.resolve(innerScope, [innerField.field]);
      const where = inner.compileWhere(innerScope, q.where, (n) => n);
      const deleted = this.options.includeDeleted ? "" : ` AND ${innerScope.alias}.${quote("isdeleted")} = false`;
      const sub = `SELECT ${inner.expr(innerScope.alias, innerObj, r.field)} FROM ${this.table(innerObj)} ${innerScope.alias}` + [...innerScope.joins.values()].map((j) => ` ${j.sql}`).join("") + ` WHERE TRUE${deleted}${where ? ` AND (${where})` : ""}`;
      this.params = inner.params;
      const op = cond.operator === "NOT IN" ? "NOT IN" : "IN";
      return `${open}${lhs} ${op} (${sub})${close}`;
    }

    const literalType = Array.isArray(cond.literalType) ? cond.literalType[0] : cond.literalType;
    const values = Array.isArray(cond.value) ? cond.value : [cond.value];
    const op = cond.operator;

    // Date literals compare against ranges.
    if (literalType === "DATE_LITERAL" || literalType === "DATE_N_LITERAL") {
      const literal = String(values[0]);
      const n = "dateLiteralVariable" in cond ? Number(Array.isArray(cond.dateLiteralVariable) ? cond.dateLiteralVariable[0] : cond.dateLiteralVariable) : 0;
      const range = literalType === "DATE_LITERAL" ? dateLiteralRange(literal, this.now) : dateNLiteralRange(literal.split(":")[0] ?? literal, n, this.now);
      if (!range) throw malformed(`unknown date literal ${literal}`);
      return `${open}${this.rangeCondition(lhs, op, range, field)}${close}`;
    }

    if (literalType === "NULL" || (values.length === 1 && String(values[0]).toUpperCase() === "NULL")) {
      if (op === "=") return `${open}${lhs} IS NULL${close}`;
      if (op === "!=") return `${open}${lhs} IS NOT NULL${close}`;
      throw malformed(`operator ${op} cannot be used with null`);
    }

    const converted = values.map((v) => this.literal(String(v), literalType, field));
    const textual = field ? isText(field) && field.type !== "MultiselectPicklist" : literalType === "STRING";
    const caseInsensitive = textual && !(field?.unique && field.caseSensitive);
    const lhsCmp = caseInsensitive ? `lower(${lhs})` : lhs;
    const p = (v: unknown) => (caseInsensitive && typeof v === "string" ? `lower(${this.param(v)})` : this.param(v));

    switch (op) {
      case "=":
        return `${open}${lhsCmp} = ${p(converted[0])}${close}`;
      case "!=":
        return `${open}${lhsCmp} IS DISTINCT FROM ${p(converted[0])}${close}`;
      case "<":
      case "<=":
      case ">":
      case ">=":
        return `${open}${lhsCmp} ${op} ${p(converted[0])}${close}`;
      case "LIKE":
        return `${open}${lhs} ILIKE ${this.param(converted[0])}${close}`;
      case "IN":
        return `${open}${lhsCmp} IN (${converted.map(p).join(", ")})${close}`;
      case "NOT IN":
        return `${open}(${lhsCmp} NOT IN (${converted.map(p).join(", ")}) OR ${lhs} IS NULL)${close}`;
      case "INCLUDES":
      case "EXCLUDES": {
        const groups = converted.map((v) => `string_to_array(${lhs}, ';') @> ${this.param(String(v).split(";"))}`);
        const includes = `(${groups.join(" OR ")})`;
        return `${open}${op === "INCLUDES" ? includes : `NOT coalesce(${includes}, false)`}${close}`;
      }
      default:
        throw malformed(`unsupported operator ${String(op)}`);
    }
  }

  private rangeCondition(lhs: string, op: string, range: DateRange, field: FieldDef | undefined): string {
    const asDate = field ? isDate(field) : false;
    const start = asDate ? toIsoDate(range.start) : range.start.toISOString();
    const end = asDate ? toIsoDate(range.end) : range.end.toISOString();
    switch (op) {
      case "=":
        return `(${lhs} >= ${this.param(start)} AND ${lhs} < ${this.param(end)})`;
      case "!=":
        return `NOT (${lhs} >= ${this.param(start)} AND ${lhs} < ${this.param(end)})`;
      case "<":
        return `${lhs} < ${this.param(start)}`;
      case "<=":
        return `${lhs} < ${this.param(end)}`;
      case ">":
        return `${lhs} >= ${this.param(end)}`;
      case ">=":
        return `${lhs} >= ${this.param(start)}`;
      default:
        throw malformed(`operator ${op} cannot be used with a date literal`);
    }
  }

  private literal(raw: string, literalType: string | undefined, field: FieldDef | undefined): unknown {
    switch (literalType) {
      case "STRING": {
        const inner = raw.startsWith("'") && raw.endsWith("'") ? raw.slice(1, -1) : raw;
        return inner.replace(/\\(['"\\nrtbf%_])/g, (_, c: string) => ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" })[c] ?? c);
      }
      case "INTEGER":
      case "DECIMAL":
        return Number(raw);
      case "INTEGER_WITH_CURRENCY_PREFIX":
      case "DECIMAL_WITH_CURRENCY_PREFIX":
        return Number(raw.replace(/^[A-Z]{3}/, ""));
      case "BOOLEAN":
        return raw.toUpperCase() === "TRUE";
      case "DATE":
        return raw;
      case "DATETIME":
        return new Date(raw).toISOString();
      default:
        if (field && (field.type === "Number" || field.type === "Currency" || field.type === "Percent")) return Number(raw);
        if (field && isDateTime(field)) return new Date(raw).toISOString();
        return raw;
    }
  }

  // -------------------------------------------------------------------------------------
  // GROUP BY / ORDER BY

  private compileGroupBy(scope: Scope, groupBy: GroupByClause | GroupByClause[] | undefined, stripAlias: (n: string) => string): string {
    if (!groupBy) return "";
    const items = Array.isArray(groupBy) ? groupBy : [groupBy];
    return items
      .map((g) => {
        if ("fn" in g) return this.compileFunction(scope, g.fn, stripAlias);
        const r = this.resolve(scope, stripAlias(g.field).split("."));
        return this.sqlOf(r);
      })
      .join(", ");
  }

  private compileOrderBy(scope: Scope, orderBy: OrderByClause | OrderByClause[] | undefined, stripAlias: (n: string) => string, aggregate: boolean): string {
    if (!orderBy) return "";
    const items = Array.isArray(orderBy) ? orderBy : [orderBy];
    return items
      .map((o) => {
        let expr: string;
        let text = false;
        if ("fn" in o) {
          expr = this.compileFunction(scope, o.fn, stripAlias);
        } else {
          const r = this.resolve(scope, stripAlias(o.field).split("."));
          expr = this.sqlOf(r);
          text = isText(r.field);
        }
        void aggregate;
        const direction = o.order ?? "ASC";
        // SOQL sorts text case-insensitively and puts nulls first unless told otherwise.
        const nulls = o.nulls ?? (direction === "ASC" ? "FIRST" : "LAST");
        return `${text ? `lower(${expr})` : expr} ${direction} NULLS ${nulls}`;
      })
      .join(", ");
  }
}

export function compileSoql(soql: string, options: CompileOptions): CompiledQuery {
  return new Compiler(options).compile(soql);
}
