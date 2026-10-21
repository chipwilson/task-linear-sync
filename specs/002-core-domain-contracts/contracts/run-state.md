# Contract: Run-State Lifecycle

Modules: `src/state/{paths,fs,lock,manifest,intent,marker,clock}.ts`. **Fully implemented by
this feature** for the lifecycle owned by 002 (placement, permissions, expiry rule, lock
rule, intent-before-attempt, reports + last-run marker); 008 exercises journaling/rollback
semantics over these primitives and 010 over the queue/last-run surface.

```ts
export interface StateStoreOptions {
  readonly repositoryRoot: string;       // canonicalized (realpath, symlinks resolved)
  readonly config: ResolvedConfig;
  readonly clock: Clock;                 // injected (R16)
}

export interface StateStore {
  /** Resolution (FR-001): configured stateDirectory verbatim; else platform default
   *  <base>/<toolId>/<hash16> with base per-platform (R6) and hash16 = first 16 hex of
   *  sha256(canonical repo root). ABORTS (StatePlacementError) if the resolved path is
   *  inside or equal to the repository root — never falls back to an in-tree location. */
  readonly root: string;
  readonly paths: {
    readonly lock: string;               // lock.json
    readonly syncState: string;          // sync-state.json (checkpoints; 008 read/write)
    readonly plans: string;              // plans/<planId>.json
    readonly manifests: string;          // manifests/<runId>.manifest.json
    readonly intents: string;            // intents/<intentId>.json
    readonly reports: string;            // reports/<runId>/{report.json,report.md}
    readonly lastRun: string;            // last-run.json
    readonly queue: string;              // pending-job.json (010 behavior)
  };
  /** mkdir 0o700 recursively; every state file via temp+rename chmod 0o600 (R7). */
  ensure(): Promise<void>;
  writeJson(rel: string, value: unknown): Promise<void>;   // atomic, owner-only
  readJson<T>(rel: string): Promise<T | null>;             // rejects non-object roots
}

// ── Advisory run lock (FR-003) ──────────────────────────────────────────────────
export interface RunLockRecord { readonly runId: string; readonly pid: number;
                                 readonly acquiredAt: string }
export type LockAcquisition =
  | { readonly acquired: true; readonly record: RunLockRecord; readonly tookOverStale: boolean }
  | { readonly acquired: false; readonly heldBy: RunLockRecord; readonly reason: "live-process" | "within-stale-window" };

/** Exclusive-create fast path; on EEXIST takeover ONLY when process.kill(pid,0) proves
 *  death (ESRCH; EPERM counts as alive) AND age > staleLockTakeoverSeconds (default 60).
 *  Compare-runId-before-unlink + retry exclusive create makes simultaneous contenders
 *  single-winner (edge case "lock race": loser reports and exits). */
export function acquireRunLock(s: StateStore, runId: string): Promise<LockAcquisition>;
export function releaseRunLock(s: StateStore, record: RunLockRecord): Promise<void>; // only own runId

// ── Audit manifest (FR-002; envelope + expiry) ─────────────────────────────────
export interface ManifestEnvelope { readonly schemaVersion: 1; readonly keyId: string;
  readonly iv: string; readonly tag: string; readonly ciphertext: string;   // all base64
  readonly createdAt: string }             // unencrypted header (R9): expiry without keys

/** Expiry: elapsed(clock.now, createdAt) > manifestExpiryDays (default 30) — evaluated
 *  regardless of encryption state. Expired => { valid: false } => rollback refuses. */
export function isManifestExpired(env: ManifestEnvelope | { createdAt: string },
                                  cfg: ResolvedConfig, clock: Clock): boolean;

export interface KeyProvider {            // injectable; env-var name or platform keystore
  getKey(keyId: string): Promise<Uint8Array | null>;   // null => abort, key unavailable
}
/** seal: AES-256-GCM over canonical JSON; key never stored with ciphertext; tag failure
 *  on open() rejects with ManifestTamperError and returns NO plaintext. Encryption off =>
 *  plain JSON manifest, still atomic + owner-only. */
export function sealManifest(m: unknown, cfg: ResolvedConfig, kp: KeyProvider,
                             clock: Clock): Promise<ManifestEnvelope>;
export function openManifest(env: ManifestEnvelope, cfg: ResolvedConfig,
                             kp: KeyProvider): Promise<unknown>;

// ── Create intent (FR-004) ──────────────────────────────────────────────────────
export type CreateIntentStatus = "pending" | "confirmed-created" | "indeterminate" | "reconciled";
export interface CreateIntent { readonly intentId: string; readonly runId: string;
  readonly taskUuid: string; readonly targetTeamKey: string; readonly targetProject: string;
  readonly status: CreateIntentStatus; readonly createdAt: string; readonly updatedAt: string }

/** Resolves only after the pending record's atomic rename completed — the caller may not
 *  attempt the create before this promise resolves (crash-window guarantee, R10). */
export function writeCreateIntentBeforeAttempt(s: StateStore, i: Omit<CreateIntent,
  "status" | "createdAt" | "updatedAt">): Promise<CreateIntent>;
export function updateCreateIntentStatus(s: StateStore, intentId: string,
  status: CreateIntentStatus): Promise<void>;
export function listIntentsByTask(s: StateStore, taskUuid: string): Promise<CreateIntent[]>;

// ── Reports + last-run marker (FR-005) ─────────────────────────────────────────
export interface LastRunMarker { readonly runId: string;
  readonly outcome: "completed" | "failed" | "aborted"; readonly completedAt: string;
  readonly reportPaths: { json: string; markdown: string } | null;
  readonly notificationSuppressed: boolean }

/** Writes the paired sanitized reports (SecurityScreener-serialized; the writer itself
 *  refuses values containing configured secret-keyed material) under reports/<runId>/ and
 *  atomically updates last-run.json referencing the completed run. Never writes inside the
 *  repository tree. */
export function writeRunReports(s: StateStore, runId: string,
  reports: { json: unknown; markdown: string }, screener: SecurityScreener,
  marker: Omit<LastRunMarker, "reportPaths" | "completedAt">): Promise<LastRunMarker>;
export function readLastRunMarker(s: StateStore): Promise<LastRunMarker | null>;
```

## Test obligations (mapped in quickstart)

- Placement across two repo fixtures (default + configured dirs): exact paths, hash naming,
  `0o700`/`0o600` permissions (POSIX), SC-003 zero in-tree files (asserted by walking the
  fixture repo after all state operations).
- Inside-repo configured `stateDirectory` and `stateDirectory === repoRoot` abort with
  `StatePlacementError` (edge case).
- Lock matrix: fresh acquire; contention (live pid → refuse); dead pid inside 60 s window →
  refuse; dead pid past window → takeover; EPERM probe → treated alive; two-process race →
  exactly one winner (SC-004).
- Expiry: aged manifest (injected clock) expired with encryption on **and** off (FR-002);
  tamper (bad tag) returns no plaintext; key-unavailable aborts without manifest I/O.
- Intent: resolved-promise implies record on disk (stat immediately after await proves it);
  status transitions indexed lookup works.
- Reports: sanitized pair written, marker updated referencing the run, no repo-tree writes.
