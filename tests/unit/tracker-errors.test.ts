/**
 * T005 [P] — error-taxonomy unit tests (data-model.md §5, research R12).
 * TrackerError shape with exactly the 10-category union; IndeterminateCreateError honors the
 * constitution ("a failed create is recorded as indeterminate and reconciled, not replayed");
 * TrackerConfigError details name env-var NAMES / config keys only; sanitizer strip-list.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  TrackerError,
  TrackerConfigError,
  IndeterminateCreateError,
  isTrackerError,
  isNotImplemented,
  notImplemented,
  createSanitizer,
  type TrackerErrorCategory,
} from "task-linear-sync/tracker";

const CATEGORIES: readonly TrackerErrorCategory[] = [
  "config",
  "auth",
  "rate-limit",
  "server",
  "network",
  "timeout",
  "not-found",
  "client",
  "graphql",
  "create-indeterminate",
];

test("errors: TrackerError carries exactly the { category, retryable, attempts, httpStatus?, detail } shape", () => {
  const e = new TrackerError({
    category: "server",
    retryable: true,
    attempts: 3,
    httpStatus: 502,
    detail: "bad gateway",
  });
  assert.equal(e.category, "server");
  assert.equal(e.retryable, true);
  assert.equal(e.attempts, 3);
  assert.equal(e.httpStatus, 502);
  assert.equal(e.detail, "bad gateway");
  assert.ok(e instanceof Error);
  assert.match(e.message, /server/);
  assert.match(e.message, /bad gateway/);
  const optional = new TrackerError({ category: "network", retryable: true, attempts: 6, detail: "socket reset" });
  assert.equal(optional.httpStatus, undefined);
});

test("errors: the category union is exactly the 10 frozen categories", () => {
  // Compile-time exhaustiveness — adding/removing a union member fails to typecheck:
  const exhaustive: Record<TrackerErrorCategory, true> = {
    config: true,
    auth: true,
    "rate-limit": true,
    server: true,
    network: true,
    timeout: true,
    "not-found": true,
    client: true,
    graphql: true,
    "create-indeterminate": true,
  };
  assert.equal(CATEGORIES.length, 10);
  for (const c of CATEGORIES) assert.equal(exhaustive[c], true);
  assert.equal(Object.keys(exhaustive).length, 10);
});

test("errors: IndeterminateCreateError is create-indeterminate, never retryable, attempts 1 — not replayed", () => {
  const e = new IndeterminateCreateError({ detail: "upstream 502 after dispatch" });
  assert.equal(e.category, "create-indeterminate");
  assert.equal(e.retryable, false);
  assert.equal(e.attempts, 1);
  assert.ok(e instanceof TrackerError);
  assert.ok(isTrackerError(e));
  const withStatus = new IndeterminateCreateError({ detail: "429 after dispatch", httpStatus: 429 });
  assert.equal(withStatus.httpStatus, 429);
  assert.equal(withStatus.attempts, 1);
});

test("errors: TrackerConfigError is config-category, non-retryable, zero requests (attempts 0)", () => {
  const e = new TrackerConfigError(
    "credential environment variable 'LINEAR_ACCESS_TOKEN' is unset or empty",
  );
  assert.equal(e.category, "config");
  assert.equal(e.retryable, false);
  assert.equal(e.attempts, 0);
  assert.ok(e instanceof TrackerError);
  assert.match(e.detail, /LINEAR_ACCESS_TOKEN/);
});

test("errors: placeholder members signal 'not-implemented' via a config TrackerError", () => {
  const e = notImplemented("listIssues");
  assert.ok(isNotImplemented(e));
  assert.equal(e.category, "config");
  assert.match(e.detail, /^not-implemented: listIssues$/);
  assert.equal(isNotImplemented(new TrackerConfigError("some other config problem")), false);
  assert.equal(isNotImplemented(new Error("plain")), false);
});

test("errors: sanitizer strips the planted sentinel from arbitrary strings", () => {
  const sanitize = createSanitizer(["SENTINEL-9f3a-token"]);
  assert.equal(sanitize("header SENTINEL-9f3a-token tail"), "header [REDACTED] tail");
  assert.equal(sanitize("SENTINEL-9f3a-token SENTINEL-9f3a-token"), "[REDACTED] [REDACTED]");
  assert.equal(sanitize("clean text stays"), "clean text stays");
  assert.equal(createSanitizer([])("keeps SENTINEL-9f3a-token"), "keeps SENTINEL-9f3a-token");
  assert.equal(createSanitizer([""])("unchanged"), "unchanged");
});
