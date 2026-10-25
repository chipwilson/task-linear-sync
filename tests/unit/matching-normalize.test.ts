/**
 * T007 [foundational] — deterministic title normalization + tokenization unit tests
 * (research R2, verbatim pipeline):
 *  1. strip a leading visible issue-prefix token `^\[[A-Za-z0-9_-]+-\d+\]\s*`
 *  2. strip a leading `<featureName>: ` decoration "only if the task carries a
 *     `featureName` and the candidate title begins with that exact prefix"
 *  3. "Unicode NFKC, casefold, collapse runs of whitespace to single spaces, trim"
 *  4. tokenize on the collapsed-whitespace split; Dice coefficient over token
 *     multisets: `overlapRatio = 2·|common multiset| / (|A| + |B|)`, "0.0 when either
 *     side empty".
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeTitle, overlapRatio, tokenize } from "task-linear-sync/matching";

test("matching-normalize: strips a leading visible [KEY-N] issue prefix", () => {
  assert.equal(normalizeTitle("[SYNC-42] Implement login form"), "implement login form");
  assert.equal(normalizeTitle("[ENG-7] Cache Sweeper"), "cache sweeper");
  assert.equal(normalizeTitle("[a_b-C-0009]  spaced   out "), "spaced out");
});

test("matching-normalize: only the leading prefix token is stripped (interior/second occurrences kept)", () => {
  assert.equal(normalizeTitle("[SYNC-1] [SYNC-2] task"), "[sync-2] task");
  assert.equal(normalizeTitle("rebuild [SYNC-1] module"), "rebuild [sync-1] module");
});

test("matching-normalize: bracket tokens that are not KEY-N references are kept", () => {
  assert.equal(normalizeTitle("[no-number] task"), "[no-number] task");
  assert.equal(normalizeTitle("[99-lives] task"), "[99-lives] task"); // 'lives' is not -<digits>
});

test("matching-normalize: strips the exact '<featureName>: ' decoration only when supplied and matched", () => {
  assert.equal(normalizeTitle("auth: Implement login", { featureName: "auth" }), "implement login");
  // Task without featureName ⇒ no strip ("only if the task carries a featureName").
  assert.equal(normalizeTitle("auth: Implement login"), "auth: implement login");
  // Different featureName ⇒ no strip ("begins with that exact prefix").
  assert.equal(normalizeTitle("auth: Implement login", { featureName: "search" }), "auth: implement login");
  // Exact prefix is byte-exact before casefolding — different case is not the exact prefix.
  assert.equal(normalizeTitle("Auth: Implement login", { featureName: "auth" }), "auth: implement login");
  // Missing the single space after the colon ⇒ not the decoration.
  assert.equal(normalizeTitle("auth:Implement login", { featureName: "auth" }), "auth:implement login");
});

test("matching-normalize: visible prefix and feature decoration undo in step order", () => {
  assert.equal(
    normalizeTitle("[SYNC-3] auth:  Implement   login", { featureName: "auth" }),
    "implement login",
  );
});

test("matching-normalize: NFKC, casefold, whitespace collapse and trim (deterministic golden cases)", () => {
  assert.equal(normalizeTitle("ﬁle ＴＹＰＥ ①"), "file type 1"); // ligature, fullwidth, circled digit
  assert.equal(normalizeTitle("ＡＢ　\u{1F600}"), "ab \u{1F600}"); // fullwidth + ideographic space collapses
  assert.equal(normalizeTitle("  Implement\t\n login \u00a0form  "), "implement login form"); // NBSP via NFKC → space
  assert.equal(normalizeTitle("İstanbul"), "i\u0307stanbul"); // locale-independent toLowerCase, no toLocaleLowerCase
  assert.equal(normalizeTitle("Ünïcödé Café"), "ünïcödé café"); // accented casefold
});

test("matching-normalize: empty and whitespace-only titles normalize to empty", () => {
  assert.equal(normalizeTitle(""), "");
  assert.equal(normalizeTitle("   \t\n "), "");
  assert.equal(normalizeTitle("[SYNC-9] "), "");
});

test("matching-normalize: determinism — repeated calls byte-identical", () => {
  const samples = ["[SYNC-1] a", "auth: B  c", "ﬁle", "", "  x\t\ty  "];
  for (const s of samples) {
    assert.equal(normalizeTitle(s, { featureName: "auth" }), normalizeTitle(s, { featureName: "auth" }));
  }
});

test("matching-normalize: tokenize splits on collapsed whitespace", () => {
  assert.deepEqual(tokenize("implement login form"), ["implement", "login", "form"]);
  assert.deepEqual(tokenize(""), []);
  assert.deepEqual(tokenize("   "), []);
  assert.deepEqual(tokenize("  a   b "), ["a", "b"]); // tolerant of raw (uncollapsed) input
});

test("matching-normalize: overlapRatio is the Dice coefficient over token multisets", () => {
  assert.equal(overlapRatio("a b", "a b"), 1);
  assert.equal(overlapRatio("a b c", "a b"), (2 * 2) / 5); // 2·|common| / (|A|+|B|)
  assert.equal(overlapRatio("a b c", "x y"), 0);
  // Multiset semantics: one shared 'a' and one shared 'b' only.
  assert.equal(overlapRatio("a a b", "a b b"), (2 * 2) / 6);
});

test("matching-normalize: overlapRatio is 0.0 when either side is empty (verbatim)", () => {
  assert.equal(overlapRatio("", "a b"), 0);
  assert.equal(overlapRatio("a b", ""), 0);
  assert.equal(overlapRatio("", ""), 0);
});

test("matching-normalize: normalized titles feed equal ratios independent of decoration", () => {
  const task = normalizeTitle("Implement login form");
  const candidate = normalizeTitle("[SYNC-42] auth: Implement login form", { featureName: "auth" });
  assert.equal(task, candidate);
  assert.equal(overlapRatio(task, candidate), 1);
});
