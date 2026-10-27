/**
 * T005 [P] — Unit tests for the built-in `"default"` normalization-profile registry
 * (`src/engine/normalize.ts`; research R5 + R3 hash baseline; data-model §3; SC-002).
 * Pins the registry contract (`DEFAULT_NORMALIZATION_PROFILE_NAME`,
 * `builtInNormalizationProfiles`, `resolveNormalizationProfile`, `normalizedContentHash`)
 * and the built-in rule set — CRLF/CR→LF, tabs-in-blank-lines stripped, trailing
 * whitespace per line removed, blank-line runs collapsed to one, single trailing newline
 * enforced, Unicode NFC — while content-bearing Markdown (emphasis, list markers,
 * heading `#` counts, code fences) survives byte-for-byte.
 *
 * Round-trip posture (R3/R5: `normalize(mirror(render(x))) === normalize(x)`): the
 * `render` half uses the REAL 004 line renderer (`renderTaskLines` from
 * `task-linear-sync/parsing`, 004-test-precedent hand-built Task fixture). The mirror
 * half is MODELED, not imported: the 007 `createFakeLinearPort` echoes issue
 * descriptions verbatim (a faithful in-memory platform carries no formatting quirks),
 * and the description-mirror push itself lands in 008's `payload.ts` (T042) — so per
 * the T005 brief the test reproduces the exact platform noise R5 documents the profile
 * must equate: CRLF/CR terminators, tabs/spaces padding blank lines, trailing
 * whitespace per line, added blank-line runs, trailing-newline drift, and NFD
 * re-decomposition on echo.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import {
  DEFAULT_NORMALIZATION_PROFILE_NAME,
  builtInNormalizationProfiles,
  defaultDescriptionNormalizer,
  normalizedContentHash,
  resolveNormalizationProfile,
} from "../../src/engine/normalize.js";
import type { DescriptionNormalizer } from "../../src/engine/normalize.js";
import { EngineError } from "../../src/engine/errors.js";

import { builtInDefaults, type ResolvedConfig } from "task-linear-sync/config";
import { renderTaskLines } from "task-linear-sync/parsing";
import type { LineAssignment } from "task-linear-sync/parsing";
import type { Task } from "task-linear-sync/domain";

/** The profile under test, called directly for rule-level assertions. */
const normalize = defaultDescriptionNormalizer;

// ── Registry surface ────────────────────────────────────────────────────────────────

test("engine-normalize: the built-in registry holds exactly the \"default\" profile and is immutable", () => {
  assert.equal(DEFAULT_NORMALIZATION_PROFILE_NAME, "default");

  const profiles = builtInNormalizationProfiles();
  assert.deepEqual(Object.keys(profiles), ["default"]);
  assert.equal(profiles[DEFAULT_NORMALIZATION_PROFILE_NAME], defaultDescriptionNormalizer);

  // Registry is a frozen snapshot — consumers cannot extend it by mutation
  // (extension goes through `EngineOptions.normalizationProfiles` → resolve).
  assert.throws(() => Object.assign(builtInNormalizationProfiles(), { evil: (t: string): string => t }), TypeError);
});

test("engine-normalize: resolveNormalizationProfile resolves \"default\" to the working built-in function", () => {
  const fn = resolveNormalizationProfile(DEFAULT_NORMALIZATION_PROFILE_NAME);
  assert.equal(fn, defaultDescriptionNormalizer);
  assert.equal(fn("a\r\n\r\n\r\nb\t "), "a\n\nb\n"); // resolves to a working normalizer, not a stub
});

