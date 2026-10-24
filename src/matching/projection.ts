/**
 * T013 — candidate projection (contracts/candidate-projection.md rules 1–6, research R5).
 * Turns ALREADY-FETCHED frozen tracker views (`IssueView` + `AttachmentView[]` per issue,
 * 007-populated in production; fixtures/fakes in tests) into `MatchCandidate`s.
 * "Candidate issues arrive already scoped by the tracker port (007); matching never
 * fetches" (spec Assumption) — this module performs zero port calls, zero I/O.
 *
 * Identity is read strictly from the page-0 canonical attachment payload:
 * frozen `parseAttachmentUrl` (`task-linear-sync/urls`) must return `kind: "canonical"`
 * AND `metadata[metadataNamespaceKey]` must parse via frozen `parseSyncStatePayload`
 * (`task-linear-sync/domain`) into a payload whose `taskUuid` is a valid identity.
 * Never the description, never an in-file marker, never another metadata key
 * (constitution II; 001 R5 c11).
 */
import type { FrameworkId } from "task-linear-sync/domain";
import { parseSyncStatePayload } from "task-linear-sync/domain";
import { parseAttachmentUrl } from "task-linear-sync/urls";
import type { AttachmentView } from "task-linear-sync/ports";
import { checkMatchingConfig } from "./config-check.js";
import type { MatchCandidate, ProjectCandidatesInput } from "./types.js";

/** Identity-shape guard mirroring the frozen URL scheme's UUID constraint. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const byIdAsc = <T extends { readonly id: string }>(a: T, b: T): number =>
  a.id < b.id ? -1 : a.id > b.id ? 1 : 0;

interface AttachmentContext {
  /** Qualifying task UUIDs on this issue (sorted, distinct) — feeds the integrity scan. */
  readonly qualifyingUuids: readonly string[];
  readonly durableTaskUuid?: string;
  readonly frameworkId?: FrameworkId;
  readonly featureName?: string;
  readonly filePath?: string;
  readonly localTaskId?: string;
}

/** Rule 1 + rule 2 + rule 3: strict page-0-canonical identity/context extraction. */
function extractContext(
  attachments: readonly AttachmentView[],
  input: ProjectCandidatesInput,
): AttachmentContext {
  const qualifying: string[] = [];
  let durableTaskUuid: string | undefined;
  let frameworkId: FrameworkId | undefined;
  let featureName: string | undefined;
  let filePath: string | undefined;
  let localTaskId: string | undefined;
  let anchored = false;

  // Deterministic attachment order regardless of provider list order (rule 6 spirit).
  for (const attachment of [...attachments].sort(byIdAsc)) {
    const parsed = parseAttachmentUrl(input.config, attachment.url);
    if (parsed === null || parsed.kind !== "canonical") continue; // continuation/foreign: history-only
    const raw = attachment.metadata[input.config.metadataNamespaceKey];
    if (typeof raw !== "string") continue;
    let taskUuid: unknown;
    let frameworkMetadata: Record<string, unknown> | undefined;
    try {
      const payload = parseSyncStatePayload(raw);
      taskUuid = payload.taskUuid;
      frameworkMetadata = payload.frameworkMetadata as unknown as Record<string, unknown> | undefined;
    } catch {
      continue; // malformed payload ⇒ ignored for identity; "never partially trusted"
    }
    if (typeof taskUuid !== "string" || !UUID_RE.test(taskUuid)) continue; // invalid identity shape
    if (!qualifying.includes(taskUuid)) qualifying.push(taskUuid);
    if (!anchored) {
      anchored = true;
      durableTaskUuid = taskUuid;
      if (frameworkMetadata !== undefined && frameworkMetadata !== null) {
        const fm = frameworkMetadata;
        if (typeof fm["frameworkId"] === "string") frameworkId = fm["frameworkId"] as FrameworkId;
        if (typeof fm["featureName"] === "string") featureName = fm["featureName"];
        if (typeof fm["filePath"] === "string") filePath = fm["filePath"];
        if (typeof fm["localTaskId"] === "string") localTaskId = fm["localTaskId"];
      }
    }
  }
  if (qualifying.length > 0) qualifying.sort();
  return {
    qualifyingUuids: qualifying,
    ...(durableTaskUuid !== undefined ? { durableTaskUuid } : {}),
    ...(frameworkId !== undefined ? { frameworkId } : {}),
    ...(featureName !== undefined ? { featureName } : {}),
    ...(filePath !== undefined ? { filePath } : {}),
    ...(localTaskId !== undefined ? { localTaskId } : {}),
  };
}

/**
 * INTEGRITY EXTENSION POINT (T013 stub — wired for real in US2/T033 per
 * contracts/candidate-projection.md §Integrity): duplicate durable task UUIDs across
 * issues (case a) or contradictory anchors on one issue (case b, visible through
 * `qualifyingUuidsByIssue`) MUST throw `DurableIdentityCollisionError` before any
 * scoring, so the abort "cannot be sidestepped by configuration".
 *
 * Kept as a documented no-op at the foundation checkpoint so the module boundary is
 * final while US2 owns the abort behavior (tasks.md T013/T033 sequential handoff).
 */
function scanDurableCollisions(
  _candidates: readonly MatchCandidate[],
  _qualifyingUuidsByIssue: ReadonlyMap<string, readonly string[]>,
): void {
  // T033 (US2) implements the constitution-II hard abort.
}

/**
 * Project fetched tracker views into candidates (contracts/matching-api.md):
 * output sorted by `issueId` ascending — deterministic; pure — zero port calls.
 */
export function projectCandidates(input: ProjectCandidatesInput): MatchCandidate[] {
  checkMatchingConfig(input.config); // "run at the entry of every public 006 function" (R9)

  const candidates: MatchCandidate[] = [];
  const qualifyingUuidsByIssue = new Map<string, readonly string[]>();

  for (const issue of [...input.issues].sort(byIdAsc)) {
    const attachments = input.attachmentsByIssue[issue.id] ?? [];
    const ctx = extractContext(attachments, input);
    const candidate: MatchCandidate = {
      issueId: issue.id,
      issueKey: issue.key,
      teamKey: issue.teamKey,
      projectRef: issue.projectId,
      title: issue.title,
      ...(ctx.durableTaskUuid !== undefined ? { durableTaskUuid: ctx.durableTaskUuid } : {}),
      ...(ctx.frameworkId !== undefined ? { frameworkId: ctx.frameworkId } : {}),
      ...(ctx.featureName !== undefined ? { featureName: ctx.featureName } : {}),
      ...(ctx.filePath !== undefined ? { filePath: ctx.filePath } : {}),
      ...(ctx.localTaskId !== undefined ? { localTaskId: ctx.localTaskId } : {}),
    };
    candidates.push(candidate); // iteration order = issueId ascending ⇒ output sorted
    if (ctx.qualifyingUuids.length > 0) qualifyingUuidsByIssue.set(issue.id, ctx.qualifyingUuids);
  }

  scanDurableCollisions(candidates, qualifyingUuidsByIssue);
  return candidates;
}
