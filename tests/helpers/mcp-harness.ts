/**
 * T024 — shared 012 harness (spec: all tests hermetic, deterministic, loopback-only).
 *
 * - `startMcpFixture` / `withMcpServer`: a real `createAgentToolServer` over an
 *   in-process session (`serveStdio` with PassThrough streams) driven by a tiny JSONL
 *   client; the sentinel bearer token lives only in the injected env.
 * - `withHttpServer`: the same app over `listenHttp()` + `fetch` against
 *   `http://127.0.0.1:<port>/` (loopback, ephemeral port; never the internet).
 * - `emitMcpDriver` / `spawnMcpDriver`: 009-style module-loadability driver — a child
 *   process importing the PUBLIC surface (`task-linear-sync/mcp`, absolute-dist
 *   fallback) that announces `MCP-LISTENING <port>` on stdout and mirrors JSON-RPC
 *   messages as NDJSON (no `OUT|` prefixes: the driver speaks the wire format itself).
 */

import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import { createAgentToolServer } from "../../src/mcp/index.js";
import type { AgentToolServerApp } from "../../src/mcp/index.js";
import { buildCliWorld } from "./cli-harness.js";
import type { CliWorld } from "./cli-harness.js";

/** A decoded JSON-RPC message as seen on the wire (request, notification, or reply). */
export type JsonRpcMessage = Record<string, unknown>;

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** The env var name the fixtures authenticate with (settings override of the default). */
export const MCP_TEST_TOKEN_ENV = "MCP_HARNESS_TOKEN";
export const MCP_TEST_TOKEN = "mcp-harness-token-012";

export interface McpFixtureOptions {
  /** Built-in profile name or any cli-world directory (e.g. a runtime-built world). */
  readonly profile?: string;
  readonly settings?: Record<string, unknown>;
  readonly env?: Record<string, string>;
  readonly token?: string;
}

export interface McpFixture {
  readonly world: CliWorld;
  readonly app: AgentToolServerApp;
  /** NDJSON lines the server wrote (client view), in order. */
  readonly lines: string[];
  /** Everything the app's error stream emitted (announcements, transport errors). */
  readonly stderrLines: string[];
  send(message: Record<string, unknown> | string): void;
  request(method: string, params?: unknown): Promise<JsonRpcMessage>;
  notify(method: string, params?: unknown): void;
  /** Resolve with the next recorded message matching `pred` (rejects after timeout). */
  waitFor(pred: (msg: JsonRpcMessage) => boolean, timeoutMs?: number): Promise<JsonRpcMessage>;
  /** initialize + notifications/initialized handshake. */
  initialize(): Promise<JsonRpcMessage>;
  close(): Promise<void>;
}

export async function startMcpFixture(options: McpFixtureOptions = {}): Promise<McpFixture> {
  const world = await buildCliWorld(options.profile ?? "review-report");
  const token = options.token ?? MCP_TEST_TOKEN;
  const env: Record<string, string> = {
    ...world.env,
    [MCP_TEST_TOKEN_ENV]: token,
    ...options.env,
  };

  const app = createAgentToolServer({
    config: world.config,
    env,
    clock: world.clock,
    state: world.state,
    port: world.port,
    screener: world.world.screener,
    repositoryRoot: world.repositoryRoot, // the lanes walk the world's repo copy, never the package tree
    settings: {
      transport: "stdio",
      tokenEnvVarName: MCP_TEST_TOKEN_ENV,
      ...(options.settings ?? {}),
    } as never,
  });

  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const errorSink = new PassThrough();
  const stderrLines: string[] = [];
  {
    let errBuffer = "";
    errorSink.on("data", (chunk: Buffer | string) => {
      errBuffer += typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (;;) {
        const nl = errBuffer.indexOf("\n");
        if (nl < 0) break;
        stderrLines.push(errBuffer.slice(0, nl));
        errBuffer = errBuffer.slice(nl + 1);
      }
    });
  }
  const session = app.serveStdio({
    readable: stdin as unknown as NodeJS.ReadableStream,
    writable: stdout as unknown as NodeJS.WritableStream,
    errorSink: errorSink as unknown as NodeJS.WritableStream,
  });

  return buildFixture(world, app, stdin, stdout, stderrLines, () => session.close());
}

