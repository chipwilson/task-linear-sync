# Phase 1 Data Model: Core Domain Contracts, Configuration, and Run State

**Feature**: `002-core-domain-contracts` | **Date**: 2026-10-21

Canonical entity shapes frozen for all features (001 § Key Entities, refined only by
additive amendment). Field tables list the frozen fields; "owner" marks which feature owns
*behavior* over the entity — 002 always owns the *shape*. TypeScript signatures are in
`src/domain`, `src/config`, `src/state` (see plan.md); this document is the readable mirror.

Relationship overview:

```
TaskFile 1 ──── * Task ──── 0..1 Match ──── 1 Issue (tracker-side, via Linear_Port)
  │                 │
  │                 ├── * (children via nesting)  Task
  │                 ├── 1 Checkpoint (local, sync-state.json)
  │                 └── 1 AttachmentChain ── 1 SyncAttachment(page 0) + * Continuation(page 1..)
  │                                              └── 1 SyncStatePayload ── * SyncHistoryEvent
Task ──* RoutingEntry (resolution result: {teamKey, project})
Plan 1 ──── * PlanTaskEntry ──── 1 Task      Plan 1 ──── 1 PlanGuards
Plan → ReportArtifacts (JSON + Markdown, paired, sanitized)
Run 1 ──── 1 RunLock, 0..1 AuditManifest, * CreateIntent, 1 LastRunMarker, 2 ReportArtifacts
Config (merged) configures everything above; HookDefinition/PendingJob/SyncHistoryPage
are surface-side records shaped here and behaved by 010/011.
```

## 1. Task

Stable positional identity, line-accurate location, nesting, and sync-relevant state of one
actionable unit. (Owner of derivation/computation: 004; shape frozen here.)

| Field | Type | Rules |
|---|---|---|
| `stableUuid` | `string` (8-4-4-4-12 lowercase) | Deterministic v5-shaped UUID per research R11; **never** derived from title, checkbox state, or visible issue prefix |
| `kind` | `"heading" \| "checklist"` | |
| `filePath` | `string` | Repository-relative POSIX path of the TaskFile |
| `lineNumber` | `integer ≥ 1` | 1-based line position |
| `frameworkId` | `FrameworkId` = `"bmad" \| "spec-kit" \| "open-spec" \| "kiro" \| "generic"` | |
| `featureName` | `string \| undefined` | Adapter-derived; absent when underivable |
| `localTaskId` | `string \| undefined` | Parsed identifier (e.g. `Task 1.2`, `T001`) when grammar matched |
| `phase` | `string \| undefined` | Text of most recent phase-pattern heading |
| `title` | `string` | Raw title as parsed (pre-derivation) |
| `checked` | `boolean \| undefined` | Present iff `kind = "checklist"` |
| `parentUuid` | `string \| undefined` | Nearest enclosing checklist/heading task (indent-stack result) |
| `childUuids` | `string[]` | Ordered nested checklist children |
| `issueRef` | `{ key: string; number: integer ≥ 1 } \| undefined` | Visible `[<KEY>-<N>]` reference where `key` equals the configured Confirmation_Key |
| `taskBody` | `TaskBodyExtent` | `{ startLine, endLine }` inclusive range of the mirrored section (line + all Markdown down to next task or sibling-or-shallower heading) |
| `unresolvedConflict` | `boolean` | `true` iff `taskBody` region contains Conflict_Markers |

Validation: `kind = "heading"` ⇔ `checked` absent; `childUuids` entries reference tasks in
the same `filePath`; `unresolvedConflict = true` freezes the task for reconciliation (008).

## 2. TaskFile

| Field | Type | Rules |
|---|---|---|
| `filePath` | `string` | Repo-relative POSIX; sorted deterministically within results |
| `frameworkId` | `FrameworkId` | Selected by adapter detection (003) |
| `featureName` | `string \| undefined` | |
| `siblingDocuments` | `string[]` | Repo-relative paths of existing configured sibling spec docs; absent siblings omitted without error |
| `tasks` | `Task[]` | In file order (ascending `lineNumber`) |

## 3. Framework Adapter (interface)

Per-framework convention bundle; 003 implements, 004 consumes the *interface* only.

| Member | Contract |
|---|---|
| `id` | `FrameworkId` |
| `taskFilePatterns` | basename glob/pattern list |
| `detect(taskFilePath, repoCtx)` | adapter-selection predicate |
| `featureName(taskFilePath)` | derived or `undefined` |
| `headingGrammar`, `phasePattern`, `summaryPattern`, `rollupPattern` | overridable regex sources |
| `titleBehavior` | hook into 005 derivation |
| `agentHooksDirectory?` | framework-specific default |

