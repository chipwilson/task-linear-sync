/**
 * T050 [P] — engine hygiene release scan (constitution Principle III; quickstart
 * "Security & determinism checks — Hygiene/packaging"; mirrors the posture of
 * `defaults-scan.test.ts` (T035) and `tracker-hygiene.test.ts` (T046/007) for the 008
 * surface). Publishing must ship ZERO real organization identifiers, team keys, tokens,
 * or UUID values anywhere the engine touches.
 *
 * Asserts:
 *  1. `src/engine/**` sources carry no token shapes (`lin_api_…`, PEM, credential-header
 *     keys), no email shapes, no real-org literals, and every UUID-shaped value is a
 *     synthetic placeholder scheme (`ac000000-0000-4000-8000-…`); every host-bearing
 *     literal is a benign `*.example.invalid`/localhost placeholder;
 *  2. the DISTRIBUTED DEFAULTS the engine ships (built-in screening rules, normalization
 *     profile registry, the `toolId`-derived identity defaults) double-scan clean — same
 *     leaf-scan posture as T035;
 *  3. marker labels derive from `toolId` (Principle II/III): `synthesizeConflictMarkerBlock`
 *     parameterizes BOTH labels off the configured `toolId` — a custom toolId leaves zero
 *     trace of the distributed default, the labels carry the issue key, never a UUID;
 *  4. `tests/fixtures/engine/**` uses placeholders only: UUIDs are restricted to the two
 *     deterministic fixture schemes (007 synthetic `ac000000-…` and the sha-derived
 *     version-5 task seeds), team keys match the uppercase placeholder shape (`TEAM-A`,
 *     `ACME`), hosts are `example.invalid`-benign, and no banned pattern occurs in any
 *     fixture file (JSON, Markdown, everything).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { builtInDefaults } from "task-linear-sync/config";
import {
  DEFAULT_NORMALIZATION_PROFILE_NAME,
  builtInNormalizationProfiles,
  builtInScreeningRules,
  synthesizeConflictMarkerBlock,
} from "task-linear-sync/engine";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));

function* walk(dir: string): Generator<string> {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else yield p;
  }
}

/** Placeholder identity schemes (Principle III): synthetic 007 scheme + deterministic
 *  sha-derived v5 task seeds (`uuidFromLabel`/stable-uuid family). Version-4 random
 *  UUIDs — the shape real data carries — are NEVER allowed. */
const SYNTHETIC_UUID = /^ac000000-0000-4000-8000-\d{12}$/;
const DETERMINISTIC_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const UUID_SHAPE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const REAL_ORG = /\b(github|gitlab|atlassian|jira|trello|asana|monday\.com|notion\.so|height\.app|clickup|contoso|globex|initech)\b/i;

