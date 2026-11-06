/**
 * T003 — shared hermetic harness for all 011 history-surface tests.
 *
 * Compiles WITHOUT `src/history-server` existing: the factory is INJECTED via
 * `withHistoryServer(factory, opts, fn)`, typed structurally against the
 * frozen deps shape (contracts/component-api.md §1). Tests import the real
 * factory themselves (`await import("../../src/history-server/create.js")`).
 *
 * Worlds are built in-process from seed parameters (the fake `LinearPort`
 * from 007) — page 0 carries the frozen `SyncStatePayload`, pages ≥ 1 carry
 * 008 `serializeHistoryPageRecord` records under the namespace key derived
 * from `builtInDefaults` at runtime. Placeholder identities + synthetic
 * UUIDs only (tests/fixtures/history/README.md).
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { builtInDefaults } from "../../src/config/defaults.js";
import { loadConfig } from "../../src/config/load.js";
import type { ConfigOverrides, ResolvedConfig } from "../../src/config/schema.js";
import type { SyncHistoryEvent, SyncStatePayload } from "../../src/domain/state-payload.js";
import { parseSyncStatePayload, serializeSyncStatePayload } from "../../src/domain/state-payload.js";
import { serializeHistoryPageRecord } from "../../src/engine/history-page.js";
import type { SecurityScreener } from "../../src/ports/engine.js";
import type { LinearPort } from "../../src/ports/linear-port.js";
import type {
  FakeAttachmentSeed,
  FakeLinearPort,
  FakeWorldSeed,
  FailureScript,
} from "../../src/tracker/testing/fake-port.js";
import { createFakeLinearPort, syntheticUuid } from "../../src/tracker/testing/fake-port.js";
import type { AttachmentUrlConfig } from "../../src/urls/attachment-url.js";
import { canonicalAttachmentUrl, continuationAttachmentUrl } from "../../src/urls/attachment-url.js";

// -- sentinels & placeholder identities -------------------------------------------

/** Sentinel planted as the token env value in the sentinel sweep (SC-003). */
export const TOKEN_SENTINEL = "sentinel-HistDoNotLeak-7c4f9a2e18";
/** Secret-shaped placeholder values for screening fixtures (never real). */
export const SECRET_SHAPE_VALUES = {
  token: "ltnx-DoNotLeak-4d9f2a7c",
  apiKey: "sk-reverse-placeholder-8813",
} as const;

export const HISTORY_TASK_UUID = syntheticUuid(0);
export const HISTORY_ALT_TASK_UUID = syntheticUuid(1);
export const HISTORY_OTHER_TASK_UUID = syntheticUuid(2);

const NS_KEY = builtInDefaults.metadataNamespaceKey as string;
const BASE_HOST = builtInDefaults.attachmentBaseHost as string;
const TOOL_ID = builtInDefaults.toolId as string;

// -- clock -------------------------------------------------------------------------

export interface HistoryClock {
  now(): Date;
  elapsed(sinceIso: string): number;
}

export interface AdvanceableClock extends HistoryClock {
  advance(ms: number): void;
}

/** Fixed clock (deterministic `now`/`elapsed`), explicitly advanceable. */
export function makeFixedClock(startMs = Date.UTC(2026, 1, 1, 10, 0, 0)): AdvanceableClock {
  let ms = startMs;
  return {
    now: () => new Date(ms),
    elapsed: (sinceIso) => ms - Date.parse(sinceIso),
    advance: (delta) => {
      ms += delta;
    },
  };
}

// -- chain worlds --------------------------------------------------------------------

