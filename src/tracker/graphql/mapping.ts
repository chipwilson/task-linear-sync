/**
 * Response → view mapping (research R10; data-model.md §10 — a mapping over the FROZEN 002
 * view types, which are imported and never reshaped). Also holds the per-instance identity
 * resolution cache: configured team keys and project identities resolve to platform ids via
 * discovery results ("empty → warm(per-team)"; a fresh port instance rediscovers). Unknown
 * identities throw TrackerConfigError naming team + identity — pre-dispatch, never silent.
 */
import type { AttachmentMetadata, AttachmentView, IssueView, TeamMetadataCollections } from "../../ports/linear-port.js";
import { TrackerConfigError } from "../errors.js";

// ── Defensive JSON accessors (no codegen typing per R1; fixtures/recorded data are `unknown`) ──

type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : null;
}

export function asList(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Connection or plain list → nodes array (`{ nodes: [...] }` or a bare array). */
function nodesOf(value: unknown): readonly unknown[] {
  const rec = asRecord(value);
  if (rec && "nodes" in rec) return asList(rec["nodes"]);
  return asList(value);
}

export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * Frozen `IssueView` ← platform Issue node: `key` ← `identifier`, `teamKey` ← `team.key`,
 * `stateType` ← `state.type`, `archived` ← `archivedAt != null`, null project → `""`
 * (documented §10 choice). Description is DATA — carried, never matched against.
 */
export function mapIssueNode(node: unknown): IssueView {
  const n = asRecord(node);
  const project = asRecord(n?.["project"]);
  const archivedAt = n?.["archivedAt"];
  return {
    id: str(n?.["id"]),
    key: str(n?.["identifier"]),
    teamKey: str(asRecord(n?.["team"])?.["key"]),
    projectId: project ? str(project["id"]) : "",
    title: str(n?.["title"]),
    description: str(n?.["description"]),
    stateType: str(asRecord(n?.["state"])?.["type"]),
    updatedAt: str(n?.["updatedAt"]),
    archived: archivedAt !== null && archivedAt !== undefined,
  };
}

export function mapIssueNodes(nodes: readonly unknown[]): IssueView[] {
  return nodes.map(mapIssueNode);
}

/** Flat metadata map passthrough (frozen "flat by rule"); non-object defaults to {}. */
export function mapMetadata(value: unknown): AttachmentMetadata {
  return (asRecord(value) ?? {}) as unknown as AttachmentMetadata;
}

export function mapAttachmentNode(node: unknown): AttachmentView {
  const n = asRecord(node);
  const view = {
    id: str(n?.["id"]),
    url: str(n?.["url"]),
    title: str(n?.["title"]),
    ...(n?.["subtitle"] !== undefined && n?.["subtitle"] !== null ? { subtitle: str(n["subtitle"]) } : {}),
    metadata: mapMetadata(n?.["metadata"]),
  };
  return view;
}

/**
 * Team node → frozen `TeamMetadataCollections` PLUS the platform teamId (kept 007-internal
 * for the create path's `teamKey → teamId` resolution; the frozen shape itself is unchanged).
 */
export interface TeamDiscoveryRecord extends TeamMetadataCollections {
  readonly teamId: string;
}

export function mapTeamNodeFull(node: unknown): TeamDiscoveryRecord {
  const n = asRecord(node);
  return {
    teamId: str(n?.["id"]),
    teamKey: str(n?.["key"]),
    projects: nodesOf(n?.["projects"]).map((p) => ({ id: str(asRecord(p)?.["id"]), name: str(asRecord(p)?.["name"]) })),
    workflowStates: nodesOf(n?.["states"]).map((s) => ({
      id: str(asRecord(s)?.["id"]),
      name: str(asRecord(s)?.["name"]),
      type: str(asRecord(s)?.["type"]),
    })),
  };
}

/** GraphQL envelope helpers (the request site maps envelope failures; R12). */
export function graphQlErrorMessages(body: unknown): readonly string[] {
  const errors = asRecord(body)?.["errors"];
  if (!Array.isArray(errors)) return [];
  return errors.map((e) => {
    const msg = asRecord(e)?.["message"];
    return typeof msg === "string" && msg !== "" ? msg : "unknown platform error";
  });
}

export function envelopeData(body: unknown): JsonRecord {
  return asRecord(asRecord(body)?.["data"]) ?? {};
}

/** Mutation payload `userError` text (empty when success or absent). */
export function payloadUserError(payload: unknown): string {
  const p = asRecord(payload);
  if (!p) return "";
  if (p["success"] !== false) return "";
  const ue = p["userError"];
  return typeof ue === "string" && ue !== "" ? ue : "platform rejected the mutation";
}

// ── Identifier resolution cache (R10) ───────────────────────────────────────────

/**
 * Per-port-instance cache of discovered team metadata. Lifetime: the port instance — no
 * expiry policy by design (fresh instance = fresh discovery; re-fetch discipline is the
 * engine's job, 008).
 */
export class DiscoveryCache {
  private readonly teams = new Map<string, TeamDiscoveryRecord>();

  warm(records: readonly TeamDiscoveryRecord[]): void {
    for (const record of records) this.teams.set(record.teamKey, record);
  }

  has(teamKey: string): boolean {
    return this.teams.has(teamKey);
  }

  get(teamKey: string): TeamDiscoveryRecord | undefined {
    return this.teams.get(teamKey);
  }

  requireTeam(teamKey: string): TeamDiscoveryRecord {
    const record = this.teams.get(teamKey);
    if (!record) {
      throw new TrackerConfigError(`team '${teamKey}' was not resolved by discovery — unknown team identity`);
    }
    return record;
  }

  /** teamKey → platform team id (create path; issueCreate requires a team id). */
  resolveTeamId(teamKey: string): string {
    return this.requireTeam(teamKey).teamId;
  }

  /**
   * Configured project identity → platform project id. An identity may be the platform id or
   * the project name. Unknown identity ⇒ TrackerConfigError naming team + identity (pre-
   * dispatch — "so it is not indeterminate", tracker-adapter.md create row).
   */
  resolveProjectId(teamKey: string, identity: string): string {
    const team = this.requireTeam(teamKey);
    for (const project of team.projects) {
      if (project.id === identity || project.name === identity) return project.id;
    }
    throw new TrackerConfigError(
      `project identity '${identity}' for team '${teamKey}' was not resolved by discovery — unknown project identity`,
    );
  }

  resolveProjectIds(teamKey: string, identities: readonly string[]): readonly string[] {
    return identities.map((identity) => this.resolveProjectId(teamKey, identity));
  }
}

/** Exported so consumers/tests can reuse the same nodes-of helper. */
export { nodesOf };
