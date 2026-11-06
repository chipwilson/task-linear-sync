/**
 * 013-ci-enforcement-layer CLI-invoker seam (T032; research R3,
 * wrapper-api.md §2).
 *
 * The ONLY module in `src/ci/` allowed to import `node:child_process`
 * (hygiene invariant 3). Command set is CLOSED (`check` | `plan`): the argv
 * builder has no mutate/apply mode by construction (SC-002).
 */

import { spawn as nodeSpawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

import type { SecurityScreener } from "../ports/engine.js";

import { CiCliFailureError } from "./errors.js";

export interface CliRequest {
  readonly command: "check" | "plan";
  readonly workspace: string;
  readonly configFile?: string;
  readonly cliEntry?: string | null;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export type CliInvoker = (request: CliRequest) => Promise<CliResult>;

/** Minimal child-process surface (injectable for tests). */
interface ChildLike {
  readonly stdout: { on: (event: "data", cb: (chunk: Buffer) => void) => void };
  readonly stderr: { on: (event: "data", cb: (chunk: Buffer) => void) => void };
  on: ((event: "close", cb: (code: number | null) => void) => void) &
    ((event: "error", cb: (error: Error) => void) => void);
}

type SpawnLike = (
  command: string,
  args: readonly string[],
  options: Readonly<Record<string, unknown>>,
) => ChildLike;

export interface SpawnCliInvokerOptions {
  /** Injected spawn (default: `node:child_process.spawn`). */
  readonly spawn?: SpawnLike;
  /** Screener for failure-message stderr tails (default: identity). */
  readonly screener?: SecurityScreener;
  /** Existence probe (default: `node:fs.existsSync`). */
  readonly exists?: (path: string) => boolean;
  /** Action/package root holding `dist/cli/main.js` (default: this package). */
  readonly actionRoot?: string;
}

/** Action root = package root for this compiled module (src/ or dist/ depth 2). */
const DEFAULT_ACTION_ROOT = new URL("../../", import.meta.url).pathname;

const IDENTITY_SCREENER: SecurityScreener = {
  screen: (text) => ({ output: text, blocked: [], findings: [] }),
};

/** Last `max` characters of `text`, collapsed to one line. */
function tail(text: string, max: number): string {
  const oneLine = text.trimEnd().slice(-max).replace(/\s+/g, " ");
  return oneLine.trim();
}

/**
 * Build the spawn invoker (R3): entry resolution order explicit -> action-root
 * `dist/cli/main.js` -> workspace `dist/cli/main.js` -> workspace
 * `node_modules/task-linear-sync/dist/cli/main.js` (miss ⇒ `CiCliFailureError`
 * naming every candidate); argv `[entry, command, workspace, "--config"?]`,
 * NO shell; exits 0/8 proceed, anything else ⇒ `CiCliFailureError`.
 */
export function createSpawnCliInvoker(options: SpawnCliInvokerOptions = {}): CliInvoker {
  const spawn = options.spawn ?? (nodeSpawn as unknown as SpawnLike);
  const screener = options.screener ?? IDENTITY_SCREENER;
  const exists = options.exists ?? existsSync;
  const actionRoot = options.actionRoot ?? DEFAULT_ACTION_ROOT;

  function resolveEntry(request: CliRequest): string {
    if (request.cliEntry !== undefined && request.cliEntry !== null && request.cliEntry !== "") {
      return request.cliEntry;
    }
    const candidates = [
      join(actionRoot, "dist", "cli", "main.js"),
      join(request.workspace, "dist", "cli", "main.js"),
      join(request.workspace, "node_modules", "task-linear-sync", "dist", "cli", "main.js"),
    ];
    for (const candidate of candidates) {
      if (exists(candidate)) {
        return candidate;
      }
    }
    throw new CiCliFailureError(
      `task-linear-sync CLI entry not found for \`${request.command}\` — looked in: ${candidates.join(", ")} (install task-linear-sync or set cli-entry)`,
      request.command,
      null,
    );
  }

  return (request: CliRequest): Promise<CliResult> =>
    new Promise<CliResult>((resolvePromise, rejectPromise) => {
      const entry = resolveEntry(request);
      const argv: string[] = [entry, request.command, request.workspace];
      if (request.configFile !== undefined && request.configFile !== "") {
        argv.push("--config", request.configFile);
      }
      let settled = false;
      let stdout = "";
      let stderr = "";
      const child = spawn(process.execPath, argv, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, ...(request.env ?? {}) },
      });
      child.stdout.on("data", (chunk) => {
        stdout += chunk.toString("utf8");
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString("utf8");
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        rejectPromise(
          new CiCliFailureError(
            `task-linear-sync CLI command \`${request.command}\` could not be spawned — ${screener.screen(error.message).output}`,
            request.command,
            null,
          ),
        );
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        if (code === 0 || code === 8) {
          resolvePromise({ exitCode: code, stdout, stderr });
          return;
        }
        rejectPromise(
          new CiCliFailureError(
            `task-linear-sync CLI command \`${request.command}\` failed with exit code ${String(code)} — ${screener.screen(tail(stderr, 400)).output}`,
            request.command,
            code,
          ),
        );
      });
    });
}
