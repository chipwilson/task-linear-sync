/**
 * Agent-hook scaffold records (FR-007/FR-010; research R11; contracts/framework-adapter.md
 * `agentHookScaffold`) — PURE: build the 010-bound `{ directory, fileName, contents }`
 * record and write NOTHING. Templates: `kiro-json` → `.kiro/hooks/`, `command-json` →
 * `.task-linear-sync/hooks/`; frameworks without a template (and unknown ids) get
 * `undefined`. Contents carry zero org literals — `binName` derives from `toolId` (002).
 */
import type { FrameworkAdapter } from "./adapter.js";
import { builtInAdapters } from "./adapters/index.js";
import type { FrameworkIdentity } from "./types.js";

export interface AgentHookScaffold {
  readonly directory: string;
  readonly fileName: string;
  readonly contents: string;
}

/**
 * The Kiro/generic Agent_Hook scaffold for 010 (001 Glossary Agent_Hook /
 * Agent_Hooks_Directory): a JSON record whose `command` action runs `<binName> enqueue`.
 */
export function agentHookScaffold(frameworkId: FrameworkIdentity, binName: string): AgentHookScaffold | undefined {
  const adapter: FrameworkAdapter | undefined =
    (builtInAdapters as Readonly<Record<string, FrameworkAdapter | undefined>>)[frameworkId];
  const template = adapter?.agentHookTemplate;
  const directory = adapter?.agentHooksDirectory;
  if ((template !== "kiro-json" && template !== "command-json") || directory === undefined) return undefined;
  const contents = `${JSON.stringify({ name: `${binName}-sync`, action: "command", command: `${binName} enqueue` }, null, 2)}\n`;
  return Object.freeze({ directory, fileName: `${binName}-sync.json`, contents });
}
