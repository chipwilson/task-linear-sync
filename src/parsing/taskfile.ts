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
 *
 * A-022-2 (022, T019): when the consumed adapter carries `documentTaskRule`, the file
 * goes through the document-unit pipeline INSTEAD of heading/checklist extraction
 * (contracts/parsing-api.md rule 13): 0-or-1 `document`-kind draft, zero line-scanning
 * for files that fail recognition (claimed documentation). The conflict scan and the
 * depth-cap refusal run unchanged upstream of the branch; 020 folding is inert for a
 * single parentless depth-1 draft (R4).
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
import { validateTaskDepthCap, foldDraftsOverCap } from "./depth.js";
import { deriveDocumentTask } from "./document.js";
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
 * 018 A-018-2: an `identityFileScope` adapter composes the file basename into the local-id
 * SEED INPUT only — `taskStableSeed`, its frozen layout, and every other adapter's seeds
 * stay byte-identical; `Task.localTaskId` stays the bare id. Shared by the extraction and
 * document pipelines (A-022-2).
 */
function composeSeedLocalTaskId(
  adapter: TaskFileAdapter,
  filePath: string,
  localTaskId: string | undefined,
): string | undefined {
  return localTaskId !== undefined && adapter.identityFileScope === true
    ? `${filePath.slice(filePath.lastIndexOf("/") + 1)}\u0000${localTaskId}`
    : localTaskId;
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
  // 020 C6: an invalid cap refuses BEFORE any parsing work — every lane shares this
  // entry, so refusal is mutation-free everywhere (CLI maps the name to exit 3).
  const depthCap = validateTaskDepthCap(config.maxTaskIssueDepth);
  const lines = splitLines(content, config.tabWidth);
  const conflictBlocks = scanConflictBlocks(lines);
  const frozen = frozenLineSet(conflictBlocks);

  // A-022-2 (T019): the document-unit pipeline replaces heading/checklist extraction
  // wholesale for document-mode adapters (parsing-api rule 13) — 0-or-1 draft per file,
  // and NO line scanning at all for files that fail recognition (claimed documentation).
  // The conflict scan above runs unchanged (R4); the depth-cap refusal ran before this
  // branch, and 020 folding is inert for a single parentless depth-1 draft.
  if (adapter.documentTaskRule !== undefined) {
    const document = deriveDocumentTask(filePath, lines.map((line) => line.text), adapter.documentTaskRule);
    const featureName = adapter.featureName(filePath);
    const tasks: Task[] =
      document === null
        ? []
        : [
            {
              stableUuid: deriveStableUuid(
                taskStableSeed(
                  {
                    frameworkId: adapter.id,
                    featureName,
                    localTaskId: composeSeedLocalTaskId(adapter, filePath, document.localTaskId),
                  },
                  { ordinal: 0, filePath },
                ),
                config.toolId,
              ),
              kind: document.kind,
              filePath,
              lineNumber: document.lineNumber,
              frameworkId: adapter.id,
              ...(featureName !== undefined ? { featureName } : {}),
              localTaskId: document.localTaskId,
              title: document.title,
              childUuids: [],
              taskBody: { startLine: document.startLine, endLine: document.endLine },
              unresolvedConflict: blocksIntersecting(document.startLine, document.endLine, conflictBlocks),
            },
          ];
    const file: TaskFile = {
      filePath,
      frameworkId: adapter.id,
      ...(featureName !== undefined ? { featureName } : {}),
      // Same zero-I/O posture as the extraction lane: sibling probing is discovery's job.
      siblingDocuments: [],
      tasks,
    };
    return { file, exclusions: [], conflictBlocks, warnings: [], ...(featureName !== undefined ? { featureName } : {}) };
  }

  const { drafts: allDrafts, exclusions: grammarExclusions } = extractTasks(lines, frozen, adapter, config);

  // 020 C3/C5: prune over-cap drafts BEFORE uuid/index/extent building. A folded draft
  // is no longer a task: its line stays verbatim body content of the nearest surviving
  // ancestor (spans are cap-invariant — I3), and it earns exactly one ascending
  // `depth-folded` exclusion. Grammar exclusions (fence/conflict/summary/rollup) were
  // decided upstream and win over folding (precedence, C5).
  const { surviving: drafts, folded } = foldDraftsOverCap(allDrafts, depthCap);
  const exclusions: ExclusionRecord[] = [...grammarExclusions];
  for (const draft of folded) {
    exclusions.push({
      lineNumber: draft.lineNumber,
      kind: "checklist", // headings are depth 1 — only checklist drafts can fold
      reason: "depth-folded",
      text: lines[draft.lineNumber - 1]?.text ?? "",
    });
  }
  exclusions.sort((a, b) => a.lineNumber - b.lineNumber); // deterministic ascending order

  const extents = deriveExtents(drafts, lines, frozen);
  const featureName = adapter.featureName(filePath);

  // Stable_UUID: the seed comes ONLY from the frozen taskStableSeed (002 R11); the
  // ordinal is the 0-based position in ascending-line (tasks) order (parsing-api rule 11).
  // The identityFileScope seed composition is shared with the document lane (A-022-2).
  const uuids = drafts.map((draft, ordinal) =>
    deriveStableUuid(
      taskStableSeed(
        {
          frameworkId: adapter.id,
          featureName,
          localTaskId: composeSeedLocalTaskId(adapter, filePath, draft.localTaskId),
        },
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
      // Surviving drafts' child lists may still reference folded drafts (020): those are
      // not tasks, so they receive no uuid and appear in no link map (C3/C8).
      childUuids: draft.children.flatMap((child) => {
        const childIndex = indexByLine.get(child.lineNumber);
        return childIndex === undefined ? [] : [uuids[childIndex]];
      }),
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
