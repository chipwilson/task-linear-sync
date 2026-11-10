/**
 * T018 [US2] — spec-superpower sync-drift integration on the injected fake `Linear_Port`
 * (pattern of the 008 engine suites; spec US2 Independent Test / AC1–AC4, SC-004;
 * FR-004/FR-007/FR-008; data-model §3 rule 7; quickstart §5).
 *
 * World `spec-superpower-sync`: the three dated plans, empty tracker.
 *  1. Initial bootstrap apply creates exactly 3 issues per plan (9 entries, 9 creates);
 *     each description mirrors its task body verbatim — steps, file lists, commands and
 *     fenced code included — and never the task heading line itself.
 *  2. Flipping one `- [ ] **Step 2: …**` checkbox in place re-mirrors EXACTLY that one
 *     task's issue: 1 description write, zero creates/archives, zero other mutations.
 *  3. Write-back then re-parse reproduces each plan byte-for-byte apart from the visible
 *     reference prefix (byte-exact `renderTaskLines` re-render, bodies identical, exactly
 *     one ref per task line) and a no-change re-apply mutates nothing (no progressive
 *     prefixing).
 *  4. Security screening blocks pre-transmission: a body carrying the blocking sentinel
 *     never appears in ANY port-call argument while the clean checkbox flip in the same
 *     run still lands its single write (FR-007).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { GateRequest } from "task-linear-sync/gates";
import { builtInAdapters } from "task-linear-sync/discovery";
import { type LineAssignment, type TaskFileAdapter, parseTaskFile, renderTaskLines } from "task-linear-sync/parsing";
import type { ApplyResult, CreateIssueInput, IssueUpdatePatch, IssueView } from "task-linear-sync/ports";
import type { IssueRef, Plan, Task } from "task-linear-sync/domain";

import {
  attachEngine,
  buildWorld,
  callsMark,
  callsOf,
  mutationCalls,
  type EngineWorld,
  type PortCallRecord,
} from "../helpers/engine-harness.js";

import { createSyncEngine } from "../../src/engine/create.js";

// ───────────────────────────────────────────────────────────────────── helpers

/** The 004 consumer view of the real built-in row (adapter-consumption boundary rule 2). */
const row = builtInAdapters["spec-superpower"];
const adapter = {
  id: "spec-superpower" as const,
  featureName: (filePath: string) => row.featureName(filePath),
  headingGrammar: row.headingGrammar,
  phasePattern: row.phasePattern,
  summaryPattern: row.summaryPattern,
  rollupPattern: row.rollupPattern,
  identityFileScope: row.identityFileScope,
} satisfies TaskFileAdapter;

const PLAN_POSIX = [
  "docs/superpowers/plans/2026-11-01-sync.md",
  "docs/superpowers/plans/2026-11-02-auth.md",
  "docs/superpowers/plans/2026-11-09-sync.md",
] as const;

/** The fixture source bytes (the world's repo is a temp copy — originals stay pristine). */
function originalBytes(rel: string): string {
  return readFileSync(join("tests/fixtures/engine/worlds/spec-superpower-sync/repo", rel), "utf8");
}

function passingGates(world: EngineWorld, plan: Plan, overrides: Partial<GateRequest> = {}): GateRequest {
  return {
    applyFlag: true,
    confirmationKey: world.config.confirmationKey,
    acceptLowConfidence: plan.lowConfidencePresent,
    planReference: plan.planId,
    ...overrides,
  };
}

function createRecords(world: EngineWorld, sinceMark = 0): readonly PortCallRecord[] {
  return callsOf(world, "createIssue", sinceMark);
}

const createInput = (record: PortCallRecord): CreateIssueInput => record.args[0] as CreateIssueInput;

/** The (single) description-carrying `updateIssue` args on `issueId` since `sinceMark`. */
function pushedDescriptions(world: EngineWorld, issueId: string, sinceMark = 0): string[] {
  return world.calls
    .filter(
      (c) =>
        c.seq >= sinceMark &&
        c.method === "updateIssue" &&
        c.args[0] === issueId &&
        (c.args[1] as IssueUpdatePatch).description !== undefined,
    )
    .map((c) => (c.args[1] as IssueUpdatePatch).description as string);
}

