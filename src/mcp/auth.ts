/**
 * T054 [US3] — the http bearer gate (transport-auth.md §2.2, FR-004).
 *
 * `checkBearerAuth` is the ONLY credential comparison of the http transport:
 * constant-time (`timingSafeEqual`, length-guarded) against the construction-time
 * token value. Verdicts are a closed set so the caller maps them onto the fixed
 * HTTP refusal envelope set without ever learning WHY a credential failed —
 * no verdict, message, or envelope ever carries token material (FR-005).
 */
import { timingSafeEqual } from "node:crypto";

/** Closed verdict set: ok serves; missing ⇒ 401; mismatch ⇒ 403. */
export type BearerVerdict = "ok" | "missing" | "mismatch";

/**
 * Parse and compare the HTTP `authorization` header carrying a Bearer credential
 * (the scheme name is case-insensitive per RFC 7235; any other shape is treated
 * as NO credential, which answers 401 + `WWW-Authenticate: Bearer`).
 */
export function checkBearerAuth(header: string | undefined, expected: string): BearerVerdict {
  if (header === undefined) return "missing";
  const match = /^\s*bearer\s+(.+)$/i.exec(header);
  if (match === null) return "missing"; // not a Bearer credential at all
  const presented = Buffer.from(match[1]!.trim(), "utf8");
  const wanted = Buffer.from(expected, "utf8");
  if (presented.byteLength !== wanted.byteLength) return "mismatch"; // length guard, then constant-time
  return timingSafeEqual(presented, wanted) ? "ok" : "mismatch";
}

/** A closed-set refusal constant: status + constant JSON body (+ optional header). */
export interface HttpRefusal {
  readonly status: number;
  readonly body: string;
  readonly header?: string;
  readonly headerValue?: string;
}

/**
 * The closed HTTP refusal set (transport-auth.md §2.1): compile-time constants,
 * bodies are `{"error":"<CODE>"}` strings only — nothing dynamic, nothing leakable.
 */
export const HTTP_REFUSALS = {
  UNAUTHORIZED: { status: 401, body: '{"error":"UNAUTHORIZED"}', header: "www-authenticate", headerValue: "Bearer" },
  FORBIDDEN: { status: 403, body: '{"error":"FORBIDDEN"}' },
  NOT_FOUND: { status: 404, body: '{"error":"NOT_FOUND"}' },
  METHOD_NOT_ALLOWED: { status: 405, body: '{"error":"METHOD_NOT_ALLOWED"}', header: "allow", headerValue: "POST" },
  PAYLOAD_TOO_LARGE: { status: 413, body: '{"error":"PAYLOAD_TOO_LARGE"}' },
  INTERNAL: { status: 500, body: '{"error":"INTERNAL"}' },
} as const satisfies Record<string, HttpRefusal>;
