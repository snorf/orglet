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

export function formatDiagnostic(d: Diagnostic): string {
  return `UNSUPPORTED:${d.area} ${d.message}`;
}

/** The `warnings` / `diagnostics` pair every result object carries. */
export interface DiagnosticSink {
  readonly warnings: string[];
  readonly diagnostics: Diagnostic[];
}

/** Record a diagnostic and its warning string together, in the same order, so the two lists never drift. */
export function pushDiagnostic(sink: DiagnosticSink, d: Diagnostic): void {
  sink.diagnostics.push(d);
  sink.warnings.push(formatDiagnostic(d));
}
