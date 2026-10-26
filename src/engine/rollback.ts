/**
 * `rollbackRun` — resumable, observed-state-guarded rollback (research R11;
 * contracts/journal-rollback.md §2–§5; data-model §9; FR-013/014/015/016; task T044
 * implements, wired by T045; integration T036; contract T030).
 * Refusals reuse the frozen codes: missing journal / journaling disabled ⇒
 * `MANIFEST_UNJOURNALED`; expired header (frozen `isManifestExpired`, clock-injected) ⇒
 * `MANIFEST_EXPIRED`; envelope tag-check failure ⇒ refusal with NO plaintext
 * (`JournalError` diagnostic only). Rollback is itself a mutating run: acquires the
 * advisory lock and writes a run report + `last-run.json` marker. Reverse op-order walk
 * with per-step guards: `rolled-back` ⇒ skip (resume never repeats); current == before ⇒
 * nothing to undo ⇒ `rolled-back`; current == after ⇒ execute inverse (restore file from
 * `fileBackups`; `updateIssue` field→before; `archiveIssue` created issues — never
 * delete; re-upsert `priorMetadata` by URL or no-op where none existed); matches neither
 * ⇒ `conflict-halted` + HALT (`status: "partial"` naming the step; resume re-evaluates).
 * Step-state transitions persist by re-sealing both artifacts after every step.
 * Checkpoint store restored from `checkpointBefore` (absent entries REMOVED, FR-013).
 * History/identity preservation (FR-016): nothing deleted, page-0 canonical retained
 * (identity anchor), payload mirrors restored state, exactly one `rollback` event
 * referencing reversed `opId`s is APPENDED per task. No automatic rollback is performed
 * by applies — the operator decides (§5).
 */
import type { RollbackResult, EngineDependencies } from "../ports/engine.js";
import type { ResolvedEngineOptions } from "./options.js";

/**
 * Roll back the journaled run `runId` (contracts/journal-rollback.md §2–§4). Returns
 * frozen `RollbackResult`: `"rolled-back" | "partial" | "refused"` with frozen
 * `GateFailure` refusals only. T044 implements (T036); T045 wires it through
 * `createSyncEngine`.
 */
export async function rollbackRun(
  deps: EngineDependencies,
  options: ResolvedEngineOptions,
  runId: string,
): Promise<RollbackResult> {
  void [deps, options, runId]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: rollback");
}
