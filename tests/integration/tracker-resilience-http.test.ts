/**
 * T034 [US2] — resilience-over-HTTP integration tests: the REAL adapter over recorded
 * transports with fake sleeper/clock/rng (constitution Resilience verbatim):
 * "Non-create Linear requests that fail with HTTP 429, 5xx, or network errors MUST retry with
 * exponential backoff and randomized jitter up to the configurable maximum, honoring
 * `Retry-After`. Issue creation MUST never be automatically retried; a failed create is
 * recorded as indeterminate and reconciled, not replayed."
 * 429 + `Retry-After: 3` ⇒ recorded wait exactly 3000ms; HTTP-date Retry-After is evaluated
 * against the FAKE clock; 5xx×2-then-success stays inside the equal-jitter envelope; network
 * exhaustion ⇒ terminal `TrackerError` at attempts = maxRetries + 1; `maxRetries: 0` ⇒
 * exactly 1 attempt; every create failure ⇒ EXACTLY one request observed,
 * `IndeterminateCreateError`, no replay; 401 ⇒ `auth` with a detail that names the env-var
 * NAME and can never carry the planted sentinel.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { builtInDefaults, type ResolvedConfig } from "task-linear-sync/config";
import {
  createLinearPort,
  IndeterminateCreateError,
  TrackerError,
  type HttpTransport,
  type HttpRequest,
  type HttpResponse,
} from "task-linear-sync/tracker";
import { createRecordedTransport } from "task-linear-sync/tracker/testing";
import { FakeClock, FakeSleeper, fixtureEnv, scenarioDir, sentinelEnv, splitmixRng } from "../helpers/tracker-harness.js";

const FAKE_NOW = "2026-10-23T12:00:00.000Z";

function makePort(transport: HttpTransport, overrides: { config?: ResolvedConfig; env?: Record<string, string | undefined> } = {}) {
  const sleeper = new FakeSleeper();
  const port = createLinearPort({
    config: overrides.config ?? builtInDefaults,
    options: {
      transport,
      env: overrides.env ?? fixtureEnv(),
      clock: new FakeClock(FAKE_NOW),
      rng: splitmixRng(17),
      sleep: sleeper.sleep,
    },
  });
  return { port, sleeper };
}

const makeRecorded = (scenario: string): RecordedBundle => {
  const transport = createRecordedTransport(scenarioDir(scenario));
  const { port, sleeper } = makePort(transport);
  return { port, sleeper, transport };
};

interface RecordedBundle {
  port: ReturnType<typeof createLinearPort>;
  sleeper: FakeSleeper;
  transport: ReturnType<typeof createRecordedTransport>;
}

test("429 + Retry-After delta-seconds: wait is exactly 3000ms (header REPLACES the computed backoff)", async () => {
  const h = makeRecorded("rate-limit-sequences");
  const issue = await h.port.getIssue("1001");
  assert.equal(issue?.key, "SEQ-1001");
  assert.deepEqual(h.sleeper.waits, [3000], "one wait, straight from Retry-After: 3 — no jitter");
  assert.equal(h.transport.requests().length, 2, "one retry, then success");
});

test("429 + HTTP-date Retry-After is evaluated against the injected fake clock (12:00:00Z + 7s)", async () => {
  const h = makeRecorded("rate-limit-sequences");
  const issue = await h.port.getIssue("1002");
  assert.equal(issue?.key, "SEQ-1002");
  assert.deepEqual(h.sleeper.waits, [7000], "7s difference vs the fake clock — never Date.now()");
});

test("5xx twice then success: ≤ maxRetries+1 attempts, waits inside the equal-jitter envelope", async () => {
  const h = makeRecorded("rate-limit-sequences");
  const issue = await h.port.getIssue("1003");
  assert.equal(issue?.key, "SEQ-1003");
  assert.equal(h.transport.requests().filter((r) => r.operationName === "issue").length, 3);
  assert.equal(h.sleeper.waits.length, 2);
  const [w0, w1] = h.sleeper.waits;
  assert.ok(w0 !== undefined && w0 >= 125 && w0 <= 250, `attempt-0 wait ${String(w0)} ∈ [125,250]`);
  assert.ok(w1 !== undefined && w1 >= 250 && w1 <= 500, `attempt-1 wait ${String(w1)} ∈ [250,500]`);
});

test("network exhaustion ⇒ terminal TrackerError at attempts = maxRetries + 1, category network", async () => {
  const h = makeRecorded("rate-limit-sequences");
  await assert.rejects(
    h.port.getIssue("1004"),
    (e: unknown) => {
      assert.ok(e instanceof TrackerError);
      assert.equal(e.category, "network");
      assert.equal(e.attempts, 6, "maxRetries 5 + 1");
      assert.equal(e.retryable, true);
      return true;
    },
  );
  assert.equal(h.transport.requests().filter((r) => r.operationName === "issue").length, 6);
});

test("maxRetries: 0 override ⇒ a single attempt, no retry, same taxonomy", async () => {
  const transport = createRecordedTransport(scenarioDir("rate-limit-sequences"));
  const { port, sleeper } = makePort(transport, { config: { ...builtInDefaults, maxRetries: 0 } });
  await assert.rejects(
    port.getIssue("1005"),
    (e: unknown) => e instanceof TrackerError && e.attempts === 1 && e.category === "server",
  );
  assert.equal(transport.requests().length, 1, "one request, zero replay");
  assert.deepEqual(sleeper.waits, []);
});

test("create-failure scenario: 429/5xx/network on issueCreate ⇒ EXACTLY one request each, IndeterminateCreateError, never replayed", async () => {
  const transport = createRecordedTransport(scenarioDir("create-failure"));
  const { port, sleeper } = makePort(transport);
  const input = { teamKey: "acme-team", projectId: "proj-alpha", title: "Never replayed", description: "d" };
  let observed = 0;
  for (const kind of ["429", "5xx", "network"]) {
    await assert.rejects(
      port.createIssue(input),
      (e: unknown) => {
        assert.ok(e instanceof IndeterminateCreateError, kind);
        assert.equal(e.attempts, 1, `${kind}: create ⇒ exactly one request`);
        assert.equal(e.retryable, false);
        assert.match(e.detail, /indeterminate/i);
        return true;
      },
      kind,
    );
    observed += 1;
    assert.equal(
      transport.requests().filter((r) => r.operationName === "issueCreate").length,
      observed,
      `after ${kind} failure: exactly ${String(observed)} create request(s) issued — no replay`,
    );
  }
  assert.deepEqual(sleeper.waits, [], "creates never back off");
});

test("create discovery pre-resolution: unknown project identity is a pre-dispatch config error, NOT indeterminate", async () => {
  const transport = createRecordedTransport(scenarioDir("create-failure"));
  const { port } = makePort(transport);
  await assert.rejects(
    port.createIssue({ teamKey: "acme-team", projectId: "proj-ghost", title: "t", description: "d" }),
    (e: unknown) => e instanceof TrackerError && e.category === "config" && /proj-ghost/.test(e.detail),
  );
  assert.equal(transport.requests().filter((r) => r.operationName === "issueCreate").length, 0);
});

test("401 ⇒ auth category; the detail names the env-var NAME and the sanitizer strips the sentinel", async () => {
  const SENTINEL = "sentinel-credential-never-in-output-8f3a";
  const failing: HttpTransport = {
    async postJson(req: HttpRequest): Promise<HttpResponse> {
      assert.ok(req.accessToken.length > 0, "the client transmits SOME credential");
      return {
        status: 401,
        headers: {},
        body: { __rawText: `invalid token ${SENTINEL} presented for account sync@example.invalid` },
      };
    },
  };
  const { port } = makePort(failing, { env: sentinelEnv(SENTINEL) });
  await assert.rejects(
    port.getIssue("any"),
    (e: unknown) => {
      assert.ok(e instanceof TrackerError);
      assert.equal(e.category, "auth");
      assert.equal(e.attempts, 1, "auth is never retried");
      assert.match(e.detail, /LINEAR_ACCESS_TOKEN/, "names the env-var NAME");
      assert.ok(!e.message.includes(SENTINEL) && !e.detail.includes(SENTINEL), "the sentinel NEVER appears");
      return true;
    },
  );
});
