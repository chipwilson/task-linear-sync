/**
 * T023 — the composition root (contracts/component-api.md §1–§2; research R9/R11).
 * `createAgentToolServer(deps)` validates everything at construction (fail fast, never
 * silent): `resolveMcpConfig ∪ settings` → ALL problems in one McpConfigError → transport
 * preflight (http: token env var present, naming NAMES only) → the frozen factory bag
 * exactly like `src/cli/context.ts` → ONE session store + ONE dispatcher.
 *
 * `process.env` appears in exactly ONE place module-wide — the env default below
 * (hygiene §3.3, research R11).
 */

import process from "node:process";

import type { CliContext } from "../cli/index.js";
import { createDefaultQueueSurface } from "../cli/index.js";
import type { ResolvedConfig } from "../config/index.js";
import { createDefaultSecurityScreener, createSyncEngine, envVarKeyProvider } from "../engine/index.js";
import { createStateStore, systemClock } from "../state/index.js";
import type { Clock, StateStore } from "../state/index.js";
import { createLinearPort } from "../tracker/index.js";
import type { EngineDependencies, LinearPort, SecurityScreener } from "../ports/index.js";
import type { McpSettings } from "./config.js";
import { resolveMcpConfig } from "./config.js";
import { McpConfigError, renderCoreRefusal, renderSingleRefusal } from "./errors.js";
import { listenHttp as listenHttpServer } from "./http.js";
import { createReadHandlers, createApplyHandler } from "./handlers.js";
import type { ToolCoreOutcome } from "./handlers.js";
import { createDispatcher } from "./jsonrpc.js";
import type { JsonRpcReply, ToolCallResult } from "./jsonrpc.js";
import { createPlanReferenceStore } from "./plan-store.js";
import type { PlanReferenceStore } from "./plan-store.js";
import { serveStdio } from "./stdio.js";
import type { StdioOverrides } from "./stdio.js";
import { resolveToolCall, visibleTools } from "./tools.js";
import type { ToolName } from "./tools.js";
import { validateToolArguments } from "./tools.js";

/**
 * serverInfo.version (jsonrpc-stdio.md §2.1: "version from the package version").
 * Kept as a constant because `src/mcp` reads no files (component-api §3.1); the
 * packaging contract test pins it against the manifest.
 */
export const SERVER_VERSION = "0.2.0";

/** Everything injectable — hermetic (component-api §1). */
export interface AgentToolServerDeps {
  /** Frozen merged config (deep-merge 002 result). */
  readonly config: ResolvedConfig;
  /** Environment view; the ONE default read of process.env module-wide. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly clock?: Clock;
  readonly state?: StateStore;
  /** The ONE route to the tracker; default `createLinearPort` (zero calls until used). */
  readonly port?: LinearPort;
  readonly screener?: SecurityScreener;
  /** Canonical repository root the tools operate on. */
  readonly repositoryRoot?: string;
  /** Programmatic overrides — top config layer. */
  readonly settings?: Partial<McpSettings>;
}

/** A tool core: validated-by-caller arguments in, ToolCallResult out; never throws. */
export type ToolHandler = (args: unknown) => Promise<ToolCallResult>;

export interface AgentToolServerApp {
  /** Transport-agnostic dispatcher entry (unit-test surface): null for notifications. */
  handleMessage(raw: unknown): Promise<JsonRpcReply | null>;
  /** stdio transport: framer + streams + dispatcher (jsonrpc-stdio.md §5). */
  serveStdio(overrides?: StdioOverrides): { close(): void };
  /** ONLY when settings.transport === "http"; stdio ⇒ McpConfigError. */
  listenHttp(): Promise<{ readonly port: number; close(): Promise<void> }>;
  readonly settings: McpSettings;
  /** The ONE session-scoped plan-reference store (restart ⇒ empty). */
  readonly store: PlanReferenceStore;
  /** Shared story-core bag (cores wire via registerCore). */
  readonly bag: ServerBag;
  /** Release transport resources (http listener; stdio ends with the host streams). */
  close(): Promise<void>;
}

/** Shared bag story cores receive — constructed ONCE per server. */
export interface ServerBag {
  readonly config: ResolvedConfig;
  readonly settings: McpSettings;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly clock: Clock;
  readonly state: StateStore;
  readonly screener: SecurityScreener;
  readonly engine: ReturnType<typeof createSyncEngine>;
  readonly repositoryRoot: string;
  /** CLI context over the frozen factory bag; handlers swap the writers per lane run. */
  readonly cliContext: CliContext;
  readonly store: PlanReferenceStore;
  registerCore(name: ToolName, handler: ToolHandler): void;
}

function textBlock(text: string, isError?: true): ToolCallResult {
  return isError === undefined ? { content: [{ type: "text", text }] } : { content: [{ type: "text", text }], isError };
}

