/**
 * T021 [US1] — contract test for the 006 public surface (002 R15 snapshot pattern) plus
 * behavioral invariants 1–9 of contracts/matching-api.md over generated corpora, and the
 * parallel-safety greps ("src/matching/** imports ONLY task-linear-sync/{domain,config,
 * urls,ports} and Node built-ins — no src/discovery|parsing|routing|tracker").
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { loadConfig } from "task-linear-sync/config";
import {
  assignUsable,
  bandAndMargin,
  checkMatchingConfig,
  DurableIdentityCollisionError,
  matchAllTasks,
  MatchingConfigError,
  normalizeTitle,
  overlapRatio,
  projectCandidates,
  resolveWeights,
  scorePair,
  serializeMatchingResult,
  tokenize,
} from "task-linear-sync/matching";
import { defaultConfig, makeCandidate, makeTask, readJsonFixture } from "../helpers/matching-factory.js";
import { generateCorpus } from "../helpers/matching-corpus.js";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const snapshotPath = new URL("file://" + pkgRoot + "tests/contract/snapshots/matching-surface.json");

/** 006's own frozen-name-set snapshot (research R10) — the 002 frozen-surface pattern. */
function currentSurface(): string[] {
  const dtsPath = new URL(`file://${pkgRoot}dist/matching/index.d.ts`);
  assert.ok(existsSync(dtsPath), "missing declaration for src/matching (run npm run build)");
  const dts = readFileSync(dtsPath, "utf8");
  const names = new Set<string>();
  const EXPORT_RE =
    /\bexport\s+(?:declare\s+)?(?:abstract\s+)?(?:async\s+)?(?:interface|type|function|const|let|class|enum)\s+([A-Za-z0-9_$]+)/g;
  const EXPORT_LIST_RE = /\bexport\s+(?:declare\s+)?(?:type\s+)?\{([^}]*)\}/g;
  for (const m of dts.matchAll(EXPORT_RE)) names.add(m[1]!);
  for (const m of dts.matchAll(EXPORT_LIST_RE)) {
    for (const clause of m[1]!.split(",")) {
      const name = clause.trim().split(/\s+as\s+/).pop()?.trim();
      if (name && name !== "type") names.add(name.replace(/^type\s+/, ""));
    }
  }
  return [...names].sort();
}

test("matching-api contract: exported name set matches the checked-in 006 surface snapshot", () => {
  const current = currentSurface();
  if (process.env.UPDATE_MATCHING_SNAPSHOT === "1") {
    writeFileSync(snapshotPath, JSON.stringify(current, null, 2) + "\n");
    return;
  }
  assert.ok(
    existsSync(snapshotPath),
    "snapshot missing: generate with UPDATE_MATCHING_SNAPSHOT=1 npm run test:contract",
  );
  const checkedIn = JSON.parse(readFileSync(snapshotPath, "utf8")) as string[];
  assert.deepEqual(current, checkedIn, "006 public surface drift is a breaking change (contract)");
  for (const required of [
    "matchAllTasks",
    "projectCandidates",
    "serializeMatchingResult",
    "checkMatchingConfig",
    "MatchingConfigError",
    "DurableIdentityCollisionError",
    "MatchingResult",
    "MatchCandidate",
    "TaskMatchInput",
    "MatchingWeightOverrides",
  ]) {
    assert.ok(current.includes(required), `surface must include '${required}'`);
  }
});

const config = defaultConfig();

test("matching-api contract: invariants over 30 seeded corpora (one-to-one, single band, integers, ≤3 alternatives)", () => {
  for (let seed = 500; seed < 530; seed += 1) {
    const corpus = generateCorpus({ seed, tasks: 10, extraIssues: 5, durableRate: 0.5, refRate: 0.3 });
    const result = matchAllTasks(corpus.inputs, corpus.candidates, config);
    const seenTasks = new Set<string>();
    const seenIssues = new Set<string>();
    for (const m of result.matches) {
      assert.ok(!seenTasks.has(m.taskUuid), "invariant 1: taskUuid appears ≤ 1 time");
      assert.ok(!seenIssues.has(m.issueId), "invariant 1: issueId appears ≤ 1 time");
      seenTasks.add(m.taskUuid);
      seenIssues.add(m.issueId);
      assert.ok(["high", "medium", "low"].includes(m.confidence), "invariant 4: selected band ∈ usable set");
      assert.ok(Number.isInteger(m.score) && m.score >= 0, "invariant 5: score integer ≥ 0");
      assert.ok(Number.isInteger(m.margin) && m.margin >= 0, "invariant 5: margin integer ≥ 0");
      assert.ok(m.score >= config.confidenceFloors.plausible, "only usable (≥ plausible) pairs win selection");
      assert.ok(m.alternatives.length <= 3, "invariant 5: alternatives.length ≤ 3");
      for (let i = 1; i < m.alternatives.length; i += 1) {
        const a = m.alternatives[i - 1]!;
        const b = m.alternatives[i]!;
        assert.ok(a.score > b.score || (a.score === b.score && a.issueId < b.issueId), "alternatives ordered (score desc, issueId asc)");
      }
      assert.ok(
        m.reasons.filter((r) => r === "ambiguous-margin").length <= 1,
        "invariant 5: ambiguous-margin recorded at most once",
      );
      assert.ok(m.reasons.length >= 1, "every match explains itself with signal labels");
    }
    // Every task appears exactly once across matches ∪ unresolved.
    const unresolvedIds = result.unresolved.map((u) => u.taskUuid);
    assert.equal(
      [...seenTasks, ...unresolvedIds].sort().join(),
      corpus.inputs.map((i) => i.task.stableUuid).sort().join(),
      "every task is matched or unresolved — never neither, never both",
    );
    for (const u of result.unresolved) assert.equal(u.band, "unmatched", "invariant 4: unresolved band fixed unmatched");
    // unmappedIssues = candidates not selected, sorted.
    const expectedUnmapped = corpus.candidates.map((c) => c.issueId).filter((id) => !seenIssues.has(id)).sort();
    assert.deepEqual([...result.unmappedIssues].sort(), expectedUnmapped);
    // Determinism (invariant 2) — same bytes on a re-run.
    assert.equal(
      serializeMatchingResult(result),
      serializeMatchingResult(matchAllTasks(corpus.inputs, corpus.candidates, config)),
    );
  }
});

