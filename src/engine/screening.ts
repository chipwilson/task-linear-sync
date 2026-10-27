/**
 * Built-in `SecurityScreener` (research R12; frozen interface shape in
 * `src/ports/engine.ts`; implemented by T010; unit tests T006; security contract T039).
 * Category-tagged rules — blocking: token/secret-shaped strings (high-entropy
 * assignments, known provider key prefixes), private-key blocks; non-blocking: email
 * addresses (redacted in output), review-term annotations. The engine pipes EVERY string
 * crossing a boundary through `screen()` before transmission; `blocked.length > 0`
 * aborts propagation of that content only (op fails with a sanitized detail naming
 * finding categories, never content). The ruleset is overridable (constitution III) via
 * `EngineOptions.screener` and `createDefaultSecurityScreener`'s `rules` parameter.
 *
 * Output posture per R12 (alternatives (c)): blocking matches are NEVER echoed — the
 * matched region is replaced with a category-only sentinel `[blocked:<category>]`
 * (blocked findings abort propagation; they are not sanitized into acceptability — the
 * sentinel only keeps multi-section content identifiable by category). Non-blocking
 * rules either redact (`[redacted:<category>]`, email posture) or annotate
 * (`<match>[<category>]`, review-term posture). Deterministic, zero network, zero
 * scanner state across calls (Principles III/VI).
 */
import type { ResolvedConfig } from "../config/schema.js";
import type { SecurityScreener } from "../ports/engine.js";

/**
 * One category-tagged screening rule (008-local refinement of research R12's "ruleset").
 * `pattern` is a RegExp source matched against each propagated string (compiled `gi`).
 * `category`/`blocking` are stable (finding labels surface verbatim).
 */
export interface ScreenerRule {
  /** Finding category label surfaced in `blocked`/`findings` (e.g. "secret-token"). */
  readonly category: string;
  /** RegExp source matched against propagated text (zero real org literals — Principle III). */
  readonly pattern: string;
  /** true ⇒ blocking (propagation aborted); false ⇒ non-blocking (redact/annotate). */
  readonly blocking: boolean;
  /**
   * Non-blocking handling only (ignored when `blocking` — blocked content is never echoed,
   * only category-tagged): absent/true ⇒ matches replaced with `[redacted:<category>]`
   * (email posture); false ⇒ annotate — match kept verbatim and tagged `<match>[<category>]`
   * (review-term posture, research R12 "redact/annotate").
   */
  readonly redact?: boolean;
}

/** Injectable ruleset (research R12: "The ruleset is an injectable ... override"). */
export type ScreeningRuleSet = readonly ScreenerRule[];

/** Rule flags: `g` (every occurrence) + `i` (provider prefixes robust to casing). */
const RULE_FLAGS = "gi";

/** Escape literal text for safe embedding in a RegExp source. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ── Built-in pattern sources (heuristic set — R12; synthetic shapes only, Principle III) ──

/** PEM/OpenSSH-style private-key block: header … END header (or to end of text). */
const PRIVATE_KEY_BLOCK = String.raw`-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----(?:.|\n)*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)`;

/**
 * Credential-shaped assignment (`api_key=…`, `"apiKey": "…"`, `deploy key = "…"`): a
 * credential-ish name, `:`/`=`, then a high-entropy value — ≥12 chars of the base64-ish
 * class containing BOTH letters and digits (R12: HIGH-entropy assignments block; short
 * low-entropy values are not this category).
 */
const CREDENTIAL_ASSIGNMENT = String.raw`\b(?:api|access|refresh|auth(?:orization)?|client|session|encryption|signing|recovery|private)?[ _-]?(?:key|token|secret|pass(?:word|wd)?|pwd|credentials?)\b["']?\s*[:=]\s*["']?(?=[A-Za-z0-9+/=_-]{12,}(?![A-Za-z0-9+/=_-]))(?=[A-Za-z0-9+/=_-]*[A-Za-z])(?=[A-Za-z0-9+/=_-]*[0-9])[A-Za-z0-9+/=_-]{12,}`;

/** Known provider key prefixes: GitHub PAT / fine-grained token. */
const GITHUB_TOKEN = String.raw`gh[pousr]_[A-Za-z0-9]{16,}|github_pat_[A-Za-z0-9_]{22,}`;
/** Known provider key prefixes: OpenAI (`sk-`, `sk-proj-`). */
const OPENAI_KEY = String.raw`sk-(?:proj-)?[A-Za-z0-9_-]{20,}`;
/** Known provider key prefixes: Slack (`xoxb-`/`xoxa-`/`xoxp-`/`xoxr-`/`xoxs-`/`xoxe-`). */
const SLACK_TOKEN = String.raw`xox[baprse]-[A-Za-z0-9-]{10,}`;
/** Known provider key prefixes: Google API key (`AIza…`). */
const GOOGLE_KEY = String.raw`AIza[0-9A-Za-z_-]{20,}`;
/** Bearer-credential material (session dumps, `Authorization:` lines). */
const BEARER_TOKEN = String.raw`\bbearer[ _-]?(?=[A-Za-z0-9._~+/=-]{20,}(?![A-Za-z0-9._~+/=-]))(?=[A-Za-z0-9._~+/=-]*[0-9])(?=[A-Za-z0-9._~+/=-]*[A-Za-z])[A-Za-z0-9._~+/=-]{20,}`;

