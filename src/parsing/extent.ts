/**
 * `Task_Body` extent derivation (FR-010; research R5; parsing-api rule 10).
 *
 * Verbatim FR-010: the extent is "the task line plus all content beneath it up to the
 * next task or next equal-or-shallower heading, including nested checklist children".
 * Operationalized (R5): a task's section ends BEFORE the first following line that is
 * (a) another task that is NOT a descendant of it, or (b) a heading of level ≤ the
 * task's own heading level (headings) / ANY heading for checklist tasks — descendants
 * stay inside; a leaf task with no content beneath gets `endLine === startLine`.
 *
 * Computed AFTER the whole file is scanned, "so the 'next task' boundary is exact
 * regardless of scan order" (R5). Trailing blank lines are trimmed so a leaf's
 * `endLine === startLine` holds even when the next line is blank (the frozen 002
 * invariant "last line before next task" remains an upper bound).
 */
import type { TaskBodyExtent } from "../domain/task.js";
import type { ContentLine } from "./content.js";
import { headingLevelOf } from "./content.js";
import type { TaskDraft } from "./extract.js";

/** Collect the line numbers of a draft's whole descendant subtree (inclusive semantics). */
function subtreeLines(draft: TaskDraft, acc: Set<number>): Set<number> {
  for (const child of draft.children) {
    acc.add(child.lineNumber);
    subtreeLines(child, acc);
  }
  return acc;
}

/**
 * Derive inclusive `{ startLine, endLine }` for every task draft, keyed by line number.
 * `frozen` lines (conflict interiors) and fenced lines are never heading boundaries —
 * they are body content of whatever section contains them.
 */
export function deriveExtents(
  drafts: readonly TaskDraft[],
  lines: readonly ContentLine[],
  frozen: ReadonlySet<number>,
): Map<number, TaskBodyExtent> {
  const extents = new Map<number, TaskBodyExtent>();
  if (lines.length === 0) return extents;

  const taskLines = new Set(drafts.map((d) => d.lineNumber));
  // Structural heading lines: fenced/conflict interior headings are not structure.
  const headingLevels = new Map<number, number>();
  for (const line of lines) {
    if (line.inFence || frozen.has(line.number) || taskLines.has(line.number)) continue;
    const level = headingLevelOf(line.text);
    if (level !== undefined) headingLevels.set(line.number, level);
  }

  for (const draft of drafts) {
    const descendants = subtreeLines(draft, new Set());
    let boundary = lines.length + 1;
    for (let n = draft.lineNumber + 1; n <= lines.length; n++) {
      if (taskLines.has(n) && !descendants.has(n)) {
        boundary = n; // (a) next non-descendant task
        break;
      }
      const level = headingLevels.get(n);
      if (level !== undefined) {
        if (draft.kind === "checklist" || level <= (draft.headingLevel ?? 0)) {
          boundary = n; // (b) next ≤-level heading (headings) / any heading (checklists)
          break;
        }
      }
    }
    let end = Math.max(draft.lineNumber, boundary - 1);
    while (end > draft.lineNumber && (lines[end - 1]?.text.trim() ?? "") === "") end--; // leaf ⇒ endLine === startLine
    extents.set(draft.lineNumber, { startLine: draft.lineNumber, endLine: end });
  }
  return extents;
}
