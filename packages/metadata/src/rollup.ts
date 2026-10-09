/**
 * Roll-up summary resolution. Metadata writes roll-up references as dotted `Child.Field` strings
 * and filter values as comma lists with optional double quotes; `resolveRollups` checks those
 * against the registered objects and turns each `Summary` SourceField into a stored, read-only
 * FieldDef of the aggregate's type (ROLL-01). Only a roll-up over a plain lookup fails metadata
 * load (D-08); every other problem degrades with an UNSUPPORTED:rollup-* warning (D-06, D-07).
 */
import type { FieldDef, FieldType, RollupDef, RollupFilterDef, RollupFilterOperation, RollupOperation, SObjectDef } from "./types.js";
import type { SourceField, SourceFilterItem } from "./sfdx.js";

/** Split `Child__c.Field__c`; anything but exactly one dot is not a roll-up reference. */
export function splitRollupRef(ref: string): { object: string; field: string } | undefined {
  const parts = ref.split(".");
  if (parts.length !== 2) return undefined;
  const [object = "", field = ""] = parts;
  return object !== "" && field !== "" ? { object, field } : undefined;
}

/** Split a filter value on commas outside double quotes; trim; strip enclosing quotes; drop empty tokens. [] means blank. */
export function tokenizeFilterValue(raw: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;
  for (const ch of raw) {
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === "," && !inQuotes) {
      tokens.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  tokens.push(current);
  return tokens
    .map((t) => {
      const trimmed = t.trim();
      return trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"') ? trimmed.slice(1, -1).trim() : trimmed;
    })
    .filter((t) => t !== "");
}

// ---------------------------------------------------------------------------
// Resolution

/** A Summary field waiting for resolution, with the object it is declared on. */
export interface PendingRollup {
  objectName: string;
  field: SourceField;
}

/** The column a resolved roll-up gets: the aggregate's result type. */
export interface RollupColumn {
  type: FieldType;
  precision?: number;
  scale?: number;
}

/** Roll-ups Salesforce allows over these lookups without master-detail (D-05). Lower-cased `Child.Field`. */
const LOOKUP_WHITELIST = new Set(["opportunity.accountid", "opportunitylineitem.opportunityid", "campaignmember.campaignid"]);

const OPERATIONS = new Set<string>(["COUNT", "SUM", "MIN", "MAX"]);
const NUMERIC: ReadonlySet<FieldType> = new Set<FieldType>(["Number", "Currency", "Percent"]);
const TEMPORAL: ReadonlySet<FieldType> = new Set<FieldType>(["Date", "DateTime"]);

const FILTER_OPERATIONS = new Set<string>(["equals", "notEqual", "lessThan", "greaterThan", "lessOrEqual", "greaterOrEqual", "contains", "notContain", "startsWith"]);
const RANGE = new Set<RollupFilterOperation>(["lessThan", "greaterThan", "lessOrEqual", "greaterOrEqual"]);
const TEXT_MATCH = new Set<RollupFilterOperation>(["contains", "notContain", "startsWith"]);

type DropArea = "rollup-target" | "rollup-type" | "rollup-filter";
type Outcome = { kind: "ok"; column: RollupColumn; rollup: RollupDef } | { kind: "drop"; area: DropArea; detail: string } | { kind: "wait" };

const drop = (area: DropArea, detail: string): Outcome => ({ kind: "drop", area, detail });
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const findField = (obj: SObjectDef, name: string): FieldDef | undefined => obj.fields.find((f) => same(f.name, name));

/**
 * Resolve Summary fields in place: each resolvable one is pushed onto its object's `fields` via `makeField`,
 * so a later roll-up can summarise it (ROLL-06 chains). Degrades with UNSUPPORTED:rollup-target/-type/
 * -filter/-cycle warnings; throws only for a roll-up over a plain lookup (D-08).
 */
export function resolveRollups(
  objects: Map<string, SObjectDef>,
  pending: PendingRollup[],
  warnings: string[],
  makeField: (sf: SourceField, column: RollupColumn, rollup: RollupDef) => FieldDef,
): void {
  let queue = [...pending];
  while (queue.length > 0) {
    const round = queue;
    const next: PendingRollup[] = [];
    for (const item of round) {
      const parent = parentOf(objects, item);
      const waitingOn = (child: SObjectDef, name: string): boolean => round.some((q) => q !== item && same(q.objectName, child.name) && same(q.field.fullName, name));
      const outcome = tryResolve(objects, parent, item.field, waitingOn);
      if (outcome.kind === "ok") parent.fields.push(makeField(item.field, outcome.column, outcome.rollup));
      else if (outcome.kind === "drop") warnings.push(`UNSUPPORTED:${outcome.area} ${parent.name}.${item.field.fullName}: ${outcome.detail}; field skipped`);
      else next.push(item);
    }
    if (next.length === round.length) {
      // Nothing resolved and nothing dropped: the remaining roll-ups only wait for each other.
      for (const item of next) warnings.push(`UNSUPPORTED:rollup-cycle ${parentOf(objects, item).name}.${item.field.fullName}: roll-up summaries summarise each other in a cycle; field skipped`);
      return;
    }
    queue = next;
  }
}

function parentOf(objects: Map<string, SObjectDef>, item: PendingRollup): SObjectDef {
  const parent = objects.get(item.objectName.toLowerCase());
  if (!parent) throw new Error(`${item.objectName}.${item.field.fullName}: roll-up declared on an object that is not registered`);
  return parent;
}

function tryResolve(objects: Map<string, SObjectDef>, parent: SObjectDef, sf: SourceField, waitingOn: (child: SObjectDef, fieldName: string) => boolean): Outcome {
  // 1. Every reference must resolve (D-07) before the relationship rule is judged, so an unresolvable child degrades.
  const fkRef = splitRollupRef(sf.summaryForeignKey ?? "");
  if (!fkRef) return drop("rollup-target", `summaryForeignKey ${sf.summaryForeignKey ?? "(missing)"} is not a Child.Field reference`);
  const child = objects.get(fkRef.object.toLowerCase());
  if (!child) return drop("rollup-target", `child object ${fkRef.object} is not defined`);
  const fk = findField(child, fkRef.field);
  if (!fk) return drop("rollup-target", `${child.name}.${fkRef.field} is not defined`);
  if ((fk.type !== "Lookup" && fk.type !== "MasterDetail") || !(fk.referenceTo ?? []).some((t) => same(t, parent.name))) {
    return drop("rollup-target", `${child.name}.${fk.name} does not point at ${parent.name}`);
  }

  let summarizedRef: { object: string; field: string } | undefined;
  let summarized: FieldDef | undefined;
  if (sf.summarizedField !== undefined) {
    summarizedRef = splitRollupRef(sf.summarizedField);
    if (!summarizedRef || !same(summarizedRef.object, child.name)) return drop("rollup-target", `summarized field ${sf.summarizedField} is not a field of ${child.name}`);
    summarized = findField(child, summarizedRef.field);
  }

  const filterFields: { item: SourceFilterItem; field: FieldDef }[] = [];
  for (const item of sf.summaryFilterItems ?? []) {
    const ref = splitRollupRef(item.field);
    if (!ref || !same(ref.object, child.name)) return drop("rollup-target", `filter field ${item.field} is not a field of ${child.name}`);
    const field = findField(child, ref.field);
    if (!field) {
      if (waitingOn(child, ref.field)) return drop("rollup-filter", `filter field ${item.field} is a roll-up summary`);
      return drop("rollup-target", `filter field ${item.field} is not defined`);
    }
    filterFields.push({ item, field });
  }

  // 2. Relationship rule (D-05, D-08): the one hard failure.
  if (fk.type !== "MasterDetail" && !LOOKUP_WHITELIST.has(`${child.name}.${fk.name}`.toLowerCase())) {
    throw new Error(
      `${parent.name}.${sf.fullName}: a roll-up summary needs a master-detail relationship, but ${child.name}.${fk.name} is a lookup (only Opportunity.AccountId, OpportunityLineItem.OpportunityId and CampaignMember.CampaignId are allowed without master-detail)`,
    );
  }

  // 4. Chains: a summarized field that is itself a still-pending roll-up on the child resolves in a later round.
  if (summarizedRef && !summarized) {
    if (waitingOn(child, summarizedRef.field)) return { kind: "wait" };
    return drop("rollup-target", `summarized field ${sf.summarizedField ?? ""} is not defined`);
  }

  // 3. Operation, summarized type and filters (D-06).
  const operation = (sf.summaryOperation ?? "").toUpperCase();
  if (!OPERATIONS.has(operation)) return drop("rollup-type", `summaryOperation ${sf.summaryOperation ?? "(missing)"} is not supported`);
  const op = operation as RollupOperation;

  let column: RollupColumn;
  if (op === "COUNT") {
    column = { type: "Number", precision: sf.precision ?? 18, scale: sf.scale ?? 0 };
  } else {
    if (!summarized) return drop("rollup-target", "summarizedField is missing");
    if (summarized.formula !== undefined) return drop("rollup-type", `${child.name}.${summarized.name} is a formula field`);
    const allowed = NUMERIC.has(summarized.type) || (op !== "SUM" && TEMPORAL.has(summarized.type));
    if (!allowed) return drop("rollup-type", `${op} over ${child.name}.${summarized.name} (${summarized.type}) is not supported`);
    column = NUMERIC.has(summarized.type)
      ? // Precision is raised to 18 so a SUM over many children does not overflow the child's own precision.
        { type: summarized.type, precision: sf.precision ?? Math.max(summarized.precision ?? 18, 18), scale: sf.scale ?? summarized.scale ?? 0 }
      : { type: summarized.type };
  }

  const filters: RollupFilterDef[] = [];
  for (const { item, field } of filterFields) {
    const resolved = resolveFilter(child, field, item);
    if (typeof resolved === "string") return drop("rollup-filter", resolved);
    filters.push(resolved);
  }

  const rollup: RollupDef = { childObject: child.name, foreignKey: fk.name, operation: op, filters };
  if (op !== "COUNT" && summarized) rollup.summarizedField = summarized.name;
  return { kind: "ok", column, rollup };
}

// ---------------------------------------------------------------------------
// Filters (ROLL-03). Every rejection drops the whole roll-up; a filter is never silently ignored (D-06).

type Family = "number" | "date" | "datetime" | "boolean" | "text";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:?\d{2})?$/;
/** `TODAY`, `LAST_N_DAYS:30`: platform date literals, deferred for roll-up filters. */
const DATE_LITERAL_RE = /^[A-Za-z_]+(:\d+)?$/;

