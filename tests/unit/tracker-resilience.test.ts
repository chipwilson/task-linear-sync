/**
 * T006 [P] — resilience unit tests (contracts/resilience-and-credentials.md §2–4, verbatim
 * constraint: "Non-create Linear requests that fail with HTTP 429, 5xx, or network errors MUST
 * retry with exponential backoff and randomized jitter up to the configurable maximum, honoring
 * Retry-After. Issue creation MUST never be automatically retried.").
 * Classification rows 1–7; equal-jitter schedule bounds under seeded rng; retry budget and
 * maxRetries: 0; Retry-After replacement/clamp; create guard ⇒ exactly attempts: 1.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyFailure,
  nextDelayMs,
  withRetry,
  createSemaphore,
  TrackerError,
  IndeterminateCreateError,
  type AttemptOutcome,
  type ClassifiedFailure,
  type RetryDeps,
} from "task-linear-sync/tracker";
import { FakeClock, FakeSleeper, splitmixRng } from "../helpers/tracker-harness.js";

// ── Classification table rows 1–7 ──────────────────────────────────────────────

test("resilience classification row 1: network error retryable; abort-timeout category timeout", () => {
  const network = classifyFailure({ kind: "network", error: Object.assign(new Error("socket reset"), { name: "TypeError" }) });
  assert.equal(network.category, "network");
  assert.equal(network.retryable, true);
  const timeout = classifyFailure({ kind: "network", error: Object.assign(new Error("aborted"), { name: "TimeoutError" }) });
  assert.equal(timeout.category, "timeout");
  assert.equal(timeout.retryable, true);
  const abort = classifyFailure({ kind: "network", error: Object.assign(new Error("aborted"), { name: "AbortError" }) });
  assert.equal(abort.category, "timeout");
});

test("resilience classification row 2: HTTP 429 → rate-limit, retryable", () => {
  const c = classifyFailure({ kind: "http", status: 429, detail: "too many requests" });
  assert.equal(c.category, "rate-limit");
  assert.equal(c.retryable, true);
  assert.equal(c.httpStatus, 429);
});

test("resilience classification row 3: HTTP 5xx → server, retryable", () => {
  for (const status of [500, 502, 503, 504, 599]) {
    const c = classifyFailure({ kind: "http", status, detail: `HTTP ${status}` });
    assert.equal(c.category, "server", `status ${status}`);
    assert.equal(c.retryable, true);
  }
});

test("resilience classification row 4: HTTP 401/403 → auth, not retryable", () => {
  for (const status of [401, 403]) {
    const c = classifyFailure({ kind: "http", status, detail: `auth rejected (HTTP ${status})` });
    assert.equal(c.category, "auth");
    assert.equal(c.retryable, false);
  }
});

test("resilience classification row 5: HTTP 404 → not-found, not retryable", () => {
  const c = classifyFailure({ kind: "http", status: 404, detail: "no such resource" });
  assert.equal(c.category, "not-found");
  assert.equal(c.retryable, false);
});

test("resilience classification row 6: other HTTP 4xx → client, not retryable", () => {
  for (const status of [400, 405, 422, 429 - 1]) {
    const c = classifyFailure({ kind: "http", status, detail: `request defect ${status}` });
    assert.equal(c.category, "client");
    assert.equal(c.retryable, false);
  }
});

test("resilience classification row 7: HTTP 200 + GraphQL errors → graphql, not retryable", () => {
  const c = classifyFailure({ kind: "graphql", detail: "userError: something invalid" });
  assert.equal(c.category, "graphql");
  assert.equal(c.retryable, false);
});

// ── Schedule (R4): equal jitter over min(baseMs · 2^k, maxDelayMs) ─────────────

test("resilience schedule: k-th equal-jitter delay within [computed/2, computed], clamped at maxDelayMs", () => {
  const rng = splitmixRng(42);
  const clock = new FakeClock("2026-10-23T12:00:00.000Z");
  for (let attempt = 0; attempt <= 6; attempt++) {
    const computed = Math.min(250 * 2 ** attempt, 15_000);
    const delay = nextDelayMs(attempt, { baseMs: 250, maxDelayMs: 15_000, rng, now: clock.now() });
    assert.ok(delay >= computed / 2 - 1e-9, `attempt ${attempt}: ${delay} >= ${computed / 2}`);
    assert.ok(delay <= computed + 1e-9, `attempt ${attempt}: ${delay} <= ${computed}`);
  }
});

test("resilience schedule: equal-jitter extremes — rng 0 ⇒ half, rng ≈1 ⇒ ≈ full", () => {
  const clock = new FakeClock("2026-10-23T12:00:00.000Z");
  const low = nextDelayMs(2, { baseMs: 250, maxDelayMs: 15_000, rng: () => 0, now: clock.now() });
  assert.equal(low, 500); // computed = 1000; half
  const high = nextDelayMs(2, { baseMs: 250, maxDelayMs: 15_000, rng: () => 0.999999, now: clock.now() });
  assert.ok(high > 999 && high < 1000.0001, String(high));
});

test("resilience schedule: identical seed ⇒ identical delay sequence (determinism, Principle IV)", () => {
  const clock = new FakeClock("2026-10-23T12:00:00.000Z");
  const run = (): number[] => {
    const rng = splitmixRng(7);
    return [0, 1, 2, 3, 4].map((k) => nextDelayMs(k, { baseMs: 250, maxDelayMs: 15_000, rng, now: clock.now() }));
  };
  assert.deepEqual(run(), run());
});

// ── Retry-After honoring (§4): replaces the computed value, clamped [0, maxDelayMs] ──

test("resilience Retry-After delta-seconds replaces the jittered delay (3 → 3000ms)", () => {
  const clock = new FakeClock("2026-10-23T12:00:00.000Z");
  const d = nextDelayMs(0, {
    baseMs: 250,
    maxDelayMs: 15_000,
    rng: () => 0.5,
    retryAfterHeader: "3",
    now: clock.now(),
  });
  assert.equal(d, 3000);
});

test("resilience Retry-After HTTP-date evaluated against the injected clock", () => {
  const clock = new FakeClock("2026-10-23T12:00:00.000Z");
  const header = new Date(Date.UTC(2026, 9, 23, 12, 0, 5)).toUTCString();
  const d = nextDelayMs(0, { baseMs: 250, maxDelayMs: 15_000, rng: () => 0.5, retryAfterHeader: header, now: clock.now() });
  assert.equal(d, 5000);
});

test("resilience Retry-After clamped to [0, maxDelayMs] — a 4-hour hint is a config error, not a hang", () => {
  const clock = new FakeClock("2026-10-23T12:00:00.000Z");
  const huge = nextDelayMs(0, { baseMs: 250, maxDelayMs: 15_000, rng: () => 0.5, retryAfterHeader: "14400", now: clock.now() });
  assert.equal(huge, 15_000);
  const past = new Date(Date.UTC(2026, 9, 23, 11, 59, 55)).toUTCString();
  const negative = nextDelayMs(0, { baseMs: 250, maxDelayMs: 15_000, rng: () => 0.5, retryAfterHeader: past, now: clock.now() });
  assert.equal(negative, 0);
});

test("resilience Retry-After malformed header ignored — computed backoff stands", () => {
  const clock = new FakeClock("2026-10-23T12:00:00.000Z");
  const d = nextDelayMs(1, { baseMs: 250, maxDelayMs: 15_000, rng: () => 0.5, retryAfterHeader: "soon-ish", now: clock.now() });
  assert.equal(d, 375); // computed 500 → 250 + 0.5·250
});

// ── withRetry: budget, maxRetries: 0, create guard ─────────────────────────────

const fail = (failure: ClassifiedFailure, retryAfterHeader?: string): AttemptOutcome<string> => ({
  ok: false,
  failure,
  retryAfterHeader,
});
const serverFailure = (status = 502): ClassifiedFailure => ({
  category: "server",
  retryable: true,
  httpStatus: status,
  detail: `HTTP ${status}`,
});
const rateFailure: ClassifiedFailure = { category: "rate-limit", retryable: true, httpStatus: 429, detail: "429" };
const networkFailure: ClassifiedFailure = { category: "network", retryable: true, detail: "socket reset" };
const authFailure: ClassifiedFailure = { category: "auth", retryable: false, httpStatus: 401, detail: "auth rejected" };
const graphqlFailure: ClassifiedFailure = { category: "graphql", retryable: false, detail: "userError" };

function deps(overrides: Partial<RetryDeps> = {}): RetryDeps & { sleeper: FakeSleeper } {
  const sleeper = new FakeSleeper();
  const clock = new FakeClock("2026-10-23T12:00:00.000Z");
  const base: RetryDeps = {
    maxRetries: 5,
    baseMs: 250,
    maxDelayMs: 15_000,
    rng: splitmixRng(11),
    sleep: sleeper.sleep,
    clock,
  };
  return { ...base, ...overrides, sleeper };
}

test("resilience budget: maxRetries additional attempts after the first — ≤ 6 requests, waits recorded", async () => {
  const d = deps();
  let calls = 0;
  const run = async (): Promise<AttemptOutcome<string>> => {
    calls++;
    return fail(serverFailure());
  };
  await assert.rejects(
    withRetry(run, { retryClass: "non-create", ...d }),
    (e: unknown) => {
      assert.ok(e instanceof TrackerError);
      assert.equal(e.category, "server");
      assert.equal(e.retryable, true);
      assert.equal(e.attempts, 6);
      assert.equal(e.httpStatus, 502);
      return true;
    },
  );
  assert.equal(calls, 6, "1 initial + 5 additional");
  assert.equal(d.sleeper.waits.length, 5, "one wait between attempts");
  assert.ok(d.sleeper.totalMs > 0);
});

test("resilience budget: maxRetries: 0 override honored ⇒ exactly one request", async () => {
  const d = deps({ maxRetries: 0 });
  let calls = 0;
  await assert.rejects(
    withRetry(async () => {
      calls++;
      return fail(serverFailure());
    }, { retryClass: "non-create", ...d }),
    (e: unknown) => e instanceof TrackerError && e.attempts === 1,
  );
  assert.equal(calls, 1);
  assert.equal(d.sleeper.waits.length, 0);
});

test("resilience: success after two retryable failures — outcome records attempts and waitedMs", async () => {
  const d = deps();
  let calls = 0;
  const result = await withRetry(async (): Promise<AttemptOutcome<string>> => {
    calls++;
    return calls <= 2 ? fail(serverFailure()) : { ok: true, value: "recovered" };
  }, { retryClass: "non-create", ...d });
  assert.equal(result.value, "recovered");
  assert.equal(result.outcome.attempts, 3);
  assert.equal(d.sleeper.waits.length, 2);
  assert.equal(result.outcome.waitedMs, d.sleeper.totalMs);
});

test("resilience: non-retryable failure is terminal on the first attempt", async () => {
  const d = deps();
  let calls = 0;
  await assert.rejects(
    withRetry(async () => {
      calls++;
      return fail(authFailure);
    }, { retryClass: "non-create", ...d }),
    (e: unknown) => e instanceof TrackerError && e.category === "auth" && e.attempts === 1,
  );
  assert.equal(calls, 1);
});

test("resilience create guard: class 'never' ⇒ exactly attempts: 1 + IndeterminateCreateError under every retryable signal", async () => {
  for (const failure of [serverFailure(), rateFailure, networkFailure]) {
    const d = deps();
    let calls = 0;
    await assert.rejects(
      withRetry(async () => {
        calls++;
        return fail(failure);
      }, { retryClass: "never", ...d }),
      (e: unknown) => {
        assert.ok(e instanceof IndeterminateCreateError, `for ${failure.category}`);
        assert.equal(e.category, "create-indeterminate");
        assert.equal(e.retryable, false);
        assert.equal(e.attempts, 1);
        return true;
      },
    );
    assert.equal(calls, 1, `no second request for ${failure.category}`);
    assert.equal(d.sleeper.waits.length, 0, "never sleeps on the create path");
  }
});

test("resilience create guard: non-retryable create failure keeps its own category (still one attempt)", async () => {
  const d = deps();
  await assert.rejects(
    withRetry(async () => fail(graphqlFailure), { retryClass: "never", ...d }),
    (e: unknown) =>
      e instanceof TrackerError &&
      !(e instanceof IndeterminateCreateError) &&
      e.category === "graphql" &&
      e.attempts === 1,
  );
});

test("resilience: Retry-After on a retryable response flows into the executed wait", async () => {
  const d = deps();
  let calls = 0;
  await withRetry(async (): Promise<AttemptOutcome<string>> => {
    calls++;
    return calls === 1 ? fail(rateFailure, "2") : { ok: true, value: "ok" };
  }, { retryClass: "non-create", ...d });
  assert.equal(d.sleeper.waits[0], 2000, "Retry-After: 2 replaces the jittered schedule");
});

// ── Per-client concurrency semaphore (R4 fan-out bound) ────────────────────────

test("resilience semaphore: caps in-flight acquisitions at the limit and releases FIFO", async () => {
  const sem = createSemaphore(2);
  const order: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const hold = async (id: string, ms: number): Promise<void> => {
    const release = await sem.acquire();
    order.push(`acquire:${id}`);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, ms));
    inFlight--;
    order.push(`release:${id}`);
    release();
    release(); // double release is a no-op
  };
  await Promise.all([hold("a", 20), hold("b", 10), hold("c", 1), hold("d", 1)]);
  assert.equal(maxInFlight, 2, "never more than the configured limit in flight");
  assert.equal(order.filter((o) => o.startsWith("acquire")).length, 4);
  assert.ok(order.indexOf("release:b") < order.indexOf("acquire:c"), "FIFO wake order");
});
