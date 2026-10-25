/**
 * T003 — 006-owned in-memory fake implementing the FROZEN `LinearPort`
 * (`task-linear-sync/ports`). Per research R8 this is a hermetic test stand-in:
 * 007 owns the production fake and the real port; 006 never imports `src/tracker`.
 *
 * - Read side (`listIssues`, `discoverMetadata`, `getIssue`, `getAttachmentByUrl`,
 *   `listAttachments`, `findIssuesByAttachmentUrl`) is backed by fixture data with
 *   deterministic ordering (issue ids ascending; attachment ids ascending; page
 *   cursors are index-based).
 * - Write side (`createIssue`, `updateIssue`, `archiveIssue`, `upsertAttachmentByUrl`,
 *   `updateAttachment`) is CALL-RECORDING so integration tests assert zero mutating
 *   calls on any 006-reachable path (constitution I posture; contracts/matching-api.md
 *   invariant 7).
 *
 * `implements LinearPort` is the compile-time conformance assertion against the frozen
 * interface (tests/integration/matching-fake.test.ts also asserts the typed shape).
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
} from "task-linear-sync/ports";

export interface FakeTrackerData {
  readonly issues?: readonly IssueView[];
  /** issueId → attachments (stored sorted by id ascending regardless of input order). */
  readonly attachmentsByIssue?: Readonly<Record<string, readonly AttachmentView[]>>;
}

export interface RecordedCall {
  readonly method: string;
  readonly args: readonly unknown[];
}

/** Write-side members per research R8 — presence of a call is a test failure. */
export const MUTATING_PORT_METHODS: readonly string[] = [
  "createIssue",
  "updateIssue",
  "archiveIssue",
  "upsertAttachmentByUrl",
  "updateAttachment",
];

const ATTACHMENT_PAGE_SIZE = 100;

