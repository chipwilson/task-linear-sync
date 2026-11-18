# Configuration reference — every key and its intelligent default

This page is the **complete list of every configuration parameter** the tool
exposes, and the intelligent default each one ships with. Model semantics —
layering, merge rules, failure categories, identity validation — live in
[configuration.md](./configuration.md); this is the per-key catalogue.

Source of truth: `src/config/defaults.ts` (the frozen defaults, a release-scan
target), `src/config/schema.ts` (the `ResolvedConfig` model), and the
group-resolver validators in `src/queue/config.ts`, `src/mcp/config.ts`, and
`src/history-server/options.ts`. The catalogue covers the complete
`ResolvedConfig` (including every nested typed sub-key), the additive `queue`
group, and the extra `mcp` launch keys — every parameter the tool reads.

## How configuration works (in one screen)

- **Layers** (constitution III, lowest wins): built-in defaults → JSON config
  file → programmatic overrides. Objects merge recursively; **arrays and
  scalars replace wholesale**; `null` is a value, `undefined` means "absent".
- **The config file** is `<repositoryRoot>/<configFileName>` by default
  (`task-linear-sync.json` in the repo root); `--config <path>` points
  elsewhere. It is a plain JSON object — no comments, no schema includes.
- **Every key is optional** except the four routing identities (below), which
  intentionally have **no defaults** — the tool refuses to guess where your
  work lands in Linear.
- **Credential values are never configuration.** Only the *environment-variable
  names* that hold them are; the values are read from the environment at use
  time and never enter `ResolvedConfig`, files, logs, or output.
- **Strict groups**: the `queue` and `mcp` groups validate their own keys at
  use time — an unknown key or out-of-range value is refused, naming *every*
  problem in one line (never a silent fallback).
- In JSON config files, regex sources need JSON escaping: write each `\` in the
  patterns below as `\\`.

## Tool identity

| Key | Type | Intelligent default | Notes |
|---|---|---|---|
| `toolId` | string | `"task-linear-sync"` | Anchor for every derived name below. Changing it re-derives each dependent default — individually overridable. |
| `envVarPrefix` | string | `"TASK_LINEAR_SYNC"` | Derived: upper-snake-case `toolId`. Prefixes the tool-owned env-var names. |
| `binName` | string | `"task-linear-sync"` | Derived: `toolId`. The command written into managed git hooks and agent-hook scaffolds. |
| `configFileName` | string | `"task-linear-sync.json"` | Derived: `<toolId>.json`. Auto-discovered in the repository root. |
| `stateDirAppSegment` | string | `"task-linear-sync"` | Derived: `toolId`. Application segment of the platform state directory. |

### toolId-derived values (each independently overridable)

Setting `toolId` re-derives these **unless** the file or programmatic layer
sets them explicitly (001 R17.9):

| Key | Formula | Shipped value |
|---|---|---|
| `metadataNamespaceKey` | `__<toolId>` | `__task-linear-sync` (leading `__` avoids Linear reserved keys) |
| `syncAttachmentTitle` | `<toolId> sync state` | `task-linear-sync sync state` |
| `manifestKeyEnvVarName` | `<PREFIX>_MANIFEST_KEY` | `TASK_LINEAR_SYNC_MANIFEST_KEY` |
| `web.authEnvVarName` | `<PREFIX>_WEB_TOKEN` | `TASK_LINEAR_SYNC_WEB_TOKEN` |
| `mcp.authEnvVarName` | `<PREFIX>_MCP_TOKEN` | `TASK_LINEAR_SYNC_MCP_TOKEN` |

## Discovery

| Key | Type | Intelligent default | Notes |
|---|---|---|---|
| `frameworkAdapters` | string[] | `["bmad", "spec-kit", "open-spec", "kiro", "spec-superpower", "spec-kitty", "generic"]` | All seven built-in adapters enabled. Array order is not selection precedence (that order is fixed in the registry — see [framework-adapters.md](./framework-adapters.md)); narrow it to pin a repo to one lane. |
| `taskFilePatterns` | string[] | `["tasks.md", "TASKS.md"]` | Basename patterns claiming task files. Widen instead of forking (e.g. `["*.md"]` for a homegrown convention). |
| `specsBaseDirectories` | string[] | `["specs/", ".kiro/specs/", "openspec/", "bmad/"]` | Discovery hints — where to look, not selection markers. |
| `skipDirectories` | string[] | `[".git", "node_modules", "dist", ".next", "coverage"]` | Directory *names* skipped at any depth without descending. |
| `siblingDocuments` | string[] | `["spec.md", "plan.md", "research.md"]` | Spec documents attached alongside a task file when present; absent siblings are omitted without error. |

Per-adapter detection markers, sibling-document sets, and feature-name rules
are fixed conventions in the built-in adapter modules — not configuration keys
(programmatic `overrides.adapters.<id>` widens them per call).

## Grammar

Regex sources are compiled by the parser/renderer lane (004/005).

| Key | Type | Intelligent default | Notes |
|---|---|---|---|
| `headingIdGrammar` | regex source | `^\s{0,3}#{1,6}\s+(?:(?<id>[0-9]+(?:\.[0-9]+)*|[A-Za-z][A-Za-z0-9-]*\d*)[.:]?\s+)?(?<title>.+)$` | Heading → task. Captures a single leading id token (`T001`, `TASK-1`, `1.2`); in `## Task 1.2 …` only the token `Task` is captured. |
| `phasePattern` | regex source | `^\s{0,3}#{1,2}\s+Phase\s+[0-9]+[.:]?\s*(?<phase>.*)$` | Tracks the current phase from the most recent matching H1/H2 heading. |
| `summaryPattern` | regex source | `^\s{0,3}#{2,4}\s+(?:Summary\|Overview)\b` | H2–H4 summary/overview sections are excluded from task extraction. |
| `rollupPattern` | regex source | `\b(?:parent\|roll-?up)\b` | Lines mentioning a parent/roll-up are rollup labels, not tasks. |
| `flatChecklistMarkers` | string[] | `["- [ ]", "- [x]", "- [X]", "* [ ]", "* [x]", "* [X]"]` | Checkbox markers recognized as task lines (both bullet styles, both case spellings of checked). |
| `tabWidth` | integer | `2` | Column width used when normalizing indentation. |

