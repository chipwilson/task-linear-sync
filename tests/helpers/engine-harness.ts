/**
 * T003 — Shared hermetic harness for all 008 sync-engine tests (`008-sync-engine-apply-rollback`).
 *
 * Implements the quickstart.md "Harness" section: fixture-repo builder
 * (`tests/fixtures/engine/worlds/<world>/`), seeded fake `LinearPort` world (007
 * `createFakeLinearPort`), temp-directory `StateStore` (outside the fixture repo — the frozen
 * `StateStore` placement aborts in-tree paths), a fixed injected `Clock`, and injector seams
 * for scripted create failures and rollback interruption at an exact port-call index.
 *
 * IMPORTANT WIRING SEAM: this file COMPILES WITHOUT `src/engine` existing. It never imports
 * `src/engine/**` or `task-linear-sync/engine` — the engine factory is INJECTED via
 * `attachEngine(world, factory, options?)`, typed generically against the frozen
 * `SyncEngine`/`EngineDependencies` interfaces from `task-linear-sync/ports`.
 *
 * ```ts
 * import { buildWorld, attachEngine } from "../helpers/engine-harness.js";
 *
 * test("apply then rollback", async () => {
 *   const w = await buildWorld("rollback-full");
 *   try {
 *     const { createSyncEngine } = await import("../../src/engine/create.js"); // test-side import
 *     const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
 *     const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
 *     // ... gates, apply, rollbackRun; assert on w.calls / w.fake.world ...
 *   } finally {
 *     await w.dispose();
 *   }
 * });
 * ```
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * PUBLIC API (contract for test + fixture-authoring lanes — T017/T031 author worlds against this)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Build & wiring
 * - `buildWorld(nameOrDir, options?): Promise<EngineWorld>` — resolves a bare world name under
 *   `tests/fixtures/engine/worlds/<name>/` (an existing directory path passes through), reads
 *   and STRICTLY validates `world.json`, materializes `repo/` into a temp tree
 *   (`mkdtemp(tmpdir()/tls-008-<world>-)`, `repo/` + `state/`), creates the temp `StateStore`,
 *   the `FakeClock`, the seeded `FakeLinearPort` (behind the instrumented decorator port), and
 *   auto-arms `world.json` `createFailures`. Options:
 *   `{ config?: ConfigOverrides; screener?: SecurityScreener; start?: string; env?: Record<string,string> }`
 *   — `config` merges AFTER `world.json` `config` but BEFORE the harness-owned `stateDirectory`
 *   (setting `stateDirectory` anywhere else is a fixture/test error; the harness owns placement).
 *   ALWAYS `await w.dispose()` in a `finally` (temp-tree cleanup).
 * - `attachEngine<O>(world, factory: (deps: EngineDependencies, options?: O) => SyncEngine, options?: O): SyncEngine`
 *   — calls `factory(world.deps, options)` and wraps the returned engine so every method
 *   invocation tracks `world.phase` (`"buildSyncPlan" | "applySyncPlan" | "rollbackRun" | "idle"`),
 *   resets the per-invocation port-call counter (the currency of `armInterrupt`), and appends to
 *   `world.phaseLog`. Safe to call multiple times per world (e.g. a fresh engine per resume).
 *   `O` is generic precisely so no `EngineOptions` import (nor `src/engine`) is needed here;
 *   tests pass `{ keyProvider: w.keyProvider }` (or omit for the engine's default provider, see
 *   "Manifest keys" below).
 * - `EngineWorld` — the deps bag + handles: `name`, `fixtureDir` (source worlds/<world>/),
 *   `expectedDir` (= `fixtureDir/expected`, may be absent), `root` (temp tree root: `repo/` +
 *   `state/`), `repositoryRoot` (temp repo copy — pass to `buildSyncPlan`), `stateDir`,
 *   `config: ResolvedConfig`, `clock: FakeClock` (advanceable), `screener`, `state: StateStore`,
 *   `fake: FakeLinearPort` (raw fake: `fake.world` maps, `scriptFailure`, conformance handles),
 *   `port: LinearPort` (decorated, wired into deps), `deps: EngineDependencies`, `keyProvider`,
 *   `env` (manifest-key env view), `phase`, `phaseLog`, `calls`, `requests()`, `dispose()`.
 * - `world.deps.screener` defaults to `makeScreener()` from `tests/helpers/test-utils.ts`
 *   (`SECRET\d+` redacts; `BLOCKED` blocks). Override per test via `options.screener`.
 *
 * Call log (mutation / zero-mutation assertions — constitution I + SC-001)
 * - `world.calls: readonly PortCallRecord[]` — EVERY decorated port call in order:
 *   `{ seq, method, args, phase, ok, error? }`. Granularity: ONE record per port-member
 *   invocation (`listIssues` counts once even when paginated; attempt-level parity — each page
 *   fetch, each failed retry — remains on `world.requests()` = `fake.requests()`). `args` are
 *   live references (never a deep copy): never mutate them.
 * - `world.port` records to `world.calls`; the fake ALSO keeps its own `fake.callLog` for calls
 *   that reach it. Harness-thrown injectors never reach the fake, so `world.calls` is the
 *   authoritative "what did the engine ATTEMPT" log; `ok: false` + `error` mark injected/thrown
 *   failures.
 * - `callsMark(world): number`, `callsSince(world, mark)`, `callsOf(world, method, sinceMark?)`,
 *   `mutationCalls(world, sinceMark?)` and `MUTATING_PORT_METHODS` (`createIssue`,
 *   `updateIssue`, `archiveIssue`, `upsertAttachmentByUrl`, `updateAttachment`) — e.g. build
 *   purity: `assert.deepEqual(mutationCalls(w), [])`; zero-replay: mark before resume, assert
 *   `callsOf(w, "createIssue", mark).length === 0`.
 *
 * Injectors (mechanics — all deterministic, all fired through the decorated port)
 * - Scripted create failures (quickstart 2.2, `indeterminate-create`): armed from
 *   `world.json createFailures` entries or at runtime via `armCreateFailure(world, spec)`.
 *   Mechanics: the decorated `createIssue` matches `CreateIssueInput` material against the
 *   spec's predicates (AND). When the number of MATCHED calls reaches `nth` (1-based) and the
 *   spec has fired fewer than `times` times (defaults 1/1), the decorator throws
 *   `HarnessCreateFailureError` WITHOUT delegating — the fake never sees the call, the world is
 *   unchanged, `world.calls` records the attempt with `ok: false`. Never auto-replayed by the
 *   harness itself. Reconciliation outcomes (data-model §8) are controlled by the SEEDED world,
 *   not the injector: `findIssuesByAttachmentUrl(canonicalUrl)` finds exactly the seeded
 *   attachments carrying that URL — seed one ⇒ adopt; seed none ⇒ 0 matches ⇒ indeterminate;
 *   seed two on different issues ⇒ >1 integrity signal. For transport-shaped errors instead
 *   (fake-native `IndeterminateCreateError`), use `world.fake.scriptFailure("createIssue",
 *   { atCall, kind })`.
 * - Rollback interruption at an exact step index (quickstart 2.4, `rollback-interrupted`):
 *   `armInterrupt(world, { phase, atCall, once? })` arms a port-call-counting guard. Mechanics:
 *   while `attachEngine`'s wrapper has `world.phase === phase`, EVERY decorated port-member
 *   invocation increments a per-engine-invocation counter; when the counter equals `atCall`
 *   (1-based) the guard throws `HarnessInterruptError` once (default `once: true` — the guard
 *   disarms after firing, so a subsequent `rollbackRun(...)` behaves normally = "crash at step
 *   N, then resume"). `once: false` re-arms on every engine invocation until `disarm()`. The
 *   handle exposes `{ disarm(), fired, armed }` — assert `fired === 1` to prove the injection
 *   actually landed (an `atCall` beyond the phase's call count never fires). Guards for phases
 *   other than the running one are inert. REQUIRES an `attachEngine`-wrapped engine (phase
 *   tracking lives in the wrapper).
 * - Corrupted step state (rollback conflict-halt cell, FR-014): `corruptRunStepState(world,
 *   runId, opts)` opens the 008-local step journal `runs/<runId>/journal.json` (sealed envelope
 *   — `openManifest` with `world.keyProvider`; plain-JSON artifacts pass through), selects the
 *   step by `opId` or 0-based `stepIndex`, and by default forces `stepState: "applied"` and
 *   replaces BOTH `beforeSnapshot`/`afterSnapshot` with a sentinel object — so live state
 *   matches NEITHER snapshot ⇒ the frozen guard must yield `conflict-halted` + `status
 *   "partial"`. Custom surgery via `opts.mutate(step)`. Re-sealed with the same key provider
 *   (side effect: envelope `createdAt` header refreshes — expiry restarts; call
 *   `advancePastManifestExpiry` AFTER corrupting when both conditions matter).
 * - Envelope tamper (no-plaintext refusal): `tamperRunArtifact(world, runId, "manifest" |
 *   "journal")` flips a byte inside the ciphertext of the sealed envelope file (plain JSON:
 *   annotates the object) so `openManifest` rejects with `ManifestTamperError`.
 * - Lock pre-seed (LOCK_HELD): `holdRunLock(world, runId)` acquires the advisory lock via the
 *   frozen `acquireRunLock` and DOES NOT release — same-process pid ⇒ provably alive ⇒ the
 *   engine's apply must refuse with `LOCK_HELD`. Release in tests via the frozen
 *   `releaseRunLock(world.state, record)`.
 * - Expiry (MANIFEST_EXPIRED): `advancePastManifestExpiry(world, extraDays?)` advances the
 *   injected `FakeClock` past `config.manifestExpiryDays` (clock-injected, encryption-
 *   independent; frozen `isManifestExpired` uses strict `>` so the default +1 day matters).
 *
 * Journal/manifest reading (assertions on FR-015 completeness, step states, fileBackups)
 * - `openRunManifest(world, runId)` / `openRunJournal(world, runId)` — resolve the artifact
 *   path (manifest candidate order: `manifests/<runId>.json`, then `manifests/<runId>.manifest.json`;
 *   journal: `runs/<runId>/journal.json`), open the sealed envelope when present (plain JSON
 *   returned verbatim; the envelope's `{ createdAt, manifest }` plaintext wrapper is unwrapped
 *   for you), and return the parsed value typed by the caller's type parameter. Throws
 *   `EngineFixtureError` listing the candidates when the artifact does not exist.
 *
 * State-store pre-seeding / inspection
 * - `seedCheckpoints(world, Record<taskUuid, Checkpoint>)` / `readCheckpointStore(world)` /
 *   `hasCheckpoints(world)` / `clearCheckpoints(world)` — the 008 checkpoint file
 *   `sync-state.json` (`{ schemaVersion: 1, checkpoints }`, data-model §1), read/written through
 *   the frozen `StateStore.readJson`/`writeJson` exclusively. Worlds that need `sync`-mode
 *   classification either bootstrap-apply first or seed checkpoints directly (hashes:
 *   `sha256Hex(normalizedText)` — normalization lives in `src/engine`, so test lanes that
 *   pre-seed hashes compute them with their own copy of the profile rule set; `sha256Hex` is
 *   exported).
 * - Create intents / lock records / reports / expiry predicates: use the frozen helpers
 *   directly (`writeCreateIntentBeforeAttempt(world.state, …)`, `listIntentsByTask`,
 *   `readLastRunMarker`, `isManifestExpired(env, world.config, world.clock)`,
 *   `sealManifest`/`openManifest`) — everything takes `world.state` / `world.config` /
 *   `world.clock`.
 * - `world.env` contains `{ [config.manifestKeyEnvVarName]: <64-char lowercase hex> }` (default
 *   `TASK_LINEAR_SYNC_MANIFEST_KEY`). Manifest keys: `world.keyProvider` is a deterministic
 *   32-byte `KeyProvider` keyed by `config.manifestKeyId` — the key value is
 *   `sha256("task-linear-sync/008-harness/test-manifest-key/<keyId>")`, a placeholder, NEVER a
 *   credential (Principle III). PASS IT EXPLICITLY (`attachEngine(w, createSyncEngine, {
 *   keyProvider: w.keyProvider })`): the engine's default env-var provider's decoding of the
 *   env string is an engine decision (T008), so the env value is offered as plain hex — the
 *   injected provider is the guaranteed-deterministic path (to test the unavailable-key abort,
 *   pass your own null-returning `KeyProvider` as an engine option).
 *
 * Fixture / expected artifacts, URLs, ids
 * - `fixtureFile(world, rel)` / `expectedFile(world, rel)` — absolute source-tree paths;
 *   `readExpectedJson<T>(world, rel)` for golden fragments. `world.repositoryRoot` is a TEMP
 *   COPY — tests mutate the copy freely; the fixture source tree is never written.
 * - `attachmentUrlFor(world, taskUuid)` / `historyPageUrlFor(world, taskUuid, page)` — frozen
 *   `canonicalAttachmentUrl`/`continuationAttachmentUrl` under `world.config` (defaults resolve
 *   to `https://sync.example.invalid/task-linear-sync/<uuid>[/<page>]`).
 * - `uuidFromLabel(label)` — deterministic uuid-from-label seed helper: sha256 over
 *   `"tls-008-fixture:" + label`, formatted into uuid shape with forced version-4 / variant-8
 *   nibbles. Identical label ⇒ identical uuid in every environment. Fixture hygiene (Principle
 *   III): world JSON is static, so the convention there is the 007 fake's synthetic scheme
 *   `ac000000-0000-4000-8000-<12 decimal digits>` (`syntheticUuid(index)` is re-exported);
 *   test-side ad-hoc ids use `uuidFromLabel`. Zero real org ids / team keys / tokens / UUIDs.
 * - `sha256Hex(text)` — exported for golden-hash assertions.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * `world.json` SCHEMA (this docblock is the authority; unknown keys ABORT with EngineFixtureError)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * Top level (every field optional; absent ⇒ empty world, all port members still respond):
 * - `$comment?: string` — ignored, for fixture annotations.
 * - `name?: string` — must equal the directory name when present (copy-paste guard).
 * - `clock?: string` — ISO-8601 start for the injected `FakeClock` (default `HARNESS_START_ISO`
 *   = `2026-01-01T00:00:00.000Z`). The fake port stamps mutation `updatedAt` values from its own
 *   deterministic tick (`2026-01-01T00:00:0X.000Z`) — seed issue `updatedAt` values accordingly
 *   or drive recency scenarios with `world.clock.advanceMs/advanceDays`.
 * - `teams?: [{ key, id, projects: [{ id, name }], workflowStates: [{ id, name, type }] }]`
 *   — per-team metadata collections (007 FR-002): `discoverMetadata` sources, completion-state
 *   name→id resolution, and the fake's team/project existence checks. Placeholder keys/ids only.
 * - `issues?: [{ id, key, teamKey, projectId, title, description, stateType, updatedAt, archived? }]`
 *   — `IssueView` seeds (field-for-field; `updatedAt` ISO-8601; `title`/`description` may be
 *   empty strings, all others non-empty).
 * - `attachments?: [{ issueId, id, url, title, subtitle?, metadata }]` — attachment seeds
 *   (metadata flat: string|number values only, by the frozen port contract). `url` values MUST
 *   be built with `canonicalAttachmentUrl`/`continuationAttachmentUrl` under the effective
 *   config (fixture authors write the literal default-host form). Tool-owned attachments carry
 *   `metadata["__<toolId>"]` (default key `__task-linear-sync`); the `findIssuesByAttachmentUrl`
 *   outcome for a canonical URL is exactly the count of seeded attachments with that URL
 *   (0 ⇒ indeterminate, 1 ⇒ adopt, >1 ⇒ integrity — pair with `createFailures`).
 * - `scriptedFailures?: { "<portMethod>": FailureScript | FailureScript[] }` — passed VERBATIM
 *   to the 007 fake (`{ atCall, kind, then? }`, 1-based per-method call counts; kinds
 *   `http-429-retryAfter | http-5xx | network | graphql-userError`; a retryable `createIssue`
 *   failure surfaces the fake's `IndeterminateCreateError`). Method names validated against the
 *   frozen `LinearPort` members.
 * - `createFailures?: ScriptedCreateFailure[]` — harness-level create-failure scripts, see
 *   below. Predicates are evaluated against `CreateIssueInput` material ONLY (the engine
 *   passes teamKey/projectId/title/description/stateType/parentId — identity URLs appear on
 *   `upsertAttachmentByUrl`, never on the create input), which is why `issueSeed`/
 *   `attachmentUrl` resolve THROUGH the seeded world to the matching title.
 * - `pageSize?: int>0`, `maxRetries?: int>=0` — fake knobs (defaults 250 / 5), passed through.
 * - `config?: ConfigOverrides` — deep-partial `ResolvedConfig` merged as the programmatic layer
 *   over built-in defaults (`loadConfig`). THIS is where worlds declare routing identities
 *   (`teams`, `projectByPath`, `defaultTeamKey`, `defaultProject`), `confirmationKey`, conflict
 *   maps (`bootstrapConflictMap`/`syncConflictMap`), `historyLogMaxEntries`/`historyLogMaxBytes`,
 *   `completedStateTypes`, `toolId`, etc. `stateDirectory` is FORBIDDEN here (harness-owned).
 * - `metadata?: Record<string, string|number|boolean>` — free-form annotation, ignored.
 *
 * `ScriptedCreateFailure` entry (at least ONE of `issueSeed`/`attachmentUrl`/`title`/
 * `titleIncludes`/`descriptionIncludes`/`teamKey`/`projectId` is required; all listed predicates
 * must match — AND):
 * - `issueSeed?: string` — id OR key of an issue in THIS world's `issues[]`; resolves to that
 *   seed's `title` (missing seed ⇒ fixture error).
 * - `attachmentUrl?: string` — url of an attachment in THIS world's `attachments[]`; resolves
 *   url → carrier issue seed → `title` (missing either ⇒ fixture error). When both are present
 *   the resolved titles must agree.
 * - `title?: string` / `titleIncludes?: string` — exact / substring match on the create title.
 * - `descriptionIncludes?: string` — substring of the create description (unique placeholder
 *   text from the task section).
 * - `teamKey?: string` / `projectId?: string` — routing predicates.
 * - `nth?: int≥1` — fail the nth MATCHED create call (default 1); `times?: int≥1` — number of
 *   consecutive matched calls to fail from `nth` onward (default 1).
 *
 * Full example (`worlds/indeterminate-create/world.json`):
 *
 * ```json
 * {
 *   "name": "indeterminate-create",
 *   "clock": "2026-01-01T00:00:00.000Z",
 *   "teams": [
 *     {
 *       "key": "TEAM-A",
 *       "id": "ac000000-0000-4000-8000-000000000101",
 *       "projects": [{ "id": "proj-alpha", "name": "Project Alpha" }],
 *       "workflowStates": [
 *         { "id": "ac000000-0000-4000-8000-000000000201", "name": "Todo", "type": "started" },
 *         { "id": "ac000000-0000-4000-8000-000000000202", "name": "Done", "type": "completed" },
 *         { "id": "ac000000-0000-4000-8000-000000000203", "name": "Backlog", "type": "backlog" }
 *       ]
 *     }
 *   ],
 *   "issues": [
 *     {
 *       "id": "ac000000-0000-4000-8000-000000000301",
 *       "key": "SYN-301",
 *       "teamKey": "TEAM-A",
 *       "projectId": "proj-alpha",
 *       "title": "Already-synced task",
 *       "description": "Placeholder body for the synced task.\n",
 *       "stateType": "started",
 *       "updatedAt": "2026-01-01T00:00:01.000Z"
 *     }
 *   ],
 *   "attachments": [
 *     {
 *       "issueId": "ac000000-0000-4000-8000-000000000301",
 *       "id": "att-seed-1",
 *       "url": "https://sync.example.invalid/task-linear-sync/ac000000-0000-4000-8000-000000000401",
 *       "title": "task-linear-sync sync state",
 *       "metadata": { "__task-linear-sync": 1, "taskUuid": "ac000000-0000-4000-8000-000000000401" }
 *     }
 *   ],
 *   "createFailures": [
 *     { "titleIncludes": "Never-created task", "nth": 1, "times": 1 }
 *   ],
 *   "scriptedFailures": {},
 *   "pageSize": 250,
 *   "config": {
 *     "teams": { "TEAM-A": { "teamKey": "TEAM-A" } },
 *     "projectByPath": [{ "pathPrefix": "specs/demo", "teamKey": "TEAM-A", "project": "proj-alpha" }],
 *     "defaultTeamKey": "TEAM-A",
 *     "defaultProject": "proj-alpha",
 *     "completedStateTypes": ["completed"],
 *     "historyLogMaxEntries": 50
 *   },
 *   "metadata": { "scenario": "create attempt throws; identity lookup by canonical URL finds 0" }
 * }
 * ```
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * Fixture world directory layout (tests/fixtures/engine/README.md is the hygiene contract)
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * - `repo/` — spec-side files materialized into the temp fixture repo (REQUIRED by convention;
 *   absent ⇒ empty temp repo, for scratch worlds only).
 * - `world.json` — REQUIRED; schema above; placeholders only (Principle III).
 * - `expected/` — optional goldens; the harness exposes paths only, comparison is test-side.
 * - `README.md` — one-paragraph scenario description (convention; the harness does not read it).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * Constraints every consumer must respect
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * 1. NEVER import `src/engine/**` (or `task-linear-sync/engine`) from this harness — engine
 *    code enters ONLY through `attachEngine`. Test lanes may import the engine directly (their
 *    file, their rules) but must hand the factory to `attachEngine`, never build deps by hand.
 * 2. `armInterrupt` only fires against `attachEngine`-wrapped engines; per-invocation counters
 *    RESET on every engine-method entry (arm → call → guard sees a fresh count).
 * 3. One world per test (temp dirs + placement aborts); always `await w.dispose()` in a
 *    `finally`. Worlds are hermetic: zero network, zero credentials, zero wall-clock.
 * 4. `world.calls.args` hold live references — assert against them, do not mutate.
 * 5. Manifest/journal artifact paths follow contracts/journal-rollback.md §1; the manifest
 *    reader accepts BOTH `manifests/<runId>.json` (contract) and `manifests/<runId>.manifest.json`
 *    (state/paths.ts comment) — first existing wins; new spellings must be added HERE, not
 *    forked per test file.
 * 6. Screening posture: the default screener is the shared test screener (`makeScreener`).
 *    Engine screening tests (T039) pass their own `options.screener` and assert on what
 *    `world.calls` shows reached the port.
 *
 * Header task IDs: T003 (Phase 1 shared infrastructure).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { ConfigOverrides, ResolvedConfig } from "task-linear-sync/config";
import { loadConfig } from "task-linear-sync/config";
import type { Checkpoint } from "task-linear-sync/domain";
import type {
  CreateIssueInput,
  EngineDependencies,
  LinearPort,
  SecurityScreener,
  SyncEngine,
} from "task-linear-sync/ports";
import type { KeyProvider, ManifestEnvelope, RunLockRecord, StateStore } from "task-linear-sync/state";
import { acquireRunLock, createStateStore, openManifest, sealManifest } from "task-linear-sync/state";
import type {
  FakeAttachmentSeed,
  FakeIssueSeed,
  FakeLinearPort,
  FakeRequestLog,
  FakeTeamSeed,
  FailureScript,
} from "task-linear-sync/tracker/testing";
import { createFakeLinearPort, syntheticUuid } from "task-linear-sync/tracker/testing";
import { canonicalAttachmentUrl, continuationAttachmentUrl } from "task-linear-sync/urls";

import { FakeClock, makeScreener } from "./test-utils.js";

export { FakeClock, makeScreener } from "./test-utils.js";
export { syntheticUuid };

/** Repository root (compiled helpers live at build/tests/helpers → three levels up). */
const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** Default fixed-clock start; deterministic `runId`s/events under the injected clock (R14/IV). */
export const HARNESS_START_ISO = "2026-01-01T00:00:00.000Z";