const byId = <T extends { readonly id: string }>(items: readonly T[]): T[] =>
  [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export class MatchingLinearFake implements LinearPort {
  readonly calls: RecordedCall[] = [];

  private issues: IssueView[];
  private attachments = new Map<string, AttachmentView[]>();
  private sequence = 0;

  constructor(data: FakeTrackerData = {}) {
    this.issues = byId(data.issues ?? []);
    for (const [issueId, list] of Object.entries(data.attachmentsByIssue ?? {})) {
      this.attachments.set(issueId, byId(list));
    }
  }

  // ── call recording ────────────────────────────────────────────────────────────

  private record(method: string, args: readonly unknown[]): void {
    this.calls.push({ method, args });
  }

  callsTo(method: string): RecordedCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  mutatingCalls(): RecordedCall[] {
    return this.calls.filter((c) => MUTATING_PORT_METHODS.includes(c.method));
  }

  private nextId(prefix: string): string {
    this.sequence += 1;
    return `${prefix}-${String(this.sequence).padStart(4, "0")}`;
  }

  // ── read side (fixture-backed, deterministic) ─────────────────────────────────

  /** Complete scope-filtered inventory: team AND project AND not-ignored state (007 FR-001 mirror). */
  async *listIssues(scope: IssueScope): AsyncIterableIterator<IssueView> {
    this.record("listIssues", [scope]);
    const ignored = scope.perTeam;
    for (const issue of this.issues) {
      if (!scope.teamKeys.includes(issue.teamKey)) continue;
      const teamScope = ignored[issue.teamKey];
      if (!teamScope || !teamScope.projects.includes(issue.projectId)) continue;
      if (teamScope.ignoredStateTypes.includes(issue.stateType)) continue;
      yield issue;
    }
  }

  async discoverMetadata(teamKeys: readonly string[]): Promise<ReadonlyArray<TeamMetadataCollections>> {
    this.record("discoverMetadata", [teamKeys]);
    return [...teamKeys].sort().map((teamKey) => {
      const teamIssues = this.issues.filter((i) => i.teamKey === teamKey);
      const projects = [...new Set(teamIssues.map((i) => i.projectId))]
        .sort()
        .map((id) => ({ id, name: id }));
      const workflowStates = [...new Set(teamIssues.map((i) => i.stateType))]
        .sort()
        .map((type) => ({ id: `state-${type}`, name: type, type }));
      return { teamKey, projects, workflowStates };
    });
  }

  async getIssue(id: string): Promise<IssueView | null> {
    this.record("getIssue", [id]);
    return this.issues.find((i) => i.id === id) ?? null;
  }

  /** Identity strictly via attachment metadata URLs (frozen port rule); never descriptions. */
  async findIssuesByAttachmentUrl(attachmentUrl: string): Promise<IssueView[]> {
    this.record("findIssuesByAttachmentUrl", [attachmentUrl]);
    return this.issues.filter((issue) =>
      (this.attachments.get(issue.id) ?? []).some((a) => a.url === attachmentUrl),
    );
  }

  async getAttachmentByUrl(url: string): Promise<AttachmentView | null> {
    this.record("getAttachmentByUrl", [url]);
    for (const issue of this.issues) {
      const found = (this.attachments.get(issue.id) ?? []).find((a) => a.url === url);
      if (found) return found;
    }
    return null;
  }

  async listAttachments(issueId: string, cursor?: string | null): Promise<Page<AttachmentView>> {
    this.record("listAttachments", [issueId, cursor ?? null]);
    const list = this.attachments.get(issueId) ?? [];
    const start = cursor === undefined || cursor === null ? 0 : Number(cursor);
    const items = list.slice(start, start + ATTACHMENT_PAGE_SIZE);
    const end = start + items.length;
    return { items, nextCursor: end < list.length ? String(end) : null };
  }

  // ── write side (call-recording stand-ins; presence fails 006 tests) ───────────

  async createIssue(input: CreateIssueInput): Promise<IssueView> {
    this.record("createIssue", [input]);
    const issue: IssueView = {
      id: this.nextId("fake-issue"),
      key: `NEW-${1000 + this.sequence}`,
      teamKey: input.teamKey,
      projectId: input.projectId,
      title: input.title,
      description: input.description,
      stateType: input.stateType ?? "todo",
      updatedAt: "2026-01-01T00:00:00.000Z",
      archived: false,
    };
    this.issues = byId([...this.issues, issue]);
    return issue;
  }

  async updateIssue(id: string, patch: IssueUpdatePatch): Promise<IssueView> {
    this.record("updateIssue", [id, patch]);
    const index = this.issues.findIndex((i) => i.id === id);
    if (index < 0) throw new Error(`fake port: unknown issue '${id}'`);
    const current = this.issues[index]!;
    const updated: IssueView = {
      ...current,
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.stateTypeId !== undefined ? { stateType: patch.stateTypeId } : {}),
    };
    this.issues = [...this.issues];
    this.issues[index] = updated;
    return updated;
  }

  async archiveIssue(id: string): Promise<void> {
    this.record("archiveIssue", [id]);
    const index = this.issues.findIndex((i) => i.id === id);
    if (index < 0) throw new Error(`fake port: unknown issue '${id}'`);
    this.issues = [...this.issues];
    this.issues[index] = { ...this.issues[index]!, archived: true };
  }

  async upsertAttachmentByUrl(input: {
    readonly issueId: string;
    readonly url: string;
    readonly title: string;
    readonly subtitle?: string;
    readonly iconUrl?: string;
    readonly metadata: AttachmentMetadata;
  }): Promise<AttachmentView> {
    this.record("upsertAttachmentByUrl", [input]);
    const list = this.attachments.get(input.issueId) ?? [];
    const index = list.findIndex((a) => a.url === input.url);
    const view: AttachmentView = {
      ...(index >= 0 ? list[index]! : { id: this.nextId("fake-attachment") }),
      url: input.url,
      title: input.title,
      ...(input.subtitle !== undefined ? { subtitle: input.subtitle } : {}),
      metadata: input.metadata,
    };
    const next = index >= 0 ? list.map((a, i) => (i === index ? view : a)) : [...list, view];
    this.attachments.set(input.issueId, byId(next));
    return view;
  }

  async updateAttachment(id: string, metadata: AttachmentMetadata): Promise<AttachmentView> {
    this.record("updateAttachment", [id, metadata]);
    for (const [issueId, list] of this.attachments) {
      const index = list.findIndex((a) => a.id === id);
      if (index >= 0) {
        const updated: AttachmentView = { ...list[index]!, metadata };
        const next = [...list];
        next[index] = updated;
        this.attachments.set(issueId, next);
        return updated;
      }
    }
    throw new Error(`fake port: unknown attachment '${id}'`);
  }
}

/** Convenience factory typed against the frozen port (compile-time conformance). */
export function makeMatchingLinearFake(data: FakeTrackerData = {}): MatchingLinearFake {
  return new MatchingLinearFake(data);
}

/** Frozen-interface conformance pin (research R8): fails typecheck if 007-era drift lands. */
export const FAKE_PORT_CONFORMS: LinearPort = makeMatchingLinearFake();
