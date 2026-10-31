/**
 * T025 [US1] — `src/engine/report.ts` unit tests: plan persistence + sanitized report
 * artifacts (research R13; contracts/engine-pipeline.md stage 7; frozen
 * `plan-report.schema.json`; 009 FR-006/007/008; FR-005 conflict surfacing).
 *
 * Scope: the pure/contract-level logic that needs NO engine wiring —
 * - `buildPlanReportJson` assembles a document that validates against the FROZEN schema
 *   field-for-field (minimal draft-2020-12 validator copied from the T012 precedent in
 *   `tests/contract/report-schema.test.ts`, run against the same schema file);
 * - project→milestone grouping + separate unmapped section + conflict/assertion sections
 *   in the rendered markdown;
 * - structural exclusion: raw task-body text exists ONLY as its sha256 and never appears
 *   in `report.json` or `report.md`; schema extras (`match`, `tieBreak`, `unassigned`)
 *   are dropped by construction;
 * - `persistPlan` → `plans/<planId>.json` (StoredPlan, injected-clock `storedAt`);
 * - `writePlanReportArtifacts` screener posture: blocking findings refuse the write with
 *   NOTHING on disk; non-blocking content is redacted in what lands; plan writes NEVER
 *   touch `last-run.json` (R13 — only applies/rollbacks write markers);
 * - `writeRunReportWithMarker` (T045 path, implemented) wraps the frozen
 *   `writeRunReports` and produces the marker.
 * NOT tested here: `derivePlanReportRunId` — it delegates to `deriveRunId` (ops.ts),
 * which remains a stub until T040; testing a throw-only path would be dishonest.
 *
 * Hermetic (constitution VI): temp-directory `StateStore` outside the repo, `FakeClock`,
 * synthetic ids via `uuidFromLabel`/`sha256Hex` (Principle III — zero real identifiers).
 * Titles are prefixed `engine-report —` for the tier name pattern.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  buildPlanReportJson,
  persistPlan,
  renderPlanReportMarkdown,
  writePlanReportArtifacts,
  writeRunReportWithMarker,
  type PlanReportAssertion,
} from "../../src/engine/report.js";

import { derivePlanId } from "task-linear-sync/domain";
import type { Plan, PlanTaskEntry, UnmappedIssue } from "task-linear-sync/domain";
import { loadConfig } from "task-linear-sync/config";
import { createStateStore } from "task-linear-sync/state";
import type { StateStore } from "task-linear-sync/state";

import { FakeClock, makeScreener } from "../helpers/test-utils.js";
import { sha256Hex, uuidFromLabel } from "../helpers/engine-harness.js";

// ───────────────────────────────────────────────────────── schema validation (T012 precedent)

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const schema = JSON.parse(
  readFileSync(
    new URL("specs/002-core-domain-contracts/contracts/plan-report.schema.json", `file://${pkgRoot}`),
    "utf8",
  ),
) as JsonSchema;

interface JsonSchema {
  type?: string | string[];
  const?: unknown;
  enum?: unknown[];
  pattern?: string;
  format?: string;
  required?: string[];
  additionalProperties?: boolean | JsonSchema;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maxLength?: number;
  $ref?: string;
  [key: string]: unknown;
}

const DATE_TIME = /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(\.\d+)?([Zz]|[+-]\d{2}:\d{2})$/;

/** Minimal draft-2020-12 subset validator (identical posture to T012's
 *  `tests/contract/report-schema.test.ts`): type/const/enum/pattern/format/required/
 *  additionalProperties/properties/items/min|maxItems/minimum/maxLength/$ref. */