/** Every frozen `LinearPort` member (call-log method union + fixture key validation). */
export type PortMethod = keyof LinearPort;

const PORT_METHODS: readonly string[] = [
  "listIssues",
  "discoverMetadata",
  "getIssue",
  "createIssue",
  "updateIssue",
  "archiveIssue",
  "findIssuesByAttachmentUrl",
  "upsertAttachmentByUrl",
  "updateAttachment",
  "getAttachmentByUrl",
  "listAttachments",
];

/** Port members that mutate tracker state — zero-mutation assertions filter on these. */
export const MUTATING_PORT_METHODS: ReadonlySet<PortMethod> = new Set<PortMethod>([
  "createIssue",
  "updateIssue",
  "archiveIssue",
  "upsertAttachmentByUrl",
  "updateAttachment",
]);

// ─────────────────────────────────────────────────────────────────────────── errors

/** Loud fixture-authoring failure (bad `world.json`, unresolved seed reference, misuse). */
export class EngineFixtureError extends Error {
  override readonly name = "EngineFixtureError";
}

/** Thrown by the decorated port for an armed `createFailures` hit (never delegated to). */
export class HarnessCreateFailureError extends Error {
  override readonly name = "HarnessCreateFailureError";
}

/** Thrown by the decorated port when an armed phase interrupt fires (simulated crash). */
export class HarnessInterruptError extends Error {
  override readonly name = "HarnessInterruptError";
}

