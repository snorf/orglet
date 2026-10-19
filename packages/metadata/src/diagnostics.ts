/**
 * Structured records behind every UNSUPPORTED:<area> warning (D-13..D-15). Each warning source builds a
 * Diagnostic and derives its string with formatDiagnostic, so the printed `warning:` lines stay exactly as they
 * were while later phases (the Phase 14 report) can count per area and group cascaded failures by cause.
 */

/** One recognised-but-unsupported thing. `message` is everything after `UNSUPPORTED:<area> `, verbatim. */
export interface Diagnostic {
  /** The `<area>` token of `UNSUPPORTED:<area>`, e.g. `schema-fk`, `formula`, `reference-target`. */
  area: string;
  message: string;
  /** API name of the object concerned, when there is one. */
  object?: string;
  /** API name of the field concerned, when there is one. */
  field?: string;
  /** Key of the root-cause diagnostic this one follows from (grouping in the Phase 14 report). */
  cause?: string;
}

/** Metadata that was skipped rather than loaded. */
export interface SkippedItem extends Diagnostic {
  kind: "object" | "field" | "rollup" | "rule";
}

/** A formula, validation rule or default value that did not compile. */
export interface FormulaFailure extends Diagnostic {
  /** Human label of the formula, e.g. `formula field Case.X__c`. */
  what: string;
  /** The field reference that could not be resolved, when that is why it failed. */
  missing?: { object: string; field: string };
}

/**
 * Informational: a standard object orglet recognises, does not model, and nothing references (BASE2-08, D-06..D-08).
 * Never a warning, never counted by `--strict`; kept beside, not inside, the warnings/diagnostics pair so their 1:1
 * invariant holds. Phase 14 expands these into its --summary/--json report without a string change.
 */
export interface InfoDiagnostic extends Diagnostic {
  severity: "info";
}

export function formatDiagnostic(d: Diagnostic): string {
  return `UNSUPPORTED:${d.area} ${d.message}`;
}

/** The `warnings` / `diagnostics` pair every result object carries. */
export interface DiagnosticSink {
  readonly warnings: string[];
  readonly diagnostics: Diagnostic[];
}

/** Record a diagnostic and its warning string together, in the same order, so the two lists never drift. */
export function pushDiagnostic<D extends Diagnostic>(sink: DiagnosticSink, d: D): void {
  sink.diagnostics.push(d);
  sink.warnings.push(formatDiagnostic(d));
}
