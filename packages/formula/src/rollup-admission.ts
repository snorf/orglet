/** Admission of roll-up summaries that read formula fields (ROLL2-01, Phase 13 D-01..D-09). Runs after buildOrgSchema, because @orglet/metadata cannot compile formulas and compileFormula needs the finished schema; it must run before DDL is planned so a rejected roll-up never gets a column (D-06). The allowed set follows the "Roll-Up Summary Field" Help restrictions (no cross-object references, no functions that derive values on the fly such as NOW or TODAY); orglet also rejects evaluation-time globals ($User, $Profile, $Organization, $RecordType, $UserRole, $Setup, $Api) for the same reason (stricter than documented, D-01). $Label, $CustomMetadata and $System.OriginDateTime are compile-time constants and allowed. */
import { OrgSchemaImpl, pushDiagnostic } from "@orglet/metadata";
import type { BuildResult, DiagnosticSink, FieldDef, SObjectDef, SkippedItem } from "@orglet/metadata";
import { compileFormula, FormulaCompileError } from "./compile.js";
import type { FormulaDependencies, GlobalRoot } from "./compile.js";
import { formulaInputs } from "./rollup-inputs.js";
import type { FormulaLookup } from "./rollup-inputs.js";

const CONSTANT_GLOBALS: ReadonlySet<GlobalRoot> = new Set<GlobalRoot>(["$Label", "$CustomMetadata", "$System"]);

/** The `cause` format shared with the other build diagnostics: `<area>:<Object>.<Field>`. */
const keyOf = (area: string, object: string, field: string): string => `${area}:${object}.${field}`;
const lowerKey = (object: string, field: string): string => `${object}.${field}`.toLowerCase();

type Compiled = { deps: FormulaDependencies } | { error: FormulaCompileError };

interface RollupItem {
  parent: SObjectDef;
  field: FieldDef;
  child: SObjectDef;
  /** Summarized field, then each filter field and valueField, de-duplicated case-insensitively (as written when unresolved). */
  inputs: string[];
}

interface Drop {
  item: RollupItem;
  area: string;
  message: string;
  cause?: string;
}

