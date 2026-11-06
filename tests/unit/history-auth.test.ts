/**
 * T023 — unit tests for access control (FR-008, contracts/access-control.md):
 * the 401/403 decision rules (challenge vs deny, never a downgrade), the
 * bearer compare, and the stateless HKDF/HMAC session cookie — round-trip,
 * tamper, expiry on the injected clock, and the no-token-substring rule.
 */

import assert from "node:assert/strict";
import { createHmac, hkdfSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  SESSION_TTL_SECONDS,
  createAccessGate,
  deriveSessionKey,
  historySessionCookieName,
  issueSessionCookieValue,
  verifySessionCookieValue,
} from "../../src/history-server/auth.js";
import { makeFixedClock } from "../helpers/history-harness.js";

const TOKEN = "gate-token-3f7d21";
const TOOL_ID = "task-linear-sync";
const ENV = { [`${TOOL_ID.toUpperCase().replace(/-/g, "_")}_WEB_TOKEN`]: TOKEN };

function privateGate() {
  return createAccessGate({
    accessMode: "private",
    tokenEnvVarName: `${TOOL_ID.toUpperCase().replace(/-/g, "_")}_WEB_TOKEN`,
    env: ENV,
    toolId: TOOL_ID,
    clock: makeFixedClock(),
  });
}

const COOKIE_NAME = `${TOOL_ID}-history`;

test("history-auth: missing credential ⇒ challenge; invalid credential ⇒ deny, never downgrade", () => {
  const gate = privateGate();

  assert.deepEqual(gate.authorize({}), { kind: "challenge" }, "no credential at all ⇒ 401");
  assert.deepEqual(gate.authorize({ cookie: "other=1" }), { kind: "challenge" });

  assert.deepEqual(gate.authorize({ authorization: "Bearer wrong-token" }), { kind: "deny" });
  // 014 bearer-parity.md §2: a non-Bearer scheme reads as NO credential ⇒ challenge.
  assert.deepEqual(gate.authorize({ authorization: "Token whatever" }), { kind: "challenge" });
  assert.deepEqual(gate.authorize({ authorization: "Basic whatever" }), { kind: "challenge" });
  assert.deepEqual(gate.authorize({ authorization: "Bearer" }), { kind: "challenge" });
  assert.deepEqual(gate.authorize({ cookie: `${COOKIE_NAME}=garbage` }), { kind: "deny" });
  assert.deepEqual(
    gate.authorize({ authorization: "Bearer wrong", cookie: `${COOKIE_NAME}=junk` }),
    { kind: "deny" },
    "an invalid credential must never fall through to a 401 challenge",
  );
});

test("history-auth: valid bearer and valid cookie both allow; bearer compare is exact", () => {
  const clock = makeFixedClock();
  const gate = createAccessGate({
    accessMode: "private",
    tokenEnvVarName: "TASK_LINEAR_SYNC_WEB_TOKEN",
    env: ENV,
    toolId: TOOL_ID,
    clock,
  });

  assert.deepEqual(gate.authorize({ authorization: `Bearer ${TOKEN}` }), { kind: "allow" });
  // 014 bearer-parity.md §1: canonical parser — whitespace-tolerant around the
  // capture and case-insensitive on the scheme, identical to the MCP gate.
  assert.deepEqual(gate.authorize({ authorization: `Bearer ${TOKEN} ` }), { kind: "allow" });
  assert.deepEqual(gate.authorize({ authorization: `  bearer ${TOKEN}` }), { kind: "allow" });
  assert.deepEqual(gate.authorize({ authorization: `BEARER ${TOKEN}` }), { kind: "allow" });
  assert.deepEqual(gate.authorize({ authorization: `Bearer ${TOKEN.slice(0, 10)}` }), { kind: "deny" });

  const cookie = issueSessionCookieValue({ token: TOKEN, toolId: TOOL_ID, clock });
  assert.deepEqual(gate.authorize({ cookie: `${COOKIE_NAME}=${cookie}` }), { kind: "allow" });
});

test("history-auth: SESSION_TTL_SECONDS is the frozen 3600-second constant", () => {
  assert.equal(SESSION_TTL_SECONDS, 3600);
});

test("history-auth: cookie round-trip validates against the injected clock up to the expiry instant", () => {
  const clock = makeFixedClock();
  const value = issueSessionCookieValue({ token: TOKEN, toolId: TOOL_ID, clock });

  assert.equal(verifySessionCookieValue({ token: TOKEN, toolId: TOOL_ID, clock, value }), true);

  clock.advance((SESSION_TTL_SECONDS - 1) * 1000);
  assert.equal(verifySessionCookieValue({ token: TOKEN, toolId: TOOL_ID, clock, value }), true);

  clock.advance(1_000); // now === exp: the expiry instant itself is already expired
  assert.equal(
    verifySessionCookieValue({ token: TOKEN, toolId: TOOL_ID, clock, value }),
    false,
    "expired ⇒ rejected, never silently re-issued",
  );
});

