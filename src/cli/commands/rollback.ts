/**
 * T025 — `rollback [repo] <runId>`: the engine's journaled reversal and nothing else
 * (FR-004 — zero CLI-side mutation or write). `status: "refused"` ⇒ exit 4 naming the
 * frozen `MANIFEST_UNJOURNALED`/`MANIFEST_EXPIRED` code with its verbatim detail;
 * `rolled-back` ⇒ exit 0; `partial` ⇒ exit 5 — both presenting `reversedOperations`.
 */
import { GateRefusalError, RunAbortedError, UsageError } from "../errors.js";
import { ExitCode } from "../exit-codes.js";
import type { CommandHandler } from "../index.js";

const RUN_ID = /^[0-9a-f]{64}$/;

export const rollbackHandler: CommandHandler = async (run) => {
  const positional = run.invocation.positional;
  if (positional.length === 0) {
    throw new UsageError("rollback requires a <runId> — the run to reverse (see `task-linear-sync last-run`)", []);
  }
  const runId = positional[positional.length - 1] as string;
  if (!RUN_ID.test(runId)) {
    throw new UsageError(
      `rollback <runId> must be a 64-character sha256 hex run id — got '${runId}'`,
      [],
    );
  }

  const result = await run.engine.rollbackRun(runId);
  if (result.status === "refused") {
    throw new GateRefusalError([
      result.refusal ?? { code: "MANIFEST_UNJOURNALED", detail: `run ${runId} has no journal to roll back` },
    ]);
  }
  run.out.write(`rolled back run ${result.runId}`);
  run.out.write(`reversed operations: ${result.reversedOperations}`);
  if (result.status === "partial") {
    throw new RunAbortedError(
      `rollback of run ${result.runId} completed partially — ${result.reversedOperations} operations reversed; the journal is retained for a retry`,
    );
  }
  return ExitCode.SUCCESS;
};