## 4. Routing Entry / Workspace Identity

| Field | Type | Rules |
|---|---|---|
| `ProjectByPath` entry | `{ prefix: string; teamKey: string; project: string }` | Both `teamKey` and `project` required (project-only shape unsupported); longest-character-length match wins; deterministic first-by-map-order tie-break |
| `defaultTeamKey` / `defaultProject` | `string` | Consumer-required; unmatched paths fall back; both-absent ⇒ task left unassigned with indication |
| team identity | `teamKey → { projects: string[], workflowStates: { done, backlog, … , completedTypes, ignoredTypes } }` | Consumer-required, no defaults |

Validation (at config init, FR-007): every required identity present and non-empty;
each `ProjectByPath` entry complete. Full-listing abort.

## 5. Match

One-to-one task↔issue assignment (computed by 006; shape frozen here).

| Field | Type | Rules |
|---|---|---|
| `taskUuid`, `issueId` | `string` | One-to-one enforced globally by 006's assignment solver |
| `score` | `integer ≥ 0` | Unbounded weighted sum (weights in config) |
| `margin` | `integer ≥ 0` | Score distance to nearest competitor |
| `confidence` | `"high" \| "medium" \| "low" \| "unmatched"` | Band per config floors; margin-downgrade rule with durable-identity bypass |
| `durableIdentity` | `boolean` | `true` ⇒ bypass team/project/framework gating and margin downgrade |
| `reasons` | `string[]` | Machine-readable signal labels |
| `alternatives` | `Alternative[]` (≤ 3) | Descending score, deterministic tie-break, each with `mapped`/`unmapped` status |

Integrity rule (constitution II): >1 issue carrying the same task UUID ⇒ hard integrity
failure, run aborts with zero changes.

## 6. Checkpoint

Local per-task record in `sync-state.json` inside the state directory (read/write behavior
008; shape frozen).

| Field | Type | Rules |
|---|---|---|
| `taskUuid` | `string` | Key |
| `checked` | `boolean \| undefined` | Last known |
| `title` | `string` | Last known derived title |
| `issueUpdatedAt` | `ISO-8601` | Tracker-side update time at last sync |
| `issueStateType` | `string` | Workflow state type at last sync |
| `descriptionContentHash` | `sha256 hex` | Hash of mirrored description at last sync |
| `issueId` | `string` | Paired issue |

## 7. Conflict Resolution Map

`mode → (DescriptionConflictType → ConflictAction)` where `mode ∈ { bootstrap, sync }`,
`DescriptionConflictType ∈ { "linear-changed", "spec-changed", "both-changed" }`, and
`ConflictAction ∈ { "overwrite-linear", "overwrite-spec", "report-only", "skip",
"prefer-newer", "fail" }`. Independently configured per mode. Built-in defaults (from
001 R17.4, overridable): bootstrap — all three → `overwrite-linear`; sync — `spec-changed`
→ `overwrite-linear`, `linear-changed` → `overwrite-spec`, `both-changed` → `report-only`.

## 8. Sync State Payload & Attachment Chain

`SyncStatePayload` — serialized (compact, stable key order) into the single string value
under `metadataNamespaceKey` in the page-0 attachment's `Attachment_Metadata`:

| Field | Type | Rules |
|---|---|---|
| `taskUuid` | `string` | Durable identity anchor (sole matching anchor, page 0 only) |
| `frameworkMetadata` | `{ frameworkId, featureName?, filePath, localTaskId? }` | |
| `descriptionContentHash` | `sha256 hex` | Mirrored content |
| `cursors` | `{ lastSyncAt: ISO-8601, … }` | Timestamps/cursors as applicable |
| `history` | `SyncHistoryEvent[]` | Append-only page of the `Sync_History_Log` |

`SyncHistoryEvent`: `{ kind: "discovered" | "issue-created" | "matched" | "title-updated" |
"description-updated" | "checkbox-changed" | "conflict-detected" | "rollback", at: ISO-8601,
description: screened string, references?: string[] }` — immutable once appended; rollback
appends rather than rewinds (Principle IV).

`AttachmentChain`: page 0 = canonical `Sync_Attachment` at
`<base-host>/<toolId>/<task-uuid>`; pages 1..n = continuation attachments at
`<base-host>/<toolId>/<task-uuid>/<pageN>`; rollover at `historyLogMaxEntries` (default 50)
or configured size threshold; metadata values are strings/numbers only; namespace key
defaults `__<toolId>` and must avoid Linear reserved keys (`title`, `messages`,
`attributes`).

