/**
 * 013-ci-enforcement-layer error taxonomy (T002 + T013; data-model §7).
 *
 * Stable names (asserted by contract tests): CiConfigError, CiArtifactError,
 * CiCliFailureError. Messages carry the offending name/path/code — never
 * report content, secrets, or tokens (FR-011). The exit map (0/1/2/3) is
 * owned by main.ts (wrapper-api.md §3); these classes map 2/2/3.
 */

export class CiConfigError extends Error {
  /** Complete listing: every validation problem, one dotted-key entry each. */
  public readonly problems: readonly string[];

  public constructor(message: string, problems: readonly string[] = []) {
    super(message);
    this.name = "CiConfigError";
    this.problems = [...problems];
  }
}

export class CiArtifactError extends Error {
  /** The offending artifact path (edge case 1: named, never silent). */
  public readonly artifactPath: string;

  public constructor(message: string, artifactPath: string) {
    super(message);
    this.name = "CiArtifactError";
    this.artifactPath = artifactPath;
  }
}

export class CiCliFailureError extends Error {
  /** The wrapped CLI command ("check" | "plan") that failed. */
  public readonly command: string;
  /** Child exit code, or null when the spawn itself failed. */
  public readonly exitCode: number | null;

  public constructor(message: string, command: string, exitCode: number | null) {
    super(message);
    this.name = "CiCliFailureError";
    this.command = command;
    this.exitCode = exitCode;
  }
}

/** Closed wrapper exit map (contracts/wrapper-api.md §3) — distinct from the CLI 0-8 map. */
export const EnforcementExitCode = {
  SUCCESS: 0,
  VIOLATION: 1,
  CONFIGURATION: 2,
  CLI_FAILURE: 3,
} as const;

export type EnforcementExitCode = (typeof EnforcementExitCode)[keyof typeof EnforcementExitCode];
