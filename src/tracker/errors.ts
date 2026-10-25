/**
 * Error taxonomy (research R12; data-model.md §5). The request site
 * (`internal/request.ts`) is the SOLE mapper from HTTP/GraphQL failure signals into this
 * closed taxonomy; a sanitized `detail` never carries credential values (R5).
 *
 * - `TrackerError` — { category, retryable, attempts, httpStatus?, detail }
 * - `TrackerConfigError` — construction-time rejection (env-var NAMES / config keys named,
 *   zero requests issued — constitution "before any request").
 * - `IndeterminateCreateError` — "a failed create is recorded as indeterminate and
 *   reconciled, not replayed" (constitution Resilience). `retryable: false`, `attempts: 1`.
 */
/** Closed 10-category taxonomy (R12): the stable surface 008/009/013 branch on. */
export type TrackerErrorCategory =
  | "config"
  | "auth"
  | "rate-limit"
  | "server"
  | "network"
  | "timeout"
  | "not-found"
  | "client"
  | "graphql"
  | "create-indeterminate";

export interface TrackerErrorFields {
  readonly category: TrackerErrorCategory;
  /** Mirrors the R4 classification of the FINAL failure signal. */
  readonly retryable: boolean;
  /** Requests actually issued (1..maxRetries+1; 1 for class "never"; 0 for pre-dispatch). */
  readonly attempts: number;
  readonly httpStatus?: number;
  /** Sanitized (R5): no credential value, no org PII beyond platform-returned keys. */
  readonly detail: string;
}

export class TrackerError extends Error {
  override readonly name: string = "TrackerError";
  readonly category: TrackerErrorCategory;
  readonly retryable: boolean;
  readonly attempts: number;
  readonly httpStatus?: number;
  readonly detail: string;

  constructor(fields: TrackerErrorFields) {
    super(`${fields.category}: ${fields.detail}`);
    this.category = fields.category;
    this.retryable = fields.retryable;
    this.attempts = fields.attempts;
    if (fields.httpStatus !== undefined) this.httpStatus = fields.httpStatus;
    this.detail = fields.detail;
  }
}

/** Pre-dispatch rejection: names env-var NAMES / config keys only — never any value. */
export class TrackerConfigError extends TrackerError {
  override readonly name = "TrackerConfigError";
  constructor(detail: string) {
    super({ category: "config", retryable: false, attempts: 0, detail });
  }
}

/**
 * Post-dispatch create failure under a retryable signal. Exactly one request was issued
 * (`attempts: 1`); 008's create-intent journal reconciles — this feature never replays.
 */
export class IndeterminateCreateError extends TrackerError {
  override readonly name = "IndeterminateCreateError";
  constructor(fields: { detail: string; httpStatus?: number }) {
    super({
      category: "create-indeterminate",
      retryable: false,
      attempts: 1,
      httpStatus: fields.httpStatus,
      detail: `${fields.detail} (create indeterminate — recorded, not replayed)`,
    });
  }
}

export function isTrackerError(e: unknown): e is TrackerError {
  return e instanceof TrackerError;
}

/** T023 placeholder / T010-T011 skip signal: `detail` starts with "not-implemented: ". */
export function notImplemented(member: string): TrackerError {
  return new TrackerError({
    category: "config",
    retryable: false,
    attempts: 0,
    detail: `not-implemented: ${member}`,
  });
}

export function isNotImplemented(e: unknown): e is TrackerError {
  return e instanceof TrackerError && e.category === "config" && e.detail.startsWith("not-implemented");
}

/** R5 sanitizer: strips every held secret occurrence from any string destined for output. */
export type Sanitizer = (text: string) => string;

export function createSanitizer(secrets: readonly string[]): Sanitizer {
  const strip = secrets.filter((s) => s.length > 0);
  if (strip.length === 0) return (text) => text;
  return (text) => {
    let out = text;
    for (const secret of strip) out = out.split(secret).join("[REDACTED]");
    return out;
  };
}