/** The fake-world issue carrying `title` (newly created). */
function fakeIssueByTitle(world: EngineWorld, title: string): IssueView {
  for (const view of world.fake.world.issues.values()) {
    if (view.title === title) return view;
  }
  assert.fail(`fake world carries no issue titled '${title}'`);
}

/** Split the harness re-keyed `ACME-<n>` into the 004 `IssueRef` shape. */
function splitIssueRef(world: EngineWorld, view: IssueView): IssueRef {
  const match = /^(.+)-(\d+)$/.exec(view.key);
  assert.ok(match?.[1] !== undefined && match[2] !== undefined, `issue key '${view.key}' is not KEY-number`);
  return { key: world.config.confirmationKey, number: Number(match[2]) };
}

/** Bootstrap run 1: plan + gated apply; returns plan and result. */
async function bootstrapApply(w: EngineWorld): Promise<{ plan: Plan; result: ApplyResult }> {
  const engine = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
  const plan = await engine.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
  const result = await engine.applySyncPlan(plan, passingGates(w, plan));
  return { plan, result };
}

/** The create record whose input title is `title` (fixture titles are unique). */
function createForTitle(records: readonly PortCallRecord[], title: string): PortCallRecord {
  const found = records.filter((c) => createInput(c).title === title);
  assert.equal(found.length, 1, `exactly one create carries the title '${title}'`);
  return found[0] as PortCallRecord;
}

// ──────────────────────────────────────────── cell 1: bootstrap creates + verbatim mirrors

test("sync-spec-superpower — initial apply creates 3 issues per plan with verbatim step/file/command/code mirrors (US2-AC1, FR-004/FR-007)", async () => {
  const w = await buildWorld("spec-superpower-sync");
  try {
    const { plan, result } = await bootstrapApply(w);
    assert.equal(result.status, "applied");
    assert.ok(result.operations.every((o) => o.status !== "failed"), `no op fails in the healthy world: ${JSON.stringify(result.operations.filter((o) => o.status === "failed"))}`);
    assert.equal(plan.entries.length, 9, "three tasks per plan, nine in total — decoy Markdown never enters the plan (SC-001)");

    const creates = createRecords(w);
    assert.equal(creates.length, 9, "exactly nine issues created");
    assert.ok(creates.every((c) => c.ok), "every create lands");

    const task1 = createForTitle(creates, "SyncJournalWriter");
    const d1 = createInput(task1).description ?? "";
    assert.ok(d1.includes("- [ ] **Step 1: Write the failing journal round-trip test**"), "steps mirror verbatim");
    assert.ok(d1.includes("- [ ] **Step 3: Wire the journal into the apply lane and re-run the suite**"), "every step line is in the mirror");
    assert.ok(d1.includes("- src/sync/journal.ts"), "file lists mirror verbatim");
    assert.ok(d1.includes("```sh"), "fenced code fences mirror verbatim");
    assert.ok(d1.includes("npm run compile:tests && node scripts/run-tests.mjs --tier unit"), "commands mirror verbatim");
    assert.ok(!d1.includes("### Task 1:"), "the mirrored region never carries the task heading line");

    const mirror = createInput(createForTitle(creates, "MirrorRenderer")).description ?? "";
    assert.ok(mirror.includes("export function renderMirror(task: TaskBodySpan): string {"), "fenced TypeScript mirrors verbatim");

    const session = createInput(createForTitle(creates, "SessionStore")).description ?? "";
    assert.ok(session.includes("- [ ] **Step 1: Write eviction-bound and TTL expiry tests**"), "level-4-heading tasks mirror like level-3 ones");

    // One page-0 canonical attachment per landed task (identity journal, FR-008).
    assert.equal(callsOf(w, "upsertAttachmentByUrl").length, 9, "one identity-attachment upsert per landed task");
    assert.equal(callsOf(w, "archiveIssue").length, 0, "nothing archives on bootstrap");
  } finally {
    await w.dispose();
  }
});

