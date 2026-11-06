/**
 * Composition root (T010 skeleton; pipeline wired by T021; contracts/
 * component-api.md §1, http-surface.md §2–5).
 *
 * `createSyncHistoryServer` validates everything at construction (fail fast,
 * never silent) and returns a deployable `(req, res)` handler. The request
 * pipeline is route → (auth gate lands in US2) → admission (014: SSE-stream
 * join cap + walk-leader cap, both answered by the 429 envelope + Retry-After)
 * → reconstruct → content negotiation (SSE/JSON/HTML). Error responses render
 * from the fixed envelopes on a structurally separate path, so a failure can
 * never carry history bytes. `process.env` appears exactly once in the whole
 * module group — the deps default below (research R9).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ResolvedConfig } from "../config/schema.js";
import { createDefaultSecurityScreener } from "../engine/screening.js";
import type { SecurityScreener } from "../ports/engine.js";
import type { LinearPort } from "../ports/linear-port.js";
import { UrlSchemeError, canonicalAttachmentUrl, continuationAttachmentUrl } from "../urls/attachment-url.js";
import {
  createAccessGate,
  parseBootstrapToken,
  readBodyCapped,
} from "./auth.js";
import { createHistoryCache } from "./cache.js";
import {
  ERROR_ENVELOPES,
  HistoryRequestError,
  HistoryServerConfigError,
  type ErrorEnvelope,
} from "./errors.js";
import { resolveHistoryServerConfig, type ResolvedHistoryServerSettings } from "./options.js";
import {
  SECURITY_HEADERS,
  errorAsHtml,
  errorAsJson,
  errorAsSseFrame,
  negotiateFormat,
  unauthorizedHtml,
  viewAsHtml,
  viewAsJson,
} from "./render.js";
import { reconstructHistory, type ReconstructDeps } from "./reconstruct.js";
import { parseHistoryRoute } from "./routes.js";
import { listenHistoryApp } from "./serve.js";
import { startSseStream } from "./sse.js";
import { defaultHistoryClock, type NegotiatedFormat } from "./types.js";

/** Placeholder identity for construction-time scheme probes (never served). */
const PROBE_UUID = "ac000000-0000-4000-8000-000000000000";

/**
 * §2 reserves no code in the closed §4 set for a wrong method, so the fixed
 * 405 body below completes the taxonomy (documented deviation; never a
 * reconstruction-path string).
 */
const METHOD_NOT_ALLOWED = Object.freeze({
  code: "METHOD_NOT_ALLOWED",
  status: 405,
  message: "history: this surface serves GET requests only",
});

export interface SyncHistoryServerDeps {
  /** The ONLY route to the tracker (constitution V). */
  readonly port: LinearPort;
  /** Frozen merged config: URL scheme, namespace key, `web` surface group. */
  readonly config: ResolvedConfig;
  /** TTL / cadence / expiry time source; defaults to system time. */
  readonly clock?: ReconstructDeps["clock"];
  /** Browser-text re-screening; defaults to the engine's default screener. */
  readonly screener?: SecurityScreener;
  /** Environment view for the token env-var read; defaults to `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
}

export interface SyncHistoryServerApp {
  /** Deployable unit: usable directly as an `http.createServer` listener. */
  handle(req: IncomingMessage, res: ServerResponse): void;
  /** Optional convenience over node:http (serve.ts); serverless hosts omit it. */
  listen(port?: number, host?: string): Promise<{ readonly port: number; close(): Promise<void> }>;
  /** Validated view of the frozen `web` group. */
  readonly settings: ResolvedHistoryServerSettings;
}

