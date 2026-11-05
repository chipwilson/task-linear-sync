/**
 * T016 — `task-linear-sync/cli` barrel + `runCli` core dispatch (contracts/command-surface.md;
 * data-model §4/§10). `runCli(argv, context)` is the ONLY entry: parse → context build
 * → handler → present → `CliOutcome { exitCode }`. The bin shim (`main.ts`) and the
 * importable surface share this code (research R8). Handlers never touch `process`.
 */
import { resolve } from "node:path";

import type { ResolvedConfig } from "../config/schema.js";
import type { SecurityScreener } from "../ports/engine.js";
import type { StateStore } from "../state/paths.js";
import { commandSpec } from "./commands.js";
import type { CommandName, CliInvocation } from "./argv.js";
import { parseInvocation } from "./argv.js";
import { helpLines } from "./commands.js";
import { RunAbortedError } from "./errors.js";
import { ExitCode, exitCodeForError } from "./exit-codes.js";
import { createScreenedWriter, oneLine, type WriterPort } from "./io.js";
import type { CliContext } from "./context.js";

export { createProductionContext } from "./context.js";
export type { CliContext, CliLoadConfigOptions } from "./context.js";
export { ExitCode } from "./exit-codes.js";
export {
  UsageError,
  GateRefusalError,
  RunAbortedError,
  ReadOnlyViolationError,
  QueueSurfaceUnavailableError,
} from "./errors.js";
export { COMMAND_NAMES, parseInvocation } from "./argv.js";
export type { CommandName, CliInvocation, ParseFailureInfo, ParseResult } from "./argv.js";
export { createDefaultQueueSurface, QUEUE_MODULE } from "./queue-surface.js";
export type {
  QueueSurface,
  QueueOutcome,
  LastRunOutcome,
  InstallHooksInput,
  InstallAgentHookInput,
  EnqueueInput,
  WorkerInput,
  ReadLastRunInput,
} from "./queue-surface.js";
export { createReadOnlyGuard, guardPort, guardState } from "./readonly-guard.js";
export { createScreenedWriter } from "./io.js";
export type { WriterPort } from "./io.js";

/** Terminal outcome — `main.ts` assigns `process.exitCode = outcome.exitCode`. */
export interface CliOutcome {
  readonly exitCode: number;
}

/** Everything a command handler may consume — assembled once per run. */
export interface Run {
  readonly invocation: CliInvocation;
  /** Canonical repository root: `[repo]` positional else `context.cwd`. */
  readonly repositoryRoot: string;
  readonly config: ResolvedConfig;
  readonly state: StateStore;
  readonly screener: SecurityScreener;
  /** Screened writers (T014) — every printed line passes the screener first. */
  readonly out: WriterPort;
  readonly err: WriterPort;
}

export type CommandHandler = (run: Run, context: CliContext) => Promise<number>;

/**
 * Command handler table — US1 (T021–T027) wires the twelve presentations here.
 * An unwired command aborts (exit 5); it never silently succeeds.
 */
const HANDLERS: Readonly<Partial<Record<CommandName, CommandHandler>>> = {};

function resolveRepositoryRoot(context: CliContext, invocation: CliInvocation): string {
  const spec = commandSpec(invocation.command);
  const candidate = spec !== undefined && spec.positional.max > 0 ? invocation.positional[0] : undefined;
  return resolve(context.cwd, candidate ?? ".");
}

/** Run the CLI for `argv` against an injected context. Never throws; never writes stdout
 * unscreened except static usage/help text (parser messages echo flag tokens only). */
export async function runCli(argv: readonly string[], context: CliContext): Promise<CliOutcome> {
  if (argv[0] === "--help" || argv[0] === "-h") {
    for (const line of helpLines()) context.stdout(line);
    return { exitCode: ExitCode.SUCCESS };
  }

  const parsed = parseInvocation(argv);
  if (!parsed.ok) {
    context.stderr(`error: ${oneLine(parsed.failure.message)}`);
    return { exitCode: ExitCode.USAGE_ERROR };
  }
  const invocation = parsed.invocation;

  let err: WriterPort | null = null;
  try {
    const repositoryRoot = resolveRepositoryRoot(context, invocation);
    const configFlag = invocation.flags["config"];
    const config = context.loadConfig({
      repositoryRoot,
      configFile: typeof configFlag === "string" ? resolve(context.cwd, configFlag) : undefined,
    });
    const state = context.makeState(config, repositoryRoot);
    const screener = context.makeScreener(config);
    const out = createScreenedWriter(context.stdout, screener);
    err = createScreenedWriter(context.stderr, screener);

    const handler: CommandHandler | undefined = HANDLERS[invocation.command];
    if (handler === undefined) {
      throw new RunAbortedError(`command '${invocation.command}' is not wired yet`);
    }
    const code = await handler(
      { invocation, repositoryRoot, config, state, screener, out, err },
      context,
    );
    if (code === ExitCode.SUCCESS && (out.blocked || err.blocked)) {
      return { exitCode: ExitCode.RUN_ABORTED };
    }
    return { exitCode: code };
  } catch (error) {
    const exitCode = exitCodeForError(error);
    const message = error instanceof Error ? error.message : String(error);
    const line = `error: ${oneLine(message)}`;
    if (err !== null) err.write(line);
    else context.stderr(line);
    return { exitCode };
  }
}
