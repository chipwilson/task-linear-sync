/**
 * Composition root (T010 skeleton; pipeline wired by T021; contracts/
 * component-api.md §1, http-surface.md §2–5).
 *
 * `createSyncHistoryServer` validates everything at construction (fail fast,
 * never silent) and returns a deployable `(req, res)` handler. The request
 * pipeline is route → (auth gate lands in US2) → reconstruct → content
 * negotiation (SSE/JSON/HTML). Error responses render from the fixed
 * envelopes on a structurally separate path, so a failure can never carry
 * history bytes. `process.env` appears exactly once in the whole module
 * group — the deps default below (research R9).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ResolvedConfig } from "../config/schema.js";
import { createDefaultSecurityScreener } from "../engine/screening.js";
import type { SecurityScreener } from "../ports/engine.js";
import type { LinearPort } from "../ports/linear-port.js";
import { UrlSchemeError, canonicalAttachmentUrl, continuationAttachmentUrl } from "../urls/attachment-url.js";
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
  viewAsHtml,
  viewAsJson,
} from "./render.js";
import { reconstructHistory, type ReconstructDeps } from "./reconstruct.js";
import { parseHistoryRoute } from "./routes.js";
import { listenHistoryApp } from "./serve.js";
import { startSseStream } from "./sse.js";
import { defaultHistoryClock, type HistoryPageView, type NegotiatedFormat } from "./types.js";

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
  void env; // consumed by the US2 auth gate (T031)

  const reconstructDeps: ReconstructDeps = { port: deps.port, config, clock, screener };

  function respond(
    res: ServerResponse,
    status: number,
    contentType: string,
    body: string,
  ): void {
    res.writeHead(status, {
      ...SECURITY_HEADERS,
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
  ): void {
    const format = negotiateFormat(accept, settings.sseEnabled);
    if (format === "sse") {
      res.writeHead(error.status, {
        ...SECURITY_HEADERS,
        "Content-Type": "text/event-stream",
        Connection: "keep-alive",
      });
      res.end(errorAsSseFrame(error));
      return;
    }
    if (format === "json") {
      respond(res, error.status, "application/json; charset=utf-8", errorAsJson(error));
      return;
    }
    respond(res, error.status, "text/html; charset=utf-8", errorAsHtml(error));
  }

  function toEnvelope(error: unknown): ErrorEnvelope {
    return error instanceof HistoryRequestError ? error.envelope : ERROR_ENVELOPES.INTERNAL;
  }

  async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const accept = typeof req.headers.accept === "string" ? req.headers.accept : undefined;
    const outcome = parseHistoryRoute(config, req.url ?? "");
    if (outcome.kind === "notFound") {
      respondError(res, accept, ERROR_ENVELOPES.NOT_FOUND);
      return;
    }
    if (outcome.kind === "internalError") {
      respondError(res, accept, ERROR_ENVELOPES.INTERNAL);
      return;
    }

    // Session bootstrap POST lands with the US2 auth gate (T031); until then
    // — and permanently in public mode — anything but GET is refused.
    if (req.method !== "GET") {
      respondError(res, accept, METHOD_NOT_ALLOWED);
      return;
    }

    const format: NegotiatedFormat = negotiateFormat(accept, settings.sseEnabled);
    const load = (): Promise<HistoryPageView> =>
      reconstructHistory(reconstructDeps, outcome.taskUuid);

    let view;
    try {
      view = await load();
    } catch (error) {
      respondError(res, accept, toEnvelope(error));
      return;
    }

    if (format === "sse") {
      startSseStream({
        res,
        taskUuid: outcome.taskUuid,
        refreshSeconds: settings.refreshSeconds,
        clock,
        initialView: view,
        loadView: load,
      });
      return;
    }
    if (format === "json") {
      respond(res, 200, "application/json; charset=utf-8", viewAsJson(view));
      return;
    }
    respond(
      res,
      200,
      "text/html; charset=utf-8",
      viewAsHtml(view, { refreshSeconds: settings.refreshSeconds }),
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
