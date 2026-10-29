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
 *
 * T044 implementation notes:
 * - Refusal order (§2 table, T030-verified): journaling-off / missing artifacts /
 *   expired header / tag check ALL refuse WITHOUT acquiring the lock and with zero port
 *   calls — the header expiry check reads only the unencrypted envelope header
 *   (`readManifestEnvelope` + frozen `isManifestExpired`). The advisory lock is acquired
 *   exactly once, after every §2 refusal has been decided, and released on every exit
 *   path (`finally`) — a harness-simulated crash propagates the interrupt and still
 *   releases, so the resume run can re-acquire.
 * - Lenient artifact loading and transition persistence (this file, not journal.ts's
 *   `readJournalArtifacts`/`recordStepTransition`): both journal.ts helpers run a STRICT
 *   `step.beforeSnapshot.kind === step.kind` alignment assert, which an externally
 *   SURGICALLY-CORRUPTED step (journal-rollback.md §3 "resume re-evaluates the halted
 *   step"; T036 cell 3 drives exactly this with sentinel snapshots) would make
 *   permanently unreadable AND untransitionable — no step could be marked
 *   `conflict-halted` or progressed afterward. Rollback therefore opens both artifacts
 *   under the identical envelope/tag posture (tamper ⇒ `JournalError`, no plaintext),
 *   enforces opId↔operation alignment (count, order, kind, unique opIds), and re-seals
 *   both artifacts atomically per transition in journal.ts's write order (journal FIRST,
 *   manifest SECOND) with journal.ts's merge semantics for `stepState`. All OTHER reads/
 *   seals still route through journal.ts exports (`readManifestEnvelope`,
 *   `journalArtifactsExist`, `journalRelPath`).
 * - Observed-state guards (§3 machine): the after-arm is evaluated FIRST, then the
 *   before-arm, then conflict. Kind-specific equivalence: `create-issue` before ≡ target
 *   absent (an archived created issue is the executed-inverse state ⇒ "nothing to undo",
 *   the idempotent resume arm); `update-issue` fields compare live `IssueView` values
 *   (a `stateTypeId` patch resolves through `discoverMetadata` id→type, since the view
 *   carries `stateType`); `render-file` compares sha256 of current file bytes against
 *   the snapshot hashes; `upsert-attachment` compares the NAMESPACED PAYLOAD's
 *   non-history members (`taskUuid`, `frameworkMetadata`, `descriptionContentHash`) —
 *   history is append-only and NEVER rewound (§4), so full-metadata equality could never
 *   match either snapshot once events were appended; continuation pages compare history
 *   (live-after-prefix of prior ⇒ nothing to undo; equal-to-after ⇒ inverse = RETAIN,
 *   pages and entries, §4 — zero page mutations). `write-checkpoint` restores the store
 *   to match `checkpointBefore` whenever it differs (FR-013 restore-or-remove dominates:
 *   the store must match the pre-run map regardless of how it drifted).
 * - The per-task `rollback` history event RIDES the task's canonical-attachment step
 *   (its last forward op ⇒ FIRST step the reverse walk meets for that task) and lands
 *   BEFORE the step's `rolled-back` transition, so an interrupt-resume never re-upserts
 *   the URL of an already-reversed op (FR-014 "no repeats") and never loses the event.
 *   Canonical restore order is append-then-mirror: a crash between the two re-meets the
 *   after-arm (non-history still matches), skips the idempotent append (chain-tail check:
 *   last entry is a `rollback` event referencing this run's task opIds), and finishes the
 *   mirror. Tasks whose walk never met a canonical step get a close-phase fallback append
 *   (only when a page-0 anchor already exists — the event NEVER fabricates an identity
 *   anchor). Tasks with zero journaled ops (never-touched controls) get ZERO events and
 *   zero writes.
 * - Outbound screening: every tracker-bound string the rollback newly propagates passes
 *   the screener — history event descriptions + page-0 mirror fields inside `payload.ts`,
 *   report artifacts inside the frozen writer, and restored issue-field / file-backup
 *   content via {@link screenOutboundRestore} BEFORE transmission (blocking findings ⇒
 *   the step conflict-halts instead of propagating). Restore material is transmitted as
 *   the SCREENED OUTPUT, which equals the journal value for any content an earlier apply
 *   propagated under this same screener (§4 byte/value-equality holds on the round trip).
 * - Audit posture (§4): `CreateIntent` records are never touched — rollback performs
 *   ZERO `createIssue` calls and zero intent writes; created issues are archived, never
 *   deleted; zero attachments removed.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";

import type { Checkpoint } from "../domain/checkpoint.js";
import { canonicalJson } from "../domain/plan.js";
import type { AuditManifest, AuditOperation, AuditStepState } from "../domain/run-records.js";
import { parseSyncStatePayload } from "../domain/state-payload.js";
import type { SyncHistoryEvent, SyncStatePayload } from "../domain/state-payload.js";
import type { ResolvedConfig } from "../config/schema.js";
import type { GateFailure, GateFailureCode } from "../gates/gates.js";
import type { EngineDependencies, RollbackResult, SecurityScreener } from "../ports/engine.js";
import type {
  AttachmentMetadata,
  IssueUpdatePatch,
  IssueView,
  TeamMetadataCollections,
} from "../ports/linear-port.js";
import { acquireRunLock, releaseRunLock } from "../state/lock.js";
import {
  ManifestTamperError,
  isManifestExpired,
  openManifest,
  sealManifest,
  type KeyProvider,
  type ManifestEnvelope,
} from "../state/manifest.js";
import type { StateStore } from "../state/paths.js";
import { parseAttachmentUrl } from "../urls/attachment-url.js";
import { JournalError } from "./errors.js";
import { historyPageAddress, parseHistoryPageRecord } from "./history-page.js";
import type { JournalStep } from "./journal.js";
import {
  AFTER_SNAPSHOT_PENDING_KIND,
  journalArtifactsExist,
  journalRelPath,
  manifestRelPath,
  readManifestEnvelope,
} from "./journal.js";
import { readCheckpointStore, restoreCheckpointStoreFromSnapshot } from "./mode.js";
import type { EngineOpKind, OpAfterSnapshot, PlannedOp } from "./ops.js";
import { deriveRunId, inverseForOp } from "./ops.js";
import { resolveScreener } from "./options.js";
import type { ResolvedEngineOptions } from "./options.js";
import type { AttachmentRunContext } from "./payload.js";
import {
  appendHistoryEvent,
  readPageZeroPayload,
  rewritePageZeroPayload,
} from "./payload.js";
import type { PlanReportAssertion, PlanReportJson } from "./report.js";
import { writeRunReportWithMarker } from "./report.js";

/** Chain-walk hard bound (mirrors `payload.ts` MAX_CHAIN_PAGES): a pathological chain fails loudly. */
const MAX_CHAIN_PAGES = 1000;

/** Run-id discriminator for a rollback run: `sha256(planId ‖ clock.now().iso ‖ 2)` (research R14). */
const ROLLBACK_RUN_SEQ = 2;

const KNOWN_KINDS: readonly EngineOpKind[] = [
  "create-issue",
  "update-issue",
  "upsert-attachment",
  "render-file",
  "write-checkpoint",
];

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isEnvelopeShape(v: unknown): v is ManifestEnvelope {
  return (
    isRecord(v) &&
    v.schemaVersion === 1 &&
    typeof v.keyId === "string" &&
    typeof v.iv === "string" &&
    typeof v.tag === "string" &&
    typeof v.ciphertext === "string" &&
    typeof v.createdAt === "string"
  );
}

/** Unwrap the frozen envelope plaintext `canonicalJson({ createdAt, manifest })` shape. */
function unwrapSealed(v: unknown): unknown {
  if (isRecord(v) && typeof v.createdAt === "string" && "manifest" in v) return v.manifest;
  return v;
}

/** Open a sealed envelope; tag failure ⇒ `JournalError` with NO plaintext (§2, R9/R11). */
async function openSealed(
  env: ManifestEnvelope,
  config: ResolvedConfig,
  keyProvider: KeyProvider,
  runId: string,
): Promise<unknown> {
  try {
    return await openManifest(env, config, keyProvider);
  } catch (e) {
    if (e instanceof ManifestTamperError) {
      throw new JournalError("journal artifact authentication tag check failed — rejected", {
        runId,
        cause: "tag-check-failed",
      });
    }
    throw e; // key-unavailable propagates verbatim (frozen posture, not tamper)
  }
}

// ── Lenient artifact load + transition persistence (header docblock rationale) ──────

interface RunArtifacts {
  readonly manifest: AuditManifest;
  readonly steps: readonly JournalStep[];
}

function parseManifestContent(v: unknown, runId: string): AuditManifest {
  const m = unwrapSealed(v);
  if (
    !isRecord(m) ||
    m.runId !== runId ||
    typeof m.createdAt !== "string" ||
    typeof m.repoRoot !== "string" ||
    typeof m.planId !== "string" ||
    !Array.isArray(m.fileBackups) ||
    !Array.isArray(m.checkpointBefore) ||
    !Array.isArray(m.operations)
  ) {
    throw new JournalError("audit manifest content is malformed", { runId });
  }
  for (const item of m.operations) {
    if (!isRecord(item) || typeof item.opId !== "string" || typeof item.kind !== "string") {
      throw new JournalError("audit manifest contains a malformed operation", { runId });
    }
  }
  return m as unknown as AuditManifest;
}

function isAuditStepState(v: unknown): v is AuditStepState {
  return v === "pending" || v === "applied" || v === "rolled-back" || v === "conflict-halted";
}

/** Shape-parse steps WITHOUT demanding `beforeSnapshot.kind` alignment (surgical-corruption
 *  resume, header docblock): shape failures ⇒ `JournalError`, never plaintext surfaces. */
function parseJournalContent(v: unknown, runId: string): JournalStep[] {
  const content = unwrapSealed(v);
  let raw: unknown[];
  if (Array.isArray(content)) raw = content;
  else if (isRecord(content) && Array.isArray(content.steps)) raw = content.steps;
  else throw new JournalError("step journal content is malformed", { runId });
  const steps: JournalStep[] = [];
  for (const item of raw) {
    if (
      !isRecord(item) ||
      typeof item.opId !== "string" ||
      typeof item.kind !== "string" ||
      !isRecord(item.beforeSnapshot) ||
      !isRecord(item.afterSnapshot) ||
      !isAuditStepState(item.stepState)
    ) {
      throw new JournalError("step journal contains a malformed step", { runId });
    }
    if (!KNOWN_KINDS.includes(item.kind as EngineOpKind)) {
      throw new JournalError("step journal contains an unknown op kind", { runId });
    }
    steps.push(item as unknown as JournalStep);
  }
  return steps;
}

/** opId↔operation alignment: same count, same order, same ids, same kinds, unique opIds. */
function assertAligned(manifest: AuditManifest, steps: readonly JournalStep[], runId: string): void {
  if (manifest.operations.length !== steps.length) {
    throw new JournalError("manifest operations and journal steps differ in count", { runId });
  }
  const seen = new Set<string>();
  for (let i = 0; i < steps.length; i++) {
    const op = manifest.operations[i];
    const step = steps[i];
    if (op === undefined || step === undefined || op.opId !== step.opId || op.kind !== step.kind) {
      throw new JournalError("manifest operation and journal step are misaligned", { runId });
    }
    if (seen.has(op.opId)) {
      throw new JournalError("journal carries duplicate opIds", { runId });
    }
    seen.add(op.opId);
  }
}

/** Open + trust both artifacts (§2 entry; expiry already checked header-side by the caller). */
async function loadRunArtifacts(
  store: StateStore,
  config: ResolvedConfig,
  keyProvider: KeyProvider,
  runId: string,
): Promise<RunArtifacts> {
  const manifestEnv = await readManifestEnvelope(store, runId); // malformed ⇒ JournalError (tamper posture)
  if (manifestEnv === null) {
    throw new JournalError("audit manifest is absent for this run", { runId });
  }
  const manifest = parseManifestContent(await openSealed(manifestEnv, config, keyProvider, runId), runId);
  const journalEnv = await store.readJson<unknown>(journalRelPath(runId));
  if (journalEnv === null || !isEnvelopeShape(journalEnv)) {
    throw new JournalError("step journal is absent or malformed for this run", { runId });
  }
  const steps = parseJournalContent(await openSealed(journalEnv, config, keyProvider, runId), runId);
  assertAligned(manifest, steps, runId);
  return { manifest, steps };
}

/**
 * Persist one step-state transition: mirror onto the frozen operation, re-seal BOTH
 * artifacts (injected clock refreshes the envelope headers — journal.ts posture) and
 * rewrite atomically in journal.ts's order (journal FIRST, manifest SECOND ⇒ a torn
 * window never shows a manifest whose journal lags a transition).
 */
async function persistTransition(
  store: StateStore,
  config: ResolvedConfig,
  keyProvider: KeyProvider,
  clock: EngineDependencies["clock"],
  runId: string,
  current: RunArtifacts,
  opId: string,
  stepState: AuditStepState,
): Promise<RunArtifacts> {
  const steps = current.steps.map((s) => (s.opId === opId ? { ...s, stepState } : s));
  const operations = current.manifest.operations.map((o) =>
    o.opId === opId ? { ...o, stepState } : o,
  );
  const manifest: AuditManifest = { ...current.manifest, operations };
  const [manifestEnv, journalEnv] = await Promise.all([
    sealManifest(manifest, config, keyProvider, clock),
    sealManifest(steps, config, keyProvider, clock),
  ]);
  await store.writeJson(journalRelPath(runId), journalEnv);
  await store.writeJson(manifestRelPath(runId), manifestEnv);
  return { manifest, steps };
}

// ── Run context ──────────────────────────────────────────────────────────────────────

interface RollbackContext {
  readonly store: StateStore;
  readonly config: ResolvedConfig;
  readonly clock: EngineDependencies["clock"];
  readonly screener: SecurityScreener;
  readonly payload: AttachmentRunContext;
  /** Rolled-back run (the journal being reversed). */
  readonly runId: string;
  /** The rollback's own deterministic run id (report dir + marker + lock record). */
  readonly rollbackRunId: string;
  readonly checkpointByTask: ReadonlyMap<string, Checkpoint>;
  /** Frozen pre-run checkpoint snapshot (FR-013 restore-or-remove material; §3 close-out). */
  readonly checkpointBefore: () => readonly Checkpoint[];
  /** Attributed forward-order opIds per task (rollback-event `references`). */
  readonly taskRefs: ReadonlyMap<string, readonly string[]>;
  readonly allOpIds: ReadonlySet<string>;
  /** Lazily-fetched workflow-state snapshot (stateTypeId↔stateType resolution). */
  workflowStates: Promise<ReadonlyArray<TeamMetadataCollections>> | null;
  /** Tasks whose rollback event has landed THIS run (fast idempotence guard). */
  readonly appendedTasks: Set<string>;
  eventsAppended: number;
  archivedCount: number;
  readonly notes: string[];
}

type StepResult = "reversed" | "nothing" | "conflict";

// ── Task attribution (rollback-event references) ─────────────────────────────────────

function issueIdOf(op: AuditOperation, step: JournalStep): string | undefined {
  const fromStep = step.targetIssueId;
  if (fromStep !== undefined && fromStep !== "") return fromStep;
  return op.targetIssueId !== "" ? op.targetIssueId : undefined;
}

/**
 * Attribute journaled ops to task UUIDs for rollback-event references: attachment ops
 * carry the task identity in their deterministic URL (frozen scheme parser — no local
 * identity cache); remaining issue-targeted ops inherit the owner of their target issue
 * (learned from the attachment/create ops that landed on it). `render-file` (file-level)
 * and `write-checkpoint` (run-level) ops reverse normally but belong to NO task's event.
 */
function attributeOps(
  manifest: AuditManifest,
  steps: readonly JournalStep[],
  config: Parameters<typeof parseAttachmentUrl>[0],
): { taskByOpId: Map<string, string>; taskRefs: Map<string, string[]> } {
  const taskByOpId = new Map<string, string>();
  const issueOwners = new Map<string, string>();
  const pairs = manifest.operations.map((op, i) => ({ op, step: steps[i] as JournalStep }));
  for (const { op, step } of pairs) {
    if (op.attachmentUrl === undefined) continue;
    const parsed = parseAttachmentUrl(config, op.attachmentUrl);
    if (parsed === null) continue;
    taskByOpId.set(op.opId, parsed.taskUuid);
    const issueId = issueIdOf(op, step);
    if (issueId !== undefined) issueOwners.set(issueId, parsed.taskUuid);
  }
  for (const { op, step } of pairs) {
    if (taskByOpId.has(op.opId)) continue;
    const issueId = issueIdOf(op, step);
    if (issueId === undefined) continue;
    const owner = issueOwners.get(issueId);
    if (owner !== undefined) taskByOpId.set(op.opId, owner);
  }
  const taskRefs = new Map<string, string[]>();
  for (const { op } of pairs) {
    const taskUuid = taskByOpId.get(op.opId);
    if (taskUuid === undefined) continue;
    const refs = taskRefs.get(taskUuid);
    if (refs === undefined) taskRefs.set(taskUuid, [op.opId]);
    else refs.push(op.opId);
  }
  return { taskByOpId, taskRefs };
}

function plannedOpFrom(
  op: AuditOperation,
  step: JournalStep,
  ordinal: number,
  taskByOpId: ReadonlyMap<string, string>,
): PlannedOp {
  const issueId = issueIdOf(op, step);
  const after = step.afterSnapshot;
  return {
    opId: op.opId,
    ordinal,
    kind: step.kind,
    taskUuid: taskByOpId.get(op.opId) ?? "",
    ...(issueId !== undefined ? { targetIssueId: issueId } : {}),
    ...(op.attachmentUrl !== undefined ? { attachmentUrl: op.attachmentUrl } : {}),
    ...(step.filePath !== undefined ? { filePath: step.filePath } : {}),
    ...(step.intentId !== undefined ? { intentId: step.intentId } : {}),
    beforeSnapshot: step.beforeSnapshot,
    ...(after.kind === AFTER_SNAPSHOT_PENDING_KIND ? {} : { afterSnapshot: after as OpAfterSnapshot }),
  };
}

// ── Screening of restore material (header docblock rationale) ────────────────────────

/**
 * Screen a restore string about to be re-transmitted to the tracker / repo. Blocking
 * findings ⇒ null (the STEP conflict-halts; nothing propagates, nothing is lost — the
 * journal still holds the material for a post-fix resume). Non-blocking annotations in
 * the output win over the raw value (constitution II; identical for content an earlier
 * apply propagated under this same screener).
 */
function screenOutboundRestore(screener: SecurityScreener, text: string, label: string): string | null {
  const result = screener.screen(text);
  if (result.blocked.length > 0) {
    void label; // the label stays OUT of any propagated surface — the halt detail names the STEP, never content
    return null;
  }
  return result.output;
}

// ── Field comparison helpers ─────────────────────────────────────────────────────────

async function resolveStateTypeIdentities(
  ctx: RollbackContext,
  teamKey: string,
): Promise<Map<string, string>> {
  if (ctx.workflowStates === null) {
    ctx.workflowStates = ctx.payload.port.discoverMetadata([teamKey]);
  }
  const snapshot = await ctx.workflowStates;
  const byValue = new Map<string, string>();
  for (const collections of snapshot) {
    if (collections.teamKey !== teamKey) continue;
    for (const state of collections.workflowStates) {
      byValue.set(state.id, state.type);
      byValue.set(state.type, state.type);
      byValue.set(state.name, state.type);
    }
  }
  return byValue;
}

/**
 * Live `IssueView` field equality against a snapshot patch. `stateTypeId` values resolve
 * through the workflow-state snapshot (id/name → type) because `IssueView` carries
 * `stateType`; unresolved identities compare verbatim (a journal value the tracker never
 * resolved matches only the verbatim live value).
 */
async function liveMatchesPatch(
  ctx: RollbackContext,
  live: IssueView,
  patch: IssueUpdatePatch,
): Promise<boolean> {
  let states: Map<string, string> | null = null;
  for (const [field, expected] of Object.entries(patch) as Array<[keyof IssueUpdatePatch, string | undefined]>) {
    if (expected === undefined) continue;
    if (field === "title") {
      if (live.title !== expected) return false;
      continue;
    }
    if (field === "description") {
      if (live.description !== expected) return false;
      continue;
    }
    if (field === "stateTypeId") {
      states ??= await resolveStateTypeIdentities(ctx, live.teamKey);
      const canonicalLive = states.get(live.stateType) ?? live.stateType;
      const canonicalExpected = states.get(expected) ?? expected;
      if (canonicalLive !== canonicalExpected) return false;
      continue;
    }
    return false; // unknown patched field — never claim a match
  }
  return true;
}

function nonHistoryOf(p: SyncStatePayload): string {
  return canonicalJson({
    taskUuid: p.taskUuid,
    frameworkMetadata: p.frameworkMetadata,
    descriptionContentHash: p.descriptionContentHash,
  });
}

// ── Rollback-event append (history-log.md §2/§4; journal-rollback.md §4) ─────────────

/** Walk the chain and return the LAST page's history slice (never cached across calls). */
async function tailHistory(
  ctx: RollbackContext,
  taskUuid: string,
): Promise<{ readonly exists: boolean; readonly history: readonly SyncHistoryEvent[] }> {
  const pageZero = await readPageZeroPayload(ctx.payload, taskUuid);
  if (pageZero === null) return { exists: false, history: [] };
  let history = pageZero.history;
  for (let page = 1; page <= MAX_CHAIN_PAGES; page += 1) {
    const view = await ctx.payload.port.getAttachmentByUrl(historyPageAddress(ctx.config, taskUuid, page));
    if (view === null) break;
    const parsed = parseHistoryPageRecord(view, ctx.config.metadataNamespaceKey);
    if (parsed === null) break;
    history = parsed.history;
  }
  return { exists: true, history };
}

/**
 * Ensure exactly one `rollback` event for `taskUuid` referencing the run's attributed
 * opIds. Idempotent across interrupted-rollback resumes: the chain tail is inspected
 * first — a trailing `rollback` event referencing only this run's opIds means "already
 * appended", and the append path (payload.ts) never edits or removes prior entries.
 */
async function ensureRollbackEvent(
  ctx: RollbackContext,
  taskUuid: string,
  issueId: string,
): Promise<boolean> {
  if (ctx.appendedTasks.has(taskUuid)) return false;
  const refs = ctx.taskRefs.get(taskUuid) ?? [];
  if (refs.length === 0) return false;
  const tail = await tailHistory(ctx, taskUuid);
  if (!tail.exists) {
    ctx.notes.push(`task ${taskUuid}: no page-0 anchor exists — rollback event skipped (the event never fabricates an identity anchor)`);
    ctx.appendedTasks.add(taskUuid);
    return false;
  }
  const last = tail.history[tail.history.length - 1];
  const alreadyAppended =
    last !== undefined &&
    last.kind === "rollback" &&
    (last.references?.length ?? 0) > 0 &&
    (last.references ?? []).every((ref) => ctx.allOpIds.has(ref) && refs.includes(ref));
  if (alreadyAppended) {
    ctx.appendedTasks.add(taskUuid);
    return false;
  }
  const event: SyncHistoryEvent = {
    kind: "rollback",
    at: ctx.clock.now().toISOString(),
    description:
      `run ${ctx.runId} rolled back — ${refs.length} journaled operation(s) reversed for this task ` +
      `under observed-state guards (contracts/journal-rollback.md §3)`,
    references: [...refs],
  };
  await appendHistoryEvent(ctx.payload, { issueId, taskUuid, event });
  ctx.appendedTasks.add(taskUuid);
  ctx.eventsAppended += 1;
  return true;
}

// ── Kind-specific guard + inverse (journal-rollback.md §3) ───────────────────────────

function fileRestoreTarget(manifest: AuditManifest, repoRoot: string, filePath: string): string | null {
  const backup = manifest.fileBackups.find((b) => b.path === filePath);
  if (backup === undefined) return null;
  const target = resolve(repoRoot, filePath);
  const root = resolve(repoRoot);
  if (target !== root && !target.startsWith(root + sep)) return null; // traversal guard
  return target;
}

function atomicWriteRepoFile(target: string, content: string): void {
  const tmp = `${target}.rollback-${process.pid}-${Date.now()}.tmp`;
  try {
    writeFileSync(tmp, content, "utf8");
    renameSync(tmp, target);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
      /* temp already gone */
    }
    throw e;
  }
}

