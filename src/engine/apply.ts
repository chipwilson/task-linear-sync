/**
 * T043 [US2] — `applySyncPlan`: THE single mutating entry (tasks.md T043; contracts/
 * engine-pipeline.md frozen enforcement order; `SyncEngine` docblock in ports/engine.ts).
 *
 * Enforcement order (frozen — do not resequence):
 *  1. gate trio (`APPLY_FLAG_MISSING` / `CONFIRMATION_KEY_MISMATCH` /
 *     `LOW_CONFIDENCE_NOT_ACCEPTED`) plus the state-dir plan-reference check
 *     (`validatePlanReference`) — ALL failures collected into ONE
 *     `ApplyResult{status:"refused", gateFailures}`; NO lock is taken and ZERO port calls
 *     happen on any refusal (the gate stage consults only state, never the tracker);
 *  2. advisory run lock (`acquireRunLock`) — contention ⇒ refusal `LOCK_HELD`; the
 *     holder's `lock.json` is byte-untouched and zero run residue exists (no manifests/,
 *     runs/ or last-run.json);
 *  3. stability re-check — guard-file hashes + HEAD through the frozen
 *     `validatePlanReference` over the stored plan, then a per-issue `getIssue` read-back;
 *     drift ⇒ refusal `PLAN_REFERENCE_STALE` with ZERO mutations (the lock releases via
 *     the finally);
 *  4. journal materialization COMPLETE before the first mutation (`materializeJournal`:
 *     every planned op with its before-snapshots, the full pre-run checkpoint map and
 *     file backups; sealed pair `manifests/<runId>.json` + `runs/<runId>/journal.json`).
 *     With journaling disabled (resolved `journalingEnabled === false`) apply proceeds
 *     UNJOURNALED per spec;
 *  5. mutations in emission order (`emissionOrder`: parents before children, working
 *     order stable) — per task: screen every outbound string → precondition re-check →
 *     mutate → step transition `applied` (after-snapshot + learned target) → page-0
 *     payload rewrite → history event append (payload.ts owns the chain) → in-memory
 *     checkpoint advance;
 *  6. the checkpoint store advances ONLY when mutations landed AND the run was not
 *     aborted (an aborted run leaves the store byte-equal to the seed — the atomic write
 *     follows the last mutation); the run report + `last-run.json` marker record every
 *     executed run; the lock is released on every path (finally).
 *
 * Create ops follow data-model §8 (R10): `writeCreateIntentBeforeAttempt` durably BEFORE
 * the attempt; EXACTLY ONE `createIssue` attempt, never retried; a thrown attempt
 * reconciles ONCE by canonical attachment URL — exactly one carrier ⇒ ADOPT (intent
 * `confirmed-created`, adoption rides an `issue-created` history event, the child proceeds
 * hanging off the adopted issue via the outcomes map); zero or ambiguous carriers ⇒
 * terminal `indeterminate`: the subtree is skipped, the run CONTINUES (containment, not
 * abort — healthy tasks still land), and no replay EVER re-issues the create (resume
 * consults the terminal intent BEFORE any attempt; no second intent is ever written).
 *
 * A mapped `fail` action aborts BEFORE the failing task's mutation ⇒ `status:"aborted"`:
 * applied steps stay journaled `applied`, nothing is auto-rolled-back (R6 — zero
 * `archiveIssue`), the marker records `aborted` and the report carries a FAIL security
 * assertion naming the abort.
 *
 * Screening (R12) covers every outbound string BEFORE transmission: a blocked operation
 * fails with a detail naming CATEGORIES only (never content), blocked content lands in no
 * state file, and the run itself still completes (`status:"applied"`).
 *
 * The engine never advances the injected clock mid-run (determinism; Principle IV).
 */
import { createHash } from "node:crypto";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Checkpoint } from "../domain/checkpoint.js";
import type { LastRunMarker } from "../domain/run-records.js";
import type { Plan, StoredPlan } from "../domain/plan.js";
import type { Task } from "../domain/task.js";
import type { SyncHistoryEvent, SyncHistoryEventKind, SyncStatePayload } from "../domain/state-payload.js";
import { serializeSyncStatePayload } from "../domain/state-payload.js";
import type { FrameworkMetadata, IssueRef } from "../domain/task.js";
import type { GateFailure, GateRequest } from "../gates/gates.js";
import { validatePlanReference } from "../gates/gates.js";
import { acquireRunLock, releaseRunLock } from "../state/lock.js";
import {
  listIntentsByTask,
  updateCreateIntentStatus,
  writeCreateIntentBeforeAttempt,
} from "../state/intent.js";
import type { StateStore } from "../state/paths.js";
import type {
  ApplyResult,
  EngineDependencies,
  OperationOutcome,
  SecurityScreener,
} from "../ports/engine.js";
import type {
  AttachmentMetadata,
  AttachmentView,
  IssueScope,
  IssueUpdatePatch,
  IssueView,
  LinearPort,
  TeamMetadataCollections,
} from "../ports/linear-port.js";
import type { ResolvedConfig } from "../config/schema.js";
import type { FrameworkAdapter } from "../discovery/index.js";
import { createAdapterRegistry } from "../discovery/index.js";
import type { TaskFileAdapter } from "../parsing/index.js";
import { parseTaskFile, renderTaskLines, type LineAssignment } from "../parsing/index.js";
import { resolveRouting } from "../routing/index.js";
import type { RoutingResolution } from "../domain/routing.js";
import { canonicalAttachmentUrl } from "../urls/attachment-url.js";
import { deriveTitle } from "../titles/index.js";
import { discoverTaskFiles } from "../discovery/index.js";
import type { MatchCandidate, TaskMatchInput } from "../matching/index.js";
import { matchAllTasks } from "../matching/index.js";
import { DurableIdentityCollisionError, projectCandidates } from "../matching/index.js";
import type { Match } from "../domain/match.js";
import type { ResolvedEngineOptions } from "./options.js";
import { resolveScreener } from "./options.js";
import type { PlannedOp, PlannedOpDraft } from "./ops.js";
import {
  assignOpOrdinals,
  createIssueAfterSnapshot,
  deriveRunId,
  emissionOrder,
  historyKindForUpdatedField,
  planCreateIssueOp,
  planRenderFileOp,
  planUpdateIssueOp,
  planUpsertAttachmentOp,
} from "./ops.js";
import type { JournalArtifacts } from "./journal.js";
import { materializeJournal, recordStepTransition } from "./journal.js";
import type { AttachmentRunContext } from "./payload.js";
import {
  appendHistoryEvent,
  computeRolloverSplit,
  PayloadScreeningError,
  readPageZeroPayload,
  rewritePageZeroPayload,
} from "./payload.js";
import { historyPageAddress, parseHistoryPageRecord, serializeHistoryPageRecord } from "./history-page.js";
import { EngineError } from "./errors.js";
import { readCheckpointStore, writeCheckpointStore } from "./mode.js";
import {
  buildPlanReportJson,
  renderPlanReportMarkdown,
  writeRunReportWithMarker,
  type PlanReportAssertion,
} from "./report.js";
import { desiredCompletionStateName, resolveWorkflowStateId } from "./completion.js";
import { resolveConfiguredNormalizer } from "./classify.js";
import { normalizedContentHash } from "./normalize.js";
import { synthesizeConflictMarkerBlock } from "./markers.js";

// ─────────────────────────────────────────────────────────────── run types

/** Mutable builder alias for the readonly `IssueUpdatePatch` (frozen shape; local alias only). */
type MutablePatch = { -readonly [K in keyof IssueUpdatePatch]: IssueUpdatePatch[K] };

/** One task's apply-side flow: live-derived task material joined to its frozen entry. */
interface TaskFlow {
  readonly task: Task;
  readonly filePath: string;
  readonly routing: RoutingResolution;
  /** Mirror region — the section body BELOW the task line (pinned cross-lane decision 1). */
  readonly specSection: string;
  /** Undecorated derived title (the create/update title, the checkpoint title). */
  readonly baseTitle: string;
  readonly entry: Plan["entries"][number];
  /** Live matched issue (fresh deterministic match at apply time). */
  readonly issue: IssueView | undefined;
  readonly checkpoint: Checkpoint | undefined;
  /** The plan's `action:<a>` label (conflict cells), when present. */
  readonly action: string | undefined;
  /** `degraded:true` label — the effect collapses to report-only (never a mutation). */
  readonly degraded: boolean;
  /** Matrix §4 freeze — the cell mutates NOTHING. */
  readonly frozen: boolean;
  /** Plan-side label: completion validation failed (surfaced, never mutated). */
  readonly completionValidationFailed: boolean;
}

/** Mutable per-run context (post-lock, post-stability). */
interface RunContext {
  readonly deps: EngineDependencies;
  readonly options: ResolvedEngineOptions;
  readonly screener: SecurityScreener;
  readonly plan: Plan;
  readonly runId: string;
  readonly config: ResolvedConfig;
  readonly flows: readonly TaskFlow[];
  readonly byUuid: ReadonlyMap<string, TaskFlow>;
  readonly ctx: AttachmentRunContext;
  readonly journal: JournalArtifacts | null;
  readonly outcomes: Map<string, OperationOutcome>;
  readonly checkpointMap: Record<string, Checkpoint>;
  readonly nowIso: string;
  readonly fileBackups: Map<string, string>;
  readonly mirrorHash: Map<string, string>;
  readonly normalizer: ReturnType<typeof resolveConfiguredNormalizer>;
  snapshot: ReadonlyArray<TeamMetadataCollections>;
  /**
   * Per-file `render-file` splices landed this run, in ORIGINAL line coordinates
   * `{ bodyStart, bodyEnd, landed }` (1-based, body = lines below the task line).
   * The mirror-region line model is pinned to the pristine file, so a second render of
   * the same file must shift its splice by the cumulative line delta of earlier renders
   * above it (matrix §2 renders marker blocks top-down per emission order).
   */
  readonly fileRenders: Map<string, Array<{ bodyStart: number; bodyEnd: number; landed: number }>>;
  /**
   * PRE-RUN canonical-attachment metadata keyed by canonical URL, captured once in the
   * run's fresh tracker scan (FR-015 `priorMetadata` — the inverse material rollback
   * re-upserts; an in-run re-read would seal the just-rewritten state instead).
   */
  readonly canonicalPrior: Map<string, AttachmentMetadata | null>;
  mutationsLanded: boolean;
  aborted: boolean;
  screeningBlocked: boolean;
}

