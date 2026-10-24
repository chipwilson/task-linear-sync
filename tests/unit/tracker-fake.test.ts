/**
 * T009 [P] — fake-semantics unit tests (contracts/tracker-testing.md §1): URL-idempotent upsert
 * updates in place (map size unchanged, callLog grows); per-team scoping uses the SAME guard
 * code path (shared module, not re-implemented); opaque `c:<index>` cursors with nextCursor null
 * only at the end; scriptFailure maps to the identical R12 taxonomy with attempts semantics
 * (create ⇒ always 1); the fake exposes NO description-search capability at all (FR-004 world
 * property).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createFakeLinearPort, syntheticUuid, issueInScope as testingGuard, type FakeWorldSeed } from "task-linear-sync/tracker/testing";
import { issueInScope as coreGuard, TrackerError, TrackerConfigError, IndeterminateCreateError, type LinearPort, type IssueScope } from "task-linear-sync/tracker";
import type { LinearPort as FrozenPort } from "task-linear-sync/ports";

const HOST = "https://sync.example.invalid/task-linear-sync";

function seed(over: Partial<FakeWorldSeed> = {}): FakeWorldSeed {
  return {
    teams: [
      {
        key: "acme-team",
        id: "team-acme",
        projects: [
          { id: "prj-acme-alpha", name: "proj-alpha" },
          { id: "prj-acme-beta", name: "proj-beta" },
        ],
        workflowStates: [
          { id: "st-acme-todo", name: "Todo", type: "unstarted" },
          { id: "st-acme-done", name: "Done", type: "completed" },
          { id: "st-acme-cancel", name: "Canceled", type: "canceled" },
        ],
      },
      {
        key: "globex-team",
        id: "team-globex",
        projects: [{ id: "prj-glx-main", name: "proj-main" }],
        workflowStates: [{ id: "st-glx-todo", name: "Todo", type: "unstarted" }],
      },
    ],
    issues: [
      { id: syntheticUuid(1), key: "ACM-1", teamKey: "acme-team", projectId: "prj-acme-alpha", title: "A one", description: "d1", stateType: "unstarted", updatedAt: "2026-10-01T00:00:00.000Z" },
      { id: syntheticUuid(2), key: "ACM-2", teamKey: "acme-team", projectId: "prj-acme-beta", title: "A foreign project", description: "d2", stateType: "unstarted", updatedAt: "2026-10-01T00:00:00.000Z" },
      { id: syntheticUuid(3), key: "ACM-3", teamKey: "acme-team", projectId: "prj-acme-alpha", title: "A canceled", description: "d3", stateType: "canceled", updatedAt: "2026-10-01T00:00:00.000Z" },
      { id: syntheticUuid(4), key: "GLX-1", teamKey: "globex-team", projectId: "prj-glx-main", title: "G one", description: "d4", stateType: "unstarted", updatedAt: "2026-10-01T00:00:00.000Z" },
      { id: syntheticUuid(5), key: "GLX-2", teamKey: "globex-team", projectId: "prj-acme-alpha", title: "Trap: team B row with team A project", description: "d5", stateType: "unstarted", updatedAt: "2026-10-01T00:00:00.000Z" },
    ],
    ...over,
  };
}

const acmeScope = (pageSize = 10): IssueScope => ({
  teamKeys: ["acme-team"],
  perTeam: { "acme-team": { projects: ["proj-alpha"], ignoredStateTypes: ["canceled", "duplicate"] } },
  pageSize,
});

async function collect(it: AsyncIterableIterator<{ key: string }>): Promise<string[]> {
  const out: string[] = [];
  for await (const row of it) out.push(row.key);
  return out;
}

test("fake: per-team scoping uses the SHARED guard module (not a re-implementation)", () => {
  assert.strictEqual(testingGuard, coreGuard, "same function reference — belt-and-braces code path is shared");
});

test("fake: listIssues exact predicate — team AND project AND not-ignored-state", async () => {
  const port = createFakeLinearPort(seed());
  assert.deepEqual(await collect(port.listIssues(acmeScope())), ["ACM-1"]);
  const globex = await collect(
    port.listIssues({
      teamKeys: ["globex-team"],
      perTeam: { "globex-team": { projects: ["proj-main"], ignoredStateTypes: ["canceled", "duplicate"] } },
      pageSize: 10,
    }),
  );
  assert.deepEqual(globex, ["GLX-1"], "cross-team trap row (team B row with team A project) excluded everywhere");
});

test("fake: teams proceed in configured order; per-team partitions never leak", async () => {
  const port = createFakeLinearPort(seed());
  const scope: IssueScope = {
    teamKeys: ["globex-team", "acme-team"],
    perTeam: {
      "acme-team": { projects: ["proj-alpha"], ignoredStateTypes: ["canceled"] },
      "globex-team": { projects: ["proj-main"], ignoredStateTypes: [] },
    },
    pageSize: 10,
  };
  const keys = await collect(port.listIssues(scope));
  assert.deepEqual(keys, ["GLX-1", "ACM-1"], "grouped per team in teamKeys order");
});

test("fake: cursor pagination — opaque c:<index> cursors, nextCursor null only at the end", async () => {
  const port = createFakeLinearPort(
    seed({
      pageSize: 2,
      attachments: [
        { issueId: syntheticUuid(1), id: "att-a", url: `${HOST}/task-linear-sync/${syntheticUuid(101)}`, title: "t1", metadata: {} },
        { issueId: syntheticUuid(1), id: "att-b", url: `${HOST}/task-linear-sync/${syntheticUuid(102)}`, title: "t2", metadata: {} },
        { issueId: syntheticUuid(1), id: "att-c", url: `${HOST}/task-linear-sync/${syntheticUuid(103)}`, title: "t3", metadata: {} },
      ],
    }),
  );
  const p1 = await port.listAttachments(syntheticUuid(1));
  assert.equal(p1.items.length, 2);
  assert.equal(p1.nextCursor, "c:2");
  const p2 = await port.listAttachments(syntheticUuid(1), p1.nextCursor);
  assert.equal(p2.items.length, 1);
  assert.equal(p2.nextCursor, null);
  assert.equal(p1.items[0].id, "att-a");
  assert.equal(p2.items[0].id, "att-c");
});

test("fake: mid-pagination scriptFailure throws with no partial page yielded (earlier pages valid)", async () => {
  const issues = Array.from({ length: 7 }, (_, i) => ({
    id: syntheticUuid(200 + i),
    key: `ACM-${200 + i}`,
    teamKey: "acme-team",
    projectId: "prj-acme-alpha",
    title: `issue ${i}`,
    description: "d",
    stateType: "unstarted",
    updatedAt: "2026-10-01T00:00:00.000Z",
  }));
  const port = createFakeLinearPort(seed({ issues }));
  port.scriptFailure("listIssues", { atCall: 2, kind: "http-5xx" });
  const seen: string[] = [];
  await assert.rejects(
    (async () => {
      for await (const row of port.listIssues(acmeScope(3))) seen.push(row.key);
    })(),
    (e: unknown) => {
      assert.ok(e instanceof TrackerError);
      assert.equal(e.category, "server");
      assert.equal(e.retryable, true);
      assert.equal(e.attempts, 6, "world default maxRetries 5 ⇒ maxRetries + 1");
      return true;
    },
  );
  assert.deepEqual(seen, ["ACM-200", "ACM-201", "ACM-202"], "page 1 stays; page 2 contributes nothing");
});

test("fake: URL-idempotent upsert updates in place — no duplicate, callLog grows", async () => {
  const url = `${HOST}/task-linear-sync/${syntheticUuid(500)}`;
  const port = createFakeLinearPort(seed());
  const issueId = syntheticUuid(1);
  const first = await port.upsertAttachmentByUrl({ issueId, url, title: "sync state", metadata: { v: 1 } });
  const sizeAfterCreate = port.world.attachments.size;
  const logAfterCreate = port.callLog.length;
  const second = await port.upsertAttachmentByUrl({ issueId, url, title: "sync state updated", subtitle: "sub", metadata: { v: 2 } });
  assert.equal(second.id, first.id, "updated in place — same attachment");
  assert.equal(port.world.attachments.size, sizeAfterCreate, "no duplicate stored");
  assert.ok(port.callLog.length > logAfterCreate, "callLog grows");
  assert.equal(second.title, "sync state updated");
  assert.deepEqual(second.metadata, { v: 2 });
  assert.deepEqual(await port.findIssuesByAttachmentUrl(url), [
    { ...(await port.getIssue(issueId))! },
  ]);
});

test("fake: upsert against an unknown issue ⇒ not-found TrackerError", async () => {
  const port = createFakeLinearPort(seed());
  await assert.rejects(
    port.upsertAttachmentByUrl({ issueId: syntheticUuid(999), url: "https://sync.example.invalid/task-linear-sync/x", title: "t", metadata: {} }),
    (e: unknown) => e instanceof TrackerError && e.category === "not-found",
  );
});

test("fake: scriptFailure maps to the R12 taxonomy with attempts semantics (non-create ⇒ maxRetries + 1)", async () => {
  const port = createFakeLinearPort(seed({ maxRetries: 2 }));
  port.scriptFailure("getIssue", { atCall: 1, kind: "http-429-retryAfter" });
  await assert.rejects(
    port.getIssue(syntheticUuid(1)),
    (e: unknown) => {
      assert.ok(e instanceof TrackerError);
      assert.equal(e.category, "rate-limit");
      assert.equal(e.retryable, true);
      assert.equal(e.attempts, 3, "maxRetries 2 + 1");
      return true;
    },
  );
  port.scriptFailure("listAttachments", { atCall: 1, kind: "network" });
  await assert.rejects(port.listAttachments(syntheticUuid(1)), (e: unknown) => e instanceof TrackerError && e.category === "network");
  port.scriptFailure("archiveIssue", { atCall: 1, kind: "graphql-userError" });
  await assert.rejects(
    port.archiveIssue(syntheticUuid(1)),
    (e: unknown) => e instanceof TrackerError && e.category === "graphql" && e.retryable === false && e.attempts === 1,
  );
});

test("fake: scriptFailure fires at the scripted call count, then the method succeeds", async () => {
  const port = createFakeLinearPort(seed());
  port.scriptFailure("getIssue", { atCall: 2, kind: "http-5xx", then: "succeed" });
  assert.notEqual(await port.getIssue(syntheticUuid(1)), null, "call 1 fine");
  await assert.rejects(port.getIssue(syntheticUuid(1)), (e: unknown) => e instanceof TrackerError && e.category === "server");
  assert.notEqual(await port.getIssue(syntheticUuid(1)), null, "call 3 fine after one-shot failure");
});

test("fake: create guard — scripted failures always IndeterminateCreateError attempts 1, world unchanged", async () => {
  for (const kind of ["http-429-retryAfter", "http-5xx", "network"] as const) {
    const port = createFakeLinearPort(seed({ maxRetries: 5 }));
    port.scriptFailure("createIssue", { atCall: 1, kind });
    const before = port.world.issues.size;
    await assert.rejects(
      port.createIssue({ teamKey: "acme-team", projectId: "proj-alpha", title: "t", description: "d" }),
      (e: unknown) => {
        assert.ok(e instanceof IndeterminateCreateError, kind);
        assert.equal(e.attempts, 1, "create ⇒ always 1");
        return true;
      },
    );
    assert.equal(port.world.issues.size, before, "nothing mutated");
  }
});

test("fake: NO description-search capability exists anywhere on the fake (FR-004 world property)", async () => {
  const port = createFakeLinearPort(seed());
  const frozenMembers: (keyof FrozenPort)[] = [
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
  ];
  const portKeys = Object.keys(port).filter((k) => frozenMembers.includes(k as keyof FrozenPort));
  assert.deepEqual(portKeys.sort(), [...frozenMembers].sort(), "exactly the 11 frozen members");
  for (const key of Object.keys(port)) assert.ok(!/search|description/i.test(key), `member '${key}' must not expose search/description lookup`);
  // A UUID-shaped description never produces a match — only attachment metadata resolves identity:
  const adversarial = await port.createIssue({
    teamKey: "acme-team",
    projectId: "proj-alpha",
    title: "Adversarial",
    description: `history at ${HOST}/${syntheticUuid(777)} here`,
  });
  assert.match(adversarial.description, new RegExp(syntheticUuid(777)));
  assert.deepEqual(await port.findIssuesByAttachmentUrl(`${HOST}/${syntheticUuid(777)}`), [], "0 matches via attachment metadata");
});

test("fake: identity find returns ALL carriers (0/1/2+); getAttachmentByUrl absent ⇒ null", async () => {
  const url = `${HOST}/task-linear-sync/${syntheticUuid(600)}`;
  const port = createFakeLinearPort(seed());
  assert.deepEqual(await port.findIssuesByAttachmentUrl(url), []);
  assert.equal(await port.getAttachmentByUrl(url), null);
  await port.upsertAttachmentByUrl({ issueId: syntheticUuid(1), url, title: "carrier one", metadata: {} });
  await port.upsertAttachmentByUrl({ issueId: syntheticUuid(4), url, title: "carrier two", metadata: {} });
  const carriers = await port.findIssuesByAttachmentUrl(url);
  assert.deepEqual(carriers.map((i) => i.key), ["ACM-1", "GLX-1"], "both carriers reported (>1 is the caller's integrity signal)");
});

test("fake: createIssue mutates the world deterministically; unknown team/project identities are pre-dispatch config errors", async () => {
  const port = createFakeLinearPort(seed());
  const created = await port.createIssue({ teamKey: "acme-team", projectId: "proj-alpha", title: "Brand new", description: "body" });
  assert.equal(created.id, syntheticUuid(1001), "deterministic synthetic id");
  assert.equal(created.stateType, "unstarted", "defaults to the team's first workflow state type");
  assert.deepEqual((await port.getIssue(created.id))!.title, "Brand new");
  await assert.rejects(
    port.createIssue({ teamKey: "no-such-team", projectId: "proj-alpha", title: "t", description: "d" }),
    (e: unknown) => e instanceof TrackerConfigError && /no-such-team/.test(e.detail),
  );
  await assert.rejects(
    port.createIssue({ teamKey: "acme-team", projectId: "proj-unknown", title: "t", description: "d" }),
    (e: unknown) => e instanceof TrackerConfigError && /acme-team/.test(e.detail) && /proj-unknown/.test(e.detail),
  );
});

test("fake: getIssue unknown ⇒ null; update/archive unknown ⇒ not-found; archive flips archived", async () => {
  const port = createFakeLinearPort(seed());
  assert.equal(await port.getIssue(syntheticUuid(999)), null);
  await assert.rejects(port.updateIssue(syntheticUuid(999), { title: "x" }), (e: unknown) => e instanceof TrackerError && e.category === "not-found");
  await assert.rejects(port.archiveIssue(syntheticUuid(999)), (e: unknown) => e instanceof TrackerError && e.category === "not-found");
  await assert.rejects(port.updateAttachment("att-missing", { a: 1 }), (e: unknown) => e instanceof TrackerError && e.category === "not-found");
  await port.archiveIssue(syntheticUuid(1));
  assert.equal((await port.getIssue(syntheticUuid(1)))!.archived, true);
});

test("fake: updateIssue applies partial patches incl. stateTypeId → stateType name mapping", async () => {
  const port = createFakeLinearPort(seed());
  const updated = await port.updateIssue(syntheticUuid(1), { title: "New title", stateTypeId: "completed" });
  assert.equal(updated.title, "New title");
  assert.equal(updated.stateType, "completed");
  assert.equal(updated.description, "d1", "untouched fields retained");
});

test("fake: discoverMetadata — three collections in REQUESTED order; unknown team named", async () => {
  const port = createFakeLinearPort(seed());
  const meta = await port.discoverMetadata(["globex-team", "acme-team"]);
  assert.deepEqual(meta.map((m) => m.teamKey), ["globex-team", "acme-team"]);
  assert.deepEqual(meta[0].projects, [{ id: "prj-glx-main", name: "proj-main" }]);
  assert.deepEqual(meta[1].workflowStates.map((s) => s.type), ["unstarted", "completed", "canceled"]);
  await assert.rejects(port.discoverMetadata(["nope-team"]), (e: unknown) => e instanceof TrackerConfigError && /nope-team/.test(e.detail));
});

test("fake: listIssues validates scope — unknown team/identity named, missing perTeam entry a config error", async () => {
  const port = createFakeLinearPort(seed());
  await assert.rejects(
    (async () => collect(port.listIssues({ teamKeys: ["ghost-team"], perTeam: { "ghost-team": { projects: ["p"], ignoredStateTypes: [] } }, pageSize: 5 })))(),
    (e: unknown) => e instanceof TrackerConfigError && /ghost-team/.test(e.detail),
  );
  await assert.rejects(
    (async () =>
      collect(
        port.listIssues({
          teamKeys: ["acme-team"],
          perTeam: { "acme-team": { projects: ["proj-unknown"], ignoredStateTypes: [] } },
          pageSize: 5,
        }),
      ))(),
    (e: unknown) => e instanceof TrackerConfigError && /proj-unknown/.test(e.detail) && /acme-team/.test(e.detail),
  );
  await assert.rejects(
    (async () => collect(port.listIssues({ teamKeys: ["acme-team"], perTeam: {}, pageSize: 5 })))(),
    (e: unknown) => e instanceof TrackerConfigError,
  );
});

test("fake: determinism — identical seeds yield identical inventories and metadata (Principle IV)", async () => {
  const a = createFakeLinearPort(seed());
  const b = createFakeLinearPort(seed());
  assert.equal(JSON.stringify(await collect(a.listIssues({ teamKeys: ["acme-team", "globex-team"], perTeam: { "acme-team": { projects: ["proj-alpha"], ignoredStateTypes: ["canceled"] }, "globex-team": { projects: ["proj-main"], ignoredStateTypes: [] } }, pageSize: 2 }))), JSON.stringify(await collect(b.listIssues({ teamKeys: ["acme-team", "globex-team"], perTeam: { "acme-team": { projects: ["proj-alpha"], ignoredStateTypes: ["canceled"] }, "globex-team": { projects: ["proj-main"], ignoredStateTypes: [] } }, pageSize: 2 }))));
  assert.equal(JSON.stringify(await a.discoverMetadata(["acme-team", "globex-team"])), JSON.stringify(await b.discoverMetadata(["acme-team", "globex-team"])));
});

test("fake: requests() op-log proves request counts (per-team page fetches)", async () => {
  const port = createFakeLinearPort(seed());
  await collect(port.listIssues(acmeScope(1)));
  const issueOps = port.requests().filter((r) => r.op === "issues");
  assert.equal(issueOps.length, 2, "2 in-scope-ish rows evaluated… only ACM-1 qualifies — pages of size 1 over the filtered set");
  assert.ok(issueOps.every((r) => r.ok));
  assert.ok(issueOps.every((r) => r.vars.teamKey === "acme-team"));
});

test("fake: callLog records every port-level call with args", async () => {
  const port = createFakeLinearPort(seed());
  await port.getIssue(syntheticUuid(1));
  await port.getAttachmentByUrl("x");
  assert.deepEqual(port.callLog.slice(0, 2).map((c) => c.method), ["getIssue", "getAttachmentByUrl"]);
  assert.deepEqual(port.callLog[0].args, [syntheticUuid(1)]);
});