export function admitFormulaRollups(build: BuildResult): BuildResult {
  const sink: DiagnosticSink = { warnings: [...build.warnings], diagnostics: [...build.diagnostics] };
  /** lower "Obj.Field" of a removed roll-up -> its diagnostic key. */
  const removed = new Map<string, string>();
  let schema = build.schema;
  let produced = false;

  for (;;) {
    const current = schema;
    const cache = new Map<string, Compiled>();
    const compiled = (obj: SObjectDef, f: FieldDef): Compiled => {
      const key = lowerKey(obj.name, f.name);
      let hit = cache.get(key);
      if (hit === undefined) {
        try {
          hit = {
            deps: compileFormula(f.formula ?? "", {
              schema: current,
              objectName: obj.name,
              context: "formula_field",
              ...(f.formulaTreatBlanksAs ? { treatBlanksAs: f.formulaTreatBlanksAs } : {}),
            }).dependencies,
          };
        } catch (e) {
          if (!(e instanceof FormulaCompileError)) throw e;
          hit = { error: e };
        }
        cache.set(key, hit);
      }
      return hit;
    };
    const lookup: FormulaLookup = (o, n) => {
      const obj = current.getObject(o);
      const f = current.getField(o, n);
      if (obj === undefined || f?.formula === undefined) return undefined;
      const c = compiled(obj, f);
      return "deps" in c ? c.deps : undefined;
    };

    const items: RollupItem[] = [];
    for (const parent of [...current.objects.values()].sort((a, b) => a.name.localeCompare(b.name))) {
      for (const field of parent.fields) {
        const r = field.rollup;
        if (r === undefined) continue;
        const child = current.getObject(r.childObject);
        if (child === undefined) continue;
        const seen = new Set<string>();
        const inputs: string[] = [];
        for (const name of [r.summarizedField, ...r.filters.flatMap((f) => [f.field, f.valueField])]) {
          if (name === undefined || seen.has(name.toLowerCase())) continue;
          seen.add(name.toLowerCase());
          inputs.push(current.getField(child.name, name)?.name ?? name);
        }
        items.push({ parent, field, child, inputs });
      }
    }

    /** Graph successors of a roll-up or formula node: same-object formula/roll-up reads and roll-up inputs on the child. */
    const successors = (obj: string, name: string): { obj: string; name: string }[] => {
      const o = current.getObject(obj);
      const f = current.getField(obj, name);
      if (o === undefined || f === undefined) return [];
      const out: { obj: string; name: string }[] = [];
      const add = (on: string, n: string): void => {
        const t = current.getField(on, n);
        if (t !== undefined && (t.formula !== undefined || t.rollup !== undefined)) out.push({ obj: current.getObject(on)?.name ?? on, name: t.name });
      };
      if (f.rollup !== undefined) {
        const item = items.find((i) => i.parent === o && i.field === f);
        for (const n of item?.inputs ?? []) add(f.rollup.childObject, n);
      } else if (f.formula !== undefined) {
        const c = compiled(o, f);
        if ("deps" in c) for (const e of c.deps.fields) if (e.path.length === 0) for (const n of e.fields) add(o.name, n);
      }
      return out;
    };

    /** First simple cycle through the roll-up that also contains a formula (pure roll-up cycles are metadata's rollup-cycle). */
    const cycleThrough = (item: RollupItem): string | undefined => {
      const start = lowerKey(item.parent.name, item.field.name);
      const path: { obj: string; name: string }[] = [{ obj: item.parent.name, name: item.field.name }];
      const walk = (): string | undefined => {
        const last = path[path.length - 1] as { obj: string; name: string };
        for (const next of successors(last.obj, last.name)) {
          const k = lowerKey(next.obj, next.name);
          if (k === start) {
            const hasFormula = path.some((p) => current.getField(p.obj, p.name)?.formula !== undefined);
            if (hasFormula) return [...path, next].map((p) => `${p.obj}.${p.name}`).join(" -> ");
            continue;
          }
          if (path.some((p) => lowerKey(p.obj, p.name) === k)) continue;
          path.push(next);
          const found = walk();
          path.pop();
          if (found !== undefined) return found;
        }
        return undefined;
      };
      return walk();
    };

    const violation = (obj: SObjectDef, name: string): { reason: string; cause?: string } | undefined => {
      const f = current.getField(obj.name, name);
      if (f?.formula === undefined) return undefined;
      const c = compiled(obj, f);
      if ("error" in c) {
        const m = c.error.missing;
        const cause = m !== undefined ? removed.get(lowerKey(m.object, m.field)) : undefined;
        return { reason: `does not compile (${c.error.message})`, ...(cause !== undefined ? { cause } : {}) };
      }
      const cross = c.deps.fields.find((e) => e.path.length > 0);
      if (cross !== undefined) return { reason: `reads ${cross.path.join(".")}.${cross.fields[0] ?? ""} (cross-object)` };
      if (c.deps.volatile) return { reason: `uses ${(c.deps.volatileReasons ?? []).join(", ") || "a volatile function or global"}` };
      const global = c.deps.globals.find((g) => !CONSTANT_GLOBALS.has(g));
      if (global !== undefined) return { reason: `uses ${global}` };
      return undefined;
    };

    const cascades: Drop[] = [];
    const cycles: Drop[] = [];
    const formulas: Drop[] = [];
    for (const item of items) {
      const { parent, field, child } = item;
      const who = `${parent.name}.${field.name}`;
      const gone = item.inputs.find((n) => current.getField(child.name, n) === undefined && removed.has(lowerKey(child.name, n)));
      if (gone !== undefined) {
        cascades.push({ item, area: "rollup-target", cause: removed.get(lowerKey(child.name, gone)) as string, message: `${who}: ${child.name}.${gone} was skipped; field skipped` });
        continue;
      }
      const path = cycleThrough(item);
      if (path !== undefined) {
        cycles.push({ item, area: "rollup-cycle", message: `${who}: roll-up summaries and formula fields read each other in a cycle (${path}); field skipped` });
        continue;
      }
      for (const input of item.inputs) {
        if (current.getField(child.name, input)?.formula === undefined) continue;
        const walk = formulaInputs(current, lookup, child.name, input);
        let found: { reason: string; cause?: string; offender: string } | undefined;
        if (walk.cycle !== undefined) found = { reason: `is part of a formula cycle (${walk.cycle})`, offender: input };
        else {
          for (const name of walk.formulas) {
            const v = violation(child, name);
            if (v !== undefined) {
              found = { ...v, offender: name };
              break;
            }
          }
        }
        if (found === undefined) continue;
        const via = found.offender === input ? "" : ` via ${child.name}.${found.offender}`;
        formulas.push({ item, area: "rollup-formula", ...(found.cause !== undefined ? { cause: found.cause } : {}), message: `${who}: ${child.name}.${input} ${found.reason}${via}; field skipped` });
        break;
      }
    }

    const drops = [...cascades, ...cycles, ...formulas];
    if (drops.length === 0) break;
    produced = true;
    const gone = new Set<string>();
    for (const d of drops) {
      const { parent, field } = d.item;
      pushDiagnostic(sink, { area: d.area, kind: "rollup", object: parent.name, field: field.name, message: d.message, ...(d.cause !== undefined ? { cause: d.cause } : {}) } satisfies SkippedItem);
      removed.set(lowerKey(parent.name, field.name), keyOf(d.area, parent.name, field.name));
      gone.add(lowerKey(parent.name, field.name));
    }
    const objects = new Map([...current.objects].map(([k, o]) => [k, o.fields.some((f) => gone.has(lowerKey(o.name, f.name))) ? { ...o, fields: o.fields.filter((f) => !gone.has(lowerKey(o.name, f.name))) } : o] as const));
    schema = new OrgSchemaImpl(objects, current.globalValueSets, current.standardValueSets, current.labels);
  }

  if (!produced) return build;
  return { ...build, schema, warnings: sink.warnings, diagnostics: sink.diagnostics };
}