/** Filterable stored fields only: formulas and roll-ups are not columns a child-side WHERE can see. */
function familyOf(f: FieldDef): Family | undefined {
  if (f.formula !== undefined || f.rollup !== undefined) return undefined;
  switch (f.type) {
    case "Number":
    case "Currency":
    case "Percent":
      return "number";
    case "Date":
      return "date";
    case "DateTime":
      return "datetime";
    case "Checkbox":
      return "boolean";
    case "Text":
    case "Picklist":
    case "Email":
    case "Phone":
    case "Url":
    case "AutoNumber":
      return "text";
    default:
      return undefined;
  }
}

/** Returns the resolved filter, or the detail of an UNSUPPORTED:rollup-filter warning. */
function resolveFilter(child: SObjectDef, field: FieldDef, item: SourceFilterItem): RollupFilterDef | string {
  const name = `${child.name}.${field.name}`;
  if (!FILTER_OPERATIONS.has(item.operation)) return `filter operation ${item.operation} is not supported`;
  const op = item.operation as RollupFilterOperation;
  const family = familyOf(field);
  if (family === undefined) return `filter field ${name} (${field.type}) cannot be used in a roll-up filter`;
  const comparable = family === "number" || family === "date" || family === "datetime";
  if (RANGE.has(op) && !comparable) return `filter ${name} ${op} is not supported on ${field.type}`;
  if (TEXT_MATCH.has(op) && family !== "text") return `filter ${name} ${op} is not supported on ${field.type}`;

  const tokens = tokenizeFilterValue(item.value);
  if (item.valueField !== undefined) {
    if (tokens.length > 0) return `filter ${name} has both a value and a valueField`;
    if (TEXT_MATCH.has(op)) return `filter ${name} ${op} is not supported with a valueField`;
    const ref = splitRollupRef(item.valueField);
    if (ref && !same(ref.object, child.name)) return `valueField ${item.valueField} is not a field of ${child.name}`;
    const other = findField(child, ref ? ref.field : item.valueField);
    if (!other) return `valueField ${item.valueField} is not defined`;
    if (familyOf(other) !== family) return `valueField ${item.valueField} is not comparable with ${name}`;
    return { field: field.name, operation: op, values: [], valueField: other.name };
  }

  if (RANGE.has(op) && tokens.length !== 1) return `filter ${name} ${op} needs exactly one value`;
  if (TEXT_MATCH.has(op) && tokens.length === 0) return `filter ${name} ${op} needs a value`;
  if (family === "boolean" && tokens.length !== 1) return `filter ${name} ${op} needs exactly one value`;

  const values: string[] = [];
  for (const token of tokens) {
    switch (family) {
      case "number":
        if (!Number.isFinite(Number(token))) return `filter value ${token} is not a valid ${field.type}`;
        break;
      case "date":
      case "datetime":
        if (DATE_LITERAL_RE.test(token)) return `filter value ${token} is a date literal, which roll-up filters do not support yet`;
        if (!(family === "date" ? DATE_RE : DATETIME_RE).test(token)) return `filter value ${token} is not a valid ${field.type}`;
        break;
      case "boolean": {
        const lower = token.toLowerCase();
        if (lower !== "true" && lower !== "false") return `filter value ${token} is not a valid ${field.type}`;
        values.push(lower);
        continue;
      }
      case "text":
        break;
    }
    values.push(token);
  }
  return { field: field.name, operation: op, values };
}
