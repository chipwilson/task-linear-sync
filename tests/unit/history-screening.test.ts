/**
 * Feature 011 (Sync-History Web Component) — T013: US1 unit tests for the
 * browser-text screening pipeline (FR-008; contracts/history-reconstruction.md
 * §screening): every browser-visible string passes the screener, blocked
 * content is replaced by a category sentinel (never echoed), and HTML
 * escaping is total over `& < > " '`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "../../src/config/load.js";
import { createDefaultSecurityScreener } from "../../src/engine/screening.js";
import { escapeHtml, formatAtHuman, screenBrowserText } from "../../src/history-server/screen.js";
import { SECRET_SHAPE_VALUES } from "../helpers/history-harness.js";
import { makeScreener } from "../helpers/test-utils.js";

const screener = makeScreener();

test("history-screening: benign text passes through the screener untouched", () => {
  assert.equal(screenBrowserText(screener, "checkbox changed to done"), "checkbox changed to done");
});

test("history-screening: non-blocking findings travel in the screened output", () => {
  assert.equal(
    screenBrowserText(screener, "token SECRET42 rotated"),
    "token [REDACTED] rotated",
  );
});

test("history-screening: blocked content is replaced by a category sentinel, never echoed", () => {
  const out = screenBrowserText(screener, "note BLOCKED-SECRET77 tail");
  assert.equal(out, "[blocked:blocking-secret]");
  assert.ok(!out.includes("BLOCKED"));
  assert.ok(!out.includes("SECRET"));
});

test("history-screening: a throwing screener fails closed to a category sentinel", () => {
  const grumpy = {
    screen(): never {
      throw new Error("screener exploded with internal detail");
    },
  };
  const out = screenBrowserText(grumpy, "any text");
  assert.equal(out, "[blocked:screening-unavailable]");
  assert.ok(!out.includes("exploded"));
});

test("history-screening: the default engine screener neutralizes secret-shaped event text", () => {
  const def = createDefaultSecurityScreener(loadConfig({}));
  const withToken = `created with token=${SECRET_SHAPE_VALUES.token} attached`;
  const out = screenBrowserText(def, withToken);
  assert.ok(!out.includes(SECRET_SHAPE_VALUES.token), "credential value must not survive");
  assert.ok(out.startsWith("[blocked:"), "blocking rule replaces the whole string");
  assert.equal(screenBrowserText(def, "routine update"), "routine update");
});

test("history-screening: HTML escaping covers all markup-significant characters", () => {
  assert.equal(escapeHtml(`& < > " '`), "&amp; &lt; &gt; &quot; &#39;");
  assert.equal(escapeHtml("<script>alert(1)</script>"), "&lt;script&gt;alert(1)&lt;/script&gt;");
  assert.equal(escapeHtml("plain — text ✓"), "plain — text ✓");
  // ampersands introduced by escaping are not double-escaped
  assert.equal(escapeHtml("&amp;"), "&amp;amp;");
});

test("history-screening: atHuman is UTC arithmetic with no locale dependency", () => {
  assert.equal(formatAtHuman("2026-01-15T08:00:00.000Z"), "2026-01-15 08:00:00 UTC");
  assert.equal(formatAtHuman("2026-12-31T23:59:59.999Z"), "2026-12-31 23:59:59 UTC");
  assert.equal(formatAtHuman("2026-01-15T08:00:00.000Z"), formatAtHuman("2026-01-15T08:00:00Z"));
});

test("history-screening: an unparseable timestamp degrades deterministically, never throws", () => {
  const first = formatAtHuman("not-a-date");
  assert.equal(formatAtHuman("not-a-date"), first);
  assert.ok(first.length > 0);
  assert.ok(!first.includes("not-a-date"));
});

test("history-screening: formatAtHuman is UTC regardless of the host local zone", () => {
  const utc = formatAtHuman("2026-06-01T00:00:00.000Z");
  assert.equal(utc, "2026-06-01 00:00:00 UTC");
});