function validateInto(value: unknown, s: JsonSchema, root: JsonSchema, path: string, errors: string[]): void {
  if (s.$ref) {
    const m = /^#\/\$defs\/(.+)$/.exec(s.$ref);
    assert.ok(m, `unsupported $ref: ${s.$ref}`);
    const target = (root as { $defs?: Record<string, JsonSchema> }).$defs?.[m[1]];
    assert.ok(target, `unresolved $ref: ${s.$ref}`);
    validateInto(value, target, root, path, errors);
    return;
  }
  if (s.const !== undefined && value !== s.const) errors.push(`${path}: must equal ${JSON.stringify(s.const)}`);
  if (s.enum && !s.enum.includes(value)) errors.push(`${path}: must be one of ${JSON.stringify(s.enum)}`);

  const types = s.type === undefined ? undefined : Array.isArray(s.type) ? s.type : [s.type];
  if (types) {
    const rawType = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
    const actual = rawType === "number" && Number.isInteger(value as number) ? "integer" : rawType;
    const ok = types.includes(actual) || (actual === "integer" && types.includes("number"));
    if (!ok) {
      errors.push(`${path}: expected type ${types.join("|")}, got ${rawType}`);
      return;
    }
  }
  if (typeof value === "string") {
    if (s.pattern && !new RegExp(s.pattern).test(value)) errors.push(`${path}: fails pattern ${s.pattern}`);
    if (s.format === "date-time" && !DATE_TIME.test(value)) errors.push(`${path}: not date-time`);
    if (s.maxLength !== undefined && value.length > s.maxLength) errors.push(`${path}: exceeds maxLength`);
  }
  if (typeof value === "number" && s.minimum !== undefined && value < s.minimum) {
    errors.push(`${path}: below minimum ${s.minimum}`);
  }
  if (Array.isArray(value)) {
    if (s.minItems !== undefined && value.length < s.minItems) errors.push(`${path}: fewer than ${s.minItems} items`);
    if (s.maxItems !== undefined && value.length > s.maxItems) errors.push(`${path}: more than ${s.maxItems} items`);
    if (s.items) value.forEach((v, i) => validateInto(v, s.items as JsonSchema, root, `${path}[${i}]`, errors));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const key of s.required ?? []) {
      if (!(key in obj)) errors.push(`${path}: missing required '${key}'`);
    }
    const props = s.properties ?? {};
    for (const [key, v] of Object.entries(obj)) {
      if (props[key]) validateInto(v, props[key], root, `${path}.${key}`, errors);
      else if (s.additionalProperties === false) errors.push(`${path}: additional property '${key}' not allowed`);
      else if (typeof s.additionalProperties === "object") {
        validateInto(v, s.additionalProperties as JsonSchema, root, `${path}.${key}`, errors);
      }
    }
  }
}

/** Assert a value (live object OR raw file text) validates against the frozen schema. */
function expectSchemaValid(value: unknown, label: string): void {
  const errors: string[] = [];
  validateInto(value, schema, schema, "$", errors);
  assert.deepEqual(errors, [], `${label} must conform to plan-report.schema.json:\n${errors.join("\n")}`);
}

// ─────────────────────────────────────────────────────────────────────────── fixture world

/** Placeholder-only "raw body" text — must NEVER surface in any artifact (SC-005). */
const RAW_BODY_TEXT = "SECRET RECIPE BODY: mix one token with two whispers, bake until BLUE-42.";

const TASK_ALPHA = uuidFromLabel("report-task-alpha");
const TASK_BETA = uuidFromLabel("report-task-beta");
const TASK_GAMMA = uuidFromLabel("report-task-gamma");
const SHA_A = sha256Hex("file-bytes-a");
const SHA_B = sha256Hex("file-bytes-b");
const SHA_BODY = sha256Hex(RAW_BODY_TEXT);

function entry(over: Partial<PlanTaskEntry> & Pick<PlanTaskEntry, "taskUuid">): PlanTaskEntry {
  return {
    decision: "update",
    frameworkId: "spec-kit",
    featureName: "001-alpha",
    filePath: "specs/001-alpha/tasks.md",
    confidence: "high",
    score: 120,
    margin: 40,
    reasons: ["durable-uuid", "title-exact"],
    alternatives: [{ issueId: "issue-0002", score: 80, mapped: false }],
    changedFields: ["title"],
    descriptionContentHash: SHA_BODY,
    expectedMarkdownChanges: ["- [ ] Task 1.2 → - [x] Task 1.2"],
    lowConfidenceGateStatus: "passed",
    unresolvedConflict: false,
    routing: {
      teamKey: "acme",
      project: "proj-alpha",
      matchedPrefix: "specs/001",
      defaulted: false,
      tieBreak: "first-by-map-order",
    },
    match: {
      taskUuid: over.taskUuid,
      issueId: "issue-0001",
      score: 120,
      margin: 40,
      confidence: "high",
      durableIdentity: false,
      reasons: ["durable-uuid"],
      alternatives: [{ issueId: "issue-0002", score: 80, mapped: false }],
    },
    ...over,
  };
}

