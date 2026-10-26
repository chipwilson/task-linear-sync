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
  void [input]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: markers");
}