## Routing identities — deliberately **no defaults**

These four fail `validateWorkspaceIdentity()` when missing or empty
(`MissingIdentityError` names *every* missing value at once; CLI exit code 3).
The intelligent default is "never guess a workspace identity":

| Key | Type | Default | Required shape |
|---|---|---|---|
| `teams` | record | `{}` (invalid) | ≥ 1 team key; per team ≥ 1 entry in `projects` and ≥ 1 identity in `workflowStates` (backlog/todo/inProgress/done) |
| `projectByPath` | array | `[]` (empty is legal, but each entry then must carry both fields) | every entry: non-empty `teamKey` **and** `project` |
| `defaultTeamKey` | string | `""` (invalid) | non-empty |
| `defaultProject` | string | `""` (invalid) | non-empty |

## Matching (task ↔ issue pairing)

| Key | Type | Intelligent default | Notes |
|---|---|---|---|
| `scoringWeights.durableUuid` | number | `1000` | The deterministic UUID in the sync attachment matches — effectively conclusive. |
| `scoringWeights.issueRefExact` | number | `500` | The visible `[KEY-N]` reference token matches exactly. |
| `scoringWeights.titleExact` | number | `60` | Titles equal after normalization. |
| `scoringWeights.titleTokenOverlap` | number | `30` | Partial title similarity (token overlap). |
| `scoringWeights.featureNameMatch` | number | `20` | Same derived feature name. |
| `scoringWeights.filePathProximity` | number | `10` | Task file sits near where the issue's work lives. |
| `scoringWeights.samePhase` | number | `5` | Same phase label. |
| `scoringWeights.kindMatch` | number | `2` | Same task kind. |
| `confidenceFloors.medium` | number | `50` | Pair totals ≥ this band as **high**; below, low (selected pairs are ≥ `plausible`). |
| `confidenceFloors.plausible` | number | `18` | Usability floor — below this a pair never auto-matches (report-only). |
| `minimumMatchMargin` | number | `10` | A high match whose lead over the best rival is smaller is downgraded to **medium** (`ambiguous-margin`) unless it is a durable match. |