const UNMAPPED: UnmappedIssue[] = [
  { issueId: "issue-9999", teamKey: "acme", project: "proj-beta", title: "Orphaned issue (screened)", parentMapped: true },
];

function makePlan(entries: readonly PlanTaskEntry[], unmapped: readonly UnmappedIssue[]): Plan {
  const withoutId = {
    generatedAt: "2026-01-01T00:00:00.000Z",
    repositoryRoot: "/fixture/repo-a",
    guards: { fileHashes: { "specs/002-beta/tasks.md": SHA_B, "specs/001-alpha/tasks.md": SHA_A }, headCommit: null },
    lowConfidencePresent: false,
    entries,
    unmappedIssues: unmapped,
  };
  return { planId: derivePlanId(withoutId), ...withoutId };
}

/** Multi-project plan: two projects, two milestones, a create (no match), a mapped
 *  conflict (`decision:"conflict"`, FR-005 reasons), and an unresolved freeze entry. */
function multiEntryPlan(): Plan {
  return makePlan(
    [
      entry({
        taskUuid: TASK_ALPHA,
        decision: "update",
        reasons: ["durable-uuid", "title-exact"],
      }),
      entry({
        taskUuid: TASK_GAMMA,
        featureName: "001-alpha",
        filePath: "specs/001-alpha/tasks.md",
        decision: "conflict",
        reasons: ["conflict:both-changed", "action:report-only", "reason:both sides changed since baseline"],
        changedFields: [],
      }),
      entry({
        taskUuid: TASK_BETA,
        decision: "create",
        featureName: "002-beta",
        filePath: "specs/002-beta/tasks.md",
        routing: { teamKey: "acme", project: "proj-beta", defaulted: false },
        match: undefined,
        unresolvedConflict: true,
        changedFields: [],
        expectedMarkdownChanges: [],
        alternatives: [],
      }),
    ],
    UNMAPPED,
  );
}

let scratch: string;
before(() => {
  scratch = mkdtempSync(join(tmpdir(), "tls-engine-report-"));
});
after(() => {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
});

function makeStore(name: string, clock: FakeClock): StateStore {
  const repo = join(scratch, `${name}-repo`);
  mkdirSync(repo, { recursive: true });
  return createStateStore({
    repositoryRoot: repo,
    config: loadConfig({ overrides: { stateDirectory: join(scratch, `${name}-state`) } }),
    clock,
  });
}

const RUN_ID = sha256Hex("plan-report-run-1");

// ─────────────────────────────────────────────────────────────────────────────────── tests

test("engine-report — buildPlanReportJson validates field-for-field against the frozen schema", () => {
  const report = buildPlanReportJson(multiEntryPlan(), {
    assertions: [{ guarantee: "read-only-plan-zero-mutations", status: "pass" }],
  });
  expectSchemaValid(report, "assembled PlanReportJson");
  expectSchemaValid(JSON.parse(JSON.stringify(report)), "serialized PlanReportJson");
});

test("engine-report — zero-task plan still assembles a schema-valid document with passing assertions", () => {
  const report = buildPlanReportJson(makePlan([], []));
  expectSchemaValid(report, "zero-task PlanReportJson");
  assert.deepEqual(report.groups, []);
  assert.deepEqual(report.unmapped, []);
  assert.ok(report.securityAssertions.length >= 1, "schema requires ≥ 1 assertion");
  assert.ok(
    report.securityAssertions.every((a) => a.status === "pass"),
    "zero-task plan asserts pass",
  );
});