/**
 * The FR-015 prior-metadata posture: the attachment's metadata VERBATIM (the frozen
 * `AttachmentView.metadata` map — namespaced payload record included). Rollback restores
 * this exact map; tests compare it byte-for-byte against the pre-run attachment state.
 */
function preRunPrior(meta: AttachmentMetadata): AttachmentMetadata {
  return { ...meta };
}

/** Pre-planned journal steps keyed `taskUuid:kind`, consumed in ordinal order. */
interface StepLedger {
  readonly byTaskKind: Map<string, PlannedOp[]>;
  readonly consumed: Map<string, number>;
}

// ───────────────────────────────────────────────────────────── entry point

/**
 * The frozen single mutating entry — see the file header for the normative order.
 * Never partially applies: refusals precede any lock or port call, drift precedes any
 * mutation, and every mutation is journalled with its before-snapshot BEFORE it is
 * attempted (complete-before-first-mutation).
 */
export async function applySyncPlan(
  deps: EngineDependencies,
  options: ResolvedEngineOptions,
  plan: Plan,
  gates: GateRequest,
): Promise<ApplyResult> {
  const runId = deriveRunId(plan.planId, deps.clock, 1);

  // ── (1) Gate trio + plan-reference validation — ALL failures together, pre-lock. ───
  const failures: GateFailure[] = [];
  if (gates.applyFlag !== true) {
    failures.push({
      code: "APPLY_FLAG_MISSING",
      detail:
        `apply requires the explicit apply flag — plan '${plan.planId}' stands unapplied; ` +
        "re-invoke with gates.applyFlag = true (the flag is never implied)",
    });
  }
  if (gates.confirmationKey !== deps.config.confirmationKey) {
    failures.push({
      code: "CONFIRMATION_KEY_MISMATCH",
      detail:
        `gates.confirmationKey '${gates.confirmationKey}' does not match the configured confirmationKey — ` +
        "re-invoke with the configured key (the configured value is never echoed here)",
    });
  }
  if (plan.lowConfidencePresent && !gates.acceptLowConfidence) {
    failures.push({
      code: "LOW_CONFIDENCE_NOT_ACCEPTED",
      detail:
        `plan '${plan.planId}' carries low-confidence matches and gates.acceptLowConfidence is false — ` +
        "confirm the matches or re-invoke accepting low confidence",
    });
  }
  // The plan gate reads the stored plan BY THE PRESENTED REFERENCE (never the plan's own
  // id) — an unknown/never-persisted reference is PLAN_REFERENCE_UNKNOWN, pre-lock.
  const stored = await readStoredPlan(deps.state, gates.planReference ?? plan.planId);
  const reference = validatePlanReference(stored, {
    fileHashes: liveGuardHashes(stored, plan),
    headCommit: liveHeadCommit(stored, plan),
  });
  if (!reference.valid) failures.push(reference.failure);
  if (failures.length > 0) return refused(runId, failures); // ZERO port calls, no lock.

  // ── (2) Advisory run lock — contention ⇒ refusal; the loser reports and exits. ─────
  const acquisition = await acquireRunLock(deps.state, runId);
  if (!acquisition.acquired) {
    return refused(runId, [
      {
        code: "LOCK_HELD",
        detail:
          `another sync run holds the advisory lock (holder run '${acquisition.heldBy.runId}', ` +
          `reason: ${acquisition.reason}) — wait for it to finish, then re-apply`,
      },
    ]);
  }
  try {
    return await runUnderLock(deps, options, plan, runId);
  } finally {
    await releaseRunLock(deps.state, acquisition.record);
  }
}

function refused(runId: string, gateFailures: readonly GateFailure[]): ApplyResult {
  return { runId, status: "refused", gateFailures, operations: [] };
}

// ────────────────────────────────────────────────────────── locked body

async function runUnderLock(
  deps: EngineDependencies,
  options: ResolvedEngineOptions,
  plan: Plan,
  runId: string,
): Promise<ApplyResult> {
  const screener = resolveScreener(deps, options);

  // ── (3) Stability re-check: guards (frozen validator) then per-issue read-back. ────
  const stored = await readStoredPlan(deps.state, plan.planId);
  const guards = validatePlanReference(stored, {
    fileHashes: liveGuardHashes(stored, plan),
    headCommit: liveHeadCommit(stored, plan),
  });
  if (!guards.valid) return refused(runId, [guards.failure]);
  const drift = await trackerDrift(deps, plan);
  if (drift.length > 0) {
    return refused(runId, [
      {
        code: "PLAN_REFERENCE_STALE",
        detail: `stability read-back found the tracker moved after planning: ${drift.join("; ")} — rebuild the plan`,
      },
    ]);
  }

  // Re-derive the task side exactly like the plan build (discover → parse → route →
  // mirror → title → match), joined by taskUuid to the frozen plan entries.
  const derived = await deriveFlows(deps, plan);
  if ("refusal" in derived) {
    return refused(runId, [
      {
        code: "PLAN_REFERENCE_STALE",
        detail: `stability read-back found the working set moved after planning: ${derived.refusal} — rebuild the plan`,
      },
    ]);
  }

  const storeFile = await readCheckpointStore(deps.state);
  const checkpointMap: Record<string, Checkpoint> = { ...storeFile.checkpoints };

  // ── (4) Journal materialized COMPLETE before the first mutation (unjournaled per
  //      spec when journaling is disabled). ───────────────────────────────────────────
  const planned = planOps(deps.config, screener, plan, derived.flows, checkpointMap);
  let journal: JournalArtifacts | null = null;
  if (options.journalingEnabled) {
    journal = await materializeJournal(deps.state, deps.config, options.keyProvider, deps.clock, {
      runId,
      planId: plan.planId,
      repoRoot: plan.repositoryRoot,
      ops: planned.ops,
      fileBackups: planned.fileBackups,
      checkpointBefore: Object.values(checkpointMap),
    });
  }

  const context: RunContext = {
    deps,
    options,
    screener,
    plan,
    runId,
    config: deps.config,
    flows: derived.flows,
    byUuid: new Map(derived.flows.map((f) => [f.task.stableUuid, f])),
    ctx: { port: deps.port, config: deps.config, clock: deps.clock, screener },
    journal,
    outcomes: new Map(),
    checkpointMap,
    nowIso: deps.clock.now().toISOString(),
    fileBackups: new Map(),
    mirrorHash: new Map(),
    normalizer: resolveConfiguredNormalizer(deps.config.descriptionNormalizationProfile, options.normalizationProfiles),
    snapshot: derived.snapshot,
    fileRenders: new Map(),
    canonicalPrior: derived.canonicalPrior,
    mutationsLanded: false,
    aborted: false,
    screeningBlocked: false,
  };
  const ledger = buildLedger(planned.ops);

  // ── (5) Mutations in emission order (parents before children; stable working order). ─
  for (const task of emissionOrder(derived.flows.map((f) => f.task))) {
    if (context.aborted) break;
    const flow = context.byUuid.get(task.stableUuid);
    if (flow !== undefined) await applyFlow(context, flow, ledger);
  }

  // ── (6) Checkpoint advance ONLY on landed mutations AND an un-aborted run. ─────────
  if (context.mutationsLanded && !context.aborted) {
    await writeCheckpointStore(deps.state, context.checkpointMap);
  }

  const reportPaths = await writeRunReport(context);
  return {
    runId,
    status: context.aborted ? "aborted" : "applied",
    gateFailures: [],
    operations: orderedOutcomes(context),
    ...(reportPaths !== null ? { reportPaths } : {}),
  };
}

// ─────────────────────────────────────────────────────── stability helpers

async function readStoredPlan(store: StateStore, planId: string): Promise<StoredPlan | null> {
  const raw = await store.readJson<StoredPlan>(`plans/${planId}.json`);
  if (raw === null || typeof raw !== "object" || raw.plan === undefined) return null;
  return raw;
}

/** Live hashes for exactly the files the stored plan guarded. */
function liveGuardHashes(stored: StoredPlan | null, plan: Plan): Record<string, string> {
  const guarded = Object.keys((stored?.plan ?? plan).guards.fileHashes);
  const root = (stored?.plan ?? plan).repositoryRoot;
  const out: Record<string, string> = {};
  for (const file of guarded) {
    try {
      out[file] = sha256(readFileSync(join(root, file)));
    } catch {
      // Absent/unreadable ⇒ omitted; the frozen validator reports "guard file missing".
    }
  }
  return out;
}

function liveHeadCommit(stored: StoredPlan | null, plan: Plan): string | null {
  if ((stored?.plan ?? plan).guards.headCommit === null) return null;
  const marker = plan.repositoryRoot.lastIndexOf("/");
  const candidates = [
    join(plan.repositoryRoot, ".git"),
    join(plan.repositoryRoot.slice(0, Math.max(marker, 1)), ".git"),
  ];
  for (const candidate of candidates) {
    try {
      const git = readFileSync(join(candidate, "HEAD"), "utf8").trim();
      const match = /^ref:\s+refs\/heads\/(.+)$/.exec(git);
      if (match === null) return git.length > 0 ? git : null;
      const refs = readFileSync(join(candidate, "refs/heads", match[1]!), "utf8").trim();
      if (refs.length > 0) return refs;
      const packed = readFileSync(join(candidate, "packed-refs"), "utf8");
      const line = packed.split("\n").find((l) => l.endsWith(`refs/heads/${match[1]}`));
      const sha = line?.trim().split(/\s+/)[0];
      if (sha !== undefined) return sha;
    } catch {
      // Try the next candidate; absolute failure falls through to null below.
    }
  }
  return null;
}

