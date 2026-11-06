/**
 * Access control (T030; FR-008, contracts/access-control.md).
 *
 * Private mode accepts exactly two credentials: the bearer token compared
 * against the env-sourced value (constant-time), and a stateless session
 * cookie — `payload.tag` where `payload` is the base64url expiry and `tag` is
 * an HMAC-SHA256 under `K = hkdf(sha256, ikm = token, salt = toolId,
 * info = "history-session-v1")`. No session state is stored anywhere; expiry
 * is validated against the injected clock. The cookie value never contains a
 * substring of the token. Public mode ignores credentials entirely.
 *
 * This is the module group's only `node:crypto` user (hygiene contract).
 */

import { createHmac, hkdfSync, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { HistoryClock } from "./types.js";

/** Stateless session lifetime (fixed; not a config knob). */
export const SESSION_TTL_SECONDS = 3600;

/** Hard cap on the token-bootstrap request body (contracts/access-control.md). */
export const BOOTSTRAP_BODY_CAP_BYTES = 8 * 1024;

/**
 * Read a request body up to the cap; `undefined` means it overflowed (the
 * caller refuses with 403 — the remainder is never inspected).
 */
export function readBodyCapped(
  req: IncomingMessage,
  capBytes: number = BOOTSTRAP_BODY_CAP_BYTES,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (value: string | undefined): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    req.on("data", (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > capBytes) {
        finish(undefined);
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => finish(Buffer.concat(chunks).toString("utf8")));
    req.on("error", () => finish(undefined));
  });
}

/** Form-encoded `token=…` field of the bootstrap body, if present. */
export function parseBootstrapToken(body: string): string | undefined {
  const value = new URLSearchParams(body).get("token");
  return value === null ? undefined : value;
}

/** HKDF info label for the session key derivation. */
const SESSION_KEY_INFO = "history-session-v1";

type HeadersLike = Readonly<Record<string, string | string[] | undefined>>;

export function historySessionCookieName(toolId: string): string {
  return `${toolId}-history`;
}

/** K = HKDF-SHA256(ikm = token, salt = toolId, info = "history-session-v1", 32). */
export function deriveSessionKey(token: string, toolId: string): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(token, "utf8"),
      Buffer.from(toolId, "utf8"),
      Buffer.from(SESSION_KEY_INFO, "utf8"),
      32,
    ),
  );
}

function sessionTagB64(payloadB64: string, token: string, toolId: string): string {
  return createHmac("sha256", deriveSessionKey(token, toolId)).update(payloadB64, "utf8").digest("base64url");
}

const B64URL_ONLY = /^[A-Za-z0-9_-]+$/;

/** Mint `payload.tag` for a fresh session expiring SESSION_TTL_SECONDS out. */
export function issueSessionCookieValue(opts: {
  readonly token: string;
  readonly toolId: string;
  readonly clock: HistoryClock;
}): string {
  const expSeconds = Math.floor(opts.clock.now().getTime() / 1000) + SESSION_TTL_SECONDS;
  const payloadB64 = Buffer.from(JSON.stringify({ exp: expSeconds }), "utf8").toString("base64url");
  return `${payloadB64}.${sessionTagB64(payloadB64, opts.token, opts.toolId)}`;
}

/** Validate signature, shape, and expiry against the injected clock. */
export function verifySessionCookieValue(opts: {
  readonly token: string;
  readonly toolId: string;
  readonly clock: HistoryClock;
  readonly value: string;
}): boolean {
  const parts = opts.value.split(".");
  if (parts.length !== 2) return false;
  const [payloadB64, tagB64] = parts as [string, string];
  if (!B64URL_ONLY.test(payloadB64) || !B64URL_ONLY.test(tagB64)) return false;

  const expected = sessionTagB64(payloadB64, opts.token, opts.toolId);
  if (!constantTimeEquals(tagB64, expected)) return false;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return false;
  }
  if (typeof payload !== "object" || payload === null) return false;
  const exp = (payload as Record<string, unknown>)["exp"];
  if (typeof exp !== "number" || !Number.isFinite(exp)) return false;

  // Now must be STRICTLY before the expiry instant: at `exp` the cookie is dead.
  return opts.clock.now().getTime() / 1000 < exp;
}

/** Length-equalized constant-time string compare (no early-exit leaks). */
export function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export type AccessDecision =
  | { readonly kind: "allow" }
  | { readonly kind: "challenge" } // 401 — no credential was presented
  | { readonly kind: "deny" }; // 403 — a credential was presented and failed

export interface AccessGateDeps {
  readonly accessMode: "private" | "public";
  readonly tokenEnvVarName: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly toolId: string;
  readonly clock: HistoryClock;
  /** 014 (resource-bounds.md §4): append `; Secure`; no X-Forwarded-Proto sniffing. */
  readonly secureCookies?: boolean;
}

export interface AccessGate {
  /** GET authorization decision; runs strictly before any tracker probe. */
  authorize(headers: HeadersLike): AccessDecision;
  /** True when the POST bootstrap token matches the env token. */
  bootstrapTokenValid(token: string | undefined): boolean;
  /** Session cookie value for a successful bootstrap (`payload.tag`). */
  issueSessionCookie(): string;
  /** Full Set-Cookie attribute string for the bootstrap response. */
  sessionCookieHeader(): string;
}

export function readBearer(headers: HeadersLike): string | undefined {
  const raw = headers["authorization"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return undefined;
  if (!value.startsWith("Bearer ")) return undefined;
  return value.slice("Bearer ".length);
}

export function readSessionCookie(headers: HeadersLike, toolId: string): string | undefined {
  const raw = headers["cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (value === undefined) return undefined;
  const name = historySessionCookieName(toolId);
  for (const part of value.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

export function createAccessGate(deps: AccessGateDeps): AccessGate {
  const token = (): string => deps.env[deps.tokenEnvVarName] ?? "";

  const bearerValid = (headers: HeadersLike): boolean => {
    const presented = readBearer(headers);
    return presented !== undefined && constantTimeEquals(presented, token());
  };

  const cookieValid = (headers: HeadersLike): boolean => {
    const presented = readSessionCookie(headers, deps.toolId);
    if (presented === undefined) return false;
    return verifySessionCookieValue({
      token: token(),
      toolId: deps.toolId,
      clock: deps.clock,
      value: presented,
    });
  };

  return {
    authorize(headers) {
      if (deps.accessMode === "public") return { kind: "allow" };

      const bearerPresented = headers["authorization"] !== undefined;
      const cookiePresented = readSessionCookie(headers, deps.toolId) !== undefined;
      if (!bearerPresented && !cookiePresented) return { kind: "challenge" };

      if (bearerPresented && bearerValid(headers)) return { kind: "allow" };
      if (cookiePresented && cookieValid(headers)) return { kind: "allow" };
      // A presented credential that fails is never downgraded to a 401.
      return { kind: "deny" };
    },
    bootstrapTokenValid(presented) {
      return presented !== undefined && constantTimeEquals(presented, token());
    },
    issueSessionCookie() {
      return issueSessionCookieValue({ token: token(), toolId: deps.toolId, clock: deps.clock });
    },
    sessionCookieHeader() {
      const cookie = issueSessionCookieValue({ token: token(), toolId: deps.toolId, clock: deps.clock });
      return (
        `${historySessionCookieName(deps.toolId)}=${cookie}; ` +
        "Path=/; HttpOnly; SameSite=Strict" +
        // 014 (resource-bounds.md §4): opt-in suffix; the base string is untouched.
        (deps.secureCookies === true ? "; Secure" : "")
      );
    },
  };
}
