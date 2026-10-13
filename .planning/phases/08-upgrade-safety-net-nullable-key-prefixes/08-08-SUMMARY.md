---
phase: 08-upgrade-safety-net-nullable-key-prefixes
plan: 08
subsystem: formula
tags: [sigha, upstream, lexer, parser, formula]
requires: []
provides:
  - "Local upstream clone /Users/johankarlsteen/Development.nosync/sigha-upstream with branches feat/unary-bang (6b02be3) and feat/polymorphic-colon-ref (8f93df6)"
affects: [08-09, 08-10, phase-12]
tech-stack:
  added: []
  patterns: ["upstream-first fixes to vendored sigha (D-19, no local patch)"]
key-files:
  created: []
  modified: ["(upstream clone only) src/syntax/lexer.ts, ast.ts, parser.ts, engine/evaluator.ts, analysis/checker.ts, features/field-extraction.ts, i18n/en/syntax.ts and tests"]
key-decisions:
  - "Unary ! reuses BUILTINS.NOT in the evaluator (blank -> blank Boolean, as NOT) rather than reimplementing"
  - "Colon handled purely in scanIdentifier: Owner:User is one identifier segment, zero parser/AST change"
requirements-completed: [BASE2-05]
duration: 15min
completed: 2026-10-13
---

# Phase 8 Plan 08: Upstream sigha branches (unary `!`, polymorphic colon ref) Summary

Two small local branches in a fresh clone of rfaulhaber/sigha: lone `!` as logical NOT, and `Owner:User.Email` lexed as segment `Owner:User` plus `.Email`. Nothing pushed, no fork, no PR; orglet's `packages/sigha` untouched.

## Toolchain (recorded before install)

- Package manager: pnpm (`pnpm-lock.yaml`, lockfileVersion 9.0); no `packageManager` field in package.json; `pnpm-workspace.yaml` present.
- Node: no `.nvmrc`/`.node-version`/`engines`; used nvm Node v22.23.3 (already installed, default shell is 18.20.8).
- pnpm was not on PATH. Used `corepack pnpm ...` (pnpm 12.6.0) per call, without `corepack enable` and without any global install.
- Runner: vitest 4.1.10. Commands: `pnpm test` (`vitest run --config vitest.config.ts`), `pnpm typecheck` (`tsc --noEmit`), `pnpm lint` (`eslint .`); prettier `--check src` also run.
- Install: `pnpm install --frozen-lockfile` inside the clone only.
- Baseline on main: 22 files, 385 tests passed.

## Results

| Branch | Commit | Tests | typecheck | lint |
|---|---|---|---|---|
| feat/unary-bang | 6b02be3 | 22 files, 397 passed | clean | clean |
| feat/polymorphic-colon-ref | 8f93df6 | 22 files, 391 passed | clean | clean |

Both branches are off origin/main (2abe5db), have no upstream tracking ref (unset), the only remote is `origin` (rfaulhaber/sigha), repo-local identity is Johan Karlsteen <johan@karlsteen.com>. Colon branch diff touches only `src/syntax/lexer.ts`, `lexer.test.ts`, `parser.test.ts`. Corpus `org-verified.json` untouched.

## Changes

feat/unary-bang: lexer emits `operator` for `!` not followed by `=` (unexpectedBang message removed); `UnaryOperator` gains `"!"`; `parseUnary` accepts it with the existing depth guard; evaluator maps `!x` to `BUILTINS.NOT`; checker requires boolean operand and types the result Boolean; field extraction infers Boolean for the operand; formatter needed no change (prints `!` + operand, parenthesizes via unary precedence). The old "lone ! is an error token" lexer test was replaced.

feat/polymorphic-colon-ref: `scanIdentifier` absorbs `:Identifier` when `:` is followed by an identifier start.

## PR description drafts (for 08-09 / 08-10, not opened)

### PR 1: feat: accept unary `!` as logical NOT

The formula-engine grammar (salesforce/formula-engine, BSD-3) defines `BANG : '!'` and `unaryExpression : ... | BANG unaryExpression #unaryExpression_bang`, rewritten to NOT. Sigha currently reports a lone `!` as an unexpected character. This lexes `!` as an operator when not followed by `=`, parses it as a prefix operator (same depth guard as sign), and evaluates it through the existing NOT builtin so blank handling is identical. The checker requires a boolean operand and types the result Boolean; field extraction infers Boolean. `!=` is unchanged.

Tests: lexer (`!` token, `!=` and `"a!b"` unchanged); evaluator (`!TRUE`, `!FALSE`, `!!TRUE`, `!(1 > 2)`, `!ISBLANK("")`, `!ISBLANK("x")`, precedence vs `&&`/`||`, `!=` semantics, `!x` equals `NOT(x)` for blank booleans in both blank modes and for true/false); checker (accepts boolean/unknown, flags `!1`, usable as IF condition); field extraction; formatter round-trip (`!ISBLANK(x)`, `! ISBLANK(x)`, `!(a && b)`). No expectation comes from an org.

### PR 2: feat: lex Relationship:Object polymorphic field references as one path segment

formula-engine names a polymorphic relationship `Owner:User` (`FormulaUtils.getPolymorphicFieldName`, `DOMAIN_DELIMETER ':'`; `LexerRules.g4 COLON`). Sigha reports the colon as an unexpected character. `scanIdentifier` now absorbs `:Identifier` into the segment, so `Owner:User.Email` lexes as `Owner:User`, `.`, `Email` and parses to `FieldRef.path = ["Owner:User", "Email"]` with no parser or AST change. Formulas use `:` nowhere else between identifiers. Type-neutral: `Owner:Group` and `Owner:Queue` are both passed through.

Tests: lexer (segment + dot + field; colons in `"..."` and `'...'` untouched; `Owner: User`, `Owner:`, `Owner:1` still diagnosed; `$User.Email` and `Account.Name` unchanged); parser (`Owner:User.Email`, `Owner:Group.Name`, `Owner:Queue.QueueName` paths, use inside `ISBLANK(...)`).

## Deviations from Plan

None - plan executed as written. Notes: branches initially tracked origin/main by default checkout behaviour; tracking was unset to satisfy the "never pushed, no upstream" criterion. The clone was left checked out on `main`.

## Known Stubs

None.

## Self-Check: PASSED

Commits 6b02be3 and 8f93df6 exist in the clone; `git status --porcelain packages/sigha` empty in orglet.
