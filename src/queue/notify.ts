/**
 * T017 — Best-effort desktop notifications (spec 010 FR-020/FR-021; research R11;
 * queue-protocol.md §6). Delivery NEVER throws: every failure channel (missing helper,
 * non-zero exit, sink write error) collapses to `"undeliverable"`. Precedence:
 * test-file sink (`TASK_LINEAR_SYNC_TEST_NOTIFY`, quickstart §7) > per-platform helper
 * (`osascript` / `notify-send` / `powershell`). Suppression (disabled setting or a
 * redaction-failed marker) short-circuits BEFORE the notifier seam is touched.
 */
import { spawn as nodeSpawn } from "node:child_process";
import { accessSync, constants, existsSync, statSync } from "node:fs";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { NotifyOutcome, Notifier } from "./types.js";

/** Env var that redirects notifications into a file sink (hermetic test lane). */
export const NOTIFY_SINK_ENV = "TASK_LINEAR_SYNC_TEST_NOTIFY";

/** Title/body pair handed to the Notifier seam. */
export interface NotifyContent {
  readonly title: string;
  readonly body: string;
}

/** Notification content builder: title `"<toolId> sync <outcome>"`, body ≤ 300 chars. */
export function buildNotificationContent(o: {
  toolId?: string;
  outcome: string;
  detail?: string;
}): NotifyContent {
  const toolId = o.toolId !== undefined && o.toolId.length > 0 ? o.toolId : "task-linear-sync";
  const title = `${toolId} sync ${o.outcome}`;
  const firstLine = (o.detail ?? o.outcome).split("\n")[0]!.trim();
  const body = firstLine.length <= 300 ? firstLine : `${firstLine.slice(0, 297)}...`;
  return { title, body };
}

export interface MaybeNotifyInput {
  readonly enabled?: boolean;
  readonly suppressed?: boolean;
  readonly content: NotifyContent;
}

/**
 * Suppression short-circuit (FR-020/FR-021): disabled setting or suppressed marker ⇒
 * zero attempt, `"suppressed"`. Otherwise delegate; a throwing notifier degrades.
 */
export async function maybeNotify(notifier: Notifier, input: MaybeNotifyInput): Promise<NotifyOutcome> {
  if (input.enabled === false || input.suppressed === true) return "suppressed";
  try {
    return await notifier.notify(input.content);
  } catch {
    return "undeliverable"; // never propagates — notification is never load-bearing
  }
}

/** Injection bag for the production Notifier (all seams replaceable in tests). */
export interface NotifierDeps {
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly which: (tool: string) => string | null;
  readonly platform: NodeJS.Platform;
  readonly spawn: (program: string, args: readonly string[]) => Promise<{ code: number }>;
}

function appleQuote(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function powershellQuote(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

function helperArgs(platform: NodeJS.Platform, title: string, body: string): readonly string[] {
  if (platform === "darwin") {
    return ["-e", `display notification ${appleQuote(body)} with title ${appleQuote(title)}`];
  }
  if (platform === "win32") {
    return [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Add-Type -AssemblyName System.Windows.Forms; ` +
        `[System.Windows.Forms.NotifyIcon]::new(${powershellQuote(title)}).ShowBalloonTip(5000, ${powershellQuote(title)}, ${powershellQuote(body)}, [System.Windows.Forms.ToolTipIcon]::Info)`,
    ];
  }
  return [title, body]; // notify-send "summary" "body"
}

function helperFor(platform: NodeJS.Platform): string {
  if (platform === "darwin") return "osascript";
  if (platform === "win32") return "powershell";
  return "notify-send";
}

/**
 * The production Notifier over the queue-protocol §6 seam. The injected `which` decides
 * helper availability; the spawn runs by bare tool name (PATH-resolved by the OS).
 */
export function createNotifier(deps: NotifierDeps): Notifier {
  return {
    async notify({ title, body }): Promise<NotifyOutcome> {
      const sink = deps.env[NOTIFY_SINK_ENV];
      if (typeof sink === "string" && sink.length > 0) {
        try {
          const parent = dirname(sink);
          if (!existsSync(parent)) await mkdir(parent).catch(() => undefined); // best-effort; appendFile reports the real failure (recursive mkdir can stall on exotic mounts like /proc)
          await appendFile(sink, `${JSON.stringify({ title, body })}\n`, "utf8");
          return "delivered";
        } catch {
          return "undeliverable";
        }
      }
      const helper = helperFor(deps.platform);
      if (deps.which(helper) === null) return "undeliverable";
      try {
        const result = await deps.spawn(helper, helperArgs(deps.platform, title, body));
        return result.code === 0 ? "delivered" : "undeliverable";
      } catch {
        return "undeliverable";
      }
    },
  };
}

function spawnToExit(program: string, args: readonly string[]): Promise<{ code: number }> {
  return new Promise((resolve, reject) => {
    const child = nodeSpawn(program, [...args], { stdio: "ignore", detached: false });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1 }));
  });
}
export { spawnToExit };

/** PATH scan resolving a bare tool name to an existing executable file (null when absent). */
export function makePathScanner(env: Readonly<Record<string, string | undefined>>): (tool: string) => string | null {
  const separator = process.platform === "win32" ? ";" : ":";
  const entries = (env.PATH ?? "").split(separator).filter((part) => part.length > 0);
  return (tool: string): string | null => {
    for (const dir of entries) {
      const candidate = `${dir}/${tool}`;
      try {
        // sync checks are fine here: availability probe before a detached spawn
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          try {
            accessSync(candidate, constants.X_OK);
            return candidate;
          } catch {
            /* present but not executable — keep scanning */
          }
        }
      } catch {
        /* unreadable PATH entry — skip */
      }
    }
    return null;
  };
}

/** Production wiring: real env, PATH scan, real spawn, host platform. */
export function createProductionNotifier(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform,
): Notifier {
  return createNotifier({ env, which: makePathScanner(env), platform, spawn: spawnToExit });
}