export interface ChainWorldSpec {
  taskUuid?: string;
  /** Logical page count; 0 ⇒ no canonical attachment (not-found world). */
  pages?: number;
  eventsPerPage?: number;
  /** Cross-page interleaved timestamps (merge sort becomes observable). */
  interleave?: boolean;
  /** Which page indices actually exist in the world (default: all 0..pages-1). */
  presentPages?: readonly number[];
  /** Page whose stored record contradicts its addressed URL. */
  corruptPage?: number;
  corruptKind?: "task-uuid" | "page" | "json" | "history";
  /** Page 0 gains two secret-shaped events (screening fixtures). */
  secretShape?: boolean;
  /** Fake-port scripted failures (rate-limit / network postures). */
  failures?: Readonly<Record<string, FailureScript | readonly FailureScript[]>>;
  /** Fake-port retry budget (0 exercises ultimate-failure exhaustion). */
  maxRetries?: number;
}

export interface ChainWorld {
  readonly fake: FakeLinearPort;
  readonly taskUuid: string;
  readonly nsKey: string;
  readonly urlConfig: AttachmentUrlConfig;
  readonly canonicalUrl: string;
  /** Deterministic address of a page index (page 0 ⇒ canonical URL). */
  addressOf(page: number): string;
  readonly events: readonly SyncHistoryEvent[];
  readonly markers: readonly string[];
  /** Substrings that MUST be absent from any error response body. */
  readonly historyProbes: readonly string[];
  readonly secretValues: readonly string[];
  /** Append an event to the page-0 attachment (live-update tests). */
  landEvent(description: string): SyncHistoryEvent;
}

const KINDS = [
  "discovered",
  "issue-created",
  "matched",
  "title-updated",
  "description-updated",
  "checkbox-changed",
  "conflict-detected",
] as const;

const WORLD_BASE_MS = Date.UTC(2026, 0, 15, 8, 0, 0);