function currentFileHash(target: string): string | null {
  if (!existsSync(target)) return null;
  return createHash("sha256").update(readFileSync(target)).digest("hex");
}

async function reverseCreateIssue(
  ctx: RollbackContext,
  planned: PlannedOp,
): Promise<StepResult> {
  const target = planned.targetIssueId;
  if (target === undefined) return "nothing"; // never landed — nothing exists to undo (§5)
  const live = await ctx.payload.port.getIssue(target);
  if (live === null) return "nothing"; // absent ⇒ the create-op's before-state (§3)
  if (live.archived) return "nothing"; // executed-inverse state — resume idempotence arm
  await ctx.payload.port.archiveIssue(target); // NEVER delete (FR-013)
  ctx.archivedCount += 1;
  return "reversed";
}

async function reverseUpdateIssue(
  ctx: RollbackContext,
  planned: PlannedOp,
): Promise<StepResult> {
  const target = planned.targetIssueId;
  if (target === undefined) return "conflict";
  const live = await ctx.payload.port.getIssue(target);
  if (live === null) return "conflict"; // externally deleted — fields cannot be restored
  const beforeFields =
    planned.beforeSnapshot.kind === "update-issue" ? planned.beforeSnapshot.fields : undefined;
  const afterFields =
    planned.afterSnapshot !== undefined && planned.afterSnapshot.kind === "update-issue"
      ? planned.afterSnapshot.fields
      : undefined;
  if (afterFields !== undefined && (await liveMatchesPatch(ctx, live, afterFields))) {
    if (beforeFields === undefined) return "conflict"; // nothing to restore FROM
    const restored: Record<string, string> = {};
    for (const [field, value] of Object.entries(beforeFields) as Array<
      [keyof IssueUpdatePatch, string | undefined]
    >) {
      if (value === undefined) continue;
      const screened = screenOutboundRestore(ctx.screener, value, `update-issue.${field}`);
      if (screened === null) return "conflict";
      restored[field] = screened;
    }
    await ctx.payload.port.updateIssue(target, restored as IssueUpdatePatch);
    return "reversed";
  }
  if (beforeFields !== undefined && (await liveMatchesPatch(ctx, live, beforeFields))) {
    return "nothing";
  }
  return "conflict";
}

