/**
 * T025 [015 US3] — changelog grammar contract (data-model §6; FR-008;
 * contracts/versioning-policy.md §2). Runs on EVERY PR so format rot never
 * meets release day:
 *   - entry headers match `## [<semver>] - <YYYY-MM-DD>` exactly;
 *   - no duplicate version entries;
 *   - at most one `## [Unreleased]`, and it sits above all version entries;
 *   - the seeded repository CHANGELOG.md passes;
 *   - every violation shape produces a NAMED failure line (violation fixture
 *     matrix below — the checker is exercised, not just asserted).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));

const ENTRY = /^## \[(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)\] - \d{4}-\d{2}-\d{2}$/;
const UNRELEASED = /^## \[Unreleased\]$/;
const ANY_HEADER = /^## \[/;

/** Grammar checker — same rules the release gate reuses; returns NAMED failures. */
function checkChangelog(text: string): string[] {
  const failures: string[] = [];
  const lines = text.split("\n");
  const versions: string[] = [];
  let unreleasedCount = 0;
  let unreleasedLine = 0;
  let lastVersionLine = 0;
  lines.forEach((line, i) => {
    if (!ANY_HEADER.test(line)) return;
    if (UNRELEASED.test(line)) {
      unreleasedCount += 1;
      unreleasedLine = i + 1;
      return;
    }
    const m = ENTRY.exec(line);
    if (m === null) {
      failures.push(`line ${i + 1}: malformed entry header '${line}' — want '## [<semver>] - <YYYY-MM-DD>'`);
      return;
    }
    if (versions.includes(m[1]!)) failures.push(`line ${i + 1}: duplicate version entry [${m[1]}]`);
    versions.push(m[1]!);
    lastVersionLine = i + 1;
  });
  if (unreleasedCount > 1) failures.push(`at most one '## [Unreleased]' allowed, found ${unreleasedCount}`);
  if (unreleasedCount === 1 && unreleasedLine > lastVersionLine && lastVersionLine > 0) {
    failures.push(`'## [Unreleased]' (line ${unreleasedLine}) must sit above all version entries (last at line ${lastVersionLine})`);
  }
  return failures;
}

test("changelog: the repository CHANGELOG.md passes the grammar", () => {
  const text = readFileSync(join(pkgRoot, "CHANGELOG.md"), "utf8");
  assert.deepEqual(checkChangelog(text), []);
  // and it carries at least the seeded entry for the current version
  const version = (JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as { version: string }).version;
  assert.match(text, new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m"));
});

test("changelog: valid shapes — clean file and Unreleased-above-entries", () => {
  const ok = [
    "# Changelog",
    "",
    "## [Unreleased]",
    "",
    "notes",
    "",
    "## [1.2.3] - 2026-01-02",
    "",
    "- change",
    "",
    "## [1.2.3-rc.1] - 2026-01-01",
  ].join("\n");
  assert.deepEqual(checkChangelog(ok), []);
});

test("changelog: violation matrix — each fault produces a named failure", () => {
  const cases: Array<[string, string, RegExp]> = [
    ["missing date", "## [1.0.0]\n", /malformed entry header/],
    ["wrong dashes", "## [1.0.0] — 2026-01-01\n", /malformed entry header/],
    ["non-semver", "## [1.0]\n", /malformed entry header/],
    ["date before header", "## [1.0.0] - 01-2026-2026\n", /malformed entry header/],
    ["duplicate version", "## [1.0.0] - 2026-01-01\n\n## [1.0.0] - 2026-01-02\n", /duplicate version entry \[1\.0\.0\]/],
    ["two Unreleased", "## [Unreleased]\n\n## [Unreleased]\n", /at most one '## \[Unreleased\]'/],
    [
      "Unreleased below entries",
      "## [1.0.0] - 2026-01-01\n\n## [Unreleased]\n",
      /must sit above all version entries/,
    ],
  ];
  for (const [label, text, want] of cases) {
    const failures = checkChangelog(text);
    assert.ok(failures.length >= 1, `${label}: expected a failure line`);
    assert.ok(
      failures.some((f) => want.test(f)),
      `${label}: expected a line matching ${want}, got: ${failures.join(" | ")}`,
    );
  }
});

test("changelog: release-gate semantics — entry lookup matches verify-package's regex", () => {
  // The release gate (scripts/verify-package.mjs --expect-changelog <v>) tests the
  // archived copy with the SAME header shape this suite enforces.
  const text = readFileSync(join(pkgRoot, "CHANGELOG.md"), "utf8");
  const version = (JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as { version: string }).version;
  const gate = new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m");
  assert.match(text, gate, "the released-version entry must satisfy the stage-7 gate regex");
});