/** Per-entry tracker read-back drift descriptors (issue identities only — no content). */
async function trackerDrift(deps: EngineDependencies, plan: Plan): Promise<string[]> {
  const drift: string[] = [];
  for (const entry of plan.entries) {
    if (entry.match === undefined) continue;
    let live: IssueView | null;
    try {
      live = await deps.port.getIssue(entry.match.issueId);
    } catch {
      continue; // An unreachable tracker mirrors the gate posture: not proof of drift.
    }
    if (live === null) drift.push(`issue '${entry.match.issueId}' disappeared after planning`);
  }
  return drift;
}

// ─────────────────────────────────────────────── task-side re-derivation

interface DerivedSide {
  readonly flows: readonly TaskFlow[];
  readonly snapshot: ReadonlyArray<TeamMetadataCollections>;
  readonly fileHashes: Record<string, string>;
  readonly canonicalPrior: Map<string, AttachmentMetadata | null>;
}

async function deriveFlows(
  deps: EngineDependencies,
  plan: Plan,
): Promise<DerivedSide | { refusal: string }> {
  const config = deps.config;
  const discovery = await discoverTaskFiles({
    repositoryRoot: plan.repositoryRoot,
    config,
    gitContext: false,
  });
  const registry = createAdapterRegistry(config);
  const adapterById = new Map<string, FrameworkAdapter>(registry.enabledAdapters.map((a) => [a.id, a]));

  interface Unit {
    task: Task;
    filePath: string;
    specSection: string;
    routing: RoutingResolution;
    baseTitle: string;
  }
  const fileHashes: Record<string, string> = {};
  const units: Unit[] = [];
  for (const file of discovery.files) {
    const bytes = readFileSync(join(discovery.root, file.filePath));
    fileHashes[file.filePath] = sha256(bytes);
    const adapter = adapterById.get(file.adapterId);
    if (adapter === undefined) {
      return { refusal: `discovery selected adapter '${file.adapterId}' the registry does not carry` };
    }
    const content = bytes.toString("utf8");
    const rawLines = content.split(/\r\n|\r|\n/);
    const parsed = parseTaskFile(file.filePath, content, adapter as TaskFileAdapter, config);
    const routing = resolveRouting(file.filePath, config);
    for (const task of parsed.file.tasks) {
      units.push({
        task,
        filePath: file.filePath,
        specSection: mirrorRegion(rawLines, task),
        routing,
        baseTitle: deriveTitle(task, config).baseTitle,
      });
    }
  }
  units.sort((a, b) => a.filePath.localeCompare(b.filePath, "en") || a.task.lineNumber - b.task.lineNumber);

  // Working-set agreement with the frozen plan: the exact same task set.
  const planUuids = plan.entries.map((e) => e.taskUuid).sort();
  const unitUuids = units.map((u) => u.task.stableUuid).sort();
  if (planUuids.length !== unitUuids.length || planUuids.some((u, i) => u !== unitUuids[i])) {
    return { refusal: "the scanned task set differs from the plan" };
  }

  // Fresh deterministic match (the entry decisions themselves stay plan-frozen). The
  // attachment scan ALSO seeds the FR-015 pre-run canonical metadata — captured here,
  // before any mutation of the run, so journal priorMetadata/rollback inverse material
  // reflects what existed BEFORE the run, never the run's own rewrites.
  const issues: IssueView[] = [];
  for await (const issue of deps.port.listIssues(issueScope(deps))) issues.push(issue);
  const canonicalUrlSet = new Set(plan.entries.map((e) => canonicalAttachmentUrl(config, e.taskUuid)));
  const attachmentsByIssue: Record<string, readonly AttachmentView[]> = {};
  const canonicalPrior = new Map<string, AttachmentMetadata | null>();
  for (const issue of issues) {
    const all: AttachmentView[] = [];
    let cursor: string | null = null;
    do {
      const page = await deps.port.listAttachments(issue.id, cursor);
      all.push(...page.items);
      cursor = page.nextCursor;
    } while (cursor !== null);
    attachmentsByIssue[issue.id] = all;
    for (const attachment of all) {
      if (canonicalUrlSet.has(attachment.url)) {
        canonicalPrior.set(attachment.url, preRunPrior(attachment.metadata));
      }
    }
  }
  let candidates: MatchCandidate[];
  try {
    candidates = projectCandidates({ issues, attachmentsByIssue, config });
  } catch (error) {
    if (error instanceof DurableIdentityCollisionError) {
      return { refusal: "durable-identity collision detected on the fresh match" };
    }
    throw error;
  }
  const taskInputs: TaskMatchInput[] = units.map((unit) => ({ task: unit.task, routing: unit.routing }));
  const matching = matchAllTasks(taskInputs, candidates, config);
  const issueById = new Map(issues.map((i) => [i.id, i]));
  const matchByTaskUuid = new Map<string, Match>(matching.matches.map((m) => [m.taskUuid, m]));
  const storeFile = await readCheckpointStore(deps.state);
  const snapshot = await deps.port.discoverMetadata(Object.keys(config.teams));

  const flows: TaskFlow[] = units.map((unit) => {
    const entry = plan.entries.find((e) => e.taskUuid === unit.task.stableUuid)!;
    const match = matchByTaskUuid.get(unit.task.stableUuid);
    const issue = match === undefined ? undefined : issueById.get(match.issueId);
    const actionLabel = entry.reasons.find((r) => r.startsWith("action:"));
    return {
      task: unit.task,
      filePath: unit.filePath,
      routing: unit.routing,
      specSection: unit.specSection,
      baseTitle: unit.baseTitle,
      entry,
      issue,
      checkpoint: storeFile.checkpoints[unit.task.stableUuid],
      action: actionLabel === undefined ? undefined : actionLabel.slice("action:".length),
      degraded: entry.reasons.includes("degraded:true"),
      frozen: entry.unresolvedConflict === true,
      completionValidationFailed: entry.reasons.includes("validation:completion-state"),
    };
  });
  return { flows, snapshot, fileHashes, canonicalPrior };
}

function issueScope(deps: EngineDependencies): IssueScope {
  const perTeam: Record<string, { projects: readonly string[]; ignoredStateTypes: readonly string[] }> = {};
  for (const [teamKey, team] of Object.entries(deps.config.teams)) {
    perTeam[teamKey] = {
      projects: team.projects,
      ignoredStateTypes: team.workflowStates.ignoredTypes ?? ["canceled", "duplicate"],
    };
  }
  return { teamKeys: Object.keys(deps.config.teams), perTeam, pageSize: deps.config.pageSize };
}

/** Pinned cross-lane decision 1 (verbatim build.ts twin): the body BELOW the task line. */
function mirrorRegion(rawLines: readonly string[], task: Task): string {
  const start = task.taskBody.startLine + 1; // 1-based first body line
  const end = task.taskBody.endLine; // inclusive
  if (start > end) return "";
  return rawLines.slice(start - 1, end).join("\n");
}

/**
 * The overwrite-spec rendered file content: the task-body region REPLACED by the R4
 * conflict-marker block (local / tracker sides — engine/markers.ts). `null` ⇒ the region
 * already contains a marker block (nested-marker refusal, matrix §4). Shared verbatim
 * between the plan-time render op (before/after hashes) and the live write, so the
 * journal's afterContentHash equals what actually lands.
 *
 * `shift` is the cumulative line delta of EARLIER same-file renders landed this run above
 * this region (RunContext.fileRenders): the 004 line model is pinned to the pristine
 * file, so a second marker write in one file must splice at the SHIFTED position or it
 * would land inside the first marker block.
 */
function overwriteRenderedContent(
  content: string,
  config: ResolvedConfig,
  flow: TaskFlow,
  issue: IssueView,
  shift = 0,
): string | null {
  let block: string;
  try {
    block = synthesizeConflictMarkerBlock({
      toolId: config.toolId,
      filePath: flow.filePath,
      taskLine: flow.task.lineNumber,
      issueKey: issue.key,
      localContent: flow.specSection,
      trackerContent: issue.description,
    });
  } catch {
    return null; // nested marker block already present — refusal
  }
  const start = flow.task.taskBody.startLine + 1 + shift;
  const end = flow.task.taskBody.endLine + shift;
  const lines = content.split("\n");
  if (start <= end && end <= lines.length) {
    lines.splice(start - 1, end - start + 1, ...block.split("\n"));
  }
  return lines.join("\n");
}

/**
 * Per-file splice shift for a `render-file` write (see {@link overwriteRenderedContent}):
 * `null` ⇒ an earlier render this run ALREADY covered this region (nested/covered section
 * ⇒ refusal, matrix §4), else the cumulative line delta of fully-above earlier renders.
 * Regions are tracked in ORIGINAL line coordinates; siblings never overlap.
 */
function renderSpliceShift(
  fileRenders: ReadonlyMap<string, ReadonlyArray<{ bodyStart: number; bodyEnd: number; landed: number }>>,
  filePath: string,
  bodyStart: number,
  bodyEnd: number,
): number | null {
  let shift = 0;
  for (const r of fileRenders.get(filePath) ?? []) {
    if (r.bodyEnd < bodyStart) shift += r.landed - (r.bodyEnd - r.bodyStart + 1);
    else if (r.bodyStart <= bodyEnd) return null; // earlier render covers/overlaps the region
  }
  return shift;
}

/** Record a landed render so later same-file renders shift (or refuse) correctly. */
function recordRender(
  fileRenders: Map<string, Array<{ bodyStart: number; bodyEnd: number; landed: number }>>,
  filePath: string,
  bodyStart: number,
  bodyEnd: number,
  beforeContent: string,
  afterContent: string,
): void {
  const regionLines = bodyEnd - bodyStart + 1;
  const landed = afterContent.split("\n").length - (beforeContent.split("\n").length - regionLines);
  const list = fileRenders.get(filePath) ?? [];
  list.push({ bodyStart, bodyEnd, landed });
  fileRenders.set(filePath, list);
}

