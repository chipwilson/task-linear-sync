/**
 * Error taxonomy (T007; research R7, contracts/http-surface.md §4).
 *
 * The browser-facing code set is CLOSED and each code carries a FIXED,
 * sanitized message constant: upstream `TrackerError.detail` never travels
 * into a response, and the messages name no credential and no local paths.
 * Error rendering (`render.ts`) consumes ONLY these constants — never the
 * reconstruction path (contracts/access-control.md §4.3).
 */

export class HistoryServerConfigError extends Error {
  override readonly name = "HistoryServerConfigError";
  constructor(message: string) {
    super(message);
  }
}

export type HistoryErrorCode =
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "TRACKER_UNAVAILABLE"
  | "INTERNAL";

export interface ErrorEnvelope {
  readonly code: HistoryErrorCode;
  readonly status: number;
  readonly message: string;
  /**
   * 014 (resource-bounds.md §3/§7): a 429 may also be triggered by SELF-
   * protection (walk/SSE-stream admission). Same frozen body, one header
   * addition — the header delta travels here so the trigger site applies it
   * and the tracker-originated mapping stays header-free.
   */
  readonly selfProtective?: { readonly headers: Readonly<Record<string, string>> };
}

/**
 * Closed status/code/message table — the only error text this surface ships.
 * `RATE_LIMITED.selfProtective` is a T022 addition (header delta only; the
 * rendered body stays the frozen `{error:{code,message}}` shape).
 */
export const ERROR_ENVELOPES: Readonly<Record<HistoryErrorCode, ErrorEnvelope>> = {
  NOT_FOUND: {
    code: "NOT_FOUND",
    status: 404,
    message: "history: no synced history is available for this task",
  },
  UNAUTHORIZED: {
    code: "UNAUTHORIZED",
    status: 401,
    message: "history: authentication is required to view this page",
  },
  FORBIDDEN: {
    code: "FORBIDDEN",
    status: 403,
    message: "history: the supplied credential is not valid for this surface",
  },
  RATE_LIMITED: {
    code: "RATE_LIMITED",
    status: 429,
    message: "history: the tracker is rate limiting reads; try again later",
    selfProtective: { headers: { "Retry-After": "1" } },
  },
  TRACKER_UNAVAILABLE: {
    code: "TRACKER_UNAVAILABLE",
    status: 502,
    message: "history: the tracker could not be reached to read the history chain",
  },
  INTERNAL: {
    code: "INTERNAL",
    status: 500,
    message: "history: an internal error prevented a response",
  },
};

/** A request-time failure mapped to exactly one envelope (zero history bytes). */
export class HistoryRequestError extends Error {
  override readonly name = "HistoryRequestError";
  readonly envelope: ErrorEnvelope;

  constructor(code: HistoryErrorCode) {
    super(ERROR_ENVELOPES[code].message);
    this.envelope = ERROR_ENVELOPES[code];
  }
}
