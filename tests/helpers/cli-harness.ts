/**
 * T003 — Shared hermetic harness for all 009 operator-CLI tests.
 *
 * Implements the quickstart.md "Harness" section: builds on the 008 engine harness
 * (`buildWorld` conventions) with a seeded 007 fake `LinearPort`, temp `StateStore`
 * OUTSIDE the fixture repo, a fixed injected `Clock`, captured `stdout`/`stderr`,
 * a `RecordingQueueSurface` fake, a `makeRoguePort` decorator seam for injecting
 * mid-run mutation attempts (SC-003 / FR-005), a repo-tree hash helper (zero-repo-write
 * proofs), and a `writeDriver` factory for the e2e child-process tier (research R8).
 *
 * IMPORTANT WIRING SEAM: this file COMPILES WITHOUT `src/cli` existing. It never imports
 * `src/cli/**` or `task-linear-sync/cli` — the context object it produces is typed by the
 * harness-local structural interfaces below, which mirror `contracts/queue-surface.md` §1
 * and `data-model.md` §4 field-for-field (009's exported types are the same shapes, so
 * `runCli(argv, ctx)` accepts the context structurally).
 *
 * ```ts
 * import { buildCliWorld } from "../helpers/cli-harness.js";
 *
 * const w = await buildCliWorld("review-report");
 * try {
 *   const { cliContext, stdout, stderr } = w.createContext();
 *   const outcome = await runCli(["plan", w.repositoryRoot], cliContext);
 *   assert.equal(outcome.exitCode, 0);
 * } finally {
 *   await w.dispose();
 * }
 * ```
 *
 * Public API
 * - `buildCliWorld(nameOrDir, options?)` — bare names resolve under
 *   `tests/fixtures/cli/worlds/`; any other existing directory passes through to the
 *   008 `buildWorld` unchanged (import-only reuse of `tests/fixtures/engine/worlds/` for
 *   apply/rollback scenarios). Engine-harness options pass through (`config`,
 *   `screener`, `start`, `env`) plus `queueSurface` (default: a fresh
 *   `RecordingQueueSurface`).
 * - `CliWorld` — the wrapped `EngineWorld` plus `createContext(overrides?)` returning
 *   `{ cliContext, stdout, stderr }` (fresh captured line arrays per call), and
 *   `queue` (the default `RecordingQueueSurface` installed at build time).
 *   `createContext` overrides win member-by-member — inject a rogue port via
 *   `makePort`, capture the GUARDED deps via a `makeEngine` override
 *   (`(deps) => { captured = deps; return createSyncEngine(deps, …); }`), pass the
 *   real default `QueueSurface` via `queueSurface`, …
 * - `RecordingQueueSurface` — per-member call recorder (`records.installHooks` …),
 *   outcome/error injection per member (`inject(member, outcomeOrError)`), and the
 *   documented real-template behavior for `installAgentHook`: writes the 003 pure
 *   `agentHookScaffold` template file under the repository root (never overwriting an
 *   existing file — refused instead, presenting 010 semantics).
 * - `makeRoguePort(inner)` — `LinearPort` decorator for injected mutation attempts
 *   (FR-005/SC-003): every member delegates to `inner`; `armOnce(fn)` fires `fn()` at
 *   the next READ-member invocation. Tests capture the guarded composition through a
 *   `makeEngine` override and fire attempts against THAT view (e.g.
 *   `guardedPort.updateIssue(...)` / `guardedState.writeJson("sync-state.json", …)`) so
 *   the 009 `ReadOnlyGuard` turns the attempt into a `ReadOnlyViolationError` — nothing
 *   reaches `inner`.
 * - `makeWriteDroppingStore(store, dropIf)` — `StateStore` decorator silently dropping
 *   writes whose rel path matches (models a vanished artifact mid-run).
 * - `hashTree(dir)` / `listTree(dir)` — deterministic repo-tree walk (sorted rel POSIX
 *   paths + sha256 per file) for byte-identical before/after proofs (SC-003).
 * - `writeDriver(driverPath, opts)` — emits a `driver.mjs` importing
 *   `task-linear-sync/cli` (absolute `dist/cli/index.js` fallback per research R8a),
 *   wiring the fake world (repo copied into a temp workspace + temp state dir + fixed
 *   clock), running `runCli` (repository root inserted after the command name unless
 *   `noRepoInsertion`), mirroring captured output with `OUT|`/`ERR|` prefixes, and
 *   exiting with the CLI exit code.
 *
 * Header task IDs: T003 (Phase 1 shared infrastructure).
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ConfigOverrides, ResolvedConfig } from "task-linear-sync/config";
import type {
  EngineDependencies,
  LinearPort,
  SecurityScreener,
  SyncEngine,
} from "task-linear-sync/ports";
import type { Clock, KeyProvider, StateStore } from "task-linear-sync/state";
import { createSyncEngine } from "task-linear-sync/engine";
import { agentHookScaffold } from "task-linear-sync/discovery";

import type { BuildWorldOptions, EngineWorld } from "./engine-harness.js";
import { buildWorld } from "./engine-harness.js";

export { FakeClock, makeScreener } from "./test-utils.js";

/** Repository root (compiled helpers live at build/tests/helpers → three levels up). */
const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** Absolute directory of a named 009 world under tests/fixtures/cli/worlds/. */
export function cliWorldDir(name: string): string {
  return join(pkgRoot, "tests", "fixtures", "cli", "worlds", name);
}

