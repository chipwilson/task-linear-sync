/**
 * `parseTaskFile` orchestrator (contracts/parsing-api.md; spec Purpose: "a pure function
 * over file content plus the adapter conventions"). Pipeline (tasks.md T023):
 * split → conflict scan → extract (skipping block-interior lines) → extents → per task
 * `unresolvedConflict = blocksIntersecting(taskBody)` (FR-009),
 * `stableUuid = deriveStableUuid(taskStableSeed(task, { ordinal, filePath }), config.toolId)`
 * with ordinal = 0-based index in ascending-line order (parsing-api rule 11),
 * `frameworkId = adapter.id`, `featureName` from `adapter.featureName(filePath)` onto
 * file + ParseResult + every task (FR-008).
 *
 * Validation (data-model § 1): conflict spans never overlap (scan invariant); no task
 * start line lies inside a block (frozen lines are never extracted); exclusions are
 * non-fenced lines (the scan only excludes unfenced lines).
 */
import { taskStableSeed } from "../domain/task.js";
import type { Task, TaskFile } from "../domain/task.js";
import type { ResolvedConfig } from "../config/schema.js";
import type { TaskFileAdapter } from "./adapter.js";
import { splitLines } from "./content.js";
import { scanConflictBlocks, frozenLineSet, blocksIntersecting } from "./conflict.js";
import type { ConflictBlock } from "./conflict.js";
import { extractTasks } from "./extract.js";
import type { ExclusionRecord } from "./extract.js";
import { deriveExtents } from "./extent.js";
import { collectDuplicateWarnings } from "./warnings.js";
import type { ParseWarning } from "./warnings.js";
import { deriveStableUuid } from "./identity.js";

/** Complete output of one parse of one task file (data-model § 1). */
export interface ParseResult {
  readonly file: TaskFile;
  /** Sorted ascending by `lineNumber`; excluded items appear ONLY here (FR-004). */
  readonly exclusions: readonly ExclusionRecord[];
  /** Ascending `startLine`; the renderer's freeze set (FR-009, FR-012). */
  readonly conflictBlocks: readonly ConflictBlock[];
  /** Deterministic order: by kind, then by shared value (FR-007). */
  readonly warnings: readonly ParseWarning[];
  /** Adapter-derived file-level `Feature_Name` (FR-008); ABSENT when underivable. */
  readonly featureName?: string;
}

/**
 * Parse one task file. Pure and total: malformed Markdown still parses; there is no I/O,
 * no clock, and no adapter internals — only the frozen config and the `TaskFileAdapter`
 * interface members (research R1/R2). Identical inputs produce structurally identical
 * `ParseResult`s, field-for-field, including array orders (parsing-api rule 12).
 */
export function parseTaskFile(
  filePath: string,
  content: string,
  adapter: TaskFileAdapter,
  config: ResolvedConfig,
): ParseResult {
  const lines = splitLines(content, config.tabWidth);
  const conflictBlocks = scanConflictBlocks(lines);
  const frozen = frozenLineSet(conflictBlocks);
  const { drafts, exclusions } = extractTasks(lines, frozen, adapter, config);
  const extents = deriveExtents(drafts, lines, frozen);
  const featureName = adapter.featureName(filePath);

  // Stable_UUID: the seed comes ONLY from the frozen taskStableSeed (002 R11); the
  // ordinal is the 0-based position in ascending-line (tasks) order (parsing-api rule 11).
  const uuids = drafts.map((draft, ordinal) =>
    deriveStableUuid(
      taskStableSeed(
        { frameworkId: adapter.id, featureName, localTaskId: draft.localTaskId },
        { ordinal, filePath },
      ),
      config.toolId,
    ),
  );
  const indexByLine = new Map(drafts.map((draft, index) => [draft.lineNumber, index] as const));

  const tasks: Task[] = drafts.map((draft, ordinal) => {
    const taskBody = extents.get(draft.lineNumber) ?? { startLine: draft.lineNumber, endLine: draft.lineNumber };
    const parentIndex = draft.parent ? indexByLine.get(draft.parent.lineNumber) : undefined;
    return {
      stableUuid: uuids[ordinal],
      kind: draft.kind,
      filePath,
      lineNumber: draft.lineNumber,
      frameworkId: adapter.id,
      ...(featureName !== undefined ? { featureName } : {}),
      ...(draft.localTaskId !== undefined ? { localTaskId: draft.localTaskId } : {}),
      ...(draft.phase !== undefined ? { phase: draft.phase } : {}),
      title: draft.title,
      ...(draft.checked !== undefined ? { checked: draft.checked } : {}), // present iff checklist
      ...(parentIndex !== undefined ? { parentUuid: uuids[parentIndex] } : {}),
      childUuids: draft.children.map((child) => uuids[indexByLine.get(child.lineNumber) ?? 0]),
      ...(draft.issueRef !== undefined ? { issueRef: draft.issueRef } : {}),
      taskBody,
      unresolvedConflict: blocksIntersecting(taskBody.startLine, taskBody.endLine, conflictBlocks),
    };
  });

  const file: TaskFile = {
    filePath,
    frameworkId: adapter.id,
    ...(featureName !== undefined ? { featureName } : {}),
    // Sibling-document existence checks are discovery (003) territory — this pure module
    // performs zero filesystem access, so parsing records the empty set here.
    siblingDocuments: [],
    tasks,
  };

  return {
    file,
    exclusions,
    conflictBlocks,
    warnings: collectDuplicateWarnings(drafts),
    ...(featureName !== undefined ? { featureName } : {}),
  };
}
