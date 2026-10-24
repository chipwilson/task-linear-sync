/**
 * contracts/line-rendering.md — surgical in-place line rendering (FR-011…FR-013,
 * SC-002/SC-003/SC-004/SC-005; FR-024 feeds 009's expectedMarkdownChanges).
 *
 * A rendered line keeps the ORIGINAL bytes from line start through the heading hashes
 * (or the checklist marker + checkbox, its state byte rewritten only when the
 * assignment supplies `checked`), plus the leading local-task-ID span unless
 * `preserveLocalTaskId === false`. Everything after that span is replaced by
 * `` `[${issueRef.key}-${issueRef.number}] ` + cleanTitle(desiredTitle) `` (the token
 * is omitted when the assignment carries no issue reference).
 *
 * ALL assignments are validated (ascending by line number) BEFORE any rewriting:
 * kind/level/marker mismatch, fence interiors, conflict-block interiors, and
 * out-of-range lines abort the WHOLE call with a LineRenderError naming file + line
 * (research R7: the renderer's abort set ⊇ 002's frozen set). No partial file ever
 * reaches a writer (FR-013, SC-003). Terminators are carried, never regenerated
 * (FR-012); unassigned lines are byte-identical (SC-002).
 */
import type { ResolvedConfig } from "../config/schema.js";
import type { IssueRef, Task } from "../domain/task.js";
import {
  headingLevelOf,
  lineIsFenced,
  markerWithState,
  matchCheckbox,
  splitLines,
  stripLeadingLocalId,
  type ContentLine,
} from "./content.js";
import { frozenLineSet, scanConflictBlocks } from "./conflict.js";
import { cleanTitle } from "./title.js";

/** Options for {@link renderTaskLines}. */
export interface RenderOptions {
  /** Re-emit the line's leading local-task-ID span. Defaults to true. */
  readonly preserveLocalTaskId?: boolean;
}

/** The four structural surprises an assignment can hit (line-rendering.md failure matrix). */
export type LineRenderFailureReason = "structure-mismatch" | "inside-conflict-block" | "inside-fence" | "line-out-of-range";

/** Raised (whole-call abort) when an assignment fails validation. */
export class LineRenderError extends Error {
  readonly filePath: string;
  readonly lineNumber: number;
  readonly reason: LineRenderFailureReason;

  constructor(filePath: string, lineNumber: number, reason: LineRenderFailureReason) {
    super(`Line ${lineNumber} of ${filePath} cannot be rendered: ${reason}`);
    this.name = "LineRenderError";
    this.filePath = filePath;
    this.lineNumber = lineNumber;
    this.reason = reason;
  }
}

/** One rewrite request: the parsed task, the desired title, optional reference + state. */
export interface LineAssignment {
  readonly task: Task;
  readonly desiredTitle: string;
  /** Issue reference to emit as `[key-number] `; omit to emit no token. */
  readonly issueRef?: IssueRef;
  /** Checkbox state to set; omit to retain the original state byte byte-for-byte. */
  readonly checked?: boolean;
}

/** One rewritten line with terminator bytes on both sides (009 change material). */
export interface RenderedLineChange {
  readonly lineNumber: number;
  readonly before: string;
  readonly after: string;
}

/** Successful render: full content + per-assignment changes, ascending by line number. */
export interface RenderResult {
  readonly content: string;
  readonly changes: readonly RenderedLineChange[];
}

const HEADING_PREFIX_RE = /^( {0,3}#{1,6}[ \t]*)([\s\S]*)$/u;

/** Does the CURRENT line text structurally match the assigned task (FR-013)? */
function structureMatches(text: string, task: Task, config: ResolvedConfig): boolean {
  if (task.kind === "heading") return headingLevelOf(text) !== undefined;
  return matchCheckbox(text, config.flatChecklistMarkers) !== undefined;
}

/** Rebuild one validated line (the task on it is known to match structurally). */
function renderLine(text: string, assignment: LineAssignment, config: ResolvedConfig, preserveLocalId: boolean): string {
  let head: string;
  let rest: string;
  if (assignment.task.kind === "heading") {
    const m = HEADING_PREFIX_RE.exec(text);
    head = m?.[1] ?? "";
    rest = m?.[2] ?? text;
  } else {
    const cm = matchCheckbox(text, config.flatChecklistMarkers);
    if (!cm) return text; // unreachable after validation
    head = cm.prefix;
    rest = cm.rest;
    if (assignment.checked !== undefined) {
      const stateChar = assignment.checked ? "x" : " ";
      head = head.replace(cm.marker, markerWithState(cm.marker, stateChar));
    }
  }

  const stripped = stripLeadingLocalId(rest);
  const localSpan = stripped ? rest.slice(0, rest.length - stripped[1].length) : "";

  const title = cleanTitle(assignment.desiredTitle, {
    confirmationKey: config.confirmationKey,
    ...(assignment.task.localTaskId !== undefined ? { localTaskId: assignment.task.localTaskId } : {}),
    titleStripPrefixes: config.titleStripPrefixes,
  });
  const token = assignment.issueRef !== undefined ? `[${assignment.issueRef.key}-${assignment.issueRef.number}] ` : "";
  const body = token + title;
  return head + (preserveLocalId ? localSpan : "") + (title === "" ? body.replace(/[ \t]+$/u, "") : body);
}

/**
 * Rewrite assigned task lines in place. Validation is ascending and total — one bad
 * assignment aborts every good one (FR-013). Assignments on one line apply in the
 * given order after the ascending sort; the change log records each application.
 */
export function renderTaskLines(
  filePath: string,
  fileContent: string,
  assignments: readonly LineAssignment[],
  config: ResolvedConfig,
  options: RenderOptions = {},
): RenderResult {
  const preserveLocalId = options.preserveLocalTaskId ?? true;
  const lines: readonly ContentLine[] = splitLines(fileContent, config.tabWidth);
  const frozen = frozenLineSet(scanConflictBlocks(lines));

  const ordered = [...assignments].sort((a, b) => a.task.lineNumber - b.task.lineNumber);

  // ── validate ALL before touching ANY (ascending line number) ──────────────────
  for (const assignment of ordered) {
    const n = assignment.task.lineNumber;
    if (!Number.isInteger(n) || n < 1 || n > lines.length) {
      throw new LineRenderError(filePath, n, "line-out-of-range");
    }
    if (lineIsFenced(lines, n)) throw new LineRenderError(filePath, n, "inside-fence");
    if (frozen.has(n)) throw new LineRenderError(filePath, n, "inside-conflict-block");
    const line = lines[n - 1] as ContentLine;
    if (!structureMatches(line.text, assignment.task, config)) {
      throw new LineRenderError(filePath, n, "structure-mismatch");
    }
  }

  // ── apply ──────────────────────────────────────────────────────────────────────
  const texts = lines.map((line) => line.text);
  const changes: RenderedLineChange[] = [];
  for (const assignment of ordered) {
    const n = assignment.task.lineNumber;
    const line = lines[n - 1] as ContentLine;
    const before = texts[n - 1] as string;
    const after = renderLine(before, assignment, config, preserveLocalId);
    texts[n - 1] = after;
    // before/after carry the line's ORIGINAL terminator bytes on both sides (009 material).
    changes.push({ lineNumber: n, before: before + line.terminator, after: after + line.terminator });
  }

  let content = "";
  lines.forEach((line, index) => {
    content += (texts[index] as string) + line.terminator;
  });
  return { content, changes };
}
