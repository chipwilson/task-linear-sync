/**
 * 007-local wiring — `TrackerClientOptions` (research R11; data-model.md §1). Frozen
 * `ResolvedConfig` is NOT extended: every knob 002 froze (pageSize, maxRetries, concurrency,
 * personalKeyPrefix, credentialEnvVarNames, ignoredStateTypes, URL templates) is consumed
 * from it; the values 002's frozen schema does not carry (endpoint URL, timeout, backoff
 * constants, orphan-probe window, injected transport/clock/rng/sleep/env) live HERE with
 * built-in generic defaults and programmatic override — zero consumer-required values
 * (Principle III). The public platform endpoint constant is NOT a consumer-organization
 * literal (R11).
 */
import type { Clock } from "../state/clock.js";
import { systemClock } from "../state/clock.js";
import type { HttpTransport } from "./http.js";
import { fetchTransport } from "./http.js";
import { TrackerConfigError } from "./errors.js";
import type { TrackerDiagnostic } from "./credentials.js";

/** Public platform GraphQL endpoint (constant of the public platform, not an org literal). */
export const DEFAULT_API_URL = "https://api.linear.app/graphql";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_BASE_DELAY_MS = 250;
export const DEFAULT_MAX_DELAY_MS = 15_000;
export const DEFAULT_ORPHAN_PROBE_LIMIT = 8;
/** Fixed seed for the built-in deterministic jitter source (Principle IV). */
export const DEFAULT_RNG_SEED = 0x2545f4914f6cdd1d;

export interface TrackerClientOptions {
  readonly apiUrl?: string;
  readonly transport?: HttpTransport;
  readonly env?: Record<string, string | undefined>;
  readonly clock?: Clock;
  /** [0,1) jitter source; default: seeded splitmix over a fixed constant — deterministic. */
  readonly rng?: () => number;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly timeoutMs?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly orphanProbeLimit?: number;
  /** Selects which frozen env-var NAME to read (default "token"). */
  readonly credentialKind?: "token" | "apiKey";
  /** Non-fatal pre-flight notes (default no-op). */
  readonly diagnostics?: (d: TrackerDiagnostic) => void;
}

/** Fully-defaulted options after construction-time validation. */
export interface ResolvedTrackerOptions {
  readonly apiUrl: string;
  readonly transport: HttpTransport;
  readonly env: Record<string, string | undefined>;
  readonly clock: Clock;
  readonly rng: () => number;
  readonly sleep: (ms: number) => Promise<void>;
  readonly timeoutMs: number;
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
  readonly orphanProbeLimit: number;
  readonly credentialKind: "token" | "apiKey";
  readonly diagnostics: (d: TrackerDiagnostic) => void;
}

/**
 * Seeded splitmix64 PRNG — deterministic [0,1) sequence for jitter (Principle IV): identical
 * seed ⇒ identical schedule, byte-for-byte, on every runtime (no Math.random).
 */
export function splitmixRng(seed: number = DEFAULT_RNG_SEED): () => number {
  let state = BigInt.asUintN(64, BigInt(Math.trunc(seed)));
  return (): number => {
    state = BigInt.asUintN(64, state + 0x9e3779b97f4a7c15n);
    let z = state;
    z = BigInt.asUintN(64, (z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n);
    z = BigInt.asUintN(64, (z ^ (z >> 27n)) * 0x94d049bb133111ebn);
    z = z ^ (z >> 31n);
    return Number(z >> 11n) / 0x20000000000000; // top 53 bits → [0, 1)
  };
}

function assertFiniteNonNegative(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new TrackerConfigError(`option '${name}' must be a finite number >= 0`);
  }
}

/** Validate + default. Throws TrackerConfigError for misconfiguration (pre-dispatch). */
export function resolveTrackerOptions(options: TrackerClientOptions = {}): ResolvedTrackerOptions {
  const apiUrl = options.apiUrl ?? DEFAULT_API_URL;
  if (!apiUrl.startsWith("https://")) {
    throw new TrackerConfigError("option 'apiUrl' must be an https: URL");
  }
  if (/[?#]/.test(apiUrl)) {
    throw new TrackerConfigError("option 'apiUrl' must not carry a query or fragment");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TrackerConfigError("option 'timeoutMs' must be a finite number > 0");
  }
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  assertFiniteNonNegative("baseDelayMs", baseDelayMs);
  assertFiniteNonNegative("maxDelayMs", maxDelayMs);
  if (baseDelayMs > maxDelayMs) {
    throw new TrackerConfigError("option 'baseDelayMs' must not exceed 'maxDelayMs'");
  }
  const orphanProbeLimit = options.orphanProbeLimit ?? DEFAULT_ORPHAN_PROBE_LIMIT;
  if (!Number.isInteger(orphanProbeLimit) || orphanProbeLimit < 0) {
    throw new TrackerConfigError("option 'orphanProbeLimit' must be an integer >= 0");
  }
  const credentialKind = options.credentialKind ?? "token";
  if (credentialKind !== "token" && credentialKind !== "apiKey") {
    throw new TrackerConfigError("option 'credentialKind' must be 'token' or 'apiKey'");
  }
  return {
    apiUrl,
    transport: options.transport ?? fetchTransport(apiUrl),
    env: options.env ?? process.env,
    clock: options.clock ?? systemClock,
    rng: options.rng ?? splitmixRng(),
    sleep:
      options.sleep ??
      ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    timeoutMs,
    baseDelayMs,
    maxDelayMs,
    orphanProbeLimit,
    credentialKind,
    diagnostics: options.diagnostics ?? (() => undefined),
  };
}
