/**
 * T020 — the complete in-memory fake `Linear_Port` (contracts/tracker-testing.md §1;
 * data-model.md §9). This is the constitution-mandated test substrate for the whole system
 * (Principle VI): every frozen member is implemented with behaviorally identical semantics to
 * the real adapter — the SAME pure scoping guard (`scoping.issueInScope`, shared not
 * re-implemented), the SAME R12 error taxonomy via `scriptFailure`, URL-idempotent upsert, and
 * opaque `c:<index>` cursors. Zero transport, zero network, zero credentials.
 *
 * Parity request-log semantics: every underlying request-equivalent (each page fetch, each
 * failed attempt) is appended to `requests()` with the GraphQL operation name the real client
 * would issue, so the conformance suite counts identically on both bindings.
 */
import type {
  AttachmentMetadata,
  AttachmentView,
  CreateIssueInput,
  IssueScope,
  IssueUpdatePatch,
  IssueView,
  LinearPort,
  Page,
  TeamMetadataCollections,
} from "../../ports/linear-port.js";
import { IndeterminateCreateError, TrackerConfigError, TrackerError, type TrackerErrorCategory } from "../errors.js";
import { issueInScope } from "../scoping.js";

/**
 * Synthetic UUID scheme (fixture corpus convention — tests/fixtures/tracker/README.md):
 * `ac000000-0000-4000-8000-` + the decimal index zero-padded to 12 hex-valid digits.
 */