// ─────────────────────────────────────────────────────────────────────────── types

/** Which engine method is currently executing (per `attachEngine`-wrapped invocation). */
export type EnginePhase = "idle" | "buildSyncPlan" | "applySyncPlan" | "rollbackRun";

/** Phases an interrupt guard can arm on (`idle` never runs port calls by definition). */
export type ArmedPhase = Exclude<EnginePhase, "idle">;

/** One decorated-port invocation, appended to `world.calls` in strict order. */
export interface PortCallRecord {
  /** 1-based across the world's lifetime. */
  readonly seq: number;
  readonly method: PortMethod;
  /** Live argument references — assert, never mutate. */
  readonly args: readonly unknown[];
  /** Engine phase active when the call happened ("idle" ⇒ outside any engine method). */
  readonly phase: EnginePhase;
  /** False ⇒ the call threw (injected or delegated failure). */
  readonly ok: boolean;
  /** Sanitized thrown-error `name: message` when `ok === false`. */
  readonly error?: string;
}

/** Mutable backing shape; pushed into `calls` typed as the readonly public record. */
interface MutableCallRecord {
  seq: number;
  method: PortMethod;
  args: readonly unknown[];
  phase: EnginePhase;
  ok: boolean;
  error?: string;
}

/** Harness-level scripted create failure (world.json `createFailures` entry / runtime arm). */
export interface ScriptedCreateFailure {
  readonly issueSeed?: string;
  readonly attachmentUrl?: string;
  readonly title?: string;
  readonly titleIncludes?: string;
  readonly descriptionIncludes?: string;
  readonly teamKey?: string;
  readonly projectId?: string;
  /** Fail the nth MATCHED create call (1-based). Default 1. */
  readonly nth?: number;
  /** Number of matched calls to fail from `nth` onward. Default 1. */
  readonly times?: number;
}

