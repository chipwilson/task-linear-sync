/**
 * `deriveTitle` — the US2 entry point (005 FR-003/FR-004/FR-005;
 * contracts/title-derivation.md § Normative behavior 1–7):
 *
 *   ordered first-match-wins rule scan → pass-through default → feature decoration.
 *
 * The decoration runs AFTER derivation on EVERY outcome (matched rule, no match,
 * pass-through), which is what makes 001 R6.9 hold "regardless of whether a consumer title
 * rule matched, no consumer title rule matched, or the built-in pass-through default
 * produced the title".
 */
import type { Task } from "../domain/task.js"; // FROZEN 002 — imported, not redefined
import { decorateFeaturePrefix } from "./decorate.js";
import { evaluateGuard } from "./match.js";
import { parseTitleRules } from "./rules.js";
import { renderTemplate } from "./template.js";
import type { TitleConfigSlice, TitleDerivation } from "./types.js";

/** `decorated: true` ⇔ a Feature_Name prefix is present on `finalTitle` (data-model §6). */
function isDecorated(finalTitle: string, featureName: string | undefined): boolean {
  return featureName !== undefined && featureName !== "" && finalTitle.startsWith(`${featureName}: `);
}

/** Derive the tracker title for one task; pure, deterministic, byte-stable per FR-004. */
export function deriveTitle(task: Task, config: TitleConfigSlice): TitleDerivation {
  for (const rule of parseTitleRules(config.titleRules)) {
    if (rule.when !== undefined && !evaluateGuard(rule.when, task)) {
      continue;
    }
    // First rule whose guard matches (absent guard ⇒ catch-all) — 001 R6.1.
    const { text, unresolved } = renderTemplate(rule.template, task);
    const finalTitle = decorateFeaturePrefix(text, task.featureName);
    return {
      finalTitle,
      baseTitle: text,
      matchedRuleIndex: rule.order,
      defaulted: false,
      unresolvedPlaceholders: unresolved,
      decorated: isDecorated(finalTitle, task.featureName),
    };
  }

  // Built-in pass-through default (001 R6.2/R6.3/R6.7): raw title unchanged, then decorated.
  const finalTitle = decorateFeaturePrefix(task.title, task.featureName);
  return {
    finalTitle,
    baseTitle: task.title,
    matchedRuleIndex: -1,
    defaulted: true,
    unresolvedPlaceholders: [],
    decorated: isDecorated(finalTitle, task.featureName),
  };
}