test("matching-api contract: assignment optimality spot-check through the orchestrator (invariant 3, SC-003 path)", () => {
  // t1 and t2 both want i-0001; only t2 can use i-0002 well — orchestrator must find the 110 optimum.
  const t1 = makeTask({ stableUuid: "a0000000-0000-4000-8000-000000000001", title: "Shared contested title" });
  const t2 = makeTask({ stableUuid: "b0000000-0000-4000-8000-000000000002", title: "Shared contested title", issueRef: { key: "SYNC", number: 77 } });
  const result = matchAllTasks(
    [{ task: t1 }, { task: t2 }],
    [
      makeCandidate({ issueId: "i-0001", issueKey: "ENG-77", title: "Shared contested title" }),
      makeCandidate({ issueId: "i-0002", issueKey: "ENG-78", title: "Shared contested title also" }),
    ],
    config,
  );
  const byTask = new Map(result.matches.map((m) => [m.taskUuid, m]));
  assert.equal(byTask.get(t2.stableUuid)?.issueId, "i-0001", "ref owner takes i-0001");
  assert.ok(byTask.get(t1.stableUuid), "t1 still matched (contained title elsewhere) — optimal use of capacity");
});

test("matching-api contract: MatchingConfigError guards matchAllTasks + projectCandidates entries (invariant 8)", () => {
  const broken = loadConfig({ overrides: { minimumMatchMargin: 0 } });
  assert.throws(() => matchAllTasks([], [], broken), MatchingConfigError);
  assert.throws(
    () => projectCandidates({ issues: [], attachmentsByIssue: {}, config: broken }),
    MatchingConfigError,
  );
  assert.throws(() => checkMatchingConfig(broken), MatchingConfigError);
});

test("matching-api contract: DurableIdentityCollisionError is the typed integrity abort surface (invariant 6)", () => {
  const fixture = readJsonFixture<{
    issues: never[];
    attachmentsByIssue: Record<string, never[]>;
    expected: { taskUuid: string; issueIds: string[] };
  }>("matching/dup-uuid/case-a.json");
  assert.throws(
    () => projectCandidates({ issues: fixture.issues, attachmentsByIssue: fixture.attachmentsByIssue, config }),
    (e: unknown) =>
      e instanceof DurableIdentityCollisionError &&
      e.taskUuid === fixture.expected.taskUuid &&
      JSON.stringify(e.issueIds) === JSON.stringify([...fixture.expected.issueIds].sort()),
  );
});

test("matching-api contract: zero side effects — src/matching sources never touch fs/net/clock/random (invariant 7)", () => {
  const srcDir = `${pkgRoot}src/matching`;
  const banned = /\b(node:fs|node:net|node:http|node:https|node:dns|fetch\s*\(|Math\.random|Date\.now|new Date\b|process\.env|Bun\.|Deno\.)/;
  for (const file of readdirSync(srcDir).filter((f) => f.endsWith(".ts"))) {
    const text = readFileSync(`${srcDir}/${file}`, "utf8");
    assert.ok(!banned.test(text), `src/matching/${file} must be pure — banned token found`);
  }
});

test("matching-api contract: parallel-safety greps — imports limited to task-linear-sync/{domain,config,urls,ports}, relatives, and Node built-ins", () => {
  const srcDir = `${pkgRoot}src/matching`;
  const importRe = /(?:from|import)\s+["']([^"']+)["']/g;
  const allowed = /^(task-linear-sync\/(domain|config|urls|ports)|node:[a-z/]+|\.{1,2}\/[A-Za-z0-9_./-]+\.js)$/;
  for (const file of readdirSync(srcDir).filter((f) => f.endsWith(".ts"))) {
    const text = readFileSync(`${srcDir}/${file}`, "utf8");
    for (const m of text.matchAll(importRe)) {
      const specifier = m[1]!;
      assert.match(
        specifier,
        allowed,
        `src/matching/${file}: forbidden import '${specifier}' (sibling/other-module import breaks Wave-2 disjointness)`,
      );
    }
  }
  const forbidden = /task-linear-sync\/(discovery|parsing|routing|tracker)|src\/(discovery|parsing|routing|tracker)/;
  for (const file of readdirSync(srcDir).filter((f) => f.endsWith(".ts"))) {
    assert.ok(!forbidden.test(readFileSync(`${srcDir}/${file}`, "utf8")), `forbidden sibling reference in src/matching/${file}`);
  }
});

test("matching-api contract: the exported vocabulary type-checks against its declared shapes (compile-time pin)", () => {
  const weights = resolveWeights(config);
  const task = makeTask({ title: "purity pin" });
  const candidate = makeCandidate({ title: "purity pin" });
  const pair = scorePair({ task }, candidate, weights);
  const selected = assignUsable([{ ...pair, usable: true }])[0]!;
  const [match] = bandAndMargin([selected], [selected], config);
  assert.equal(typeof normalizeTitle("X"), "string");
  assert.deepEqual(tokenize("x"), ["x"]);
  assert.equal(typeof overlapRatio("x", "x"), "number");
  assert.equal(match?.confidence, "high");
});
