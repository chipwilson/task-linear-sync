/**
 * Built-in `SecurityScreener` (research R12; frozen interface shape in
 * `src/ports/engine.ts`; task T010 implements; unit tests T006; security contract T039).
 * Category-tagged rules — blocking: token/secret-shaped strings (high-entropy
 * assignments, known provider key prefixes), private-key blocks; non-blocking: email
 * addresses (redacted in output), review-term annotations. The engine pipes EVERY string
 * crossing a boundary through `screen()` before transmission; `blocked.length > 0`
 * aborts propagation of that content only (op fails with a sanitized detail naming
 * finding categories, never content). The ruleset is overridable (constitution III) via
 * `EngineOptions.screener` and `createDefaultSecurityScreener`'s `rules` parameter.
 */
import type { ResolvedConfig } from "../config/schema.js";
import type { SecurityScreener } from "../ports/engine.js";

/**
 * One category-tagged screening rule (008-local refinement of research R12's "ruleset").
 * `pattern` is a RegExp source matched against each propagated string. T006/T010 may
 * refine this shape; keep `category`/`blocking` stable (finding labels surface verbatim).
 */
export interface ScreenerRule {
  /** Finding category label surfaced in `blocked`/`findings` (e.g. "secret-token"). */
  readonly category: string;
  /** RegExp source matched against propagated text (zero real org literals — Principle III). */
  readonly pattern: string;
  /** true ⇒ blocking (propagation aborted); false ⇒ non-blocking (redact/annotate). */
  readonly blocking: boolean;
}

/** Injectable ruleset (research R12: "The ruleset is an injectable ... override"). */
export type ScreeningRuleSet = readonly ScreenerRule[];

/**
 * The built-in heuristic rule set (research R12): blocking token/secret-shaped strings
 * (using `config.personalKeyPrefix` shaped material and provider-prefix heuristics) and
 * private-key blocks; non-blocking email redaction and review-term annotations.
 * T010 implements (T006).
 */
export function builtInScreeningRules(config: ResolvedConfig): ScreeningRuleSet {
  void [config]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: screening");
}

/**
 * The built-in default `SecurityScreener` (frozen `screen()` shape: `{ output, blocked,
 * findings }`). `rules` overrides the built-in set (config-listed rule profile / test
 * fakes). Blocking findings abort propagation of the affected content ONLY; emails are
 * redacted in `output`. T010 implements (T006).
 */
export function createDefaultSecurityScreener(
  config: ResolvedConfig,
  rules?: ScreeningRuleSet,
): SecurityScreener {
  void [config, rules]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: screening");
}