/** world.json document (schema authority: this file's header docblock). */
export interface EngineFixtureWorld {
  readonly $comment?: string;
  readonly name?: string;
  readonly clock?: string;
  readonly teams?: readonly FakeTeamSeed[];
  readonly issues?: readonly FakeIssueSeed[];
  readonly attachments?: readonly FakeAttachmentSeed[];
  readonly scriptedFailures?: Readonly<Record<string, FailureScript | readonly FailureScript[]>>;
  readonly createFailures?: readonly ScriptedCreateFailure[];
  readonly pageSize?: number;
  readonly maxRetries?: number;
  readonly config?: ConfigOverrides;
  readonly metadata?: Readonly<Record<string, string | number | boolean>>;
}

/** Handle for a runtime create-failure arm (counters double as test assertions). */
export interface CreateFailureHandle {
  disarm(): void;
  /** Create calls that matched the predicates. */
  readonly matched: number;
  /** Failures actually thrown (assert `=== 1` to prove the injection landed). */
  readonly fired: number;
  readonly armed: boolean;
}

/** Handle for an armed phase interrupt (rollback-resumption cells use `fired`). */
export interface InterruptHandle {
  disarm(): void;
  /** Times the guard has thrown (once-armed guards disarm at 1). */
  readonly fired: number;
  readonly armed: boolean;
}

/** Options for `buildWorld`. */
export interface BuildWorldOptions {
  /** Programmatic config overrides, merged AFTER world.json `config` (stateDirectory stays harness-owned). */
  readonly config?: ConfigOverrides;
  /** Replace the default test screener wired into `deps.screener`. */
  readonly screener?: SecurityScreener;
  /** Fixed-clock start (beats world.json `clock`, beats `HARNESS_START_ISO`). */
  readonly start?: string;
  /** Extra deterministic env entries, merged into `world.env` (visible only via the world). */
  readonly env?: Readonly<Record<string, string>>;
}

/** The hermetic engine-test world (deps bag + fixture handles + injection surface). */
export interface EngineWorld {
  readonly name: string;
  /** Absolute source path of `tests/fixtures/engine/worlds/<world>/`. */
  readonly fixtureDir: string;
  /** `fixtureDir/expected` (may not exist). */
  readonly expectedDir: string;
  /** Temp tree root (contains `repo/` and `state/`); removed by `dispose()`. */
  readonly root: string;
  /** Temp repo copy — the `BuildPlanOptions.repositoryRoot`. */
  readonly repositoryRoot: string;
  /** Resolved state directory (outside `repositoryRoot` — frozen placement rule guaranteed). */
  readonly stateDir: string;
  readonly config: ResolvedConfig;
  readonly clock: FakeClock;
  readonly screener: SecurityScreener;
  readonly state: StateStore;
  /** The raw 007 fake (world inspection, `scriptFailure`, parity `requests`). */
  readonly fake: FakeLinearPort;
  /** Decorated port wired into `deps` — this is what the engine sees. */
  readonly port: LinearPort;
  readonly deps: EngineDependencies;
  /** Deterministic 32-byte manifest key provider (placeholder material, Principle III). */
  readonly keyProvider: KeyProvider;
  /** `{ [config.manifestKeyEnvVarName]: <hex key> }` (+ options.env). */
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly phase: EnginePhase;
  readonly phaseLog: readonly EnginePhase[];
  readonly calls: readonly PortCallRecord[];
  /** Attempt-level request-equivalents from the fake (page fetches, retries). */
  requests(): readonly FakeRequestLog[];
  /** Remove the temp tree. Idempotent. */
  dispose(): Promise<void>;
}

/** `sync-state.json` file schema (data-model §1; 008 owns content, harness only pre-seeds). */
export interface CheckpointStoreFile {
  readonly schemaVersion: 1;
  readonly checkpoints: Record<string, Checkpoint>;
}

// ──────────────────────────────────────────────────────────────────────── utilities

/** Deterministic sha256 hex (golden hashes, key derivation, id seeds). */
export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Deterministic uuid-from-label seed helper (fixture hygiene, Principle III): sha256 over
 * `"tls-008-fixture:<label>"` formatted into uuid shape with forced version-4/variant-8
 * nibbles. Identical label ⇒ identical uuid in every environment; values are synthetic.
 */