// ──────────────────────────────── cell 2: one checkbox flip ⇒ exactly one description write

test("sync-spec-superpower — flipping one step checkbox re-mirrors exactly that task's issue: 1 description write, 0 other mutations (US2-AC2, SC-004)", async () => {
  const w = await buildWorld("spec-superpower-sync");
  try {
    await bootstrapApply(w);

    const planFile = join(w.repositoryRoot, "docs", "superpowers", "plans", "2026-11-01-sync.md");
    const before = readFileSync(planFile, "utf8");
    const flipped = before.replace(
      "- [ ] **Step 2: Implement the append-only writer with fsync**",
      "- [x] **Step 2: Implement the append-only writer with fsync**",
    );
    assert.notEqual(flipped, before, "fixture self-check: the step line is present to flip");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(planFile, flipped, "utf8");

    const mark = callsMark(w);
    const engine2 = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan2 = await engine2.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const result2 = await engine2.applySyncPlan(plan2, passingGates(w, plan2));
    assert.equal(result2.status, "applied");

    assert.equal(callsOf(w, "createIssue", mark).length, 0, "no new issues");
    assert.equal(callsOf(w, "archiveIssue", mark).length, 0, "nothing archived");

    const written = createRecords(w); // pre-flip creates only (mark-scoped creates are zero)
    void written;
    const flippedIssue = fakeIssueByTitle(w, "SyncJournalWriter");
    const updates = w.calls.filter((c) => c.seq >= mark && c.method === "updateIssue");
    assert.ok(updates.length >= 1, "the touched task's issue is updated");
    for (const c of updates) {
      assert.equal(c.args[0], flippedIssue.id, "every updateIssue targets the touched task's issue — no other issue is touched");
    }
    const descriptions = pushedDescriptions(w, flippedIssue.id, mark);
    assert.equal(descriptions.length, 1, "exactly one description write");
    assert.ok(descriptions[0]?.includes("- [x] **Step 2: Implement the append-only writer with fsync**"), "the re-mirrored body carries the flipped checkbox verbatim");

    const others = [...w.fake.world.issues.values()].filter((v) => v.id !== flippedIssue.id);
    for (const other of others) {
      assert.ok(
        !w.calls.some((c) => c.seq >= mark && (c.method === "updateIssue" || c.method === "archiveIssue") && c.args[0] === other.id),
        `issue ${other.key} (${other.title}) sees zero mutations`,
      );
    }
  } finally {
    await w.dispose();
  }
});

// ─────────────────────────────── cell 3: byte-for-byte round trip, no progressive prefixing

test("sync-spec-superpower — write-back re-parses to the original bodies byte-for-byte apart from the reference prefix; a no-change re-apply mutates nothing (US2-AC3, data-model §3 rule 7)", async () => {
  const w = await buildWorld("spec-superpower-sync");
  try {
    await bootstrapApply(w);

    for (const rel of PLAN_POSIX) {
      const original = originalBytes(rel);
      const after = readFileSync(join(w.repositoryRoot, rel), "utf8");
      const baseline = parseTaskFile(rel, original, adapter, w.config);

      // Byte-exact re-render: original + (task, title, ref) assignments = file on disk.
      const creates = createRecords(w);
      assert.equal(creates.length, 9);
      const assignments: readonly LineAssignment[] = baseline.file.tasks.map((task) => {
        const title = task.title;
        const view = fakeIssueByTitle(w, title);
        return { task: task as Task, desiredTitle: title, issueRef: splitIssueRef(w, view) } satisfies LineAssignment;
      });
      const expected = renderTaskLines(rel, original, assignments, w.config).content;
      assert.equal(after, expected, `${rel}: write-back is the byte-exact renderTaskLines output`);

      // Re-parse: identical task set; body regions byte-identical BELOW the task line
      // (the task line itself is exactly where the visible reference lands).
      const reparsed = parseTaskFile(rel, after, adapter, w.config);
      assert.deepEqual(
        reparsed.file.tasks.map((t) => [t.stableUuid, t.localTaskId]),
        baseline.file.tasks.map((t) => [t.stableUuid, t.localTaskId]),
        `${rel}: task identities survive the write-back`,
      );
      const afterLines = after.split("\n");
      const beforeLines = original.split("\n");
      for (const task of reparsed.file.tasks) {
        const base = baseline.file.tasks.find((t) => t.stableUuid === task.stableUuid);
        assert.ok(base !== undefined);
        assert.deepEqual(
          afterLines.slice(task.taskBody.startLine, task.taskBody.endLine),
          beforeLines.slice(base.taskBody.startLine, base.taskBody.endLine),
          `${task.localTaskId}: body span byte-identical apart from the prefix`,
        );
      }

      // Exactly one visible reference per task line — never progressive prefixing.
      for (const line of after.split("\n")) {
        if (/^\s{0,3}#{2,4}\s+Task\s+[0-9]+\s*:/.test(line)) {
          assert.equal((line.match(/\[ACME-\d+\]/g) ?? []).length, 1, `one reference on '${line}'`);
        }
      }
    }

    // No-change re-apply: zero mutations of any kind (SC-001 at the sync boundary).
    const mark = callsMark(w);
    const engine2 = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan2 = await engine2.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    await engine2.applySyncPlan(plan2, passingGates(w, plan2));
    assert.deepEqual(mutationCalls(w, mark), [], "unchanged inputs mutate nothing — the prefix never compounds");
  } finally {
    await w.dispose();
  }
});

