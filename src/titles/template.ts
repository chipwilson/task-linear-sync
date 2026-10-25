/**
 * `renderTemplate` — `{placeholder}` substitution from task attributes (research R5;
 * data-model.md §5; 001 R6.4/R6.5). An absent/empty attribute or unknown token becomes an
 * empty string plus an indicator — a token is NEVER left literal (spec Edge Case).
 */
import type { Task } from "../domain/task.js"; // FROZEN 002 — imported, not redefined

/** One `{name}` token (letters/digits, must start with a letter). */
const TOKEN_RE = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

/**
 * Substitute tokens of the normative set (001 R6.4): `{title}`, `{featureName}` (alias
 * `{feature}` — indicator is always `featureName`), `{localId}`, `{framework}`, `{phase}`,
 * `{prefix}` (the visible `[KEY-N]` issue reference, else unresolved).
 */
export function renderTemplate(
  template: string,
  task: Task,
): { readonly text: string; readonly unresolved: readonly string[] } {
  const unresolved: string[] = [];
  const text = template.replace(TOKEN_RE, (_match, name: string) => {
    switch (name) {
      case "title":
        return task.title; // required frozen field — never absent
      case "featureName":
      case "feature": {
        const value = task.featureName ?? "";
        if (value === "") {
          unresolved.push("featureName");
          return "";
        }
        return value;
      }
      case "localId": {
        const value = task.localTaskId ?? "";
        if (value === "") {
          unresolved.push("localId");
          return "";
        }
        return value;
      }
      case "framework":
        return task.frameworkId; // required frozen field — never absent
      case "phase": {
        const value = task.phase ?? "";
        if (value === "") {
          unresolved.push("phase");
          return "";
        }
        return value;
      }
      case "prefix": {
        const value = task.issueRef === undefined ? "" : `[${task.issueRef.key}-${task.issueRef.number}]`;
        if (value === "") {
          unresolved.push("prefix");
          return "";
        }
        return value;
      }
      default:
        // Unknown tokens are indicators too — replaced with "" and reported (research R5).
        unresolved.push(name);
        return "";
    }
  });
  return { text, unresolved };
}