test("engine-normalize: extensions add names; unknown names fail loudly — never a silent fallback", () => {
  const terse: DescriptionNormalizer = (text) => normalize(text).trimEnd();
  const extensions = { terse };

  assert.equal(resolveNormalizationProfile("terse", extensions), terse); // programmatic entry, same reference
  assert.equal(resolveNormalizationProfile("default", extensions), defaultDescriptionNormalizer); // built-in still present alongside extensions

  assert.throws(() => resolveNormalizationProfile("terse"), EngineError); // unknown WITHOUT extensions
  assert.throws(() => resolveNormalizationProfile("unknown", extensions), EngineError); // never falls back to the lone extension…
  assert.throws(() => resolveNormalizationProfile("TERSE", extensions), EngineError); // …nor does lookup loosen (case-exact)
  assert.throws(() => resolveNormalizationProfile("", extensions), EngineError); // empty name is unknown, not "default"
  // Inherited-Object members must never resolve as profiles (no accidental-function fallback).
  assert.throws(() => resolveNormalizationProfile("toString"), EngineError);
  assert.throws(() => resolveNormalizationProfile("constructor"), EngineError);

  // The thrown error names the offending profile (loud, actionable — no silent drift).
  let thrown: unknown;
  try {
    resolveNormalizationProfile("legacy-md", extensions);
  } catch (error) {
    thrown = error;
  }
  assert.ok(thrown instanceof EngineError);
  assert.match(thrown.message, /legacy-md/u);
});

test("engine-normalize: an extension named \"default\" overrides the built-in behavior (constitution III) without mutating either registry", () => {
  const override: Record<string, DescriptionNormalizer> = { default: (): string => "OVERRIDE" };

  assert.equal(resolveNormalizationProfile("default", override)("anything"), "OVERRIDE"); // programmatic precedence over built-in
  assert.equal(resolveNormalizationProfile("default"), defaultDescriptionNormalizer); // built-in wins when no override given
  assert.equal(builtInNormalizationProfiles().default, defaultDescriptionNormalizer); // built-in registry untouched by the override
  assert.equal(resolveNormalizationProfile("default", override), override.default); // stable reference across calls
  assert.deepEqual(Object.keys(override), ["default"]); // resolver never mutates the extensions record
});

// ── Built-in rule set ───────────────────────────────────────────────────────────────

test("engine-normalize: CRLF and lone CR normalize to LF (also mixed within one text)", () => {
  assert.equal(normalize("a\r\nb\rc\n"), "a\nb\nc\n");
  assert.equal(normalize("line\r"), "line\n"); // lone CR terminator + single trailing newline
  assert.equal(normalize("mixed \r\ntabs\there\n"), "mixed\ntabs\there\n");
  assert.ok(!normalize("x\r\ny\rz").includes("\r")); // no CR survives anywhere
});

test("engine-normalize: trailing whitespace stripped per line; blank lines with tabs/spaces become empty; leading indentation kept", () => {
  assert.equal(normalize("a  \nb\t\nc\t\tindented\n"), "a\nb\nc\t\tindented\n");
  assert.equal(normalize("foo \t \n"), "foo\n");
  assert.equal(normalize("\t \n"), ""); // whitespace-only document has no content
  assert.equal(normalize("\t- [ ] tab-indented item\t"), "\t- [ ] tab-indented item\n");
});

test("engine-normalize: runs of blank lines collapse to one; trailing blank lines removed", () => {
  assert.equal(normalize("a\n\n\n\nb\n"), "a\n\nb\n");
  assert.equal(normalize("a\n \t\n\t\nb"), "a\n\nb\n"); // whitespace-only lines join the run
  assert.equal(normalize("\n\n\nfoo"), "\n\nfoo\n"); // a leading run leaves exactly ONE blank line
  assert.equal(normalize("foo\n\n\n"), "foo\n"); // trailing run removed (replaced by the single final newline)
});

test("engine-normalize: exactly one trailing newline enforced", () => {
  assert.equal(normalize("no trailing"), "no trailing\n");
  assert.equal(normalize("done\n\n\n\n"), "done\n");
  assert.equal(normalize("a\nb"), "a\nb\n");
  assert.equal(normalize(""), ""); // empty stays empty (idempotence)
  assert.equal(normalize("\n"), ""); // a lone newline is blank-only content → empty
  assert.equal(normalize("   \n \n\t"), ""); // whitespace-only → empty
  const once = normalize("x\n\n\n");
  assert.match(once, /\n$/u);
  assert.ok(!/\n\n$/u.test(once)); // never more than one
});