export async function withMcpServer(
  fn: (fx: McpFixture) => Promise<void>,
  options: McpFixtureOptions = {},
): Promise<void> {
  const fx = await startMcpFixture(options);
  try {
    await fn(fx);
  } finally {
    await fx.close();
  }
}

/** Loopback HTTP fixture: yields the base URL; `post` attaches a bearer token by default. */
export async function withHttpServer(
  fn: (fx: {
    world: CliWorld;
    app: AgentToolServerApp;
    url: string;
    token: string;
    post: (message: unknown, token?: string | null) => Promise<{ status: number; body: string }>;
  }) => Promise<void>,
  options: McpFixtureOptions = {},
): Promise<void> {
  const world = await buildCliWorld(options.profile ?? "review-report");
  const token = options.token ?? MCP_TEST_TOKEN;
  try {
    const app = createAgentToolServer({
      config: world.config,
      env: { ...world.env, [MCP_TEST_TOKEN_ENV]: token, ...(options.env ?? {}) },
      clock: world.clock,
      state: world.state,
      port: world.port,
      screener: world.world.screener,
      repositoryRoot: world.repositoryRoot,
      settings: {
        transport: "http",
        tokenEnvVarName: MCP_TEST_TOKEN_ENV,
        port: 0,
        ...(options.settings ?? {}),
      } as never,
    });
    const server = await app.listenHttp();
    const url = `http://127.0.0.1:${server.port}/mcp`;
    const post = async (message: unknown, bearer: string | null = token) => {
      const headers: Record<string, string> = { "content-type": "application/json" };
      if (bearer !== null) headers.authorization = `Bearer ${bearer}`;
      const response = await fetch(url, { method: "POST", body: JSON.stringify(message), headers });
      return { status: response.status, body: await response.text() };
    };
    try {
      await fn({ world, app, url, token, post });
    } finally {
      await app.close();
    }
  } finally {
    await world.dispose();
  }
}

// ── shared in-process JSONL plumbing ───────────────────────────────────────────────

interface LinePump {
  readonly lines: string[];
  waitFor(pred: (msg: JsonRpcMessage) => boolean, timeoutMs?: number): Promise<JsonRpcMessage>;
  attach(stream: NodeJS.ReadableStream): void;
}