/** Email addresses (non-blocking — redacted in output). */
const EMAIL_ADDRESS = String.raw`(?<![\w.+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+(?![\w.-])`;

/** Author-marked review terms (non-blocking — annotated, content kept verbatim). */
const REVIEW_TERMS = String.raw`\b(?:REVIEW REQUIRED|DO NOT SYNC|DO NOT PUBLISH)\b`;

/**
 * The built-in heuristic rule set (research R12): blocking token/secret-shaped strings
 * (using `config.personalKeyPrefix` shaped material and provider-prefix heuristics) and
 * private-key blocks; non-blocking email redaction and review-term annotations. Rule
 * ORDER is significant: blocking rules run first (so redaction/annotation never sees —
 * or partially rewrites — blocked content), then redact, then annotate.
 */
export function builtInScreeningRules(config: ResolvedConfig): ScreeningRuleSet {
  const personalPrefix = config.personalKeyPrefix.trim();
  const rules: ScreenerRule[] = [
    { category: "private-key", pattern: PRIVATE_KEY_BLOCK, blocking: true },
    { category: "secret-token", pattern: CREDENTIAL_ASSIGNMENT, blocking: true },
    { category: "secret-token", pattern: GITHUB_TOKEN, blocking: true },
    { category: "secret-token", pattern: OPENAI_KEY, blocking: true },
    { category: "secret-token", pattern: SLACK_TOKEN, blocking: true },
    { category: "secret-token", pattern: GOOGLE_KEY, blocking: true },
    { category: "secret-token", pattern: BEARER_TOKEN, blocking: true },
    { category: "email", pattern: EMAIL_ADDRESS, blocking: false },
    { category: "review-term", pattern: REVIEW_TERMS, blocking: false, redact: false },
  ];
  if (personalPrefix.length >= 2) {
    // Personal-key-shaped material derived from config — never a hardcoded org token.
    const personal: ScreenerRule = {
      category: "secret-token",
      pattern: `${escapeRegExp(personalPrefix)}[A-Za-z0-9]{12,}`,
      blocking: true,
    };
    rules.splice(6, 0, personal); // keep provider-prefix rules adjacent, before bearer
  }
  return rules;
}

/** Compiled plan entry (source kept; RegExp is built fresh per `screen()` call —
 *  zero cross-call scanner state ⇒ deterministic repeated screens). */
interface ScreenPlanEntry {
  readonly category: string;
  readonly pattern: string;
  readonly blocking: boolean;
  readonly redact: boolean;
}

/**
 * The built-in default `SecurityScreener` (frozen `screen()` shape: `{ output, blocked,
 * findings }`). `rules` overrides the built-in set (config-listed rule profile / test
 * fakes) — a full replacement, never a merge. Blocking findings abort propagation of the
 * affected content ONLY; the matched region is replaced by a `[blocked:<category>]`
 * sentinel (content identifiable only by category, never echoed). Emails are redacted in
 * `output`; annotation rules (non-blocking `redact: false`) tag matches in place.
 * `findings`/`blocked` list unique category labels in rule-application order.
 */
export function createDefaultSecurityScreener(
  config: ResolvedConfig,
  rules: ScreeningRuleSet = builtInScreeningRules(config),
): SecurityScreener {
  const plan: ScreenPlanEntry[] = rules.map((rule) => {
    void new RegExp(rule.pattern, RULE_FLAGS); // fail fast at construction on bad sources
    return {
      category: rule.category,
      pattern: rule.pattern,
      blocking: rule.blocking,
      redact: rule.redact ?? true,
    };
  });
  return {
    screen(text) {
      const blocked: string[] = [];
      const findings: string[] = [];
      let output = text;
      for (const rule of plan) {
        const re = new RegExp(rule.pattern, RULE_FLAGS);
        if (!re.test(output)) continue;
        if (!findings.includes(rule.category)) findings.push(rule.category);
        if (rule.blocking) {
          if (!blocked.includes(rule.category)) blocked.push(rule.category);
          const sentinel = `[blocked:${rule.category}]`;
          output = output.replace(re, () => sentinel);
        } else if (rule.redact) {
          const sentinel = `[redacted:${rule.category}]`;
          output = output.replace(re, () => sentinel);
        } else {
          const tag = `[${rule.category}]`;
          output = output.replace(re, (match) => `${match}${tag}`);
        }
      }
      return { output, blocked, findings };
    },
  };
}
