# Contract: Parsing API (Extraction Semantics)

Module: `src/parsing/{taskfile,content,extract,extent,conflict,identity,warnings}.ts`.
Consumed frozen shapes: `Task`, `TaskFile`, `TaskBodyExtent`, `IssueRef`, `FrameworkId`
([002 contracts/task-model.md](../../002-core-domain-contracts/contracts/task-model.md));
004-local records: `ParseResult`, `ExclusionRecord`, `ParseWarning`, `ConflictBlock`
([../data-model.md](../data-model.md) § 1–4).

```ts
import type { TaskFile } from "task-linear-sync/domain";
import type { ResolvedConfig } from "task-linear-sync/config";
import type { TaskFileAdapter } from "./adapter";

export interface ParseResult {
  readonly file: TaskFile;                                   // frozen shape, ascending lineNumber
  readonly exclusions: readonly ExclusionRecord[];
  readonly conflictBlocks: readonly ConflictBlock[];
  readonly warnings: readonly ParseWarning[];
  readonly featureName?: string;
}

/** Pure function: content in, tasks out. No fs, no clock, no adapter internals. */
export function parseTaskFile(
  filePath: string,                 // repository-relative POSIX (recorded verbatim)
  content: string,
  adapter: TaskFileAdapter,
  config: ResolvedConfig,
): ParseResult;
```

## Behavior rules (normative)

1. **Extraction** (FR-001): a line outside any fenced region is a heading task iff its
   text matches the resolved task-heading grammar (adapter `headingGrammar` else
   `config.headingIdGrammar`; named groups `id?`/`title`); a checkbox line
   (`flatChecklistMarkers` prefix after leading whitespace) is a checklist task. All line
   numbers are 1-based. Fence interiors and fence delimiter lines are never tasks
   ("Fenced pseudo-tasks" edge case).
2. **Indentation/nesting** (FR-002): `indentWidth` = leading whitespace with tabs expanded
   to `config.tabWidth`; parent/child via the monotonic indent stack (research R5); a
   checkbox with no stack parent attaches to the nearest enclosing heading task
   (orphan rule). `parentUuid`/`childUuids` consistent both directions;
   `kind === "heading"` ⇔ `checked === undefined` (frozen invariant).
3. **Phase** (FR-003): most recent heading matching the resolved `phasePattern` supplies
   `Task.phase` for all subsequent tasks in the file; phase headings are not tasks
   (research R6); an earlier phase label survives until superseded.
4. **Exclusions** (FR-004): checklist items inside a summary section (heading matching
   resolved `summaryPattern`, section extends to the next heading of level ≤ it) are
   excluded with `reason: "summary-section"`; checklist lines matching the resolved
   `rollupPattern` with `reason: "rollup"`. Each exclusion recorded with its 1-based line
   number and reason; excluded items never appear in `file.tasks`.
5. **Flat documents** (FR-005): a document with no grammar-matching headings outside
   fences, or matching configured `flatChecklistMarkers`, extracts top-level checkboxes as
   valid tasks with `parentUuid` absent.
6. **Identities** (FR-006): when the heading grammar matches, its `id` named group is the
   task's `localTaskId`; a visible `\[(<confirmationKey>)-(\d+)\]` reference anywhere in
   the line text is parsed into `issueRef { key, number }` (`number ≥ 1`) and stripped
   from the stored raw `title`. A leading local-ID pattern on checklist lines is likewise
   recorded as `localTaskId`.
7. **Duplicate warnings** (FR-007): tasks within one file sharing a `localTaskId` or an
   `issueRef` produce one `ParseWarning` per shared value naming the value and **all**
   affected 1-based lines ascending; parsing still succeeds.
8. **Feature name** (FR-008): `adapter.featureName(filePath)` recorded on the `TaskFile`,
   in `ParseResult.featureName`, and on every task; `undefined` when underivable — never
   guessed.
9. **Conflict flag** (FR-009): `Task.unresolvedConflict = true` iff the task's
   `taskBody` extent intersects a `ConflictBlock` (fence-aware git-style markers, ≥7
   repetitions); lines strictly inside a block are never extracted as tasks. (008 skips
   such tasks downstream; 004 only flags.)
10. **Extents** (FR-010): `taskBody = { startLine: task line, endLine }` where `endLine`
    is the line before the earliest following (a) non-descendant task or (b) heading of
    level ≤ the task's own heading level (for headings) / any heading (for checklists) —
    whichever comes first; nested descendant checklist children stay inside the extent;
    a task with no content beneath has `endLine === startLine` (research R5).
11. **Stable UUID** (constitution II; 002 R11): `stableUuid = deriveStableUuid(
    taskStableSeed(task, { ordinal, filePath }), config.toolId )` — the seed comes only
    from the frozen `taskStableSeed` function; the UUID never appears in file content.
12. **Determinism** (Principle IV): identical `(filePath, content, adapter, config)` inputs
    produce structurally identical `ParseResult`s, field-for-field, including array orders.

## Test obligations (mapped in quickstart)

- Field-set fixture test: nested checklists + fenced checkbox syntax + phase headings →
  assert every Task field (kind, lines, nesting, phase, extent, ids, refs, featureName,
  uuid shape `^[0-9a-f]{8}-…$`, `unresolvedConflict`).
- Mixed tab/space indentation fixture: nesting equals visual-column nesting of the
  space-equivalent file; orphans attach to the enclosing heading task.
- Summary/rollup fixture: exclusions carry line + reason; excluded lines absent from
  `tasks`; surrounding extents unaffected.
- Flat-document fixture (both triggers) and duplicate-ID/ref fixtures (warning names value
  + every line).
- Conflict fixture: intersecting tasks flagged, non-intersecting not; interior lines not
  tasks; unterminated block freezes to EOF.
- UUID invariance property test: mutate `title`, `checked`, visible issue prefix →
  `stableUuid` unchanged; and determinism repeat-parse deep-equal.
