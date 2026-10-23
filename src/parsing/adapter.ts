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
}