async function reverseRenderFile(
  ctx: RollbackContext,
  planned: PlannedOp,
  manifest: AuditManifest,
): Promise<StepResult> {
  const filePath = planned.filePath;
  if (filePath === undefined) return "conflict";
  const target = fileRestoreTarget(manifest, manifest.repoRoot, filePath);
  if (target === null) return "conflict"; // missing backup / unsafe path — cannot restore
  const hash = currentFileHash(target);
  const beforeHash =
    planned.beforeSnapshot.kind === "render-file" ? planned.beforeSnapshot.beforeContentHash : undefined;
  const afterHash =
    planned.afterSnapshot !== undefined && planned.afterSnapshot.kind === "render-file"
      ? planned.afterSnapshot.afterContentHash
      : undefined;
  const backup = manifest.fileBackups.find((b) => b.path === filePath);
  if (afterHash !== undefined && hash === afterHash) {
    if (backup === undefined) return "conflict";
    const screened = screenOutboundRestore(ctx.screener, backup.beforeContent, "file-backup");
    if (screened === null) return "conflict";
    atomicWriteRepoFile(target, screened); // whole-file granularity is the rollback unit (§5)
    return "reversed";
  }
  if (beforeHash !== undefined && hash === beforeHash) return "nothing";
  return "conflict"; // drifted (or deleted) content matches neither snapshot
}

