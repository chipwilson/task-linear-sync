/**
 * Resilience posture (research R4; contracts/resilience-and-credentials.md §2–4 — the
 * constitution's Resilience constraint made concrete, never weakened):
 *
 * > Non-create Linear requests that fail with HTTP 429, 5xx, or network errors MUST retry
 * > with exponential backoff and randomized jitter up to the configurable maximum, honoring
 * > `Retry-After`. Issue creation MUST never be automatically retried; a failed create is
 * > recorded as indeterminate and reconciled, not replayed.
 *
 * Pure functions over injected clock/rng/sleeper — deterministic schedules (Principle IV).
 * `withRetry` takes the MANDATORY `retryClass` per-operation permission; `createIssue` is the
 * only "never" path (frozen invariant 2: no retry knob may exist anywhere above the request
 * site, and none does).
 */
import type { Clock } from "../state/clock.js";
import { IndeterminateCreateError, TrackerError, type TrackerErrorCategory } from "./errors.js";

export type RetryClass = "non-create" | "never";

export interface RetryOutcome {
  /** Requests actually issued (≥ 1). */
  attempts: number;
  /** Total backoff time waited (ms) — recorded via the injected sleeper. */
  waitedMs: number;
}

export interface ClassifiedFailure {
  category: TrackerErrorCategory;
  retryable: boolean;
  httpStatus?: number;
  detail: string;
}

/** The three failure-signal kinds the single request site produces (R12). */
export type FailureSignal =
  | { readonly kind: "network"; readonly error: unknown }
  | { readonly kind: "http"; readonly status: number; readonly detail: string }
  | { readonly kind: "graphql"; readonly detail: string };

/** Classification table rows 1–7 (resilience contract §2). */
export function classifyFailure(signal: FailureSignal): ClassifiedFailure {
  if (signal.kind === "network") {
    const name = (signal.error as { name?: unknown } | null)?.name;
    const timedOut = name === "TimeoutError" || name === "AbortError";
    return {
      category: timedOut ? "timeout" : "network",
      retryable: true,
      detail: timedOut ? "request timed out (abort signal)" : "transport failure",
    };
  }
  if (signal.kind === "graphql") {
    return { category: "graphql", retryable: false, detail: signal.detail };
  }
  const { status, detail } = signal;
  const base = { detail, httpStatus: status };
  if (status === 429) return { category: "rate-limit", retryable: true, ...base };
  if (status >= 500) return { category: "server", retryable: true, ...base };
  if (status === 401 || status === 403) return { category: "auth", retryable: false, ...base };
  if (status === 404) return { category: "not-found", retryable: false, ...base };
  return { category: "client", retryable: false, ...base };
}

export interface ScheduleOptions {
  readonly baseMs: number;
  readonly maxDelayMs: number;
  readonly rng: () => number;
  /** Raw `Retry-After` header value when the failure response carried one. */
  readonly retryAfterHeader?: string | null;
  /** Injected clock instant — HTTP-date Retry-After is evaluated against this, never Date.now. */
  readonly now: Date;
}

/**
 * Delay before attempt k (0-based): computed = min(baseMs · 2^k, maxDelayMs); EQUAL JITTER
 * delay = computed/2 + rng()·computed/2. A `Retry-After` (delta-seconds or HTTP-date)
 * REPLACES the computed value, clamped to [0, maxDelayMs]; malformed/absent ⇒ computed stands.
 */
export function nextDelayMs(attempt: number, opts: ScheduleOptions): number {
  const computed = Math.min(opts.baseMs * 2 ** attempt, opts.maxDelayMs);
  const jittered = computed / 2 + opts.rng() * (computed / 2);
  const retryAfter = parseRetryAfter(opts.retryAfterHeader ?? null, opts.now);
  const chosen = retryAfter ?? jittered;
  return Math.min(Math.max(0, chosen), opts.maxDelayMs);
}

function parseRetryAfter(header: string | null, now: Date): number | null {
  if (header === null) return null;
  const trimmed = header.trim();
  if (trimmed === "") return null;
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed) * 1000;
  const at = Date.parse(trimmed);
  if (!Number.isNaN(at)) return at - now.getTime();
  return null; // malformed ⇒ ignore; the computed backoff stands
}

export type AttemptOutcome<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly failure: ClassifiedFailure;
      readonly retryAfterHeader?: string | null;
    };

export interface RetryDeps {
  readonly maxRetries: number;
  readonly baseMs: number;
  readonly maxDelayMs: number;
  readonly rng: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly clock: Clock;
}

export interface RetrySuccess<T> {
  readonly value: T;
  readonly outcome: RetryOutcome;
}

/**
 * The retry wrapper with the mandatory per-operation-class permission (`retryClass`).
 * - "non-create": up to `maxRetries` ADDITIONAL attempts after the first (≤ maxRetries+1
 *   requests), equal-jitter backoff, Retry-After honored via the attempt outcome's header.
 * - "never": exactly one request; a retryable-signal failure becomes
 *   `IndeterminateCreateError` (attempts 1), a non-retryable failure keeps its category.
 * Terminal failure throws a `TrackerError` mirroring the FINAL signal's classification.
 */
export async function withRetry<T>(
  run: (attempt: number) => Promise<AttemptOutcome<T>>,
  opts: { readonly retryClass: RetryClass } & RetryDeps,
): Promise<RetrySuccess<T>> {
  const additional = opts.retryClass === "never" ? 0 : Math.max(0, opts.maxRetries);
  let waitedMs = 0;
  let attemptsIssued = 0;
  let lastFailure: ClassifiedFailure | undefined;
  for (let attempt = 0; attempt <= additional; attempt++) {
    attemptsIssued = attempt + 1;
    const outcome = await run(attempt);
    if (outcome.ok) return { value: outcome.value, outcome: { attempts: attempt + 1, waitedMs } };
    lastFailure = outcome.failure;
    const mayRetry =
      outcome.failure.retryable && opts.retryClass !== "never" && attempt < additional;
    if (!mayRetry) break;
    const delay = nextDelayMs(attempt, {
      baseMs: opts.baseMs,
      maxDelayMs: opts.maxDelayMs,
      rng: opts.rng,
      retryAfterHeader: outcome.retryAfterHeader ?? null,
      now: opts.clock.now(),
    });
    waitedMs += delay;
    await opts.sleep(delay);
  }
  const failure = lastFailure ?? {
    category: "network" as TrackerErrorCategory,
    retryable: false,
    detail: "retry loop exited without a failure signal",
  };
  if (opts.retryClass === "never" && failure.retryable) {
    throw new IndeterminateCreateError({ detail: failure.detail, httpStatus: failure.httpStatus });
  }
  throw new TrackerError({
    category: failure.category,
    retryable: failure.retryable,
    attempts: attemptsIssued,
    httpStatus: failure.httpStatus,
    detail: failure.detail,
  });
}

/** Per-client concurrency semaphore of `config.concurrency` (R4 fan-out bound). */
export interface Semaphore {
  acquire(): Promise<() => void>;
}

export function createSemaphore(limit: number): Semaphore {
  let active = 0;
  const waiters: Array<() => void> = [];
  return {
    async acquire(): Promise<() => void> {
      if (active >= limit) {
        await new Promise<void>((resolve) => waiters.push(resolve));
      }
      active++;
      let released = false;
      return () => {
        if (released) return; // double-release is a no-op
        released = true;
        active--;
        const next = waiters.shift();
        if (next) next();
      };
    },
  };
}