// ──────────────────────────────────────────────────────────────── structural contract types

/** `contracts/queue-surface.md` §1 outcome (structural twin; data only). */
export interface QueueOutcomeLike {
  readonly status: "installed" | "skipped" | "enqueued" | "stopped" | "refused";
  readonly detail?: string;
  readonly installed?: readonly string[];
  readonly path?: string;
  readonly jobId?: string;
}

/** `contracts/queue-surface.md` §1 last-run outcome (structural twin). */
export interface LastRunOutcomeLike {
  readonly found: boolean;
  readonly marker?: {
    readonly runId: string;
    readonly outcome: "completed" | "failed" | "aborted";
    readonly completedAt: string;
    readonly reportPaths: { readonly json: string; readonly markdown: string } | null;
    readonly notificationSuppressed: boolean;
  };
}

/** Input bags mirror `contracts/queue-surface.md` §1 (one widened shape for the fake). */
export interface QueueInputLike {
  readonly repositoryRoot: string;
  readonly config: ResolvedConfig;
  readonly frameworkId?: string;
  readonly mode?: "bootstrap" | "sync";
  readonly once?: boolean;
  readonly state?: StateStore;
}

export interface QueueSurfaceLike {
  installHooks(o: QueueInputLike): Promise<QueueOutcomeLike>;
  installAgentHook(o: QueueInputLike): Promise<QueueOutcomeLike>;
  enqueue(o: QueueInputLike): Promise<QueueOutcomeLike>;
  runWorker(o: QueueInputLike): Promise<QueueOutcomeLike>;
  readLastRun(o: QueueInputLike): Promise<LastRunOutcomeLike>;
}

/** `data-model.md` §4 CliContext (structural twin; handlers never touch `process`). */
export interface CliContextLike {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
  readonly clock: Clock;
  readonly loadConfig: (o: { repositoryRoot: string; configFile?: string }) => ResolvedConfig;
  readonly makePort: (config: ResolvedConfig, env: Readonly<Record<string, string | undefined>>) => LinearPort;
  readonly makeScreener: (config: ResolvedConfig) => SecurityScreener;
  readonly makeEngine: (deps: EngineDependencies) => SyncEngine;
  readonly makeState: (config: ResolvedConfig, repositoryRoot: string) => StateStore;
  readonly queueSurface: QueueSurfaceLike;
}

// ──────────────────────────────────────────────────────────────── RecordingQueueSurface

export type QueueMember = keyof QueueSurfaceLike;

/** Per-member recorded inputs (assert against them freely). */
export interface QueueRecords {
  readonly installHooks: QueueInputLike[];
  readonly installAgentHook: QueueInputLike[];
  readonly enqueue: QueueInputLike[];
  readonly runWorker: QueueInputLike[];
  readonly readLastRun: QueueInputLike[];
}

type Injection = QueueOutcomeLike | LastRunOutcomeLike | Error;