/** Build a seeded fake-port world carrying an address-derived page chain. */
export function buildChainWorld(spec: ChainWorldSpec = {}): ChainWorld {
  const taskUuid = spec.taskUuid ?? HISTORY_TASK_UUID;
  const pages = spec.pages ?? 1;
  const eventsPerPage = spec.eventsPerPage ?? 3;
  const interleave = spec.interleave ?? false;
  const present = new Set<number>(
    spec.presentPages ?? Array.from({ length: pages }, (_, p) => p),
  );

  const urlConfig: AttachmentUrlConfig = {
    attachmentBaseHost: BASE_HOST,
    toolId: TOOL_ID,
    attachmentUrlTemplate: builtInDefaults.attachmentUrlTemplate as string,
    continuationUrlTemplate: builtInDefaults.continuationUrlTemplate as string,
  };
  const addressOf = (page: number): string =>
    page === 0
      ? canonicalAttachmentUrl(urlConfig, taskUuid)
      : continuationAttachmentUrl(urlConfig, taskUuid, page);

  const events: SyncHistoryEvent[] = [];
  const markers: string[] = [];
  const secretValues: string[] = [];
  const attachments: FakeAttachmentSeed[] = [];

  for (let p = 0; p < pages; p += 1) {
    if (!present.has(p)) continue;
    const pageEvents: SyncHistoryEvent[] = [];
    for (let e = 0; e < eventsPerPage; e += 1) {
      const globalIndex = p * eventsPerPage + e;
      // Interleaved layout: seconds = e*64 + p, so page slices overlap and
      // chain order ≠ chronological order for every page pair.
      const offsetSeconds = interleave ? e * 64 + p : p * 3600 + e * 31;
      if ((globalIndex + 1) % 1000 === 0) {
        const description = `SC001-MARKER-${(globalIndex + 1) / 1000}`;
        markers.push(description);
        pageEvents.push({
          kind: "rollback",
          at: new Date(WORLD_BASE_MS + offsetSeconds * 1000).toISOString(),
          description,
          references: [`op-${globalIndex}`],
        });
      } else {
        pageEvents.push({
          kind: KINDS[e % KINDS.length]!,
          at: new Date(WORLD_BASE_MS + offsetSeconds * 1000).toISOString(),
          description: `sync event ${globalIndex} page ${p}`,
        });
      }
    }
    if (p === 0 && spec.secretShape === true) {
      pageEvents.push(
        {
          kind: "discovered",
          at: new Date(WORLD_BASE_MS + 90_000).toISOString(),
          description: `created with token ${SECRET_SHAPE_VALUES.token} attached`,
          references: [`api_key=${SECRET_SHAPE_VALUES.apiKey}`],
        },
        {
          kind: "matched",
          at: new Date(WORLD_BASE_MS + 91_000).toISOString(),
          description: "routine update with no secrets",
        },
      );
      secretValues.push(SECRET_SHAPE_VALUES.token, SECRET_SHAPE_VALUES.apiKey);
    }
    events.push(...pageEvents);

    const recordTask =
      p === spec.corruptPage && spec.corruptKind === "task-uuid" ? HISTORY_ALT_TASK_UUID : taskUuid;
    const recordPage = p === spec.corruptPage && spec.corruptKind === "page" ? p + 10 : p;
    let metadata: Record<string, string | number>;
    if (p === 0) {
      const payload: SyncStatePayload = {
        taskUuid: p === spec.corruptPage ? HISTORY_ALT_TASK_UUID : taskUuid,
        frameworkMetadata: {
          frameworkId: "spec-kit",
          featureName: "placeholder-history",
          filePath: "specs/placeholder/story-alpha.md",
          localTaskId: "PHA-1",
        },
        descriptionContentHash: "0".repeat(64),
        cursors: { lastSyncAt: new Date(WORLD_BASE_MS + p * 60_000).toISOString() },
        history: pageEvents,
      };
      metadata = { [NS_KEY]: serializeSyncStatePayload(payload) };
    } else if (p === spec.corruptPage && spec.corruptKind === "json") {
      metadata = { [NS_KEY]: "{not-canonical-json!!" };
    } else if (p === spec.corruptPage && spec.corruptKind === "history") {
      metadata = { [NS_KEY]: JSON.stringify({ taskUuid, page: recordPage, history: "nope" }) };
    } else {
      metadata = serializeHistoryPageRecord(
        { taskUuid: recordTask, page: recordPage, history: pageEvents },
        NS_KEY,
      );
    }
    attachments.push({
      issueId: "I-hist",
      id: `att-hist-${p}`,
      url: addressOf(p),
      title: "task-linear-sync state",
      metadata,
    });
  }

  const seed: FakeWorldSeed = {
    teams: [
      {
        key: "PHA",
        id: "team-placeholder",
        projects: [{ id: "proj-placeholder", name: "Placeholder Project" }],
        workflowStates: [{ id: "s1", name: "In Progress", type: "started" }],
      },
    ],
    issues: [
      {
        id: "I-hist",
        key: "PHA-1",
        teamKey: "PHA",
        projectId: "proj-placeholder",
        title: "Placeholder story — history fixture",
        description: "Placeholder description (fixture).",
        stateType: "started",
        updatedAt: new Date(WORLD_BASE_MS).toISOString(),
      },
    ],
    attachments,
    scriptedFailures: spec.failures,
    maxRetries: spec.maxRetries,
  };
  const fake = createFakeLinearPort(seed);

  const historyProbes = events
    .filter((ev) => !secretValues.some((s) => ev.description.includes(s)))
    .slice(0, 5)
    .map((ev) => ev.description);

  return {
    fake,
    taskUuid,
    nsKey: NS_KEY,
    urlConfig,
    canonicalUrl: addressOf(0),
    addressOf,
    events,
    markers,
    historyProbes,
    secretValues,
    landEvent(description: string): SyncHistoryEvent {
      const att = fake.world.attachments.get(attachments.find((a) => a.url === addressOf(0))?.id ?? "");
      assert.ok(att !== undefined, "landEvent requires an existing page-0 attachment");
      const payload = parseSyncStatePayload(String(att.metadata[NS_KEY]));
      const event: SyncHistoryEvent = {
        kind: "field-updated" as SyncHistoryEvent["kind"],
        at: new Date(WORLD_BASE_MS + 4_000_000).toISOString(),
        description,
      };
      const next = { ...payload, history: [...payload.history, event] };
      att.metadata[NS_KEY] = serializeSyncStatePayload(next);
      return event;
    },
  };
}