function createLinePump(): LinePump {
  const lines: string[] = [];
  const messages: Array<JsonRpcMessage | undefined> = [];
  const consumed = new Set<number>();
  const waiters: Array<{
    pred: (m: JsonRpcMessage) => boolean;
    resolve: (m: JsonRpcMessage) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
  }> = [];
  let buffer = "";

  /** Hand the oldest unconsumed matching message to its waiter, if any. */
  const drain = (): void => {
    for (let w = 0; w < waiters.length; w++) {
      const waiter = waiters[w]!;
      for (let i = 0; i < messages.length; i++) {
        if (consumed.has(i)) continue;
        const msg = messages[i];
        if (msg !== undefined && waiter.pred(msg)) {
          consumed.add(i);
          clearTimeout(waiter.timer);
          waiters.splice(w, 1);
          waiter.resolve(msg);
          w--;
          break;
        }
      }
    }
  };

  const ingest = (chunk: string): void => {
    buffer += chunk;
    for (;;) {
      const nl = buffer.indexOf("\n");
      if (nl < 0) break;
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      if (line.trim() === "") continue;
      lines.push(line);
      try {
        messages.push(JSON.parse(line) as JsonRpcMessage);
      } catch {
        messages.push(undefined); // non-JSON line: recorded, not dispatched
      }
      drain();
    }
  };
  return {
    lines,
    waitFor(pred, timeoutMs = 10_000) {
      return new Promise<JsonRpcMessage>((resolvePromise, reject) => {
        const timer = setTimeout(
          () => reject(new Error("MCP fixture: no matching message within the timeout")),
          timeoutMs,
        );
        // Late registration must still see lines that arrived while unserved.
        waiters.push({ pred, resolve: resolvePromise, reject, timer });
        drain();
      });
    },
    attach(stream) {
      stream.on("data", (chunk: Buffer | string) => {
        ingest(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
      });
    },
  };
}

function buildFixture(
  world: CliWorld,
  app: AgentToolServerApp,
  stdin: PassThrough,
  stdout: PassThrough,
  stderrLines: string[],
  stop: () => void,
): McpFixture {
  const pump = createLinePump();
  pump.attach(stdout);
  let nextId = 1;
  const fixture: McpFixture = {
    world,
    app,
    lines: pump.lines,
    stderrLines,
    send(message) {
      stdin.write((typeof message === "string" ? message : JSON.stringify(message)) + "\n");
    },
    request(method, params) {
      const id = nextId++;
      const payload: Record<string, unknown> = { jsonrpc: "2.0", id, method };
      if (params !== undefined) payload.params = params;
      const pending = fixture.waitFor((m) => "id" in m && m.id === id);
      fixture.send(payload);
      return pending;
    },
    notify(method, params) {
      const payload: Record<string, unknown> = { jsonrpc: "2.0", method };
      if (params !== undefined) payload.params = params;
      fixture.send(payload);
    },
    waitFor: (pred, timeoutMs) => pump.waitFor(pred, timeoutMs),
    async initialize() {
      const response = await fixture.request("initialize", { protocolVersion: "2025-03-26" });
      fixture.notify("notifications/initialized");
      return response;
    },
    async close() {
      stop();
      stdin.end();
      await app.close();
      await world.dispose();
    },
  };
  return fixture;
}

// ── child-process driver (module-loadability evidence; 009 loadModule pattern) ─────

export interface EmitMcpDriverOptions {
  /** Absolute path of the `driver.mjs` file to emit. */
  readonly driverPath: string;
  /** Absolute world directory (world.json read by the driver, like 009 writeDriver). */
  readonly worldDir: string;
  /** Shared state dir so two children see the same stored plans. */
  readonly stateDir?: string;
  readonly startIso?: string;
  /** "stdio" (default): the app serves NDJSON on the child's own stdin/stdout.
   * "http": the child runs the http transport and mirrors stdin lines to it. */
  readonly transport?: "stdio" | "http";
  /** stdio only: start the app with settings { enabled: true } so task_sync_apply
   * is visible and callable (US2 e2e). The child ALWAYS ends by writing
   * `MCP-CALL-LOG <json>` (the fake port's method-name call log) to stderr. */
  readonly applyEnabled?: boolean;
}

/** Emit the child-process MCP driver (see module header). */
export async function emitMcpDriver(opts: EmitMcpDriverOptions): Promise<void> {
  mkdirSync(dirname(opts.driverPath), { recursive: true });
  await writeFile(opts.driverPath, mcpDriverSource(opts), "utf8");
}

export interface McpDriverHandle {
  readonly lines: string[];
  readonly stderr: string;
  send(message: Record<string, unknown> | string): void;
  waitFor(pred: (msg: JsonRpcMessage) => boolean, timeoutMs?: number): Promise<JsonRpcMessage>;
  close(): Promise<{ code: number | null; stdout: string; stderr: string }>;
}

export function spawnMcpDriver(driverPath: string): McpDriverHandle {
  const child = spawn(process.execPath, [driverPath], { stdio: ["pipe", "pipe", "pipe"] });
  const pump = createLinePump();
  pump.attach(child.stdout);
  let stderrText = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (d: string) => {
    stderrText += d;
  });
  const exitPromise = new Promise<{ code: number | null; stdout: string; stderr: string }>((res) => {
    child.on("close", (code) => res({ code, stdout: pump.lines.join("\n"), stderr: stderrText }));
  });
  return {
    lines: pump.lines,
    get stderr() {
      return stderrText;
    },
    send(message) {
      child.stdin.write((typeof message === "string" ? message : JSON.stringify(message)) + "\n");
    },
    waitFor: (pred, timeoutMs = 30_000) =>
      pump.waitFor(pred, timeoutMs).catch((error: Error) => {
        throw new Error(`${error.message}; child stderr:\n${stderrText}`);
      }),
    async close() {
      child.stdin.end();
      return exitPromise;
    },
  };
}

