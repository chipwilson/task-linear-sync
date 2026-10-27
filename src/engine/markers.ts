/**
 * Git-style conflict-marker block synthesis + nested-block refusal (research R4;
 * contracts/conflict-resolution-matrix.md §2 `overwrite-spec` / §4 freeze rule; FR-003/
 * FR-007; task T022 implements; unit tests T015).
 * Block format (written INTO the task's section, replacing the section body):
 *   `<<<<<<< <toolId>:local <filePath>#L<line>` / local content / `=======` /
 *   tracker content / `>>>>>>> <toolId>:linear <ISSUE-KEY>`
 * Labels derive from the configured `toolId` + the issue reference — NEVER the task
 * UUID (Principle II). Output is structurally compatible with 004
 * `scanConflictBlocks`/`frozenLineSet` (7-marker runs), which keeps one authority for
 * "what is a conflict block" (R4). Marker text lives in the SPEC FILE ONLY — never in
 * the synced state payload (FR-003).
 */
import { scanConflictBlocks, splitLines } from "../parsing/index.js";

import { EngineError } from "./errors.js";

/**
 * Tab width for the fence-aware side scan only (004 default). Marker recognition in
 * `scanConflictBlocks` is column-0, so this never affects what counts as a block.
 */
const TAB_WIDTH = 4;

/** The R4 separator: exactly seven `=` at column 0 (004 `^={7,}` shape, fixed form). */
const SEPARATOR = "=======";

/** 004's marker shapes (`src/parsing/conflict.ts`): opening / closing 7-marker runs. */
const OPEN_MARKER_RE = /^<{7,}/u;
const CLOSE_MARKER_RE = /^>{7,}/u;

/** Inputs of one marker-block synthesis (research R4 label rule; Principle II/III). */
export interface ConflictMarkerInput {
  /** Configured `toolId` — derives both marker labels (no org literals — Principle III). */
  readonly toolId: string;
  /** Repository-relative POSIX file path of the task file (local label). */
  readonly filePath: string;
  /** 1-based line of the task itself (`#L<line>` in the local label). */
  readonly taskLine: number;
  /** Issue key reference for the closing label, e.g. `SYNC-42` (`<ISSUE-KEY>`). */
  readonly issueKey: string;
  /** Current spec-side section content (embedded verbatim between `<<<<<<<` and `=======`). */
  readonly localContent: string;
  /** Tracker-side issue description (embedded between `=======` and `>>>>>>>`). */
  readonly trackerContent: string;
}

/**
 * Synthesize the git-style conflict block for `overwrite-spec` (matrix §2: section body
 * becomes the block embedding local content then tracker content; issue untouched).
 * Labels are toolId-derived and never contain the task UUID (Principle II). Output
 * round-trips through 004 `scanConflictBlocks` as exactly one block.
 *
 * Nested-block refusal (FR-007; matrix §4): throws `EngineError` when either embedded
 * side already contains conflict-marker lines — an `overwrite-spec` attempt against a
 * frozen section is refused outright, no nested markers. The CALLER additionally must
 * not target a section whose `Task.unresolvedConflict` is set (decision
 * `skip-unresolved` — enforced by `build.ts`/`apply.ts`). T022 implements (T015).
 */
export function synthesizeConflictMarkerBlock(input: ConflictMarkerInput): string {
  refuseEmbeddedMarkers("local", input.localContent);
  refuseEmbeddedMarkers("tracker", input.trackerContent);

  // Section-BODY replacement (data-model §5 `render-file`): bare body text — the 004 line
  // model supplies terminators, so the block itself carries none. Sides are embedded
  // verbatim (`split("\n")` keeps interior blank lines; an empty side contributes one
  // blank line, which still scans as ONE block, never two).
  return [
    `<<<<<<< ${input.toolId}:local ${input.filePath}#L${input.taskLine}`,
    ...input.localContent.split("\n"),
    SEPARATOR,
    ...input.trackerContent.split("\n"),
    `>>>>>>> ${input.toolId}:linear ${input.issueKey}`,
  ].join("\n");
}

/**
 * Nested-block refusal for one content side (matrix §4: "no nested markers, ever").
 * 004 is the single authority for *what a conflict block is* (research R4): the side is
 * scanned with `splitLines` + `scanConflictBlocks`, fence-aware — a marker EXAMPLE inside
 * a fenced region is documentation, never a block, and must not be refused. A bare
 * un-fenced marker RUN of any shape is refused too even when 004's scan alone would find
 * no block (a lone closing marker forms none): embedding one would split the synthesized
 * section into the wrong spans and break the one-block / open..close freeze guarantee
 * above. Message is sanitized — no raw content (Principle II posture on propagated text).
 */
function refuseEmbeddedMarkers(side: "local" | "tracker", content: string): void {
  const lines = splitLines(content, TAB_WIDTH);
  const embedded =
    scanConflictBlocks(lines).length > 0 ||
    lines.some((line) => !line.inFence && (OPEN_MARKER_RE.test(line.text) || CLOSE_MARKER_RE.test(line.text)));
  if (!embedded) return;
  throw new EngineError(
    `conflict-marker synthesis refused: the ${side} content already contains a conflict block — nested markers are never written (FR-007; matrix §4); resolve and remove the existing markers first`,
  );
}