All weights must be ≥ 0; a bad group is refused with a complete problem
listing.

## Tracker (Linear API behavior)

| Key | Type | Intelligent default | Notes |
|---|---|---|---|
| `pageSize` | integer | `100` | Linear GraphQL pagination page size. |
| `maxRetries` | integer | `5` | Up to 5 *additional* attempts for retryable request classes (≤ 6 requests total; `never`-class requests get exactly 1). |
| `concurrency` | integer | `4` | In-flight tracker requests (semaphore bound on fan-out). |
| `personalKeyPrefix` | string | `"lin_api_"` | Recognized Linear personal-key prefix — diagnostics and output screening only; never a token. |
| `credentialEnvVarNames.token` | string | `"LINEAR_ACCESS_TOKEN"` | Env-var **name** holding the Linear API token. |
| `credentialEnvVarNames.apiKey` | string | `"LINEAR_API_KEY"` | Alternate credential env-var name. |
| `completedStateTypes` | string[] | `["completed"]` | Linear workflow-state types counted as done. |
| `ignoredStateTypes` | string[] | `["canceled", "duplicate"]` | Workflow-state types excluded from sync consideration. |

## Attachments & sync history

| Key | Type | Intelligent default | Notes |
|---|---|---|---|
| `attachmentUrlTemplate` | string | `"{baseHost}/{toolId}/{uuid}"` | URL recorded on each issue's sync attachment — exactly the address the history server serves. Placeholders: `{baseHost}`, `{toolId}`, `{uuid}`. |
| `continuationUrlTemplate` | string | `"{baseHost}/{toolId}/{uuid}/{page}"` | Continuation-page URLs (adds `{page}`). |
| `attachmentBaseHost` | string | `"https://sync.example.invalid"` | Benign placeholder host (release-scan guarantee: zero real org identifiers in defaults) — **set this** to your history-server host so attachment URLs resolve for your team. |
| `metadataNamespaceKey` | string | `"__task-linear-sync"` | Team-metadata namespace key carrying durable sync state (toolId-derived; must avoid Linear reserved keys). |
| `syncAttachmentTitle` | string | `"task-linear-sync sync state"` | Attachment title (toolId-derived). |
| `syncAttachmentSubtitle` | string | *absent* | Optional attachment subtitle. |
| `syncAttachmentIconUrl` | string | *absent* | Optional attachment icon URL. |
| `historyLogMaxEntries` | integer | `50` | History rollover threshold in the sync-attachment metadata — newest entries survive. |
| `historyLogMaxBytes` | integer | *absent* | Optional byte-size rollover threshold in addition to the entry count. |

## Sync semantics

| Key | Type | Intelligent default | Notes |
|---|---|---|---|
| `confirmationKey` | string | `"SYNC"` | The exact `--confirm` value the apply gate requires. The merged value is compared dynamically — never a hard-coded constant. |
| `bootstrapConflictMap` | map | all three → `"overwrite-linear"` | First bulk apply: the file is the source of truth. Keys `linear-changed` / `spec-changed` / `both-changed`; values `overwrite-linear` \| `overwrite-spec` \| `report-only`. |
| `syncConflictMap` | map | `linear-changed → "overwrite-spec"`, `spec-changed → "overwrite-linear"`, `both-changed → "report-only"` | Day-to-day sync: each side wins its own edits; a two-sided conflict is **reported, never guessed**. |
| `descriptionNormalizationProfile` | string | `"standard"` | The configured alias of the built-in `"default"` normalizer (NFC, LF terminators, trailing-whitespace trim, blank-line collapse, one trailing newline). Programmatic `EngineOptions.normalizationProfiles` can register more; unknown names fail loudly. |
| `titleRules` | string[] | `[]` | No custom title derivation. Entries follow the `<guard> => <template>` grammar (conditions on `featureName`, `localId`, `phase`, `framework`, `kind`, `path`, `child`, `issueRef`); malformed rules fail with the offending index. |
| `titleStripPrefixes` | string[] | `[]` | Extra literal prefixes `cleanTitle()` strips from derived issue titles (beyond its built-in reference-token/local-id cleaning). |