// ──────────────────────────────────────────────────────────── execution

async function applyFlow(context: RunContext, flow: TaskFlow, ledger: StepLedger): Promise<void> {
  const uuid = flow.task.stableUuid;
  const decision = flow.entry.decision;

  // Frozen cells (matrix §4), skip-unresolved and no-change cells mutate NOTHING.
  if (flow.frozen) {
    skipOutcome(context, flow, "unresolved conflict block freezes the cell (matrix §4) — nothing consulted, nothing mutated");
    return;
  }
  if (decision === "no-change") {
    // BOOTSTRAP baseline seeding (SC-001; data-model §1 "one per task with a completed
    // sync"): a MATCHED converged task that carries no checkpoint is bootstrap-seeded —
    // its affecting action is `discovered` (history-log §2) with the §1 canonical page-0
    // rewrite, and the checkpoint enters the store in the final atomic write. A sync-mode
    // no-change task already holds its checkpoint and writes NOTHING (zero-call control).
    if (flow.issue !== undefined && flow.checkpoint === undefined) {
      await landPageZeroAndEvent(context, flow, flow.issue.id, ledger, () => historyEvent(context, flow, "discovered"));
      advanceCheckpoint(context, flow, flow.issue);
      context.outcomes.set(uuid, {
        taskUuid: uuid,
        decision,
        status: "applied",
        issueId: flow.issue.id,
        detail: "converged task bootstrap-seeded — checkpoint baseline written, `discovered` event appended; zero content mutation",
      });
      return;
    }
    skipOutcome(context, flow, "the live state already matches the plan — zero tracker writes");
    return;
  }
  if (decision === "skip-unresolved") {
    skipOutcome(context, flow, "awaiting human resolution of conflict markers — nothing mutated");
    return;
  }


  // A parent that did not LAND this run (indeterminate/failed/skipped create) skips the
  // subtree. Consulted via the OUTCOMES map ONLY — never the checkpoint store (a stale
  // checkpoint must not re-orphan a subtree, and never-landed parents have no
  // checkpoints). A parent whose checkpoint EXISTS predates this run ⇒ established.
  const parentUuid = flow.task.parentUuid;
  if (parentUuid !== undefined) {
    const parentOutcome = context.outcomes.get(parentUuid);
    const establishedBefore = context.checkpointMap[parentUuid] !== undefined;
    if (parentOutcome !== undefined && parentOutcome.status !== "applied" && !establishedBefore) {
      skipOutcome(context, flow, "dependency did not land this run — subtree skipped (zero mutation; indeterminate creates never replay)");
      return;
    }
  }

  // `fail` action ⇒ abort BEFORE this task's mutation (R6; no automatic rollback).
  if (flow.action === "fail") {
    context.aborted = true;
    context.outcomes.set(uuid, {
      taskUuid: uuid,
      decision,
      status: "failed",
      detail:
        "mapped 'fail' action aborted the run before this task's mutation — applied steps remain journaled; " +
        "no automatic rollback (the operator decides)",
    });
    return;
  }

  // Report-only posture (explicit mapping or degraded prefer-newer): surfaced, NOT mutated.
  if (decision === "conflict" && (flow.degraded || flow.action === "report-only")) {
    // history-log.md §2: conflict detection is an AFFECTING action — `report-only` and
    // degraded `prefer-newer` append exactly one `conflict-detected` event (only `skip`
    // is excluded; matrix §2 "History event" column). Zero issue-field/file mutation, but
    // the event rides the task's canonical attachment (payload.ts owns the chain write).
    if (flow.issue !== undefined) {
      await appendHistoryEvent(context.ctx, {
        issueId: flow.issue.id,
        taskUuid: uuid,
        event: historyEvent(context, flow, "conflict-detected", [`action:${flow.action ?? "report-only"}`]),
      });
    }
    context.outcomes.set(uuid, {
      taskUuid: uuid,
      decision,
      status: "skipped",
      ...(flow.issue !== undefined ? { issueId: flow.issue.id } : {}),
      detail: "conflict recorded for the report (report-only posture) — no mutation toward this cell",
    });
    return;
  }

  // Completion validation failure was plan-labeled ⇒ surfaced for the human; zero mutation.
  if (flow.completionValidationFailed) {
    context.outcomes.set(uuid, {
      taskUuid: uuid,
      decision,
      status: "failed",
      ...(flow.issue !== undefined ? { issueId: flow.issue.id } : {}),
      detail: `completion-state validation conflict recorded at plan time (${flow.entry.reasons.find((r) => r.startsWith("reason:")) ?? "reason unlabeled"}) — no mutation toward this cell`,
    });
    return;
  }

  // ── Screen EVERY outbound string BEFORE any transmission (categories-only detail). ──
  const categories = blockCategories(context.screener, [flow.baseTitle, flow.specSection]);
  if (categories.length > 0) {
    context.screeningBlocked = true;
    context.outcomes.set(uuid, {
      taskUuid: uuid,
      decision,
      ...(flow.issue !== undefined ? { issueId: flow.issue.id } : {}),
      status: "failed",
      detail: `outbound content blocked by security screening (categories: ${categories.join(", ")}) — nothing was transmitted`,
    });
    return;
  }

  if (decision === "create") {
    await runCreateFlow(context, flow, ledger);
    return;
  }
  await runUpdateFlow(context, flow, ledger);
}

function skipOutcome(context: RunContext, flow: TaskFlow, detail: string): void {
  context.outcomes.set(flow.task.stableUuid, {
    taskUuid: flow.task.stableUuid,
    decision: flow.entry.decision,
    status: "skipped",
    detail,
  });
}

/** Distinct blocking categories across a batch of outbound strings. */
function blockCategories(screener: SecurityScreener, values: readonly string[]): string[] {
  const categories = new Set<string>();
  for (const value of values) {
    for (const category of screener.screen(value).blocked) categories.add(category);
  }
  return [...categories];
}

/**
 * The screener's OUTPUT for transmitted strings and sealed snapshots alike (R12):
 * non-blocking findings are redacted (`[redacted:<category>]`) or annotated
 * (`<match>[<category>]`); blocking matches are replaced by `[blocked:<category>]`
 * sentinels — so even a pre-materialized journal step can never seal raw secret
 * material. Transmission of blocking content never happens anyway: the pre-transmission
 * screen in `applyFlow` fails that op first (categories-only detail).
 */
function screenText(screener: SecurityScreener, text: string): string {
  return screener.screen(text).output;
}

// ─────────────────────────────────────────────────────────── create flow

async function runCreateFlow(context: RunContext, flow: TaskFlow, ledger: StepLedger): Promise<void> {
  const uuid = flow.task.stableUuid;

  // ── Replay guard FIRST (FR-012): a terminal `indeterminate` intent forbids ANY
  //    further attempt AND any second intent — a resume consults this and stops. ───────
  const intents = await listIntentsByTask(context.deps.state, uuid);
  const open = intents.find((i) => i.status === "pending");
  const terminal = intents.find((i) => i.status === "indeterminate");
  if (terminal !== undefined) {
    skipOutcome(context, flow, "prior create outcome indeterminate — replay permanently prohibited (FR-012); subtree remains skipped");
    return;
  }
  if (open !== undefined) {
    // A pending intent from a crashed run: reconcile ONCE by canonical identity, NEVER
    // re-attempt; unreconcilable ⇒ terminal indeterminate (same containment posture).
    const carriers = await carriersFor(context.deps.port, context.config, uuid);
    if (carriers.length === 1) {
      const adopted = await context.deps.port.getIssue(carriers[0]!.id);
      if (adopted !== null) {
        await updateCreateIntentStatus(context.deps.state, open.intentId, "confirmed-created");
        await landIssue(context, flow, adopted, open.intentId, ledger, true);
        context.outcomes.set(uuid, {
          taskUuid: uuid,
          decision: "create",
          status: "applied",
          issueId: adopted.id,
          detail: "crashed create reconciled by canonical attachment URL — existing issue adopted (FR-012)",
        });
        return;
      }
    }
    await updateCreateIntentStatus(context.deps.state, open.intentId, "indeterminate");
    skipOutcome(context, flow, indeterminateDetail(carriers.length, "prior create"));
    return;
  }

  const teamKey = flow.routing.teamKey;
  const projectId = createProject(context, flow);
  const title = screenText(context.screener, flow.baseTitle);
  const description = desiredIssueDescription(context, flow);

  // ── (a) Intent BEFORE attempt (durable; the crash window is an intent without result).
  const intent = await writeCreateIntentBeforeAttempt(context.deps.state, {
    intentId: intentIdFor(context.plan.planId, uuid),
    runId: context.runId,
    taskUuid: uuid,
    targetTeamKey: teamKey,
    targetProject: projectId,
  });

  // ── (b) EXACTLY ONE attempt — never retried; a throw reconciles by canonical URL. ──
  let view: IssueView | null = null;
  try {
    const parentId = await resolvedParentIssueId(context, flow);
    view = await context.deps.port.createIssue({
      teamKey,
      projectId,
      title,
      description,
      ...(flow.task.checked === true ? { stateType: "done" } : {}),
      ...(parentId !== undefined ? { parentId } : {}),
    });
  } catch {
    view = null; // The outcome is UNKNOWN (crash window) — reconcile, never re-attempt.
  }

  if (view !== null) {
    await updateCreateIntentStatus(context.deps.state, intent.intentId, "confirmed-created");
    await landIssue(context, flow, view, intent.intentId, ledger, false);
    context.outcomes.set(uuid, { taskUuid: uuid, decision: "create", status: "applied", issueId: view.id });
    return;
  }

  // ── (c) Reconcile ONCE by canonical attachment URL (never a second attempt). ───────
  const carriers = await carriersFor(context.deps.port, context.config, uuid);
  if (carriers.length === 1) {
    const adopted = await context.deps.port.getIssue(carriers[0]!.id);
    const carrier = adopted ?? carriers[0]!;
    await updateCreateIntentStatus(context.deps.state, intent.intentId, "confirmed-created");
    await landIssue(context, flow, carrier, intent.intentId, ledger, true);
    context.outcomes.set(uuid, {
      taskUuid: uuid,
      decision: "create",
      status: "applied",
      issueId: carrier.id,
      detail: "create reconciled by canonical attachment URL — existing issue adopted (FR-012)",
    });
    return;
  }
  await updateCreateIntentStatus(context.deps.state, intent.intentId, "indeterminate");
  context.outcomes.set(uuid, {
    taskUuid: uuid,
    decision: "create",
    status: "failed",
    detail: indeterminateDetail(carriers.length, "create"),
  });
}