test("engine-normalize: Unicode NFC applied; strictly NFC — compatibility forms are NOT folded", () => {
  assert.equal(normalize("cafe\u0301"), "caf\u00E9\n"); // decomposed é → composed é
  assert.equal(normalize("\u2126"), "\u03A9\n"); // OHM SIGN → GREEK CAPITAL OMEGA (NFC canonical mapping)
  assert.equal(normalize("cafe\u0301"), normalize("caf\u00E9")); // the round-trip equality this rule exists for

  // NFC ≠ NFKC: ligature, vulgar fraction, fullwidth and circled characters survive.
  assert.equal(normalize("\uFB01le"), "\uFB01le\n");
  assert.equal(normalize("\u00BD cup"), "\u00BD cup\n");
  assert.equal(normalize("\uFF21"), "\uFF21\n");
  assert.equal(normalize("\u2460 first"), "\u2460 first\n");
});

test("engine-normalize: content-bearing Markdown survives every rule byte-for-byte", () => {
  // Canonical (already-normalized) section with emphasis, every list marker, headings,
  // fences and a table — a fixed point of the normalizer.
  const canonical = [
    "# H1",
    "",
    "###### deep heading ######",
    "prose with #hash and **strong** and *em* and _under_score_ and snake_case_word.",
    "",
    "- dash item",
    "* star item with *nested em*",
    "+ plus item",
    "1. first",
    "2. second",
    "   3. indented ordered",
    "",
    "```ts",
    "  const t = 'kept indent';",
    "```",
    "",
    "| table | cells |",
    "| --- | --- |",
    "",
  ].join("\n");
  assert.equal(normalize(canonical), canonical); // fixed point

  // The SAME content through CRLF + blank-line tabs + trailing-whitespace noise: rules
  // fire, content is identical (code-fence interiors included — only trailing
  // whitespace inside fences is stripped; indentation and markers survive).
  const noisy = canonical
    .replace(/\n/gu, "\r\n")
    .split("\r\n")
    .map((line) => (line.trim() === "" ? " \t" : `${line} `))
    .join("\r\n");
  assert.notEqual(noisy, canonical); // noise demonstrably present
  assert.equal(normalize(noisy), canonical);

  // Marker-level non-alteration pins (each rule set active on the same inputs).
  assert.equal(normalize("*a* _b_ **c** __d__"), "*a* _b_ **c** __d__\n");
  assert.equal(normalize("- x\r\n* y\r+ z\r1. w"), "- x\n* y\n+ z\n1. w\n");
  assert.equal(normalize("## two ##"), "## two ##\n"); // trailing hashes are content, not whitespace
  assert.equal(normalize("```\n\t\ttabbed code\n```  "), "```\n\t\ttabbed code\n```\n");
});

// ── Invariants: idempotence, round trip, hash ───────────────────────────────────────

/** Deterministic PRNG (mulberry32) — the fuzz noise is seed-fixed, never `Math.random`. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Map over the content lines of a string, preserving each line's original terminator. */
function mapLines(text: string, fn: (line: string) => string): string {
  const parts = text.split(/(\r\n|\r|\n)/u);
  for (let i = 0; i < parts.length; i += 2) parts[i] = fn(parts[i] ?? "");
  return parts.join("");
}

/** Duplicate every blank line (platform blank-run padding), preserving terminators. */
function padBlankRuns(text: string, filler: string): string {
  const parts = text.split(/(\r\n|\r|\n)/u);
  const out: string[] = [];
  for (let i = 0; i < parts.length; i += 2) {
    const eol = parts[i + 1] ?? "";
    out.push(parts[i] ?? "", eol);
    if ((parts[i] ?? "").trim() === "" && eol !== "") out.push(filler, eol);
  }
  return out.join("");
}