/** Recording fake `QueueSurface` — recorder + per-member outcome/error injection. */
export interface RecordingQueueSurface extends QueueSurfaceLike {
  readonly records: QueueRecords;
  /** Calls of `member` resolve/reject with this until `clearInjection`. */
  inject(member: QueueMember, outcome: Injection): void;
  clearInjection(member: QueueMember): void;
  readonly injected: Readonly<Partial<Record<QueueMember, Injection>>>;
}

/**
 * Default fake outcomes (contract §1 rule 2 presentation fixtures):
 * `installHooks` → installed [pre-push, post-merge]; `installAgentHook` → the REAL 003
 * scaffold template written under `repositoryRoot` (refused when the file exists — never
 * overwritten); `enqueue` → enqueued with a deterministic job id; `runWorker` → stopped;
 * `readLastRun` → reads the frozen marker when a state store is provided.
 */
export function createRecordingQueueSurface(): RecordingQueueSurface {
  const records: QueueRecords = {
    installHooks: [],
    installAgentHook: [],
    enqueue: [],
    runWorker: [],
    readLastRun: [],
  };
  const injected: Partial<Record<QueueMember, Injection>> = {};

  function outcomeFor(member: Exclude<QueueMember, "readLastRun">, input: QueueInputLike): QueueOutcomeLike {
    switch (member) {
      case "installHooks":
        return { status: "installed", installed: ["pre-push", "post-merge"], detail: "managed hooks installed" };
      case "installAgentHook": {
        const frameworkId = input.frameworkId ?? "generic";
        const scaffold = agentHookScaffold(frameworkId, input.config.binName);
        if (scaffold === undefined) {
          return { status: "refused", detail: `framework '${frameworkId}' has no agent-hook scaffold` };
          }
        const dir = join(input.repositoryRoot, scaffold.directory);
        const file = join(dir, scaffold.fileName);
        if (existsSync(file)) {
          return { status: "refused", detail: `refusing to overwrite existing ${file}` };
        }
        // Real template write (010 semantics presented by the fake): only the local
        // scaffold file — zero network, zero tracker calls (FR-003 fixture).
        mkdirSync(dir, { recursive: true });
        writeFileSync(file, scaffold.contents, "utf8");
        return { status: "installed", path: file, detail: `agent hook scaffolded for ${frameworkId}` };
      }
      case "enqueue":
        return { status: "enqueued", jobId: "job-1", detail: "single pending job recorded" };
      case "runWorker":
        return { status: "stopped", detail: input.once === true ? "single pass complete" : "clean shutdown" };
    }
  }

  const surface: RecordingQueueSurface = {
    records,
    get injected(): Readonly<Partial<Record<QueueMember, Injection>>> {
      return injected;
    },
    inject(member, outcome): void {
      injected[member] = outcome;
    },
    clearInjection(member): void {
      delete injected[member];
    },
    async installHooks(input) {
      records.installHooks.push(input);
      const hit = injected.installHooks;
      if (hit instanceof Error) throw hit;
      return (hit as QueueOutcomeLike | undefined) ?? outcomeFor("installHooks", input);
    },
    async installAgentHook(input) {
      records.installAgentHook.push(input);
      const hit = injected.installAgentHook;
      if (hit instanceof Error) throw hit;
      return (hit as QueueOutcomeLike | undefined) ?? outcomeFor("installAgentHook", input);
    },
    async enqueue(input) {
      records.enqueue.push(input);
      const hit = injected.enqueue;
      if (hit instanceof Error) throw hit;
      return (hit as QueueOutcomeLike | undefined) ?? outcomeFor("enqueue", input);
    },
    async runWorker(input) {
      records.runWorker.push(input);
      const hit = injected.runWorker;
      if (hit instanceof Error) throw hit;
      return (hit as QueueOutcomeLike | undefined) ?? outcomeFor("runWorker", input);
    },
    async readLastRun(input) {
      records.readLastRun.push(input);
      const hit = injected.readLastRun;
      if (hit instanceof Error) throw hit;
      if (hit !== undefined) return hit as LastRunOutcomeLike;
      // Marker default: read the frozen last-run.json when a store is present.
      if (input.state !== undefined) {
        const { readLastRunMarker } = await import("task-linear-sync/state");
        const marker = await readLastRunMarker(input.state);
        return marker === null ? { found: false } : { found: true, marker };
      }
      return { found: false };
    },
  };
  return surface;
}