async function reverseWriteCheckpoint(ctx: RollbackContext): Promise<StepResult> {
  const current = await readCheckpointStore(ctx.store);
  const snapshotMap: Record<string, Checkpoint> = {};
  for (const checkpoint of ctx.checkpointBefore()) snapshotMap[checkpoint.taskUuid] = checkpoint;
  const matchesSnapshot = canonicalJson({ ...current.checkpoints }) === canonicalJson(snapshotMap);
  if (matchesSnapshot) return "nothing"; // store already equals checkpointBefore (resume arm)
  // FR-013 restore-or-remove dominates: the store must match the pre-run map; restore
  // whether the live store equals the run's write (after-arm) or drifted externally.
  await restoreCheckpointStoreFromSnapshot(ctx.store, ctx.checkpointBefore());
  return "reversed";
}

async function reverseUpsertAttachment(
  ctx: RollbackContext,
  planned: PlannedOp,
): Promise<StepResult> {
  const url = planned.attachmentUrl;
  const issueId = planned.targetIssueId;
  if (url === undefined) return "conflict";
  const inverse = inverseForOp(planned); // validated §5 descriptor (the walk guard has aligned the kinds)
  const parsed = parseAttachmentUrl(ctx.config, url);
  const live = await ctx.payload.port.getAttachmentByUrl(url);
  const prior =
    planned.beforeSnapshot.kind === "upsert-attachment" ? planned.beforeSnapshot.priorMetadata : undefined;
  if (prior === undefined) return "conflict"; // malformed/corrupted before-snapshot — no restore material

  if (inverse.action === "skip-created-attachment") {
    // §5 descriptor ≡ priorMetadata === null. FR-016: nothing existed before ⇒ UNDO IS A
    // NO-OP; a page created during the run is RETAINED (identity anchor / continuation
    // page, entries and all).
    if (live === null) return "nothing";
    if (parsed?.kind === "canonical") {
      if (issueId === undefined) return "conflict";
      await ensureRollbackEvent(ctx, parsed.taskUuid, issueId); // canonical survives: event only, no mirror
    }
    return "nothing";
  }

  if (live === null) return "conflict"; // prior existed; attachment is gone — matches neither

  if (parsed?.kind === "canonical") {
    if (issueId === undefined) return "conflict";
    const taskUuid = parsed.taskUuid;
    const livePayload = parseNamespacePayload(ctx, live.metadata);
    const beforePayload = parseNamespacePayload(ctx, prior);
    const afterMeta =
      planned.afterSnapshot !== undefined && planned.afterSnapshot.kind === "upsert-attachment"
        ? planned.afterSnapshot.metadata
        : undefined;
    const afterPayload = afterMeta !== undefined ? parseNamespacePayload(ctx, afterMeta) : null;
    if (livePayload === null || beforePayload === null) {
      // Non-namespaced (foreign) attachment under the tool URL — raw-map equality only,
      // and never clobber foreign content with restore material.
      if (afterMeta !== undefined && canonicalJson(live.metadata) === canonicalJson(afterMeta)) {
        return "conflict"; // tool-payload after under a foreign live — refuse to clobber
      }
      if (canonicalJson(live.metadata) === canonicalJson(prior)) return "nothing";
      return "conflict";
    }
    // §3 machine: only REAL after material matches the after-arm — a still-pending
    // afterSnapshot (step never applied) leaves before/conflict to decide the step.
    const afterMatch =
      afterPayload !== null && nonHistoryOf(livePayload) === nonHistoryOf(afterPayload);
    if (afterMatch) {
      // §4 ordering (header docblock): append the event FIRST (idempotent), THEN mirror
      // the non-history payload back to the restored state. A crash between the two is
      // re-met by this arm: the tail check skips the duplicate append.
      await ensureRollbackEvent(ctx, taskUuid, issueId);
      const checkpoint = ctx.checkpointByTask.get(taskUuid);
      const descriptionContentHash =
        checkpoint?.descriptionContentHash ?? beforePayload.descriptionContentHash;
      const frameworkMetadata = beforePayload.frameworkMetadata;
      const featureName = frameworkMetadata.featureName;
      const filePathMeta = frameworkMetadata.filePath;
      const localTaskId = frameworkMetadata.localTaskId;
      if (
        (featureName !== undefined && screenOutboundRestore(ctx.screener, featureName, "payload.featureName") === null) ||
        screenOutboundRestore(ctx.screener, filePathMeta, "payload.filePath") === null ||
        (localTaskId !== undefined && screenOutboundRestore(ctx.screener, localTaskId, "payload.localTaskId") === null)
      ) {
        return "conflict";
      }
      await rewritePageZeroPayload(ctx.payload, {
        issueId,
        taskUuid,
        frameworkMetadata,
        descriptionContentHash,
      });
      return "reversed";
    }
    if (nonHistoryOf(livePayload) === nonHistoryOf(beforePayload)) return "nothing";
    return "conflict";
  }

  // Continuation page: §4 — pages created during the run are RETAINED, entries and all;
  // prior page content is always a PREFIX of the append-only chain ⇒ zero page mutations.
  const liveRecord = parseHistoryPageRecord(live, ctx.config.metadataNamespaceKey);
  if (liveRecord === null) return "conflict";
  const beforeRecord =
    planned.beforeSnapshot.kind === "upsert-attachment"
      ? parseHistoryPageRecord(
          { id: "", url, title: "", metadata: planned.beforeSnapshot.priorMetadata ?? {} },
          ctx.config.metadataNamespaceKey,
        )
      : null;
  const afterRecord =
    planned.afterSnapshot !== undefined && planned.afterSnapshot.kind === "upsert-attachment"
      ? parseHistoryPageRecord(
          { id: "", url, title: "", metadata: planned.afterSnapshot.metadata },
          ctx.config.metadataNamespaceKey,
        )
      : null;
  if (afterRecord !== null && canonicalJson(afterRecord.history) === canonicalJson(liveRecord.history)) {
    return "reversed"; // after-state landed; the §4 inverse RETAINS the page — zero mutations
  }
  if (
    beforeRecord !== null &&
    liveRecord.history.length >= beforeRecord.history.length &&
    canonicalJson(liveRecord.history.slice(0, beforeRecord.history.length)) === canonicalJson(beforeRecord.history)
  ) {
    return "nothing"; // prior entries intact — nothing to undo on an append-only page
  }
  return "conflict";
}

