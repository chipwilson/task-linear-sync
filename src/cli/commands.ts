/**
 * T010 — twelve-command registry + per-command flag schema (data-model §1;
 * contracts/command-surface.md §1–§2). The single source of truth for the parser
 * (argv.ts) and the `--help` surface; help text uses placeholder identifiers only.
 */

/** Flag argument shape: a bare boolean or a `--flag <value>` option. */
export interface FlagSpec {
  readonly kind: "boolean" | "value";
  /** Value flag whose absence is a usage failure naming the flag (`--plan`). */
  readonly required?: boolean;
  /** Closed value vocabulary validated at parse time (`--mode`). */
  readonly allowedValues?: readonly string[];
}

export interface CommandSpec {
  readonly name: CommandName;
  /** One-line synopsis for `--help` and usage errors. */
  readonly summary: string;
  /** Positional arity: `[repo]` accepted 0–1 for the repository-root commands. */
  readonly positional: { readonly min: number; readonly max: number; readonly noun: string };
  /** Per-command flag schema (global `--config` merged in for every command). */
  readonly flags: Readonly<Record<string, FlagSpec>>;
  /** FR-002 read-only lanes: `plan`/`check` reject the apply vocabulary at parse time. */
  readonly rejectsApplyFlags?: boolean;
}

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

/** Global option accepted by every command (contracts/command-surface.md §1). */
const CONFIG_FLAG: FlagSpec = { kind: "value" };

/** The apply vocabulary shared by `bootstrap`/`sync` (research R9 — gate trio + plan). */
const APPLY_FLAGS: Readonly<Record<string, FlagSpec>> = {
  plan: { kind: "value" },
  apply: { kind: "boolean" },
  confirm: { kind: "value" },
  "accept-low-confidence": { kind: "boolean" },
};

/** Repository-root commands accept 0–1 positional repo path (default `cwd`). */
const REPO_POSITIONAL = { min: 0, max: 1, noun: "repository path" };
const NO_POSITIONAL = { min: 0, max: 0, noun: "" };

function spec(
  name: CommandName,
  summary: string,
  positional: CommandSpec["positional"],
  flags: Readonly<Record<string, FlagSpec>> = {},
  extra: Pick<CommandSpec, "rejectsApplyFlags"> = {},
): CommandSpec {
  return { name, summary, positional, flags: { config: CONFIG_FLAG, ...flags }, ...extra };
}

export const COMMAND_REGISTRY: Readonly<Record<CommandName, CommandSpec>> = {
  inventory: spec(
    "inventory",
    "list discovered task files and parsed task counts (read-only)",
    REPO_POSITIONAL,
  ),
  "discover-metadata": spec(
    "discover-metadata",
    "list configured teams' projects, workflow states and milestones (read-only)",
    REPO_POSITIONAL,
  ),
  plan: spec(
    "plan",
    "build a sync plan and write the paired review report (read-only)",
    REPO_POSITIONAL,
    {},
    { rejectsApplyFlags: true },
  ),
  bootstrap: spec(
    "bootstrap",
    "apply a reviewed plan in bootstrap mode: --plan <planId> --apply --confirm <key>",
    REPO_POSITIONAL,
    APPLY_FLAGS,
  ),
  sync: spec(
    "sync",
    "apply a reviewed plan in sync mode: --plan <planId> --apply --confirm <key>",
    REPO_POSITIONAL,
    APPLY_FLAGS,
  ),
  check: spec(
    "check",
    "plan lane with one machine-readable JSON summary on stdout (read-only)",
    REPO_POSITIONAL,
    {},
    { rejectsApplyFlags: true },
  ),
  "install-hooks": spec(
    "install-hooks",
    "install the managed git hooks (background-queue feature)",
    NO_POSITIONAL,
  ),
  "install-agent-hook": spec(
    "install-agent-hook",
    "scaffold the agent hook template for --framework <id> (no tracker network)",
    NO_POSITIONAL,
    { framework: { kind: "value" } },
  ),
  enqueue: spec(
    "enqueue",
    "record a single pending sync job with --mode bootstrap|sync",
    NO_POSITIONAL,
    { mode: { kind: "value", allowedValues: ["bootstrap", "sync"] } },
  ),
  worker: spec(
    "worker",
    "run the background-queue worker (--once for a single pass)",
    NO_POSITIONAL,
    { once: { kind: "boolean" } },
  ),
  "last-run": spec(
    "last-run",
    "report the last recorded run (--json for one JSON object)",
    NO_POSITIONAL,
    { json: { kind: "boolean" } },
  ),
  rollback: spec(
    "rollback",
    "reverse a journaled run: rollback [repo] <runId>",
    { min: 1, max: 2, noun: "runId" },
  ),
};

/** FR-002 apply-vocabulary tokens rejected on the read-only `plan`/`check` lanes. */
export const APPLY_VOCABULARY_FLAGS = ["--apply", "--confirm", "--accept-low-confidence"] as const;

export function commandSpec(name: string): CommandSpec | undefined {
  return (COMMAND_REGISTRY as Readonly<Record<string, CommandSpec | undefined>>)[name];
}

/** `--help` body: synopsis plus the twelve commands (placeholder identifiers only). */
export function helpLines(): string[] {
  const bin = "task-linear-sync";
  const lines: string[] = [
    `${bin} — operator CLI for the task ⇄ Linear sync`,
    "",
    `usage: ${bin} <command> [repo] [flags]`,
    "",
    "commands:",
  ];
  for (const name of COMMAND_NAMES) {
    lines.push(`  ${name.padEnd(21)}${COMMAND_REGISTRY[name].summary}`);
  }
  lines.push(
    "",
    "global flags: --config <path> (default <repo>/task-linear-sync.json)",
    "exit codes:   0 success · 1 unexpected · 2 usage · 3 configuration · 4 gate-refused",
    "              5 run-aborted · 6 lock-held · 7 surface-unavailable · 8 check-findings",
  );
  return lines;
}
