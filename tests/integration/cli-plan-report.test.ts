/**
 * T030 [US2] — plan/check plan review report content (FR-006/007/008, SC-001/SC-003;
 * contracts/plan-review-report.md §2): the per-entry field set is complete for every
 * entry; groups sort project→milestone; the `unmapped` section proves `parentMapped`
 * true iff a descendant is mapped (mapped-sibling-only parent stays `false`); the
 * unresolved-marker conflict surfaces in BOTH artifacts; the computed security
 * assertions pass; sentinel raw bodies/descriptions appear in NEITHER artifact
 * (whole-corpus scan); artifacts exist only under `reports/<runId>/`; the fixture repo
 * tree is byte-identical before/after.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { ExitCode, runCli } from "../../src/cli/index.js";
import { buildCliWorld, hashTree, listTree, type CliWorld } from "../helpers/cli-harness.js";

/** Durable issue ids from `worlds/review-report/world.json` (stable fixture values). */
const ACME_2 = "ac000000-0000-4000-8000-000000000302"; // unresolved-marker task (1.2)
const ACME_90 = "ac000000-0000-4000-8000-000000000390"; // unmapped parent, DESCENDANT mapped
const ACME_92 = "ac000000-0000-4000-8000-000000000392"; // unmapped parent, sibling mapped only

/** SC-001 sentinels: raw task body (1.1), raw issue description (ACME-1), secret shape. */
const SENSITIVE_TEXTS = [
  "SENTINEL-RAW-BODY-ALPHA-ONE",
  "SENTINEL-RAW-DESCRIPTION-ALPHA-ONE",
  "SECRET555",
];

interface ReportEntry {
  taskUuid: string;
  issueId: string | null;
  decision: string;
  filePath: string;
  confidence: string;
  unresolvedConflict?: boolean;
  descriptionContentHash: string;
  [key: string]: unknown;
}

interface ReportJson {
  schemaVersion: number;
  planId: string;
  groups: { project: string; milestone: string; entries: ReportEntry[] }[];
  unmapped: { issueId: string; teamKey: string; project: string; title: string; parentMapped: boolean }[];
  securityAssertions: { guarantee: string; status: string; detail?: string }[];
  [key: string]: unknown;
}

/** The frozen schema's per-entry field set (specs/002 plan-report.schema.json $defs). */
const ENTRY_FIELDS = new Set([
  "taskUuid",
  "issueId",
  "decision",
  "framework",
  "featureName",
  "filePath",
  "confidence",
  "score",
  "margin",
  "reasons",
  "alternatives",
  "changedFields",
  "descriptionContentHash",
  "expectedMarkdownChanges",
  "lowConfidenceGateStatus",
  "unresolvedConflict",
  "routing",
  "attachmentUrls",
]);

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Plan via runCli; return the planId plus both artifact texts (paths from stdout). */
async function runPlan(w: CliWorld): Promise<{ planId: string; json: ReportJson; jsonText: string; md: string }> {
  const { cliContext, stdout, stderr } = w.createContext();
  const outcome = await runCli(["plan", w.repositoryRoot], cliContext);
  assert.equal(outcome.exitCode, ExitCode.SUCCESS, stderr.join("\n"));
  const planId = /plan ([0-9a-f]{64})/.exec(stdout.join("\n"))?.[1];
  const jsonPath = stdout.find((l) => l.startsWith("report ") && l.endsWith("report.json"))?.slice("report ".length);
  const mdPath = stdout.find((l) => l.startsWith("report ") && l.endsWith("report.md"))?.slice("report ".length);
  assert.ok(planId && jsonPath && mdPath, stdout.join("\n"));
  const jsonText = readFileSync(jsonPath as string, "utf8");
  return { planId: planId as string, json: JSON.parse(jsonText) as ReportJson, jsonText, md: readFileSync(mdPath as string, "utf8") };
}

async function withWorld<T>(fn: (w: CliWorld) => Promise<T>): Promise<T> {
  const w = await buildCliWorld("review-report");
  try {
    return await fn(w);
  } finally {
    await w.dispose();
  }
}

