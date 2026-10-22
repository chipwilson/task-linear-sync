# Contract: In-Place Line Rendering (Rewrite Semantics)

Module: `src/parsing/{render,title}.ts`. Consumed frozen shapes: `Task`, `IssueRef`
([002 contracts/task-model.md](../../002-core-domain-contracts/contracts/task-model.md));
004-local records: `LineAssignment`, `RenderResult`, `LineChange`, `LineRenderError`,
`RenderOptions` ([../data-model.md](../data-model.md) § 6–7). Pure over strings: **this
module performs no file I/O** — the caller (008's gated engine) writes the returned
content, which is what makes "the file is left unmodified" on abort structurally true.

```ts
export interface RenderOptions {
  /** FR-011 "unless configured otherwise": drop a present local task ID. Default true = keep. */
  readonly preserveLocalTaskId?: boolean;   // default true
}

export class LineRenderError extends Error {
  readonly filePath: string;
  readonly lineNumber: number;              // 1-based
  readonly reason: "structure-mismatch" | "inside-conflict-block" | "inside-fence" | "line-out-of-range";
}

export function renderTaskLines(
  filePath: string,
  content: string,
  assignments: readonly LineAssignment[],
  config: ResolvedConfig,
  options?: RenderOptions,
): RenderResult;                                    // throws LineRenderError (nothing emitted)

/** Exposed for 005's title-derivation reuse and for renderer self-use (research R9). */
export function cleanTitle(
  text: string,
  opts: { confirmationKey: string; localTaskId?: string; titleStripPrefixes: readonly string[] },
): string;
```

## Behavior rules (normative)

1. **Emitted line shape** (FR-011): the rewritten line = preserved **structural prefix**
   (exact original bytes from line start through the heading hashes `#{1,6}`, the present
   local task ID span — unless `preserveLocalTaskId === false` — and the checkbox marker
   plus following whitespace) + rendered title span
   `` `[${config.confirmationKey}-${issueRef.number}] ` + cleanTitle(desiredTitle) ``
   when the assignment carries an `issueRef`, else just the cleaned title. Cleaning strips
   configured `titleStripPrefixes`, redundant visible issue prefixes for the configured
   key, and duplicate leading local-ID prefixes, iterating to a fixpoint (research R9).
2. **Checkbox state** (FR-011): set `[ ]`/`[x]`/`[X]` from `assignment.checked` when
   provided; when `undefined` the original state byte is retained byte-for-byte.
3. **Bottom-to-top application** (FR-012): assignments are applied in descending
   `lineNumber` order into the terminator-preserving line array; unassigned lines are
   emitted byte-identical (including mixed line endings); the file's original
   trailing-newline style (present/absent, `\n` vs `\r\n`) is reproduced exactly because
   terminators are never regenerated, only carried.
4. **Conflict-block freeze** (FR-009/FR-012): lines inside any `ConflictBlock` (supplied
   via the assignments' parsed tasks or recomputed with `scanConflictBlocks`) are never
   rewritten; an assignment targeting one aborts the file with
   `reason: "inside-conflict-block"`.
5. **Structural surprise abort** (FR-013): before any rewriting, **every** assignment is
   re-validated against the current content at its recorded line: the line must still
   parse as the same `kind`, heading level (for headings), and checkbox marker (for
   checklists), must not be fenced, conflicted, or out of range. On the first failure the
   call throws `LineRenderError` naming `filePath` and `lineNumber` and **no rewritten
   content is returned** — the caller's file is left unmodified (SC-003).
6. **Determinism / idempotency** (Principle IV): identical inputs → byte-identical
   `RenderResult.content`; applying the same assignment set twice re-renders the same
   bytes (the visible reference is re-emitted from the parsed `issueRef` and cleaned
   titles are fixpoint-stable), so parse → render → parse reproduces identical titles
   with **no progressive prefixing**.
7. **Diff material** (provides to 009): `RenderResult.changes` lists each assigned line's
   `before`/`after` (with original terminator bytes), ascending, as the
   `expectedMarkdownChanges` source for plan reports.

## Test obligations (mapped in quickstart)

- Golden-file corpus: multi-assignment fixtures rewritten bottom-to-top, whole-file
  `assert.equal` against golden bytes — untouched lines, CRLF/LF/mixed endings, trailing-
  newline present/absent, conflict block interior byte-for-byte identical (SC-002).
- Emitted-shape fixtures: indentation (tabs and spaces) preserved; heading level
  preserved; present local ID preserved by default and droppable via
  `preserveLocalTaskId: false`; checkbox set from assignment / retained when absent.
- Cleaning fixtures: strip prefixes, redundant `[SYNC-12]`/`SYNC-12` prefixes, duplicate
  leading `Task 1.2:`-style IDs; fixpoint over compound stale prefixes.
- Abort fixtures: corrupted expected line (level changed, marker removed, line inside a
  fence/conflict block, line number past EOF) → `LineRenderError` with exact file + line
  and content input byte-identical after the call (SC-003).
- Property tests: random assignment subsets never change unassigned bytes; double-render
  and parse→render→parse round-trips are exact (constitution IV).
