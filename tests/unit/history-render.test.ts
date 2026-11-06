/**
 * Feature 011 (Sync-History Web Component) — T012: US1 unit tests for
 * rendering (FR-003; contracts/http-surface.md §3): byte-stable JSON views,
 * fully escaped server-rendered HTML with the inline refresh bootstrap,
 * identical row shape for every event kind, and error envelopes rendered
 * from the fixed constants per negotiated type.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { ERROR_ENVELOPES, type ErrorEnvelope } from "../../src/history-server/errors.js";
import {
  SECURITY_HEADERS,
  errorAsHtml,
  errorAsJson,
  errorAsSseFrame,
  historyFrame,
  negotiateFormat,
  viewAsHtml,
  viewAsJson,
} from "../../src/history-server/render.js";
import type { HistoryPageView } from "../../src/history-server/types.js";

function makeView(overrides: Partial<HistoryPageView> = {}): HistoryPageView {
  return {
    taskUuid: "ac000000-0000-4000-8000-000000000001",
    events: [
      {
        at: "2026-01-15T08:00:00.000Z",
        atHuman: "2026-01-15 08:00:00 UTC",
        kind: "matched",
        description: "routine update",
        references: ["op-1"],
      },
      {
        at: "2026-01-15T09:00:00.000Z",
        atHuman: "2026-01-15 09:00:00 UTC",
        kind: "rollback",
        description: "zzz <i>bold & \"quote\" 'single'",
        references: null,
      },
    ],
    pages: [
      { index: 0, eventCount: 1 },
      { index: 1, eventCount: 1 },
    ],
    lastSyncAt: "2026-01-15T08:00:00.000Z",
    generatedAt: "2026-02-01T10:00:00.000Z",
    ...overrides,
  };
}

test("history-render: viewAsJson is byte-identical for identical chain state (stable key order)", () => {
  const view = makeView();
  const json = viewAsJson(view);
  assert.equal(json, viewAsJson(makeView()));
  const parsed = JSON.parse(json) as Record<string, unknown>;
  assert.deepEqual(Object.keys(parsed), [
    "taskUuid",
    "events",
    "pages",
    "lastSyncAt",
    "generatedAt",
  ]);
  const first = (parsed.events as Array<Record<string, unknown>>)[0]!;
  assert.deepEqual(Object.keys(first), ["at", "atHuman", "kind", "description", "references"]);
});

test("history-render: viewAsJson keeps null references as null", () => {
  const parsed = JSON.parse(viewAsJson(makeView())) as {
    events: Array<{ references: unknown }>;
  };
  assert.equal(parsed.events[1]!.references, null);
  assert.deepEqual(parsed.events[0]!.references, ["op-1"]);
});

test("history-render: viewAsHtml escapes every markup-significant character in string fields", () => {
  const html = viewAsHtml(makeView(), { refreshSeconds: 15 });
  assert.ok(
    html.includes("zzz &lt;i&gt;bold &amp; &quot;quote&quot; &#39;single&#39;"),
    "description fully escaped",
  );
  assert.ok(!html.includes("<i>bold"), "no raw markup from event text");
});

test("history-render: viewAsHtml renders the complete chronological list, uniform row shape", () => {
  const html = viewAsHtml(makeView(), { refreshSeconds: 15 });
  assert.match(html, /<!doctype html>/i);
  assert.equal(html.split('class="history-event"').length - 1, 2, "one row per event");
  assert.ok(html.includes('data-kind="rollback"'), "rollback is a row like any other");
  assert.ok(html.includes("2026-01-15 08:00:00 UTC"), "human timestamps shown");
  assert.ok(html.indexOf("routine update") < html.indexOf("zzz &lt;i&gt;"), "chronological order");
  assert.ok(html.includes("2 events"), "event count");
});

test("history-render: viewAsHtml embeds the refresh bootstrap and upgrade script", () => {
  const html = viewAsHtml(makeView(), { refreshSeconds: 23 });
  assert.ok(html.includes('id="history-bootstrap"'), "bootstrap block present");
  assert.ok(html.includes('"refreshSeconds":23'), "refresh cadence embedded");
  assert.ok(html.includes(makeView().taskUuid), "task uuid embedded");
  assert.match(html, /<script[\s\S]*setInterval/, "inline script refreshes without JS data");
});

test("history-render: viewAsHtml renders an empty history as a complete story, not an error", () => {
  const html = viewAsHtml(makeView({ events: [], pages: [{ index: 0, eventCount: 0 }] }), {
    refreshSeconds: 15,
  });
  assert.match(html, /no sync history recorded yet/i);
  assert.ok(!/error|not found|unavailable/i.test(html.slice(0, 1000).replace(/history/gi, "")));
});

test("history-render: negotiateFormat implements the §3 matrix", () => {
  assert.equal(negotiateFormat("text/event-stream", true), "sse");
  assert.equal(negotiateFormat("text/event-stream;q=0.9", true), "sse");
  assert.equal(negotiateFormat("text/event-stream", false), "html", "degrades to HTML posture");
  assert.equal(negotiateFormat("application/json", true), "json");
  assert.equal(negotiateFormat("application/json, text/html;q=0.9", false), "json");
  assert.equal(negotiateFormat("text/html,application/xhtml+xml", true), "html");
  assert.equal(negotiateFormat("*/*", true), "html");
  assert.equal(negotiateFormat(undefined, true), "html");
  assert.equal(negotiateFormat("", true), "html");
});

test("history-render: SECURITY_HEADERS match http-surface §5 exactly", () => {
  assert.equal(SECURITY_HEADERS["Cache-Control"], "no-store");
  assert.equal(SECURITY_HEADERS["X-Content-Type-Options"], "nosniff");
  assert.equal(
    SECURITY_HEADERS["Content-Security-Policy"],
    "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
  );
});

test("history-render: error envelopes render per negotiated type from the constants only", () => {
  const envelope: ErrorEnvelope = ERROR_ENVELOPES.NOT_FOUND;
  assert.deepEqual(JSON.parse(errorAsJson(envelope)), {
    error: { code: "NOT_FOUND", message: envelope.message },
  });
  const html = errorAsHtml(envelope);
  assert.match(html, /<!doctype html>/i);
  assert.ok(html.includes(envelope.message));
  assert.ok(!html.includes('class="history-event"'), "error shells carry no history markup");
  for (const code of Object.keys(ERROR_ENVELOPES) as Array<keyof typeof ERROR_ENVELOPES>) {
    const fixed = ERROR_ENVELOPES[code];
    assert.deepEqual(JSON.parse(errorAsJson(fixed)), {
      error: { code: fixed.code, message: fixed.message },
    });
  }
});

test("history-render: SSE frames have the exact wire shape", () => {
  assert.equal(historyFrame(`{"x":1}`), "event: history\ndata: {\"x\":1}\n\n");
  const frame = errorAsSseFrame(ERROR_ENVELOPES.TRACKER_UNAVAILABLE);
  assert.ok(frame.startsWith("event: error\ndata: "));
  assert.ok(frame.endsWith("\n\n"));
  assert.deepEqual(JSON.parse(frame.slice("event: error\ndata: ".length).trim()), {
    error: {
      code: "TRACKER_UNAVAILABLE",
      message: ERROR_ENVELOPES.TRACKER_UNAVAILABLE.message,
    },
  });
});