## 9. Plan, Plan Guards, and Plan Reference

| Field | Type | Rules |
|---|---|---|
| `planId` | `sha256 hex` | Over canonicalized plan JSON (R13); doubles as `Plan_Reference` value |
| `generatedAt` | ISO-8601 | Injected clock |
| `guards` | `{ headCommit: string \| null; fileHashes: Record<repoRelPath, sha256> }` | Captured at plan build; plan build performs zero mutations/writes |
| `entries` | `PlanTaskEntry[]` | Sorted deterministically |
| `unmappedIssues` | `UnmappedIssue[]` | Separate section in reports |
| `lowConfidencePresent` | `boolean` | Drives the accept-low-confidence gate |

`PlanTaskEntry` (field set fixed by 009 FR-006): decision, frameworkId, featureName,
filePath, confidence, score, margin, reasons, ≤3 alternatives, changedFields,
`descriptionContentHash`, `expectedMarkdownChanges`, `lowConfidenceGateStatus`
(`"passed" | "failed"`). **No raw task body or issue description field exists in the
schema** (structural exclusion; see `contracts/plan-report.schema.json`).

`Plan_Reference` validity (frozen predicate): stored plan whose `planId` matches exists AND
every `guards.fileHashes` entry matches current file content AND `guards.headCommit`
matches current HEAD. Re-evaluated at apply start by 008; referenced by 012's apply tool.

## 10. Audit Manifest (+ envelope)

| Field | Type | Rules |
|---|---|---|
| `runId` | `string` | |
| `createdAt` | ISO-8601 | Drives expiry; **duplicated in unencrypted envelope header** (R9) |
| `repoRoot`, `planId` | `string` | Context |
| `fileBackups` | `{ path, beforeContentHash, beforeContent }[]` | Rollback material |
| `checkpointBefore` | `Checkpoint[]` snapshot | |
| `operations` | `AuditOperation[]` | One per planned op incl. attachment upserts (target issue, URL, prior metadata) |
| `stepState` | per-step `pending \| applied \| rolled-back \| conflict-halted` | Resumability guard (008) |

Envelope (encryption on): `{ schemaVersion: 1, keyId, iv, tag, ciphertext }` — AES-256-GCM;
key from configured env-var name or key-store provider, never stored with ciphertext;
tag-check failure rejects with no plaintext. Expiry: elapsed since `createdAt` >
`manifestExpiryDays` (default 30) ⇒ expired **regardless of encryption** (FR-002); expired
⇒ rollback unavailable. Manifest disabled ⇒ no journal ⇒ rollback refuses (gate
`MANIFEST_UNJOURNALED`).

## 11. Create Intent

| Field | Type | Rules |
|---|---|---|
| `intentId` | `string` | Unique per attempt |
| `runId`, `taskUuid` | `string` | Indexed for reconciliation |
| `targetTeamKey`, `targetProject` | `string` | Destination |
| `status` | `"pending" → "confirmed-created" \| "indeterminate" (→ "reconciled")` | `pending` persisted durably **before** the create attempt (FR-004); `reconciled` written by 008; indeterminate creates are never auto-replayed |
| `createdAt`, `updatedAt` | ISO-8601 | Injected clock |

## 12. Run Lock

`{ runId, pid, acquiredAt }` at `lock.json`. Acquisition/takeover rules: research R8.
State transitions: `absent → held(runId,pid)`; `held → absent` on release;
`held(stale: dead pid AND age > threshold) → held(new runId)` — the only takeover; live-pid
locks never lost (SC-004).

## 13. Pending Job & Last-Run Marker

- `PendingJob` (dedup queue record, behavior 010): `{ enqueuedAt, trigger, claim: { workerId,
  claimedAt } | null }` — single deduplicated record; claim/reclaim thresholds per 001 R13.
- `LastRunMarker` (`last-run.json`): `{ runId, outcome: "completed" | "failed" |
  "aborted", completedAt, reportPaths: { json, markdown } | null, notificationSuppressed:
  boolean }` — updated whenever a run produces a report (FR-005) and when a queued run
  completes (010).

## 14. Hook Definition / Hook Block (shapes only; behavior 010)

- Hook Definition: scaffolded agent-hook file (framework-specific directory, `command`
  action invoking the enqueue entry point).
- Hook Block: marker-bounded managed region inside a git hook script — managed start/end
  marker lines plus enclosed enqueue invocation; content outside markers preserved
  byte-for-byte.

## 15. Plan Report Artifacts

