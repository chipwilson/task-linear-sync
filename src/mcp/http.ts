/**
 * T054 [US3] — the optional loopback http transport (transport-auth.md §2, FR-004).
 *
 * `node:http` on `settings.host:settings.port` (defaults 127.0.0.1 / 0 = ephemeral);
 * the bound port is announced to STDERR exactly once at listen and NEVER inside a
 * protocol message. Route surface is `POST /mcp` only: every other path answers the
 * fixed 404 constant, every other method the fixed 405. The bearer gate (auth.ts)
 * runs strictly before the body read and before ANY dispatch — refusals touch no
 * handler, engine, port, or state (SC-002). Bodies are capped at 1 MiB (oversized ⇒
 * fixed 413) and carry EXACTLY ONE JSON-RPC message (an array is an invalid request,
 * not a batch). Notifications answer 202 with an empty body.
 */
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import process from "node:process";

import { checkBearerAuth, HTTP_REFUSALS } from "./auth.js";
import type { HttpRefusal } from "./auth.js";
import { MSG_INVALID_REQUEST, RPC_ERROR_CODES, errorReply } from "./jsonrpc.js";
import type { JsonRpcReply } from "./jsonrpc.js";

/** transport-auth.md §2.1: the body is a single message with a 1 MiB cap. */
export const MAX_BODY_BYTES = 1024 * 1024;

export interface HttpListener {
  /** The REAL bound port (0 resolves to the ephemeral assignment). */
  readonly port: number;
  /** Idempotent: repeated closes await the same completion. */
  close(): Promise<void>;
}

export interface ListenHttpInput {
  readonly host: string;
  readonly port: number;
  /** Captured at CONSTRUCTION (component-api.md §1) — never re-read from env here. */
  readonly token: string;
  /** Announce label, e.g. `task-linear-sync-mcp`. */
  readonly serverName: string;
  readonly handleMessage: (raw: unknown) => Promise<JsonRpcReply | null>;
}

/** Start the listener; the promise settles with the listen (or its error). */
export function listenHttp(input: ListenHttpInput): Promise<HttpListener> {
  return new Promise<HttpListener>((resolve, reject) => {
    const server = createServer((req, res) => {
      void handle(req, res);
    });
    let settled = false; // the first listen outcome settles the promise; later errors stay handled
    server.on("error", (error: Error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    server.listen(input.port, input.host, () => {
      settled = true;
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : input.port;
      process.stderr.write(`${input.serverName}: listening on ${input.host}:${port}\n`);
      let closing: Promise<void> | null = null;
      resolve({
        port,
        close: () =>
          (closing ??= new Promise<void>((done) => {
            server.close(() => done());
            server.closeAllConnections(); // keep-alive fetch sockets must not delay the close
          })),
      });
    });

    async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
      try {
        // Route surface FIRST: path/method refusals are constants that need no credential.
        const path = ((req.url ?? "/").split("?")[0] ?? "/").replace(/\/+$/, "") || "/";
        if (path !== "/mcp") return refuse(res, HTTP_REFUSALS.NOT_FOUND);
        if (req.method !== "POST") return refuse(res, HTTP_REFUSALS.METHOD_NOT_ALLOWED);

        // Auth gate strictly before the body read and before any dispatch (FR-004).
        const verdict = checkBearerAuth(req.headers.authorization, input.token);
        if (verdict === "missing") return refuse(res, HTTP_REFUSALS.UNAUTHORIZED);
        if (verdict === "mismatch") return refuse(res, HTTP_REFUSALS.FORBIDDEN);

        const body = await readCapped(req);
        if (body === null) {
          refuse(res, HTTP_REFUSALS.PAYLOAD_TOO_LARGE);
          req.resume(); // discard the oversized remainder now that the refusal is out
          return;
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          return jsonReply(res, errorReply(null, RPC_ERROR_CODES.INVALID_REQUEST, MSG_INVALID_REQUEST));
        }
        if (Array.isArray(parsed) || typeof parsed !== "object" || parsed === null) {
          return jsonReply(res, errorReply(null, RPC_ERROR_CODES.INVALID_REQUEST, MSG_INVALID_REQUEST));
        }

        const reply = await input.handleMessage(parsed);
        if (reply === null) {
          res.writeHead(202); // notification: accepted, no reply body
          res.end();
          return;
        }
        jsonReply(res, reply);
      } catch {
        refuse(res, HTTP_REFUSALS.INTERNAL); // the constant envelope — never the thrown text
      }
    }
  });
}

/** Read the body with the 1 MiB cap; null once the cap is exceeded (stops buffering). */
function readCapped(req: IncomingMessage): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let capped = false;
    req.on("data", (chunk: Buffer) => {
      if (capped) return;
      total += chunk.length;
      if (total > MAX_BODY_BYTES) {
        capped = true;
        req.pause();
        resolve(null);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => resolve(null));
  });
}

function refuse(res: ServerResponse, refusal: HttpRefusal): void {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (refusal.header !== undefined && refusal.headerValue !== undefined) {
    headers[refusal.header] = refusal.headerValue;
  }
  res.writeHead(refusal.status, headers);
  res.end(refusal.body); // constant body — transport-auth.md §2.1
}

function jsonReply(res: ServerResponse, reply: JsonRpcReply): void {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(reply));
}
