/**
 * `evaluateGuard` — pure, data-driven evaluation of one `TitleRule` guard against a task
 * (data-model.md §4; research R2: predicates are data, not closures, so matching is
 * deterministic, reproducible, and report-indicable).
 */
import type { Task } from "../domain/task.js"; // FROZEN 002 — imported, not redefined
import type { TitlePredicate, TitlePredicateAttr } from "./types.js";

/** Value compared for `eq`: `"present"`-style presence for the sentinel attrs. */
function eqValue(attr: TitlePredicateAttr, task: Task): string | undefined {
  switch (attr) {
    case "featureName":
      return task.featureName;
    case "localId":
      return task.localTaskId;
    case "phase":
      return task.phase;
    case "framework": // attribute `framework` ⇔ frozen field frameworkId
      return task.frameworkId;
    case "kind":
      return task.kind;
    case "path": // attribute `path` ⇔ frozen field filePath
      return task.filePath;
    case "child":
    case "issueRef":
      return undefined; // presence-only attributes: no string-equality semantics
  }
}

/** Presence: attribute defined and non-empty; `child` ⇔ parentUuid set, `issueRef` ⇔ issueRef set. */
function isPresent(attr: TitlePredicateAttr, task: Task): boolean {
  switch (attr) {
    case "child":
      return task.parentUuid !== undefined;
    case "issueRef":
      return task.issueRef !== undefined;
    case "framework":
    case "kind":
    case "path":
      return true; // required frozen fields are always present
    default:
      return eqValue(attr, task) !== undefined && eqValue(attr, task) !== "";
  }
}

function matchesOne(predicate: TitlePredicate, task: Task): boolean {
  let result: boolean;
  switch (predicate.op) {
    case "present":
      result = isPresent(predicate.attr, task);
      break;
    case "eq":
      result = predicate.value !== undefined && eqValue(predicate.attr, task) === predicate.value;
      break;
    case "startsWith":
      // `"startsWith"` is only produced for `path~value` (research R2 grammar guard).
      result = predicate.attr === "path" && predicate.value !== undefined && task.filePath.startsWith(predicate.value);
      break;
  }
  return predicate.negated ? !result : result;
}

/**
 * AND over all predicates (data-model §4); an empty predicate list is the catch-all guard
 * and evaluates `true`.
 */
export function evaluateGuard(when: readonly TitlePredicate[], task: Task): boolean {
  return when.every((predicate) => matchesOne(predicate, task));
}