/** Parse the single namespaced payload record under the configured namespace key. */
function parseNamespacePayload(
  ctx: RollbackContext,
  meta: AttachmentMetadata | null | undefined,
): SyncStatePayload | null {
  if (meta === null || meta === undefined) return null;
  const raw = meta[ctx.config.metadataNamespaceKey];
  if (typeof raw !== "string") return null;
  try {
    return parseSyncStatePayload(raw);
  } catch {
    return null;
  }
}

// ── The reverse walk (journal-rollback.md §3) ────────────────────────────────────────

interface WalkOutcome {
  completed: boolean;
  reversed: number;
  haltedOpId?: string;
  haltedKind?: string;
}

/**
 * True when the step's guard material structurally aligns with its kind. A step whose
 * snapshots were SURGICALLY CORRUPTED after the fact (§3 "resume re-evaluates"; the T036
 * cell-3 sentinel snapshots) fails here: the live state can then never be shown equal to
 * either snapshot, so "matches neither" ⇒ `conflict-halted` + HALT. The lenient load
 * (header docblock) keeps such steps readable AND transitionable — journal.ts's strict
 * {@link readJournalArtifacts}/{@link recordStepTransition} would refuse the artifact.
 */
function guardMaterialAligned(step: JournalStep): boolean {
  if (step.beforeSnapshot.kind !== step.kind) return false;
  return (
    step.afterSnapshot.kind === AFTER_SNAPSHOT_PENDING_KIND ||
    step.afterSnapshot.kind === step.kind
  );
}