## Run state & rollback journal

| Key | Type | Intelligent default | Notes |
|---|---|---|---|
| `stateDirectory` | path | *absent* → platform placement | `<platform base>/<stateDirAppSegment>/<sha16(canonical repo root)>`; platform base = `$XDG_STATE_HOME` (or `~/.local/state`) on Linux, `~/Library/Application Support` on macOS, `%APPDATA%` on Windows. A configured path is used verbatim; one inside the repo tree **aborts** (`StatePlacementError`). Dirs `0700`, state files `0600`. |
| `auditManifestEnabled` | boolean | `true` | Every run journals an audit manifest — rollback works out of the box. |
| `auditManifestEncryptionEnabled` | boolean | `true` | Manifests are encrypted at rest by default. |
| `manifestExpiryDays` | integer | `30` | After 30 days a manifest is expired and `rollback` refuses to replay it. |
| `staleLockTakeoverSeconds` | integer | `60` | A run lock older than this (held by a dead pid) can be taken over. |
| `manifestKeyEnvVarName` | string | `"TASK_LINEAR_SYNC_MANIFEST_KEY"` | Env-var **name** holding the manifest encryption key (toolId-derived; the key itself is never configuration). |
| `manifestKeyId` | string | `"primary"` | Logical key id handed to the KeyProvider. |

## Git hooks & agent hooks

| Key | Type | Intelligent default | Notes |
|---|---|---|---|
| `managedGitHooks` | string[] | `["pre-push", "post-merge"]` | Hooks `install-hooks` splices its fail-open managed block into. Add `"post-commit"` for every-commit queueing; `[]` leaves hooks untouched. |
| `agentHooksDirectory` | path | *absent* → per-framework default | `install-agent-hook` destination: `.kiro/hooks/` for `kiro`, `.task-linear-sync/hooks/` for `generic`; when set, applies to all enabled adapters. |

## Worker (`worker` group)

| Key | Type | Intelligent default | Notes |
|---|---|---|---|
| `worker.claimTimeoutSeconds` | integer | `300` | A claimed job older than this can be reclaimed. |
| `worker.maxConcurrentRuns` | integer | `1` | One run at a time per repository — syncs never race each other. |

## Queue (`queue` group)

Additive group validated at queue-surface use time; unknown keys are refused
by name. Defaults favor a quiet, coalescing, fail-open background.

| Key | Type | Intelligent default | Bounds | Notes |
|---|---|---|---|---|
| `queue.workerDelaySeconds` | integer | `75` | 1..3600 | Resident-worker wait between drain passes. |
| `queue.lockTimeoutSeconds` | integer | `30` | 1..300 | How long a drain waits on the queue lock before stopping the cycle. |
| `queue.maxRetries` | integer | `5` | 1..100 | Per-job retry ceiling before the job is terminally failed (`RETRY_LIMIT`). |
| `queue.notificationsEnabled` | boolean | `true` | — | Run outcomes (completed/failed/terminal) are delivered to the notifier port on every drain. |
| `queue.autoAcceptLowConfidence` | boolean | `false` | — | Background runs **never** auto-accept low-confidence matches — the gate stays a human decision. |
| `queue.hookScriptPrefix` | string | *derived: `binName`* | non-empty | Command written into the managed hook block (`"task-linear-sync" enqueue …`). |
| `queue.hooksDirectory` | path | *absent* → the repository's own hooks dir | absolute path only | Override for worktrees / shared hooks dirs. |
| `queue.agentHooksDirectory` | path | *absent* → the framework's default dir | non-empty string | `install-agent-hook` destination override (relative to the repo root). |

## History-server web surface (`web` group)

Ranges are enforced when the surface is constructed (014 resource bounds);
every violation is listed at once.

