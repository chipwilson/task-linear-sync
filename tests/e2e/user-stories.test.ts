/**
 * T051 — scripted end-to-end walkthrough (spec user stories, quickstart scenarios).
 * US1: layered config load → workspace-identity validation → deterministic canonical
 * output. US2: state-dir creation → lock acquire/contention/release → intent-before-
 * attempt → reports + last-run marker → re-acquire. Fully hermetic: injected clock,
 * temp-filestate, ZERO network, zero tracker dependency.
 */
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { loadConfig, validateWorkspaceIdentity, canonicalizeConfig } from "task-linear-sync/config";
import {
  createStateStore,
  acquireRunLock,
  releaseRunLock,
  writeCreateIntentBeforeAttempt,
  updateCreateIntentStatus,
  listIntentsByTask,
  writeRunReports,
  readLastRunMarker,
} from "task-linear-sync/state";
import { canonicalAttachmentUrl } from "task-linear-sync/urls";
import { derivePlanId } from "task-linear-sync/domain";
import { FakeClock, makeScreener } from "../helpers/test-utils.js";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const fix = (rel: string): string => new URL(`file://${pkgRoot}tests/fixtures/config/${rel}`).pathname;

let scratch: string;
let previousXdg: string | undefined;

before(() => {
  scratch = mkdtempSync(join(tmpdir(), "tls-e2e-"));
  previousXdg = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = join(scratch, "xdg");
});
after(() => {
  if (previousXdg === undefined) delete process.env.XDG_STATE_HOME;
  else process.env.XDG_STATE_HOME = previousXdg;
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
});

describe("user-story walkthrough", () => {
  test("US1 end-to-end: config load → validation → deterministic output (SC-001)", () => {
    // Scenario: consumer provides the config file + programmatic overrides; everything
    // else comes from the built-in defaults; identity values are consumer-supplied.
    const config = loadConfig({
      configFile: fix("valid-full.json"),
      overrides: { pageSize: 64 },
    });
    assert.doesNotThrow(() => validateWorkspaceIdentity(config));
    assert.equal(config.pageSize, 64);
    assert.equal(config.defaultTeamKey, "acme");

    // Determinism gate (SC-001): canonical output byte-identical across repeats.
    assert.equal(canonicalizeConfig(loadConfig({ configFile: fix("valid-full.json"), overrides: { pageSize: 64 } })), canonicalizeConfig(config));
  });

  test("US2 end-to-end: state dir → lock lifecycle → intent → reports + marker (SC-003/SC-004)", async () => {
    const repo = join(scratch, "walkthrough-repo");
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, "tasks.md"), "# Tasks\n\n- [ ] Task 1.1 [SYNC-11]\n");

    const clock = new FakeClock("2026-10-22T14:00:00.000Z");
    const config = loadConfig({ configFile: fix("valid-full.json") });
    const store = createStateStore({ repositoryRoot: repo, config, clock });

    // 1. State directory is OUTSIDE the repository and private.
    assert.ok(!store.root.startsWith(repo), "state dir outside the repository (SC-003)");
    await store.ensure();
    if (process.platform !== "win32") {
      assert.equal(statSync(store.root).mode & 0o777, 0o700);
    }

    // 2. Lock acquisition; a second contender sees a live holder (SC-004).
    const first = await acquireRunLock(store, "walk-run-1");
    assert.equal(first.acquired, true);
    const contender = await acquireRunLock(store, "walk-run-2");
    assert.equal(contender.acquired, false);
    if (!contender.acquired) assert.equal(contender.reason, "live-process");

    // 3. Intent written BEFORE the (simulated) create attempt; status transitions.
    const intent = await writeCreateIntentBeforeAttempt(store, {
      intentId: "walk-intent-1",
      runId: "walk-run-1",
      taskUuid: "5b8f1e2a-3c4d-5e6f-7a8b-9c0d1e2f3a4b",
      targetTeamKey: config.defaultTeamKey,
      targetProject: config.defaultProject,
    });
    assert.equal(intent.status, "pending");
    clock.advanceMs(250);
    await updateCreateIntentStatus(store, "walk-intent-1", "confirmed-created");

    // 4. Contract-derived artifacts along the way: deterministic URL + re-derivable planId.
    const url = canonicalAttachmentUrl(config, intent.taskUuid);
    assert.equal(url, canonicalAttachmentUrl(config, intent.taskUuid)); // byte-stable
    const planId = derivePlanId({
      generatedAt: clock.iso(),
      repositoryRoot: repo,
      guards: { fileHashes: {}, headCommit: null },
      lowConfidencePresent: false,
      entries: [],
      unmappedIssues: [],
    });
    assert.match(planId, /^[0-9a-f]{64}$/);

    // 5. Paired sanitized reports + last-run marker land in the state dir.
    clock.advanceMs(1_000);
    const marker = await writeRunReports(
      store,
      "walk-run-1",
      {
        json: { schemaVersion: 1, planId, groups: [], unmapped: [], securityAssertions: [] },
        markdown: `# Walkthrough run\n\nAttachment: ${url}\n`,
      },
      makeScreener(),
      { runId: "walk-run-1", outcome: "completed", notificationSuppressed: false },
    );
    assert.ok(existsSync(marker.reportPaths!.json));
    assert.ok(existsSync(marker.reportPaths!.markdown));
    assert.deepEqual((await readLastRunMarker(store))?.reportPaths, marker.reportPaths);

    // 6. Release; the next run acquires cleanly; intent index answers reconciliation.
    if (first.acquired) await releaseRunLock(store, first.record);
    const next = await acquireRunLock(store, "walk-run-3");
    assert.equal(next.acquired, true);
    const openIntents = await listIntentsByTask(store, intent.taskUuid);
    assert.equal(openIntents.length, 1);
    assert.equal(openIntents[0]?.status, "confirmed-created");
    if (next.acquired) await releaseRunLock(store, next.record);

    // 7. The repository tree gained NOTHING from the lifecycle (SC-003).
    assert.deepEqual(readdirSync(repo).sort(), ["tasks.md"]);
  });

  test("config failure categories surface through the same walkthrough entry points (SC-002)", () => {
    assert.throws(() => loadConfig({ configFile: fix("invalid-json.json") }), /invalid-json/);
    assert.throws(
      () => validateWorkspaceIdentity(loadConfig({ configFile: fix("missing-identity/missing-teams.json") })),
      /teams.*defaultTeamKey.*defaultProject/s,
      "every missing value named in one message",
    );
  });
});
