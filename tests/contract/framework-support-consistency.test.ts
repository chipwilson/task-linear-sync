/**
 * 016 framework-support consolidation — README ⇄ requirements ⇄ registry agreement.
 *
 * The README once advertised built-in adapters for frameworks that never
 * existed in the code (`spec-kitty`, `spec-superpower`) while omitting three of
 * the five real built-ins. This suite pins the three framework-support
 * artifacts to each other so they cannot drift apart again:
 *
 *   1. the built-in adapter registry, the frozen 002 `FrameworkId` union, and
 *      the requirements.md `Supported_Framework` glossary enumerate the SAME set;
 *   2. the README documents per-framework behavior for EVERY built-in id — each
 *      canonical id appears in backticks inside a `###` subsection heading —
 *      plus the custom-adapter lane and its discovery-only scope;
 *   3. the README carries no fabricated framework names (regression guard);
 *   4. the documented selection precedence matches `DEFAULT_PRECEDENCE`, and
 *      the agent-hook claims match the code's scaffold table (kiro + generic
 *      templates only, exactly as the CLI refuses the rest with zero writes).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { agentHookScaffold, builtInAdapters } from "../../src/discovery/index.js";
import { DEFAULT_PRECEDENCE } from "../../src/discovery/registry.js";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const readme = readFileSync(join(pkgRoot, "README.md"), "utf8");
const requirements = readFileSync(join(pkgRoot, "specs", "requirements.md"), "utf8");
const taskSource = readFileSync(join(pkgRoot, "src", "domain", "task.ts"), "utf8");

/** Registry rows are the operational truth: what discovery can actually select. */
const registryIds = Object.keys(builtInAdapters).sort();

test("framework-consistency: registry, frozen FrameworkId union, and requirements glossary enumerate the same set", () => {
  const union = taskSource.match(/export type FrameworkId = ([^;]+);/);
  assert.ok(union, "src/domain/task.ts must declare the FrameworkId union");
  const unionIds = [...union[1].matchAll(/"([^"]+)"/g)].map((m) => m[1] as string).sort();
  assert.deepEqual(unionIds, registryIds, "frozen FrameworkId literals must equal the built-in adapter registry");

  const glossary = requirements.match(/\*\*Supported_Framework\*\*: One of ([^.;]+);/);
  assert.ok(glossary, "requirements.md must define Supported_Framework as an explicit id list");
  const glossaryIds = [...glossary[1].matchAll(/`([^`]+)`/g)].map((m) => m[1] as string).sort();
  assert.deepEqual(glossaryIds, registryIds, "Supported_Framework glossary must enumerate exactly the built-in ids");
});

test("framework-consistency: README documents behavior for every built-in framework", () => {
  const headingLines = readme
    .split("\n")
    .filter((line) => line.startsWith("### "))
    .join("\n");
  for (const id of registryIds) {
    assert.ok(
      new RegExp(`^### [^\\n]*\`${id}\``, "m").test(headingLines),
      `README must carry a '###' subsection whose heading names the built-in framework \`${id}\``,
    );
  }
  // The overview table plus the per-framework sections must name each framework's detection base.
  for (const id of registryIds) {
    const section = readme.split(new RegExp(`^### [^\\n]*\`${id}\`[^\\n]*$`, "m"))[1] ?? "";
    const body = section.split(/^### /m)[0] ?? "";
    assert.ok(body.trim().length > 120, `the \`${id}\` subsection must describe real behavior, not just name it`);
  }
});

test("framework-consistency: README names no framework the code does not ship", () => {
  assert.doesNotMatch(readme, /spec-kitty|spec-superpower/i, "no adapter for these names has ever existed in the code");
  for (const id of registryIds) {
    assert.ok(readme.includes(`\`${id}\``), `README must carry the canonical id \`${id}\``);
  }
});

test("framework-consistency: README cites real configuration keys (frozen 002 schema)", () => {
  // The schema fields are top-level camelCase (src/config/schema.ts); the README once
  // invented `tasks.filename_patterns` and `matching.auto_link_confidence`, which the
  // loader silently ignores — a documented key that does nothing is worse than none.
  assert.doesNotMatch(readme, /filename_patterns|auto_link_confidence/, "no invented config keys");
  assert.match(readme, /taskFilePatterns/, "README must name the real task-file pattern key");
  assert.match(readme, /specsBaseDirectories/, "README must name the real base-directory key");
});

test("framework-consistency: README precedence line matches DEFAULT_PRECEDENCE", () => {
  const expected = DEFAULT_PRECEDENCE.map((id) => `\`${id}\``).join(" → ");
  assert.ok(
    readme.includes(expected),
    `README must document the exact selection precedence: ${expected}`,
  );
});

test("framework-consistency: agent-hook scaffold claims match the code", () => {
  const templated = registryIds
    .filter((id) => agentHookScaffold(id as never, "task-linear-sync") !== undefined)
    .sort();
  assert.deepEqual(templated, ["generic", "kiro"], "only kiro + generic carry scaffold templates");
  assert.match(
    readme,
    /`kiro` default, `generic` also available/,
    "README's install-agent-hook row must state exactly the templated frameworks",
  );
});

test("framework-consistency: custom adapters are documented as discovery-only in both artifacts", () => {
  assert.match(readme, /customAdapters/, "README must name the custom-adapter seam");
  assert.match(
    readme,
    /built-in\s+frameworks\s+(?:are|remain)\s+the\s+only[\s\S]*(?:sync|plan|apply)/,
    "README must state that plan/apply accept only the built-in identities (engine/build.ts refuses the rest)",
  );
  assert.match(requirements, /custom framework adapter configuration/, "requirements.md R7.6 must keep the custom-adapter lane");
});
