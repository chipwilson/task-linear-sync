/**
 * T035 [P] — CLI hygiene release scan (plan.md constraints; mirrors the posture of
 * `engine-hygiene.test.ts` / `engine-no-direct-tracker.test.ts` for the 009 surface):
 *  1. read-only lane import scan — `src/cli/commands/{plan,inventory,discover-metadata}.ts`
 *     never reference `applySyncPlan`, `rollbackRun`, or construct `GateRequest`
 *     (engine-gates §4 mirrored at the module boundary);
 *  2. no direct `node:http`/`node:https`/GraphQL imports and no `src/tracker/`-internals
 *     imports from `src/cli/**` (only the frozen `tracker` barrel factory is sanctioned);
 *  3. zero-org-literal scan over `src/cli/**`, `tests/fixtures/cli/**`, and `docs/cli.md`
 *     — token/PEM/credential-header/email shapes, real-org identifiers, non-placeholder
 *     UUIDs, and non-benign hosts all fail; only benign placeholders pass.
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
    else yield p;
  }
}

test("cli-hygiene — read-only lane commands never reach the apply/rollback/gate surface", () => {
  const lanes = ["plan.ts", "inventory.ts", "discover-metadata.ts"];
  for (const lane of lanes) {
    const text = readFileSync(join(pkgRoot, "src", "cli", "commands", lane), "utf8");
    for (const forbidden of ["applySyncPlan", "rollbackRun", "GateRequest"]) {
      assert.ok(!text.includes(forbidden), `src/cli/commands/${lane} references ${forbidden}`);
    }
  }
});

test("cli-hygiene — src/cli imports no HTTP/GraphQL directly and no tracker internals", () => {
  const files = [...walk(join(pkgRoot, "src", "cli"))].filter((f) => f.endsWith(".ts"));
  assert.ok(files.length >= 10, "sanity: the cli sources are really scanned");
  const violations: string[] = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const rel = file.slice(pkgRoot.length + 1);
    for (const m of text.matchAll(/from\s+"([^"]+)"/g)) {
      const spec = m[1] as string;
      if (spec === "node:http" || spec === "node:https" || /graphql/i.test(spec)) {
        violations.push(`${rel}: direct transport import '${spec}'`);
      }
      // Tracker access is sanctioned ONLY through the frozen barrel factory.
      if (/tracker(\/testing)?\//.test(spec) && !/(^|\/)tracker\/index\.js$/.test(spec)) {
        violations.push(`${rel}: tracker-internals import '${spec}'`);
      }
    }
    assert.ok(!/query\s|\bGraphQL\b/.test(text), `${rel}: GraphQL vocabulary`);
  }
  assert.deepEqual(violations, [], "src/cli must delegate all transport/tracker access");
});

/* ── zero-org-literal scan (Principle III; engine-hygiene posture) ─────────────── */

const SYNTHETIC_UUID = /^ac000000-0000-4000-8000-\d{12}$/;
const DETERMINISTIC_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_SHAPE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const REAL_ORG = /\b(github|gitlab|atlassian|jira|trello|asana|monday\.com|notion\.so|height\.app|clickup|contoso|globex|initech)\b/i;

const BANNED: ReadonlyArray<readonly [RegExp, string]> = [
  [/lin_api_[A-Za-z0-9]{12,}/, "lin_api_-shaped token VALUE"],
  [/(authorization|proxy-authorization|cookie|x-api-key)\s*["']?\s*[:=]/i, "credential-header key"],
  [/-----BEGIN/, "PEM material"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/, "email-shaped value"],
];

function offendingUuids(text: string): string[] {
  return [...text.matchAll(new RegExp(UUID_SHAPE, "gi"))]
    .map((m) => m[0] as string)
    .filter((u) => !SYNTHETIC_UUID.test(u) && !DETERMINISTIC_V5.test(u));
}

function scanText(label: string, text: string, violations: string[]): void {
  for (const [pattern, name] of BANNED) {
    const hit = text.match(pattern);
    if (hit && name.startsWith("email") && hit[0].endsWith(".invalid")) continue; // sanctioned placeholder mail
    if (hit) violations.push(`${label}: ${name} → '${hit[0].slice(0, 48)}'`);
  }
  const org = text.match(REAL_ORG);
  if (org !== null) violations.push(`${label}: real-org identifier '${org[0]}'`);
  const uuids = offendingUuids(text);
  if (uuids.length > 0) violations.push(`${label}: non-placeholder UUID(s): ${uuids.slice(0, 3).join(", ")}`);
  for (const m of text.matchAll(/https?:\/\/[^\s"'`)\]]+/g)) {
    const url = m[0] as string;
    if (!/\.example\.invalid(\/|$|:)/.test(url) && !url.includes("localhost")) {
      violations.push(`${label}: non-benign host '${url.slice(0, 60)}'`);
    }
  }
}

test("cli-hygiene — src/cli sources ship zero org literals, tokens, emails, hosts, or real UUIDs", () => {
  const violations: string[] = [];
  const files = [...walk(join(pkgRoot, "src", "cli"))].filter((f) => f.endsWith(".ts"));
  for (const file of files) {
    scanText(`src/cli/${file.slice(join(pkgRoot, "src", "cli").length + 1)}`, readFileSync(file, "utf8"), violations);
  }
  assert.deepEqual(violations, [], "Principle III violation in CLI sources");
});

test("cli-hygiene — tests/fixtures/cli/** uses placeholders only", () => {
  const fixtureRoot = join(pkgRoot, "tests", "fixtures", "cli");
  const files = [...walk(fixtureRoot)];
  assert.ok(files.length >= 8, "sanity: the cli fixture tree is really scanned");
  const violations: string[] = [];
  for (const file of files) {
    scanText(file.slice(pkgRoot.length + 1).replaceAll("\\", "/"), readFileSync(file, "utf8"), violations);
  }
  assert.deepEqual(violations, [], "Principle III violation in CLI fixtures");
});

test("cli-hygiene — docs/cli.md keeps placeholder identifiers only", () => {
  const violations: string[] = [];
  scanText("docs/cli.md", readFileSync(join(pkgRoot, "docs", "cli.md"), "utf8"), violations);
  assert.deepEqual(violations, [], "Principle III violation in operator docs");
});
