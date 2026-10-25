/**
 * `parseTitleRules` — deterministic, TOTAL interpretation of the frozen
 * `ResolvedConfig.titleRules: readonly string[]` via the research-R2 entry grammar:
 *
 *   <rule>     ::= <guard> " => " <template> | <template>     // no arrow ⇒ catch-all
 *   <guard>    ::= <cond> ( "," <cond> )*                     // AND of all conditions
 *   <cond>     ::= [ "!" ] <attr> [ <op> <literal> ]
 *   <attr>     ::= featureName | localId | phase | framework | kind | path | child | issueRef
 *   <op>       ::= "=" (equality) | "~" (starts-with, path only)
 *   <template> ::= text with {placeholder} tokens; a literal arrow is escaped as "\=>"
 *
 * Malformed rules raise the typed, index-carrying `TitleRuleParseError` at PARSE time —
 * never silently treated as a template (research R2).
 */
import type { TitlePredicate, TitlePredicateAttr, TitleRule } from "./types.js";

/** Typed parse failure carrying the offending array index and rule source (data-model §3). */
export class TitleRuleParseError extends Error {
  override readonly name = "TitleRuleParseError";
  readonly index: number;
  readonly rule: string;
  readonly reason: string;

  constructor(index: number, rule: string, reason: string) {
    super(`title rule [${index}] '${rule}' is malformed: ${reason}`);
    this.index = index;
    this.rule = rule;
    this.reason = reason;
  }
}

/** Attribute selector set frozen for the guard grammar (data-model §4). */
const GUARD_ATTRS: ReadonlySet<string> = new Set([
  "featureName",
  "localId",
  "phase",
  "framework",
  "kind",
  "path",
  "child",
  "issueRef",
]);

/** `[!]attr` optionally followed by `=literal` or `~literal`. */
const CONDITION_RE = /^(!)?([A-Za-z][A-Za-z0-9]*)(?:([=~])(.*))?$/;

const ARROW = " => ";

/** Unescape the escaped literal arrow form `\=>` → `=>` (stored unescaped after parse). */
function unescapeArrow(text: string): string {
  return text.replace(/\\=>/g, "=>");
}

function parseCondition(raw: string, index: number, rule: string, guardText: string): TitlePredicate {
  const cond = raw.trim();
  if (cond === "") {
    throw new TitleRuleParseError(index, rule, `empty condition in guard '${guardText}'`);
  }
  const match = CONDITION_RE.exec(cond);
  if (match === null) {
    throw new TitleRuleParseError(index, rule, `'${cond}' is not 'attr', '!attr', 'attr=value' or 'path~value'`);
  }
  const [, bang, attr, op, literal] = match;
  if (attr === undefined || !GUARD_ATTRS.has(attr)) {
    throw new TitleRuleParseError(index, rule, `unknown attribute '${attr ?? cond}' (guard grammar R2)`);
  }
  const negated = bang === "!";
  if (op === undefined) {
    return { attr: attr as TitlePredicateAttr, negated, op: "present" };
  }
  if (op === "~" && attr !== "path") {
    throw new TitleRuleParseError(index, rule, `'~' (starts-with) is only valid on the path attribute, not '${attr}'`);
  }
  const value = (literal ?? "").trim();
  if (value === "") {
    throw new TitleRuleParseError(index, rule, `missing literal after '${attr}${op}'`);
  }
  return { attr: attr as TitlePredicateAttr, negated, op: op === "=" ? "eq" : "startsWith", value };
}

/**
 * Parse the raw rule strings in config order (array index = `order` = first-match-wins
 * evaluation order). A rule with no `" => "` is a bare catch-all template (`when` absent).
 */
export function parseTitleRules(raw: readonly string[]): TitleRule[] {
  return raw.map((source, index) => {
    const arrow = source.indexOf(ARROW); // splits on the FIRST " => " only
    if (arrow === -1) {
      return { order: index, template: unescapeArrow(source) };
    }
    const guardText = source.slice(0, arrow).trim();
    const template = unescapeArrow(source.slice(arrow + ARROW.length));
    if (guardText === "") {
      throw new TitleRuleParseError(index, source, "empty guard before ' => '");
    }
    const when = guardText
      .split(",")
      .map((part) => parseCondition(part, index, source, guardText));
    return { order: index, when, template };
  });
}