// -- structural factory types (compile without src/history-server) ------------------

export interface HistoryAppLike {
  handle(req: IncomingMessage, res: ServerResponse): void;
  listen?(port?: number, host?: string): Promise<{ readonly port: number; close(): Promise<void> }>;
  readonly settings: {
    accessMode: "private" | "public";
    tokenEnvVarName: string;
    sseEnabled: boolean;
    refreshSeconds: number;
    cacheTtlSeconds: number;
  };
}

export interface HistoryFactoryDepsLike {
  readonly port: LinearPort;
  readonly config: ResolvedConfig;
  readonly clock?: HistoryClock;
  readonly screener?: SecurityScreener;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export type HistoryFactoryLike = (deps: HistoryFactoryDepsLike) => HistoryAppLike;

// -- server + fetch helpers ------------------------------------------------------------

export interface HttpResult {
  status: number;
  headers: Record<string, string | string[]>;
  body: string;
}

export interface WithHistoryServerOptions {
  world?: ChainWorldSpec;
  /** `web`-group overrides merged over the frozen defaults. */
  web?: Partial<{
    accessControlMode: "private" | "public";
    realtimeSse: boolean;
    pollIntervalSeconds: number;
    cacheTtlSeconds: number;
    authEnvVarName: string;
  }>;
  extraOverrides?: ConfigOverrides;
  /** Token env value (default: sentinel). Set `env` explicitly to blank it. */
  token?: string;
  env?: Record<string, string | undefined>;
  clock?: AdvanceableClock;
  screener?: SecurityScreener;
}

export interface HistoryServerHandle {
  readonly app: HistoryAppLike;
  readonly baseUrl: string;
  readonly fake: FakeLinearPort;
  readonly world: ChainWorld;
  readonly clock: AdvanceableClock;
  readonly config: ResolvedConfig;
  get(path: string, opts?: { headers?: Record<string, string> }): Promise<HttpResult>;
  post(
    path: string,
    opts: { body?: string; headers?: Record<string, string> },
  ): Promise<HttpResult>;
  /** Read an SSE stream until `until` appears (then abort the connection). */
  getSse(
    path: string,
    opts: { until: string; headers?: Record<string, string>; timeoutMs?: number },
  ): Promise<HttpResult & { head: string }>;
  getAttachmentCalls(): number;
}

/** Boot the app on a real `node:http` server on an ephemeral port. */
export async function withHistoryServer(
  factory: HistoryFactoryLike,
  opts: WithHistoryServerOptions,
  fn: (h: HistoryServerHandle) => Promise<void>,
): Promise<void> {
  const world = buildChainWorld(opts.world);
  const clock = opts.clock ?? makeFixedClock();
  const web = opts.web ?? {};
  const config = loadConfig({
    overrides: { web, ...(opts.extraOverrides ?? {}) } as ConfigOverrides,
  });
  const tokenEnvVarName = config.web.authEnvVarName;
  const env: Record<string, string | undefined> =
    opts.env ?? { [tokenEnvVarName]: opts.token ?? TOKEN_SENTINEL };
  const app = factory({
    port: world.fake,
    config,
    clock,
    screener: opts.screener,
    env,
  });

  const server = createServer((req, res) => app.handle(req, res));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const bound = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${bound}`;
  try {
    const raw = async (
      method: string,
      path: string,
      o: { headers?: Record<string, string>; body?: string } = {},
    ): Promise<HttpResult> => {
      const res = await fetch(baseUrl + path, {
        method,
        headers: o.headers,
        body: o.body,
        redirect: "manual",
      });
      const headers: Record<string, string | string[]> = {};
      res.headers.forEach((v, k) => {
        headers[k] = v;
      });
      return { status: res.status, headers, body: await res.text() };
    };
    await fn({
      app,
      baseUrl,
      fake: world.fake,
      world,
      clock,
      config,
      get: (path, o) => raw("GET", path, o),
      post: (path, o) => raw("POST", path, o),
      getSse: (path, o) => readSse(baseUrl, path, o),
      getAttachmentCalls: () =>
        world.fake.callLog.filter((c) => c.method === "getAttachmentByUrl").length,
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function readSse(
  baseUrl: string,
  path: string,
  opts: { until: string; headers?: Record<string, string>; timeoutMs?: number },
): Promise<HttpResult & { head: string }> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`SSE did not contain ${JSON.stringify(opts.until)} in time`)),
      opts.timeoutMs ?? 4000,
    );
  });
  try {
    const res = await Promise.race([
      fetch(baseUrl + path, {
        headers: { accept: "text/event-stream", ...opts.headers },
        signal: controller.signal,
      }),
      deadline,
    ]);
    const headers: Record<string, string | string[]> = {};
    res.headers.forEach((v, k) => {
      headers[k] = v;
    });
    const reader = res.body?.getReader();
    assert.ok(reader !== undefined, "expected an SSE response body");
    const decoder = new TextDecoder();
    let head = "";
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      head += decoder.decode(value, { stream: true });
      if (head.includes(opts.until)) break;
    }
    controller.abort();
    return { status: res.status, headers, body: head, head };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  }
}

// -- stub req/res (serverless-shape runs — no listen()) --------------------------------

/** Minimal req/res pair exercising the handler without a socket. */
export function makeStubPair(opts: {
  method?: string;
  url?: string;
  headers?: Record<string, string | string[]>;
}): {
  req: IncomingMessage;
  res: ServerResponse;
  finished: Promise<{ statusCode: number; headers: Record<string, string | string[]>; body: string }>;
} {
  const req = Object.assign(new EventEmitter(), {
    method: opts.method ?? "GET",
    url: opts.url ?? "/",
    headers: opts.headers ?? {},
    socket: { remoteAddress: "127.0.0.1" },
  }) as unknown as IncomingMessage;
  const chunks: Buffer[] = [];
  let statusCode = 200;
  const headers: Record<string, string | string[]> = {};
  let settle: (v: { statusCode: number; headers: Record<string, string | string[]>; body: string }) => void =
    () => undefined;
  const finished = new Promise<{
    statusCode: number;
    headers: Record<string, string | string[]>;
    body: string;
  }>((resolve) => {
    settle = resolve;
  });
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    writeHead(code: number, hdrs?: Record<string, string | string[]>) {
      statusCode = code;
      res.statusCode = code;
      Object.assign(headers, hdrs ?? {});
      return res;
    },
    setHeader(k: string, v: string | string[]) {
      headers[k] = v;
      return res;
    },
    getHeader(k: string) {
      return headers[k];
    },
    write(chunk: string | Buffer) {
      chunks.push(Buffer.from(chunk));
      return true;
    },
    end(chunk?: string | Buffer | (() => void)) {
      if (typeof chunk === "string" || Buffer.isBuffer(chunk)) chunks.push(Buffer.from(chunk));
      settle({ statusCode, headers, body: Buffer.concat(chunks).toString("utf8") });
      return res;
    },
  }) as unknown as ServerResponse;
  return { req, res, finished };
}

// -- cookie helpers ---------------------------------------------------------------------

export function setCookieValue(result: HttpResult, name: string): string | undefined {
  const raw = result.headers["set-cookie"];
  if (raw === undefined) return undefined;
  const list = Array.isArray(raw) ? raw : [raw];
  for (const entry of list) {
    const pair = entry.split(";")[0]!;
    const eq = pair.indexOf("=");
    if (pair.slice(0, eq) === name) return pair.slice(eq + 1);
  }
  return undefined;
}

export function historyCookieName(toolId = TOOL_ID): string {
  return `${toolId}-history`;
}
