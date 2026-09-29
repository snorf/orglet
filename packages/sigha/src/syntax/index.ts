/**
 * syntax/ — lexer, parser (recursive descent + Pratt), AST types, spans, comments.
 *
 * Bottom of the stack: zero dependencies on any layer above, and no knowledge of
 * specific functions (names are just identifiers at parse time). Lexing never
 * fails; parsing recovers and always returns `{ ast, diagnostics[] }`.
 */
export * from "./span.js";
export * from "./diagnostic.js";
export * from "./token.js";
export * from "./ast.js";
export {
  classifyPasteChar,
  codePointHex,
  CONFUSABLE_REPLACEMENTS,
  findPasteCharRuns,
  isBlankSource,
  PASTE_CHAR_PATTERN,
  type PasteCharKind,
  type PasteCharRun,
} from "./chars.js";
export { lex } from "./lexer.js";
export { parse, BINARY_PRECEDENCE, type ParseResult } from "./parser.js";
export { astEqual } from "./equal.js";
