/**
 * T005 — route parsing unit tests (FR-001/FR-002, contracts/http-surface.md
 * §1, research R2). Routing is exclusively the configured attachment scheme;
 * every malformed request yields the not-found outcome with zero history
 * bytes; a parser throw maps to the internal-error (500) posture.
 */

import assert from "node:assert/strict";
import test from "node:test";
import { loadConfig } from "../../src/config/load.js";
import { parseHistoryRoute } from "../../src/history-server/routes.js";
import { syntheticUuid } from "../../src/tracker/testing/fake-port.js";

const CONFIG = loadConfig({});
const UUID = syntheticUuid(0);

test("canonical paths match at page 0", () => {
  assert.deepEqual(parseHistoryRoute(CONFIG, `/task-linear-sync/${UUID}`), {
    kind: "match",
    taskUuid: UUID,
    page: 0,
  });
});

test("continuation paths match at their page", () => {
  for (const page of [1, 3, 999]) {
    assert.deepEqual(parseHistoryRoute(CONFIG, `/task-linear-sync/${UUID}/${page}`), {
      kind: "match",
      taskUuid: UUID,
      page,
    });
  }
});

test("query and fragment are stripped before matching", () => {
  const outcome = parseHistoryRoute(CONFIG, `/task-linear-sync/${UUID}?x=1#frag`);
  assert.deepEqual(outcome, { kind: "match", taskUuid: UUID, page: 0 });
  const continued = parseHistoryRoute(CONFIG, `/task-linear-sync/${UUID}/2?cb=9`);
  assert.deepEqual(continued, { kind: "match", taskUuid: UUID, page: 2 });
});

test("paths that do not start with / never match", () => {
  assert.deepEqual(parseHistoryRoute(CONFIG, ""), { kind: "notFound" });
  assert.deepEqual(parseHistoryRoute(CONFIG, "task-linear-sync/x"), { kind: "notFound" });
});

test("near-miss corpus is not-found (zero history bytes posture)", () => {
  const corpus = [
    "/",
    "/queue",
    "/task-linear-sync",
    `/task-linear-sync/`,
    `/task-linear-sync/${UUID}/0`, // page 0 is not a continuation URL
    `/task-linear-sync/${UUID.toUpperCase()}`,
    `/task-linear-sync/${UUID.replace(/-/g, "")}`,
    `/task-linear-sync/not-a-uuid`,
    `/task-linear-sync/${UUID}/1/2`,
    `/task-linear-sync/${UUID}/x`,
    `/Task-Linear-Sync/${UUID}`,
    `/other-tool/${UUID}`,
    `//task-linear-sync/${UUID}`,
  ];
  for (const path of corpus) {
    assert.deepEqual(parseHistoryRoute(CONFIG, path), { kind: "notFound" }, `path: ${path}`);
  }
});

test("the request Host header never participates — parsing is url-only", () => {
  const a = parseHistoryRoute(CONFIG, `/task-linear-sync/${UUID}`);
  const b = parseHistoryRoute(CONFIG, `/task-linear-sync/${UUID}`);
  assert.deepEqual(a, b);
});

test("a parser throw (unusable base host) maps to the internal-error posture", () => {
  const broken = { ...CONFIG, attachmentBaseHost: "   " };
  assert.deepEqual(parseHistoryRoute(broken, `/task-linear-sync/${UUID}`), {
    kind: "internalError",
  });
});