export function createAgentToolServer(deps: AgentToolServerDeps): AgentToolServerApp {
  const resolved = resolveMcpConfig(deps.config, deps.settings);
  if (!resolved.ok) {
    // Complete listing lands in the message; values never appear for token-shaped keys.
    throw new McpConfigError(`mcp configuration is invalid: ${resolved.errors.join("; ")}`);
  }
  const settings = resolved.settings;

  // The ONE sanctioned process.env read of the whole module group (research R11).
  const env = deps.env ?? process.env;
  let httpToken = ""; // captured at construction; per-request env reads are FORBIDDEN
  if (settings.transport === "http") {
    const tokenValue = env[settings.tokenEnvVarName];
    if (tokenValue === undefined || tokenValue.trim() === "") {
      // Names the env-var NAME only — never a value (transport-auth.md §2.3).
      throw new McpConfigError(
        `mcp: transport 'http' requires the environment variable '${settings.tokenEnvVarName}' to hold a non-empty token value`,
      );
    }
    httpToken = tokenValue;
  }

  const clock = deps.clock ?? systemClock;
  const repositoryRoot = deps.repositoryRoot ?? process.cwd();
  const state = deps.state ?? createStateStore({ repositoryRoot, config: deps.config, clock });
  const screener = deps.screener ?? createDefaultSecurityScreener(deps.config);
  const port = deps.port ?? createLinearPort({ config: deps.config, options: { env: { ...env } } });

  // The frozen factory bag exactly like src/cli/context.ts (one engine, research R6).
  const engineDeps: EngineDependencies = { port, config: deps.config, state, clock, screener };
  const engineOptions = { keyProvider: envVarKeyProvider(deps.config, { ...env } as NodeJS.ProcessEnv) };
  const engine = createSyncEngine(engineDeps, engineOptions);

  const cliContext: CliContext = {
    cwd: repositoryRoot,
    env,
    stdout: () => undefined, // handlers install capturing writers per lane run
    stderr: () => undefined,
    clock,
    loadConfig: () => deps.config,
    makePort: () => port,
    makeScreener: () => screener,
    makeEngine: (bag) => createSyncEngine(bag, engineOptions),
    makeState: () => state,
    queueSurface: createDefaultQueueSurface(),
  };

  const store = createPlanReferenceStore(clock);
  const cores = new Map<ToolName, ToolHandler>();

  // T034 — the three read cores register NOW (P1); the apply core registers in US2.
  const readHandlers = createReadHandlers({ cliContext, state, clock, screener, repositoryRoot, store });
  const wrapOutcome =
    (run: () => Promise<ToolCoreOutcome>): ToolHandler =>
    async () => {
      const outcome = await run();
      return outcome.ok
        ? textBlock(JSON.stringify(outcome.payload))
        : textBlock(renderCoreRefusal(outcome.refusal), true);
    };
  cores.set("task_sync_plan", wrapOutcome(readHandlers.task_sync_plan));
  cores.set("task_sync_inventory", wrapOutcome(readHandlers.task_sync_inventory));
  cores.set("task_sync_status", wrapOutcome(readHandlers.task_sync_status));

  // T043 — the apply core: the ONE engine.applySyncPlan call site on this surface.
  const applyCore = createApplyHandler({ settings, store, state, engine, screener, config: deps.config });
  cores.set("task_sync_apply", async (args: unknown) => {
    const outcome = await applyCore((typeof args === "object" && args !== null ? args : {}) as Record<string, unknown>);
    if (outcome.ok) return textBlock(JSON.stringify(outcome.payload));
    if ("gateFailures" in outcome) {
      // Engine refusals list EVERY {code, detail} verbatim (complete-listing posture).
      return textBlock(
        JSON.stringify({ schemaVersion: 1, status: "refused", error: outcome.gateFailures }),
        true,
      );
    }
    return textBlock(renderCoreRefusal(outcome.refusal), true);
  });
  let httpClose: (() => Promise<void>) | null = null;

  const dispatcher = createDispatcher({
    serverName: `${deps.config.toolId}-mcp`,
    serverVersion: SERVER_VERSION,
    listTools: () => visibleTools(settings).map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    callTool: async (name: string, args: unknown): Promise<ToolCallResult> => {
      // Visibility gate (SC-003): the listing and this gate read the SAME predicate.
      const resolution = resolveToolCall(name, settings);
      if (resolution.kind === "unknown") {
        return textBlock(JSON.stringify({ schemaVersion: 1, status: "refused", error: "unknown tool" }), true);
      }
      if (resolution.kind === "invisible") {
        return textBlock(
          renderSingleRefusal(
            "MUTATING_TOOLS_DISABLED",
            "mutating tools are disabled for this surface — set the config key mcp.enabled to true and restart the server",
          ),
          true,
        );
      }
      // Argument shape (tool-definitions §2.1): every problem listed, one isError result.
      const issues = validateToolArguments(name, args);
      if (issues.length > 0) {
        return textBlock(
          JSON.stringify({ schemaVersion: 1, status: "refused", error: "INVALID_ARGUMENTS", issues }),
          true,
        );
      }
      const core = cores.get(resolution.def.name);
      if (core === undefined) {
        return textBlock(renderSingleRefusal("LANE_FAILURE", `tool core for '${name}' is not wired`), true);
      }
      return core(args);
    },
  });

  const bag: ServerBag = {
    config: deps.config,
    settings,
    env,
    clock,
    state,
    screener,
    engine,
    repositoryRoot,
    cliContext,
    store,
    registerCore(name: ToolName, handler: ToolHandler): void {
      cores.set(name, handler);
    },
  };

  const app: AgentToolServerApp = {
    settings,
    store,
    bag,
    handleMessage: (raw: unknown) => dispatcher.handleMessage(raw),
    serveStdio(overrides: StdioOverrides = {}) {
      const errorSink = overrides.errorSink ?? process.stderr;
      errorSink.write(`${deps.config.toolId}-mcp: listening on stdio\n`);
      return serveStdio(dispatcher, overrides);
    },
    async listenHttp() {
      if (settings.transport !== "http") {
        throw new McpConfigError("mcp: listenHttp() requires settings.transport === 'http' (stdio is the default transport)");
      }
      const listener = await listenHttpServer({
        host: settings.host,
        port: settings.port,
        token: httpToken,
        serverName: `${deps.config.toolId}-mcp`,
        handleMessage: (raw: unknown) => dispatcher.handleMessage(raw),
      });
      httpClose = listener.close;
      return listener;
    },
    async close(): Promise<void> {
      if (httpClose !== null) {
        const close = httpClose;
        httpClose = null;
        await close();
      }
    },
  };
  return app;
}