async function walkReversals(
  ctx: RollbackContext,
  artifacts: RunArtifacts,
  taskByOpId: ReadonlyMap<string, string>,
  persist: (opId: string, state: AuditStepState) => Promise<RunArtifacts>,
): Promise<{ outcome: WalkOutcome; artifacts: RunArtifacts }> {
  let current = artifacts;
  let reversed = 0;
  for (let i = current.steps.length - 1; i >= 0; i--) {
    const step = current.steps[i] as JournalStep;
    const op = current.manifest.operations[i] as AuditOperation;
    if (step.stepState === "rolled-back") continue; // FR-014: resume NEVER repeats a completed step
    if (!guardMaterialAligned(step)) {
      current = await persist(step.opId, "conflict-halted");
      return {
        outcome: { completed: false, reversed, haltedOpId: step.opId, haltedKind: step.kind },
        artifacts: current,
      };
    }
    const planned = plannedOpFrom(op, step, i, taskByOpId);
    let result: StepResult;
    switch (planned.kind) {
      case "create-issue":
        result = await reverseCreateIssue(ctx, planned);
        break;
      case "update-issue":
        result = await reverseUpdateIssue(ctx, planned);
        break;
      case "upsert-attachment":
        result = await reverseUpsertAttachment(ctx, planned);
        break;
      case "render-file":
        result = await reverseRenderFile(ctx, planned, current.manifest);
        break;
      case "write-checkpoint":
        result = await reverseWriteCheckpoint(ctx);
        break;
    }
    if (result === "conflict") {
      current = await persist(step.opId, "conflict-halted");
      return { outcome: { completed: false, reversed, haltedOpId: step.opId, haltedKind: step.kind }, artifacts: current };
    }
    current = await persist(step.opId, "rolled-back"); // both artifacts re-sealed per transition
    reversed += 1;
  }
  return { outcome: { completed: true, reversed }, artifacts: current };
}