Paired outputs of one plan: `reports/<runId>/report.json` (conforms to
`contracts/plan-report.schema.json`; durable identifiers) and `report.md` (human-readable
names, same grouping: project → milestone, separate unmapped section, unresolved-conflict
surfacing, security-assertions block of discrete pass/fail assertions). Sanitized by
construction: structural field exclusion (entity 9) + Security_Screener serialization pass.
Written only into state directory (never repo tree).

## 16. Sync-History Page (contract for 011)

Addressable view: `GET` target `<base-host>/<toolId>/<task-uuid>` resolving via the
attachment chain (page 0 identity + chronological events across pages 0..n). 002 freezes
only the URL scheme and the `SyncHistoryEvent` shape; reading/rendering is 011.

## 17. Configuration (the merged model)

Two public types: `ResolvedConfig` (complete, post-merge, post-defaults) and
`ConfigOverrides` (deep-partial input for file + programmatic sources). Groups (all keys
overridable; defaults summarized from 001 R17.4 — normative list lives there):

| Group | Keys (representative) | Default posture |
|---|---|---|
| Tool identity | `toolId` | `task-linear-sync`; derives env-var prefix, namespace key `__<toolId>`, attachment title `<toolId> sync state`, bin name, config path |
| Discovery | `frameworkAdapters`, `taskFilePatterns`, `specsBaseDirectories`, `skipDirectories`, `siblingDocuments` | All generic defaults (`.kiro/specs/`, `specs/`, …; `tasks.md`/`TASKS.md`; `.git`, `node_modules`, `dist`, `.next`, `coverage`) |
| Grammar | `headingIdGrammar`, `phasePattern`, `summaryPattern`, `rollupPattern`, `flatChecklistMarkers`, `tabWidth` | Defaults per 001 R17.4; tab width 2 |
| Routing (required) | `teams`, per-team `projects`/`workflowStates`, `projectByPath`, `defaultTeamKey`, `defaultProject` | **No defaults** — validation-required |
| Matching | `scoringWeights`, `confidenceFloors {medium: 50, plausible: 18}`, `minimumMatchMargin: 10` | Defaults; weights all ≥ 0 |
| Tracker | `pageSize: 100`, `maxRetries: 5`, `concurrency: 4`, `personalKeyPrefix: lin_api_`, `credentialEnvVarNames { token: LINEAR_ACCESS_TOKEN, apiKey: LINEAR_API_KEY }`, `completedStateTypes: ["completed"]`, `ignoredStateTypes: ["canceled","duplicate"]` | Defaults |
| Attachment | `attachmentUrlTemplate`, `continuationUrlTemplate`, `attachmentBaseHost` (benign placeholder), `metadataNamespaceKey`, `syncAttachmentTitle/Subtitle/IconUrl`, `historyLogMaxEntries: 50`, optional size rollover threshold | Defaults; zero org literals |
| Sync semantics | `confirmationKey: "SYNC"`, `bootstrapConflictMap`, `syncConflictMap`, `descriptionNormalizationProfile`, `titleRules: []`, `titleStripPrefixes` | Defaults (entity 7) |
| Run state | `stateDirectory` (no default — platform default computed), `auditManifestEnabled: true`, `auditManifestEncryptionEnabled: true`, `manifestExpiryDays: 30`, `staleLockTakeoverSeconds: 60`, key-store/notifier provider selection | Defaults per constitution |
| Surfaces | `managedGitHooks: ["pre-push","post-merge"]`, `agentHooksDirectory` (per-framework), worker thresholds, web `accessControlMode: "private"`, realtime `sse`, poll 15 s, cache TTL 10 s, MCP `mutatingToolsEnabled: false`, transport `stdio`, auth-env names (toolId-derived) | Defaults |

Merge/load/validation semantics: research R3–R5. Credential *values* are never config — only
env-var **names** are config; values are read at use time (constitution credential
handling).

## State transitions summary

- **CreateIntent**: `pending → confirmed-created | indeterminate`; `indeterminate →
  reconciled` (008). A crash after `pending` persist is the reconciliation signal.
- **RunLock**: `absent → held`; takeover `held(dead-pid ∧ age>threshold) → held(new)`
  only; release `held(self) → absent`.
- **AuditManifest validity**: `valid → expired` purely by `createdAt` age (monotonic,
  encryption-independent); `enabled but absent for run` ⇒ `unjournaled` (rollback refuses).
- **Plan reference**: `valid → stale` when any guard breaks (file hash or HEAD drift);
  never `valid` again — a drifted plan requires a plan rebuild.
- **Run lifecycle (marker)**: `absent/previous → running → completed | failed | aborted`
  recorded in `last-run.json` with report paths.