export function createSyncHistoryServer(deps: SyncHistoryServerDeps): SyncHistoryServerApp {
  const config = deps.config;
  const settings = resolveHistoryServerConfig(config);

  // The module group's single sanctioned environment read (R9 scan target).
  const env = deps.env ?? process.env;
  if (settings.accessMode === "private") {
    const tokenValue = env[settings.tokenEnvVarName];
    if (tokenValue === undefined || tokenValue.trim() === "") {
      // Names the env-var NAME only — never a value (contracts/access-control.md §1).
      throw new HistoryServerConfigError(
        `history: private access mode requires the environment variable ` +
          `'${settings.tokenEnvVarName}' to hold a non-empty token value`,
      );
    }
  }

  // URL scheme probed once through the frozen builders (fail fast, R2).
  try {
    canonicalAttachmentUrl(config, PROBE_UUID);
    continuationAttachmentUrl(config, PROBE_UUID, 1);
  } catch (error) {
    if (error instanceof UrlSchemeError) {
      throw new HistoryServerConfigError(
        `history: the attachment URL scheme configuration is unusable: ${error.message}`,
      );
    }
    throw error;
  }

  const clock = deps.clock ?? defaultHistoryClock;
  const screener = deps.screener ?? createDefaultSecurityScreener(config);

  const reconstructDeps: ReconstructDeps = { port: deps.port, config, clock, screener };

  // US2 collaborators (contracts/access-control.md; component-api §4).
  const gate = createAccessGate({
    accessMode: settings.accessMode,
    tokenEnvVarName: settings.tokenEnvVarName,
    env,
    toolId: config.toolId,
    clock,
    secureCookies: settings.secureCookies,
  });
  const cache = createHistoryCache({
    ttlSeconds: settings.cacheTtlSeconds,
    maxEntries: settings.maxCacheEntries,
    clock,
  });

  // 014 admission (resource-bounds.md §3): the two counted units are walk
  // LEADERS on data-route cache misses and OPEN SSE streams. Both counters
  // mutate in synchronous blocks only — no interleaving mid-decision.
  let inFlightWalks = 0;
  let openStreams = 0;

  /** A leader refused by admission; renders the 429 envelope + Retry-After. */
  class AdmissionRefused extends Error {
    override readonly name = "AdmissionRefused";
  }
  const selfProtectiveHeaders = { ...(ERROR_ENVELOPES.RATE_LIMITED.selfProtective?.headers ?? {}) };
  const selfProtective429 = (res2: ServerResponse, accept: string | undefined): void => {
    respondError(res2, accept, ERROR_ENVELOPES.RATE_LIMITED, { ...selfProtectiveHeaders });
  };

  /** Cache load with leader-only admission; hits and followers never refused. */
  async function loadAdmitted(taskUuid: string) {
    let slot = false;
    if (!cache.isFresh(taskUuid) && !cache.hasFlight(taskUuid)) {
      if (inFlightWalks >= settings.maxConcurrentWalks) throw new AdmissionRefused();
      inFlightWalks += 1;
      slot = true;
    }
    try {
      return await cache.load(taskUuid, () => reconstructHistory(reconstructDeps, taskUuid));
    } finally {
      if (slot) inFlightWalks -= 1;
    }
  }

  function respond(
    res: ServerResponse,
    status: number,
    contentType: string,
    body: string,
    extraHeaders: Record<string, string> = {},
  ): void {
    res.writeHead(status, {
      ...SECURITY_HEADERS,
      ...extraHeaders,
      "Content-Type": contentType,
      "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
  }

  /** Zero-history error path — renders from constants only (never `view`). */
  function respondError(
    res: ServerResponse,
    accept: string | undefined,
    error: { code: string; status: number; message: string },
    extraHeaders: Record<string, string> = {},
    htmlActionPath?: string,
  ): void {
    const format = negotiateFormat(accept, settings.sseEnabled);
    if (format === "sse") {
      res.writeHead(error.status, {
        ...SECURITY_HEADERS,
        ...extraHeaders,
        "Content-Type": "text/event-stream",
        Connection: "keep-alive",
      });
      res.end(errorAsSseFrame(error));
      return;
    }
    if (format === "json") {
      respond(res, error.status, "application/json; charset=utf-8", errorAsJson(error), extraHeaders);
      return;
    }
    const html =
      htmlActionPath !== undefined
        ? unauthorizedHtml(error, htmlActionPath)
        : errorAsHtml(error);
    respond(res, error.status, "text/html; charset=utf-8", html, extraHeaders);
  }

  function toEnvelope(error: unknown): ErrorEnvelope {
    return error instanceof HistoryRequestError ? error.envelope : ERROR_ENVELOPES.INTERNAL;
  }

  /** Private-mode session bootstrap (POST token form; access-control §3). */
  async function handleBootstrap(
    req: IncomingMessage,
    res: ServerResponse,
    accept: string | undefined,
    path: string,
  ): Promise<void> {
    const body = await readBodyCapped(req);
    const token = body === undefined ? undefined : parseBootstrapToken(body);
    if (!gate.bootstrapTokenValid(token)) {
      // Oversized bodies and wrong/missing tokens share one fixed denial.
      respondError(res, accept, ERROR_ENVELOPES.FORBIDDEN);
      return;
    }
    res.writeHead(303, {
      ...SECURITY_HEADERS,
      Location: path,
      "Set-Cookie": gate.sessionCookieHeader(),
      "Content-Length": "0",
    });
    res.end();
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const accept = typeof req.headers.accept === "string" ? req.headers.accept : undefined;
    const rawPath = req.url ?? "";
    const outcome = parseHistoryRoute(config, rawPath);
    if (outcome.kind === "notFound") {
      respondError(res, accept, ERROR_ENVELOPES.NOT_FOUND);
      return;
    }
    if (outcome.kind === "internalError") {
      respondError(res, accept, ERROR_ENVELOPES.INTERNAL);
      return;
    }

    // Method routing: GET serves; POST bootstraps a session in private mode
    // only; everything else is the fixed 405 constant.
    if (req.method === "POST") {
      if (settings.accessMode === "private") {
        await handleBootstrap(req, res, accept, rawPath);
        return;
      }
      respondError(res, accept, METHOD_NOT_ALLOWED);
      return;
    }
    if (req.method !== "GET") {
      respondError(res, accept, METHOD_NOT_ALLOWED);
      return;
    }

    // Auth gate — strictly BEFORE any tracker probe (access-control §3).
    if (settings.accessMode === "private") {
      const decision = gate.authorize(req.headers);
      if (decision.kind === "challenge") {
        respondError(
          res,
          accept,
          ERROR_ENVELOPES.UNAUTHORIZED,
          { "WWW-Authenticate": "Bearer" },
          rawPath,
        );
        return;
      }
      if (decision.kind === "deny") {
        respondError(res, accept, ERROR_ENVELOPES.FORBIDDEN, {
          "WWW-Authenticate": "Bearer",
        });
        return;
      }
    }

    const format: NegotiatedFormat = negotiateFormat(accept, settings.sseEnabled);

    // SSE join admission — strictly before anything opens (resource-bounds §3):
    // an over-limit join is answered with the 429 envelope + Retry-After and
    // never opens, so it is never counted.
    let streamSlot = false;
    if (format === "sse") {
      if (openStreams >= settings.maxConcurrentSseStreams) {
        selfProtective429(res, accept);
        return;
      }
      openStreams += 1;
      streamSlot = true;
    }

    let cached;
    try {
      cached = await loadAdmitted(outcome.taskUuid);
    } catch (error) {
      if (streamSlot) openStreams -= 1;
      if (error instanceof AdmissionRefused) selfProtective429(res, accept);
      else respondError(res, accept, toEnvelope(error));
      return;
    }

    if (format === "sse") {
      // Streams refresh by re-walking (the cache must not freeze a live view).
      try {
        const stream = startSseStream({
          res,
          taskUuid: outcome.taskUuid,
          refreshSeconds: settings.refreshSeconds,
          clock,
          initialView: cached.value,
          loadView: (taskUuid) => reconstructHistory(reconstructDeps, taskUuid),
        });
        void stream.done.then(() => {
          openStreams -= 1;
        });
      } catch (error) {
        openStreams -= 1;
        throw error;
      }
      return;
    }
    const cacheHeaders: Record<string, string> = {
      "X-History-Cache": cached.cacheState,
      ...(cached.cacheState === "hit" ? { "X-History-Age-Ms": String(cached.ageMs) } : {}),
    };
    if (format === "json") {
      respond(
        res,
        200,
        "application/json; charset=utf-8",
        viewAsJson(cached.value),
        cacheHeaders,
      );
      return;
    }
    respond(
      res,
      200,
      "text/html; charset=utf-8",
      viewAsHtml(cached.value, { refreshSeconds: settings.refreshSeconds }),
      cacheHeaders,
    );
  }

  const app: SyncHistoryServerApp = {
    settings,
    handle(req, res) {
      void handleRequest(req, res).catch(() => {
        // Last-resort envelope: even a programmer error ships zero history.
        try {
          respond(res, ERROR_ENVELOPES.INTERNAL.status, "application/json; charset=utf-8", errorAsJson(ERROR_ENVELOPES.INTERNAL));
        } catch {
          /* socket already gone */
        }
      });
    },
    listen(port = 0, host = "127.0.0.1") {
      return listenHistoryApp(app, port, host);
    },
  };
  return app;
}
