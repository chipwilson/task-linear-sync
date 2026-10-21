# Tasks: Core Domain Contracts, Configuration, and Run State

**Input**: Design documents from `specs/002-core-domain-contracts/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R16), data-model.md (§1–17), contracts/ (7 documents)

**Tests**: INCLUDED — mandatory. Constitution Principle VI (NON-NEGOTIABLE: "Every behavioral change lands with automated tests... every acceptance criterion in the specification MUST be enforced by at least one automated test") and quickstart.md's traceability table map every FR/SC to specific tests. Test tasks precede implementation tasks (test-first, verify RED before GREEN).

**Organization**: Tasks grouped by user story (US1 = configuration P1, US2 = run state P2). The frozen contract surface (FR-008) is a cross-cutting blocking prerequisite and lives in the Foundational phase.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[US1]/[US2]**: User-story phases only; Setup, Foundational, and Polish tasks carry no story label
- Test runner: `node:test` + `node:assert/strict` against compiled output (research R2); tiers `unit`, `contract`, `integration`, `e2e`
- All paths are repository-root-relative; single npm package per plan.md

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Bootstrap the empty repository into the publishable-package skeleton defined in plan.md § Source Code and research R1/R2.

- [ ] T001 Create `package.json`: name `task-linear-sync`, `"type": "module"`, `"engines": { "node": ">=20.0.0" }`, `exports` + `types` fields pointing at per-module `dist/` output (constitution "Technology stack": "ECMAScript Module output with a generated TypeScript declaration per exported module, a declared `exports` and `types` field, Node.js engine constraint ≥ 20.0.0"); scripts: `build` (tsc), `typecheck` (tsc --noEmit over src + tests), `lint`, `test:unit`, `test:contract`, `test:integration`, `test:e2e` (each `node --test` over the compiled tier in `build/tests/<tier>/`), `test` (all tiers + coverage threshold flags `--experimental-test-coverage --test-coverage-lines/--test-coverage-branches` per R2); devDependencies limited to `typescript@5.x`, `@types/node`, and eslint+typescript-eslint (lint is a pipeline gate; runtime dependencies stay at zero per R1/R2)
- [ ] T002 Create `tsconfig.json` (`strict: true`, `module`/`moduleResolution` `NodeNext`, `declaration: true`, `outDir: dist`, include `src/`) and `tsconfig.test.json` (extends it, includes `src/` and `tests/`, emits to `build/` so tests import the compiled package and exercise the real `exports` map per R2); then `npm install` and commit `package-lock.json` (quickstart: "npm with a lockfile (`package-lock.json` committed; pipeline installs with `npm ci`)")
- [ ] T003 [P] Create directory scaffold per plan.md § Source Code: `src/{domain,config,state,urls,gates,ports}/`, `tests/{unit,contract,integration,e2e,types}/`, `tests/fixtures/`, and `.gitignore` (node_modules, dist, build)
- [ ] T004 [P] Create ESLint flat config `eslint.config.js` with typescript-eslint recommended rules over `src/` and `tests/`; wire into the `lint` script from T001
- [ ] T005 [P] Create GitHub Actions pipeline `.github/workflows/ci.yml` running `npm ci`, `lint`, `typecheck`, `build`, `test` on PR + protected-branch push, merge-blocking on any failure or coverage below threshold (constitution "Merge-blocking validation"); no secrets, no network beyond npm install (hermetic pipelines)
- [ ] T006 [P] Create config fixtures under `tests/fixtures/config/`: (a) precedence matrix sets — defaults-only, file-only, all-three layerings with overlapping and disjoint keys (per configuration.md § Test obligations); (b) invalid-file set — a missing path, an unreadable file (chmod 000), a syntactically invalid JSON file, and a JSON file with a non-object root; (c) missing-identity set — configs lacking `teams`, per-team `projects`, per-team `workflowStates`, `ProjectByPath` entries with missing `teamKey`/`project`, `defaultTeamKey`, `defaultProject`. All fixture identities are placeholders (`acme-team`, `proj-alpha`, …) — zero real organization identifiers (quickstart Prerequisites)
- [ ] T007 [P] Create repository fixtures under `tests/fixtures/repos/`: fake roots `repo-a` and `repo-b` (one nested inside a scratch dir) each containing only a marker file; plus `tests/fixtures/reports/` containing a minimal plan-report JSON fixture pair for schema conformance tests

**Checkpoint**: `npm ci && npm run build && npm run lint && npm run typecheck` green on an empty src tree; fixture trees in place.

---

## Phase 2: Foundational (Frozen Contract Surface — FR-008)

**Purpose**: Freeze the contract modules every other feature (003–013) builds against: canonical entity shapes (`src/domain`), `Linear_Port` + engine signatures (`src/ports`), gate vocabulary (`src/gates`), attachment-URL scheme (`src/urls`), and the amendment-enforcing contract snapshot. Also the shared `clock` both user stories need.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete — US1's config schema references routing/identity types and US2's state records reference domain shapes (data-model.md relationship overview).

### Tests for the frozen surface (write FIRST, must fail)

- [ ] T008 [P] Create frozen-surface snapshot test `tests/contract/frozen-surface.test.ts`: snapshot the exact set of exported names from each frozen module (`src/domain`, `src/config`, `src/state`, `src/urls`, `src/gates`, `src/ports`) per research R15 — seed the expected sets from `contracts/*.md` code blocks; any addition/removal/shape-drift fails the suite ("amendments must update the snapshot deliberately with a note against 001")
- [ ] T009 [P] Create domain invariant unit tests `tests/unit/domain.test.ts` exactly per contracts/task-model.md § Invariants: (1) `taskStableSeed` independent of `title`, `checked`, `issueRef` (property test: mutate those three, seed bytes unchanged); (2) `kind === "heading"` ⇔ `checked === undefined`; (3) `serializeSyncStatePayload → parseSyncStatePayload` round-trip exact, serialized form has only string/number leaf types; (4) `Match.alternatives.length <= 3`
- [ ] T010 [P] Create attachment-URL unit tests `tests/unit/attachment-url.test.ts` per contracts/attachment-url-scheme.md § Behavior rules: determinism (same `(cfg, taskUuid[, page])` ⇒ byte-identical URL); base-host normalization ("trailing `/` and extra whitespace removed; no query/fragment accepted"); UUID validation against `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`; continuation `page` integer ≥ 1 (throw typed `UrlSchemeError` otherwise); template missing a required placeholder throws `UrlSchemeError`; builder→parser round-trip for canonical + pages 1..10 under default and overridden templates; "page 0 never appears as a path segment"
- [ ] T011 [P] Create plan-reference predicate unit tests `tests/unit/gates.test.ts` per quickstart Contract-freeze scenario 4: matching guards → `{ valid: true }`; single-byte file-hash drift or HEAD drift → `PLAN_REFERENCE_STALE`; unknown id → `PLAN_REFERENCE_UNKNOWN`; gate failure result shape carries `code` + sanitized `detail` naming the offending value
- [ ] T012 [P] Create report-schema contract test `tests/contract/report-schema.test.ts`: validate report fixtures (created in T007) against `specs/002-core-domain-contracts/contracts/plan-report.schema.json` (draft 2020-12, `additionalProperties: false` throughout — implement the validator with plain property walking, no new dependency); schema-scan test asserting per plan-artifact.md § Test obligations "no property named like `body|description|content` (other than `*ContentHash` / `expected*` / `description*` under a `Hash`-suffixed name) admits free raw-text from task/issue sources; the assertions block shape is fixed"

### Implementation — domain entity shapes (data-model.md §1–15; all types readonly)

- [ ] T013 Implement `src/domain/task.ts`: `FrameworkId = "bmad" | "spec-kit" | "open-spec" | "kiro" | "generic"`, `TaskKind`, `TaskBodyExtent` (`{ startLine, endLine }` inclusive, 1-based), `IssueRef` (`number: integer ≥ 1`), `Task` (all fields + rules per data-model §1 incl. `lineNumber: integer ≥ 1`, `checked` "Present iff `kind = "checklist"`", `childUuids` ordered), `TaskFile` (`tasks` in file order ascending `lineNumber`), `FrameworkMetadata`, and `taskStableSeed(t, fallback)` implementing the R11 frozen seed layout: `frameworkId + "\u0000" + (featureName ?? "") + "\u0000" + (localTaskId ?? ordinal+fileIdentity)` — excluded by construction: visible issue prefix, checkbox state, title text (004 computes the UUID; 002 freezes the seed string)
- [ ] T014 [P] Implement `src/domain/match.ts`: `Confidence = "high" | "medium" | "low" | "unmatched"`, `MatchAlternative { issueId, score, mapped }`, `Match` per contracts/tracker-port + task-model §5: `score: integer ≥ 0`, `margin: integer ≥ 0`, `durableIdentity: boolean` ("true ⇒ bypass team/project/framework gating and margin downgrade"), `reasons: string[]`, `alternatives` "≤ 3, descending score, deterministic tie-break"
- [ ] T015 [P] Implement `src/domain/routing.ts`: `ProjectByPathEntry { prefix, teamKey, project }` ("Both `teamKey` and `project` required (project-only shape unsupported); longest-character-length match wins; deterministic first-by-map-order tie-break"), `RoutingResolution` (per contracts/task-model.md, incl. `defaulted`, `tieBreak?: "first-by-map-order"`, `unassigned?: true`), and team-identity config shapes `teamKey → { projects, workflowStates: { done, backlog, …, completedTypes, ignoredTypes } }` (data-model §4)
- [ ] T016 [P] Implement `src/domain/state-payload.ts`: `SyncHistoryEventKind` (8 kinds), `SyncHistoryEvent` ("immutable once appended; rollback appends rather than rewinds"), `SyncStatePayload` (data-model §8), and `serializeSyncStatePayload`/`parseSyncStatePayload` — "Compact, stable-key-order serialization into one Attachment_Metadata string value"; "metadata values are strings/numbers only"
- [ ] T017 [P] Implement `src/domain/checkpoint.ts`: `Checkpoint` (data-model §6, `descriptionContentHash` = sha256 hex), `DescriptionConflictType`, `ConflictAction` (6 values), `ConflictResolutionMap = Record<DescriptionConflictType, ConflictAction>`; document built-in defaults (data-model §7): bootstrap — all three → `overwrite-linear`; sync — `spec-changed` → `overwrite-linear`, `linear-changed` → `overwrite-spec`, `both-changed` → `report-only`
- [ ] T018 [P] Implement `src/domain/plan.ts`: `PlanGuards { fileHashes: Record<repoRelPath, sha256>, headCommit: string | null }`, `PlanDecision` (6 values), `PlanTaskEntry` ("field set fixed by 009 FR-006" — exactly: decision, frameworkId, featureName?, filePath, confidence, score, margin, reasons, ≤3 alternatives, changedFields, `descriptionContentHash`, `expectedMarkdownChanges`, `lowConfidenceGateStatus: "passed" | "failed"`, unresolvedConflict?, routing?, match?; **no raw task body or issue description field exists**), `UnmappedIssue`, `Plan` (entries "Sorted deterministically"), `StoredPlan`, `canonicalizePlanJson` (sorted keys, stable formatting), and `derivePlanId = sha256(canonicalizePlanJson(planWithoutId))` per research R13
- [ ] T019 [P] Implement `src/domain/run-records.ts`: `AuditManifest` (data-model §10: `runId`, `createdAt` ISO-8601 "Drives expiry", `repoRoot`, `planId`, `fileBackups: { path, beforeContentHash, beforeContent }[]`, `checkpointBefore: Checkpoint[]`, `operations: AuditOperation[]`, `stepState: "pending" | "applied" | "rolled-back" | "conflict-halted"`), `AuditOperation` (target issue, URL, prior metadata per data-model §10), `CreateIntent` + `CreateIntentStatus` (`"pending" → "confirmed-created" | "indeterminate" (→ "reconciled")`), `PendingJob { enqueuedAt, trigger, claim: { workerId, claimedAt } | null }` (behavior 010, shape here), `LastRunMarker { runId, outcome: "completed" | "failed" | "aborted", completedAt, reportPaths: { json, markdown } | null, notificationSuppressed: boolean }`, `RunLockRecord { runId, pid, acquiredAt }`, `HookDefinition`/`HookBlock` shapes only (data-model §14: "managed start/end marker lines plus enclosed enqueue invocation; content outside markers preserved byte-for-byte")

### Implementation — ports, gates, urls

- [ ] T020 [P] Implement `src/ports/linear-port.ts` — interface types ONLY, no transport code (007 implements): `Page<T>`, `IssueScope` (perTeam scoping, `pageSize: number` default 100), `AttachmentMetadata` (flat `string | number` "by rule"), `AttachmentView`, `IssueView`, `CreateIssueInput`, `IssueUpdatePatch`, `LinearPort` with exactly the members in contracts/tracker-port.md (`listIssues`, `discoverMetadata`, `getIssue`, `createIssue`, `updateIssue`, `archiveIssue`, `findIssuesByAttachmentUrl`, `upsertAttachmentByUrl`, `updateAttachment`, `getAttachmentByUrl`, `listAttachments`); JSDoc carries the frozen consumption invariants (createIssue "NEVER automatically retried"; identity via attachment metadata only, "MUST NOT search descriptions")
- [ ] T021 Implement `src/ports/engine.ts`: `EngineDependencies { port, config, state, clock, screener }`, `BuildPlanOptions`, `SyncEngine` interface (`buildSyncPlan` / `applySyncPlan` / `rollbackRun` signatures frozen, "008 implements"), `ApplyResult { runId, status: "applied" | "aborted" | "refused", gateFailures, operations, reportPaths? }`, `OperationOutcome`, `RollbackResult`, and `SecurityScreener` interface per contracts/engine-gates.md ("blocking findings => propagation of affected content is aborted; non-blocking findings redact/annotate")
- [ ] T022 Implement `src/gates/gates.ts`: `GateRequest { applyFlag, confirmationKey, acceptLowConfidence, planReference? }`, `GateFailureCode` union (exactly the 8 codes: `APPLY_FLAG_MISSING`, `CONFIRMATION_KEY_MISMATCH`, `LOW_CONFIDENCE_NOT_ACCEPTED`, `PLAN_REFERENCE_UNKNOWN`, `PLAN_REFERENCE_STALE`, `LOCK_HELD`, `MANIFEST_EXPIRED`, `MANIFEST_UNJOURNALED` — additions are amendments per FR-008), `GateFailure { code, detail }`, and `validatePlanReference(plan: StoredPlan, current: { fileHashes, headCommit })` pure predicate per engine-gates.md (JSDoc: "`confirmationKey` equality is exact-string against `config.confirmationKey` (default `SYNC`); the constant `SYNC` is never special-cased" — enforced in 008's evaluator; all gate failures reported together)
- [ ] T023 Implement `src/urls/attachment-url.ts`: `AttachmentUrlConfig`, `canonicalAttachmentUrl` (`<base-host>/<toolId>/<task-uuid>`), `continuationAttachmentUrl` (page n ≥ 1 → `.../<pageN>`), `parseAttachmentUrl` (returns `ParsedAttachmentUrl` canonical/continuation/null), `UrlSchemeError`; normalize base host (strip trailing `/` + whitespace, reject query/fragment/whitespace inside), validate UUID shape and `page` integer ≥ 1, enforce "template must contain its required placeholders" (`{baseHost}`, `{toolId}`, `{uuid}`; continuation additionally `{page}`), round-trip-inverse of builders including overridden templates (contracts/attachment-url-scheme.md all 4 behavior rules)
- [ ] T024 Implement `src/state/clock.ts`: `Clock` interface (`now(): Date` + monotonic elapsed helper) defaulting to system time, injectable through config into state paths; every time-based decision must take the clock as a parameter rather than calling `Date.now()` internally (research R16 — both user stories and all expiry/lock tests depend on this)

### Verification

- [ ] T025 Wire `src/index.ts` public entry re-exporting the frozen contract modules (`src/domain`, `src/config` stub exports from Phase 3 files may be added at the checkpoint of Phase 3; declare all planned names via the modules built so far); run `npm run build && npm run typecheck && npm run lint` and the contract/unit tests T008–T012 to GREEN; confirm `dist/` contains per-module `.js` + `.d.ts` and the `exports`/`types` map resolves

**Checkpoint**: Frozen contract surface complete and snapshot-enforced (FR-008). User stories US1 and US2 can now proceed in parallel.

---

## Phase 3: User Story 1 - Zero-surprise configuration (Priority: P1) 🎯 MVP

**Goal**: Layered configuration model — built-in defaults → JSON file → programmatic overrides, deep-merged deterministically; fail-fast and complete on misconfiguration (FR-006, FR-007; contracts/configuration.md is the normative behavioral contract; merge/load/validation semantics per research R3–R5).

**Independent Test**: "Layer defaults, a JSON file, and programmatic overrides over fixtures; assert deep-merge precedence, abort-on-invalid-file with the failure category, and abort-on-missing-required-identity naming every missing value — no subsystem beyond configuration loading needs to exist." (Run: `npm run test:integration -- --test-name-pattern "config"`)

### Tests for User Story 1 (write FIRST, ensure they FAIL) ⚠️

- [ ] T026 [P] [US1] Deep-merge unit tests in `tests/unit/config-merge.test.ts` per research R3: plain objects merge recursively; higher-precedence same-key values replace; "keys absent from higher sources retained (001 R17.3)"; "Arrays and scalars replace wholesale" (never concatenated or element-merged); "`null` is a value (replaces), `undefined` means 'absent' (ignored)"; and `canonicalizeConfig` sorted-key determinism — byte-identical output for identical inputs (SC-001)
- [ ] T027 [P] [US1] Config-file failure-category unit tests in `tests/unit/config-load.test.ts` per research R4: decision order — "path provided but stat-misses → `missing`; stat succeeds but read throws (EACCES, EISDIR) → `unreadable`; read succeeds but `JSON.parse` throws or the root is not a JSON object → `invalid-json`"; abort names the file path AND category; "No file path configured → defaults + overrides only" (still succeeds); a valid-file + invalid-file precedence fixture proves "no partial configuration from that file is applied" (FR-006, SC-002)
- [ ] T028 [P] [US1] Required-identity validation unit tests in `tests/unit/config-validate.test.ts` per research R5: `validateWorkspaceIdentity` collects **all** misses before failing — "team identities (≥1); for each team, ≥1 project identity and ≥1 workflow-state identity set; each `ProjectByPath` entry must carry both `teamKey` and `project`; default team and default project present and non-empty"; "Empty strings and empty arrays count as absent (001 R17.5)"; error carries structured `missing: string[]` with names like `"teams[acme].projects"`, `"defaultProject"`; no-fail-fast-on-first — every missing value named simultaneously (FR-007, SC-002)
- [ ] T029 [P] [US1] Layered-config integration tests in `tests/integration/config.test.ts` (test names contain "config"): precedence matrix over `tests/fixtures/config/` layerings (defaults-only / file-only / all-three, overlapping + disjoint keys); repeat-run byte-compare of `canonicalizeConfig(loadConfig(inputs))` proving SC-001 determinism; programmatic overrides win over file which wins over defaults; `toolId` derivations per configuration.md load behavior #5: `toolId` default `task-linear-sync` derives state-dir app segment, env-var prefix, config-file default path, bin name, `metadataNamespaceKey` (`__<toolId>`, avoiding Linear reserved keys `title`/`messages`/`attributes`), attachment title (`<toolId> sync state`), URL-template `toolId` segment — "each derivable value independently overridable (001 R17.9)"; credential rule: only env-var **names** are config — no credential value ever enters `ResolvedConfig` or canonicalized output

### Implementation for User Story 1

- [ ] T030 [US1] Implement `src/config/schema.ts`: `ResolvedConfig` complete type with all ten groups per data-model §17 (tool identity, discovery, grammar, routing, matching, tracker, attachment, sync semantics, run state, surfaces), `ConfigOverrides = DeepPartial<ResolvedConfig>`, `LoadConfigOptions { overrides?, configFile?, env?, clock? }`, `ConfigFailureCategory = "missing" | "unreadable" | "invalid-json"`, `ConfigFileError { category, configFilePath, detail? }` ("parse/OS diagnostic, sanitized"), `MissingIdentityError { missing: readonly string[] }` — reuse `ProjectByPathEntry`/team-identity types from `src/domain/routing.ts` (T015)
- [ ] T031 [US1] Implement `src/config/defaults.ts` exporting `builtInDefaults: ResolvedConfig` — "release-scan target: zero org literals" (data-model §17 defaults quoted verbatim): `toolId: "task-linear-sync"`; discovery (`specs/`, `.kiro/specs/` generic dirs, `tasks.md`/`TASKS.md`, skip `.git`, `node_modules`, `dist`, `.next`, `coverage`); grammar defaults + `tabWidth: 2`; **routing group has NO defaults** (`teams`, per-team `projects`/`workflowStates`, `projectByPath`, `defaultTeamKey`, `defaultProject` are validation-required); matching `confidenceFloors { medium: 50, plausible: 18 }`, `minimumMatchMargin: 10`, weights all ≥ 0; tracker `pageSize: 100`, `maxRetries: 5`, `concurrency: 4`, `personalKeyPrefix: "lin_api_"` (bare prefix constant only — never a token value), `credentialEnvVarNames { token: LINEAR_ACCESS_TOKEN, apiKey: LINEAR_API_KEY }`, `completedStateTypes: ["completed"]`, `ignoredStateTypes: ["canceled","duplicate"]`; attachment templates + benign placeholder `attachmentBaseHost` (`https://sync.example.invalid`), `historyLogMaxEntries: 50`; sync semantics `confirmationKey: "SYNC"` + conflict maps per data-model §7 built-in defaults; run state `auditManifestEnabled: true`, `auditManifestEncryptionEnabled: true`, `manifestExpiryDays: 30`, `staleLockTakeoverSeconds: 60`, `stateDirectory` unset (platform default computed in US2); surfaces `managedGitHooks: ["pre-push","post-merge"]`, `accessControlMode: "private"`, poll 15 s, cache TTL 10 s, `mutatingToolsEnabled: false`, transport `stdio`
- [ ] T032 [US1] Implement `src/config/merge.ts`: `deepMerge(lower, higher)` per R3 (recursive plain-object merge; arrays/scalars replace wholesale; `undefined` absent, `null` replaces) and `canonicalizeConfig(c): string` — "Deterministic canonical serialization: sorted keys, stable scalar formatting" (SC-001 byte-identity)
- [ ] T033 [US1] Implement `src/config/load.ts`: `loadConfig(o: LoadConfigOptions): ResolvedConfig` — layering "built-in defaults -> JSON file -> programmatic overrides (constitution III)"; category decision order per R4 (stat-miss → `missing`; read throw → `unreadable`; parse fail or non-object root → `invalid-json`), throws `ConfigFileError` naming path + category with "no partial configuration from that file applied"; injectable `clock` used for derived values only (R16)
- [ ] T034 [US1] Implement `src/config/validate.ts`: `validateWorkspaceIdentity(c: ResolvedConfig): void` throwing `MissingIdentityError` with the complete `missing` list per R5 (mirrors contracts/configuration.md normative list exactly; empty string / empty array count as absent)
- [ ] T035 [US1] Run `npm run test:unit -- --test-name-pattern "config"`, `npm run test:integration -- --test-name-pattern "config"`, `npm run test:contract`; extend `tests/contract/defaults-scan.test.ts` (contract scan per configuration.md § Test obligations + R15): `builtInDefaults` transitively contains no value matching real-identifier heuristics — "UUID-shaped values, `lin_api_`-prefixed **token values** (the bare `personalKeyPrefix` constant is exempt), long base64/hex secrets, email shapes" — and "the only host-like value is the benign placeholder (`*.example.invalid` class)"; update the T008 frozen-surface snapshot for `src/config` deliberately

**Checkpoint**: At this point User Story 1 is fully functional and testable independently — misconfiguration fixtures all abort with complete naming (SC-002), merged config is byte-deterministic (SC-001). This is the MVP.

---

## Phase 4: User Story 2 - Isolated, safe run state (Priority: P2)

**Goal**: Out-of-repo run-state lifecycle — state-directory placement by hash of canonical repo root with inside-repo refusal, owner-only atomic writes, manifest expiry (encryption-independent) + AES-256-GCM envelope contract, advisory run lock with the exact dead-pid AND aged takeover rule, create-intent-before-attempt bookkeeping, sanitized reports + last-run marker (FR-001–FR-005; contracts/run-state.md is the normative behavioral contract; research R6–R10).

**Independent Test**: "Run with default and configured state directories against two repository fixtures; assert placement, naming-by-root-hash, expiry of an aged manifest, lock takeover only when the pid is dead **and** the age threshold is exceeded, and create-intent records written before a simulated creation." (Run: `npm run test:integration -- --test-name-pattern "state"`)

### Tests for User Story 2 (write FIRST, ensure they FAIL) ⚠️

- [ ] T036 [P] [US2] State-placement unit tests in `tests/unit/state-paths.test.ts` per research R6: configured `stateDirectory` "used verbatim after canonicalization"; platform default base "`$XDG_STATE_HOME` or `~/.local/state` (Linux), `~/Library/Application Support` (macOS), `%APPDATA%` (Windows)"; final path `<base>/<toolId>/<hash16>` where hash16 is "the first 16 hex chars of `sha256` over the canonical absolute repository root path (realpath, relative segments and symlinks resolved, UTF-8)"; inside-repo rule: resolved path inside **or equal to** the canonical repository root aborts `StatePlacementError`, never falls back to an in-tree location (FR-001, edge case)
- [ ] T037 [P] [US2] State-fs unit tests in `tests/unit/state-fs.test.ts` per research R7: directory created `0o700` ("recursive creation applies it to every created level"); file written via "sibling temp file in the same directory, `chmod 0o600`, then `rename()` over the target"; permissions re-applied post-rename; JSON codecs "reject non-object roots"; concurrent reader observes "old-or-new content only" (no torn reads) (POSIX-permission assertions only run on POSIX runners per quickstart)
- [ ] T038 [P] [US2] Lock-matrix unit tests in `tests/unit/state-lock.test.ts` per research R8 (test name contains "lock matrix"): fresh exclusive create wins; live pid → refuse `reason: "live-process"`; dead pid within 60 s → refuse `reason: "within-stale-window"`; dead pid past `staleLockTakeoverSeconds` (default 60, injected clock) → takeover with `tookOverStale: true`; `EPERM` on the `process.kill(pid, 0)` probe "counts as *alive*"; `releaseRunLock` releases only when recorded `runId` matches (FR-003, SC-004 "live process never loses the lock")
- [ ] T039 [P] [US2] Two-process lock-race integration test in `tests/integration/state-lock-race.test.ts` (spawned child processes per quickstart): simultaneous contenders against a dead-pid aged lock → "exactly one winner", loser gets `acquired: false` and "reports and exits"; also live-pid contention → zero takeovers (SC-004 "0 false takeovers")
- [ ] T040 [P] [US2] Manifest expiry/envelope unit tests in `tests/unit/state-manifest.test.ts` per research R9: aged manifest (injected clock +31 d) expired with encryption **on and off**, ≤30 d valid (FR-002); expiry evaluated from the unencrypted `createdAt` header — "expired is decidable without key material"; `sealManifest`→`openManifest` round-trip (AES-256-GCM, envelope `{ schemaVersion: 1, keyId, iv, tag, ciphertext }` all base64 where binary); tampered tag → `ManifestTamperError` returning NO plaintext; `KeyProvider.getKey` returning null → "abort, key unavailable" with no manifest I/O
- [ ] T041 [P] [US2] Intent + marker lifecycle unit tests in `tests/unit/state-intent-marker.test.ts`: after `writeCreateIntentBeforeAttempt` resolves, `stat` immediately proves `intents/<intentId>.json` exists on disk with `status: "pending"` (FR-004 crash-window guarantee, R10); status transitions are read-modify-atomic-write and `listIntentsByTask(taskUuid)` indexed lookup works; `writeRunReports` writes sanitized pair under `reports/<runId>/{report.json,report.md}`, refuses values containing secret-keyed material the screener flags, atomically updates `last-run.json` referencing the completed run, and `readLastRunMarker` returns it (FR-005)
- [ ] T042 [P] [US2] Placement + in-tree-refusal integration tests in `tests/integration/state-placement.test.ts` (test names contain "state"): default placement across `tests/fixtures/repos/repo-a` and `repo-b` → distinct `<platform-base>/task-linear-sync/<sha16>` dirs; configured `stateDirectory` used verbatim; configured path inside repo root AND `stateDirectory === repoRoot` both abort `StatePlacementError`; after all state operations, walk both fixture repos asserting **0** created files or directories (SC-003)

### Implementation for User Story 2

- [ ] T043 [US2] Implement `src/state/fs.ts`: owner-only atomic write primitive used by every state write per R7 — `ensureDir0700` (recursive, mode applied to every created level), `atomicWriteJson` (sibling temp + `chmod 0o600` + `rename()` + post-rename permission re-apply), JSON read codec rejecting non-object roots (returns `null` for ENOENT)
- [ ] T044 [US2] Implement `src/state/paths.ts`: `resolveStateDir(repositoryRoot, config)` per R6 — configured verbatim-after-canonicalization else `<platform-base>/<toolId>/<sha16>` (sha256 of canonical absolute repo root, first 16 hex, realpath + symlink resolution, UTF-8); `StatePlacementError` when the resolved path is inside or equal to the canonical repo root ("never falls back to an in-tree location"); `createStateStore(options: StateStoreOptions): StateStore` composing `root`, the eight `paths` entries (`lock.json`, `sync-state.json`, `plans/`, `manifests/`, `intents/`, `reports/`, `last-run.json`, `pending-job.json`) and `ensure()`/`writeJson`/`readJson` over `fs.ts` primitives, with injected `clock` (contracts/run-state.md StateStore block)
- [ ] T045 [US2] Implement `src/state/lock.ts`: `acquireRunLock(store, runId)` / `releaseRunLock(store, record)` per R8 — exclusive create `O_CREAT|O_EXCL` fast path; on EEXIST read `lock.json` and take over **only if** `process.kill(pid, 0)` raises ESRCH (EPERM = alive) **AND** `now - acquiredAt > staleLockTakeoverSeconds` (injected clock), both required exactly; takeover = compare recorded `runId` before atomic unlink + retry exclusive create so simultaneous contenders resolve single-winner; return `LockAcquisition` union with `reason: "live-process" | "within-stale-window"` (FR-003)
- [ ] T046 [US2] Implement `src/state/manifest.ts`: `ManifestEnvelope` codec (`{ schemaVersion: 1, keyId, iv, tag, ciphertext }` base64 + unencrypted `createdAt` header field per R9), `KeyProvider` interface, `sealManifest`/`openManifest` via `node:crypto` AES-256-GCM over canonical JSON ("key never stored with ciphertext; tag failure on open() rejects with `ManifestTamperError` and returns NO plaintext"), encryption-off path = plain JSON manifest still atomic + owner-only, and `isManifestExpired(env | { createdAt }, cfg, clock)` — "elapsed(clock.now, createdAt) > manifestExpiryDays (default 30) — evaluated regardless of encryption state" (FR-002; journaling behavior exercised end-to-end by 008)
- [ ] T047 [US2] Implement `src/state/intent.ts`: `writeCreateIntentBeforeAttempt(store, intent)` persisting `status: "pending"` via the atomic write and resolving **only after the rename completes** (R10 crash-window rule); `updateCreateIntentStatus(store, intentId, status)` read-modify-atomic-write; `listIntentsByTask(store, taskUuid)` via the taskUuid index for 008's reconciliation queries; records keyed by `intentId` under `intents/` (FR-004)
- [ ] T048 [US2] Implement `src/state/marker.ts`: `writeRunReports(store, runId, reports, screener, marker)` — runs both artifacts through the injected `SecurityScreener` and "refuses values containing configured secret-keyed material", writes sanitized pair under `reports/<runId>/` then atomically updates `last-run.json` referencing the completed run (returns the updated `LastRunMarker` with `reportPaths` + clock-stamped `completedAt`); `readLastRunMarker(store)`; never writes inside the repository tree (FR-005)
- [ ] T049 [US2] Run `npm run test:unit -- --test-name-pattern "state|lock|manifest|intent"`, `npm run test:integration -- --test-name-pattern "state"`, update the T008 frozen-surface snapshot for `src/state` deliberately; full `npm test` green

**Checkpoint**: US1 AND US2 both work independently. SC-003 proven (0 in-tree files across fixture walk), SC-004 proven (lock matrix + race). 008/010 can build over these primitives.

---

## Phase 5: Polish & Cross-Cutting Concerns

**Purpose**: Whole-feature enforcement and documentation duty.

- [ ] T050 [P] Create negative-type assertion files `tests/types/*.test-d.ts` compiled by `npm run typecheck` per quickstart "Gate sanity (types as tests)": read-only command result types expose no mutation surface; `applySyncPlan` requires a full `GateRequest` argument; `LinearPort` is the only tracker-typed dependency injectable into engine options (constitution V compile-checked)
- [ ] T051 [P] Create scripted e2e walkthrough `tests/e2e/user-stories.test.ts` per plan.md (`tests/e2e/`): config load from fixture → state-dir creation → lock acquire/release → intent write → reports + marker → lock release, all with injected clock and zero network (spec user stories end-to-end)
- [ ] T052 [P] Author documentation per constitution "Documentation duty": `README.md` install/usage + `docs/configuration.md` covering the config model (defaults + consumer-required workspace identities, placeholder identifiers only), `docs/contract-amendments.md` stating the FR-008 amendment rule ("contract doc + `src/` module + contract-test snapshot updated together, noted against 001")
- [ ] T053 Verify `npm test` (all tiers + coverage threshold gate) and `npm run build` green: confirm ESM + per-module `.d.ts` output and that `exports`/`types` fields resolve for every frozen module (quickstart "Exit criteria for this feature")
- [ ] T054 Run the full quickstart.md validation checklist: US1 scenarios 1–4, US2 scenarios 1, 1b, 2–6, contract-freeze scenarios 1–4, and record SC-001–SC-004 traceability results

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately (repo is currently empty)
- **Foundational (Phase 2)**: Depends on Setup — **BLOCKS all user stories** (US1's `schema.ts` imports routing/team types from `domain/routing.ts`; US2's state modules import `domain/run-records.ts` types and config types; both inject `state/clock.ts`)
- **User Stories (Phases 3–4)**: Both depend only on Foundational completion → can proceed **in parallel** (US1: `src/config/*`; US2: `src/state/*` — disjoint file sets)
- **Polish (Phase 5)**: Depends on all desired stories

### User Story Dependencies

- **US1 (P1)**: After Phase 2; zero dependency on US2 ("no subsystem beyond configuration loading needs to exist")
- **US2 (P2)**: After Phase 2; consumes `ResolvedConfig` **types** from T030/T031 but is independently testable with a hand-constructed config object; no runtime coupling to config loading

### Within Each User Story

- Tests written first and observed FAILING (constitution VI), then implementation
- Models/types before services; `fs.ts` before `paths.ts`/`lock.ts`/`intent.ts`/`marker.ts`; `clock.ts` (T024, Foundational) before all time-based logic
- Story checkpoint green before claiming completion

### Parallel Opportunities

- Setup: T003–T007 in parallel after T001/T002
- Foundational: T008–T012 (all test files) in parallel; T013–T019 (domain modules, disjoint files) in parallel; T020 in parallel with the domain batch
- US1: T026–T029 (test files) in parallel
- US2: T036–T042 (test files) in parallel
- US1 and US2 implementation tracks fully parallel after Phase 2 (different directories, no shared files)
- Polish: T050–T052 in parallel

---

## Parallel Example: User Story 2

```bash
# Launch all US2 tests together (RED first):
Task: "State-placement unit tests in tests/unit/state-paths.test.ts"               # T036
Task: "State-fs unit tests in tests/unit/state-fs.test.ts"                          # T037
Task: "Lock-matrix unit tests in tests/unit/state-lock.test.ts"                     # T038
Task: "Two-process lock-race integration test in tests/integration/state-lock-race.test.ts"  # T039
Task: "Manifest expiry/envelope unit tests in tests/unit/state-manifest.test.ts"    # T040
Task: "Intent + marker lifecycle tests in tests/unit/state-intent-marker.test.ts"   # T041
Task: "Placement + in-tree-refusal integration tests in tests/integration/state-placement.test.ts"  # T042

# Then implement bottom-up (fs first, then store, then consumers):
Task: "Implement src/state/fs.ts"          # T043
Task: "Implement src/state/paths.ts"       # T044 (uses T043)
# After T044: T045 lock.ts, T046 manifest.ts, T047 intent.ts, T048 marker.ts in parallel
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories; also the feature's headline deliverable per FR-008)
3. Complete Phase 3: US1 configuration
4. **STOP and VALIDATE**: `npm run test:integration -- --test-name-pattern "config"` + defaults scan green; misconfiguration fixtures abort completely (SC-002)
5. Wave-2 features (003–007) can already start against the frozen surface from step 2

### Incremental Delivery

1. Setup + Foundational → contracts frozen and snapshot-enforced; Wave 2 unblocked
2. Add US1 → config model live, deterministic + fail-fast → demo (MVP)
3. Add US2 → run-state lifecycle live, out-of-repo by construction → full feature exit criteria (quickstart) reachable
4. Polish → type-level assertions, e2e walkthrough, docs, full-suite coverage gate

### Parallel Team Strategy

1. One dev: Setup + Foundational (sequential, it's the freeze)
2. Then split: Dev A: US1 (`src/config`); Dev B: US2 (`src/state`)
3. Reunite for Phase 5 (cross-cutting snapshot, e2e, docs)

---

## Notes

- [P] tasks = different files, no dependencies
- Tests are mandatory in this feature (constitution VI "NON-NEGOTIABLE"); verify RED before GREEN at each story checkpoint
- The T008 frozen-surface snapshot is amended only deliberately, with a note against 001 (FR-008 / ROADMAP rule 2) — never silently
- Zero real organization identifiers/tokens/UUIDs in shipped defaults and fixtures (release-gate scan, T031 + defaults scan test)
- Credential rule everywhere: only env-var **names** are config; values are read at use time (constitution credential handling)
- Commit after each task or logical group; stop at any checkpoint to validate a story independently
- Avoid: same-file conflicts between [P] tasks, cross-story coupling between `src/config` and `src/state` (US2 tests hand-construct config objects rather than calling `loadConfig`)