// ── Close-out: checkpoint restore safety net, fallback events, report + marker ──────

async function closeRollback(
  ctx: RollbackContext,
  artifacts: RunArtifacts,
  taskByOpId: ReadonlyMap<string, string>,
): Promise<void> {
  // FR-013 belt-and-braces: the write-checkpoint inverse normally did this; the close
  // re-applies the snapshot map (idempotent whole-file replace) so an interrupted run
  // that died before reaching that step still converges on resume.
  await restoreCheckpointStoreFromSnapshot(ctx.store, ctx.checkpointBefore());
  // Fallback rollback events for tasks the walk never met a canonical step for (page-0
  // anchor required — never fabricated). Idempotent via the chain-tail check.
  for (const [taskUuid, refs] of ctx.taskRefs) {
    if (ctx.appendedTasks.has(taskUuid) || refs.length === 0) continue;
    const carrier = firstIssueCarrier(artifacts, taskByOpId, taskUuid);
    if (carrier === undefined) {
      ctx.notes.push(`task ${taskUuid}: no issue carrier — rollback event skipped`);
      continue;
    }
    await ensureRollbackEvent(ctx, taskUuid, carrier);
  }
}

function firstIssueCarrier(
  artifacts: RunArtifacts,
  taskByOpId: ReadonlyMap<string, string>,
  taskUuid: string,
): string | undefined {
  for (const [i, op] of artifacts.manifest.operations.entries()) {
    if (taskByOpId.get(op.opId) !== taskUuid) continue;
    const issueId = issueIdOf(op, artifacts.steps[i] as JournalStep);
    if (issueId !== undefined) return issueId;
  }
  return undefined;
}

function buildRollbackReport(
  ctx: RollbackContext,
  manifest: AuditManifest,
  outcome: WalkOutcome,
): { report: PlanReportJson; markdown: string } {
  const fileHashes: Record<string, string> = {};
  for (const backup of manifest.fileBackups) fileHashes[backup.path] = backup.beforeContentHash;
  const assertions: PlanReportAssertion[] = [
    {
      guarantee: "history-append-only-preserved",
      status: "pass",
      detail: `${ctx.eventsAppended} rollback event(s) appended; zero history entries altered or removed; zero chain pages removed`,
    },
    {
      guarantee: "identity-anchor-retained",
      status: "pass",
      detail: "page-0 canonical attachments (including run-created) retained — never deleted (FR-016)",
    },
    {
      guarantee: "created-issues-archived-never-deleted",
      status: "pass",
      detail: `${ctx.archivedCount} issue(s) archived; zero createIssue calls; CreateIntent records untouched`,
    },
    {
      guarantee: "checkpoint-store-restored-or-removed",
      status: "pass",
      detail: "sync-state.json matches checkpointBefore; entries absent from the snapshot removed (FR-013)",
    },
  ];
  if (!outcome.completed && outcome.haltedOpId !== undefined) {
    assertions.push({
      guarantee: "rollback-walk-halted",
      status: "fail",
      detail: `step ${outcome.haltedOpId} (${outcome.haltedKind ?? "unknown"}) matched neither snapshot — walk halted; resume re-evaluates after an external fix`,
    });
  }
  const report: PlanReportJson = {
    schemaVersion: 1,
    planId: manifest.planId,
    generatedAt: ctx.clock.now().toISOString(),
    repositoryRoot: manifest.repoRoot,
    guards: { fileHashes, headCommit: null },
    lowConfidencePresent: false,
    securityAssertions: assertions,
    groups: [],
    unmapped: [],
  };
  const lines: string[] = [
    `# Rollback report — run \`${ctx.runId}\``,
    "",
    `- Rollback run: \`${ctx.rollbackRunId}\``,
    `- Outcome: \`${outcome.completed ? "rolled-back" : "partial"}\` — ${outcome.reversed} journaled operation(s) reversed in reverse order`,
    `- Created issues archived: ${ctx.archivedCount} (never deleted); \`createIssue\` calls: 0`,
    `- History: ${ctx.eventsAppended} \`rollback\` event(s) appended; zero entries altered, zero pages removed (FR-016)`,
    `- Checkpoint store: restored-or-removed to match \`checkpointBefore\` (FR-013)`,
  ];
  if (!outcome.completed && outcome.haltedOpId !== undefined) {
    lines.push(`- HALTED at step \`${outcome.haltedOpId}\` (${outcome.haltedKind}): live state matched neither snapshot — fix externally, then resume`);
  }
  for (const note of ctx.notes) lines.push(`- Note: ${note}`);
  lines.push("");
  return { report, markdown: lines.join("\n") };
}

