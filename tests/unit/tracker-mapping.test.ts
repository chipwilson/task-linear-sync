/**
 * T008 [P] — field-mapping unit tests (data-model.md §10 — mapping over the FROZEN 002 view
 * shapes; every row) plus identifier resolution (research R10: configured project identity →
 * platform id via discovery results; unknown identity ⇒ TrackerConfigError naming team +
 * identity, pre-dispatch so it is not indeterminate).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  mapIssueNode,
  mapAttachmentNode,
  mapTeamNodeFull,
  DiscoveryCache,
  TrackerConfigError,
} from "task-linear-sync/tracker";

/** Platform-shaped Issue node exactly as the `issues` document selects it. */
function platformIssue(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "ac000000-0000-4000-8000-000000000101",
    identifier: "ACM-101",
    team: { key: "acme-team" },
    project: { id: "prj-acme-alpha" },
    title: "Implement the feature",
    description: "Body text — data, never an identity route",
    state: { type: "started" },
    updatedAt: "2026-10-01T12:00:00.000Z",
    archivedAt: null,
    ...over,
  };
}

test("mapping: IssueView rows — key ← identifier, teamKey ← team.key, stateType ← state.type", () => {
  const view = mapIssueNode(platformIssue());
  assert.deepEqual(view, {
    id: "ac000000-0000-4000-8000-000000000101",
    key: "ACM-101",
    teamKey: "acme-team",
    projectId: "prj-acme-alpha",
    title: "Implement the feature",
    description: "Body text — data, never an identity route",
    stateType: "started",
    updatedAt: "2026-10-01T12:00:00.000Z",
    archived: false,
  });
});

test("mapping: null project maps to empty projectId (documented §10 choice)", () => {
  const view = mapIssueNode(platformIssue({ project: null }));
  assert.equal(view.projectId, "");
});

test("mapping: archived ← archivedAt != null", () => {
  assert.equal(mapIssueNode(platformIssue({ archivedAt: "2026-10-02T00:00:00.000Z" })).archived, true);
  assert.equal(mapIssueNode(platformIssue({ archivedAt: null })).archived, false);
  assert.equal(mapIssueNode(platformIssue({ archivedAt: undefined })).archived, false);
});

test("mapping: AttachmentView rows incl. flat metadata passthrough", () => {
  const view = mapAttachmentNode({
    id: "att-1",
    url: "https://sync.example.invalid/task-linear-sync/ac000000-0000-4000-8000-000000000001",
    title: "sync state",
    subtitle: "page 0",
    metadata: { __task_linear_sync: "payload", counter: 3 },
  });
  assert.equal(view.id, "att-1");
  assert.equal(view.url, "https://sync.example.invalid/task-linear-sync/ac000000-0000-4000-8000-000000000001");
  assert.equal(view.title, "sync state");
  assert.equal(view.subtitle, "page 0");
  assert.deepEqual(view.metadata, { __task_linear_sync: "payload", counter: 3 });
});

test("mapping: attachment subtitle omitted when absent; metadata defaults to {}", () => {
  const view = mapAttachmentNode({ id: "att-2", url: "u", title: "t" });
  assert.equal(view.subtitle, undefined);
  assert.equal("subtitle" in view, false);
  assert.deepEqual(view.metadata, {});
});

test("mapping: team nodes → frozen TeamMetadataCollections with the platform teamId kept alongside", () => {
  const rec = mapTeamNodeFull({
    id: "team-acme",
    key: "acme-team",
    projects: { nodes: [{ id: "prj-acme-alpha", name: "proj-alpha" }] },
    states: { nodes: [{ id: "st-acme-todo", name: "Todo", type: "unstarted" }] },
  });
  assert.equal(rec.teamId, "team-acme");
  assert.equal(rec.teamKey, "acme-team");
  assert.deepEqual(rec.projects, [{ id: "prj-acme-alpha", name: "proj-alpha" }]);
  assert.deepEqual(rec.workflowStates, [{ id: "st-acme-todo", name: "Todo", type: "unstarted" }]);
});

// ── Identifier resolution over the per-instance discovery cache (R10) ──────────

function cache(): DiscoveryCache {
  const c = new DiscoveryCache();
  c.warm([
    {
      teamId: "team-acme",
      teamKey: "acme-team",
      projects: [
        { id: "prj-acme-alpha", name: "proj-alpha" },
        { id: "prj-acme-beta", name: "proj-beta" },
      ],
      workflowStates: [{ id: "st-acme-todo", name: "Todo", type: "unstarted" }],
    },
  ]);
  return c;
}

test("identity resolution: configured project identity resolves by platform id or name", () => {
  const c = cache();
  assert.equal(c.resolveProjectId("acme-team", "proj-alpha"), "prj-acme-alpha");
  assert.equal(c.resolveProjectId("acme-team", "prj-acme-beta"), "prj-acme-beta");
});

test("identity resolution: unknown identity ⇒ TrackerConfigError naming team + identity (pre-dispatch, not indeterminate)", () => {
  const c = cache();
  assert.throws(
    () => c.resolveProjectId("acme-team", "proj-gamma"),
    (e: unknown) => {
      assert.ok(e instanceof TrackerConfigError);
      assert.match(e.detail, /acme-team/);
      assert.match(e.detail, /proj-gamma/);
      return true;
    },
  );
});

test("identity resolution: teamKey → teamId via the cache; unknown team named", () => {
  const c = cache();
  assert.equal(c.resolveTeamId("acme-team"), "team-acme");
  assert.throws(
    () => c.resolveTeamId("unknown-team"),
    (e: unknown) => e instanceof TrackerConfigError && /unknown-team/.test(e.detail),
  );
});

test("identity resolution: cache is empty until warmed (fresh instance = fresh discovery)", () => {
  const fresh = new DiscoveryCache();
  assert.equal(fresh.get("acme-team"), undefined);
  assert.equal(fresh.has("acme-team"), false);
});