test("plan and check announce artifact paths that exist; check agrees on the same plan", async () => {
  await withWorld(async (w) => {
    const { planId, json } = await runPlan(w);

    const { cliContext, stdout, stderr } = w.createContext();
    const outcome = await runCli(["check", w.repositoryRoot], cliContext);
    assert.equal(outcome.exitCode, ExitCode.CHECK_FINDINGS, stderr.join("\n")); // conflict findings
    assert.equal(stdout.length, 1);
    const summary = JSON.parse(stdout[0] as string) as {
      planId: string;
      reportJson: string;
      reportMarkdown: string;
      counts: Record<string, number>;
    };
    assert.equal(summary.planId, planId); // deterministic plan rebuild (fixed clock)
    assert.deepEqual(JSON.parse(readFileSync(summary.reportJson, "utf8")) as ReportJson, json);
    assert.ok(summary.reportMarkdown.endsWith("report.md"));

    // Counts read off the artifact (same recomputation rules as contracts §4).
    const entries = json.groups.flatMap((g) => g.entries);
    assert.equal(summary.counts.entries, entries.length);
    assert.equal(summary.counts.unmapped, json.unmapped.length);
    assert.equal(
      summary.counts.unresolvedConflicts,
      entries.filter((e) => e.decision === "conflict" || e.unresolvedConflict === true).length,
    );
    assert.equal(summary.counts.lowConfidence, entries.filter((e) => e.confidence === "low").length);
    assert.ok((summary.counts.unresolvedConflicts as number) >= 1);
  });
});

