/**
 * T005/T007 — Hand-rolled validator for the additive `queue` config group (research R2/R3;
 * data-model.md §4) + `validateQueueWiring` for the QueueSurface seam (queue-protocol §2
 * step 1, queue-surface-implementation.md §3). Zero new dependencies (no schema library);
 * validation is a PURE read of the frozen ResolvedConfig — never a mutation.
 */
import type { ResolvedConfig } from "../config/schema.js";
import type { QueueOutcomeResult, QueueSettings } from "./types.js";

/** Raw `queue` group as it may appear in any config layer (unknown keys included). */
export type RawQueueGroup = Readonly<Record<string, unknown>>;

export type QueueConfigResult =
  | { readonly ok: true; readonly settings: QueueSettings }
  | { readonly ok: false; readonly errors: readonly string[]; readonly settings: QueueSettings };

const KNOWN_KEYS: readonly string[] = [
  "workerDelaySeconds",
  "lockTimeoutSeconds",
  "maxRetries",
  "notificationsEnabled",
  "autoAcceptLowConfidence",
  "hookScriptPrefix",
  "hooksDirectory",
  "agentHooksDirectory",
];

function rawQueueGroup(config: ResolvedConfig): RawQueueGroup | undefined {
  const group = (config as unknown as Readonly<Record<string, unknown>>)["queue"];
  if (group === undefined || group === null) return undefined;
  if (typeof group !== "object" || Array.isArray(group)) return { __invalid_group__: true };
  return group as RawQueueGroup;
}

/**
 * Resolve defaults + validate the `queue` group. On failure, ALL problems are collected
 * into exactly ONE dotted-key line (complete listing, contract §2 step 1) and `settings`
 * carries the pure defaults (callers must check `ok`).
 */
export function resolveQueueConfig(config: ResolvedConfig): QueueConfigResult {
  const defaults: QueueSettings = {
    workerDelaySeconds: 75,
    lockTimeoutSeconds: 30,
    maxRetries: 5,
    notificationsEnabled: true,
    autoAcceptLowConfidence: false, // never widened implicitly (SC-005 posture)
    hookScriptPrefix: config.binName,
    hooksDirectory: undefined,
    agentHooksDirectory: undefined,
  };
  const group = rawQueueGroup(config);
  if (group === undefined) return { ok: true, settings: defaults };
  if ("__invalid_group__" in group) {
    return { ok: false, errors: ["queue: the group must be an object"], settings: defaults };
  }

  const problems: string[] = [];
  const settings: Record<string, unknown> = { ...defaults };

  for (const key of Object.keys(group)) {
    if (!KNOWN_KEYS.includes(key)) {
      problems.push(`queue.${key}: unknown key`);
      continue;
    }
    const value = group[key];
    switch (key) {
      case "workerDelaySeconds":
      case "lockTimeoutSeconds":
      case "maxRetries": {
        const bounds = key === "workerDelaySeconds" ? [1, 3600] : key === "lockTimeoutSeconds" ? [1, 300] : [1, 100];
        if (typeof value !== "number" || !Number.isInteger(value) || value < bounds[0] || value > bounds[1]) {
          problems.push(`queue.${key}: must be an integer in ${bounds[0]}..${bounds[1]}`);
        } else {
          settings[key] = value;
        }
        break;
      }
      case "notificationsEnabled":
      case "autoAcceptLowConfidence": {
        if (typeof value !== "boolean") {
          problems.push(`queue.${key}: must be a boolean`);
        } else {
          settings[key] = value;
        }
        break;
      }
      case "hookScriptPrefix": {
        if (typeof value !== "string" || value.length === 0) {
          problems.push("queue.hookScriptPrefix: must be a non-empty string");
        } else {
          settings[key] = value;
        }
        break;
      }
      case "hooksDirectory": {
        // Absolute paths only — a relative hooks dir would silently depend on cwd (R9).
        if (typeof value !== "string" || value.length === 0 || !value.startsWith("/")) {
          problems.push("queue.hooksDirectory: must be an absolute path");
        } else {
          settings[key] = value;
        }
        break;
      }
      case "agentHooksDirectory": {
        if (typeof value !== "string" || value.length === 0) {
          problems.push("queue.agentHooksDirectory: must be a non-empty string");
        } else {
          settings[key] = value;
        }
        break;
      }
    }
  }

  if (problems.length > 0) {
    return { ok: false, errors: [problems.join("; ")], settings: defaults };
  }
  return { ok: true, settings: settings as unknown as QueueSettings };
}

/**
 * Structural check of the optional QueueWiring members (queue-surface-implementation.md §3):
 * a malformed member surfaces as a refused result instead of a mid-flight TypeError.
 * Returns undefined when everything present is well-formed (absent wiring passes).
 */
export function validateQueueWiring(
  wiring: Record<string, unknown> | undefined,
  _method: string,
): QueueOutcomeResult | undefined {
  if (wiring === undefined) return undefined;
  const problems: string[] = [];
  const check = (member: string, predicate: (value: unknown) => boolean): void => {
    const value = wiring[member];
    if (value !== undefined && !predicate(value)) problems.push(member);
  };
  check("clock", (v) => typeof v === "object" && v !== null && typeof (v as { now?: unknown }).now === "function");
  check("sleep", (v) => typeof v === "function");
  check("spawnWorker", (v) => typeof v === "function");
  check("notifier", (v) => typeof v === "object" && v !== null && typeof (v as { notify?: unknown }).notify === "function");
  check("which", (v) => typeof v === "function");
  check("env", (v) => typeof v === "object" && v !== null);
  check("workerEntryPath", (v) => typeof v === "string" && v.length > 0);
  if (problems.length === 0) return undefined;
  return { status: "refused", detail: `queue wiring invalid: ${problems.join(", ")} — refusing to run` };
}
