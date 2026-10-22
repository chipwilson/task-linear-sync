/**
 * State-directory placement (research R6) + the StateStore surface from
 * contracts/run-state.md. Out-of-repo by construction: an inside-repo (or equal-to-repo)
 * resolved path ABORTS with StatePlacementError — never falls back to an in-tree location
 * (SC-003, edge case).
 */
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

import type { ResolvedConfig } from "../config/schema.js";
import { atomicWriteJson, ensurePrivateDir, readJsonFile, atomicWriteText } from "./fs.js";
import type { Clock } from "./clock.js";

/** Raised when the resolved state path would land inside the repository working tree. */
export class StatePlacementError extends Error {
  override readonly name = "StatePlacementError";
}

export interface StateStoreOptions {
  /** Canonicalized (realpath, symlinks resolved). */
  readonly repositoryRoot: string;
  readonly config: ResolvedConfig;
  /** Injected (R16). */
  readonly clock: Clock;
}

export interface StateStorePaths {
  /** lock.json */
  readonly lock: string;
  /** sync-state.json (checkpoints; 008 read/write) */
  readonly syncState: string;
  /** plans/<planId>.json */
  readonly plans: string;
  /** manifests/<runId>.manifest.json */
  readonly manifests: string;
  /** intents/<intentId>.json */
  readonly intents: string;
  /** reports/<runId>/{report.json,report.md} */
  readonly reports: string;
  /** last-run.json */
  readonly lastRun: string;
  /** pending-job.json (010 behavior) */
  readonly queue: string;
}

export interface StateStore {
  /**
   * Resolution (FR-001): configured stateDirectory verbatim; else platform default
   * <base>/<toolId>/<hash16> (R6). ABORTS (StatePlacementError) if inside/equal the repo
   * root — never falls back to an in-tree location.
   */
  readonly root: string;
  readonly paths: StateStorePaths;
  /** Merged configuration the store was created with (expiry/lock thresholds, key names). */
  readonly config: ResolvedConfig;
  /** Injected clock (R16) for timestamped lifecycle records. */
  readonly clock: Clock;
  /** mkdir 0o700 recursively; every state file via temp+rename chmod 0o600 (R7). */
  ensure(): Promise<void>;
  /** Atomic, owner-only JSON write of a root-relative path. */
  writeJson(rel: string, value: unknown): Promise<void>;
  /** Atomic, owner-only text write of a root-relative path. */
  writeText(rel: string, text: string): Promise<void>;
  /** Root-relative JSON read; null when absent; rejects non-object roots. */
  readJson<T>(rel: string): Promise<T | null>;
}

/** Canonical absolute path: resolve, then realpath where the path exists (R6). */
export function canonicalizePath(p: string): string {
  const abs = resolve(p);
  try {
    return realpathSync(abs);
  } catch {
    return abs;
  }
}

/** Per-platform application-state base (R6). */
export function platformStateBase(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
): string {
  if (platform === "win32") {
    return env.APPDATA && env.APPDATA.length > 0 ? env.APPDATA : join(home, "AppData", "Roaming");
  }
  if (platform === "darwin") {
    return join(home, "Library", "Application Support");
  }
  // Linux/BSD/other POSIX: $XDG_STATE_HOME or ~/.local/state
  const xdg = env.XDG_STATE_HOME;
  return xdg !== undefined && xdg.length > 0 ? xdg : join(home, ".local", "state");
}

/** First 16 hex chars of sha256 over the canonical absolute repository root path (UTF-8). */
export function stateDirHash16(canonicalRepoRoot: string): string {
  return createHash("sha256").update(canonicalRepoRoot, "utf8").digest("hex").slice(0, 16);
}

function isInsideOrEqual(repoRoot: string, candidate: string): boolean {
  const rel = relative(repoRoot, candidate);
  return rel === "" || (!rel.startsWith(".." + (candidate.includes("\\") ? "\\" : "/")) && !isAbsolute(rel));
}

/**
 * Resolution order (R6/FR-001):
 *  1. configured `stateDirectory` — used verbatim after canonicalization;
 *  2. platform default `<base>/<toolId-segment>/<hash16(canonical repo root)>`.
 * Inside-repo rule: resolved path inside or equal to the canonical repository root aborts
 * with StatePlacementError; there is no in-tree fallback (SC-003).
 */
export function resolveStateDir(
  repositoryRoot: string,
  config: ResolvedConfig,
  env?: NodeJS.ProcessEnv,
): string {
  const repoRoot = canonicalizePath(repositoryRoot);
  const configured = config.stateDirectory;
  const candidate =
    configured !== undefined && configured.trim().length > 0
      ? canonicalizePath(configured)
      : join(platformStateBase(env), config.stateDirAppSegment, stateDirHash16(repoRoot));

  if (isInsideOrEqual(repoRoot, candidate)) {
    throw new StatePlacementError(
      `state directory '${candidate}' resolves inside (or equal to) the repository root '${repoRoot}'; ` +
        `run state MUST live outside the repository working tree — set stateDirectory outside the repo`,
    );
  }
  return candidate;
}

/** Compose the StateStore: resolved placement (R6) + owner-only atomic fs primitives (R7). */
export function createStateStore(options: StateStoreOptions): StateStore {
  const { config, clock } = options;
  const root = resolveStateDir(options.repositoryRoot, config);
  const p = (rel: string): string => join(root, rel);

  const store: StateStore = {
    root,
    config,
    clock,
    paths: {
      lock: p("lock.json"),
      syncState: p("sync-state.json"),
      plans: p("plans"),
      manifests: p("manifests"),
      intents: p("intents"),
      reports: p("reports"),
      lastRun: p("last-run.json"),
      queue: p("pending-job.json"),
    },
    async ensure(): Promise<void> {
      ensurePrivateDir(root);
    },
    async writeJson(rel: string, value: unknown): Promise<void> {
      atomicWriteJson(p(rel), value);
    },
    async writeText(rel: string, text: string): Promise<void> {
      atomicWriteText(p(rel), text);
    },
    async readJson<T>(rel: string): Promise<T | null> {
      return readJsonFile<T>(p(rel));
    },
  };
  return store;
}
