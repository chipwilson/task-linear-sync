/**
 * T024 [US1] — `buildSyncPlan`, the READ-ONLY plan pipeline (contracts/engine-pipeline.md
 * stages 1–7; research R2/R3/R6/R7/R13/R14; wired into `createSyncEngine` by T026;
 * integration tests T018/T019/T027).
 *
 * Stage map (contract table, one pass):
 *  1. Discover + parse — 003 `discoverTaskFiles` (deterministic ordering, git context for
 *     the HEAD guard) → 004 `parseTaskFile` per discovered file (conflict blocks ⇒
 *     `Task.unresolvedConflict`, matrix §4). Raw bytes are read exactly once per file and
 *     double as the guard material (stage 6).
 *  2. Route + derive titles — 005 `resolveRouting` (per file) / `deriveTitle` (per task).
 *  3. Match — 007 reads (`listIssues` in the configured scope, `listAttachments` per
 *     issue) feed 006 `projectCandidates` + `matchAllTasks`; a durable-identity collision
 *     (one taskUuid on ≥2 issues, or one issue carrying contradictory anchors) surfaces
 *     from the projection integrity scan as 006's `DurableIdentityCollisionError` and is
 *     re-raised as the 008-local `IntegrityError` — a constitution-II hard abort, never
 *     silently adopted.
 *  4. Mode + classify — `readCheckpointStore` + `selectMode` (reality wins; a disagreeing
 *     advisory hint contributes its sanitized `diagnosticReason` to every entry's reasons,
 *     R2); `classifyTask` per task under the configured profile resolved through
 *     `resolveConfiguredNormalizer` (pinned decision 2: `"standard"` ⇒ built-in
 *     `"default"`). Mirror region: the task-section BODY below the task line (pinned
 *     cross-lane decision 1) — hashed via `normalizedContentHash`, never stored raw.
 *  5. Conflict action resolution — `resolveConflictAction`/`appliedAction` against the
 *     mode's merged map (`ResolvedConfig.bootstrapConflictMap`/`syncConflictMap` — the
 *     frozen config chain already merges the FR-004 built-ins as the base), with the
 *     recency context (issue/checkpoint `updatedAt`) supplied for every resolution —
 *     `actions.ts` keeps it inert for non-`prefer-newer` actions. Completion mapping
 *     (`checkedChanged ∧ ¬descriptionConflict`, data-model §6/R7) resolves the configured
 *     state NAME through the 007 `discoverMetadata` snapshot to a state id. A completion
 *     validation failure (unknown team / missing or unknown state name) is SURFACED, not
 *     crashed: the entry reports `validation:completion-state` + the sanitized
 *     `reason:<EngineError message>` label, takes `decision:"conflict"` so it lands in the
 *     report's conflicts section, and a `completion-state-validation` FAIL security
 *     assertion rides the report; every other task plans normally (R7 "plan-time
 *     validation failure (sanitized), not a runtime surprise" — documented
 *     interpretation, see the notes on {@link buildEntry}).
 *  6. Assemble the frozen `Plan` — entries in deterministic working order (filePath asc,
 *     lineNumber asc); guards = sha256 of each scanned input file's raw bytes
 *     (repository-relative POSIX keys — the exact material `validatePlanReference`
 *     re-checks at apply) + HEAD from the 003 git context (absent HEAD tolerated,
 *     001 R1.10); structural exclusion: raw bodies/descriptions never enter the plan —
 *     content rides `descriptionContentHash` plus machine labels. ZERO tracker mutations,
 *     ZERO repository writes (constitution I) — outside the injected `StateStore`
 *     (stage 7) the pipeline touches only `listIssues`/`listAttachments`/
 *     `discoverMetadata`.
 *  7. Persist — `persistPlan` (`plans/<planId>.json`) + `writePlanReportArtifacts`
 *     (`reports/<runId>/report.json` + `report.md`, screener-passed, state directory
 *     only; `runId = deriveRunId(planId, clock, 0)` — deterministic under the injected
 *     clock, R13/R14).
 *
 * Mode observability (plan-level): the frozen `Plan` shape carries no mode/notes field,
 * so every entry's `reasons` OPENS with the machine label `mode:<bootstrap|sync>` (and a
 * disagreeing hint appends `ModeSelection.diagnosticReason` verbatim — sanitized, R2).
 * T018/T019/T027 authors: read mode from those labels.
 *
 * Title comparison (documented decision, flagged for T018 reconciliation): the seven US1
 * fixture worlds and their `expected/checkpoint-seed.json` baselines record the
 * UNDECORATED title ("Rotate the alpha report" — feature-prefix-free; world READMEs pin
 * "Titles are stable (no titleChanged)"), so `ClassificationInput.derivedTitle` receives
 * the 005 derivation's `baseTitle` (matched-template output / pass-through raw title,
 * i.e. `finalTitle` minus the non-configurable `<Feature_Name>: ` decoration). The
 * decoration is a tracker-presentation concern that `decorateFeaturePrefix` re-applies
 * idempotently and 005 `stripTitleForRender` removes for render-back; comparing the
 * decorated `finalTitle` against these checkpoints would mark EVERY task title-changed
 * and flip every control cell from `no-change` to `update`, contradicting every
 * `expected/plan.json`. The apply lane (T043) must therefore store the same undecorated
 * comparison title into `Checkpoint.title` (flagged in the T024 report).
 *
 * Unmatched tasks (create) and frozen tasks (skip-unresolved) sit OUTSIDE the
 * description-conflict machinery: their entries replace whatever description label
 * classification computed with `no-description-conflict` plus a channel marker
 * (`unmatched-create` / `frozen-unresolved-block`) — first-run-bootstrap `1.3` classifies
 * `both-changed` against the empty tracker side purely because no issue exists yet;
 * `expected/plan.json` records `descriptionConflict: null` + `create` there ("create
 * classification is outside the conflict machinery"), matching the matrix §5 pattern of
 * channels that never consult the conflict table.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ResolvedConfig } from "../config/schema.js";
import type { Checkpoint, ConflictResolutionMap } from "../domain/checkpoint.js";
import type { Match } from "../domain/match.js";
import type { Plan, PlanDecision, PlanTaskEntry, UnmappedIssue } from "../domain/plan.js";
import { derivePlanId } from "../domain/plan.js";
import type { RoutingResolution } from "../domain/routing.js";
import type { Task } from "../domain/task.js";
import type { BuildPlanOptions, EngineDependencies } from "../ports/engine.js";
import type {
  AttachmentView,
  IssueScope,
  IssueView,
  TeamMetadataCollections,
} from "../ports/linear-port.js";
import type { FrameworkId } from "../domain/task.js";
import {
  builtInAdapters,
  createAdapterRegistry,
  discoverTaskFiles,
  isBuiltInFrameworkId,
} from "../discovery/index.js";
import type { FrameworkAdapter } from "../discovery/index.js";
import { parseTaskFile } from "../parsing/index.js";
import type { TaskFileAdapter } from "../parsing/index.js";
import { resolveRouting } from "../routing/index.js";
import { deriveTitle } from "../titles/index.js";
import { adapterDerivedTitle } from "./derived-title.js";
import {
  DurableIdentityCollisionError,
  matchAllTasks,
  projectCandidates,
} from "../matching/index.js";
import type { MatchCandidate, TaskMatchInput } from "../matching/index.js";
import { EngineError, IntegrityError, DocumentIdentityCollisionError } from "./errors.js";
import { classifyTask, resolveConfiguredNormalizer } from "./classify.js";
import { readCheckpointStore, selectMode } from "./mode.js";
import type { ModeSelection } from "./mode.js";
import { assertBootstrapStateMapping } from "./state-validation.js";
import { appliedAction, resolveConflictAction } from "./actions.js";
import { desiredCompletionStateName, resolveLaneState, resolveWorkflowStateId } from "./completion.js";
import { loadMissionStatuses, missionDirectory } from "./status-load.js";
import type { MissionStatus } from "./status-load.js";
import { normalizedContentHash } from "./normalize.js";
import { resolveScreener } from "./options.js";
import type { DescriptionNormalizer, ResolvedEngineOptions } from "./options.js";
import {
  buildPlanReportJson,
  derivePlanReportRunId,
  persistPlan,
  renderPlanReportMarkdown,
  writePlanReportArtifacts,
} from "./report.js";
import type { PlanReportAssertion } from "./report.js";

/** One task with everything the later stages read — assembled in stages 1–2. */
interface TaskUnit {
  readonly task: Task;
  /** Repository-relative POSIX path (003 canonical key). */
  readonly filePath: string;
  /** Mirrored region: the task-section BODY below the task line (pinned decision 1). */
  readonly specSection: string;
  readonly routing: RoutingResolution;
  /** 005 comparison title — `baseTitle` (undecorated); see header decision note. */
  readonly derivedTitle: string;
}

