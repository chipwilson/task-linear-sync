/**
 * `src/titles` module barrel (005-owned). Public subpath export registration (`./titles`)
 * is a Wave-3 integration concern (plan.md § Structure Decision / research R3); Wave-2
 * tests import this barrel's compiled output by relative path under `build/`. Consumers
 * use the 005-local value objects (`TitleRule`, `TitleDerivation`) and plain strings
 * documented in specs/005-routing-title-derivation/contracts/ — never module internals.
 */
export { parseTitleRules, TitleRuleParseError } from "./rules.js";
export { evaluateGuard } from "./match.js";
export { renderTemplate } from "./template.js";
export { decorateFeaturePrefix } from "./decorate.js";
export { stripTitleForRender } from "./strip.js";
export { deriveTitle } from "./derive.js";
export type {
  TitleConfigSlice,
  TitleDerivation,
  TitlePredicate,
  TitlePredicateAttr,
  TitlePredicateOp,
  TitleRule,
} from "./types.js";