test("every report entry carries exactly the complete bounded field set", async () => {
  await withWorld(async (w) => {
    const { json, jsonText } = await runPlan(w);
    const entries = json.groups.flatMap((g) => g.entries);
    assert.ok(entries.length > 0);
    for (const entry of entries) {
      for (const field of [
        "taskUuid",
        "issueId",
        "decision",
        "framework",
        "filePath",
        "confidence",
        "descriptionContentHash",
      ]) {
        assert.ok(field in entry, `entry missing ${field}`);
      }
      for (const key of Object.keys(entry)) {
        assert.ok(ENTRY_FIELDS.has(key), `unexpected entry field ${key}`);
        // No raw body/description-bearing property names (SC-005, computed assertion).
        const lower = key.toLowerCase();
        const rawTextShaped = /(body|description|content)/.test(lower) && !lower.endsWith("hash");
        assert.equal(rawTextShaped, false, `raw-text-shaped property ${key}`);
      }
      assert.match(entry.taskUuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
      // Description material travels as hashes only.
      assert.match(entry.descriptionContentHash, SHA256_HEX);
    }
    assert.ok(json.planId.match(SHA256_HEX));
    assert.ok(jsonText.length > 0);
  });
});

test("groups sort project→milestone; Markdown is human-oriented while JSON stays durable", async () => {
  await withWorld(async (w) => {
    const { json, md } = await runPlan(w);
    const keys = json.groups.map((g) => [g.project, g.milestone] as const);
    const sorted = [...keys].sort(
      (a, b) => a[0].localeCompare(b[0], "en") || a[1].localeCompare(b[1], "en"),
    );
    assert.deepEqual(keys, sorted);
    assert.ok(
      json.groups.some((g) => g.project === "proj-alpha" && g.milestone === "alpha-feature"),
      "alpha group present",
    );

    // Markdown names sections human-readably; durable ids appear alongside entries.
    assert.ok(md.includes("# Sync Plan Report"));
    assert.ok(md.includes("### Project: proj-alpha"));
    assert.ok(md.includes("#### Milestone: alpha-feature"));
    assert.ok(md.includes("#### Milestone: gamma-feature"));
    const alphaPos = md.indexOf("### Project: proj-alpha");
    const betaPos = md.indexOf("### Project: proj-beta");
    const gammaPos = md.indexOf("#### Milestone: gamma-feature");
    assert.ok(alphaPos < gammaPos && gammaPos < betaPos, "markdown follows JSON order");
  });
});

test("unmapped section is separate and parentMapped is true iff a DESCENDANT is mapped", async () => {
  await withWorld(async (w) => {
    const { json, md } = await runPlan(w);
    const byId = new Map(json.unmapped.map((u) => [u.issueId, u]));
    // ACME-90: never paired (project-gated), but its child ACME-91 IS mapped.
    assert.equal(byId.get(ACME_90)?.parentMapped, true, "mapped descendant ⇒ parentMapped");
    // ACME-92: its only mapped relation is a SIBLING task — must stay false.
    assert.equal(byId.get(ACME_92)?.parentMapped, false, "mapped sibling alone ⇒ false");
    for (const id of [ACME_90, ACME_92]) {
      const issue = byId.get(id);
      assert.ok(issue, `unmapped section lists ${id}`);
      assert.ok(!json.groups.some((g) => g.entries.some((e) => e.issueId === id)), `${id} not in entries`);
      assert.ok(md.includes(issue.title), `markdown names ${id} title`);
    }
    assert.ok(md.includes("## Unmapped Issues"));
    assert.ok(md.includes("descendant mapped"));
  });
});

test("the conflict task surfaces in BOTH artifacts with the human-marker section", async () => {
  await withWorld(async (w) => {
    const { json, md } = await runPlan(w);
    const entries = json.groups.flatMap((g) => g.entries);

    // JSON flags: the conflict-marker task is flagged unresolved; conflicts are decisions.
    const markerTask = entries.find((e) => e.issueId === ACME_2);
    assert.ok(markerTask, "1.2 conflict-marker task present");
    assert.equal(markerTask.unresolvedConflict, true);
    assert.equal(markerTask.decision, "skip-unresolved");
    assert.ok(
      entries.some((e) => e.decision === "conflict"),
      "both-changed conflicts carry the conflict decision",
    );

    // Markdown: the dedicated section names the unresolved task + the awaiting marker.
    const section = md.slice(md.indexOf("## Unresolved Conflicts"), md.indexOf("## Unmapped Issues"));
    assert.ok(section.length > 0);
    assert.ok(section.includes("AWAITING HUMAN MARKER RESOLUTION"));
    assert.ok(section.includes(markerTask.taskUuid), "section names the marker task by uuid");
    assert.ok(section.includes(ACME_2));
    // The awaiting marker rides the JSON flag (single source of truth), not the JSON text.
    assert.equal(json.groups.some((g) => g.entries.some((e) => e.unresolvedConflict === true)), true);
  });
});

test("security-assertions block contains the computed content-exclusion assertions, passing", async () => {
  await withWorld(async (w) => {
    const { json } = await runPlan(w);
    const byName = new Map(json.securityAssertions.map((a) => [a.guarantee, a]));
    for (const guarantee of [
      "no-raw-body-or-description-fields",
      "description-material-hashed-only",
      "zero-tracker-mutations",
      "zero-repository-writes",
    ]) {
      assert.equal(byName.get(guarantee)?.status, "pass", guarantee);
      assert.ok(byName.get(guarantee)?.detail, `detail for ${guarantee}`);
    }
  });
});

test("SC-001: sentinel raw bodies/descriptions appear in NO artifact (whole-corpus scan)", async () => {
  await withWorld(async (w) => {
    // One plan + one check: every state-dir file from both runs is scanned.
    await runPlan(w);
    const { cliContext, stderr } = w.createContext();
    assert.equal((await runCli(["check", w.repositoryRoot], cliContext)).exitCode, ExitCode.CHECK_FINDINGS, stderr.join("\n"));
    for (const rel of listTree(w.stateDir)) {
      const text = readFileSync(join(w.stateDir, rel), "utf8");
      for (const sensitive of SENSITIVE_TEXTS) {
        assert.equal(text.includes(sensitive), false, `${sensitive} leaked into ${rel}`);
      }
    }
  });
});

test("artifacts exist only under plans/ + reports/ and the repo tree is byte-identical", async () => {
  await withWorld(async (w) => {
    const repoBefore = hashTree(w.repositoryRoot);
    const { planId } = await runPlan(w);
    const files = listTree(w.stateDir);
    const reportDirs = new Set(files.filter((f) => f.startsWith("reports/")).map((f) => f.split("/")[1]));
    assert.equal(reportDirs.size, 1);
    const runId = [...reportDirs][0] as string;
    assert.match(runId, SHA256_HEX);
    assert.deepEqual(files, [
      `plans/${planId}.json`,
      `reports/${runId}/report.json`,
      `reports/${runId}/report.md`,
    ]);
    assert.equal(hashTree(w.repositoryRoot), repoBefore); // SC-003: zero repo writes
  });
});