/** The exact platform-noise classes R5 documents (research R5; T005 brief). */
const NOISE_OPS: ReadonlyArray<{ readonly label: string; readonly apply: (s: string) => string }> = [
  { label: "LF→CRLF", apply: (s) => s.replace(/\r\n|\r|\n/gu, "\r\n") }, // terminator-safe: matches WHOLE terminators, never creates \r\r
  { label: "LF→CR", apply: (s) => s.replace(/\r\n|\r|\n/gu, "\r") },
  { label: "tabs-in-blank-lines", apply: (s) => mapLines(s, (l) => (l.trim() === "" ? `${l} \t` : l)) },
  { label: "trailing-whitespace", apply: (s) => mapLines(s, (l) => (l.trim() === "" ? l : `${l} \t`)) },
  { label: "blank-line-runs", apply: (s) => padBlankRuns(s, "\t ") },
  { label: "drop-final-newline", apply: (s) => s.replace(/(\r\n|\r|\n)+$/u, "") },
  { label: "extra-trailing-newlines", apply: (s) => `${s}\r\n\r\n\r\n` },
  { label: "NFD-echo", apply: (s) => s.normalize("NFD") },
];

const FUZZ_DOCS: readonly string[] = [
  [
    "# Café notes — *emphasis* and é",
    "",
    "- dash",
    "\t* nested tab",
    "+ plus",
    "1. one",
    "",
    "```",
    "  indented\tcode",
    "```",
    "",
    "End.",
    "",
  ].join("\n"),
  "single line only",
  "",
  "\n",
  "a\n\n\nb  \n\t \nc",
];

test("engine-normalize: idempotent — golden fixed points plus seeded fuzz over every noise operation (SC-002)", () => {
  for (const doc of FUZZ_DOCS) {
    const once = normalize(doc);
    assert.equal(normalize(once), once, `not idempotent: ${JSON.stringify(doc)}`);
  }

  const rand = mulberry32(20261026);
  for (let caseNo = 0; caseNo < 120; caseNo++) {
    const base = FUZZ_DOCS[Math.floor(rand() * FUZZ_DOCS.length)] ?? "";
    const hash = normalizedContentHash(normalize, base);
    let variant = base;
    const ops = 1 + Math.floor(rand() * 4);
    for (let i = 0; i < ops; i++) {
      variant = (NOISE_OPS[Math.floor(rand() * NOISE_OPS.length)] as { apply: (s: string) => string }).apply(variant);
    }
    const once = normalize(variant);
    assert.equal(normalize(once), once, `fuzz case ${caseNo}: not idempotent after ${ops} op(s)`);
    // Formatting-only drift ⇒ identical hash baseline (the SC-002 mechanism).
    assert.equal(normalizedContentHash(normalize, variant), hash, `fuzz case ${caseNo}: noise changed the hash`);
  }
});

// ── 004/007 round trip (SC-002) ─────────────────────────────────────────────────────

const cfg: ResolvedConfig = structuredClone(builtInDefaults);
const TASK_PATH = "specs/sync/tasks.md";

/** Hand-built heading Task fixture (004-test precedent, `parsing-render.test.ts`). */
function headingTaskFixture(lineNumber: number, endLine: number): Task {
  return {
    stableUuid: "00000000-0000-5000-8000-000000000012",
    filePath: TASK_PATH,
    frameworkId: "generic",
    kind: "heading",
    lineNumber,
    localTaskId: "1.1",
    title: "Ship the toggle",
    childUuids: [],
    taskBody: { startLine: lineNumber, endLine },
    unresolvedConflict: false,
  };
}

/** One task section (heading + body to EOF) — the region the mirror pushes as the issue description. */
const SECTION_LINES: readonly string[] = [
  "## 1.1: [SYNC-12] Ship the toggle",
  "",
  "Body paragraph with *emphasis*, _under_scores, and a café accent.",
  "",
  "- item one",
  "* item two",
  "+ item three",
  "\t- nested tab-indented",
  "  1. ordered nested",
  "",
  "```ts",
  "const x = 1;",
  "```",
  "",
  "Closing note with `inline_code` text.",
];
const FILE_LF = `${SECTION_LINES.join("\n")}\n`;

/** Re-rendering the already-rendered title — the render half of the round trip. */
const RENDER_ASSIGNMENT: LineAssignment = {
  task: headingTaskFixture(1, SECTION_LINES.length),
  desiredTitle: "[SYNC-12] Ship the toggle",
  issueRef: { key: "SYNC", number: 12 },
};

