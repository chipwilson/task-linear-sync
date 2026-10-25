/**
 * 003-local discovery record types (data-model.md §1–§2). Extends — never redefines — the
 * frozen 002 entities (`TaskFile`/`Task`/`FrameworkId`/`FrameworkMetadata` are consumed from
 * `../domain/task.js` read-only; ROADMAP rule 2).
 */
import type { FrameworkId } from "../domain/task.js";
import type { ResolvedConfig } from "../config/schema.js";
import type { DetectionRecord, DiscoveryOverrides } from "./adapter.js";

/**
 * Identity vocabulary (003-local, research R5). Built-in adapters use ONLY the five frozen
 * FrameworkId literals, so every built-in value is assignable to 002's `TaskFile.frameworkId` /
 * `FrameworkMetadata.frameworkId`. Custom adapter ids (FR-011) are additional strings; the 002
 * union itself is unchanged (widening it is an amendment candidate, not executed here).
 */
export type FrameworkIdentity = FrameworkId | (string & Record<never, never>);

const BUILT_IN_FRAMEWORK_IDS: readonly string[] = ["bmad", "spec-kit", "open-spec", "kiro", "generic"];

/** Type guard distinguishing the frozen 002 `FrameworkId` literals from custom identities (R5). */
export function isBuiltInFrameworkId(value: string): value is FrameworkId {
  return BUILT_IN_FRAMEWORK_IDS.includes(value);
}

/** Version-control context (FR-006 / 001 R1.10): each value omitted individually when unavailable. */
export interface GitContext {
  /** 40-hex (lowercase) from HEAD or a resolved ref. */
  readonly headCommit?: string;
  /** Short ref name when HEAD is symbolic. */
  readonly branch?: string;
  /** `[remote "origin"] url`, verbatim. */
  readonly originRemote?: string;
}

/** Sandbox-escape posture (FR-003; 001 R1.5): refused pre-read, no read performed. */
export interface Refusal {
  /** Root-relative POSIX where representable. */
  readonly path: string;
  readonly reason: "escape";
}

/** Non-root, non-escape partial failure (research R10): traversal continues. */
export interface DiscoveryDiagnostic {
  readonly path: string;
  /** e.g. "unreadable-directory", "unparsable-gitfile". */
  readonly condition: string;
}

/**
 * One discovered regular task file (data-model §1). NOT the frozen `TaskFile` entity —
 * it carries no `tasks[]` (004 owns parsing); 004 keeps `filePath`, `frameworkId` (when
 * built-in), `featureName`, `siblingDocuments` byte-identical to this record.
 */
export interface DiscoveredFile {
  /** Root-relative POSIX (FR-004); unique within a result; sorted lexicographically. */
  readonly filePath: string;
  /** Selected per detection (§4); built-in adapters emit exactly the five frozen literals. */
  readonly frameworkId: FrameworkIdentity;
  /** Winning adapter id (equals frameworkId for built-ins) — diagnostics distinguisher. */
  readonly adapterId: string;
  /** Adapter-extracted (research R9); absent when underivable — never an error. */
  readonly featureName?: string;
  /** Existing configured sibling docs (regular non-symlink files, same directory), in
   * the adapter's configured list order; absent siblings omitted without error (FR-005). */
  readonly siblingDocuments: readonly string[];
  /** How the identity was chosen (transparency for 006/008). */
  readonly detection: DetectionRecord;
}

/** Complete discovery output; all arrays deterministically ordered (SC-002 covers them too). */
export interface DiscoveryResult {
  /** Canonical absolute root (realpath-resolved, FR-001). */
  readonly root: string;
  /** Sorted byte-wise lexicographically on `filePath`; EMPTY array, no error, when nothing matches (FR-004). */
  readonly files: readonly DiscoveredFile[];
  /** Escapes refused pre-read (FR-003 edge case); no read performed. */
  readonly refusals: readonly Refusal[];
  /** Non-root, non-escape partial failures (research R10). */
  readonly diagnostics: readonly DiscoveryDiagnostic[];
  /** Present unless `gitContext: false` requested (FR-006). */
  readonly git?: GitContext;
}

/** Discovery entry options. `config` is the frozen 002 merged config, consumed read-only. */
export interface DiscoverOptions {
  readonly repositoryRoot: string;
  readonly config: ResolvedConfig;
  /** 003's programmatic layer (highest precedence, research R7). */
  readonly overrides?: DiscoveryOverrides;
  /** Default true (FR-006). */
  readonly gitContext?: boolean;
  /** Test-only open observer (SC-003 proof, research R12); records every absolute open. */
  readonly openCountingProbe?: (absolutePath: string) => void;
}

/** Alias for `DiscoverOptions` (data-model §2 / research R1 name; contract code block name is `DiscoverOptions`). */
export type DiscoveryOptions = DiscoverOptions;

/** Thrown by the root pre-flight, aborting with ZERO file reads (FR-002). */
export class DiscoveryRootError extends Error {
  override readonly name = "DiscoveryRootError";
  readonly condition: "missing" | "not-a-directory" | "unreadable";
  readonly requestedPath: string;

  constructor(condition: "missing" | "not-a-directory" | "unreadable", requestedPath: string) {
    super(`repository root '${requestedPath}' failed discovery pre-flight: ${condition}`);
    this.condition = condition;
    this.requestedPath = requestedPath;
  }
}
