/**
 * T024 — `bootstrap`/`sync` apply presentation (research R9): load the `StoredPlan` for
 * `--plan <planId>` (absent ⇒ the frozen `PLAN_REFERENCE_UNKNOWN` refusal), construct the
 * `GateRequest` verbatim from the flags — zero CLI-side gating — and present the
 * `ApplyResult`: refused ⇒ exit 4 naming EVERY `GateFailure.code` (complete listing,
 * LOCK_HELD re-maps to 6), aborted ⇒ exit 5, applied ⇒ exit 0 with operation counts and
 * the report pair paths. Mode is engine-selected; the CLI never forces bootstrap/sync.
 */
import type { StoredPlan } from "../../domain/plan.js";
import { GateRefusalError, RunAbortedError, UsageError } from "../errors.js";
import { ExitCode } from "../exit-codes.js";
import type { CommandHandler } from "../index.js";

const PLAN_ID = /^[0-9a-f]{64}$/;

export const applyHandler: CommandHandler = async (run) => {
  const command = run.invocation.command;
  const flags = run.invocation.flags;
  const planReference = flags["plan"];
  if (typeof planReference !== "string" || planReference.length === 0) {
    throw new UsageError(
      `${command} requires --plan <planId> — review a plan first with \`task-linear-sync plan\` and pass the printed plan id`,
      ["--plan"],
    );
  }
  if (flags["apply"] !== true) {
    throw new UsageError(`${command} requires --apply — applying a plan is always explicit`, ["--apply"]);
  }
  const confirmationKey = flags["confirm"];
  if (typeof confirmationKey !== "string" || confirmationKey.length === 0) {
    throw new UsageError(`${command} requires --confirm <key> — the configured confirmation key`, ["--confirm"]);
  }

  if (!PLAN_ID.test(planReference)) {
    throw new GateRefusalError([
      {
        code: "PLAN_REFERENCE_UNKNOWN",
        detail: `--plan '${planReference}' is not a stored plan reference (expected a 64-character sha256 hex plan id)`,
      },
    ]);
  }
  const stored = await run.state.readJson<StoredPlan>(`plans/${planReference}.json`);
  if (stored === null) {
    throw new GateRefusalError([
      { code: "PLAN_REFERENCE_UNKNOWN", detail: `no stored plan found for --plan '${planReference}'` },
    ]);
  }

  const result = await run.engine.applySyncPlan(stored.plan, {
    applyFlag: true,
    confirmationKey,
    acceptLowConfidence: flags["accept-low-confidence"] === true,
    planReference,
  });

  if (result.status === "refused") {
    throw new GateRefusalError(result.gateFailures);
  }
  if (result.status === "aborted") {
    for (const outcome of result.operations) {
      if (outcome.status === "failed") {
        run.err.write(`failed ${outcome.taskUuid}: ${outcome.detail ?? "operation failed"}`);
      }
    }
    throw new RunAbortedError(
      `${command} aborted for plan ${planReference} (run ${result.runId}) — mutations were reversed where possible; see the run reports`,
    );
  }

  let applied = 0;
  let skipped = 0;
  let failed = 0;
  for (const outcome of result.operations) {
    if (outcome.status === "applied") applied += 1;
    else if (outcome.status === "skipped") skipped += 1;
    else failed += 1;
  }
  run.out.write(`applied run ${result.runId}`);
  run.out.write(`operations: ${applied} applied, ${skipped} skipped, ${failed} failed`);
  if (result.reportPaths !== undefined) {
    run.out.write(`report ${result.reportPaths.json}`);
    run.out.write(`report ${result.reportPaths.markdown}`);
  }
  return ExitCode.SUCCESS;
};
