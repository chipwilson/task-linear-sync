/**
 * T015 — `CliContext`: the single injection seam (data-model §4; research R1/R5/R8) and
 * `createProductionContext()`, wiring only frozen factories: `loadConfig` (001),
 * `createLinearPort` (007), `createDefaultSecurityScreener` + `createSyncEngine` (008),
 * the frozen `StateStore` factory (002), and `createDefaultQueueSurface()` (T012).
 * Handlers never touch `process` — the production wiring below is the sole `process`
 * consumer, invoked from `main.ts`.
 */
import process from "node:process";
import { join } from "node:path";

import { loadConfig as loadFrozenConfig, validateWorkspaceIdentity } from "../config/index.js";
import type { ResolvedConfig } from "../config/schema.js";
import type { EngineDependencies, SecurityScreener, SyncEngine } from "../ports/engine.js";
import type { LinearPort } from "../ports/linear-port.js";
import { createDefaultSecurityScreener, createSyncEngine, envVarKeyProvider } from "../engine/index.js";
import { createStateStore, systemClock } from "../state/index.js";
import type { Clock, StateStore } from "../state/index.js";
import { createLinearPort } from "../tracker/index.js";
import { createDefaultQueueSurface } from "./queue-surface.js";
import type { QueueSurface } from "./queue-surface.js";

/** `loadConfig` input the CLI passes: canonical repo root + optional `--config` path. */
export interface CliLoadConfigOptions {
  readonly repositoryRoot: string;
  readonly configFile?: string;
}

/** The single injection seam (data-model §4) — every member replaceable per test. */
export interface CliContext {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly stdout: (line: string) => void;
  readonly stderr: (line: string) => void;
  readonly clock: Clock;
  readonly loadConfig: (o: CliLoadConfigOptions) => ResolvedConfig;
  readonly makePort: (config: ResolvedConfig, env: Readonly<Record<string, string | undefined>>) => LinearPort;
  readonly makeScreener: (config: ResolvedConfig) => SecurityScreener;
  readonly makeEngine: (deps: EngineDependencies) => SyncEngine;
  readonly makeState: (config: ResolvedConfig, repositoryRoot: string) => StateStore;
  readonly queueSurface: QueueSurface;
}

/**
 * Production wiring. Config resolution: `--config` value verbatim, else
 * `<repositoryRoot>/<configFileName>` (001 default `<toolId>.json`); a missing /
 * unreadable / invalid file aborts via the frozen `ConfigFileError` (exit 3) and the
 * frozen workspace-identity validation throws `MissingIdentityError` (exit 3).
 */
export function createProductionContext(overrides: Partial<CliContext> = {}): CliContext {
  const env = overrides.env ?? process.env;
  const clock = overrides.clock ?? systemClock;
  const context: CliContext = {
    cwd: process.cwd(),
    env,
    stdout: (line) => {
      process.stdout.write(`${line}\n`);
    },
    stderr: (line) => {
      process.stderr.write(`${line}\n`);
    },
    clock,
    loadConfig: (o) => {
      const defaults = loadFrozenConfig({});
      const configFile = o.configFile ?? join(o.repositoryRoot, defaults.configFileName);
      const config = loadFrozenConfig({ configFile, env, clock });
      validateWorkspaceIdentity(config);
      return config;
    },
    makePort: (config, portEnv) => createLinearPort({ config, options: { env: { ...portEnv } } }),
    makeScreener: (config) => createDefaultSecurityScreener(config),
    makeEngine: (deps) => createSyncEngine(deps, { keyProvider: envVarKeyProvider(deps.config, env) }),
    makeState: (config, repositoryRoot) => createStateStore({ repositoryRoot, config, clock }),
    queueSurface: createDefaultQueueSurface(),
    ...overrides,
  };
  return context;
}
