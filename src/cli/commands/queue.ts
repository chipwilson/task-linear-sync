/**
 * T026 — the five `QueueSurface` presentations (contracts/queue-surface.md §1 rule 2;
 * data-model §6): parse inputs → invoke the injected seam → map outcomes to screened
 * stdout/stderr + exit codes. `refused` ⇒ exit 4 with the `detail` on stderr and NOTHING
 * on stdout; the other statuses and `found: false` ⇒ exit 0. `install-agent-hook` calls
 * the surface with the canonical repository root and performs no port call itself
 * (FR-003 — zero issue-tracker network through this lane).
 */
import { ExitCode } from "../exit-codes.js";
import type { CommandHandler } from "../index.js";
import type { QueueOutcome } from "../queue-surface.js";
import { UsageError } from "../errors.js";

/** Shared refused/skipped handling; `present` runs only for success statuses. */
function presentOutcome(
  run: Parameters<CommandHandler>[0],
  command: string,
  outcome: QueueOutcome,
  present: () => void,
): number {
  if (outcome.status === "refused") {
    run.err.write(`refused: ${outcome.detail ?? `${command} was refused by the queue surface`}`);
    return ExitCode.GATE_REFUSED;
  }
  if (outcome.status === "skipped") {
    run.out.write(`${command} skipped${outcome.detail === undefined ? "" : `: ${outcome.detail}`}`);
    return ExitCode.SUCCESS;
  }
  present();
  return ExitCode.SUCCESS;
}

export const queueHandler: CommandHandler = async (run, context) => {
  const command = run.invocation.command;
  const surface = context.queueSurface;
  const base = { repositoryRoot: run.repositoryRoot, config: run.config };

  switch (command) {
    case "install-hooks": {
      const outcome = await surface.installHooks(base);
      return presentOutcome(run, command, outcome, () => {
        run.out.write(`hooks installed: ${(outcome.installed ?? []).join(", ")}`);
        if (outcome.detail !== undefined) run.out.write(outcome.detail);
      });
    }
    case "install-agent-hook": {
      const framework = run.invocation.flags["framework"];
      const outcome = await surface.installAgentHook({
        ...base,
        frameworkId: typeof framework === "string" ? framework : undefined,
      });
      return presentOutcome(run, command, outcome, () => {
        run.out.write(`agent hook installed at ${outcome.path ?? "(path not reported)"}`);
        if (outcome.detail !== undefined) run.out.write(outcome.detail);
      });
    }
    case "enqueue": {
      const mode = run.invocation.flags["mode"] === "bootstrap" ? "bootstrap" : "sync";
      const outcome = await surface.enqueue({ ...base, mode });
      return presentOutcome(run, command, outcome, () => {
        run.out.write(`enqueued ${mode} job ${outcome.jobId ?? "(id not reported)"}`);
        if (outcome.detail !== undefined) run.out.write(outcome.detail);
      });
    }
    case "worker": {
      const once = run.invocation.flags["once"] === true;
      const outcome = await surface.runWorker({ ...base, once });
      return presentOutcome(run, command, outcome, () => {
        run.out.write(`worker stopped${once ? " after a single pass" : ""}`);
        if (outcome.detail !== undefined) run.out.write(outcome.detail);
      });
    }
    case "last-run": {
      const outcome = await surface.readLastRun({ state: run.state });
      if (run.invocation.flags["json"] === true) {
        // Exactly one JSON object (contract §1: `--json` machine mode).
        run.out.write(outcome.found ? JSON.stringify({ found: true, marker: outcome.marker }) : JSON.stringify({ found: false }));
      } else if (!outcome.found) {
        run.out.write("no run recorded yet");
      } else {
        const marker = outcome.marker;
        if (marker === undefined) {
          run.out.write("no run recorded yet");
        } else {
          run.out.write(`last run ${marker.runId}`);
          run.out.write(`outcome ${marker.outcome}  completed ${marker.completedAt}`);
          if (marker.reportPaths !== null) {
            run.out.write(`report ${marker.reportPaths.json}`);
            run.out.write(`report ${marker.reportPaths.markdown}`);
          }
          if (marker.notificationSuppressed) {
            run.out.write("completion notification was suppressed");
          }
        }
      }
      return ExitCode.SUCCESS;
    }
    default: {
      throw new UsageError(`queue presentation for '${command}' is not available`, []);
    }
  }
};