test("engine-report — grouping is project→milestone; unmapped separate; schema extras dropped by construction", () => {
  const report = buildPlanReportJson(multiEntryPlan());

  // project → milestone ordering is deterministic and ascending.
  assert.deepEqual(
    report.groups.map((g) => `${g.project}/${g.milestone}`),
    ["proj-alpha/001-alpha", "proj-beta/002-beta"],
  );
  assert.equal(report.groups[0]?.entries.length, 2, "plan order preserved inside a group");

  // Separate unmapped section — exact 5-field schema surface.
  assert.deepEqual(report.unmapped, [
    { issueId: "issue-9999", teamKey: "acme", project: "proj-beta", title: "Orphaned issue (screened)", parentMapped: true },
  ]);

  const [update, conflict, create] = [
    report.groups[0]?.entries[0],
    report.groups[0]?.entries[1],
    report.groups[1]?.entries[0],
  ];
  // Frozen `frameworkId` renames to schema `framework`; `match` never surfaces.
  assert.equal(update?.framework, "spec-kit");
  assert.equal(update?.issueId, "issue-0001", "matched entry carries the durable issue id");
  assert.ok(!("frameworkId" in (update as object)) && !("match" in (update as object)));
  // Unmatched (create) entry → issueId null.
  assert.equal(create?.decision, "create");
  assert.equal(create?.issueId, null);
  // routing is stripped to the exact schema surface (no tieBreak/unassigned leakage).
  assert.deepEqual(Object.keys(update?.routing ?? {}).sort(), ["defaulted", "matchedPrefix", "project", "teamKey"]);
  // alternatives are rebuilt to the exact {issueId, score, mapped} shape.
  assert.deepEqual(update?.alternatives, [{ issueId: "issue-0002", score: 80, mapped: false }]);
  // The conflict entry survives decision + reasons verbatim (conflictType + action +
  // reason ride `reasons` — the schema admits no dedicated conflictType field, FR-005).
  assert.equal(conflict?.decision, "conflict");
  assert.deepEqual(conflict?.reasons, [
    "conflict:both-changed",
    "action:report-only",
    "reason:both sides changed since baseline",
  ]);
  assert.equal(create?.unresolvedConflict, true);
});

test("engine-report — security-assertions block: caller guarantees first, computed structural assertions pass", () => {
  const caller: PlanReportAssertion = { guarantee: "read-only-plan-zero-mutations", status: "pass" };
  const report = buildPlanReportJson(multiEntryPlan(), { assertions: [caller] });
  assert.deepEqual(report.securityAssertions.slice(0, 1), [caller]);
  const computed = report.securityAssertions.slice(1).map((a) => [a.guarantee, a.status]);
  assert.deepEqual(computed, [
    ["no-raw-body-or-description-fields", "pass"],
    ["description-material-hashed-only", "pass"],
  ]);
});

test("engine-report — structural exclusion: raw body text never appears in report.json or report.md", () => {
  const report = buildPlanReportJson(multiEntryPlan());
  const markdown = renderPlanReportMarkdown(report);
  const json = canonicalDump(report);

  // The body survives only as its content hash.
  assert.ok(json.includes(SHA_BODY), "content hash stands in for the body");
  for (const artifact of [json, markdown]) {
    assert.ok(!artifact.includes(RAW_BODY_TEXT), "raw body text must never propagate");
    assert.ok(!artifact.includes("mix one token"), "raw body fragment must never propagate");
  }
  // No schema property even NAMED like raw-text storage exists in the document.
  const offenders: string[] = [];
  const walk = (value: unknown): void => {
    if (Array.isArray(value)) return value.forEach(walk);
    if (value !== null && typeof value === "object") {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const lower = key.toLowerCase();
        if (/(body|description|content)/.test(lower) && !lower.endsWith("hash") && !lower.startsWith("expected")) {
          offenders.push(key);
        }
        walk(child);
      }
    }
  };
  walk(report);
  assert.deepEqual(offenders, [], "no raw-text-bearing property names");
});

