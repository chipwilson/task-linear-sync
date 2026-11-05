/**
 * T007 [P] — `ReadOnlyGuard` unit tests (FR-005, research R6, data-model §5).
 * Mutating `LinearPort` members throw `ReadOnlyViolationError` naming the member while
 * read members delegate unchanged; guarded `StateStore` refuses writes outside the
 * allowed prefixes (`["reports/","plans/"]` for plan/check; `[]` for inventory /
 * discover-metadata); `clock`/`config`/`screener` pass through by identity; refusals
 * write nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig } from "task-linear-sync/config";
import { createDefaultSecurityScreener } from "task-linear-sync/engine";
import { createStateStore, fixedClock } from "task-linear-sync/state";
import type { EngineDependencies, LinearPort } from "task-linear-sync/ports";

import { createReadOnlyGuard } from "../../src/cli/readonly-guard.js";
import { ReadOnlyViolationError } from "../../src/cli/errors.js";

const CLOCK = fixedClock(new Date("2026-01-01T00:00:00.000Z"));

/** Recording port stub: every member resolves `called:<member>` and records invocation. */
function makeStubPort(): { port: LinearPort; calls: string[] } {
  const calls: string[] = [];
  const members = [
    "listIssues",
    "discoverMetadata",
    "getIssue",
    "createIssue",
    "updateIssue",
    "archiveIssue",
    "findIssuesByAttachmentUrl",
    "upsertAttachmentByUrl",
    "updateAttachment",
    "getAttachmentByUrl",
    "listAttachments",
  ] as const;
  const record: Record<string, unknown> = {};
  for (const member of members) {
    record[member] = async () => {
      calls.push(member);
      return `called:${member}`;
    };
  }
  return { port: record as unknown as LinearPort, calls };
}

/** The five mutating members of the frozen port surface. */
const MUTATING: readonly (keyof LinearPort)[] = [
  "createIssue",
  "updateIssue",
  "archiveIssue",
  "upsertAttachmentByUrl",
  "updateAttachment",
];

/** Read members must delegate unchanged. */
const READ: readonly (keyof LinearPort)[] = [
  "listIssues",
  "discoverMetadata",
  "getIssue",
  "findIssuesByAttachmentUrl",
  "getAttachmentByUrl",
  "listAttachments",
];

async function buildDeps(): Promise<{ deps: EngineDependencies; calls: string[]; root: string }> {
  const root = await mkdtemp(join(tmpdir(), "tls-009-guard-"));
  const repositoryRoot = join(root, "repo");
  const stateDir = join(root, "state");
  const config = loadConfig({ overrides: { stateDirectory: stateDir } });
  const { port, calls } = makeStubPort();
  const screener = createDefaultSecurityScreener(config);
  const state = createStateStore({ repositoryRoot, config, clock: CLOCK });
  return { deps: { port, config, state, clock: CLOCK, screener }, calls, root };
}

const MUTATING_ARGS: Partial<Record<keyof LinearPort, readonly unknown[]>> = {
  createIssue: [{ title: "t", description: "d", projectId: "p-1" }],
  updateIssue: ["issue-1", { title: "t2" }],
  archiveIssue: ["issue-1"],
  upsertAttachmentByUrl: [{ issueId: "issue-1", url: "https://example.invalid/a", title: "t", subtitle: "", iconUrl: "", body: "b" }],
  updateAttachment: ["att-1", {}],
};

test("every mutating port member throws ReadOnlyViolationError naming the member", async () => {
  const { deps, calls, root } = await buildDeps();
  try {
    const guarded = createReadOnlyGuard(deps, ["reports/", "plans/"]);
    for (const member of MUTATING) {
      const fn = guarded.port[member] as (...args: readonly unknown[]) => unknown;
      assert.notEqual(fn, deps.port[member], `${member} must be wrapped, not passed through`);
      assert.throws(
        () => fn(...(MUTATING_ARGS[member] ?? [])),
        (e: unknown) => {
          assert.ok(e instanceof ReadOnlyViolationError, `${member} must throw ReadOnlyViolationError`);
          assert.match(e.message, new RegExp(member as string));
          return true;
        },
        `${member} must throw through the guarded port`,
      );
    }
    assert.deepEqual(calls, [], "no mutating attempt may reach the inner port");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("read port members delegate unchanged (same results through the guard)", async () => {
  const { deps, root } = await buildDeps();
  try {
    const guarded = createReadOnlyGuard(deps, ["reports/", "plans/"]);
    for (const member of READ) {
      const direct = (deps.port[member] as (...a: readonly unknown[]) => unknown)();
      const viaGuard = (guarded.port[member] as (...a: readonly unknown[]) => unknown)();
      assert.deepEqual(await viaGuard, await direct, `${member} must delegate unchanged`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('state writes inside ["reports/","plans/"] pass; everything else refuses', async () => {
  const { deps, root } = await buildDeps();
  try {
    const guarded = createReadOnlyGuard(deps, ["reports/", "plans/"]);
    await guarded.state.writeText("reports/aaaa/report.md", "ok");
    await guarded.state.writeJson("plans/bbbb.json", { ok: true });
    await guarded.state.writeJson("reports/bbbb/report.json", { ok: true });

    for (const rel of [
      "sync-state.json",
      "manifests/aaaa.manifest.json",
      "intents/intent-1.json",
      "last-run.json",
      "pending-job.json",
      "lock.json",
      "Reports/case-sensitive.json",
    ]) {
      for (const writer of ["writeJson", "writeText"] as const) {
        assert.throws(
          () => (guarded.state[writer] as (r: string, v: unknown) => unknown)(rel, "x"),
          (e: unknown) => {
            assert.ok(e instanceof ReadOnlyViolationError, `${writer} ${rel} must refuse`);
            assert.match(e.message, new RegExp(rel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
            return true;
          },
          `${writer}('${rel}') must refuse with prefix mode ["reports/","plans/"]`,
        );
      }
    }
    // Refusals wrote nothing beyond the three allowed artifacts.
    assert.deepEqual(await guarded.state.readJson("last-run.json"), null);
    assert.equal(existsSync(join(deps.state.root, "pending-job.json")), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("empty allowed prefixes refuses ALL writes (inventory/discover-metadata mode)", async () => {
  const { deps, root } = await buildDeps();
  try {
    const guarded = createReadOnlyGuard(deps, []);
    for (const rel of ["reports/aaaa/report.md", "plans/bbbb.json", "sync-state.json"]) {
      assert.throws(
        () => guarded.state.writeText(rel, "x"),
        ReadOnlyViolationError,
        `[] mode must refuse ${rel}`,
      );
    }
    assert.equal(existsSync(deps.state.root), false, "nothing may be created by refused writes");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("clock, config and screener pass through by identity", async () => {
  const { deps, root } = await buildDeps();
  try {
    const guarded = createReadOnlyGuard(deps, ["reports/", "plans/"]);
    assert.equal(guarded.clock, deps.clock);
    assert.equal(guarded.config, deps.config);
    assert.equal(guarded.screener, deps.screener);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
