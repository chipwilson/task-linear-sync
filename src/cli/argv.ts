/**
 * T011 — pure argv parser (data-model §1; research R2). PLACEHOLDER until T011 lands:
 * parsing not yet implemented.
 */

/** The twelve command names (data-model §1; contracts/command-surface.md §1). */
export const COMMAND_NAMES = [
  "inventory",
  "discover-metadata",
  "plan",
  "bootstrap",
  "sync",
  "check",
  "install-hooks",
  "install-agent-hook",
  "enqueue",
  "worker",
  "last-run",
  "rollback",
] as const;

export type CommandName = (typeof COMMAND_NAMES)[number];

export interface CliInvocation {
  readonly command: CommandName;
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string | true>>;
}

export interface ParseFailureInfo {
  readonly message: string;
  readonly flags: readonly string[];
}

export type ParseResult =
  | { readonly ok: true; readonly invocation: CliInvocation }
  | { readonly ok: false; readonly failure: ParseFailureInfo };

/** Pure parser — placeholder stub: every invocation currently fails parsing. */
export function parseInvocation(_argv: readonly string[]): ParseResult {
  return { ok: false, failure: { message: "parser not implemented yet", flags: [] } };
}
