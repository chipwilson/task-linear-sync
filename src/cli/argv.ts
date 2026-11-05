/**
 * T011 — pure argv parser (data-model §1; research R2; contracts/command-surface.md §1–§2).
 * Hand-rolled over the T010 schema — no `node:util parseArgs`, zero dependencies. The
 * parser performs ZERO I/O: same argv ⇒ byte-identical outcome. FR-002: `plan`/`check`
 * with any apply-vocabulary flag fails naming EVERY offending flag (complete listing,
 * never fail-fast-on-first).
 */
import {
  APPLY_VOCABULARY_FLAGS,
  type CommandName,
  type CommandSpec,
  type FlagSpec,
  commandSpec,
} from "./commands.js";

export { COMMAND_NAMES } from "./commands.js";
export type { CommandName } from "./commands.js";

/** Parsed command (data-model §1). */
export interface CliInvocation {
  readonly command: CommandName;
  readonly positional: readonly string[];
  readonly flags: Readonly<Record<string, string | true>>;
}

/** Parse failure VALUE (never thrown) — carries every offending flag token (§2). */
export interface ParseFailureInfo {
  readonly message: string;
  readonly flags: readonly string[];
}

export type ParseResult =
  | { readonly ok: true; readonly invocation: CliInvocation }
  | { readonly ok: false; readonly failure: ParseFailureInfo };

function fail(message: string, flags: readonly string[] = []): ParseResult {
  return { ok: false, failure: { message, flags } };
}

function arityLabel(spec: CommandSpec): string {
  if (spec.positional.min === 0 && spec.positional.max === 0) return "no positional arguments";
  if (spec.positional.min === 1) return `[repo] <${spec.positional.noun}>`;
  return `[repo] — at most ${spec.positional.max} positional argument(s)`;
}

function isFlagToken(token: string): boolean {
  return token.startsWith("--");
}

function isApplyVocabulary(token: string): boolean {
  return (APPLY_VOCABULARY_FLAGS as readonly string[]).includes(token);
}

/** Normative FR-002 message shape (contracts/command-surface.md §2). */
function fr002Message(offenders: readonly string[]): string {
  return (
    `refusing plan with apply flag(s): ${offenders.join(", ")} — plan is read-only; ` +
    "use `bootstrap`/`sync` with --plan, --apply, --confirm to apply a reviewed plan"
  );
}

/**
 * Parse argv into a `CliInvocation` or a `ParseFailure` value. Validation order:
 * command → FR-002 apply-flag rejection → unknown flags → required flags → arity.
 */
export function parseInvocation(argv: readonly string[]): ParseResult {
  if (argv.length === 0) {
    return fail("usage: task-linear-sync <command> [repo] [flags] — run `task-linear-sync --help` to list the twelve commands");
  }
  const name = argv[0] as string;
  const spec = isFlagToken(name) ? undefined : commandSpec(name);
  if (spec === undefined) {
    return fail(`unknown command '${name}' — run \`task-linear-sync --help\` to list the twelve commands`);
  }

  const flags: Record<string, string | true> = {};
  const positional: string[] = [];
  const unknownFlags: string[] = [];
  const applyOffenders: string[] = [];

  for (let i = 1; i < argv.length; i += 1) {
    const token = argv[i] as string;
    if (!isFlagToken(token)) {
      positional.push(token);
      continue;
    }
    // FR-002: on the read-only lanes the apply vocabulary is collected (never accepted).
    if (spec.rejectsApplyFlags === true && isApplyVocabulary(token)) {
      applyOffenders.push(token);
      // Consume a following value (e.g. `--confirm <key>`) so it never reads as positional.
      const next = argv[i + 1];
      if (token === "--confirm" && next !== undefined && !isFlagToken(next)) i += 1;
      continue;
    }
    const flagName = token.slice(2);
    const flag: FlagSpec | undefined = spec.flags[flagName];
    if (flag === undefined) {
      unknownFlags.push(token);
      continue;
    }
    if (flag.kind === "boolean") {
      flags[flagName] = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || isFlagToken(value)) {
      return fail(`--${flagName} requires a value`, [`--${flagName}`]);
    }
    if (flag.allowedValues !== undefined && !flag.allowedValues.includes(value)) {
      return fail(
        `--${flagName} must be one of ${flag.allowedValues.join("|")} (got '${value}')`,
        [`--${flagName}`],
      );
    }
    flags[flagName] = value;
    i += 1;
  }

  if (applyOffenders.length > 0) {
    return fail(fr002Message(applyOffenders), applyOffenders);
  }
  if (unknownFlags.length > 0) {
    return fail(
      `unknown option${unknownFlags.length > 1 ? "s" : ""} for '${spec.name}': ${unknownFlags.join(" ")}`,
      unknownFlags,
    );
  }
  for (const [flagName, flag] of Object.entries(spec.flags)) {
    if (flag.required === true && !(flagName in flags)) {
      return fail(`'${spec.name}' requires --${flagName} <${flagName}> (a reviewed plan)`, [`--${flagName}`]);
    }
  }
  // `--plan` is required exactly when `--apply` is present: a bare bootstrap/sync
  // parses and previews; applying without a reviewed plan reference is a usage
  // error (data-model §1 — the CLI never guesses which plan to apply).
  if (flags.apply === true && !("plan" in flags)) {
    return fail(
      `'${spec.name}' with --apply requires --plan <planId> (the reviewed plan to apply)`,
      ["--plan"],
    );
  }
  if (positional.length > spec.positional.max) {
    return fail(
      `too many positional arguments for '${spec.name}' — expected ${arityLabel(spec)}`,
    );
  }
  if (positional.length < spec.positional.min) {
    return fail(
      `'${spec.name}' requires a <${spec.positional.noun}> positional — expected ${arityLabel(spec)}`,
    );
  }
  return { ok: true, invocation: { command: spec.name, positional, flags } };
}