// ──────────────────────────────── cell 4: security screening blocks pre-transmission

test("sync-spec-superpower — blocking screening content never transmits while the clean task's single write still lands in the same run (US2-AC4, FR-007)", async () => {
  const w = await buildWorld("spec-superpower-sync");
  try {
    await bootstrapApply(w);

    // Clean change: flip DriftDetector's Step 4. Blocking change: sentinel into Task 1's body.
    const syncFile = join(w.repositoryRoot, "docs", "superpowers", "plans", "2026-11-01-sync.md");
    const authFile = join(w.repositoryRoot, "docs", "superpowers", "plans", "2026-11-02-auth.md");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      syncFile,
      readFileSync(syncFile, "utf8").replace(
        "- [ ] **Step 4: Add the change-span table test**",
        "- [x] **Step 4: Add the change-span table test**",
      ),
      "utf8",
    );
    const auth = readFileSync(authFile, "utf8");
    writeFileSync(
      authFile,
      auth.replace(
        "In-memory store with TTL eviction and a fixed eviction bound.",
        "In-memory store with TTL eviction — BLOCKED rotating the session signing key first.",
      ),
      "utf8",
    );

    const mark = callsMark(w);
    const engine2 = attachEngine(w, createSyncEngine, { keyProvider: w.keyProvider });
    const plan2 = await engine2.buildSyncPlan({ repositoryRoot: w.repositoryRoot });
    const result2 = await engine2.applySyncPlan(plan2, passingGates(w, plan2));

    // Blocked pre-transmission: NO port-call argument carries the sentinel.
    for (const c of w.calls.filter((c) => c.seq >= mark)) {
      assert.ok(!JSON.stringify(c.args).includes("BLOCKED"), `port call ${c.method} must never carry blocked content`);
    }

    // The clean flip still lands: exactly one description write, on DriftDetector's issue.
    const driftIssue = fakeIssueByTitle(w, "DriftDetector");
    assert.equal(pushedDescriptions(w, driftIssue.id, mark).length, 1, "the clean change's single description write lands");
    assert.ok(pushedDescriptions(w, driftIssue.id, mark)[0]?.includes("- [x] **Step 4: Add the change-span table test**"));
    assert.equal(callsOf(w, "createIssue", mark).length, 0, "no creates in the screening run");

    // Only the blocked task's op fails, with a sanitized detail.
    const failed = result2.operations.filter((o) => o.status === "failed");
    assert.equal(failed.length, 1, "exactly the blocked task's op fails — the rest of the run proceeds");
    assert.ok(!(failed[0]?.detail ?? "").includes("BLOCKED"), "op details stay sanitized — no raw content");
  } finally {
    await w.dispose();
  }
});
