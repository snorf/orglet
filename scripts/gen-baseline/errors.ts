/**
 * The one error type the baseline generator throws. It lives in its own module so sources.ts, typemap.ts and
 * pipeline.ts can share it without an import cycle; pipeline.ts re-exports it for callers. Every message names the
 * `Object.Field` it concerns so a CI failure points at a concrete source fact, pin or override.
 */
export class GeneratorError extends Error {
  override name = "GeneratorError";
}
