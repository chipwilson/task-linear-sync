/**
 * Consumer-owned structural view of the 002 § 3 Framework Adapter interface —
 * EXACTLY the members 004 reads (research R1). 003's real adapters satisfy this
 * structurally; no code in src/parsing/ may import from 003 modules or reference the
 * members 004 never calls (detect, taskFilePatterns, titleBehavior, agentHooksDirectory).
 *
 * The interface members are NOT invented here: they are the subset frozen in
 * specs/002-core-domain-contracts/data-model.md § 3 ("the interface *members* are not
 * invented here" — research R1).
 *
 * Boundary rule 2 (verbatim, contracts/adapter-consumption.md): "`parseTaskFile` consumes
 * only the members above. Extra members a real adapter carries (`detect`,
 * `taskFilePatterns`, `titleBehavior`, `agentHooksDirectory`) are invisible to the parser —
 * structural typing means 003 may add or evolve them with zero 004 impact."
 */
import type { FrameworkId } from "../domain/task.js";

export interface TaskFileAdapter {
  /** Recorded on `TaskFile.frameworkId` and every `Task.frameworkId`. */
  readonly id: FrameworkId;
  /** File-level `Feature_Name`; "recording none when none can be derived" (FR-008). */
  featureName(taskFilePath: string): string | undefined;
  /**
   * Optional regex source overriding `config.headingIdGrammar` (research R2 override
   * precedence `adapter.<member> ?? config.<key>`); must expose named groups `id?` and
   * `title` like the frozen default.
   */
  readonly headingGrammar?: string;
  /** Optional regex source overriding `config.phasePattern` (FR-003). */
  readonly phasePattern?: string;
  /** Optional regex source overriding `config.summaryPattern` (FR-004). */
  readonly summaryPattern?: string;
  /** Optional regex source overriding `config.rollupPattern` (FR-004). */
  readonly rollupPattern?: string;
  /**
   * Optional regex source overriding the module-local built-in `LOCAL_ID_SPAN_RE` for the
   * leading local-ID span on CHECKLIST lines (017 amendment 2; must expose the named group
   * `id`). Absent ⇒ built-in default, unchanged for every pre-017 identity (SC-005).
   */
  readonly checklistIdPattern?: string;
  /**
   * Optional regex source for capability-tag tokens stripped from DERIVED titles only
   * (017 amendment 2; consumed by `cleanTitle` via `CleanTitleOptions.titleTagPattern` —
   * never by extraction, file rendering, or task storage). Absent ⇒ no stripping.
   */
  readonly titleTagPattern?: string;
  /**
   * 018 amendment A-018-2 (whitelisted member, 004 adapter-consumption contract): when true,
   * the seed input for a task with a local id is composed as
   * `` `${basename(filePath)}\u0000${localTaskId}` `` at the `parseTaskFile` seed call site —
   * `taskStableSeed` itself and its frozen layout are unchanged; `Task.localTaskId` stays the
   * bare id; adapters omitting this member keep byte-identical seed inputs (SC-005).
   */
  readonly identityFileScope?: boolean;
  /**
   * 022 amendment A-022-2 (whitelisted member): selects DOCUMENT-UNIT task mode. When
   * present, `parseTaskFile` runs the document pipeline INSTEAD of heading/checklist
   * extraction (contracts/parsing-api.md document-mode rules): a file whose path matches
   * `collectionPattern` yields 0-or-1 draft of kind `document` per recognition
   * (non-empty front-matter `idKey` scalar wins; else `fileNameIdPattern` on the
   * basename); the title cascades `titleKey` → body's leading ATX heading → readable
   * file-name slug; content is the body verbatim minus front matter with
   * `taskBody = { startLine: first body line, endLine: last line }`. Every member is a
   * regex SOURCE string or key name (declarative — the parser stays framework-blind).
   * Absent ⇒ extraction unchanged for every other adapter, byte-identical.
   */
  readonly documentTaskRule?: {
    /** Regex source tested against the root-relative POSIX file path (the collection gate). */
    readonly collectionPattern: string;
    /** Front-matter scalar key carrying the stable local id (e.g. `work_package_id`). */
    readonly idKey: string;
    /** Front-matter scalar key carrying the human title (e.g. `title`). */
    readonly titleKey: string;
    /** Regex source (leading `(?i)` = case-insensitive convention) tested on the BASENAME; digits form the normalized id. */
    readonly fileNameIdPattern: string;
  };
}
