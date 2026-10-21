# Contract: Tracker Port (`Linear_Port`)

Module: `src/ports/linear-port.ts` — interface types only (no transport code in this
feature; 007 implements the real port and a behaviorally identical contract-tested fake).
Resilience, credential handling, and screening posture are constitution constraints the
port is consumed under — cited here, implemented in 007/engine layers.

```ts
export interface Page<T> { readonly items: readonly T[]; readonly nextCursor: string | null }

export interface IssueScope {
  readonly teamKeys: readonly string[];
  /** Per-team scoping never leaks: project/state filters are evaluated per team (007 FR-001). */
  readonly perTeam: Readonly<Record<string /* teamKey */, {
    readonly projects: readonly string[];        // configured project identities
    readonly ignoredStateTypes: readonly string[]; // default ["canceled","duplicate"]
  }>>;
  readonly pageSize: number;                      // default 100
}

export interface AttachmentMetadata { readonly [key: string]: string | number } // flat by rule

export interface AttachmentView {
  readonly id: string;
  readonly url: string;                 // canonical or continuation URL
  readonly title: string;
  readonly subtitle?: string;
  readonly metadata: AttachmentMetadata; // contains metadataNamespaceKey when tool-owned
}

export interface IssueView {
  readonly id: string; readonly key: string; readonly teamKey: string;
  readonly projectId: string; readonly title: string; readonly description: string;
  readonly stateType: string; readonly updatedAt: string; readonly archived: boolean;
}

export interface CreateIssueInput {
  readonly teamKey: string; readonly projectId: string; readonly title: string;
  readonly description: string; readonly stateType?: string;
  readonly parentId?: string;           // parent-before-child ordering owned by 008
}

export interface IssueUpdatePatch {  // partial field patch; snapshot re-fetch by 008 pre-mutation
  readonly title?: string; readonly description?: string; readonly stateTypeId?: string;
}

export interface LinearPort {
  /** Pagination until exhausted; inclusion = configured team AND configured project AND
   *  not ignored state type (007 FR-001). Yields complete pages; failure after retries
   *  surfaces with no partial-inventory consumption. */
  listIssues(scope: IssueScope): AsyncIterableIterator<IssueView>;

  /** Three collections per configured team (007 FR-002). */
  discoverMetadata(teamKeys: readonly string[]): Promise<ReadonlyArray<{
    readonly teamKey: string;
    readonly projects: ReadonlyArray<{ id: string; name: string }>;
    readonly workflowStates: ReadonlyArray<{ id: string; name: string; type: string }>;
  }>>;

  getIssue(id: string): Promise<IssueView | null>;          // 007 FR-003
  createIssue(i: CreateIssueInput): Promise<IssueView>;     // NEVER automatically retried
  updateIssue(id: string, p: IssueUpdatePatch): Promise<IssueView>;
  archiveIssue(id: string): Promise<void>;

  /** Identity strictly via attachment metadata — URL query or attachment scan;
   *  implementations MUST NOT search descriptions for identity (007 FR-004). */
  findIssuesByAttachmentUrl(attachmentUrl: string): Promise<IssueView[]>;

  /** Create-or-update by deterministic URL: updates in place, no duplicate, no attachment
   *  id stored anywhere by callers (007 FR-005). Returns the resulting attachment. */
  upsertAttachmentByUrl(input: {
    readonly issueId: string; readonly url: string;
    readonly title: string; readonly subtitle?: string; readonly iconUrl?: string;
    readonly metadata: AttachmentMetadata;
  }): Promise<AttachmentView>;

  updateAttachment(id: string, m: AttachmentMetadata): Promise<AttachmentView>;
  getAttachmentByUrl(url: string): Promise<AttachmentView | null>;
  listAttachments(issueId: string, cursor?: string | null): Promise<Page<AttachmentView>>;
  // Continuation pages are addressed purely by URL (scheme contract) — the chain walk
  // (page 0..n, stop at first absent index, report orphans) is 007 behavior over these ops.
}
```

Consumption invariants (enforced by 002's contract snapshot + 007's fake-vs-real contract
test):

1. The **only** route to the tracker (constitution V): 006/008/009/011/013 receive a
   `LinearPort` by injection; hermetic tests inject the fake — zero real requests (VI).
2. Non-create requests retry with backoff/jitter honoring `Retry-After`; `createIssue`
   never auto-retries (constitution Resilience) — the interface carries no retry knobs to
   tempt per-caller retries.
3. All transmitted text is pre-screened by the caller (engine); the port transmits what it
   is given. Credential values never enter this interface's types or errors.