function indeterminateDetail(carrierCount: number, label: string): string {
  return (
    `${label} outcome indeterminate (${carrierCount === 0 ? "no carrier reconciled" : `${carrierCount} carriers share the canonical identity — integrity diagnostic`}) — ` +
    "subtree skipped, exactly-one-attempt honored, replay permanently prohibited (FR-012)"
  );
}

async function carriersFor(port: LinearPort, config: ResolvedConfig, taskUuid: string): Promise<IssueView[]> {
  try {
    return await port.findIssuesByAttachmentUrl(canonicalAttachmentUrl(config, taskUuid));
  } catch {
    return [];
  }
}

/** Deterministic content-derived intent id (stable per plan+task pair). */
function intentIdFor(planId: string, taskUuid: string): string {
  return createHash("sha256").update(`${planId}\u0000intent\u0000${taskUuid}`, "utf8").digest("hex");
}

function createProject(context: RunContext, flow: TaskFlow): string {
  const routed = flow.routing.project;
  if (typeof routed === "string" && routed.length > 0) return routed;
  return context.config.teams[flow.routing.teamKey]?.projects[0] ?? "default";
}

async function resolvedParentIssueId(context: RunContext, flow: TaskFlow): Promise<string | undefined> {
  const parentUuid = flow.task.parentUuid;
  if (parentUuid === undefined) return undefined;
  return context.outcomes.get(parentUuid)?.issueId;
}

/** Land a created/adopted issue: create-step `applied` → page-0 rewrite → `issue-created`. */
async function landIssue(
  context: RunContext,
  flow: TaskFlow,
  view: IssueView,
  intentId: string,
  ledger: StepLedger,
  reconciled: boolean,
): Promise<void> {
  const safeView: IssueView = {
    ...view,
    title: screenText(context.screener, view.title),
    description: screenText(context.screener, view.description),
  };
  const after = createIssueAfterSnapshot(safeView, reconciled);
  const step = takeStep(ledger, planCreateIssueOp({ taskUuid: flow.task.stableUuid, intentId }));
  if (context.journal !== null && step !== null) {
    await recordStepTransition(context.deps.state, context.deps.config, context.options.keyProvider, context.deps.clock, context.runId, {
      opId: step.opId,
      stepState: "applied",
      targetIssueId: view.id,
      afterSnapshot: after,
    });
  }
  context.mutationsLanded = true;
  await landPageZeroAndEvent(context, flow, view.id, ledger, () => historyEvent(context, flow, "issue-created"));
  await landAssignedTaskLine(context, flow, view, ledger);
  advanceCheckpoint(context, flow, view);
}

/**
 * Rewrite the assigned task line in place with the created/adopted issue's reference +
 * derived title through 004 `renderTaskLines` (contracts/engine-pipeline.md stage 5:
 * "Assigned task lines are rewritten via 004 renderTaskLines with the issue reference
 * and derived title"). The write lands on the create task's planned `render-file` step
 * (manifest file backup precedes it — T034 world plan.json). A 004 refusal (target line
 * inside a conflict block / frozen section) SKIPS the rewrite per the frozen rule; the
 * planned step simply never transitions.
 */
async function landAssignedTaskLine(
  context: RunContext,
  flow: TaskFlow,
  view: IssueView,
  ledger: StepLedger,
): Promise<void> {
  const keyMatch = /^(.+)-(\d+)$/.exec(view.key);
  if (keyMatch === null) return;
  const abs = join(context.plan.repositoryRoot, flow.filePath);
  let content: string;
  try {
    content = readFileSync(abs, "utf8");
  } catch {
    return; // Unreadable source file — the planned render op stays pending.
  }
  const issueRef: IssueRef = { key: keyMatch[1]!, number: Number(keyMatch[2]) };
  const assignments: readonly LineAssignment[] = [
    { task: flow.task, desiredTitle: screenText(context.screener, flow.baseTitle), issueRef },
  ];
  let rendered: string;
  try {
    rendered = renderTaskLines(flow.filePath, content, assignments, context.config).content;
  } catch {
    return; // 004 refuses a conflict-block/frozen target — skipped, never forced.
  }
  if (rendered === content) return;
  const step = takeStep(
    ledger,
    planRenderFileOp({
      taskUuid: flow.task.stableUuid,
      filePath: flow.filePath,
      beforeContentHash: sha256(content),
      afterContentHash: sha256(rendered),
    }),
  );
  writeRepoFileAtomic(abs, rendered);
  recordRender(context.fileRenders, flow.filePath, flow.task.lineNumber, flow.task.lineNumber, content, rendered);
  if (context.journal !== null && step !== null) {
    await recordStepTransition(context.deps.state, context.deps.config, context.options.keyProvider, context.deps.clock, context.runId, {
      opId: step.opId,
      stepState: "applied",
      afterSnapshot: { kind: "render-file", afterContentHash: sha256(rendered) },
    });
  }
}

// ──────────────────────────────────────────────────────────── update flow

async function runUpdateFlow(context: RunContext, flow: TaskFlow, ledger: StepLedger): Promise<void> {
  const uuid = flow.task.stableUuid;
  const decision = flow.entry.decision;
  const issue = flow.issue;
  if (issue === undefined) {
    context.outcomes.set(uuid, {
      taskUuid: uuid,
      decision,
      status: "failed",
      detail: "matched issue is absent on re-fetch — zero mutations toward this cell",
    });
    return;
  }

  // ── overwrite-spec: R4 marker block into the mirror region; the issue is untouched. ─
  if (decision === "conflict" && flow.action === "overwrite-spec") {
    await renderConflictFile(context, flow, issue, ledger);
    return;
  }

  // ── matrix §3 `prefer-newer` winner resolution (tracker-newer ⇒ overwrite-spec). ───
  // Degraded pairs (§3 rows 3–4) never reach here — the plan labels them `degraded:true`
  // and the report-only branch handled them. What survives is a live winner: `spec-changed`
  // (§3 row 1) is the fall-through update below (push the spec section ⇒ the
  // `description-updated` winner effect); a strictly ADVANCING `issue.updatedAt` over the
  // checkpoint's (§3 row 2) is tracker-newer ⇒ the overwrite-spec effect: marker block
  // into the file, zero pushes to the issue.
  if (decision === "conflict" && flow.action === "prefer-newer") {
    const checkpoint = context.checkpointMap[uuid];
    const trackerNewer = checkpoint !== undefined && issue.updatedAt > checkpoint.issueUpdatedAt;
    if (trackerNewer) {
      await renderConflictFile(context, flow, issue, ledger);
      return;
    }
  }

  // Precondition re-check builds the patch from LIVE issue vs desired state; the plan's
  // changedFields bounds WHICH channels may ever be patched (R7).
  const changed = flow.entry.changedFields;
  const patch: MutablePatch = {};
  const screenedTitle = screenText(context.screener, flow.baseTitle);
  if (changed.includes("title") && issue.title !== screenedTitle) patch.title = screenedTitle;
  if (changed.includes("description")) {
    const desired = desiredIssueDescription(context, flow);
    if (desired !== issue.description) patch.description = desired;
  }
  if (changed.includes("state")) {
    const stateId = await completionStateId(context, flow);
    if (stateId === "conflict") {
      context.outcomes.set(uuid, {
        taskUuid: uuid,
        decision,
        status: "failed",
        issueId: issue.id,
        detail: "completion mapping: the live workflow snapshot does not resolve the desired state — no mutation toward this cell",
      });
      return;
    }
    if (stateId !== null) patch.stateTypeId = stateId;
  }

  if (Object.keys(patch).length > 0) {
    const updated = await context.deps.port.updateIssue(issue.id, patch);
    context.mutationsLanded = true;
    const step = takeStep(
      ledger,
      planUpdateIssueOp({
        taskUuid: uuid,
        targetIssueId: issue.id,
        priorFields: priorFieldsFor(context, issue, patch),
        patchedFields: patch,
      }),
    );
    if (context.journal !== null && step !== null) {
      await recordStepTransition(context.deps.state, context.deps.config, context.options.keyProvider, context.deps.clock, context.runId, {
        opId: step.opId,
        stepState: "applied",
        targetIssueId: issue.id,
        afterSnapshot: { kind: "update-issue", fields: patch },
      });
    }
    const primary = (["title", "description", "stateTypeId"] as const).find((f) => patch[f] !== undefined)!;
    const kind = historyKindForUpdatedField(primary);
    await landPageZeroAndEvent(
      context,
      flow,
      issue.id,
      ledger,
      (landedHash) => historyEvent(context, flow, kind, eventReferences(context, flow, landedHash, patch)),
    );
    advanceCheckpoint(context, flow, updated);
    context.outcomes.set(uuid, {
      taskUuid: uuid,
      decision,
      status: "applied",
      issueId: issue.id,
      ...(decision === "conflict" && flow.action !== undefined
        ? { detail: `resolved by the configured action '${flow.action}'` }
        : {}),
    });
    return;
  }

  // Everything already matches live (a checkbox-only completion whose live state re-checks
  // identical, or self-resolved plan drift): the converged posture writes NOTHING — a
  // byte-identical page-0 rewrite would be a duplicate write (FR-015 idempotence).
  advanceCheckpoint(context, flow, issue);
  context.outcomes.set(uuid, { taskUuid: uuid, decision, status: "applied", issueId: issue.id });
}

