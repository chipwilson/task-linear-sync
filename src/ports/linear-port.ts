/**
 * Tracker port (`Linear_Port`) — interface types ONLY; no transport code in this feature
 * (007 implements the real port and a behaviorally identical contract-tested fake).
 * The port is the ONLY route to the issue tracker (constitution V). Resilience, credential
 * handling, and screening posture are constitution constraints the port is consumed under.
 * Mirror: contracts/tracker-port.md.
 */

export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: string | null;
}

export interface IssueScope {
  readonly teamKeys: readonly string[];
  /** Per-team scoping never leaks: project/state filters are evaluated per team (007 FR-001). */
  readonly perTeam: Readonly<
    Record<
      string /* teamKey */,
      {
        /** Configured project identities. */
        readonly projects: readonly string[];
        /** default ["canceled","duplicate"] */
        readonly ignoredStateTypes: readonly string[];
      }
    >
  >;
  /** default 100 */
  readonly pageSize: number;
}

/** Flat by rule: metadata values are strings/numbers only. */
export interface AttachmentMetadata {
  readonly [key: string]: string | number;
}

export interface AttachmentView {
  readonly id: string;
  /** Canonical or continuation URL (scheme contract). */
  readonly url: string;
  readonly title: string;
  readonly subtitle?: string;
  /** Contains metadataNamespaceKey when tool-owned. */
  readonly metadata: AttachmentMetadata;
}

export interface IssueView {
  readonly id: string;
  readonly key: string;
  readonly teamKey: string;
  readonly projectId: string;
  readonly title: string;
  readonly description: string;
  readonly stateType: string;
  /** ISO-8601. */
  readonly updatedAt: string;
  readonly archived: boolean;
}

export interface CreateIssueInput {
  readonly teamKey: string;
  readonly projectId: string;
  readonly title: string;
  readonly description: string;
  readonly stateType?: string;
  /** Parent-before-child ordering owned by 008. */
  readonly parentId?: string;
}

/** Partial field patch; snapshot re-fetch by 008 pre-mutation. */
export interface IssueUpdatePatch {
  readonly title?: string;
  readonly description?: string;
  readonly stateTypeId?: string;
}

export interface TeamMetadataCollections {
  readonly teamKey: string;
  readonly projects: ReadonlyArray<{ readonly id: string; readonly name: string }>;
  readonly workflowStates: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly type: string;
  }>;
}

/**
 * Consumption invariants (frozen):
 * 1. The only route to the tracker (constitution V): 006/008/009/011/013 receive a
 *    LinearPort by injection; hermetic tests inject the fake — zero real requests (VI).
 * 2. Non-create requests retry with backoff/jitter honoring Retry-After; createIssue
 *    NEVER automatically retries (constitution Resilience) — the interface carries no
 *    retry knobs to tempt per-caller retries.
 * 3. All transmitted text is pre-screened by the caller (engine); the port transmits what
 *    it is given. Credential values never enter this interface's types or errors.
 */
export interface LinearPort {
  /**
   * Pagination until exhausted; inclusion = configured team AND configured project AND not
   * ignored state type (007 FR-001). Yields complete pages; failure after retries surfaces
   * with no partial-inventory consumption.
   */
  listIssues(scope: IssueScope): AsyncIterableIterator<IssueView>;

  /** Three collections per configured team (007 FR-002). */
  discoverMetadata(teamKeys: readonly string[]): Promise<ReadonlyArray<TeamMetadataCollections>>;

  /** 007 FR-003. */
  getIssue(id: string): Promise<IssueView | null>;

  /** NEVER automatically retried — a failed create is indeterminate, not replayed. */
  createIssue(i: CreateIssueInput): Promise<IssueView>;

  updateIssue(id: string, p: IssueUpdatePatch): Promise<IssueView>;
  archiveIssue(id: string): Promise<void>;

  /**
   * Identity strictly via attachment metadata — URL query or attachment scan;
   * implementations MUST NOT search descriptions for identity (007 FR-004).
   */
  findIssuesByAttachmentUrl(attachmentUrl: string): Promise<IssueView[]>;

  /**
   * Create-or-update by deterministic URL: updates in place, no duplicate, no attachment id
   * stored anywhere by callers (007 FR-005). Returns the resulting attachment.
   */
  upsertAttachmentByUrl(input: {
    readonly issueId: string;
    readonly url: string;
    readonly title: string;
    readonly subtitle?: string;
    readonly iconUrl?: string;
    readonly metadata: AttachmentMetadata;
  }): Promise<AttachmentView>;

  updateAttachment(id: string, m: AttachmentMetadata): Promise<AttachmentView>;
  getAttachmentByUrl(url: string): Promise<AttachmentView | null>;
  listAttachments(issueId: string, cursor?: string | null): Promise<Page<AttachmentView>>;
  // Continuation pages are addressed purely by URL (scheme contract) — the chain walk
  // (page 0..n, stop at first absent index, report orphans) is 007 behavior over these ops.
}