/**
 * Modeled 007-platform description echo (see header): the spec-side section text the
 * engine pushed comes back with the documented noise classes — CRLF/CR terminators,
 * tab/space-padded blank lines, per-line trailing whitespace, doubled blank-line runs,
 * trailing-newline drift and NFD re-decomposition.
 */
function linearDescriptionEcho(spec: string, eol: "\r\n" | "\r"): string {
  const lines = spec.replace(/\r\n|\r/gu, "\n").split("\n");
  if (lines.at(-1) === "") lines.pop();
  const echoed: string[] = [];
  for (const line of lines) {
    echoed.push(line.trim() === "" ? " \t" : `${line} `);
    if (line.trim() === "") echoed.push("\t "); // platform pads blank regions with a run
  }
  return `${echoed.join(eol)}${eol}${eol}`.normalize("NFD");
}

test("engine-normalize: SC-002 round trip — normalize(mirror(render(x))) === normalize(x) via the real 004 renderer (LF file, CRLF echo)", () => {
  const rendered = renderTaskLines(TASK_PATH, FILE_LF, [RENDER_ASSIGNMENT], cfg);
  assert.equal(rendered.content, FILE_LF); // render is content-identical (carried terminators, byte-preserved body)

  const mirrored = linearDescriptionEcho(rendered.content, "\r\n");
  assert.notEqual(mirrored, rendered.content); // noise demonstrably injected
  assert.equal(normalize(mirrored), normalize(FILE_LF));
  assert.equal(normalizedContentHash(normalize, mirrored), normalizedContentHash(normalize, FILE_LF)); // hash baseline immune (SC-002)
});

test("engine-normalize: SC-002 round trip over a CRLF spec file with CR echo — terminators carried, drift normalized (hash equality)", () => {
  const fileCrlf = FILE_LF.replace(/\n/gu, "\r\n");
  const rendered = renderTaskLines(TASK_PATH, fileCrlf, [RENDER_ASSIGNMENT], cfg);
  assert.equal(rendered.content, fileCrlf); // 004 carries terminators, never regenerates them

  const mirrored = linearDescriptionEcho(rendered.content, "\r");
  assert.equal(normalize(mirrored), normalize(FILE_LF)); // LF-authored and CRLF-on-disk specs normalize alike
  assert.equal(normalizedContentHash(normalize, mirrored), normalizedContentHash(normalize, FILE_LF));

  // A REAL edit is never equated — the profile normalizes noise, not content (R5 "nothing more").
  const edited = `${FILE_LF}\nNew requirement.\n`;
  assert.notEqual(normalizedContentHash(normalize, linearDescriptionEcho(edited, "\r\n")), normalizedContentHash(normalize, FILE_LF));
});

// ── normalizedContentHash ───────────────────────────────────────────────────────────

test("engine-normalize: normalizedContentHash is sha256 hex of the normalized text, honoring the given profile", () => {
  const text = "a\r\n\r\n\r\nb\t \ncafe\u0301";
  const hash = normalizedContentHash(normalize, text);
  assert.match(hash, /^[0-9a-f]{64}$/u);
  assert.equal(hash, createHash("sha256").update(normalize(text), "utf8").digest("hex"));
  assert.equal(hash, normalizedContentHash(normalize, normalize(text))); // hash of raw ≡ hash of already-normalized

  // Formatting-only drift ⇒ identical hash; any content edit ⇒ different hash.
  assert.equal(normalizedContentHash(normalize, "x\n\ny"), normalizedContentHash(normalize, "x\r\n \ny\r\n\r\n"));
  assert.notEqual(normalizedContentHash(normalize, "x\ny"), normalizedContentHash(normalize, "x\nY"));

  // The normalizer argument is applied, not hard-coded: a custom profile hashes custom output.
  const upper: DescriptionNormalizer = (t) => normalize(t).toUpperCase();
  assert.equal(normalizedContentHash(upper, "ab"), createHash("sha256").update("AB\n").digest("hex"));
});
