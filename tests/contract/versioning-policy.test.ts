/**
 * T030 [015 US4] — versioning-policy contract (contracts/versioning-policy.md §4;
 * data-model §7; FR-010). Machine checks over docs/versioning.md:
 *   - the file exists and states the 1.0.0 condition — the sentence covering
 *     BOTH clauses (every public surface stable under the 014 regime AND
 *     real-workspace dogfooding complete);
 *   - the semver discipline section states the 0.x posture;
 *   - the surface-stability mapping table has a row for EVERY stable surface:
 *     grep-driven over the 014 promotion markers (a Stability section reading
 *     "promoted by feature 014" must contribute its snapshot pointers to the
 *     table — a promoted surface without a row fails CI), plus the fixed
 *     canonical surfaces (core library + CLI, programmatic API, worker/hooks,
 *     CI action);
 *   - the update-duty paragraph and the README link exist.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const policyPath = join(pkgRoot, "docs", "versioning.md");

const policy = existsSync(policyPath) ? readFileSync(policyPath, "utf8") : null;

/** Extract one `## <heading>` section body (up to the next `## `), or null. */
function section(text: string, heading: string): string | null {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start < 0) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

test("versioning-policy: docs/versioning.md exists and README links it (T032)", () => {
  assert.ok(policy !== null, "docs/versioning.md must exist (FR-010)");
  const readme = readFileSync(join(pkgRoot, "README.md"), "utf8");
  assert.match(readme, /\]\((?:docs\/)?versioning\.md\)/, "README must link docs/versioning.md");
});

test("versioning-policy: the 1.0.0 condition sentence covers BOTH clauses", () => {
  assert.ok(policy !== null);
  // Whitespace-normalized so prose reflow cannot mask the policy statement.
  const flat = policy.replace(/\s+/g, " ");
  assert.ok(
    /every public surface declared stable under the 014 regime AND real-workspace dogfooding complete/.test(flat),
    "the 1.0.0 condition must appear verbatim, covering BOTH clauses",
  );
});

test("versioning-policy: semver discipline states the 0.x posture and the 1.0.0 switch", () => {
  assert.ok(policy !== null);
  const flat = policy.replace(/\s+/g, " ");
  assert.match(flat, /0\.x posture/);
  assert.match(flat, /breaking changes are permitted at minor bumps/i);
  assert.match(flat, /strict semver/i);
});

test("versioning-policy: mapping table covers every 014-promoted surface (grep-driven)", () => {
  assert.ok(policy !== null);
  // Discover the 014 stability set: docs whose Stability section carries the
  // promotion line. Each contributes its frozen-inventory snapshot pointers —
  // the pointer IS the scope definition, so the table row must carry it.
  const promoted: Array<{ doc: string; snapshots: string[] }> = [];
  for (const file of readdirSync(join(pkgRoot, "docs")).filter((f) => f.endsWith(".md"))) {
    const text = readFileSync(join(pkgRoot, "docs", file), "utf8");
    const stab = section(text, "Stability");
    if (stab === null || !stab.includes("promoted by feature 014")) continue;
    const snapshots = [...stab.matchAll(/tests\/contract\/snapshots\/[\w.-]+\.json/g)].map((m) => m[0]);
    assert.ok(snapshots.length >= 1, `${file}: promoted Stability section must point at its snapshot`);
    promoted.push({ doc: file, snapshots });
  }
  assert.ok(promoted.length >= 2, "expected at least the MCP + history promotions of 014");

  const table = section(policy, "Surface-stability mapping") ?? "";
  for (const { doc, snapshots } of promoted) {
    for (const snap of snapshots) {
      assert.ok(table.includes(snap), `mapping table lacks a row carrying ${snap} (promoted via docs/${doc})`);
    }
    assert.ok(table.includes(doc), `mapping table row for docs/${doc} must name the doc`);
  }
});

test("versioning-policy: canonical surfaces each have a table row", () => {
  assert.ok(policy !== null);
  const table = section(policy, "Surface-stability mapping") ?? "";
  // Fixed set per contracts/versioning-policy.md §4 (core + CLI, programmatic
  // API, worker/hooks, CI action). Row identity = the surface's specifiers.
  for (const token of [
    "Core library + CLI",
    "task-linear-sync/engine", // programmatic API
    "task-linear-sync/queue", // worker & hooks
    "ci-drift-action", // CI action (repository tag is the ref)
    "task-linear-sync/ci",
  ]) {
    assert.ok(table.includes(token), `mapping table lacks a row for '${token}'`);
  }
});

test("versioning-policy: update-duty paragraph exists", () => {
  assert.ok(policy !== null);
  assert.match(policy.replace(/\s+/g, " "), /must\n?\s*update this document \*\*in the same change\*\*|update this document in the same change/);
});