// ──────────────────────────────────────────────────────────────── rogue decorators

/** `makeRoguePort` handle: the decorated port + injection control (T032 seam). */
export interface RoguePort extends LinearPort {
  /** Fire `fn()` once, at the next read-member invocation. */
  armOnce(fn: () => unknown): void;
  /** Read-member invocations that fired an armed injection. */
  readonly attempts: number;
}

/**
 * Decorator seam for injected mid-run mutation attempts (FR-005 / SC-003). Every member
 * delegates to `inner`; when an injection is armed, the next READ member fires it before
 * delegating. Tests fire the injection against the GUARDED composition they capture via
 * a `makeEngine` override (`deps.port` / `deps.state`), so the attempt meets the 009
 * `ReadOnlyGuard` and never reaches `inner`.
 */
export function makeRoguePort(inner: LinearPort): RoguePort {
  let armed: (() => unknown) | null = null;
  let attempts = 0;

  function fire(): void {
    if (armed === null) return;
    const fn = armed;
    armed = null;
    attempts += 1;
    fn();
  }

  const rogue: RoguePort = {
    get attempts(): number {
      return attempts;
    },
    armOnce(fn): void {
      armed = fn;
    },
    listIssues(scope) {
      fire();
      return inner.listIssues(scope);
    },
    async discoverMetadata(teamKeys) {
      fire();
      return inner.discoverMetadata(teamKeys);
    },
    async getIssue(id) {
      fire();
      return inner.getIssue(id);
    },
    async createIssue(input) {
      return inner.createIssue(input);
    },
    async updateIssue(id, patch) {
      return inner.updateIssue(id, patch);
    },
    async archiveIssue(id) {
      return inner.archiveIssue(id);
    },
    async findIssuesByAttachmentUrl(url) {
      fire();
      return inner.findIssuesByAttachmentUrl(url);
    },
    async upsertAttachmentByUrl(input) {
      return inner.upsertAttachmentByUrl(input);
    },
    async updateAttachment(id, metadata) {
      return inner.updateAttachment(id, metadata);
    },
    async getAttachmentByUrl(url) {
      fire();
      return inner.getAttachmentByUrl(url);
    },
    async listAttachments(issueId, cursor) {
      fire();
      return inner.listAttachments(issueId, cursor);
    },
  };
  return rogue;
}

/** `StateStore` decorator silently dropping configured writes (vanished-artifact model). */
export function makeWriteDroppingStore(store: StateStore, dropIf: (rel: string) => boolean): StateStore {
  return {
    ...store,
    async writeJson(rel: string, value: unknown): Promise<void> {
      if (dropIf(rel)) return;
      await store.writeJson(rel, value);
    },
    async writeText(rel: string, text: string): Promise<void> {
      if (dropIf(rel)) return;
      await store.writeText(rel, text);
    },
  };
}

// ──────────────────────────────────────────────────────────────── tree hashing

/** Deterministic tree digest: sorted root-relative POSIX paths + sha256 per file. */
export function hashTree(dir: string): string {
  const hash = createHash("sha256");
  walkInto(dir, "", (rel) => {
    hash.update(rel);
    hash.update("\u0000");
    hash.update(createHash("sha256").update(readFileSync(join(dir, rel))).digest("hex"));
    hash.update("\u0000");
  });
  return hash.digest("hex");
}

/** Sorted list of every regular file under `dir` (relative POSIX paths). */
export function listTree(dir: string): string[] {
  const out: string[] = [];
  walkInto(dir, "", (rel) => out.push(rel));
  return out;
}

function walkInto(dir: string, prefix: string, visit: (rel: string) => void): void {
  if (!existsSync(dir)) return;
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    const rel = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) walkInto(join(dir, entry.name), rel, visit);
    else if (entry.isFile()) visit(rel);
  }
}

// ──────────────────────────────────────────────────────────────── buildCliWorld

export interface BuildCliWorldOptions extends BuildWorldOptions {
  /** QueueSurface injected into the context (default: a fresh `RecordingQueueSurface`). */
  readonly queueSurface?: QueueSurfaceLike;
}