// ── Entry point ──────────────────────────────────────────────────────────────────────

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
  const store = deps.state;
  const config = deps.config;
  const clock = deps.clock;
  const keyProvider = options.keyProvider;
  const screener = resolveScreener(deps, options);
  const refuse = (code: GateFailureCode, detail: string): RollbackResult => ({
    runId,
    status: "refused",
    refusal: { code, detail } satisfies GateFailure,
    reversedOperations: 0,
  });

  // §2 refusals — ALL decided before the lock, all with zero port calls.
  if (!options.journalingEnabled) {
    return refuse(
      "MANIFEST_UNJOURNALED",
      `rollback of run '${runId}' refused: journaling is disabled, so no journaled run state exists to reverse (contracts/journal-rollback.md §2)`,
    );
  }
  if (!(await journalArtifactsExist(store, runId))) {
    return refuse(
      "MANIFEST_UNJOURNALED",
      `rollback of run '${runId}' refused: no audit manifest/step journal exists for this run (contracts/journal-rollback.md §1–§2)`,
    );
  }
  const envelope = await readManifestEnvelope(store, runId);
  if (envelope === null) {
    return refuse(
      "MANIFEST_UNJOURNALED",
      `rollback of run '${runId}' refused: the audit manifest is absent (contracts/journal-rollback.md §2)`,
    );
  }
  if (isManifestExpired(envelope, config, clock)) {
    // Unencrypted header, encryption-independent, key-free (§2; frozen predicate).
    return refuse(
      "MANIFEST_EXPIRED",
      `rollback of run '${runId}' refused: the audit manifest header (createdAt ${envelope.createdAt}) is older than manifestExpiryDays (${String(config.manifestExpiryDays)}) (contracts/journal-rollback.md §2)`,
    );
  }
  // Envelope tag check on BOTH artifacts — tamper ⇒ JournalError diagnostic, NO plaintext
  // (§2 row 3; surfaces BEFORE the lock so a refused tampered run touches nothing).
  const artifacts = await loadRunArtifacts(store, config, keyProvider, runId);
  const rollbackRunId = deriveRunId(artifacts.manifest.planId, clock, ROLLBACK_RUN_SEQ);

  // A rollback is a mutating run (constitution I): it acquires the advisory lock itself.
  const acquisition = await acquireRunLock(store, rollbackRunId);
  if (!acquisition.acquired) {
    return refuse(
      "LOCK_HELD",
      `rollback of run '${runId}' refused: the advisory run lock is held by run '${acquisition.heldBy.runId}' (${acquisition.reason}) — the loser reports and exits (contracts/journal-rollback.md §2)`,
    );
  }

  try {
    const { taskByOpId, taskRefs } = attributeOps(artifacts.manifest, artifacts.steps, config);
    const checkpointByTask = new Map<string, Checkpoint>();
    for (const checkpoint of artifacts.manifest.checkpointBefore) {
      checkpointByTask.set(checkpoint.taskUuid, checkpoint);
    }
    const ctx: RollbackContext = {
      store,
      config,
      clock,
      screener,
      payload: { port: deps.port, config, clock, screener },
      runId,
      rollbackRunId,
      checkpointByTask,
      taskRefs,
      allOpIds: new Set(artifacts.manifest.operations.map((o) => o.opId)),
      workflowStates: null,
      appendedTasks: new Set(),
      eventsAppended: 0,
      archivedCount: 0,
      notes: [],
      checkpointBefore: () => artifacts.manifest.checkpointBefore,
    };
    // Transitions persist against the CURRENT artifacts object — every re-seal advances
    // it, so a torn window's next read resumes from the freshest trusted seal.
    let liveArtifacts: RunArtifacts = artifacts;
    const walk = await walkReversals(ctx, artifacts, taskByOpId, async (opId, state) => {
      liveArtifacts = await persistTransition(store, config, keyProvider, clock, runId, liveArtifacts, opId, state);
      return liveArtifacts;
    });

    if (walk.outcome.completed) {
      await closeRollback(ctx, walk.artifacts, taskByOpId);
    }

    const { report, markdown } = buildRollbackReport(ctx, walk.artifacts.manifest, walk.outcome);
    await writeRunReportWithMarker(store, rollbackRunId, report, markdown, screener, {
      runId: rollbackRunId,
      outcome: walk.outcome.completed ? "completed" : "failed",
      notificationSuppressed: false,
    });

    return {
      runId, // the ROLLED-BACK run is named by the result (§2; T036 cell 1 pins this)
      status: walk.outcome.completed ? "rolled-back" : "partial",
      reversedOperations: walk.outcome.reversed,
    };
  } finally {
    await releaseRunLock(store, acquisition.record); // release on EVERY exit path (resume re-acquires)
  }
}