/** Frozen IssueScope assembled from the merged config (007 FR-001 per-team filters). */
function buildIssueScope(deps: EngineDependencies): IssueScope {
  const teamKeys = Object.keys(deps.config.teams);
  const perTeam: Record<
    string,
    { readonly projects: readonly string[]; readonly ignoredStateTypes: readonly string[] }
  > = {};
  for (const teamKey of teamKeys) {
    const team = deps.config.teams[teamKey]!;
    perTeam[teamKey] = {
      projects: team.projects,
      // Frozen scope default; the merged config normally carries the team's own row.
      ignoredStateTypes: team.workflowStates.ignoredTypes ?? ["canceled", "duplicate"],
    };
  }
  return { teamKeys, perTeam, pageSize: deps.config.pageSize };
}

/** Exhaust the frozen `Page` cursor of `listAttachments` (read-only; stable order). */
async function fetchAllAttachments(
  deps: EngineDependencies,
  issueId: string,
): Promise<readonly AttachmentView[]> {
  const all: AttachmentView[] = [];
  let cursor: string | null = null;
  do {
    const page = await deps.port.listAttachments(issueId, cursor);
    all.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return all;
}

/** Stage-3 fetch: in-scope issues + per-issue attachments → 006 candidates. */
async function projectMatchCandidates(
  deps: EngineDependencies,
): Promise<{ issues: IssueView[]; candidates: MatchCandidate[] }> {
  const issues: IssueView[] = [];
  for await (const issue of deps.port.listIssues(buildIssueScope(deps))) {
    issues.push(issue);
  }
  const attachmentsByIssue: Record<string, readonly AttachmentView[]> = {};
  for (const issue of issues) {
    attachmentsByIssue[issue.id] = await fetchAllAttachments(deps, issue.id);
  }
  let candidates: MatchCandidate[];
  try {
    candidates = projectCandidates({ issues, attachmentsByIssue, config: deps.config });
  } catch (error) {
    // Constitution II: durable-identity collisions are hard integrity failures — 006's
    // projection abort re-surfaces as the 008-local taxonomy member (same taskUuid +
    // issueIds payload), never as a silently-adopted match or a foreign error type.
    if (error instanceof DurableIdentityCollisionError) {
      throw new IntegrityError(error.taskUuid, error.issueIds);
    }
    throw error;
  }
  return { issues, candidates };
}

/**
 * The mirrored task-section region: the BODY BELOW the task line (pinned cross-lane
 * decision 1 — never the task line itself, never the heading), extracted from the raw
 * file lines. `Task.taskBody.startLine` is the task's own 1-based line; the body runs
 * through `endLine` inclusive. A task whose extent is its own line mirrors as `""`.
 * Lines are joined with `\n`; the profile normalization (R5) erases terminator drift, so
 * the hash never depends on the file's EOL style (SC-002).
 */
function mirrorRegion(rawLines: readonly string[], task: Task): string {
  // 022 C6.2: a document task's mirror region IS its extent — `startLine..endLine`
  // INCLUSIVE (the leading heading line rides the mirror; front matter is outside the
  // extent, R11). Every other kind keeps the frozen cross-lane decision 1: the body
  // BELOW the task line (the task's own line never mirrors).
  const start = task.kind === "document" ? task.taskBody.startLine : task.taskBody.startLine + 1; // 1-based first mirrored line
  const end = task.taskBody.endLine; // inclusive
  if (start > end) return "";
  // 023 A-023-0/A-023-3 (C2.4): the document-kind slice is the hole-slice of its extent
  // — promoted subtask spans appear ONLY on the child issues. Every other kind and the
  // empty/absent-ranges case stay the contiguous slice byte-for-byte (FR-013).
  const promoted = task.taskBody.promotedRanges;
  if (task.kind === "document" && promoted !== undefined && promoted.length > 0) {
    const kept: string[] = [];
    for (let line = start; line <= end; line += 1) {
      if (!promoted.some(([from, to]) => line >= from && line <= to)) kept.push(rawLines[line - 1] ?? "");
    }
    return kept.join("\n");
  }
  return rawLines.slice(start - 1, end).join("\n");
}

/** Working order over parsed tasks: filePath asc, then lineNumber asc (FR-011 basis). */
function compareWorkingOrder(a: TaskUnit, b: TaskUnit): number {
  return a.filePath.localeCompare(b.filePath, "en") || a.task.lineNumber - b.task.lineNumber;
}

/** Transitive checklist/heading descendants of one task (task-tree lineage, cycle-safe). */
function descendantTasks(task: Task, byUuid: ReadonlyMap<string, Task>): Task[] {
  const out: Task[] = [];
  const seen = new Set<string>([task.stableUuid]);
  const queue = [...task.childUuids];
  while (queue.length > 0) {
    const uuid = queue.shift()!;
    if (seen.has(uuid)) continue;
    seen.add(uuid);
    const child = byUuid.get(uuid);
    if (child === undefined) continue;
    out.push(child);
    queue.push(...child.childUuids);
  }
  return out;
}

/**
 * `UnmappedIssue.parentMapped` — "true iff any descendant issue is mapped" (009 FR-007;
 * frozen schema). The port view carries no issue-hierarchy field, so the only derivable
 * lineage is the SPEC-side task tree: an unmapped issue U is `parentMapped` when some
 * task references U's issue key (`Task.issueRef`) and one of that task's descendant
 * tasks is mapped to an issue (that descendant's issue is U's derived descendant).
 * Deterministic; false whenever no task lineage claims the issue.
 */
function deriveParentMapped(
  issue: IssueView,
  tasks: readonly TaskUnit[],
  byUuid: ReadonlyMap<string, Task>,
  matchByTaskUuid: ReadonlyMap<string, Match>,
): boolean {
  for (const unit of tasks) {
    const issueRef = unit.task.issueRef;
    if (issueRef === undefined) continue;
    if (`${issueRef.key}-${issueRef.number}` !== issue.key) continue;
    if (descendantTasks(unit.task, byUuid).some((d) => matchByTaskUuid.has(d.stableUuid))) {
      return true;
    }
  }
  return false;
}

/** Shared inputs for entry assembly (stage 4–5 products, one per plan build). */
interface EntryContext {
  readonly config: ResolvedConfig;
  readonly mode: ModeSelection;
  /** The mode's ACTIVE merged conflict map (FR-004 defaults are the frozen chain base). */
  readonly conflictMap: ConflictResolutionMap;
  readonly checkpoints: Readonly<Record<string, Checkpoint>>;
  readonly normalizer: DescriptionNormalizer;
  readonly issueById: ReadonlyMap<string, IssueView>;
  readonly matchByTaskUuid: ReadonlyMap<string, Match>;
  readonly unmatchedTaskUuids: ReadonlySet<string>;
  readonly snapshot: ReadonlyArray<TeamMetadataCollections>;
  /** 023 C6: mission-directory → event-log posture (read ONLY during plan build; empty when no log). */
  readonly statusByMission: ReadonlyMap<string, MissionStatus>;
}

/** Entry assembly result: the frozen entry plus report-level side-channel assertions. */
interface EntryBuild {
  readonly entry: PlanTaskEntry;
  readonly assertions: readonly PlanReportAssertion[];
}

/**
 * Swap classification's description-conflict channel label for the null label. Used by
 * the two channels that sit OUTSIDE the conflict machinery (frozen §4, create): the plan
 * reports the description channel as clean and marks WHY (`frozen-unresolved-block` /
 * `unmatched-create` appended by the caller).
 */
function replaceDescriptionLabel(reasons: string[]): string[] {
  const index = reasons.findIndex((label) => label.startsWith("description-conflict:"));
  if (index === -1) return reasons;
  const next = [...reasons];
  next.splice(index, 1, "no-description-conflict");
  return next;
}

/**
 * Assemble one frozen `PlanTaskEntry` (stage 6) from the classification (stage 4), the
 * resolved action / completion mapping (stage 5), and the 006 match.
 *
 * Decision precedence (contract-fixed):
 *  1. `Task.unresolvedConflict` ⇒ `skip-unresolved` (matrix §4 freeze): NO action is
 *     resolved against the task, the description channel reports none, nothing is
 *     planned on either side (T019: zero planned file/issue mutation), and report.ts
 *     surfaces the entry exactly once via `unresolvedConflict: true`.
 *  2. `descriptionConflict` ⇒ `conflict` (R13: conflicts ride `decision:"conflict"`
 *     entries) — EXCEPT action `skip`, which matrix §2 records internally only ("NOT a
 *     report conflict entry") ⇒ the entry stays `no-change` and the
 *     `conflict:`/`action:skip`/`reason:` labels carry the record.
 *  3. `titleChanged` or a completion op (matched task) ⇒ `update`.
 *  4. Unmatched task ⇒ `create`; otherwise `no-change`.
 *
 * FR-005 reason labels (report-lane decision: the frozen report schema admits no
 * dedicated `conflictType` field): `conflict:<type>`, `action:<action>` (always the
 * MAP-READ action, including degraded `prefer-newer`), `degraded:true` (degradations
 * only), `reason:<resolved reason text>`. Completion success adds
 * `completion:state-name:<name>` + `completion:state-id:<id>`.
 *
 * Completion validation failure (documented ambiguity call): surfaced, never crashed —
 * `validation:completion-state` + `reason:<sanitized EngineError message>` labels,
 * `decision:"conflict"` so the report's conflicts section names the task for a human,
 * and a `completion-state-validation` FAIL security assertion; every other task plans
 * normally (R7: plan-time validation failure, sanitized, not a runtime surprise).
 */
function buildEntry(unit: TaskUnit, context: EntryContext): EntryBuild {
  const { task } = unit;
  const checkpoint = context.checkpoints[task.stableUuid];
  const match = context.matchByTaskUuid.get(task.stableUuid);
  const issue = match === undefined ? undefined : context.issueById.get(match.issueId);
  const matched = match !== undefined && issue !== undefined;
  const isCreate = !matched && context.unmatchedTaskUuids.has(task.stableUuid);

  const outcome = classifyTask({
    mode: context.mode.mode,
    task,
    derivedTitle: unit.derivedTitle,
    specSection: unit.specSection,
    issueDescription: issue?.description ?? "",
    ...(checkpoint !== undefined ? { checkpoint } : {}),
    normalizer: context.normalizer,
    ...(issue !== undefined ? { liveIssueStateType: issue.stateType } : {}),
  });

  const labels: string[] = [`mode:${outcome.mode}`, ...outcome.reasons];
  const changedFields: string[] = [];
  const expectedMarkdownChanges: string[] = [];
  const assertions: PlanReportAssertion[] = [];
  let decision: PlanDecision;
  let unresolvedConflict: boolean | undefined;

  if (outcome.unresolvedConflict) {
    // ── FR-007 / matrix §4 freeze — plan-side: nothing consulted, nothing planned. ──
    const replaced = replaceDescriptionLabel(labels);
    replaced.push("frozen-unresolved-block");
    labels.length = 0;
    labels.push(...replaced);
    decision = "skip-unresolved";
    unresolvedConflict = true;
  } else if (isCreate) {
    // Create sits outside the conflict machinery (first-run-bootstrap 1.3 expectation):
    // the both-sides-differ verdict against the absent tracker side is a classification
    // artifact of the empty mirror, not a plan conflict.
    const replaced = replaceDescriptionLabel(labels);
    replaced.push("unmatched-create");
    labels.length = 0;
    labels.push(...replaced);
    decision = "create";
  } else if (outcome.descriptionConflict !== null) {
    // ── Conflict path (R13): resolve against the mode's merged map with recency context. ──
    const resolved = resolveConflictAction(context.mode.mode, outcome.descriptionConflict, context.conflictMap, {
      ...(issue !== undefined ? { issueUpdatedAt: issue.updatedAt } : {}),
      ...(checkpoint !== undefined ? { checkpointIssueUpdatedAt: checkpoint.issueUpdatedAt } : {}),
    });
    const applied = appliedAction(task.stableUuid, outcome.descriptionConflict, resolved);
    labels.push(`conflict:${applied.conflictType}`, `action:${applied.action}`);
    if (applied.degraded) labels.push("degraded:true");
    labels.push(`reason:${applied.reason}`);
    if (applied.action === "skip") {
      // Matrix §2: `skip` is recorded internally only (journal/plan reasons) — NOT a
      // report conflict entry; the entry keeps the no-change decision.
      decision = "no-change";
    } else {
      decision = "conflict";
      changedFields.push("description");
      if (resolved.effect === "render-file") {
        // overwrite-spec: the section body becomes the R4 marker block (static summary —
        // raw sides never ride the plan; matrix §2).
        expectedMarkdownChanges.push(
          "task section body replaced by the git-style conflict-marker block embedding local then tracker content",
        );
      }
    }
  } else {
    // ── Drift path (no description conflict): completion + title channels. ──
    decision = matched && (outcome.titleChanged || outcome.checkedChanged) ? "update" : "no-change";
    if (outcome.titleChanged) {
      changedFields.push("title");
    }
    if (outcome.checkedChanged && matched) {
      // FR-006/R7 completion mapping — name via config, id via the discoverMetadata
      // snapshot captured at plan time (re-fetched pre-mutation by apply).
      try {
        const stateName = desiredCompletionStateName(
          context.config,
          unit.routing.teamKey,
          task.checked ?? false,
        );
        const stateId = resolveWorkflowStateId(context.snapshot, unit.routing.teamKey, stateName);
        labels.push(`completion:state-name:${stateName}`, `completion:state-id:${stateId}`);
        changedFields.push("state");
      } catch (error) {
        if (!(error instanceof EngineError)) throw error;
        labels.push("validation:completion-state", `reason:${error.message}`);
        decision = "conflict"; // surfaced for the human via the report conflicts section
        assertions.push({
          guarantee: "completion-state-validation",
          status: "fail",
          detail: error.message,
        });
      }
    }
  }

  // 023 C6.3 — lane-state drift BESIDE the completion path, evaluated only for level-1
  // document tasks (children derive no state; C6 keys on work-package ids only) and only
  // when the decision lanes above left a mutable cell (skip-unresolved/conflict stay
  // frozen). Authority: the mission's event log ONLY — status.json and front-matter lane
  // never reach this seam (they are never read). Unmapped lane ⇒ untouched +
  // `lane-state-unmapped`; mapped name unresolvable ⇒ the conflict posture of the
  // completion path; mapped-and-live-matches ⇒ idempotent no-change; creates carry the
  // mapped state (the label is the apply-side discriminator).
  if (
    task.kind === "document" &&
    task.parentUuid === undefined &&
    (decision === "create" || decision === "update" || decision === "no-change")
  ) {
    const mission = missionDirectory(task.filePath);
    const lane = mission === undefined ? undefined : context.statusByMission.get(mission)?.lanes.get(task.localTaskId ?? "");
    if (lane !== undefined) {
      try {
        const resolved = resolveLaneState(context.config, context.snapshot, unit.routing.teamKey, lane);
        if (resolved === null) {
          labels.push("lane-state-unmapped"); // never a silent guess (C6.2)
        } else if (isCreate) {
          labels.push(`lane:${lane}`); // the create carries the mapped state (C6.3)
        } else if (issue !== undefined && issue.stateType !== resolved.stateType) {
          labels.push(`lane:${lane}`);
          changedFields.push("state");
          if (decision === "no-change") decision = "update";
        }
        // mapped AND live state already matches ⇒ no drift, no label (idempotent, C6.2)
      } catch (error) {
        if (!(error instanceof EngineError)) throw error;
        labels.push("validation:lane-state", `reason:${error.message}`);
        decision = "conflict"; // surfaced for the human via the report conflicts section
        assertions.push({ guarantee: "lane-state-validation", status: "fail", detail: error.message });
      }
    }
  }

  if (context.mode.hintDisagreed && context.mode.diagnosticReason !== undefined) {
    labels.push(context.mode.diagnosticReason);
  }

  if (task.kind === "document" && unit.specSection === "") {
    // 022 C3.3/R11 — a front-matter-only document mirrors to visible empty content; the
    // entry-label channel carries the `no-content` label (no schema change, never a
    // silent drop). Pushed AFTER the branch lanes so create/frozen label resets keep it.
    labels.push("no-content");
  }

  const entry: PlanTaskEntry = {
    taskUuid: task.stableUuid,
    decision,
    frameworkId: task.frameworkId,
    ...(task.featureName !== undefined ? { featureName: task.featureName } : {}),
    filePath: unit.filePath,
    confidence: match?.confidence ?? "unmatched",
    score: match?.score ?? 0,
    margin: match?.margin ?? 0,
    reasons: labels,
    alternatives: match?.alternatives ?? [],
    changedFields,
    descriptionContentHash: normalizedContentHash(context.normalizer, unit.specSection),
    expectedMarkdownChanges,
    // Frozen gate rule 2 (engine-gates.md): `acceptLowConfidence === false` refuses when
    // ANY entry sits below `high` — the plan-time projection of that gate.
    lowConfidenceGateStatus: (match?.confidence ?? "unmatched") === "high" ? "passed" : "failed",
    ...(unresolvedConflict !== undefined ? { unresolvedConflict } : {}),
    routing: unit.routing,
    ...(match !== undefined ? { match } : {}),
  };
  return { entry, assertions };
}

/**
 * Build the plan over `o.repositoryRoot` with the advisory `o.mode` hint (reality wins —
 * research R2). Persists `StoredPlan` to `plans/<planId>.json` and the paired
 * `reports/<runId>/report.json` + `report.md` (state directory only; frozen
 * `plan-report.schema.json` conformance; screener-passed — research R13).
 * ZERO tracker mutations and ZERO repository writes end-to-end (constitution I; frozen
 * `SyncEngine` contract; T027 asserts the fake-port call log and repo bytes).
 */
export async function buildSyncPlan(
  deps: EngineDependencies,
  options: ResolvedEngineOptions,
  o: BuildPlanOptions,
): Promise<Plan> {
  const config = deps.config;
  const screener = resolveScreener(deps, options);

  // ── Stage 1: discover + parse (deterministic 003 order; bytes read exactly once). ──
  const discovery = await discoverTaskFiles({
    repositoryRoot: o.repositoryRoot,
    config,
    gitContext: true, // HEAD guard material; absence tolerated (001 R1.10)
  });
  const registry = createAdapterRegistry(config);
  const adapterById = new Map<string, FrameworkAdapter>(registry.enabledAdapters.map((a) => [a.id, a]));

  const units: TaskUnit[] = [];
  const fileHashes: Record<string, string> = {};
  for (const file of discovery.files) {
    const bytes = readFileSync(join(discovery.root, file.filePath));
    fileHashes[file.filePath] = createHash("sha256").update(bytes).digest("hex");
    const adapter = adapterById.get(file.adapterId) ??
      (Object.hasOwn(builtInAdapters, file.adapterId)
        ? builtInAdapters[file.adapterId as FrameworkId]
        : undefined);
    if (adapter === undefined) {
      throw new EngineError(
        `discovery selected adapter '${file.adapterId}' for '${file.filePath}' but the registry does not carry it — plan build aborted`,
      );
    }
    if (!isBuiltInFrameworkId(adapter.id)) {
      // Custom adapters (003 FR-011) arrive only through `DiscoveryOverrides`, which the
      // engine never carries; the frozen `TaskFile.frameworkId` union would not admit a
      // custom identity into the plan surface.
      throw new EngineError(
        `adapter '${adapter.id}' is not a built-in framework identity — custom adapters require discovery overrides the sync engine does not accept`,
      );
    }
    const content = bytes.toString("utf8");
    const rawLines = content.split(/\r\n|\r|\n/);
    const parseAdapter = adapter as TaskFileAdapter; // `id` narrowed to the frozen literal above
    const parsed = parseTaskFile(file.filePath, content, parseAdapter, config);
    const routing = resolveRouting(file.filePath, config);
    for (const task of parsed.file.tasks) {
      units.push({
        task,
        filePath: file.filePath,
        specSection: mirrorRegion(rawLines, task),
        routing,
        // Undecorated comparison title — header decision note; adapters carrying
        // `titleTagPattern` strip capability tags from it (017 C3.5, inert otherwise).
        derivedTitle: adapterDerivedTitle(deriveTitle(task, config).baseTitle, task, adapter, config),
      });
    }
  }
  units.sort(compareWorkingOrder);

  // ── 022 C2.4 / R8: repository-side durable-identity scan, after parse and BEFORE
  // matching. Two or more parsed tasks sharing one `Stable_UUID` (for document
  // identities: one mission, two documents, one normalized WP id) refuse plan build with
  // the deterministic finding — framework, mission, id, colliding paths byte-wise
  // ascending. No plan object exists, so no apply is reachable and no winner is guessed.
  {
    const unitsByUuid = new Map<string, TaskUnit[]>();
    for (const unit of units) {
      const bucket = unitsByUuid.get(unit.task.stableUuid);
      if (bucket === undefined) unitsByUuid.set(unit.task.stableUuid, [unit]);
      else bucket.push(unit);
    }
    for (const [uuid, bucket] of [...unitsByUuid.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      // Scoped to DOCUMENT-kind units (C2.4 is the document-identity rule): duplicate
      // ids among heading/checklist tasks stay on their pinned legacy warn-and-continue
      // lane (SC-005 — other identities' plan output is byte-identical).
      if (bucket.filter((unit) => unit.task.kind === "document").length < 2) continue;
      const first = bucket[0]!.task;
      throw new DocumentIdentityCollisionError(
        uuid,
        first.frameworkId,
        first.featureName ?? "",
        first.localTaskId ?? "",
        [...new Set(bucket.map((unit) => unit.filePath))],
      );
    }
  }

  // ── Stage 3: match (006 over the 007-fetched scope; integrity abort on collision). ──
  const { issues, candidates } = await projectMatchCandidates(deps);
  const taskInputs: TaskMatchInput[] = units.map((unit) => ({ task: unit.task, routing: unit.routing }));
  const matching = matchAllTasks(taskInputs, candidates, config);

  const issueById = new Map(issues.map((issue) => [issue.id, issue]));
  const matchByTaskUuid = new Map(matching.matches.map((m) => [m.taskUuid, m]));
  const unmatchedTaskUuids = new Set(matching.unresolved.map((u) => u.taskUuid));

  // Workflow snapshot for completion name→id resolution (data-model §6: captured at
  // plan time; apply re-fetches before mutation).
  const snapshot = await deps.port.discoverMetadata(Object.keys(config.teams));

  // ── Stage 4: mode (checkpoint reality wins over the hint) + checkpoint map. ──
  const storeFile = await readCheckpointStore(deps.state);
  const mode = selectMode(storeFile, o.mode);

  // ── 024 C4.1 (T014): bootstrap existence validation — ONLY in bootstrap mode, against
  // the stage-3 snapshot already fetched (C4.3: no extra Linear_Port calls). A mapped
  // name the team's live workflow does not offer (default or configured) refuses the run
  // HERE, before planning, reporting, journaling, or any mutation (C4.5); sync runs
  // never execute it (FR-011).
  if (mode.mode === "bootstrap") {
    assertBootstrapStateMapping(config, snapshot);
  }

  const conflictMap: ConflictResolutionMap =
    mode.mode === "bootstrap" ? config.bootstrapConflictMap : config.syncConflictMap;
  const normalizer = resolveConfiguredNormalizer(
    config.descriptionNormalizationProfile,
    options.normalizationProfiles,
  );

  // ── 023 C6.1/C6.3: mission status-event logs — read-only, plan-build-only, the SOLE
  // status authority. Only level-1 document units consult them (children derive no
  // state), and only adapters whose row ships a `statusEventFileName` (built-in
  // spec-kitty, A-023-1). A missing log is the empty posture, never an error.
  const statusByMission = new Map<string, MissionStatus>();
  const docIdsByMission = new Map<string, Set<string>>();
  {
    const taskPathsByFileName = new Map<string, Set<string>>();
    for (const unit of units) {
      const task = unit.task;
      if (task.kind !== "document" || task.parentUuid !== undefined) continue;
      const fileName = builtInAdapters[task.frameworkId].statusEventFileName;
      const mission = missionDirectory(unit.filePath);
      if (fileName === undefined || mission === undefined) continue;
      const paths = taskPathsByFileName.get(fileName) ?? new Set<string>();
      paths.add(unit.filePath);
      taskPathsByFileName.set(fileName, paths);
      const ids = docIdsByMission.get(mission) ?? new Set<string>();
      if (task.localTaskId !== undefined) ids.add(task.localTaskId);
      docIdsByMission.set(mission, ids);
    }
    for (const [fileName, paths] of [...taskPathsByFileName.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
      for (const [mission, status] of loadMissionStatuses(discovery.root, paths, fileName)) {
        statusByMission.set(mission, status);
      }
    }
  }

  // ── Stages 5–6: classify + resolve + assemble per task (working order). ──
  const context: EntryContext = {
    config,
    mode,
    conflictMap,
    checkpoints: storeFile.checkpoints,
    normalizer,
    issueById,
    matchByTaskUuid,
    unmatchedTaskUuids,
    snapshot,
    statusByMission,
  };
  const entries: PlanTaskEntry[] = [];
  const validationAssertions: PlanReportAssertion[] = [];
  // Findings ride the report's assertion channel (C6.3): malformed lines leave behind
  // only their COUNT — the bytes never reach plan or report — and unknown wp_ids are
  // named but ignored, nothing is conjured for them. Mission order is deterministic.
  for (const mission of [...statusByMission.keys()].sort()) {
    const status = statusByMission.get(mission)!;
    if (status.malformedCount > 0) {
      validationAssertions.push({
        guarantee: "status-event-log",
        status: "fail",
        detail:
          `${mission}: status-event log carries ${status.malformedCount} malformed line(s) — ` +
          `counted and skipped; their content never propagates (C6.3)`,
      });
    }
    const known = docIdsByMission.get(mission) ?? new Set<string>();
    const unknownIds = [...status.lanes.keys()].filter((id) => !known.has(id)).sort();
    if (unknownIds.length > 0) {
      validationAssertions.push({
        guarantee: "status-event-unknown-wp",
        status: "fail",
        detail:
          `${mission}: status-event log names work-package id(s) outside the mission's ` +
          `documents (${unknownIds.join(", ")}) — ignored, no task is conjured (C6.3)`,
      });
    }
  }
  const byUuid = new Map<string, Task>(units.map((unit) => [unit.task.stableUuid, unit.task]));
  for (const unit of units) {
    const built = buildEntry(unit, context);
    entries.push(built.entry);
    validationAssertions.push(...built.assertions);
  }

  // Unmapped issues — separate report section (009 FR-007); titles screened.
  const unmappedIssues: UnmappedIssue[] = matching.unmappedIssues.flatMap((issueId) => {
    const issue = issueById.get(issueId);
    if (issue === undefined) return [];
    return [
      {
        issueId: issue.id,
        teamKey: issue.teamKey,
        project: issue.projectId,
        title: screener.screen(issue.title).output,
        parentMapped: deriveParentMapped(issue, units, byUuid, matchByTaskUuid),
      },
    ];
  });

  const planWithoutId = {
    generatedAt: deps.clock.now().toISOString(),
    repositoryRoot: discovery.root,
    guards: {
      fileHashes,
      headCommit: discovery.git?.headCommit ?? null,
    },
    lowConfidencePresent: entries.some((entry) => entry.lowConfidenceGateStatus === "failed"),
    entries,
    unmappedIssues,
  };
  const plan: Plan = { planId: derivePlanId(planWithoutId), ...planWithoutId };

  // ── Stage 7: persist plan + paired reports (state directory ONLY; R13). ──
  await persistPlan(deps.state, plan);
  const runId = derivePlanReportRunId(plan.planId, deps.clock);
  const pipelineAssertions: PlanReportAssertion[] = [
    {
      guarantee: "zero-tracker-mutations",
      status: "pass",
      detail:
        "plan build invoked read-only port members only (listIssues, listAttachments, discoverMetadata); no create/update/archive/upsert calls (constitution I)",
    },
    {
      guarantee: "zero-repository-writes",
      status: "pass",
      detail:
        "no bytes were written to the repository tree; artifacts land only under the state directory (plans/, reports/)",
    },
    ...validationAssertions,
  ];
  const report = buildPlanReportJson(plan, { assertions: pipelineAssertions });
  const markdown = renderPlanReportMarkdown(report);
  await writePlanReportArtifacts(deps.state, runId, report, markdown, screener);

  return plan;
}