/** One `createContext()` result: the context plus fresh capture buffers. */
export interface CliContextBundle {
  readonly cliContext: CliContextLike;
  readonly stdout: string[];
  readonly stderr: string[];
}

export interface CliWorld {
  readonly world: EngineWorld;
  readonly name: string;
  readonly repositoryRoot: string;
  readonly stateDir: string;
  readonly config: ResolvedConfig;
  readonly clock: EngineWorld["clock"];
  readonly deps: EngineDependencies;
  readonly state: StateStore;
  readonly fake: EngineWorld["fake"];
  readonly port: LinearPort;
  readonly keyProvider: KeyProvider;
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The `RecordingQueueSurface` installed by `buildCliWorld` (when the default is used). */
  readonly queue: RecordingQueueSurface | undefined;
  /** Fixture source directory (world.json + repo/ live here). */
  readonly fixtureDir: string;
  /** Requests reaching the fake port (zero-network assertions, FR-003). */
  requests(): readonly unknown[];
  /** Build a CLI context over this world; overrides win member-by-member. */
  createContext(overrides?: Partial<CliContextLike>): CliContextBundle;
  /** Extra temp path inside the world root (auto-removed on dispose). */
  tempPath(name: string): string;
  dispose(): Promise<void>;
}

/**
 * Build a CLI world. Bare names resolve under `tests/fixtures/cli/worlds/`; any existing
 * directory (e.g. an 008 engine world path) passes through to `buildWorld` unchanged.
 */
export async function buildCliWorld(nameOrDir: string, options: BuildCliWorldOptions = {}): Promise<CliWorld> {
  const fixtureDir = existsSync(nameOrDir) ? nameOrDir : cliWorldDir(nameOrDir);
  if (!existsSync(fixtureDir)) {
    throw new Error(`cli world '${nameOrDir}' not found (no such directory or cli-worlds entry)`);
  }
  const { queueSurface, ...worldOptions } = options;
  const world = await buildWorld(fixtureDir, worldOptions);
  const queue = queueSurface === undefined ? createRecordingQueueSurface() : undefined;
  const defaultSurface: QueueSurfaceLike = queueSurface ?? (queue as RecordingQueueSurface);
  const scratchRoot = join(world.root, "cli-scratch");

  const keyProviderOption: { keyProvider: KeyProvider } = { keyProvider: world.keyProvider };

  function createContext(overrides: Partial<CliContextLike> = {}): CliContextBundle {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const cliContext: CliContextLike = {
      cwd: world.repositoryRoot,
      env: world.env,
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
      clock: world.clock,
      loadConfig: () => world.config,
      makePort: () => world.port,
      makeScreener: () => world.screener,
      makeEngine: (deps) => createSyncEngine(deps, keyProviderOption),
      makeState: () => world.state,
      queueSurface: defaultSurface,
      ...overrides,
    };
    return { cliContext, stdout, stderr };
  }

  return {
    world,
    name: world.name,
    fixtureDir,
    repositoryRoot: world.repositoryRoot,
    stateDir: world.stateDir,
    config: world.config,
    clock: world.clock,
    deps: world.deps,
    state: world.state,
    fake: world.fake,
    port: world.port,
    keyProvider: world.keyProvider,
    env: world.env,
    queue,
    requests: () => world.requests() as readonly unknown[],
    createContext,
    tempPath: (name: string) => join(scratchRoot, name),
    async dispose(): Promise<void> {
      await rm(scratchRoot, { recursive: true, force: true }).catch(() => undefined);
      await world.dispose();
    },
  };
}

// ──────────────────────────────────────────────────────────────── writeDriver (e2e)

export interface WriteDriverOptions {
  /** Absolute path of the `driver.mjs` file to emit. */
  readonly driverPath: string;
  /** Absolute world directory (world.json + repo/ are read by the driver). */
  readonly worldDir: string;
  /** argv for `runCli` (repository root is inserted after the command name). */
  readonly argv: readonly string[];
  /** Extra `ConfigOverrides` merged over world.json `config` (stateDirectory stays driver-owned). */
  readonly config?: ConfigOverrides;
  /** Journaling override passed as the engine option (default: engine default + config). */
  readonly journalingEnabled?: boolean;
  /** Fixed-clock start (default: world.json `clock` else the 008 harness start). */
  readonly start?: string;
  /** When true the argv already carries the repository root and no insertion happens. */
  readonly noRepoInsertion?: boolean;
}