export function uuidFromLabel(label: string): string {
  const h = sha256Hex(`tls-008-fixture:${label}`);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Absolute path of a file inside the SOURCE fixture directory (never written to). */
export function fixtureFile(world: EngineWorld, rel: string): string {
  return join(world.fixtureDir, rel);
}

/** Absolute path of a file under the fixture's `expected/` directory. */
export function expectedFile(world: EngineWorld, rel: string): string {
  return join(world.expectedDir, rel);
}

/** Parse a golden JSON fragment from `expected/`. */
export function readExpectedJson<T>(world: EngineWorld, rel: string): T {
  const p = expectedFile(world, rel);
  if (!existsSync(p)) {
    throw new EngineFixtureError(`expected artifact '${p}' does not exist`);
  }
  return JSON.parse(readFileSync(p, "utf8")) as T;
}

/** Canonical (identity-anchor) attachment URL under the world config. */
export function attachmentUrlFor(world: EngineWorld, taskUuid: string): string {
  return canonicalAttachmentUrl(world.config, taskUuid);
}

/** Continuation page URL (page ≥ 1) under the world config. */
export function historyPageUrlFor(world: EngineWorld, taskUuid: string, page: number): string {
  return continuationAttachmentUrl(world.config, taskUuid, page);
}

// ─────────────────────────────────────────────────────────────────── world.json parse

function fail(dir: string, message: string): never {
  throw new EngineFixtureError(`world '${basename(dir)}': ${message}`);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function reqString(obj: Record<string, unknown>, key: string, where: string, dir: string): string {
  const v = obj[key];
  if (typeof v !== "string" || v.length === 0) fail(dir, `${where}.${key} must be a non-empty string`);
  return v;
}

function checkKeys(obj: Record<string, unknown>, allowed: readonly string[], where: string, dir: string): void {
  const unknown = Object.keys(obj).filter((k) => !allowed.includes(k));
  if (unknown.length > 0) {
    fail(dir, `${where} has unknown key(s): ${unknown.join(", ")} (schema: engine-harness.ts header docblock)`);
  }
}

function parseArray<T>(
  v: unknown,
  where: string,
  dir: string,
  each: (el: Record<string, unknown>, i: number) => T,
): T[] | undefined {
  if (v === undefined) return undefined;
  if (!Array.isArray(v)) fail(dir, `${where} must be an array`);
  return v.map((el, i) => {
    if (!isPlainObject(el)) fail(dir, `${where}[${i}] must be an object`);
    return each(el, i);
  });
}

const WORLD_KEYS = [
  "$comment", "name", "clock", "teams", "issues", "attachments",
  "scriptedFailures", "createFailures", "pageSize", "maxRetries", "config", "metadata",
] as const;

const ENTITY_KEYS = {
  team: ["key", "id", "projects", "workflowStates"],
  issue: ["id", "key", "teamKey", "projectId", "title", "description", "stateType", "updatedAt", "archived"],
  attachment: ["issueId", "id", "url", "title", "subtitle", "metadata"],
  failureScript: ["atCall", "kind", "then"],
} as const;

const CREATE_FAILURE_PREDICATES = [
  "issueSeed", "attachmentUrl", "title", "titleIncludes", "descriptionIncludes", "teamKey", "projectId",
] as const;
const CREATE_FAILURE_KEYS = [...CREATE_FAILURE_PREDICATES, "nth", "times"] as const;
const FAILURE_KINDS = ["http-429-retryAfter", "http-5xx", "network", "graphql-userError"] as const;

/** Validate + type one world.json document. Absent fields stay absent; anything invalid ABORTS. */
export function parseFixtureWorld(raw: unknown, dir: string): EngineFixtureWorld {
  if (!isPlainObject(raw)) fail(dir, "world.json root must be a JSON object");
  checkKeys(raw, WORLD_KEYS, "world.json", dir);

  if (raw.$comment !== undefined && typeof raw.$comment !== "string") fail(dir, "$comment must be a string");
  if (raw.name !== undefined && (typeof raw.name !== "string" || raw.name !== basename(dir))) {
    fail(dir, `name '${String(raw.name)}' must equal the directory name '${basename(dir)}'`);
  }
  if (raw.clock !== undefined && (typeof raw.clock !== "string" || Number.isNaN(Date.parse(raw.clock)))) {
    fail(dir, "clock must be an ISO-8601 string");
  }
  if (raw.pageSize !== undefined && (typeof raw.pageSize !== "number" || !Number.isInteger(raw.pageSize) || raw.pageSize < 1)) {
    fail(dir, "pageSize must be an integer >= 1");
  }
  if (raw.maxRetries !== undefined && (typeof raw.maxRetries !== "number" || !Number.isInteger(raw.maxRetries) || raw.maxRetries < 0)) {
    fail(dir, "maxRetries must be an integer >= 0");
  }
  if (raw.metadata !== undefined && !isPlainObject(raw.metadata)) fail(dir, "metadata must be an object");

  let config: ConfigOverrides | undefined;
  if (raw.config !== undefined) {
    if (!isPlainObject(raw.config)) fail(dir, "config must be an object");
    if (raw.config.stateDirectory !== undefined) fail(dir, "config.stateDirectory is harness-owned — remove it from world.json");
    config = raw.config as ConfigOverrides;
  }

  const teams = parseArray(raw.teams, "teams", dir, (el, i) => {
    const where = `teams[${i}]`;
    checkKeys(el, ENTITY_KEYS.team, where, dir);
    reqString(el, "key", where, dir);
    reqString(el, "id", where, dir);
    if (!Array.isArray(el.projects)) fail(dir, `${where}.projects must be an array`);
    el.projects.forEach((p, j) => {
      if (!isPlainObject(p)) fail(dir, `${where}.projects[${j}] must be an object`);
      reqString(p, "id", `${where}.projects[${j}]`, dir);
      reqString(p, "name", `${where}.projects[${j}]`, dir);
    });
    if (!Array.isArray(el.workflowStates)) fail(dir, `${where}.workflowStates must be an array`);
    el.workflowStates.forEach((s, j) => {
      if (!isPlainObject(s)) fail(dir, `${where}.workflowStates[${j}] must be an object`);
      reqString(s, "id", `${where}.workflowStates[${j}]`, dir);
      reqString(s, "name", `${where}.workflowStates[${j}]`, dir);
      reqString(s, "type", `${where}.workflowStates[${j}]`, dir);
    });
    return el as unknown as FakeTeamSeed;
  });

  const issues = parseArray(raw.issues, "issues", dir, (el, i) => {
    const where = `issues[${i}]`;
    checkKeys(el, ENTITY_KEYS.issue, where, dir);
    if (typeof el.title !== "string") fail(dir, `${where}.title must be a string`);
    if (typeof el.description !== "string") fail(dir, `${where}.description must be a string`);
    for (const k of ["id", "key", "teamKey", "projectId", "stateType", "updatedAt"] as const) {
      reqString(el, k, where, dir);
    }
    if (el.archived !== undefined && typeof el.archived !== "boolean") fail(dir, `${where}.archived must be boolean`);
    return el as unknown as FakeIssueSeed;
  });

  const attachments = parseArray(raw.attachments, "attachments", dir, (el, i) => {
    const where = `attachments[${i}]`;
    checkKeys(el, ENTITY_KEYS.attachment, where, dir);
    for (const k of ["issueId", "id", "url", "title"] as const) reqString(el, k, where, dir);
    if (!isPlainObject(el.metadata)) fail(dir, `${where}.metadata must be an object`);
    for (const [mk, mv] of Object.entries(el.metadata)) {
      if (typeof mv !== "string" && typeof mv !== "number") {
        fail(dir, `${where}.metadata.${mk} must be string|number (flat by rule)`);
      }
    }
    return el as unknown as FakeAttachmentSeed;
  });

  let scriptedFailures: EngineFixtureWorld["scriptedFailures"];
  if (raw.scriptedFailures !== undefined) {
    if (!isPlainObject(raw.scriptedFailures)) fail(dir, "scriptedFailures must be an object");
    for (const [method, entry] of Object.entries(raw.scriptedFailures)) {
      if (!PORT_METHODS.includes(method)) {
        fail(dir, `scriptedFailures key '${method}' is not a LinearPort member`);
      }
      const list = Array.isArray(entry) ? entry : [entry];
      list.forEach((s, j) => {
        const where = `scriptedFailures.${method}[${j}]`;
        if (!isPlainObject(s)) fail(dir, `${where} must be an object`);
        checkKeys(s, ENTITY_KEYS.failureScript, where, dir);
        if (typeof s.atCall !== "number" || !Number.isInteger(s.atCall) || s.atCall < 1) {
          fail(dir, `${where}.atCall must be an int >= 1`);
        }
        if (typeof s.kind !== "string" || !(FAILURE_KINDS as readonly string[]).includes(s.kind)) {
          fail(dir, `${where}.kind must be one of ${FAILURE_KINDS.join(", ")}`);
        }
        if (s.then !== undefined && s.then !== "succeed") fail(dir, `${where}.then must be "succeed"`);
      });
    }
    scriptedFailures = raw.scriptedFailures as EngineFixtureWorld["scriptedFailures"];
  }

  const createFailures = parseArray(raw.createFailures, "createFailures", dir, (el, i) => {
    const where = `createFailures[${i}]`;
    checkKeys(el, CREATE_FAILURE_KEYS, where, dir);
    if (!CREATE_FAILURE_PREDICATES.some((k) => el[k] !== undefined)) {
      fail(dir, `${where} needs at least one of ${CREATE_FAILURE_PREDICATES.join("/")}`);
    }
    for (const k of CREATE_FAILURE_PREDICATES) {
      if (el[k] !== undefined && (typeof el[k] !== "string" || (el[k] as string).length === 0)) {
        fail(dir, `${where}.${k} must be a non-empty string`);
      }
    }
    for (const k of ["nth", "times"] as const) {
      if (el[k] !== undefined && (typeof el[k] !== "number" || !Number.isInteger(el[k]) || (el[k] as number) < 1)) {
        fail(dir, `${where}.${k} must be an int >= 1`);
      }
    }
    return el as unknown as ScriptedCreateFailure;
  });

  return {
    ...(raw.$comment !== undefined ? { $comment: raw.$comment as string } : {}),
    ...(raw.name !== undefined ? { name: raw.name as string } : {}),
    ...(raw.clock !== undefined ? { clock: raw.clock as string } : {}),
    ...(teams !== undefined ? { teams } : {}),
    ...(issues !== undefined ? { issues } : {}),
    ...(attachments !== undefined ? { attachments } : {}),
    ...(scriptedFailures !== undefined ? { scriptedFailures } : {}),
    ...(createFailures !== undefined ? { createFailures } : {}),
    ...(raw.pageSize !== undefined ? { pageSize: raw.pageSize as number } : {}),
    ...(raw.maxRetries !== undefined ? { maxRetries: raw.maxRetries as number } : {}),
    ...(config !== undefined ? { config } : {}),
    ...(raw.metadata !== undefined ? { metadata: raw.metadata as EngineFixtureWorld["metadata"] } : {}),
  };
}

// ─────────────────────────────────────────────────────────────────── internal state

/** Which engine method is executing + injector/call-log bookkeeping (per world). */
interface WorldState {
  phase: EnginePhase;
  phaseCalls: number;
  readonly phaseLog: EnginePhase[];
  readonly calls: MutableCallRecord[];
  seq: number;
  readonly creates: ArmedCreate[];
  readonly interrupts: ArmedInterrupt[];
  disposed: boolean;
}

/** EngineWorld → WorldState registry (keeps the public bag free of internals). */
const stateRegistry = new WeakMap<EngineWorld, WorldState>();

function worldStateOf(world: EngineWorld): WorldState {
  const st = stateRegistry.get(world);
  if (st === undefined) throw new EngineFixtureError("world not registered — build it via buildWorld()");
  return st;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? `${e.name}: ${e.message}` : String(e);
}

interface ArmedCreate {
  readonly spec: ScriptedCreateFailure;
  /** Resolved from issueSeed/attachmentUrl; undefined ⇒ pure-predicate spec. */
  readonly resolvedTitle?: string;
  readonly label: string;
  matched: number;
  fired: number;
  armed: boolean;
  readonly worldName: string;
}

interface ArmedInterrupt {
  readonly phase: ArmedPhase;
  readonly atCall: number;
  readonly once: boolean;
  fired: number;
  armed: boolean;
}

// ─────────────────────────────────────────────────────────────────────── seed lookup

function findSeedTitleByIssue(fake: FakeLinearPort, idOrKey: string, name: string): string {
  const byId = fake.world.issues.get(idOrKey);
  if (byId !== undefined) return byId.title;
  for (const view of fake.world.issues.values()) {
    if (view.key === idOrKey) return view.title;
  }
  throw new EngineFixtureError(`world '${name}': issue seed '${idOrKey}' not found in world.json issues[]`);
}

function findSeedTitleByUrl(fake: FakeLinearPort, url: string, name: string): string {
  for (const att of fake.world.attachments.values()) {
    if (att.url === url) {
      const carrier = fake.world.issues.get(att.issueId);
      if (carrier === undefined) {
        throw new EngineFixtureError(`world '${name}': attachment '${url}' carrier issue '${att.issueId}' not found in issues[]`);
      }
      return carrier.title;
    }
  }
  throw new EngineFixtureError(`world '${name}': no seeded attachment with url '${url}' (attachmentUrl must reference world.json attachments[])`);
}

// ───────────────────────────────────────────────────────────────────── port decorator

/** Decorate the fake: per-call log + armed guards; delegate everything else untouched. */
function decoratePort(fake: FakeLinearPort, st: WorldState): LinearPort {
  function beginCall(method: PortMethod, args: readonly unknown[]): MutableCallRecord {
    st.seq += 1;
    const rec: MutableCallRecord = { seq: st.seq, method, args, phase: st.phase, ok: true };
    st.calls.push(rec);
    return rec;
  }

  /** Count one port call within the current phase; throw when an armed guard hits atCall. */
  function checkInterrupts(): void {
    st.phaseCalls += 1;
    for (const guard of st.interrupts) {
      if (!guard.armed || guard.phase !== st.phase) continue;
      if (st.phaseCalls !== guard.atCall) continue;
      guard.fired += 1;
      if (guard.once) guard.armed = false;
      throw new HarnessInterruptError(
        `harness: scripted interruption at port call ${guard.atCall} of phase '${guard.phase}'`,
      );
    }
  }

  /** Consult armed create-failure scripts (matched count, nth/times); throw on a hit. */
  function checkCreateFailure(input: CreateIssueInput): void {
    for (const armed of st.creates) {
      if (!armed.armed) continue;
      const s = armed.spec;
      if (armed.resolvedTitle !== undefined && input.title !== armed.resolvedTitle) continue;
      if (s.title !== undefined && input.title !== s.title) continue;
      if (s.titleIncludes !== undefined && !input.title.includes(s.titleIncludes)) continue;
      if (s.descriptionIncludes !== undefined && !input.description.includes(s.descriptionIncludes)) continue;
      if (s.teamKey !== undefined && input.teamKey !== s.teamKey) continue;
      if (s.projectId !== undefined && input.projectId !== s.projectId) continue;
      armed.matched += 1;
      const nth = s.nth ?? 1;
      const times = s.times ?? 1;
      if (armed.matched >= nth && armed.fired < times) {
        armed.fired += 1;
        if (armed.fired >= times) armed.armed = false;
        throw new HarnessCreateFailureError(
          `harness: scripted create failure for ${armed.label} (world '${armed.worldName}')`,
        );
      }
    }
  }

  async function invoke<T>(method: PortMethod, args: readonly unknown[], fn: () => Promise<T>): Promise<T> {
    const rec = beginCall(method, args);
    try {
      checkInterrupts();
      return await fn();
    } catch (e) {
      if (rec.ok) {
        rec.ok = false;
        rec.error = errorMessage(e);
      }
      throw e;
    }
  }

  const port: LinearPort = {
    listIssues(scope) {
      const rec = beginCall("listIssues", [scope]);
      try {
        checkInterrupts();
      } catch (e) {
        rec.ok = false;
        rec.error = errorMessage(e);
        throw e;
      }
      return fake.listIssues(scope);
    },
    discoverMetadata(teamKeys) {
      return invoke("discoverMetadata", [teamKeys], () => fake.discoverMetadata(teamKeys));
    },
    getIssue(id) {
      return invoke("getIssue", [id], () => fake.getIssue(id));
    },
    createIssue(input) {
      return invoke("createIssue", [input], async () => {
        checkCreateFailure(input);
        return fake.createIssue(input);
      });
    },
    updateIssue(id, p) {
      return invoke("updateIssue", [id, p], () => fake.updateIssue(id, p));
    },
    archiveIssue(id) {
      return invoke("archiveIssue", [id], () => fake.archiveIssue(id));
    },
    findIssuesByAttachmentUrl(attachmentUrl) {
      return invoke("findIssuesByAttachmentUrl", [attachmentUrl], () => fake.findIssuesByAttachmentUrl(attachmentUrl));
    },
    upsertAttachmentByUrl(input) {
      return invoke("upsertAttachmentByUrl", [input], () => fake.upsertAttachmentByUrl(input));
    },
    updateAttachment(id, m) {
      return invoke("updateAttachment", [id, m], () => fake.updateAttachment(id, m));
    },
    getAttachmentByUrl(url) {
      return invoke("getAttachmentByUrl", [url], () => fake.getAttachmentByUrl(url));
    },
    listAttachments(issueId, cursor) {
      return invoke("listAttachments", cursor === undefined ? [issueId] : [issueId, cursor], () =>
        fake.listAttachments(issueId, cursor),
      );
    },
  };
  return port;
}

// ──────────────────────────────────────────────────────────────────────── buildWorld

/** Absolute directory of a named world under tests/fixtures/engine/worlds/. */
export function worldDir(name: string): string {
  return join(pkgRoot, "tests", "fixtures", "engine", "worlds", name);
}

/**
 * Build the hermetic world for a fixture directory (bare name resolves under
 * tests/fixtures/engine/worlds/). See the header docblock for the full contract.
 */
export async function buildWorld(nameOrDir: string, options: BuildWorldOptions = {}): Promise<EngineWorld> {
  const fixtureDir = existsSync(nameOrDir) ? nameOrDir : worldDir(nameOrDir);
  const worldJsonPath = join(fixtureDir, "world.json");
  if (!existsSync(worldJsonPath)) {
    throw new EngineFixtureError(`no world.json at '${worldJsonPath}'`);
  }
  const doc = parseFixtureWorld(JSON.parse(readFileSync(worldJsonPath, "utf8")) as unknown, fixtureDir);
  const name = doc.name ?? basename(fixtureDir);

  if (options.config?.stateDirectory !== undefined) {
    throw new EngineFixtureError("buildWorld options.config.stateDirectory is harness-owned — omit it");
  }
  const clock = new FakeClock(options.start ?? doc.clock ?? HARNESS_START_ISO);

  const root = await realpath(await mkdtemp(join(tmpdir(), `tls-008-${name}-`)));
  const repositoryRoot = join(root, "repo");
  const stateDir = join(root, "state");
  const repoSource = join(fixtureDir, "repo");
  if (existsSync(repoSource)) {
    await cp(repoSource, repositoryRoot, { recursive: true });
  } else {
    await mkdir(repositoryRoot, { recursive: true });
  }

  const config = loadConfig({
    overrides: { ...(doc.config ?? {}), ...(options.config ?? {}), stateDirectory: stateDir },
  });

  // Deterministic placeholder manifest key (Principle III — a test constant, never a credential).
  const keyValue = sha256Hex(`task-linear-sync/008-harness/test-manifest-key/${config.manifestKeyId}`);
  const keyBytes = Buffer.from(keyValue, "hex");
  const keyProvider: KeyProvider = {
    async getKey(keyId: string): Promise<Uint8Array | null> {
      return keyId === config.manifestKeyId ? keyBytes : null;
    },
  };
  const env: Record<string, string | undefined> = {
    ...options.env,
    [config.manifestKeyEnvVarName]: keyValue,
  };

  const fake = createFakeLinearPort({
    teams: doc.teams ?? [],
    issues: doc.issues ?? [],
    attachments: doc.attachments ?? [],
    ...(doc.scriptedFailures !== undefined ? { scriptedFailures: doc.scriptedFailures } : {}),
    ...(doc.pageSize !== undefined ? { pageSize: doc.pageSize } : {}),
    ...(doc.maxRetries !== undefined ? { maxRetries: doc.maxRetries } : {}),
  });

  const st: WorldState = {
    phase: "idle",
    phaseCalls: 0,
    phaseLog: [],
    calls: [],
    seq: 0,
    creates: [],
    interrupts: [],
    disposed: false,
  };
  const port = decoratePort(fake, st);
  const screener = options.screener ?? makeScreener();
  const state = createStateStore({ repositoryRoot, config, clock });
  const deps: EngineDependencies = { port, config, state, clock, screener };
  await state.ensure();

  for (const spec of doc.createFailures ?? []) {
    armCreateFailureInternal(st, fake, name, spec);
  }

  const world: EngineWorld = {
    name,
    fixtureDir,
    expectedDir: join(fixtureDir, "expected"),
    root,
    repositoryRoot,
    stateDir,
    config,
    clock,
    screener,
    state,
    fake,
    port,
    deps,
    keyProvider,
    env,
    get phase(): EnginePhase {
      return st.phase;
    },
    get phaseLog(): readonly EnginePhase[] {
      return st.phaseLog;
    },
    get calls(): readonly PortCallRecord[] {
      return st.calls;
    },
    requests: () => fake.requests(),
    async dispose(): Promise<void> {
      if (st.disposed) return;
      st.disposed = true;
      await rm(root, { recursive: true, force: true });
    },
  };
  stateRegistry.set(world, st);
  return world;
}

// ──────────────────────────────────────────────────────────────────────── attachEngine

/**
 * Wire an engine through the frozen seam: `factory(world.deps, options)` — the factory is
 * injected (typically the `createSyncEngine` the test imports from `src/engine/create.js`) so
 * this harness compiles with `src/engine` absent. The returned engine tracks phases:
 * `world.phase`, `world.phaseLog`, and the per-invocation port-call counter consumed by
 * `armInterrupt` reset/advance around every method call (including throws).
 */
export function attachEngine<O>(
  world: EngineWorld,
  factory: (deps: EngineDependencies, options?: O) => SyncEngine,
  options?: O,
): SyncEngine {
  const engine = factory(world.deps, options);
  const st = worldStateOf(world);
  const runPhase = async <T>(phase: ArmedPhase, fn: () => Promise<T>): Promise<T> => {
    st.phase = phase;
    st.phaseLog.push(phase);
    st.phaseCalls = 0;
    try {
      return await fn();
    } finally {
      st.phase = "idle";
      st.phaseCalls = 0;
    }
  };
  const wrapped: SyncEngine = {
    buildSyncPlan(o) {
      return runPhase("buildSyncPlan", () => engine.buildSyncPlan(o));
    },
    applySyncPlan(plan, gates) {
      return runPhase("applySyncPlan", () => engine.applySyncPlan(plan, gates));
    },
    rollbackRun(runId) {
      return runPhase("rollbackRun", () => engine.rollbackRun(runId));
    },
  };
  return wrapped;
}

// ─────────────────────────────────────────────────────────────────────── injectors

function armCreateFailureInternal(
  st: WorldState,
  fake: FakeLinearPort,
  worldName: string,
  spec: ScriptedCreateFailure,
): CreateFailureHandle {
  let resolvedTitle: string | undefined;
  const parts: string[] = [];
  if (spec.issueSeed !== undefined) {
    resolvedTitle = findSeedTitleByIssue(fake, spec.issueSeed, worldName);
    parts.push(`issueSeed '${spec.issueSeed}'`);
  }
  if (spec.attachmentUrl !== undefined) {
    const title = findSeedTitleByUrl(fake, spec.attachmentUrl, worldName);
    if (resolvedTitle !== undefined && resolvedTitle !== title) {
      throw new EngineFixtureError(
        `world '${worldName}': createFailures entry issueSeed/attachmentUrl resolve to different titles ('${resolvedTitle}' vs '${title}')`,
      );
    }
    resolvedTitle = title;
    parts.push(`attachmentUrl '${spec.attachmentUrl}'`);
  }
  if (spec.title !== undefined) parts.push(`title '${spec.title}'`);
  if (spec.titleIncludes !== undefined) parts.push(`titleIncludes '${spec.titleIncludes}'`);
  if (spec.descriptionIncludes !== undefined) parts.push(`descriptionIncludes '${spec.descriptionIncludes}'`);
  if (spec.teamKey !== undefined) parts.push(`teamKey '${spec.teamKey}'`);
  if (spec.projectId !== undefined) parts.push(`projectId '${spec.projectId}'`);

  const armed: ArmedCreate = {
    spec,
    resolvedTitle,
    label: parts.join(" + "),
    matched: 0,
    fired: 0,
    armed: true,
    worldName,
  };
  st.creates.push(armed);
  return {
    disarm(): void {
      armed.armed = false;
    },
    get matched(): number {
      return armed.matched;
    },
    get fired(): number {
      return armed.fired;
    },
    get armed(): boolean {
      return armed.armed;
    },
  };
}

/**
 * Arm a scripted create failure at runtime (same mechanics as world.json `createFailures`).
 * `issueSeed`/`attachmentUrl` resolve against the CURRENT fake world (seeded issues/attachments).
 */
export function armCreateFailure(world: EngineWorld, spec: ScriptedCreateFailure): CreateFailureHandle {
  return armCreateFailureInternal(worldStateOf(world), world.fake, world.name, spec);
}

/**
 * Arm a phase interrupt: the guard throws `HarnessInterruptError` (once) when the port-call
 * counter of the NEXT matching engine invocation reaches `atCall` (1-based). Counters reset per
 * engine-method entry, so re-arm before each resume run. Simulates crash-at-step-N; the journal
 * left on disk is the exact resume input.
 */
export function armInterrupt(
  world: EngineWorld,
  spec: { phase: ArmedPhase; atCall: number; once?: boolean },
): InterruptHandle {
  if (!Number.isInteger(spec.atCall) || spec.atCall < 1) {
    throw new EngineFixtureError(`armInterrupt atCall must be an int >= 1, got ${String(spec.atCall)}`);
  }
  const guard: ArmedInterrupt = { phase: spec.phase, atCall: spec.atCall, once: spec.once ?? true, fired: 0, armed: true };
  const st = worldStateOf(world);
  st.interrupts.push(guard);
  return {
    disarm(): void {
      guard.armed = false;
    },
    get fired(): number {
      return guard.fired;
    },
    get armed(): boolean {
      return guard.armed;
    },
  };
}

// ─────────────────────────────────────────────────────────────────── call-log helpers

/** Current length of `world.calls` — pass to `callsSince`/`callsOf` to scope post-resume. */
export function callsMark(world: EngineWorld): number {
  return world.calls.length;
}

/** Call records appended after `mark`. */
export function callsSince(world: EngineWorld, mark: number): readonly PortCallRecord[] {
  return world.calls.slice(mark);
}

/** Call records for one port method (optionally after `sinceMark`). */
export function callsOf(world: EngineWorld, method: PortMethod, sinceMark = 0): readonly PortCallRecord[] {
  return world.calls.slice(sinceMark).filter((c) => c.method === method);
}

/** All mutating port calls (optionally after `sinceMark`). Zero-length ⇒ zero mutations. */
export function mutationCalls(world: EngineWorld, sinceMark = 0): readonly PortCallRecord[] {
  return world.calls.slice(sinceMark).filter((c) => MUTATING_PORT_METHODS.has(c.method));
}

// ────────────────────────────────────────────────────────────────────── state pre-seed

const SYNC_STATE_REL = "sync-state.json";

/** Write the checkpoint store file wholesale (data-model §1 schema). */
export async function seedCheckpoints(world: EngineWorld, checkpoints: Record<string, Checkpoint>): Promise<void> {
  const file: CheckpointStoreFile = { schemaVersion: 1, checkpoints };
  await world.state.writeJson(SYNC_STATE_REL, file);
}

/** Read `sync-state.json`; null when no checkpoint store exists (⇒ bootstrap mode reality). */
export async function readCheckpointStore(world: EngineWorld): Promise<CheckpointStoreFile | null> {
  return world.state.readJson<CheckpointStoreFile>(SYNC_STATE_REL);
}

/** Presence of any checkpoint (the reality frozen `selectMode` reads). */
export async function hasCheckpoints(world: EngineWorld): Promise<boolean> {
  const store = await readCheckpointStore(world);
  return store !== null && Object.keys(store.checkpoints).length > 0;
}

/** Empty checkpoint store (⇒ bootstrap reality) — an empty map, not a deleted file. */
export async function clearCheckpoints(world: EngineWorld): Promise<void> {
  await seedCheckpoints(world, {});
}

/**
 * Acquire the advisory run lock and KEEP it held (same-process pid ⇒ provably alive ⇒ the
 * engine's next apply must refuse with LOCK_HELD). Release with the frozen
 * `releaseRunLock(world.state, record)` when a scenario needs the lock back.
 */
export async function holdRunLock(world: EngineWorld, runId: string): Promise<RunLockRecord> {
  const acquisition = await acquireRunLock(world.state, runId);
  if (!acquisition.acquired) {
    throw new EngineFixtureError(
      `harness could not pre-seed the run lock — held by '${acquisition.heldBy.runId}' (${acquisition.reason})`,
    );
  }
  return acquisition.record;
}

/** Advance the injected clock past `manifestExpiryDays` by `extraDays` (default +1). */
export function advancePastManifestExpiry(world: EngineWorld, extraDays = 1): void {
  world.clock.advanceDays(world.config.manifestExpiryDays + extraDays);
}

// ────────────────────────────────────────────────────────────────── journal artifacts

const MANIFEST_RELS = (runId: string): readonly string[] => [`manifests/${runId}.json`, `manifests/${runId}.manifest.json`];
const JOURNAL_REL = (runId: string): string => `runs/${runId}/journal.json`;

function resolveArtifactRel(world: EngineWorld, candidates: readonly string[], what: string, runId: string): string {
  for (const rel of candidates) {
    if (existsSync(join(world.stateDir, rel))) return rel;
  }
  throw new EngineFixtureError(
    `no ${what} for run '${runId}' — candidates tried: ${candidates.map((c) => join(world.stateDir, c)).join(", ")}`,
  );
}

function isEnvelope(v: unknown): v is ManifestEnvelope {
  return (
    isPlainObject(v) &&
    v.schemaVersion === 1 &&
    typeof v.keyId === "string" &&
    typeof v.ciphertext === "string" &&
    typeof v.createdAt === "string"
  );
}

/** Unwrap the frozen envelope plaintext `canonicalJson({ createdAt, manifest })` shape. */
function unwrapSealed(v: unknown): unknown {
  if (isPlainObject(v) && typeof v.createdAt === "string" && "manifest" in v) return v.manifest;
  return v;
}

/** Read + open a run artifact (sealed envelope opened with `world.keyProvider`; plain JSON verbatim). */
async function openArtifact<T>(world: EngineWorld, rel: string): Promise<T> {
  const raw = await world.state.readJson<unknown>(rel);
  if (raw === null) throw new EngineFixtureError(`artifact '${rel}' unreadable or absent`);
  if (!isEnvelope(raw)) return raw as T;
  return unwrapSealed(await openManifest(raw, world.config, world.keyProvider)) as T;
}

/** Opened audit manifest `manifests/<runId>.json` (frozen `Audit_Manifest` — type it test-side). */
export async function openRunManifest<T>(world: EngineWorld, runId: string): Promise<T> {
  return openArtifact<T>(world, resolveArtifactRel(world, MANIFEST_RELS(runId), "audit manifest", runId));
}

/** Opened 008-local step journal `runs/<runId>/journal.json` (`JournalStep[]` or `{ steps }`). */
export async function openRunJournal<T>(world: EngineWorld, runId: string): Promise<T> {
  return openArtifact<T>(world, resolveArtifactRel(world, [JOURNAL_REL(runId)], "step journal", runId));
}

/** Extract the step array whether the journal is a bare `JournalStep[]` or a `{ steps }` wrapper. */
function journalSteps(journal: unknown, runId: string): unknown[] {
  if (Array.isArray(journal)) return journal;
  if (isPlainObject(journal) && Array.isArray(journal.steps)) return journal.steps;
  throw new EngineFixtureError(`journal for run '${runId}' is neither JournalStep[] nor { steps: JournalStep[] }`);
}

/** Options for `corruptRunStepState`. */
export interface CorruptStepOptions {
  /** 0-based index into the journal step array (default 0). Ignored when `opId` is given. */
  readonly stepIndex?: number;
  /** Journal step whose `opId` equals this value (wins over `stepIndex`). */
  readonly opId?: string;
  /** stepState to force (default `"applied"` — a pending-looking step could read as "never started"). */
  readonly stepState?: "pending" | "applied";
  /** Custom surgery (wins over the default snapshot-corruption mutation). */
  readonly mutate?: (step: Record<string, unknown>) => void;
}

/**
 * Corrupt one journaled step so live tracker/file state matches NEITHER snapshot — the frozen
 * rollback guard must then halt with `stepState: "conflict-halted"` and
 * `RollbackResult.status: "partial"` (quickstart 2.4 corrupted-state cell). Default mutation
 * forces `stepState` to `"applied"` and replaces both snapshots with a sentinel object;
 * `mutate` does custom surgery. Sealed journals are opened and re-sealed with
 * `world.keyProvider` (envelope `createdAt` header refreshes as a side effect).
 */
export async function corruptRunStepState(world: EngineWorld, runId: string, opts: CorruptStepOptions = {}): Promise<void> {
  const rel = resolveArtifactRel(world, [JOURNAL_REL(runId)], "step journal", runId);
  const stored = await world.state.readJson<unknown>(rel);
  if (stored === null) throw new EngineFixtureError(`journal '${rel}' unreadable or absent`);
  const sealed = isEnvelope(stored);
  const value = sealed ? unwrapSealed(await openManifest(stored, world.config, world.keyProvider)) : stored;
  const steps = journalSteps(value, runId);

  const index =
    opts.opId !== undefined
      ? steps.findIndex((s) => isPlainObject(s) && s.opId === opts.opId)
      : (opts.stepIndex ?? 0);
  if (index < 0 || index >= steps.length || steps[index] === undefined || !isPlainObject(steps[index])) {
    throw new EngineFixtureError(
      `no object journal step at target for run '${runId}' (opId '${String(opts.opId)}', index ${String(opts.stepIndex)})`,
    );
  }
  const step = steps[index] as Record<string, unknown>;

  if (opts.mutate !== undefined) {
    opts.mutate(step);
  } else {
    step.stepState = opts.stepState ?? "applied";
    step.beforeSnapshot = { harnessCorrupted: `step ${index}` };
    step.afterSnapshot = { harnessCorrupted: `step ${index}` };
  }

  const next = Array.isArray(value) ? steps : { ...(value as Record<string, unknown>), steps };
  const out = sealed ? await sealManifest(next, world.config, world.keyProvider, world.clock) : next;
  await world.state.writeJson(rel, out);
}

/**
 * Break the sealed envelope of a run artifact (ciphertext byte flip; plain JSON: annotation) so
 * the engine's tag check fails — `rollbackRun` must refuse with NO plaintext returned.
 */
export async function tamperRunArtifact(
  world: EngineWorld,
  runId: string,
  target: "manifest" | "journal" = "manifest",
): Promise<void> {
  const rel = resolveArtifactRel(
    world,
    target === "manifest" ? MANIFEST_RELS(runId) : [JOURNAL_REL(runId)],
    target === "manifest" ? "audit manifest" : "step journal",
    runId,
  );
  const raw = JSON.parse(readFileSync(join(world.stateDir, rel), "utf8")) as unknown;
  if (isEnvelope(raw)) {
    const bytes = Buffer.from(raw.ciphertext, "base64");
    if (bytes.length === 0) throw new EngineFixtureError(`envelope '${rel}' has empty ciphertext — nothing to flip`);
    bytes[Math.floor(bytes.length / 2)] ^= 0xff;
    const tampered: ManifestEnvelope = { ...raw, ciphertext: bytes.toString("base64") };
    await world.state.writeJson(rel, tampered);
  } else if (isPlainObject(raw)) {
    await world.state.writeJson(rel, { ...raw, harnessTampered: true });
  } else {
    throw new EngineFixtureError(`artifact '${rel}' is not an object — nothing to tamper`);
  }
}