function mcpDriverSource(opts: EmitMcpDriverOptions): string {
  const url = (rel: string): string => `file://${resolve(pkgRoot, "dist", rel)}`;
  return `#!/usr/bin/env node
// Generated by tests/helpers/mcp-harness.ts — 012 e2e child-process MCP drive.
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";

async function loadModule(selfRef, absUrl) {
  try {
    return await import(selfRef);
  } catch {
    return await import(absUrl);
  }
}

const mcpMod = await loadModule("task-linear-sync/mcp", ${JSON.stringify(url("mcp/index.js"))});
const trackerTesting = await loadModule("task-linear-sync/tracker/testing", ${JSON.stringify(url("tracker/testing/index.js"))});
const configMod = await loadModule("task-linear-sync/config", ${JSON.stringify(url("config/index.js"))});
const stateMod = await loadModule("task-linear-sync/state", ${JSON.stringify(url("state/index.js"))});

const worldDir = ${JSON.stringify(resolve(opts.worldDir))};
const worldDoc = JSON.parse(readFileSync(join(worldDir, "world.json"), "utf8"));
const root = mkdtempSync(join(tmpdir(), "tls-012-driver-"));
const repositoryRoot = join(root, "repo");
if (existsSync(join(worldDir, "repo"))) cpSync(join(worldDir, "repo"), repositoryRoot, { recursive: true });
else mkdirSync(repositoryRoot, { recursive: true });
const stateDir = ${opts.stateDir === undefined ? 'join(root, "state")' : JSON.stringify(resolve(opts.stateDir))};

const startIso = ${JSON.stringify(opts.startIso ?? null)} ?? worldDoc.clock ?? "2026-01-01T00:00:00.000Z";
const clock = stateMod.fixedClock(new Date(startIso));
const config = configMod.loadConfig({
  overrides: { ...(worldDoc.config ?? {}), stateDirectory: stateDir },
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

${
  opts.transport === "http"
    ? `const app = mcpMod.createAgentToolServer({
  config,
  state,
  port: fake,
  clock,
  repositoryRoot,
  env: { [config.manifestKeyEnvVarName]: keyValue, MCP_HARNESS_TOKEN: process.env.MCP_HARNESS_TOKEN },
  settings: { transport: "http", tokenEnvVarName: "MCP_HARNESS_TOKEN", port: 0 },
});
const server = await app.listenHttp();
process.stdout.write("MCP-LISTENING " + server.port + "\\n");

const url = "http://127.0.0.1:" + server.port + "/mcp";`
    : `const app = mcpMod.createAgentToolServer({
  config,
  state,
  port: fake,
  clock,
  repositoryRoot,
  env: { [config.manifestKeyEnvVarName]: keyValue },${
    opts.applyEnabled === true ? "\n  settings: { enabled: true }," : ""
  }
});
// DEFAULT settings: stdio transport, mutating tools disabled. NDJSON on our streams.
const session = app.serveStdio();
void session;`
}
${
  opts.transport === "http"
    ? `
for await (const line of process.stdin) {
  const text = String(line).trim();
  if (text === "") continue;
  try {
    const response = await fetch(url, {
      method: "POST",
      body: text,
      headers: {
        "content-type": "application/json",
        authorization: "Bearer " + (process.env.MCP_HARNESS_TOKEN ?? ""),
      },
    });
    const body = await response.text();
    process.stdout.write(body.trimEnd() + "\\n");
  } catch (error) {
    process.stdout.write(
      JSON.stringify({ driverError: String(error && error.message ? error.message : error) }) + "\\n",
    );
  }
}
process.stderr.write("MCP-CALL-LOG " + JSON.stringify((fake.callLog ?? []).map((c) => c.method)) + "\\n");
process.exit(0);`
    : `
// serveStdio already drains process.stdin and answers on process.stdout; closing
// stdin must end the child promptly (quickstart: hosts manage the child's lifetime).
await onceStdinEnd();
await app.close();
process.stderr.write("MCP-CALL-LOG " + JSON.stringify((fake.callLog ?? []).map((c) => c.method)) + "\\n");
process.exit(0);

function onceStdinEnd() {
  return new Promise((res) => {
    process.stdin.on("end", () => res());
    process.stdin.resume();
  });
}`
}
`;
}