const BANNED: ReadonlyArray<readonly [RegExp, string]> = [
  [/lin_api_[A-Za-z0-9]{12,}/, "lin_api_-shaped token VALUE (rule prefixes are exempt below)"],
  [/(authorization|proxy-authorization|cookie|x-api-key)\s*["']?\s*[:=]/i, "credential-header key"],
  [/-----BEGIN/, "PEM material"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/, "email-shaped value"],
];

/**
 * The screening rulebook is the detector's own vocabulary: `src/engine/screening.ts`
 * (and the `builtInScreeningRules` leaves it distributes) MUST name the material it
 * detects — `-----BEGIN` PEM starts, the GitHub PAT family, `lin_api_` prefixes — to
 * block it. Those literals are detection patterns, not shipped identity or credential
 * material (T035 posture: org/secret literals are refused in IDENTITY surfaces, the
 * detection rulebook is the sanctioned exception, scoped to exactly this source file /
 * these rule leaves).
 */
function isDetectionVocabulary(label: string): boolean {
  return label.includes("screening.ts") || label.startsWith("screeningRules");
}

/** Every UUID-shaped hit in `text` that belongs to no sanctioned placeholder scheme. */
function offendingUuids(text: string): string[] {
  return [...text.matchAll(new RegExp(UUID_SHAPE, "gi"))]
    .map((m) => m[0] as string)
    .filter((u) => !SYNTHETIC_UUID.test(u) && !DETERMINISTIC_V5.test(u));
}

function scanText(label: string, text: string, violations: string[], opts: { allowUuidSchemes?: boolean } = {}): void {
  for (const [pattern, name] of BANNED) {
    const hit = text.match(pattern);
    // Benign placeholder mail (Principle III sanctions example.invalid addresses — the
    // `secret-shape` world seeds one deliberately as screening test material).
    if (hit && name.startsWith("email") && hit[0].endsWith(".invalid")) continue;
    // The detector must be allowed to name what it detects (see isDetectionVocabulary).
    if (hit && (name.startsWith("PEM") || name.startsWith("lin_api_")) && isDetectionVocabulary(label)) continue;
    if (hit) violations.push(`${label}: ${name} → '${hit[0].slice(0, 48)}'`);
  }
  const org = text.match(REAL_ORG);
  if (org && !isDetectionVocabulary(label)) violations.push(`${label}: real-org identifier '${org[0]}'`);
  const uuids = offendingUuids(text);
  if (uuids.length > 0 && !opts.allowUuidSchemes) {
    violations.push(`${label}: non-placeholder UUID(s): ${uuids.slice(0, 3).join(", ")}`);
  }
  for (const m of text.matchAll(/https?:\/\/[^\s"'`)\]]+/g)) {
    const url = m[0] as string;
    if (!/\.example\.invalid(\/|$|:)/.test(url) && !url.includes("localhost")) {
      violations.push(`${label}: non-benign host '${url.slice(0, 60)}'`);
    }
  }
}

test("engine-hygiene — src/engine sources ship zero tokens, emails, org literals, hosts, or non-placeholder UUIDs", () => {
  const violations: string[] = [];
  const files = [...walk(join(pkgRoot, "src", "engine"))].filter((f) => f.endsWith(".ts"));
  assert.ok(files.length >= 15, "sanity: the engine sources are really scanned");
  for (const file of files) {
    scanText(`src/engine/${file.slice(join(pkgRoot, "src", "engine").length + 1)}`, readFileSync(file, "utf8"), violations);
  }
  assert.deepEqual(violations, [], "Principle III violation in distributed engine sources");
});

/** Recursive string-leaf harvest (defaults-scan T035 posture). */
function stringLeaves(value: unknown, path: string, out: Array<{ path: string; value: string }>): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => stringLeaves(v, `${path}[${i}]`, out));
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) stringLeaves(v, path ? `${path}.${k}` : k, out);
    return;
  }
  if (typeof value === "string") out.push({ path, value });
  if (typeof value === "function") out.push({ path, value: value.name });
}

test("engine-hygiene — distributed engine defaults double-scan clean (screening rules, profiles, toolId-derived identity)", () => {
  const leaves: Array<{ path: string; value: string }> = [];
  stringLeaves(builtInScreeningRules, "screeningRules", leaves);
  stringLeaves(Object.keys(builtInNormalizationProfiles), "profiles", leaves);
  stringLeaves(DEFAULT_NORMALIZATION_PROFILE_NAME, "defaultProfile", leaves);
  stringLeaves(builtInDefaults.toolId, "toolId", leaves);
  stringLeaves(builtInDefaults.metadataNamespaceKey, "metadataNamespaceKey", leaves);
  assert.ok(leaves.length > 0, "engine defaults exist to scan");
  for (const leaf of leaves) {
    assert.deepEqual(offendingUuids(leaf.value), [], `uuid-shaped default at ${leaf.path}`);
    assert.ok(!/lin_api_[A-Za-z0-9]{12,}/.test(leaf.value), `token VALUE default at ${leaf.path}`);
    assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(leaf.value), `email at ${leaf.path}`);
    // Screening rulebook leaves name their detection vocabulary (see the scan-side note).
    if (!isDetectionVocabulary(leaf.path)) {
      assert.ok(!REAL_ORG.test(leaf.value), `real-org literal at ${leaf.path}: ${leaf.value}`);
      assert.ok(!/-----BEGIN/.test(leaf.value), `PEM literal at ${leaf.path}`);
    }
  }
  // The distributed identity is the generic tool name — marker labels and the metadata
  // namespace key derive from it (never an organization identifier).
  assert.equal(builtInDefaults.toolId, "task-linear-sync", "generic tool-name identity");
  assert.equal(builtInDefaults.metadataNamespaceKey, `__${builtInDefaults.toolId}`, "namespace key derives from toolId");
});

