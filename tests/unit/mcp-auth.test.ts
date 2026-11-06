/**
 * T054 [US3] — unit: the bearer verdict gate (transport-auth.md §2.2, FR-004/FR-005).
 * Pure-function coverage of checkBearerAuth + the closed HTTP_REFUSALS set.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { checkBearerAuth, HTTP_REFUSALS } from "../../src/mcp/auth.js";

const TOKEN = "unit-gate-token-012";

test("auth: valid bearer credentials pass, scheme name case-insensitive, value trimmed", () => {
  assert.equal(checkBearerAuth(`Bearer ${TOKEN}`, TOKEN), "ok");
  assert.equal(checkBearerAuth(`bearer ${TOKEN}`, TOKEN), "ok");
  assert.equal(checkBearerAuth(`BEARER ${TOKEN}`, TOKEN), "ok");
  assert.equal(checkBearerAuth(`  Bearer   ${TOKEN}  `, TOKEN), "ok");
});

test("auth: absent or non-Bearer credentials are verdict missing (⇒ 401)", () => {
  assert.equal(checkBearerAuth(undefined, TOKEN), "missing");
  assert.equal(checkBearerAuth("", TOKEN), "missing");
  assert.equal(checkBearerAuth("Basic dXNlcjpwdw==", TOKEN), "missing");
  assert.equal(checkBearerAuth("token abc", TOKEN), "missing");
  assert.equal(checkBearerAuth("Bearer", TOKEN), "missing"); // scheme with no credential
});

test("auth: wrong credentials are verdict mismatch (⇒ 403) — never a leak of WHY", () => {
  assert.equal(checkBearerAuth(`Bearer ${TOKEN}x`, TOKEN), "mismatch"); // longer (length guard)
  assert.equal(checkBearerAuth(`Bearer ${TOKEN.slice(0, -1)}`, TOKEN), "mismatch"); // shorter
  assert.equal(checkBearerAuth(`Bearer ${TOKEN.slice(0, -1)}Z`, TOKEN), "mismatch"); // equal length, differs
  assert.equal(checkBearerAuth(`Bearer ${TOKEN.toUpperCase()}`, TOKEN), "mismatch"); // case-sensitive value
});

test("auth: the refusal set is closed, constant, and credential-free", () => {
  const codes = Object.keys(HTTP_REFUSALS).sort();
  assert.deepEqual(codes, [
    "FORBIDDEN",
    "INTERNAL",
    "METHOD_NOT_ALLOWED",
    "NOT_FOUND",
    "PAYLOAD_TOO_LARGE",
    "UNAUTHORIZED",
  ]);
  for (const [code, refusal] of Object.entries(HTTP_REFUSALS)) {
    assert.equal(refusal.body, `{"error":"${code}"}`, `${code} ships its own constant`);
    assert.equal(refusal.body.includes(TOKEN.toLowerCase()), false);
  }
  assert.deepEqual(
    { status: HTTP_REFUSALS.UNAUTHORIZED.status, header: HTTP_REFUSALS.UNAUTHORIZED.header },
    { status: 401, header: "www-authenticate" },
  );
});