| Key | Type | Intelligent default | Bounds | Notes |
|---|---|---|---|---|
| `web.accessControlMode` | enum | `"private"` | `private` \| `public` | Private by default: bearer-token auth required. |
| `web.realtimeSse` | boolean | `true` | — | SSE streaming routes on. |
| `web.pollIntervalSeconds` | integer | `15` | 1..3600 | HTML page auto-refresh interval. |
| `web.cacheTtlSeconds` | integer | `10` | 0..3600 | Display-cache TTL (`0` disables caching). |
| `web.authEnvVarName` | string | `"TASK_LINEAR_SYNC_WEB_TOKEN"` | non-empty | Env-var name holding the web bearer token (toolId-derived). |
| `web.maxCacheEntries` | integer | `500` | 1..100000 | Display-cache LRU capacity. |
| `web.maxConcurrentWalks` | integer | `8` | 1..64 | Concurrent history chain-walks. |
| `web.maxConcurrentSseStreams` | integer | `16` | 1..1000 | Concurrent SSE streams. |
| `web.secureCookies` | boolean | `false` | — | `Secure` session cookie — an explicit TLS-front-door opt-in (safe default for loopback). |

## MCP surface (`mcp` group)

The file group accepts the extended launch keys below plus the frozen schema
keys `mutatingToolsEnabled` (alias of `enabled`), `transport`, and
`authEnvVarName` (alias of `tokenEnvVarName`).

| Key | Type | Intelligent default | Bounds | Notes |
|---|---|---|---|---|
| `mcp.enabled` | boolean | `false` | — | Gated mutating tools (`task_sync_apply`) ship **disabled**; the engine's plan-review-confirm gates stay mandatory even when enabled. |
| `mcp.transport` | enum | `"stdio"` | `stdio` \| `http` | stdio is the safe local default; http needs the bearer token. |
| `mcp.host` | string | `"127.0.0.1"` | non-empty | Bind host (http transport only) — loopback by default. |
| `mcp.port` | integer | `0` (ephemeral) | 0..65535 | The bound port is announced once to stderr at listen. |
| `mcp.tokenEnvVarName` | string | `"TASK_LINEAR_SYNC_MCP_TOKEN"` | upper-snake name | Env-var name holding the http bearer token (toolId-derived). |
| `mcp.planReferenceTtlSeconds` | integer | `3600` | 60..86400 | Session lifetime of a `task_sync_plan` reference. |
| `mcp.planReferenceMaxEntries` | integer | `1000` | 1..100000 | Plan-reference store capacity. |

## Credential & token environment variables (names are config, values never)

| Purpose | Key holding the name | Default env-var name |
|---|---|---|
| Linear API token | `credentialEnvVarNames.token` | `LINEAR_ACCESS_TOKEN` |
| Linear API key (alternate) | `credentialEnvVarNames.apiKey` | `LINEAR_API_KEY` |
| History-server bearer token | `web.authEnvVarName` | `TASK_LINEAR_SYNC_WEB_TOKEN` |
| MCP HTTP bearer token | `mcp.authEnvVarName` | `TASK_LINEAR_SYNC_MCP_TOKEN` |
| Audit-manifest encryption key | `manifestKeyEnvVarName` | `TASK_LINEAR_SYNC_MANIFEST_KEY` |

The three tool-owned names re-derive from `toolId` automatically.

## Keys that default to *absent*

`stateDirectory`, `agentHooksDirectory`, `queue.hooksDirectory`,
`queue.agentHooksDirectory`, `syncAttachmentSubtitle`,
`syncAttachmentIconUrl`, `historyLogMaxBytes` — and the four routing
identities, whose empty values fail validation. Absent means "platform-
computed", "adapter-supplied", or "feature not configured", never a silent
guess.

## See also

- [Configuration model & precedence](./configuration.md) — merge semantics,
  failure categories, state-dir placement
- `specs/002-core-domain-contracts/data-model.md` §17 — grouped data-model view
- `specs/requirements.md` R17 — the normative default list this catalogue
  implements
- `src/config/defaults.ts` — the shipped defaults (release-scan target: zero
  real organization identifiers, tokens, or UUID values)
