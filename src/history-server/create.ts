/**
 * Composition root (T010; contracts/component-api.md §1, data-model §8).
 *
 * `createSyncHistoryServer` validates everything at construction (fail fast,
 * never silent) and returns a deployable `(req, res)` handler. This phase
 * ships the fail-fast probes + routing skeleton: routed requests answer 501
 * envelopes until the US1/US2 pipeline wires reconstruction, auth and cache
 * below. `process.env` appears exactly once in the whole module group — the
 * deps default below (research R9).
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { ResolvedConfig } from "../config/schema.js";
import { createDefaultSecurityScreener } from "../engine/screening.js";
import type { SecurityScreener } from "../ports/engine.js";
import type { LinearPort } from "../ports/linear-port.js";
import { UrlSchemeError, canonicalAttachmentUrl, continuationAttachmentUrl } from "../urls/attachment-url.js";
import { ERROR_ENVELOPES, HistoryServerConfigError } from "./errors.js";
import { resolveHistoryServerConfig, type ResolvedHistoryServerSettings } from "./options.js";
import { parseHistoryRoute } from "./routes.js";
import { listenHistoryApp } from "./serve.js";
import { defaultHistoryClock, type HistoryClock } from "./types.js";

/** Placeholder identity for construction-time scheme probes (never served). */
const PROBE_UUID = "ac000000-0000-4000-8000-000000000000";

export interface SyncHistoryServerDeps {
  /** The ONLY route to the tracker (constitution V). */
  readonly port: LinearPort;
  /** Frozen merged config: URL scheme, namespace key, `web` surface group. */
  readonly config: ResolvedConfig;
  /** TTL / cadence / expiry time source; defaults to system time. */
  readonly clock?: HistoryClock;
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
  void env;
  void clock;
  void screener;

  const app: SyncHistoryServerApp = {
    settings,
    handle(req, res) {
      // Full pipeline lands in T021/T031 (auth → cache → reconstruct →
      // negotiate). This skeleton only proves routing + envelope posture.
      const outcome = parseHistoryRoute(config, req.url ?? "");
      if (outcome.kind === "notFound") {
        respondEnvelope(res, ERROR_ENVELOPES.NOT_FOUND);
        return;
      }
      if (outcome.kind === "internalError") {
        respondEnvelope(res, ERROR_ENVELOPES.INTERNAL);
        return;
      }
      respondEnvelope(res, { ...ERROR_ENVELOPES.INTERNAL, status: 501 });
    },
    listen(port = 0, host = "127.0.0.1") {
      return listenHistoryApp(app, port, host);
    },
  };
  return app;
}

/** Provisional JSON-only envelope writer (superseded by render.ts in T019). */
function respondEnvelope(res: ServerResponse, envelope: { code: string; status: number; message: string }): void {
  const body = JSON.stringify({ error: { code: envelope.code, message: envelope.message } });
  res.writeHead(envelope.status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy":
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
  });
  res.end(body);
}