function canonicalDump(value: unknown): string {
  return JSON.stringify(value);
}

test("engine-report — markdown renders assertion block, project→milestone sections, conflicts, unmapped", () => {
  const report = buildPlanReportJson(multiEntryPlan(), {
    assertions: [{ guarantee: "read-only-plan-zero-mutations", status: "pass" }],
  });
  const md = renderPlanReportMarkdown(report);

  assert.ok(md.includes("## Security Assertions"), "assertions block");
  assert.ok(md.includes("PASS — read-only-plan-zero-mutations"), "caller guarantee line");
  assert.ok(md.includes("PASS — no-raw-body-or-description-fields"), "computed guarantee line");

  assert.ok(md.includes("### Project: proj-alpha") && md.includes("#### Milestone: 001-alpha"));
  assert.ok(md.includes("### Project: proj-beta") && md.includes("#### Milestone: 002-beta"));
  assert.ok(md.indexOf("### Project: proj-alpha") < md.indexOf("### Project: proj-beta"), "group order");

  // Conflicts section surfaces both the mapped conflict and the unresolved freeze.
  assert.ok(md.includes("## Unresolved Conflicts"));
  assert.ok(md.includes("decision `conflict`"), "mapped conflict entry surfaced");
  assert.ok(md.includes("AWAITING HUMAN MARKER RESOLUTION"), "unresolved freeze surfaced");
  assert.ok(md.includes("`action:report-only`"), "FR-005 action reason shown on the conflict entry");

  // Separate unmapped section with human-readable title + durable id.
  assert.ok(md.includes("## Unmapped Issues"));
  assert.ok(md.includes("`issue-9999`") && md.includes("Orphaned issue (screened)"));
  assert.ok(md.includes("descendant mapped"), "parentMapped indication");

  // Deterministic renderer: same input ⇒ byte-identical markdown.
  assert.equal(md, renderPlanReportMarkdown(buildPlanReportJson(multiEntryPlan(), {
    assertions: [{ guarantee: "read-only-plan-zero-mutations", status: "pass" }],
  })));
});

test("engine-report — zero-task plan markdown renders empty sections (009 edge case)", () => {
  const md = renderPlanReportMarkdown(buildPlanReportJson(makePlan([], [])));
  assert.ok(md.includes("_(no task entries — zero-task plan)_"));
  assert.ok(md.includes("## Unresolved Conflicts"));
  assert.ok(md.includes("_(none)_"));
});

test("engine-report — persistPlan writes plans/<planId>.json with the injected-clock storedAt", async () => {
  const clock = new FakeClock("2026-01-02T08:00:00.000Z");
  const store = makeStore("persist", clock);
  await store.ensure();
  const plan = multiEntryPlan();

  await persistPlan(store, plan);

  const rel = `plans/${plan.planId}.json`;
  assert.ok(existsSync(join(store.paths.plans, `${plan.planId}.json`)), "landed under plans/");
  const stored = await store.readJson<{ plan: Plan; storedAt: string }>(rel);
  assert.ok(stored, "StoredPlan envelope readable");
  assert.equal(stored.storedAt, "2026-01-02T08:00:00.000Z", "storedAt from the injected clock");
  assert.equal(stored.plan.planId, plan.planId);
  // planId = sha256(canonicalize(planWithoutId)) — re-derive from the stored JSON minus
  // the id field itself (frozen algorithm, plan-artifact.md).
  const { planId: _omitted, ...storedWithoutId } = stored.plan;
  assert.equal(derivePlanId(storedWithoutId), plan.planId, "stored plan round-trips its planId");

  // Path safety: a malformed planId is refused, nothing is written.
  const rogue = { ...multiEntryPlan(), planId: "../../evil" };
  await assert.rejects(() => persistPlan(store, rogue), /sha256 hex/);
});