export function syntheticUuid(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError(`synthetic uuid index must be a non-negative integer: ${index}`);
  }
  return `ac000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

/** Deterministic fault injection (data-model §9 `scriptFailures`). */
export interface FailureScript {
  /** 1-based count of this member's underlying request-equivalents; fires exactly once. */
  readonly atCall: number;
  readonly kind: "http-429-retryAfter" | "http-5xx" | "network" | "graphql-userError";
  /** Recorded-pair annotation (a success pair follows the failure pair); fake consumes once either way. */
  readonly then?: "succeed";
}

export interface FakeTeamSeed {
  readonly key: string;
  readonly id: string;
  readonly projects: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly workflowStates: ReadonlyArray<{ readonly id: string; readonly name: string; readonly type: string }>;
}

export interface FakeIssueSeed {
  readonly id: string;
  readonly key: string;
  readonly teamKey: string;
  readonly projectId: string;
  readonly title: string;
  readonly description: string;
  readonly stateType: string;
  readonly updatedAt: string;
  readonly archived?: boolean;
}

export interface FakeAttachmentSeed {
  readonly issueId: string;
  readonly id: string;
  readonly url: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly metadata: Record<string, string | number>;
}

/** world.json twin (data-model §8/§9) — placeholder identities, synthetic UUIDs only. */
export interface FakeWorldSeed {
  readonly teams: readonly FakeTeamSeed[];
  readonly issues: readonly FakeIssueSeed[];
  readonly attachments?: readonly FakeAttachmentSeed[];
  readonly scriptedFailures?: Readonly<Record<string, FailureScript | readonly FailureScript[]>>;
  /** listAttachments page size (default 250). */
  readonly pageSize?: number;
  /** Retry budget behind scripted failures (default 5 — the frozen config default). */
  readonly maxRetries?: number;
}

export interface FakeTeamRecord {
  readonly id: string;
  readonly projects: Array<{ id: string; name: string }>;
  readonly workflowStates: Array<{ id: string; name: string; type: string }>;
}

export interface FakeAttachmentRecord {
  readonly id: string;
  readonly issueId: string;
  url: string;
  title: string;
  subtitle?: string;
  metadata: Record<string, string | number>;
}

/** Inspectable/mutable in-memory world (data-model §9 structures). */
export interface FakeWorld {
  readonly issues: Map<string, IssueView>;
  readonly attachments: Map<string, FakeAttachmentRecord>;
  /** url → carrier issue ids (>1 = the caller's constitution-II integrity signal). */
  readonly byUrl: Map<string, Set<string>>;
  /** issueId → ordered attachment ids (cursor pages slice the live list). */
  readonly perIssue: Map<string, string[]>;
  readonly teams: Map<string, FakeTeamRecord>;
  readonly scriptFailures: Map<string, Array<{ readonly script: FailureScript; fired: boolean }>>;
  pageSize: number;
  maxRetries: number;
}

/** One underlying request-equivalent (attempt-level): parity counts vs the recorded transport. */
export interface FakeRequestLog {
  readonly op: string;
  readonly ok: boolean;
  readonly vars: Record<string, unknown>;
}

export interface FakeLinearPort extends LinearPort {
  readonly world: FakeWorld;
  scriptFailure(method: keyof LinearPort, script: FailureScript): void;
  /** Port-level call proofs (request-count mechanism, SC-001). */
  readonly callLog: ReadonlyArray<{ method: string; args: unknown[] }>;
  /** Attempt-level request-equivalents with GraphQL operation names. */
  requests(): readonly FakeRequestLog[];
}

/** Method → the GraphQL operation name the real client would issue (parity `requests().op`). */
const OP_FOR_METHOD: Readonly<Record<string, string>> = {
  listIssues: "issues",
  discoverMetadata: "teamMetadata",
  getIssue: "issue",
  createIssue: "issueCreate",
  updateIssue: "issueUpdate",
  archiveIssue: "issueArchive",
  findIssuesByAttachmentUrl: "attachmentsForURL",
  upsertAttachmentByUrl: "attachmentCreate",
  updateAttachment: "attachmentUpdate",
  getAttachmentByUrl: "attachmentsForURL",
  listAttachments: "issueAttachments",
};

const FAILURE_SHAPES: Readonly<Record<FailureScript["kind"], { category: TrackerErrorCategory; retryable: boolean }>> = {
  "http-429-retryAfter": { category: "rate-limit", retryable: true },
  "http-5xx": { category: "server", retryable: true },
  network: { category: "network", retryable: true },
  "graphql-userError": { category: "graphql", retryable: false },
};

function teamAbbrev(teamKey: string): string {
  const head = teamKey.split(/[^a-zA-Z0-9]/)[0] ?? "ISS";
  return (head.slice(0, 3).toUpperCase() || "ISS");
}

/**
 * The complete fake. `seed` is the world.json twin; absent ⇒ empty world (all members still
 * respond — unknown teams/issues surface as the same config/not-found taxonomy the real port
 * produces).
 */
export function createFakeLinearPort(seed?: FakeWorldSeed): FakeLinearPort {
  const world: FakeWorld = {
    issues: new Map(),
    attachments: new Map(),
    byUrl: new Map(),
    perIssue: new Map(),
    teams: new Map(),
    scriptFailures: new Map(),
    pageSize: seed?.pageSize ?? 250,
    maxRetries: seed?.maxRetries ?? 5,
  };
  for (const team of seed?.teams ?? []) {
    world.teams.set(team.key, {
      id: team.id,
      projects: team.projects.map((p) => ({ ...p })),
      workflowStates: team.workflowStates.map((s) => ({ ...s })),
    });
  }
  for (const issue of seed?.issues ?? []) {
    world.issues.set(issue.id, {
      id: issue.id,
      key: issue.key,
      teamKey: issue.teamKey,
      projectId: issue.projectId,
      title: issue.title,
      description: issue.description,
      stateType: issue.stateType,
      updatedAt: issue.updatedAt,
      archived: issue.archived ?? false,
    });
  }
  for (const attachment of seed?.attachments ?? []) {
    const record: FakeAttachmentRecord = {
      id: attachment.id,
      issueId: attachment.issueId,
      url: attachment.url,
      title: attachment.title,
      ...(attachment.subtitle !== undefined ? { subtitle: attachment.subtitle } : {}),
      metadata: { ...attachment.metadata },
    };
    world.attachments.set(record.id, record);
    (world.byUrl.get(record.url) ?? seedSet(world, record.url)).add(record.issueId);
    (world.perIssue.get(record.issueId) ?? seedList(world, record.issueId)).push(record.id);
  }
  for (const [method, scripts] of Object.entries(seed?.scriptedFailures ?? {})) {
    const list = Array.isArray(scripts) ? scripts : [scripts as FailureScript];
    for (const script of list) {
      const bucket = world.scriptFailures.get(method) ?? [];
      bucket.push({ script, fired: false });
      world.scriptFailures.set(method, bucket);
    }
  }

  const callLog: Array<{ method: string; args: unknown[] }> = [];
  const requests: FakeRequestLog[] = [];
  const counters = new Map<string, number>();
  const warmed = new Set<string>();
  let created = 0;
  let newAttachments = 0;
  let timestampTick = 0;

  function seedSet(w: FakeWorld, url: string): Set<string> {
    const set = new Set<string>();
    w.byUrl.set(url, set);
    return set;
  }
  function seedList(w: FakeWorld, issueId: string): string[] {
    const list: string[] = [];
    w.perIssue.set(issueId, list);
    return list;
  }
  function logRequest(op: string, vars: Record<string, unknown>, ok: boolean): void {
    requests.push({ op, ok, vars });
  }
  function notFound(what: string): TrackerError {
    return new TrackerError({ category: "not-found", retryable: false, attempts: 1, detail: `fake world: no ${what}` });
  }
  function attView(record: FakeAttachmentRecord): AttachmentView {
    return {
      id: record.id,
      url: record.url,
      title: record.title,
      ...(record.subtitle !== undefined ? { subtitle: record.subtitle } : {}),
      metadata: { ...record.metadata },
    };
  }
  function requireTeam(teamKey: string): FakeTeamRecord {
    const team = world.teams.get(teamKey);
    if (!team) {
      throw new TrackerConfigError(`team '${teamKey}' was not found in the fake world — unknown team identity`);
    }
    return team;
  }
  function resolveStateType(teamKey: string, stateTypeId: string): string {
    const states = world.teams.get(teamKey)?.workflowStates ?? [];
    const match = states.find((s) => s.id === stateTypeId || s.type === stateTypeId);
    return match ? match.type : stateTypeId;
  }
  function nextTimestamp(): string {
    timestampTick += 1;
    return new Date(Date.UTC(2026, 0, 1) + timestampTick * 1000).toISOString();
  }

  /** Consume a scripted failure at the call count; failures map to the identical R12 shapes. */
  function maybeFail(method: keyof LinearPort, vars: Record<string, unknown>): void {
    const count = (counters.get(method) ?? 0) + 1;
    counters.set(method, count);
    const entry = world.scriptFailures.get(method)?.find((e) => !e.fired && e.script.atCall === count);
    if (!entry) return;
    entry.fired = true;
    const kind = entry.script.kind;
    const shape = FAILURE_SHAPES[kind];
    const attempts = shape.retryable && method !== "createIssue" ? world.maxRetries + 1 : 1;
    for (let i = 0; i < attempts; i++) logRequest(OP_FOR_METHOD[method] ?? method, vars, false);
    const detail = `fake world: scripted '${kind}' for ${method} at call ${count}`;
    if (method === "createIssue" && shape.retryable) {
      throw new IndeterminateCreateError({ detail });
    }
    throw new TrackerError({ category: shape.category, retryable: shape.retryable, attempts, detail });
  }

  async function* iterateIssues(scope: IssueScope): AsyncGenerator<IssueView> {
    const size = Math.max(1, Math.floor(scope.pageSize) || 1);
    // R10 warm (request-equivalent batched discovery — parity with the real listIssues warm).
    const missing = scope.teamKeys.filter((key) => !warmed.has(key));
    if (missing.length > 0) {
      logRequest("teamMetadata", { teamKeys: [...missing] }, true);
      const unknown = missing.filter((key) => !world.teams.has(key));
      if (unknown.length > 0) {
        throw new TrackerConfigError(`team '${unknown[0]}' was not found in the fake world — unknown team identity`);
      }
      for (const key of missing) warmed.add(key);
    }
    for (const teamKey of scope.teamKeys) {
      const entry = scope.perTeam[teamKey];
      if (!entry) {
        throw new TrackerConfigError(
          `IssueScope.perTeam has no entry for team '${teamKey}' — per-team filters never leak, so every team needs its own`,
        );
      }
      const team = requireTeam(teamKey);
      const projectIds = entry.projects.map((identity) => {
        const project = team.projects.find((p) => p.id === identity || p.name === identity);
        if (!project) {
          throw new TrackerConfigError(
            `project identity '${identity}' for team '${teamKey}' was not resolved in the fake world — unknown project identity`,
          );
        }
        return project.id;
      });
      const projectIdSet = new Set(projectIds);
      const ignoredSet = new Set(entry.ignoredStateTypes);
      // "Server-side" set = team AND project; the ignored-STATE leg is the client-side shared
      // R6 guard below (belt-and-braces: every row is re-checked, a violating row never leaks).
      const rows: IssueView[] = [];
      for (const view of world.issues.values()) {
        if (view.teamKey === teamKey && projectIdSet.has(view.projectId)) rows.push(view);
      }
      let offset = 0;
      for (;;) {
        const after = offset === 0 ? null : `c:${offset}`;
        const vars: Record<string, unknown> = {
          teamKey,
          projectIds,
          ignoredStateTypes: [...entry.ignoredStateTypes],
          first: size,
          after,
        };
        maybeFail("listIssues", vars);
        logRequest("issues", vars, true);
        for (const row of rows.slice(offset, offset + size)) {
          if (issueInScope(row, teamKey, projectIdSet, ignoredSet)) yield row;
        }
        offset += size;
        if (offset >= rows.length) break;
      }
    }
  }

  async function discoverMetadataImpl(teamKeys: readonly string[]): Promise<ReadonlyArray<TeamMetadataCollections>> {
    callLog.push({ method: "discoverMetadata", args: [teamKeys] });
    maybeFail("discoverMetadata", { teamKeys: [...teamKeys] });
    for (const key of teamKeys) requireTeam(key);
    logRequest("teamMetadata", { teamKeys: [...teamKeys] }, true);
    return teamKeys.map((key) => {
      const team = requireTeam(key);
      return {
        teamKey: key,
        projects: team.projects.map((p) => ({ ...p })),
        workflowStates: team.workflowStates.map((s) => ({ ...s })),
      } satisfies TeamMetadataCollections;
    });
  }

  async function getIssueImpl(id: string): Promise<IssueView | null> {
    callLog.push({ method: "getIssue", args: [id] });
    maybeFail("getIssue", { id });
    logRequest("issue", { id }, true);
    const view = world.issues.get(id);
    return view ? { ...view } : null;
  }

  async function createIssueImpl(input: CreateIssueInput): Promise<IssueView> {
    callLog.push({ method: "createIssue", args: [input] });
    const team = requireTeam(input.teamKey);
    const project = team.projects.find((p) => p.id === input.projectId || p.name === input.projectId);
    if (!project) {
      throw new TrackerConfigError(
        `project identity '${input.projectId}' for team '${input.teamKey}' was not resolved in the fake world — unknown project identity`,
      );
    }
    maybeFail("createIssue", { teamKey: input.teamKey, projectId: project.id, title: input.title });
    created += 1;
    const view: IssueView = {
      id: syntheticUuid(1000 + created),
      key: `${teamAbbrev(input.teamKey)}-${1000 + created}`,
      teamKey: input.teamKey,
      projectId: project.id,
      title: input.title,
      description: input.description,
      stateType: input.stateType ?? team.workflowStates[0]?.type ?? "unstarted",
      updatedAt: nextTimestamp(),
      archived: false,
    };
    world.issues.set(view.id, view);
    logRequest("issueCreate", { teamKey: input.teamKey, projectId: project.id, title: input.title }, true);
    return { ...view };
  }

  async function updateIssueImpl(id: string, patch: IssueUpdatePatch): Promise<IssueView> {
    callLog.push({ method: "updateIssue", args: [id, patch] });
    maybeFail("updateIssue", { id, ...patch });
    const current = world.issues.get(id);
    if (!current) throw notFound(`issue '${id}'`);
    const next: IssueView = {
      ...current,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.stateTypeId !== undefined ? { stateType: resolveStateType(current.teamKey, patch.stateTypeId) } : {}),
    };
    world.issues.set(id, next);
    logRequest("issueUpdate", { id }, true);
    return { ...next };
  }

  async function archiveIssueImpl(id: string): Promise<void> {
    callLog.push({ method: "archiveIssue", args: [id] });
    maybeFail("archiveIssue", { id });
    const current = world.issues.get(id);
    if (!current) throw notFound(`issue '${id}'`);
    world.issues.set(id, { ...current, archived: true });
    logRequest("issueArchive", { id }, true);
  }

  async function findIssuesByAttachmentUrlImpl(url: string): Promise<IssueView[]> {
    callLog.push({ method: "findIssuesByAttachmentUrl", args: [url] });
    maybeFail("findIssuesByAttachmentUrl", { url });
    logRequest("attachmentsForURL", { url }, true);
    const carriers: IssueView[] = [];
    for (const view of world.issues.values()) {
      if (world.byUrl.get(url)?.has(view.id) === true) carriers.push({ ...view });
    }
    return carriers;
  }

  async function upsertAttachmentByUrlImpl(input: {
    readonly issueId: string;
    readonly url: string;
    readonly title: string;
    readonly subtitle?: string;
    readonly iconUrl?: string;
    readonly metadata: AttachmentMetadata;
  }): Promise<AttachmentView> {
    callLog.push({ method: "upsertAttachmentByUrl", args: [input] });
    maybeFail("upsertAttachmentByUrl", { issueId: input.issueId, url: input.url });
    if (!world.issues.has(input.issueId)) throw notFound(`issue '${input.issueId}'`);
    // One request-equivalent per upsert call — platform URL idempotency IS the create-or-update
    // semantic (R7): no read-before-write, the "create" updates the existing row in place.
    logRequest("attachmentCreate", { issueId: input.issueId, url: input.url, title: input.title }, true);
    const hostList = world.perIssue.get(input.issueId) ?? seedList(world, input.issueId);
    const existingId = hostList.find((attId) => world.attachments.get(attId)?.url === input.url);
    if (existingId !== undefined) {
      const record = world.attachments.get(existingId)!;
      record.title = input.title;
      if (input.subtitle !== undefined) record.subtitle = input.subtitle;
      record.metadata = { ...input.metadata };
      return attView(record);
    }
    newAttachments += 1;
    const record: FakeAttachmentRecord = {
      id: `att-fake-${newAttachments}`,
      issueId: input.issueId,
      url: input.url,
      title: input.title,
      ...(input.subtitle !== undefined ? { subtitle: input.subtitle } : {}),
      metadata: { ...input.metadata },
    };
    world.attachments.set(record.id, record);
    hostList.push(record.id);
    (world.byUrl.get(record.url) ?? seedSet(world, record.url)).add(record.issueId);
    return attView(record);
  }

  async function updateAttachmentImpl(id: string, metadata: AttachmentMetadata): Promise<AttachmentView> {
    callLog.push({ method: "updateAttachment", args: [id, metadata] });
    maybeFail("updateAttachment", { id });
    const record = world.attachments.get(id);
    if (!record) throw notFound(`attachment '${id}'`);
    record.metadata = { ...metadata };
    logRequest("attachmentUpdate", { id }, true);
    return attView(record);
  }

  async function getAttachmentByUrlImpl(url: string): Promise<AttachmentView | null> {
    callLog.push({ method: "getAttachmentByUrl", args: [url] });
    maybeFail("getAttachmentByUrl", { url });
    logRequest("attachmentsForURL", { url }, true);
    for (const record of world.attachments.values()) {
      if (record.url === url) return attView(record);
    }
    return null;
  }

  async function listAttachmentsImpl(issueId: string, cursor?: string | null): Promise<Page<AttachmentView>> {
    callLog.push({
      method: "listAttachments",
      args: cursor === undefined || cursor === null ? [issueId] : [issueId, cursor],
    });
    const after = cursor ?? null;
    maybeFail("listAttachments", { issueId, first: world.pageSize, after });
    if (!world.issues.has(issueId)) throw notFound(`issue '${issueId}'`);
    let offset = 0;
    if (after !== null) {
      const match = /^c:(\d+)$/.exec(after);
      if (!match) {
        throw new TrackerConfigError(`fake world: cursor must look like 'c:<index>' — got '${after}'`);
      }
      offset = Number(match[1]);
    }
    const size = world.pageSize;
    const ids = world.perIssue.get(issueId) ?? [];
    const items = ids.slice(offset, offset + size).map((id) => attView(world.attachments.get(id)!));
    logRequest("issueAttachments", { issueId, first: size, after }, true);
    return { items, nextCursor: offset + size < ids.length ? `c:${offset + size}` : null };
  }

  return {
    listIssues: (scope: IssueScope) => {
      callLog.push({ method: "listIssues", args: [scope] });
      return iterateIssues(scope);
    },
    discoverMetadata: discoverMetadataImpl,
    getIssue: getIssueImpl,
    createIssue: createIssueImpl,
    updateIssue: updateIssueImpl,
    archiveIssue: archiveIssueImpl,
    findIssuesByAttachmentUrl: findIssuesByAttachmentUrlImpl,
    upsertAttachmentByUrl: upsertAttachmentByUrlImpl,
    updateAttachment: updateAttachmentImpl,
    getAttachmentByUrl: getAttachmentByUrlImpl,
    listAttachments: listAttachmentsImpl,
    world,
    scriptFailure(method: keyof LinearPort, script: FailureScript): void {
      const bucket = world.scriptFailures.get(method) ?? [];
      bucket.push({ script, fired: false });
      world.scriptFailures.set(method, bucket);
    },
    callLog,
    requests: () => [...requests],
  };
}