test("history-auth: tampered payload or tag is rejected; the cookie carries no token substring", () => {
  const clock = makeFixedClock();
  const value = issueSessionCookieValue({ token: TOKEN, toolId: TOOL_ID, clock });
  const [payload, tag] = value.split(".") as [string, string];

  assert.equal(payload !== undefined && payload.includes(TOKEN), false, "no token substring");
  assert.equal(value.includes(TOKEN), false);
  assert.equal(tag !== undefined && tag.includes(TOKEN), false);

  const flip = (s: string): string =>
    (s[0] === "A" ? "B" : "A") + s.slice(1);

  assert.equal(
    verifySessionCookieValue({
      token: TOKEN,
      toolId: TOOL_ID,
      clock,
      value: `${flip(payload!)}.${tag!}`,
    }),
    false,
    "tampered payload",
  );
  assert.equal(
    verifySessionCookieValue({
      token: TOKEN,
      toolId: TOOL_ID,
      clock,
      value: `${payload}.${flip(tag!)}`,
    }),
    false,
    "tampered tag",
  );
  for (const junk of ["", "abc", ".", "a.b.c", `${payload}.`, `${COOKIE_NAME}`]) {
    assert.equal(
      verifySessionCookieValue({ token: TOKEN, toolId: TOOL_ID, clock, value: junk }),
      false,
      `junk cookie ${JSON.stringify(junk)} rejected`,
    );
  }

  // A different token's key cannot mint or validate a session.
  assert.equal(
    verifySessionCookieValue({ token: "other-token", toolId: TOOL_ID, clock, value }),
    false,
  );
  const other = issueSessionCookieValue({ token: "other-token", toolId: TOOL_ID, clock });
  assert.equal(verifySessionCookieValue({ token: TOKEN, toolId: TOOL_ID, clock, value: other }), false);
});

test("history-auth: the payload is the base64url expiry and the tag is an HMAC under the HKDF key", () => {
  const clock = makeFixedClock();
  const value = issueSessionCookieValue({ token: TOKEN, toolId: TOOL_ID, clock });
  const [payloadB64, tagB64] = value.split(".") as [string, string];

  const payload = JSON.parse(Buffer.from(payloadB64!, "base64url").toString("utf8")) as {
    exp: number;
  };
  const nowSeconds = Math.floor(clock.now().getTime() / 1000);
  assert.equal(payload.exp, nowSeconds + SESSION_TTL_SECONDS);
  assert.match(payloadB64!, /^[A-Za-z0-9_-]+$/);
  assert.match(tagB64!, /^[A-Za-z0-9_-]+$/);

  // Recompute independently of the implementation: K = hkdfSync(sha256,
  // ikm = token, salt = toolId, info = "history-session-v1", 32 bytes),
  // tag = HMAC-SHA256(K, payload).
  const rawKey = hkdfSync(
    "sha256",
    Buffer.from(TOKEN, "utf8"),
    Buffer.from(TOOL_ID, "utf8"),
    Buffer.from("history-session-v1", "utf8"),
    32,
  );
  assert.deepEqual(Buffer.from(rawKey), deriveSessionKey(TOKEN, TOOL_ID));
  const key = deriveSessionKey(TOKEN, TOOL_ID);
  assert.equal(key.length, 32);
  const expected = createHmac("sha256", Buffer.from(rawKey)).update(payloadB64!, "utf8").digest("base64url");
  assert.equal(tagB64, expected, "tag is the HMAC of the payload under the derived key");
  assert.notDeepEqual(Buffer.compare(key, Buffer.from(TOKEN)), 0);
});

test("history-auth: cookie name derives from the toolId", () => {
  assert.equal(historySessionCookieName("task-linear-sync"), "task-linear-sync-history");
  assert.equal(historySessionCookieName("other-tool"), "other-tool-history");
});

test("history-auth: public mode ignores credentials entirely", () => {
  const gate = createAccessGate({
    accessMode: "public",
    tokenEnvVarName: "TASK_LINEAR_SYNC_WEB_TOKEN",
    env: ENV,
    toolId: TOOL_ID,
    clock: makeFixedClock(),
  });
  for (const headers of [
    {},
    { authorization: "Bearer wrong" },
    { authorization: `Bearer ${TOKEN}` },
    { cookie: `${COOKIE_NAME}=junk` },
  ]) {
    assert.deepEqual(gate.authorize(headers), { kind: "allow" });
  }
});

test("history-auth: the bearer compare uses timingSafeEqual (source-level posture)", () => {
  const source = readFileSync(
    fileURLToPath(new URL("../../../src/history-server/auth.ts", import.meta.url)),
    "utf8",
  );
  assert.match(source, /timingSafeEqual/, "constant-time credential compare");
});