test("engine-report — writePlanReportArtifacts refuses blocking findings with NOTHING written", async () => {
  const clock = new FakeClock("2026-01-02T09:00:00.000Z");
  const store = makeStore("blocked", clock);
  await store.ensure();
  const report = buildPlanReportJson(multiEntryPlan());

  await assert.rejects(
    () => writePlanReportArtifacts(store, RUN_ID, report, "summary line with BLOCKED material", makeScreener()),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.equal((err as Error).name, "ReportScreeningError", "frozen refusal posture");
      assert.match((err as Error).message, /blocking-secret/);
      return true;
    },
  );
  assert.ok(!existsSync(join(store.paths.reports, RUN_ID)), "refused write leaves no artifacts");

  // Malformed runId (path traversal) is refused before any screening.
  await assert.rejects(() => writePlanReportArtifacts(store, "../escape", report, "ok", makeScreener()), /sha256 hex/);
});

test("engine-report — writePlanReportArtifacts writes screened artifacts and NEVER touches last-run.json", async () => {
  const clock = new FakeClock("2026-01-02T10:00:00.000Z");
  const store = makeStore("written", clock);
  await store.ensure();
  const report = buildPlanReportJson(makePlan(multiEntryPlan().entries, [
    { ...UNMAPPED[0], title: "Orphan SECRET7 issue" },
  ]));
  const markdown = renderPlanReportMarkdown(report);

  const paths = await writePlanReportArtifacts(store, RUN_ID, report, markdown, makeScreener());
  assert.equal(paths.json, join(store.paths.reports, RUN_ID, "report.json"));
  assert.equal(paths.markdown, join(store.paths.reports, RUN_ID, "report.md"));

  const jsonText = readFileSync(paths.json, "utf8");
  const mdText = readFileSync(paths.markdown, "utf8");
  // Screener pass applied to BOTH propagated artifacts (non-blocking redaction posture).
  assert.ok(jsonText.includes("[REDACTED]") && !jsonText.includes("SECRET7"), "report.json screened");
  assert.ok(mdText.includes("[REDACTED]") && !mdText.includes("SECRET7"), "report.md screened");
  // Raw body text absent end-to-end (structural exclusion + only-hashed content).
  assert.ok(!jsonText.includes(RAW_BODY_TEXT) && !mdText.includes(RAW_BODY_TEXT));
  // Artifacts on disk still conform field-for-field to the frozen schema.
  expectSchemaValid(JSON.parse(jsonText), `on-disk report.json (${RUN_ID})`);
  // R13: plan runs write NO marker — only applies/rollbacks produce last-run.json.
  assert.ok(!existsSync(store.paths.lastRun), "plan reports never write the LastRunMarker");
});

test("engine-report — writeRunReportWithMarker wraps frozen writeRunReports and produces the marker (T045 path)", async () => {
  const clock = new FakeClock("2026-01-02T11:00:00.000Z");
  const store = makeStore("marker", clock);
  await store.ensure();
  const report = buildPlanReportJson(makePlan([], []));
  const markdown = renderPlanReportMarkdown(report);

  const marker = await writeRunReportWithMarker(store, RUN_ID, report, markdown, makeScreener(), {
    runId: RUN_ID,
    outcome: "aborted",
    notificationSuppressed: false,
  });
  assert.equal(marker.runId, RUN_ID);
  assert.equal(marker.outcome, "aborted");
  assert.equal(marker.completedAt, "2026-01-02T11:00:00.000Z", "completedAt from the injected clock");
  assert.deepEqual(marker.reportPaths, {
    json: join(store.paths.reports, RUN_ID, "report.json"),
    markdown: join(store.paths.reports, RUN_ID, "report.md"),
  });
  assert.ok(existsSync(store.paths.lastRun), "run reports DO update last-run.json (apply/rollback posture)");

  // Blocking findings refuse the run-report path too — and no marker is written.
  const blockedRun = sha256Hex("blocked-run");
  await assert.rejects(
    () =>
      writeRunReportWithMarker(store, blockedRun, report, "BLOCKED", makeScreener(), {
        runId: blockedRun,
        outcome: "failed",
        notificationSuppressed: false,
      }),
    (err: unknown) => (err as Error).name === "ReportScreeningError",
  );
  assert.ok(!existsSync(join(store.paths.reports, blockedRun)));
});