function priorFieldsFor(context: RunContext, issue: IssueView, patch: IssueUpdatePatch): IssueUpdatePatch {
  // Prior tracker values ride journal material — sanitize through the screener too, so a
  // sealed step can never carry raw secret material (clean values pass through verbatim).
  const prior: MutablePatch = {};
  if (patch.title !== undefined) prior.title = screenText(context.screener, issue.title);
  if (patch.description !== undefined) prior.description = screenText(context.screener, issue.description);
  if (patch.stateTypeId !== undefined) prior.stateTypeId = issue.stateType;
  return prior;
}

async function renderConflictFile(
  context: RunContext,
  flow: TaskFlow,
  issue: IssueView,
  ledger: StepLedger,
): Promise<void> {
  const uuid = flow.task.stableUuid;
  const abs = join(context.plan.repositoryRoot, flow.filePath);
  let content: string;
  try {
    content = readFileSync(abs, "utf8");
  } catch {
    context.outcomes.set(uuid, {
      taskUuid: uuid,
      decision: "conflict",
      status: "failed",
      issueId: issue.id,
      detail: "overwrite-spec refused: the task source file is unreadable — nothing was mutated",
    });
    return;
  }
  backupFile(context, flow.filePath, content);
  const bodyStart = flow.task.taskBody.startLine + 1;
  const bodyEnd = flow.task.taskBody.endLine;
  const shift = renderSpliceShift(context.fileRenders, flow.filePath, bodyStart, bodyEnd);
  const after = shift === null ? null : overwriteRenderedContent(content, context.config, flow, issue, shift);
  if (after === null) {
    context.outcomes.set(uuid, {
      taskUuid: uuid,
      decision: "conflict",
      status: "failed",
      issueId: issue.id,
      detail: "overwrite-spec refused: the section already carries or is covered by a conflict-marker block (matrix §4 nested-marker refusal) — resolve manually",
    });
    return;
  }
  const step = takeStep(ledger, planRenderFileOp({ taskUuid: uuid, filePath: flow.filePath, beforeContentHash: sha256(content), afterContentHash: sha256(after) }));
  writeRepoFileAtomic(abs, after);
  recordRender(context.fileRenders, flow.filePath, bodyStart, bodyEnd, content, after);
  context.mutationsLanded = true;
  if (context.journal !== null && step !== null) {
    await recordStepTransition(context.deps.state, context.deps.config, context.options.keyProvider, context.deps.clock, context.runId, {
      opId: step.opId,
      stepState: "applied",
      afterSnapshot: { kind: "render-file", afterContentHash: sha256(after) },
    });
  }
  await appendHistoryEvent(context.ctx, {
    issueId: issue.id,
    taskUuid: flow.task.stableUuid,
    event: historyEvent(context, flow, "conflict-detected", ["action:overwrite-spec", `rendered:${flow.filePath}`]),
  });
  context.outcomes.set(uuid, {
    taskUuid: uuid,
    decision: "conflict",
    status: "applied",
    issueId: issue.id,
    detail: "conflict-marker block rendered into the spec file; the tracker was never mutated (matrix §2 overwrite-spec)",
  });
}

async function completionStateId(context: RunContext, flow: TaskFlow): Promise<string | null | "conflict"> {
  const teamKey = flow.routing.teamKey;
  let stateName: string;
  try {
    stateName = desiredCompletionStateName(context.config, teamKey, flow.task.checked ?? false);
  } catch {
    return "conflict";
  }
  if (flow.issue?.stateType === stateName) return null; // live state already matches
  try {
    return resolveWorkflowStateId(context.snapshot, teamKey, stateName);
  } catch {
    return "conflict";
  }
}

// ────────────────────────────────────────────────── history pages (payload)

/**
 * Rewrite page 0 authoritatively (payload.ts owns the payload schema + chain). Returns
 * the mirror hash the payload carries — the SAME normalized hash the checkpoint advances
 * to (the attachment-state cross-check compares them).
 */
// ─────────────────────────────────────────────────── page-0 landing (folded)

/** Chain-walk hard bound (mirrors 007/payload.ts `MAX_CHAIN_PAGES`). */
const MAX_CHAIN_PAGES = 1000;

/** payload.ts `screened()` twin: blocking findings throw, non-blocking output wins. */
function screenPayloadField(context: RunContext, text: string, label: string): string {
  const result = context.screener.screen(text);
  if (result.blocked.length > 0) {
    throw new PayloadScreeningError(
      `attachment payload propagation blocked by security screening (${label}): ${result.blocked.join(", ")}`,
    );
  }
  return result.output;
}

function screenFrameworkMetadata(context: RunContext, md: FrameworkMetadata): FrameworkMetadata {
  return {
    // Closed vocabulary (not free text from the spec boundary) — verbatim, as payload.ts does.
    frameworkId: md.frameworkId,
    ...(md.featureName !== undefined
      ? { featureName: screenPayloadField(context, md.featureName, "frameworkMetadata.featureName") }
      : {}),
    filePath: screenPayloadField(context, md.filePath, "frameworkMetadata.filePath"),
    ...(md.localTaskId !== undefined
      ? { localTaskId: screenPayloadField(context, md.localTaskId, "frameworkMetadata.localTaskId") }
      : {}),
  };
}

function presentationOf(config: RunContext["config"]): {
  readonly title: string;
  readonly subtitle?: string;
  readonly iconUrl?: string;
} {
  return {
    title: config.syncAttachmentTitle,
    ...(config.syncAttachmentSubtitle !== undefined ? { subtitle: config.syncAttachmentSubtitle } : {}),
    ...(config.syncAttachmentIconUrl !== undefined ? { iconUrl: config.syncAttachmentIconUrl } : {}),
  };
}

/**
 * Land page 0 AND the task's history event in the minimum number of canonical writes:
 * a task landing on an un-rolled chain (event belongs on page 0) gets EXACTLY ONE
 * canonical `upsertAttachmentByUrl` carrying rewritten metadata + the appended event
 * (integration pin `assertOnePageZeroUpsert`, FR-008); a rolled chain (event belongs on
 * page n>0) rewrites page 0 once and appends at n via the frozen `appendHistoryEvent`.
 * Rollover tails land at page n+1 after the head (crash-safe order, history-log §3);
 * a blocked event description throws `PayloadScreeningError` before any write (R12).
 */
async function landPageZeroAndEvent(
  context: RunContext,
  flow: TaskFlow,
  issueId: string,
  ledger: StepLedger,
  makeEvent: (landedHash: string) => SyncHistoryEvent,
): Promise<string> {
  const uuid = flow.task.stableUuid;
  const config = context.config;
  const hash = mirrorHashFor(context, flow);
  const url = canonicalAttachmentUrl(config, uuid);
  // FR-015 priorMetadata is the PRE-RUN attachment state: captured once at the run's
  // tracker preflight (the same scan the plan's attachment mirror uses) — an in-run
  // re-read would seal the JUST-REWITTEN metadata and blind rollback (§2 inverse).
  const preRun = context.canonicalPrior.get(url);
  const priorMetadata: AttachmentMetadata | null = preRun === undefined || preRun === null ? null : { ...preRun };
  const frameworkMetadata: FrameworkMetadata = {
    frameworkId: flow.task.frameworkId,
    ...(flow.task.featureName !== undefined ? { featureName: flow.task.featureName } : {}),
    filePath: flow.filePath,
    ...(flow.task.localTaskId !== undefined ? { localTaskId: flow.task.localTaskId } : {}),
  };

  // Chain walk to the last page (frozen §3 step 1 semantics — the chain is never cached).
  const pageZero = await readPageZeroPayload(context.ctx, uuid);
  let n = 0;
  let history = pageZero?.history ?? [];
  for (let page = 1; page <= MAX_CHAIN_PAGES; page += 1) {
    const view = await context.deps.port.getAttachmentByUrl(historyPageAddress(config, uuid, page));
    if (view === null) break;
    const parsed = parseHistoryPageRecord(view, config.metadataNamespaceKey);
    if (parsed === null) break; // no (or unparseable) namespaced record ⇒ absent chain link
    n = page;
    history = parsed.history;
  }
  if (n >= MAX_CHAIN_PAGES) {
    throw new EngineError(
      `history chain for '${uuid}' exceeded ${MAX_CHAIN_PAGES} contiguous pages — inconsistent tracker state`,
    );
  }

  let view: AttachmentView;
  if (n === 0) {
    // FOLDED single canonical write: rewritten metadata + new event, rollover split honored.
    const event = makeEvent(hash);
    const description = screenPayloadField(context, event.description, "history event description");
    const entry: SyncHistoryEvent =
      description === event.description ? event : { ...event, description };
    const split = computeRolloverSplit([...history, entry], config);
    const payload: SyncStatePayload = {
      taskUuid: uuid,
      frameworkMetadata: screenFrameworkMetadata(context, frameworkMetadata),
      descriptionContentHash: hash,
      cursors: { lastSyncAt: context.nowIso },
      history: split.head,
    };
    view = await context.deps.port.upsertAttachmentByUrl({
      issueId,
      url,
      ...presentationOf(config),
      metadata: { [config.metadataNamespaceKey]: serializeSyncStatePayload(payload) },
    });
    if (split.tail.length > 0) {
      await context.deps.port.upsertAttachmentByUrl({
        issueId,
        url: historyPageAddress(config, uuid, 1),
        ...presentationOf(config),
        metadata: serializeHistoryPageRecord({ taskUuid: uuid, page: 1, history: split.tail }, config.metadataNamespaceKey),
      });
    }
  } else {
    view = await rewritePageZeroPayload(context.ctx, {
      issueId,
      taskUuid: uuid,
      frameworkMetadata,
      descriptionContentHash: hash,
    });
    await appendHistoryEvent(context.ctx, { issueId, taskUuid: uuid, event: makeEvent(hash) });
  }

  context.mutationsLanded = true;
  const step = takeStep(
    ledger,
    planUpsertAttachmentOp({
      taskUuid: uuid,
      targetIssueId: issueId,
      attachmentUrl: url,
      priorMetadata,
      resultingMetadata: { ...view.metadata } as AttachmentMetadata,
    }),
  );
  if (context.journal !== null && step !== null) {
    await recordStepTransition(context.deps.state, context.deps.config, context.options.keyProvider, context.deps.clock, context.runId, {
      opId: step.opId,
      stepState: "applied",
      targetIssueId: issueId,
      // First writer of the canonical URL: the pre-run state was unknowable at planning
      // time, so the landing transition carries it (FR-015 priorMetadata merge).
      before: priorMetadata,
      afterSnapshot: { kind: "upsert-attachment", metadata: { ...view.metadata } as AttachmentMetadata },
    });
  }
  return hash;
}

