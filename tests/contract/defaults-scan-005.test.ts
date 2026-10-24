/**
 * T026 [US2] — release-scan mirror for 005 (constitution III; 001 R6.7 "neither built-in
 * default contains any organization-specific or product-specific literal prefix").
 *
 * Scope: the built-in PASS-THROUGH title behavior and the DEFAULT STRIP behavior (asserted
 * as behavior, not just text), plus a source scan of `src/routing`/`src/titles` and every
 * file under `tests/fixtures/routing-titles/`. Fixtures legitimately use the benign
 * `acme-*` / `proj-*` / `<areaPrefix*>` placeholders sanctioned by the quickstart, so this
 * scan asserts those whitelists affirmatively instead of banning `acme` outright the way
 * the 002 defaults scan does.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { deriveTitle } from "../../src/titles/derive.js";
import { stripTitleForRender } from "../../src/titles/strip.js";
import { makeTask } from "../fixtures/routing-titles/factories.js";
import { nestedPrefixMap, tieMap } from "../fixtures/routing-titles/routing-maps.js";
import {
  absentAttrRules,
  areaRuleSet,
  areaStripPrefixes,
  emptyStripPrefixes,
  featurePool,
  makeTitleSlice,
  phasePool,
} from "../fixtures/routing-titles/title-fixtures.js";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));

function sourceTexts(dir: string): Array<{ file: string; text: string }> {
  return readdirSync(new URL(`file://${pkgRoot}${dir}`)).map((f) => ({
    file: `${dir}/${f}`,
    text: readFileSync(new URL(`file://${pkgRoot}${dir}/${f}`), "utf8"),
  }));
}

const SHIPPED = [
  ...sourceTexts("src/routing"),
  ...sourceTexts("src/titles"),
  ...sourceTexts("tests/fixtures/routing-titles"),
];

/** Organization/product names that must never appear in 005 sources or fixtures. */
const ORG_LITERALS = [
  "contoso",
  "globex",
  "initech",
  "umbrella",
  "hooli",
  "vandelay",
  "oscorp",
  "tyrell",
  "cyberdyne",
  "soylent",
  "waystar",
  "wonka",
  "github",
  "gitlab",
  "atlassian",
  "trello",
  "asana",
  "notion",
  "shortcut.com",
  "height.app",
  "openai",
  "anthropic",
];

test("defaults scan 005 — built-in pass-through adds no literal prefix to the title", () => {
  // The pass-through default is `finalTitle = task.title` verbatim when no Feature_Name…
  const raw = "Any odd title, kept [exactly] as parsed — 100% ✓";
  const passthrough = deriveTitle(makeTask({ title: raw }), makeTitleSlice({ titleRules: [] }));
  assert.equal(passthrough.finalTitle, raw);
  assert.equal(passthrough.baseTitle, raw);
  assert.equal(passthrough.defaulted, true);
  // …and the ONLY addition with a Feature_Name is the task's own name (no literal prefix).
  const decorated = deriveTitle(makeTask({ title: raw, featureName: "user-authentication" }), makeTitleSlice());
  assert.equal(decorated.finalTitle, `user-authentication: ${raw}`);
});

test("defaults scan 005 — default strip removes no other prefix (001 R6.7)", () => {
  const plain = makeTask({ title: "ignored" });
  const quirky = "[CUSTOM] Whatever: keeps Task 1.2: everything mid-title";
  assert.equal(stripTitleForRender(quirky, plain, makeTitleSlice({ titleStripPrefixes: emptyStripPrefixes })), quirky);
  // Only the leading local-ID prefix + redundant issue prefix are default-removable…
  const withId = makeTask({ localTaskId: "Task 1.2", title: "ignored" });
  assert.equal(
    stripTitleForRender("[SYNC-4] Task 1.2: Keep inner", withId, makeTitleSlice({ titleStripPrefixes: emptyStripPrefixes })),
    "Keep inner",
  );
  assert.equal(
    stripTitleForRender("Task 1.2: [SYNC-4] Keep inner", withId, makeTitleSlice({ titleStripPrefixes: emptyStripPrefixes })),
    "[SYNC-4] Keep inner",
    "strip is ordered feature → configured → issue → local, so the issue prefix is only redundant while LEADING",
  );
  // …and no organization/product literal prefix is ever baked in.
  assert.equal(stripTitleForRender("acme-internal: Task 1.2: x", plain, makeTitleSlice()), "acme-internal: Task 1.2: x");
});

test("defaults scan 005 — 005 sources contain no organization or product literal", () => {
  const offenders: string[] = [];
  for (const { file, text } of SHIPPED) {
    const lower = text.toLowerCase();
    for (const org of ORG_LITERALS) {
      if (lower.includes(org)) offenders.push(`${file}: contains '${org}'`);
    }
    assert.ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(text), `${file}: uuid-shaped value`);
    assert.ok(!/lin_api_[A-Za-z0-9]{12,}/.test(text), `${file}: token-shaped value`);
    assert.ok(!/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(text), `${file}: email material`);
  }
  assert.deepEqual(offenders, []);
});

test("defaults scan 005 — routing fixture identities are the sanctioned placeholders", () => {
  const maps = [nestedPrefixMap, tieMap];
  assert.ok(maps.length === 2, "routing maps exist to scan");
  for (const map of maps) {
    for (const entry of map) {
      assert.match(entry.teamKey, /^acme-/, `teamKey '${entry.teamKey}' is not a sanctioned acme-* placeholder`);
      assert.match(entry.project, /^proj-/, `project '${entry.project}' is not a sanctioned proj-* placeholder`);
      assert.match(entry.prefix, /^(specs|docs)\//, `prefix '${entry.prefix}' must be a generic discovery path`);
    }
  }
});

test("defaults scan 005 — title fixture rules/prefixes use only <areaPrefix*> placeholders", () => {
  // Rule area literals: the ONLY prefixes the preset rules add are the benign placeholder
  // tokens from the 001 R6 informative note (consumers supply real values; the tool ships none).
  for (const rule of [...areaRuleSet, ...absentAttrRules]) {
    for (const m of rule.matchAll(/<([^>]+)>/g)) {
      assert.match(m[1]!, /^areaPrefix[A-C]$/, `fixture rule embeds non-placeholder literal '<${m[1]}>'`);
    }
  }
  for (const prefix of areaStripPrefixes) {
    assert.ok(prefix.startsWith("<areaPrefix"), `strip prefix '${prefix}' is not a placeholder`);
  }
  // Generated identity pools stay lowercase-benign and generic.
  for (const feature of featurePool) {
    if (feature === undefined) continue;
    assert.match(feature, /^[a-z][a-z0-9-]*$/, `feature '${feature}' is not a generic placeholder`);
  }
  for (const phase of phasePool) {
    assert.ok(phase === undefined || phase === "Setup" || phase === "Delivery", `unexpected phase '${phase}'`);
  }
  // The default title/strip posture inherits only the generic frozen confirmationKey default.
  assert.equal(makeTitleSlice().confirmationKey, "SYNC");
});
