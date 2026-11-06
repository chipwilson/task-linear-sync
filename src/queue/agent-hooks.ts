/**
 * T023 — Agent-hook scaffold installation (spec 010 FR-009; contracts/
 * hook-installation.md §2). The scaffold RECORD comes from the frozen-pure 003
 * `agentHookScaffold` (kiro / generic templates only); this lane writes it under the
 * framework's default directory (or the `agentHooksDirectory` override) and enriches
 * the JSON ADDITIVELY — `event` + `pathPatterns` — so the 003 record shape stays valid.
 * Collisions never overwrite: the first free `-2`/`-3` suffix wins. Unknown ids and
 * template-less frameworks are refused with zero writes.
 */
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { agentHookScaffold, builtInAdapters } from "../discovery/index.js";
import type { FrameworkIdentity } from "../discovery/types.js";
import type { QueueOutcomeResult } from "./types.js";

export interface AgentHookSettings {
  /** Framework id; undefined ⇒ the default templated framework (kiro). */
  readonly frameworkId?: string;
  readonly binName: string;
  /** Override directory (repo-relative or absolute); null ⇒ the framework default. */
  readonly agentHooksDirectory: string | null;
  readonly taskFilePatterns: readonly string[];
}

const DEFAULT_FRAMEWORK = "kiro";

export async function installAgentHooks(
  repositoryRoot: string,
  settings: AgentHookSettings,
): Promise<QueueOutcomeResult> {
  const frameworkId = settings.frameworkId ?? DEFAULT_FRAMEWORK;
  const known = Object.keys(builtInAdapters).includes(frameworkId);
  const scaffold = agentHookScaffold(frameworkId as FrameworkIdentity, settings.binName);
  if (scaffold === undefined) {
    return {
      status: "refused",
      detail: known
        ? `framework '${frameworkId}' has no agent-hook scaffold template (003) — nothing written`
        : `unknown framework id '${frameworkId}' — refusing to write an agent hook scaffold`,
    };
  }

  // Additive enrichment only — the 003 record (name/action/command) is preserved verbatim.
  const base = JSON.parse(scaffold.contents) as Record<string, unknown>;
  const enriched: Record<string, unknown> = { ...base, event: "post-file-save" };
  if (settings.taskFilePatterns.length > 0) {
    enriched["pathPatterns"] = [...settings.taskFilePatterns];
  }

  const directory =
    settings.agentHooksDirectory !== null && settings.agentHooksDirectory !== undefined
      ? join(repositoryRoot, settings.agentHooksDirectory)
      : join(repositoryRoot, scaffold.directory.replace(/\/+$/, ""));

  // Collision policy: never overwrite — first free suffixed file name wins.
  const dotJson = scaffold.fileName.endsWith(".json") ? ".json" : "";
  const stem = dotJson.length > 0 ? scaffold.fileName.slice(0, -dotJson.length) : scaffold.fileName;
  let fileName = scaffold.fileName;
  for (let suffix = 2; existsSync(join(directory, fileName)); suffix += 1) {
    fileName = `${stem}-${suffix}${dotJson}`;
  }

  try {
    mkdirSync(directory, { recursive: true });
    const target = join(directory, fileName);
    writeFileSync(target, `${JSON.stringify(enriched, null, 2)}\n`, "utf8");
    return {
      status: "installed",
      path: target,
      detail: `installed the ${frameworkId} agent hook scaffold at ${target}`,
    };
  } catch (error) {
    return { status: "refused", detail: `could not write the agent hook scaffold: ${(error as Error).message}` };
  }
}
