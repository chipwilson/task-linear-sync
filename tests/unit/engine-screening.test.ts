/**
 * T006 [P] — Unit tests for the default `SecurityScreener` (`src/engine/screening.ts`;
 * research R12; frozen `screen()` shape in `src/ports/engine.ts`). Blocking categories —
 * token/secret-shaped strings (high-entropy assignments, known provider key prefixes) and
 * private-key blocks — set `blocked` AND must never echo the matched content in `output`
 * (blocked findings abort propagation; they are not sanitized into acceptability — R12
 * alternative (c)), leaving content identifiable only by its category tag. Non-blocking —
 * email addresses are redacted in `output`; review-term rules annotate verbatim content.
 * The ruleset is injectable: `createDefaultSecurityScreener(config, rules?)` replaces the
 * built-in set, and `EngineOptions.screener` overrides `EngineDependencies.screener`
 * (research R12; `resolveScreener`). All fixtures are deterministic synthetic sentinels —
 * zero real credentials (Principle III).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { builtInDefaults } from "task-linear-sync/config";
import type { ResolvedConfig } from "task-linear-sync/config";
import type { SecurityScreener } from "task-linear-sync/ports";

import {
  builtInScreeningRules,
  createDefaultSecurityScreener,
} from "../../src/engine/screening.js";
import type { ScreeningRuleSet } from "../../src/engine/screening.js";
import { resolveEngineOptions, resolveScreener } from "../../src/engine/options.js";

// ── Synthetic sentinels (placeholder material only — Principle III) ─────────────────
const HIGH_ENTROPY = "a1B2c3D4e5F6g7H8i9J0k2L3xY"; // 24 chars, letters + digits
const GHP_TOKEN = "ghp_7NqPlaceholderSyntheticTokenMaterial01";
const SK_KEY = "sk-proj-Zk9PlaceholderSyntheticOpenAiMaterial0123";
// Synthetic Slack-SHAPED sentinel — assembled at runtime so no push-scanner sees a
// contiguous token literal; the composed value still matches the screener's
// `xox[baprse]-[A-Za-z0-9-]{10,}` blocking rule exactly (Principle III placeholder).
const XOXB_TOKEN = ["xoxb", "SYNTHETIC-fake-slack-shaped-sentinel"].join("-");
const AIZA_KEY = "AIzaSyPlaceholderSyntheticGoogleKey0000000000";
const LIN_PERSONAL_KEY = "lin_api_PlaceholderPersonalKeyMaterial00";
const KEY_BODY = "cGxhY2Vob2xkZXIgc3ludGhldGljIGtleSBtYXRlcmlhbCBwbGFjZWhvbGRlciBvbmx5Cg==";
const PRIVATE_KEY_BLOCK =
  `-----BEGIN OPENSSH PRIVATE KEY-----\n${KEY_BODY}\n-----END OPENSSH PRIVATE KEY-----`;

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

test("engine-screening — screen() returns the frozen shape and clean text passes through untouched", () => {
  const screener = createDefaultSecurityScreener(builtInDefaults);
  const clean = "Task 12 — implement retry policy with exponential backoff. Owner: backend guild.";
  const result = screener.screen(clean);
  assert.deepEqual(Object.keys(result).sort(), ["blocked", "findings", "output"]);
  assert.equal(result.output, clean);
  assert.deepEqual(result.blocked, []);
  assert.deepEqual(result.findings, []);

  const empty = screener.screen("");
  assert.equal(empty.output, "");
  assert.deepEqual(empty.blocked, []);
  assert.deepEqual(empty.findings, []);
});

test("engine-screening — high-entropy assignments block: secret-token listed, secret never echoed in output", () => {
  const screener = createDefaultSecurityScreener(builtInDefaults);
  const yaml = screener.screen(`Rotate the api_key=${HIGH_ENTROPY} before shipping.`);
  assert.ok(yaml.blocked.length > 0, "blocking finding must populate `blocked`");
  assert.deepEqual(yaml.blocked, ["secret-token"]);
  assert.ok(yaml.findings.includes("secret-token"));
  assert.ok(!yaml.output.includes(HIGH_ENTROPY), "output must not echo the matched secret");
  assert.ok(yaml.output.includes("secret-token"), "output identifies content only by category");
  assert.ok(yaml.output.includes("Rotate the") && yaml.output.includes("before shipping"));

  const json = screener.screen(`{"apiKey": "${HIGH_ENTROPY}"}`);
  assert.deepEqual(json.blocked, ["secret-token"]);
  assert.ok(!json.output.includes(HIGH_ENTROPY));

  // Heuristic boundary (R12: blocking targets HIGH-ENTROPY assignments — a short,
  // low-entropy value is not a blocking category and must not alter output.
  const weak = screener.screen("Password: hunter2");
  assert.deepEqual(weak.findings, []);
  assert.equal(weak.output, "Password: hunter2");

  // Prose merely naming a credential field (no assignment) is clean.
  const prose = screener.screen("The api_key field stores the rotation policy.");
  assert.deepEqual(prose.blocked, []);
  assert.deepEqual(prose.findings, []);
});

test("engine-screening — known provider key prefixes block without echoing the token", () => {
  const screener = createDefaultSecurityScreener(builtInDefaults);
  const cases: ReadonlyArray<readonly [string, string, string]> = [
    ["github", `GitHub token: ${GHP_TOKEN}`, GHP_TOKEN],
    ["openai", `openai ${SK_KEY} loaded`, SK_KEY],
    ["slack", `slack ${XOXB_TOKEN} revoked`, XOXB_TOKEN],
    ["google", `google api ${AIZA_KEY} rotated`, AIZA_KEY],
    ["linear personal key (config.personalKeyPrefix)", `linear: ${LIN_PERSONAL_KEY}`, LIN_PERSONAL_KEY],
  ];
  for (const [label, text, sentinel] of cases) {
    const result = screener.screen(text);
    assert.deepEqual(result.blocked, ["secret-token"], `${label}: must block as secret-token`);
    assert.ok(!result.output.includes(sentinel), `${label}: output must not echo the token`);
    assert.ok(!result.output.includes(sentinel.slice(-12)), `${label}: no token tail survives`);
    assert.ok(result.output.includes("secret-token"), `${label}: category tag identifies content`);
  }
});

test("engine-screening — bearer-shaped material blocks", () => {
  const screener = createDefaultSecurityScreener(builtInDefaults);
  const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9";
  const result = screener.screen(`Authorization: Bearer ${jwt} (session dump)`);
  assert.deepEqual(result.blocked, ["secret-token"]);
  assert.ok(!result.output.includes(jwt));
});

test("engine-screening — private key blocks are blocked and their material never appears in output", () => {
  const screener = createDefaultSecurityScreener(builtInDefaults);
  const result = screener.screen(`backup:\n${PRIVATE_KEY_BLOCK}\nkeep safe`);
  assert.deepEqual(result.blocked, ["private-key"]);
  assert.deepEqual(result.findings, ["private-key"]);
  assert.ok(!result.output.includes("BEGIN"), "never echo the block");
  assert.ok(!result.output.includes(KEY_BODY), "never echo key material");
  assert.ok(!result.output.toLowerCase().includes("private key"));
  assert.ok(result.output.includes("private-key"), "content identifiable by category only");
  assert.ok(result.output.includes("backup") && result.output.includes("keep safe"));
});

test("engine-screening — email addresses are redacted in output and never blocking", () => {
  const screener = createDefaultSecurityScreener(builtInDefaults);
  const text = "Ping ops@example.test (or reviewer.name+spec@example.invalid) for the export.";
  const result = screener.screen(text);
  assert.deepEqual(result.blocked, []);
  assert.deepEqual(result.findings, ["email"]);
  assert.ok(!result.output.includes("ops@example.test"), "email redacted");
  assert.ok(!result.output.includes("+spec@example.invalid"), "email redacted");
  assert.ok(result.output.includes("email"));
  assert.ok(result.output.includes("Ping") && result.output.includes("for the export."));
});

test("engine-screening — review terms annotate (non-blocking) and keep content verbatim", () => {
  const screener = createDefaultSecurityScreener(builtInDefaults);
  const text = "Milestone copy needs REVIEW REQUIRED before publish.";
  const result = screener.screen(text);
  assert.deepEqual(result.blocked, [], "review-term must never block");
  assert.deepEqual(result.findings, ["review-term"]);
  assert.ok(result.output.includes("REVIEW REQUIRED"), "annotation keeps content verbatim");
  assert.ok(result.output.includes("[review-term]"), "annotation names the category");
});

test("engine-screening — mixed content reports every category (deduped) and strips blocked + redacted material", () => {
  const screener = createDefaultSecurityScreener(builtInDefaults);
  const text =
    `Ping ops@example.test (cc lead@example.test) — deploy key = "${HIGH_ENTROPY}" before launch.`;
  const first = screener.screen(text);
  assert.deepEqual(first.blocked, ["secret-token"]);
  assert.deepEqual(first.findings, ["secret-token", "email"], "labels deduped, rule order");
  for (const label of first.blocked) assert.ok(first.findings.includes(label), "blocked ⊆ findings");
  assert.ok(!first.output.includes(HIGH_ENTROPY));
  assert.ok(!first.output.includes("ops@example.test") && !first.output.includes("lead@example.test"));
  assert.ok(first.output.includes("Ping") && first.output.includes("before launch"));
  // Deterministic: repeated screens over the same text are identical (no scanner state).
  assert.deepEqual(screener.screen(text), first);
  assert.deepEqual(screener.screen("backup:\n" + PRIVATE_KEY_BLOCK), screener.screen("backup:\n" + PRIVATE_KEY_BLOCK));
});

test("engine-screening — builtInScreeningRules: shape, compilable patterns, blocking vocabulary, config-driven prefix", () => {
  const rules = builtInScreeningRules(builtInDefaults);
  assert.ok(rules.length >= 4, "default rule set populated");
  for (const rule of rules) {
    assert.ok(rule.category.length > 0);
    assert.equal(typeof rule.blocking, "boolean");
    assert.ok(new RegExp(rule.pattern) instanceof RegExp, `pattern must compile: ${rule.category}`);
  }
  const blockingCategories = [...new Set(rules.filter((r) => r.blocking).map((r) => r.category))].sort();
  assert.deepEqual(blockingCategories, ["private-key", "secret-token"], "only secret classes block");
  const nonBlocking = new Set(rules.filter((r) => !r.blocking).map((r) => r.category));
  assert.ok(nonBlocking.has("email"));
  assert.ok(nonBlocking.has("review-term"));

  // Built-in material derives from config.personalKeyPrefix — no hardcoded org tokens.
  assert.ok(
    rules.some((r) => r.blocking && r.category === "secret-token" && r.pattern.includes(builtInDefaults.personalKeyPrefix)),
    "personal-key-prefix rule sourced from config",
  );
  const altConfig = structuredClone(builtInDefaults) as unknown as Mutable<ResolvedConfig>;
  altConfig.personalKeyPrefix = "sync_pk_";
  const altRules = builtInScreeningRules(altConfig);
  assert.ok(altRules.some((r) => r.pattern.includes("sync_pk_")));
  assert.ok(!altRules.some((r) => r.pattern.includes(builtInDefaults.personalKeyPrefix)));
});

test("engine-screening — injected rules REPLACE the built-in set (createDefaultSecurityScreener rules override)", () => {
  const custom: ScreeningRuleSet = [
    { category: "demo-term", pattern: "drop\\s+tables?", blocking: false, redact: false },
    { category: "demo-blocked", pattern: "TOPSECRET-[A-Z0-9]{4,}", blocking: true },
  ];
  const injected = createDefaultSecurityScreener(builtInDefaults, custom);

  const annotated = injected.screen("please drop tables now; ops@example.test");
  assert.deepEqual(annotated.blocked, []);
  assert.deepEqual(annotated.findings, ["demo-term"]);
  assert.ok(annotated.output.includes("drop tables"), "annotation keeps content");
  assert.ok(annotated.output.includes("[demo-term]"));
  assert.ok(annotated.output.includes("ops@example.test"), "built-in email rule is replaced, not merged");

  const blocked = injected.screen("TOPSECRET-ABCD1 leaked");
  assert.deepEqual(blocked.blocked, ["demo-blocked"]);
  assert.ok(!blocked.output.includes("TOPSECRET-ABCD1"), "custom blocking content never echoed");
  assert.ok(blocked.output.includes("[blocked:demo-blocked]"));

  const none = createDefaultSecurityScreener(builtInDefaults, []);
  const passthrough = none.screen(`api_key=${HIGH_ENTROPY}`);
  assert.deepEqual(passthrough.findings, [], "empty ruleset screens everything clean");
  assert.equal(passthrough.output, `api_key=${HIGH_ENTROPY}`);
});

test("engine-screening — EngineOptions.screener overrides EngineDependencies.screener (resolveScreener)", () => {
  const depsScreener: SecurityScreener = {
    screen: (text: string) => ({ output: text, blocked: [], findings: ["deps-screener"] }),
  };
  const optionScreener: SecurityScreener = {
    screen: (text: string) => ({ output: text, blocked: [], findings: ["options-screener"] }),
  };
  const defaultOptions = resolveEngineOptions(undefined, builtInDefaults);
  assert.equal(resolveScreener({ screener: depsScreener }, defaultOptions), depsScreener);

  const overridden = resolveEngineOptions({ screener: optionScreener }, builtInDefaults);
  assert.equal(resolveScreener({ screener: depsScreener }, overridden), optionScreener);
});
