/**
 * 005-local title-derivation model (data-model.md §3–7). The frozen 002 `Task` is
 * **imported**, never re-declared (ROADMAP rule 2 / 002 FR-008); the frozen
 * `ResolvedConfig.titleRules` / `titleStripPrefixes` (`readonly string[]`) and
 * `confirmationKey` strings are *interpreted* here per research R2/R6, never retyped.
 */
import type { Task } from "../domain/task.js"; // FROZEN 002 — imported, not redefined

/**
 * Frozen-`Task` fields the title predicates read (data-model §4). The pin documents the
 * attr→field mapping (`framework` ⇔ `frameworkId`, `path` ⇔ `filePath`, `child` ⇔
 * `parentUuid`, `issueRef` ⇔ `issueRef`) via a type import — never a re-declaration.
 */
export type TitleTaskAttrPin = Pick<
  Task,
  "featureName" | "localTaskId" | "phase" | "frameworkId" | "kind" | "filePath" | "parentUuid" | "issueRef"
>;

/** Attribute selector (001 R6.4 attribute set + `child`/`path` for area/child conditions). */
export type TitlePredicateAttr =
  | "featureName"
  | "localId"
  | "phase"
  | "framework"
  | "kind"
  | "path"
  | "child"
  | "issueRef";

/** `"present"` for a bare attr; `"eq"` for `attr=value`; `"startsWith"` only for `path~value`. */
export type TitlePredicateOp = "present" | "eq" | "startsWith";

/** One condition inside a `TitleRule.when`, evaluated as pure data (research R2). */
export interface TitlePredicate {
  readonly attr: TitlePredicateAttr;
  /** Leading `!` in the guard — inverts the result. */
  readonly negated: boolean;
  readonly op: TitlePredicateOp;
  /** Literal after `=`/`~`; absent for `"present"`. */
  readonly value?: string;
}

/**
 * Parsed form of one `ResolvedConfig.titleRules` string (data-model §3). Array order =
 * config order = first-match-wins evaluation order.
 */
export interface TitleRule {
  /** Index in the source array; first-match-wins scans ascending. */
  readonly order: number;
  /** Absent ⇒ catch-all (matches every task). Present ⇒ AND of all predicates. */
  readonly when?: readonly TitlePredicate[];
  /** Text with `{placeholder}` tokens; a literal arrow is stored unescaped after parse. */
  readonly template: string;
}

/**
 * The value `deriveTitle` returns (data-model §6). Consumed by 008 (apply `finalTitle`),
 * 009 (report indications), and — via `stripTitleForRender` — 004.
 */
export interface TitleDerivation {
  /** `<Feature_Name>: `-decorated title, byte-stable across repeated derivations (FR-004). */
  readonly finalTitle: string;
  /** `finalTitle` before decoration (diagnostics). */
  readonly baseTitle: string;
  /** Winning rule index; `-1` when the built-in pass-through default applied. */
  readonly matchedRuleIndex: number;
  /** `true` ⇔ `matchedRuleIndex === -1`. */
  readonly defaulted: boolean;
  /** Placeholder names replaced with `""` in the applied rule (research R5); empty for pass-through. */
  readonly unresolvedPlaceholders: readonly string[];
  /** `true` ⇔ a `Feature_Name` prefix is present on `finalTitle`. */
  readonly decorated: boolean;
}

/** The subset of `ResolvedConfig` the title modules read (data-model §3–7 inputs). */
export interface TitleConfigSlice {
  /** Frozen `readonly string[]` — interpreted by the research-R2 grammar, never retyped. */
  readonly titleRules: readonly string[];
  /** Frozen `readonly string[]` — leads adapter default strip prefixes (001 R7.4/R7.5). */
  readonly titleStripPrefixes: readonly string[];
  /** Frozen (`config.confirmationKey`, default `SYNC`) — recognizes a redundant issue prefix. */
  readonly confirmationKey: string;
}
