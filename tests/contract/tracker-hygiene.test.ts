/**
 * T046 [P] — corpus/source hygiene scan (release gate: "fails the release — publishing
 * nothing — if any real organization identifier, token, or UUID value is detected"). Walks
 * every fixture under `tests/fixtures/tracker/**` plus the shipped `src/tracker` sources:
 * no credential-header keys (authorization/cookie…), no `lin_api_`-shaped values, no email
 * shapes, no non-synthetic UUIDs, and every identity must come from the placeholder allow-list
 * (`acme-team`/`ACM-`, `proj-*`, `*.example.invalid`, synthetic `ac000000-…` uuids).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.name.endsWith(".json") || e.name.endsWith(".ts")) yield p;
  }
}

const SYNTHETIC_UUID = /^ac000000-0000-4000-8000-\d{12}$/;
const UUID_SHAPE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const BANNED: ReadonlyArray<readonly [RegExp, string]> = [
  [/lin_api_[A-Za-z0-9]+/, "lin_api_-shaped token value"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/, "email-shaped value"],
  [/(authorization|proxy-authorization|cookie|x-api-key)\s*["']?\s*[:=]/i, "credential-header key"],
];

test("recorded fixtures carry no credentials, emails, or non-synthetic UUIDs", () => {
  const violations: string[] = [];
  for (const file of walk(join(pkgRoot, "tests", "fixtures", "tracker"))) {
    if (!file.endsWith(".json")) continue;
    const text = readFileSync(file, "utf8");
    for (const [pattern, label] of BANNED) {
      if (pattern.test(text)) violations.push(`${file.slice(pkgRoot.length)}: ${label}`);
    }
    const doc = JSON.parse(text) as unknown;
    // Header names in pairs are first-class fixture data — only benign ones may appear.
    for (const key of headerKeys(doc)) {
      if (!["retry-after", "content-type"].includes(key.toLowerCase())) violations.push(`${file.slice(pkgRoot.length)}: header '${key}'`);
    }
    for (const value of stringValues(doc)) {
      for (const m of value.matchAll(new RegExp(UUID_SHAPE, "gi"))) {
        if (!SYNTHETIC_UUID.test(m[0])) violations.push(`${file.slice(pkgRoot.length)}: non-synthetic UUID '${m[0]}'`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

test("placeholder identities only in fixture texts", () => {
  const PLACEHOLDER_TEAMS = new Set(["acme-team", "globex-team", "initech-team"]);
  const REAL_ORG = /\b(github|gitlab|atlassian|jira|trello|asana|monday\.com|notion\.so|height\.app|clickup)\b/i;
  const offenders: string[] = [];
  for (const file of walk(join(pkgRoot, "tests", "fixtures", "tracker"))) {
    if (!file.endsWith(".json")) continue;
    const doc = JSON.parse(readFileSync(file, "utf8")) as unknown;
    for (const value of stringValues(doc)) {
      if (REAL_ORG.test(value)) offenders.push(`${file.slice(pkgRoot.length)}: real-org identifier '${value.slice(0, 60)}'`);
      if (/-team$/.test(value) && !PLACEHOLDER_TEAMS.has(value) && !value.includes("${")) {
        offenders.push(`${file.slice(pkgRoot.length)}: non-placeholder team identity '${value.slice(0, 60)}'`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test("shipped src/tracker constants stay placeholder-clean (tokens/emails/non-synthetic UUIDs)", () => {
  const violations: string[] = [];
  const srcBanned: ReadonlyArray<readonly [RegExp, string]> = [BANNED[0], BANNED[1]];
  for (const file of walk(join(pkgRoot, "src", "tracker"))) {
    if (!file.endsWith(".ts")) continue;
    const text = readFileSync(file, "utf8");
    for (const [pattern, label] of srcBanned) {
      const hit = text.match(pattern);
      if (hit) violations.push(`${file.slice(pkgRoot.length)}: ${label} → '${hit[0].slice(0, 40)}'`);
    }
    for (const m of text.matchAll(new RegExp(UUID_SHAPE, "gi"))) {
      if (!SYNTHETIC_UUID.test(m[0]) && !/^ac000000-0000-4000-8000-/.test(m[0])) {
        violations.push(`${file.slice(pkgRoot.length)}: non-synthetic UUID '${m[0]}'`);
      }
    }
  }
  assert.deepEqual(violations, []);
});

function* stringValues(node: unknown): Generator<string> {
  if (typeof node === "string") yield node;
  else if (Array.isArray(node)) for (const item of node) yield* stringValues(item);
  else if (node !== null && typeof node === "object") for (const value of Object.values(node)) yield* stringValues(value);
}

function* headerKeys(node: unknown): Generator<string> {
  if (node !== null && typeof node === "object") {
    const record = node as Record<string, unknown>;
    if (("headers" in record) && record.headers !== null && typeof record.headers === "object") {
      yield* Object.keys(record.headers as Record<string, unknown>);
    }
    for (const value of Object.values(record)) yield* headerKeys(value);
  }
}
