/**
 * T047 [P] — credential-sentinel security sweep (resilience contract §5; constitution:
 * credentials "MUST NEVER appear in diagnostics, logs, reports, web responses, or MCP
 * outputs"). A unique sentinel is planted as the env token value AND echoed by hostile
 * transports inside raw bodies/error messages; the FULL failure matrix is driven
 * (401/403/404/429-exhaustion/5xx-exhaustion/network/graphql-200-errors/FixtureMiss-equivalent
 * + never-retried create). Every captured `TrackerError` (message/detail/stack), every
 * thrown-message tree, and every diagnostic must be sentinel-free.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { builtInDefaults } from "task-linear-sync/config";
import {
  createLinearPort,
  TrackerError,
  type HttpTransport,
  type HttpRequest,
  type HttpResponse,
  type TrackerDiagnostic,
} from "task-linear-sync/tracker";
import { createRecordedTransport } from "task-linear-sync/tracker/testing";
import { FakeClock, FakeSleeper, scenarioDir, sentinelEnv, splitmixRng } from "../helpers/tracker-harness.js";

const SENTINEL = "sentinel-DoNotLeak-9e7c41f2b0";

function hostileBody(context: string): Record<string, unknown> {
  // A hostile/greedy server that echoes the request context — if ANY path forwards raw
  // server text unsanitized while it carries the credential, the sweep trips.
  return { __rawText: `${context} — credential presented: ${SENTINEL}` };
}

function scriptedTransport(script: (req: HttpRequest, call: number) => HttpResponse | Error): HttpTransport {
  let calls = 0;
  return {
    async postJson(req: HttpRequest): Promise<HttpResponse> {
      calls += 1;
      const step = script(req, calls);
      if (step instanceof Error) throw step;
      return step;
    },
  };
}

function makePort(transport: HttpTransport) {
  const diagnostics: TrackerDiagnostic[] = [];
  const sleeper = new FakeSleeper();
  const port = createLinearPort({
    config: builtInDefaults,
    options: {
      transport,
      env: sentinelEnv(SENTINEL),
      clock: new FakeClock("2026-10-23T12:00:00.000Z"),
      rng: splitmixRng(3),
      sleep: sleeper.sleep,
      diagnostics: (d) => diagnostics.push(d),
    },
  });
  return { port, diagnostics };
}

function* stringTree(node: unknown, key = "root"): Generator<[string, string]> {
  if (typeof node === "string") yield [key, node];
  else if (node instanceof Error) {
    yield [`${key}.name`, node.name];
    yield [`${key}.message`, node.message];
    if (node.stack) yield [`${key}.stack`, node.stack];
    const e = node as Error & Record<string, unknown>;
    for (const k of ["detail", "cause"]) {
      if (k in e) yield* stringTree(e[k], `${key}.${k}`);
    }
  } else if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) yield* stringTree(item, `${key}[${String(i)}]`);
  } else if (node !== null && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) yield* stringTree(v, `${key}.${k}`);
  }
}

function assertSentinelFree(label: string, caught: unknown, diagnostics: readonly TrackerDiagnostic[]): void {
  for (const [path, text] of stringTree(caught)) {
    assert.ok(!text.includes(SENTINEL), `${label}: sentinel leaked in ${path}: '${text.slice(0, 120)}'`);
  }
  for (const d of diagnostics) {
    assert.ok(!d.message.includes(SENTINEL), `${label}: sentinel leaked in diagnostic '${d.message}'`);
  }
}

async function drive(label: string, transport: HttpTransport, act: (port: ReturnType<typeof createLinearPort>) => Promise<unknown>): Promise<void> {
  const { port, diagnostics } = makePort(transport);
  try {
    await act(port);
  } catch (e) {
    assertSentinelFree(label, e, diagnostics);
    if (e instanceof TrackerError) {
      assert.ok(e.detail.length > 0, `${label}: errors always carry a (sanitized) detail`);
      assertSentinelFree(`${label}/rethrown`, new Error(e.message), diagnostics);
    }
    return;
  }
  assertSentinelFree(label, null, diagnostics);
}

test("401 / 403 auth failures sanitize the echoed credential", async () => {
  for (const status of [401, 403]) {
    await drive(`http-${String(status)}`, scriptedTransport(() => ({ status, headers: {}, body: hostileBody(`token ${SENTINEL} rejected`) })), (p) => p.getIssue("x"));
  }
});

test("404 with hostile body (getIssue null-path and update error-path)", async () => {
  await drive("404-get", scriptedTransport(() => ({ status: 404, headers: {}, body: hostileBody("not found") })), (p) => p.getIssue("x"));
  await drive("404-update", scriptedTransport(() => ({ status: 404, headers: {}, body: hostileBody("no such issue") })), (p) => p.updateIssue("x", { title: "t" }));
});

test("429 exhaustion + Retry-After (waits can smuggle nothing)", async () => {
  await drive(
    "429-exhaust",
    scriptedTransport((_req, call): HttpResponse | Error =>
      call <= 6
        ? { status: 429, headers: { "retry-after": "3", "x-debug-token": SENTINEL }, body: hostileBody("slow down") }
        : { status: 200, headers: {}, body: { data: { issue: null } } }),
    (p) => p.getIssue("x"),
  );
});

test("5xx exhaustion and synthetic network errors whose MESSAGE carries the sentinel", async () => {
  await drive("5xx-exhaust", scriptedTransport(() => ({ status: 503, headers: {}, body: hostileBody("upstream") })), (p) => p.getIssue("x"));
  await drive("network", scriptedTransport(() => new Error(`ECONNRESET after sending header Authorization: bearer ${SENTINEL}`)), (p) => p.listAttachments("y"));
});

test("HTTP 200 + GraphQL errors[] echoing the credential", async () => {
  await drive("graphql-errors", scriptedTransport(() => ({ status: 200, headers: {}, body: { errors: [{ message: `invalid input for token ${SENTINEL}` }] } })), (p) => p.listIssues({ teamKeys: ["acme-team"], perTeam: { "acme-team": { projects: ["proj-alpha"], ignoredStateTypes: [] } }, pageSize: 2 } as never).next());
});

test("never-retried create failure (indeterminate) sanitizes both the echo and the detail", async () => {
  await drive("create-5xx", scriptedTransport(() => ({ status: 500, headers: {}, body: hostileBody("create failed") })), (p) =>
    p.createIssue({ teamKey: "acme-team", projectId: "proj-alpha", title: "t", description: "d" }));
});

test("the pre-preflight rejection names env-var NAMES only — the sentinel value never appears", async () => {
  let caught: unknown = null;
  try {
    createLinearPort({ config: builtInDefaults, options: { transport: scriptedTransport(() => ({ status: 200, headers: {}, body: {} })), env: {} } });
  } catch (e) {
    caught = e;
  }
  assert.ok(caught instanceof TrackerError);
  assert.match((caught as TrackerError).detail, /LINEAR_ACCESS_TOKEN/);
  assert.ok(!String((caught as Error).message).includes(SENTINEL));
});

test("FixtureMiss from the recorded driver carries only op/variables (no auth context)", async () => {
  const transport = createRecordedTransport(scenarioDir("adversarial-descriptions"));
  const { port, diagnostics } = makePort(transport);
  await assert.rejects(port.updateAttachment("att-ghost", { x: 1 }));
  const log = transport.requests();
  const serialized = JSON.stringify(log.map((r) => ({ op: r.operationName, vars: r.variables, status: r.status })));
  assert.ok(!serialized.includes(SENTINEL), "the recorded request log never carries credentials");
  for (const [, text] of stringTree(log)) assert.ok(!text.includes(SENTINEL));
  assert.ok(diagnostics.length >= 0);
});