test("engine-hygiene — marker labels derive from toolId, never the task UUID or a baked-in default (Principle II/III)", () => {
  const base = {
    filePath: "specs/demo/tasks.md",
    taskLine: 7,
    issueKey: "SYN-42",
    localContent: "local side",
    trackerContent: "tracker side",
  } as const;
  const markerFor = (toolId: string): string => synthesizeConflictMarkerBlock({ ...base, toolId });

  const custom = markerFor("alpha-probe-tool");
  const other = markerFor("beta-probe-tool");

  assert.ok(custom.includes(`<<<<<<< alpha-probe-tool:local ${base.filePath}#L7`), "opening label derives from toolId + file#L");
  assert.ok(custom.includes(`>>>>>>> alpha-probe-tool:linear ${base.issueKey}`), "closing label derives from toolId + issue key");
  assert.ok(!custom.includes("beta-probe-tool") && !other.includes("alpha-probe-tool"), "labels are parameterized, not baked");
  assert.ok(!custom.includes(builtInDefaults.toolId), `no baked-in default '${builtInDefaults.toolId}' in a custom-toolId marker`);
  for (const marker of [custom, other]) {
    assert.deepEqual(offendingUuids(marker), [], "marker labels embed no UUID (issue key only — Principle II)");
  }
});

test("engine-hygiene — tests/fixtures/engine/** uses placeholders only (UUIDs, team keys, hosts, banned shapes)", () => {
  const fixtureRoot = join(pkgRoot, "tests", "fixtures", "engine");
  const files = [...walk(fixtureRoot)];
  assert.ok(files.length >= 30, "sanity: the engine fixture tree is really scanned");
  const violations: string[] = [];
  const teamKeys = new Set<string>();

  for (const file of files) {
    const rel = file.slice(pkgRoot.length + 1).replaceAll("\\", "/");
    const text = readFileSync(file, "utf8");
    // No `allowUuidSchemes` anywhere: the sanctioned placeholder schemes pass
    // `offendingUuids`, everything else (real random v4 data) is a violation.
    scanText(rel, text, violations);

    if (file.endsWith(".json")) {
      for (const m of text.matchAll(/"teamKey"\s*:\s*"([A-Z][A-Z0-9_-]*)"/g)) {
        if (m[1] !== undefined) teamKeys.add(m[1]);
      }
      for (const m of text.matchAll(/"key"\s*:\s*("[0-9a-f][^"]*"|"[^"\s]+")/g)) {
        const raw = m[1] ?? "";
        if (/[0-9a-f]{8}-[0-9a-f]{4}/.test(raw)) {
          const id = raw.replaceAll('"', "");
          if (!SYNTHETIC_UUID.test(id) && !DETERMINISTIC_V5.test(id)) violations.push(`${rel}: non-placeholder workflow-state id '${id}'`);
        }
      }
    }
  }
  assert.ok(teamKeys.size > 0, "fixture team keys exist to scan");
  for (const key of teamKeys) {
    assert.match(key, /^[A-Z][A-Z0-9-]{0,15}$/, `non-placeholder team key shape: ${key}`);
    assert.ok(!REAL_ORG.test(key), `real-org team key: ${key}`);
  }
  assert.deepEqual(violations, [], "Principle III violation in engine fixtures");
});
