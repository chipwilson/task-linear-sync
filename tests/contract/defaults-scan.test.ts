/**
 * T035 [US1] — release-scan contract test: the built-in default configuration contains
 * ZERO real organization identifiers, team keys, project keys, tokens, UUID values, or
 * credential values (constitution III; quickstart "release-scan" scenario). Only benign
 * example.invalid placeholders and generic framework directory names are allowed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { builtInDefaults, canonicalizeConfig } from "task-linear-sync/config";

/** Recursively collect every string/number leaf with its dot-path. */
function leaves(value: unknown, path: string, out: Array<{ path: string; value: unknown }>): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => leaves(v, `${path}[${i}]`, out));
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) leaves(v, path ? `${path}.${k}` : k, out);
    return;
  }
  out.push({ path, value });
}

const allLeaves: Array<{ path: string; value: unknown }> = [];
leaves(builtInDefaults, "", allLeaves);
const strings = allLeaves
  .filter((l) => typeof l.value === "string")
  .map((l) => ({ path: l.path, value: l.value as string }));

test("defaults scan — defaults contain no UUID values", () => {
  for (const s of strings) {
    assert.ok(
      !/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(s.value),
      `uuid-shaped value at ${s.path}`,
    );
  }
});

test("defaults scan — defaults contain no token or secret-shaped credential values (names only)", () => {
  for (const s of strings) {
    assert.ok(!/lin_api_[A-Za-z0-9]{12,}/.test(s.value), `token-shaped value at ${s.path}`);
    assert.ok(!/^[0-9a-f]{32,}$/i.test(s.value), `hex-secret-shaped value at ${s.path}`);
    assert.ok(!/^[A-Za-z0-9+/]{40,}={0,2}$/.test(s.value), `base64-secret-shaped value at ${s.path}`);
    assert.ok(!/-----BEGIN/.test(s.value), `PEM material at ${s.path}`);
  }
});

test("defaults scan — defaults contain no email or user-identity material", () => {
  for (const s of strings) {
    assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(s.value), `email at ${s.path}`);
  }
});

test("defaults scan — every host-bearing default is a benign example.invalid placeholder (zero org identifiers)", () => {
  const hosts = strings.filter((s) => s.value.includes("://"));
  assert.ok(hosts.length > 0, "template host defaults exist to scan");
  for (const s of hosts) {
    assert.ok(
      /\.example\.invalid(\/|$)/.test(s.value) || s.value.includes("localhost"),
      `non-benign host at ${s.path}: ${s.value}`,
    );
  }
});

test("defaults scan — no real team/project identity defaults — routing values are empty placeholders", () => {
  assert.deepEqual(builtInDefaults.teams, {});
  assert.deepEqual(builtInDefaults.projectByPath, []);
  assert.equal(builtInDefaults.defaultTeamKey, "");
  assert.equal(builtInDefaults.defaultProject, "");
});

test("defaults scan — framework directory defaults are the generic discovery names (never routing values)", () => {
  const specs = builtInDefaults.specsBaseDirectories;
  for (const expected of ["specs/", ".kiro/specs/", "openspec/", "bmad/"]) {
    assert.ok(specs.includes(expected), `generic default missing: ${expected}`);
  }
});

test("defaults scan — canonicalized defaults double-scan: the serialized form matches nothing org-shaped", () => {
  const raw = canonicalizeConfig(builtInDefaults);
  assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(raw));
  assert.ok(!/lin_api_[A-Za-z0-9]{12,}/.test(raw));
  assert.ok(!raw.includes("@"), `no email-ish material anywhere: found '@'`);
  for (const org of ["contoso", "acme", "globex", "initech"]) {
    assert.ok(!raw.toLowerCase().includes(org), `org-ish literal '${org}' present`);
  }
});