/**
 * Emit a `driver.mjs` that runs the REAL CLI core in a child process with fake wiring
 * (research R8a). See `WriteDriverOptions` for behavior.
 */
export function writeDriver(opts: WriteDriverOptions): void {
  const dist = (rel: string): string => resolve(pkgRoot, "dist", rel);
  const url = (rel: string): string => `file://${dist(rel)}`;
  const driver = `#!/usr/bin/env node
// Generated by tests/helpers/cli-harness.ts writeDriver — 009 e2e child-process drive.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function loadModule(selfRef, absUrl) {
  try {
    return await import(selfRef);
  } catch {
    return await import(absUrl);
  }
}

const cli = await loadModule("task-linear-sync/cli", ${JSON.stringify(url("cli/index.js"))});
const trackerTesting = await loadModule("task-linear-sync/tracker/testing", ${JSON.stringify(url("tracker/testing/index.js"))});
const configMod = await loadModule("task-linear-sync/config", ${JSON.stringify(url("config/index.js"))});
const stateMod = await loadModule("task-linear-sync/state", ${JSON.stringify(url("state/index.js"))});
const engineMod = await loadModule("task-linear-sync/engine", ${JSON.stringify(url("engine/index.js"))});

const worldDir = ${JSON.stringify(resolve(opts.worldDir))};
const worldDoc = JSON.parse(readFileSync(join(worldDir, "world.json"), "utf8"));
const root = mkdtempSync(join(tmpdir(), "tls-009-driver-"));
const repositoryRoot = join(root, "repo");
if (existsSync(join(worldDir, "repo"))) cpSync(join(worldDir, "repo"), repositoryRoot, { recursive: true });
else mkdirSync(repositoryRoot, { recursive: true });
const stateDir = join(root, "state");

const startIso = ${JSON.stringify(opts.start ?? null)} ?? worldDoc.clock ?? "2026-01-01T00:00:00.000Z";
const clock = stateMod.fixedClock(new Date(startIso));
const config = configMod.loadConfig({
  overrides: { ...(worldDoc.config ?? {}), ${JSON.stringify(opts.config ?? {})}, stateDirectory: stateDir },
});
const fake = trackerTesting.createFakeLinearPort({
  teams: worldDoc.teams ?? [],
  issues: worldDoc.issues ?? [],
  attachments: worldDoc.attachments ?? [],
});
const state = stateMod.createStateStore({ repositoryRoot, config, clock });
await state.ensure();

const keyValue = createHash("sha256")
  .update("task-linear-sync/009-driver/test-manifest-key/" + config.manifestKeyId)
  .digest("hex");
const keyBytes = Buffer.from(keyValue, "hex");
const keyProvider = { getKey: async (keyId) => (keyId === config.manifestKeyId ? keyBytes : null) };

const stdout = [];
const stderr = [];
const context = {
  cwd: repositoryRoot,
  env: { [config.manifestKeyEnvVarName]: keyValue },
  stdout: (line) => stdout.push(line),
  stderr: (line) => stderr.push(line),
  clock,
  loadConfig: () => config,
  makePort: () => fake,
  makeScreener: () => engineMod.createDefaultSecurityScreener(config),
  makeEngine: (deps) => engineMod.createSyncEngine(deps, { keyProvider${opts.journalingEnabled === undefined ? "" : `, journalingEnabled: ${String(opts.journalingEnabled)}`} }),
  makeState: () => state,
  queueSurface: cli.createDefaultQueueSurface(),
};

const argv = ${JSON.stringify([...opts.argv])};
const finalArgv = ${opts.noRepoInsertion === true ? "argv" : "argv.length === 0 ? argv : [argv[0], repositoryRoot, ...argv.slice(1)]"};
const outcome = await cli.runCli(finalArgv, context);
for (const line of stdout) process.stdout.write("OUT|" + line + "\\n");
for (const line of stderr) process.stdout.write("ERR|" + line + "\\n");
process.exitCode = outcome.exitCode;
`;
  writeFileSync(opts.driverPath, driver, "utf8");
}