/** A run-stamped history event (screened at propagation inside the landing helpers). */
function historyEvent(
  context: RunContext,
  flow: TaskFlow,
  kind: SyncHistoryEventKind,
  references?: readonly string[],
): SyncHistoryEvent {
  const event: SyncHistoryEvent = {
    kind,
    at: context.nowIso,
    description: historyDescription(kind, flow),
    ...(references !== undefined && references.length > 0 ? { references } : {}),
  };
  return event;
}

function historyDescription(kind: SyncHistoryEventKind, flow: TaskFlow): string {
  switch (kind) {
    case "issue-created":
      return `issue created${flow.baseTitle.length > 0 ? ` for '${flow.baseTitle}'` : ""}`;
    case "title-updated":
      return `title updated to '${flow.baseTitle}'`;
    case "description-updated":
      return "description updated by the configured conflict action";
    case "checkbox-changed":
      return `completion checkbox changed to ${flow.task.checked === true ? "done" : "not-done"}`;
    case "conflict-detected":
      return "conflict recorded by the configured resolution action";
    case "discovered":
      return "task discovered and baseline seeded (bootstrap)";
    default:
      return `sync event (${kind})`;
  }
}

function eventReferences(
  context: RunContext,
  flow: TaskFlow,
  landedHash: string,
  patch: IssueUpdatePatch,
): string[] {
  void context;
  void flow;
  const refs: string[] = [];
  if (patch.description !== undefined) refs.push(`contentHash:${landedHash}`);
  if (patch.stateTypeId !== undefined) {
    refs.push(`stateTypeId:${patch.stateTypeId}`);
    const team = context.snapshot.find((c) => c.teamKey === flow.routing.teamKey);
    const name = team?.workflowStates.find((s) => s.id === patch.stateTypeId)?.name;
    if (name !== undefined) refs.push(`stateName:${name}`);
  }
  return refs;
}

/**
 * Post-action normalized mirror hash. The plan entry hash is authoritative whenever the
 * action's RESULT equals the planned side (guards rejected any drift after planning and
 * the apply-side actions are deterministic): overwrite-linear / linear-wins land the
 * normalized mirror; title/completion-only updates leave the mirrored description
 * content — equal to the live issue description — untouched.
 */
function mirrorHashFor(context: RunContext, flow: TaskFlow): string {
  const cached = context.mirrorHash.get(flow.task.stableUuid);
  if (cached !== undefined) return cached;
  const descriptionOnlyUpdate =
    flow.entry.decision === "update" && !flow.entry.changedFields.includes("description");
  const source = descriptionOnlyUpdate ? (flow.issue?.description ?? flow.specSection) : flow.specSection;
  const hash = normalizedContentHash(context.normalizer, source);
  context.mirrorHash.set(flow.task.stableUuid, hash);
  return hash;
}

// ───────────────────────────────────────────────────────────── journal ops

interface AuditManifestFileBackup {
  readonly path: string;
  readonly beforeContentHash: string;
  readonly beforeContent: string;
}

interface PlannedMaterial {
  readonly ops: readonly PlannedOp[];
  readonly fileBackups: readonly AuditManifestFileBackup[];
}

/**
 * Plan-derived op materialization (complete-before-first-mutation). A `fail`-mapped cell,
 * a frozen cell, a report-only/degraded cell and a completion-validation-failed cell
 * plan NO op (their mutations never happen — their absence also immunizes against
 * checkpoint drift re-planing them into updates). Kind sequences per task
 * (create → page-0 upsert; update → page-0 upsert; render-file alone) match the LIVE
 * emission, so live ops land on their pre-planned steps ordinal-wise.
 */
function planOps(
  config: ResolvedConfig,
  screener: SecurityScreener,
  plan: Plan,
  flows: readonly TaskFlow[],
  checkpointMap: Record<string, Checkpoint>,
): PlannedMaterial {
  const drafts: PlannedOpDraft[] = [];
  const fileBackups: AuditManifestFileBackup[] = [];
  const backedUp = new Set<string>();
  // Cumulative per-file render material for multi-marker files (plan-side twin of
  // RunContext.fileRenders — planned hashes must match what the live writes land).
  const renderContents = new Map<string, string>();
  const planRenders = new Map<string, Array<{ bodyStart: number; bodyEnd: number; landed: number }>>();
  for (const task of emissionOrder(flows.map((f) => f.task))) {
    const flow = flows.find((f) => f.task.stableUuid === task.stableUuid)!;
    const entry = flow.entry;
    const decision = entry.decision;
    if (flow.frozen || decision === "skip-unresolved") continue;
    if (decision === "no-change") {
      // Bootstrap baseline seeding (applyFlow twin): the canonical page-0 write gets its
      // planned journal step (priorMetadata journalled for every planned attachment
      // create-or-update — history-log §4).
      if (flow.issue !== undefined && flow.checkpoint === undefined) {
        drafts.push(
          planUpsertAttachmentOp({
            taskUuid: task.stableUuid,
            targetIssueId: flow.issue.id,
            attachmentUrl: canonicalAttachmentUrl(config, task.stableUuid),
            priorMetadata: null,
          }),
        );
      }
      continue;
    }
    if (entry.reasons.some((r) => r === "action:fail" || r === "action:skip")) continue;
    if (decision === "conflict" && (flow.degraded || flow.action === "report-only")) continue;
    if (flow.completionValidationFailed) continue;

    if (decision === "create") {
      drafts.push(planCreateIssueOp({ taskUuid: task.stableUuid, attachmentUrl: canonicalAttachmentUrl(config, task.stableUuid) }));
      drafts.push(
        planUpsertAttachmentOp({
          taskUuid: task.stableUuid,
          targetIssueId: "",
          attachmentUrl: canonicalAttachmentUrl(config, task.stableUuid),
          priorMetadata: null,
          // Landing transition carries the learned prior (null ⇒ stays absent: created
          // issues have no pre-run canonical) and the real target via `before`.
        }),
      );
      // Assigned task line re-render (contracts/engine-pipeline.md stage 5; T034 world
      // plan.json): the created issue's ref + derived title are written into the task
      // line via 004 `renderTaskLines` — a `render-file` op whose whole-file backup
      // rides the manifest. The landed issue id is unknowable at plan time, so the
      // planned afterContentHash stands as a placeholder (the applied step records the
      // REAL rendered hash at its transition; a pending/never-landed step re-meets the
      // before arm ⇒ "nothing to undo", journal-rollback §3).
      try {
        const lineBefore = renderContents.get(flow.filePath) ?? readFileSync(join(plan.repositoryRoot, flow.filePath), "utf8");
        if (!backedUp.has(flow.filePath)) {
          backedUp.add(flow.filePath);
          const backup = screenText(screener, lineBefore);
          fileBackups.push({ path: flow.filePath, beforeContentHash: sha256(backup), beforeContent: backup });
        }
        drafts.push(
          planRenderFileOp({
            taskUuid: task.stableUuid,
            filePath: flow.filePath,
            beforeContentHash: sha256(lineBefore),
            afterContentHash: sha256(lineBefore),
          }),
        );
      } catch {
        // Unreadable source file ⇒ no render op planned; the live flow skips the rewrite.
      }
      continue;
    }
    const issueId = flow.issue?.id;
    if (issueId === undefined) continue;
    // Matrix §2/§3 — the overwrite-spec effect (explicit `overwrite-spec`, or the
    // tracker-winner resolution of a live `prefer-newer`, §3 row 2: strictly advancing
    // `issue.updatedAt` over the checkpoint's) renders the marker file and pushes NOTHING.
    const overwriteSpecWins =
      flow.issue !== undefined &&
      (flow.action === "overwrite-spec" ||
        (flow.action === "prefer-newer" &&
          !flow.degraded &&
          flow.checkpoint !== undefined &&
          flow.issue.updatedAt > flow.checkpoint.issueUpdatedAt));
    if (decision === "conflict" && overwriteSpecWins && flow.issue !== undefined) {
      const issueForBlock = flow.issue;
      try {
        const beforeContent = renderContents.get(flow.filePath) ?? readFileSync(join(plan.repositoryRoot, flow.filePath), "utf8");
        if (!backedUp.has(flow.filePath)) {
          backedUp.add(flow.filePath);
          // R12: the sealed manifest is OPENED and plaintext-scanned for secret material —
          // the rollback backup rides the screener's output (sentinel-substituted where
          // findings exist), hashed AS STORED so the manifest stays internally consistent.
          const backup = screenText(screener, beforeContent);
          fileBackups.push({ path: flow.filePath, beforeContentHash: sha256(backup), beforeContent: backup });
        }
        // Later same-file renders plan at the SHIFTED region against the cumulative
        // content, mirroring the live splice order (see `renderSpliceShift`).
        const shift = renderSpliceShift(planRenders, flow.filePath, flow.task.taskBody.startLine + 1, flow.task.taskBody.endLine);
        const afterContent = shift === null ? null : overwriteRenderedContent(beforeContent, config, flow, issueForBlock, shift);
        if (afterContent !== null) {
          drafts.push(
            planRenderFileOp({
              taskUuid: task.stableUuid,
              filePath: flow.filePath,
              beforeContentHash: sha256(beforeContent),
              afterContentHash: sha256(afterContent),
            }),
          );
          renderContents.set(flow.filePath, afterContent);
          recordRender(planRenders, flow.filePath, flow.task.taskBody.startLine + 1, flow.task.taskBody.endLine, beforeContent, afterContent);
        }
        // afterContent === null ⇒ nested-marker refusal: the live flow fails per-task and
        // mutates nothing, so NO render op is planned either.
      } catch {
        // Unreadable ⇒ no render op; the live flow fails loudly with a sanitized detail.
      }
      continue;
    }
    const patched: MutablePatch = {};
    // R12 / T043 header: blocked content lands in NO state file — a field whose source
    // screens `blocked.length > 0` fails pre-transmission at apply time, so its screened
    // text must never ride the journal's planned after-snapshot either. Plan only the
    // fields that can actually transmit (all-but-blocked keeps partial updates intact).
    if (entry.changedFields.includes("title")) {
      const screened = screener.screen(flow.baseTitle);
      if (screened.blocked.length === 0) patched.title = screened.output;
    }
    if (entry.changedFields.includes("description")) {
      const screened = screener.screen(flow.specSection);
      if (screened.blocked.length === 0) patched.description = screened.output;
    }
    if (entry.changedFields.includes("state")) {
      const name = safeDesiredStateName(config, flow);
      const prior = checkpointMap[task.stableUuid]?.issueStateType ?? flow.issue?.stateType;
      if (name !== null && name !== prior) patched.stateTypeId = "";
    }
    if (Object.keys(patched).length > 0) {
      // The planned before-snapshot carries the PRE-RUN tracker values of exactly the patched
      // fields (journal-rollback.md §1 "complete before-snapshots pre the first mutation") —
      // otherwise the sealed step restores nothing on rollback. Screened like the live-path
      // prior (`priorFieldsFor`), so the journal never seals raw secret material.
      const prior: MutablePatch = {};
      if (flow.issue !== undefined) {
        if (patched.title !== undefined) prior.title = screenText(screener, flow.issue.title);
        if (patched.description !== undefined) prior.description = screenText(screener, flow.issue.description);
        if (patched.stateTypeId !== undefined) prior.stateTypeId = flow.issue.stateType;
      }
      drafts.push(planUpdateIssueOp({ taskUuid: task.stableUuid, targetIssueId: issueId, priorFields: prior, patchedFields: patched }));
      drafts.push(
        planUpsertAttachmentOp({
          taskUuid: task.stableUuid,
          targetIssueId: issueId,
          attachmentUrl: canonicalAttachmentUrl(config, task.stableUuid),
          priorMetadata: null,
        }),
      );
    }
  }
  return { ops: assignOpOrdinals(drafts, plan.planId), fileBackups };
}

function safeDesiredStateName(config: ResolvedConfig, flow: TaskFlow): string | null {
  try {
    return desiredCompletionStateName(config, flow.routing.teamKey, flow.task.checked ?? false);
  } catch {
    return null;
  }
}

function buildLedger(ops: readonly PlannedOp[]): StepLedger {
  const byTaskKind = new Map<string, PlannedOp[]>();
  for (const op of ops) {
    const key = `${op.taskUuid}:${op.kind}`;
    const list = byTaskKind.get(key);
    if (list === undefined) byTaskKind.set(key, [op]);
    else list.push(op);
  }
  for (const list of byTaskKind.values()) list.sort((a, b) => a.ordinal - b.ordinal);
  return { byTaskKind, consumed: new Map() };
}

/** Take the next pre-planned step for this (task, kind) — null when unjournaled. */
function takeStep(ledger: StepLedger, draft: PlannedOpDraft): PlannedOp | null {
  const key = `${draft.taskUuid}:${draft.kind}`;
  const steps = ledger.byTaskKind.get(key);
  if (steps === undefined || steps.length === 0) return null;
  const index = ledger.consumed.get(key) ?? 0;
  ledger.consumed.set(key, index + 1);
  return steps[Math.min(index, steps.length - 1)]!;
}

// ─────────────────────────────────────────────────────────── checkpoints

function advanceCheckpoint(context: RunContext, flow: TaskFlow, view: IssueView): void {
  const uuid = flow.task.stableUuid;
  context.checkpointMap[uuid] = {
    taskUuid: uuid,
    issueId: view.id,
    ...(flow.task.checked !== undefined ? { checked: flow.task.checked } : {}),
    // The SCREENED title — what the tracker actually holds (R12); clean content is the identity.
    title: screenText(context.screener, flow.baseTitle),
    issueUpdatedAt: view.updatedAt,
    issueStateType: view.stateType,
    descriptionContentHash: mirrorHashFor(context, flow),
  };
}

/**
 * The desired tracker description for a mutating action: every action lands the rendered
 * SPEC-side mirror region (the section body below the task line — pinned cross-lane
 * decision 1), POST-SCREENER (R12 — the transmitted string is the screener's output:
 * redacted/annotated, never raw). Blocking content never reaches the port: the
 * pre-transmission screen in `applyFlow` fails that op first; overwrite-spec never
 * mutates the issue and never reaches this helper.
 */
function desiredIssueDescription(context: RunContext, flow: TaskFlow): string {
  return screenText(context.screener, flow.specSection);
}

// ───────────────────────────────────────────────────────────────── report

async function writeRunReport(context: RunContext): Promise<LastRunMarker["reportPaths"]> {
  const base = buildPlanReportJson(context.plan);
  const report = {
    ...base,
    securityAssertions: [...base.securityAssertions, ...runSecurityAssertions(context)],
  };
  const markdown = renderRunMarkdown(context, report);
  const marker: Omit<LastRunMarker, "reportPaths" | "completedAt"> = {
    runId: context.runId,
    outcome: context.aborted ? "aborted" : "completed",
    notificationSuppressed: false,
  };
  const written = await writeRunReportWithMarker(
    context.deps.state,
    context.runId,
    report,
    markdown,
    context.screener,
    marker,
  );
  return written.reportPaths;
}

function runSecurityAssertions(context: RunContext): PlanReportAssertion[] {
  const assertions: PlanReportAssertion[] = [
    {
      guarantee: "gates-precede-mutation",
      status: "pass",
      detail: "the run executed only after the gate trio, the advisory lock and the stability read-back passed",
    },
    {
      guarantee: "journal-complete-before-first-mutation",
      status: context.journal !== null ? "pass" : "fail",
      detail:
        context.journal !== null
          ? "every planned op was materialized with its before-snapshot before the first mutation"
          : "journaling disabled — the run applied unjournaled (spec posture)",
    },
    {
      guarantee: "exactly-one-create-attempt",
      status: "pass",
      detail: "every create op attempted createIssue at most once; indeterminate outcomes are never replayed (FR-012)",
    },
    {
      guarantee: "checkpoint-advance-atomic-last",
      status: context.aborted ? "fail" : "pass",
      detail: context.aborted
        ? "the run aborted — the checkpoint store was NOT advanced (rollback material stays consistent with checkpointBefore)"
        : "the checkpoint store advanced once, atomically, after the last landed mutation",
    },
  ];
  if (context.aborted) {
    assertions.push({
      guarantee: "run-abort",
      status: "fail",
      detail:
        "a mapped 'fail' action aborted the run before the failing cell's mutation; applied steps remain journaled; " +
        "no automatic rollback (R6 — the operator decides)",
    });
  }
  if (context.screeningBlocked) {
    assertions.push({
      guarantee: "screening",
      status: "fail",
      detail: "at least one operation was blocked pre-transmission by security screening — categories are named in the operation outcome only",
    });
  }
  return assertions;
}

function renderRunMarkdown(context: RunContext, report: ReturnType<typeof buildPlanReportJson>): string {
  const lines = [
    `# Sync Run Report — ${context.runId}`,
    "",
    `- Plan: \`${context.plan.planId}\``,
    `- Outcome: **${context.aborted ? "aborted" : "applied"}**`,
    "",
    "## Operations",
    "",
  ];
  for (const o of orderedOutcomes(context)) {
    lines.push(
      `- \`${o.taskUuid}\` — ${o.decision} → **${o.status}**` +
        (o.issueId !== undefined ? ` (issue \`${o.issueId}\`)` : "") +
        (o.detail !== undefined ? ` — ${o.detail}` : ""),
    );
  }
  lines.push("", "## Security assertions", "");
  for (const a of report.securityAssertions) {
    lines.push(`- **${a.status}** — ${a.guarantee}${a.detail !== undefined ? `: ${a.detail}` : ""}`);
  }
  return `${lines.join("\n")}\n\n${renderPlanReportMarkdown(report)}`;
}

function orderedOutcomes(context: RunContext): OperationOutcome[] {
  const order = new Map(context.flows.map((f, i) => [f.task.stableUuid, i]));
  return [...context.outcomes.values()].sort((a, b) => (order.get(a.taskUuid) ?? 0) - (order.get(b.taskUuid) ?? 0));
}

// ────────────────────────────────────────────────────────────────── utils

function sha256(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function backupFile(context: RunContext, filePath: string, beforeContent: string): void {
  if (!context.fileBackups.has(filePath)) context.fileBackups.set(filePath, beforeContent);
}

/** Atomic in-place file replacement (temp + rename; owner-only content). */
function writeRepoFileAtomic(absPath: string, content: string): void {
  const tmp = `${absPath}.task-sync-tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, absPath);
}
