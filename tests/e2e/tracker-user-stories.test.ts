/**
 * T048 [P] — scripted end-to-end walkthroughs (quickstart "Test tiers" e2e row; constitution
 * VI: the top layer is THIN — it composes the same fake/recorded bindings the contract tier
 * uses, zero network, zero new mechanics):
 *
 *  US1: config fixture → fake world → full inventory walk (all three teams, scope-isolated)
 *       + metadata discovery, then the identical journey over the recorded corpus (parity).
 *  US2: identity resolve (adversarial world — description UUIDs match nothing) → upsert twice
 *       (in place) → chain enumerate (gap + orphans) → scripted rate-limit recovery (real over
 *       recorded: 429 + Retry-After 3 ⇒ exactly one 3000ms wait) → create failure ⇒
 *       IndeterminateCreateError, exactly one request, never replayed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { builtInDefaults } from "task-linear-sync/config";
import {
  attachmentUrlConfigFrom,
  createLinearPort,
  enumerateAttachmentChain,
  IndeterminateCreateError,
  resolveIssueByTaskIdentity,
  TrackerConfigError,
  type IssueScope,
  type LinearPort,
} from "task-linear-sync/tracker";
import { canonicalAttachmentUrl } from "task-linear-sync/urls";
import { createFakeLinearPort, createRecordedTransport, syntheticUuid } from "task-linear-sync/tracker/testing";
import { FakeClock, FakeSleeper, fixtureEnv, loadWorld, scenarioDir, splitmixRng } from "../helpers/tracker-harness.js";

const config = { ...builtInDefaults, pageSize: 2 };
const cfg = attachmentUrlConfigFrom(builtInDefaults);

function recordedPort(dir: string): { port: LinearPort; sleeper: FakeSleeper; requests: () => readonly { operationName: string; status: number }[] } {
  const transport = createRecordedTransport(scenarioDir(dir));
  const sleeper = new FakeSleeper();
  const port = createLinearPort({
    config,
    options: { transport, env: fixtureEnv(), clock: new FakeClock("2026-10-23T12:00:00.000Z"), rng: splitmixRng(11), sleep: sleeper.sleep },
  });
  return { port, sleeper, requests: () => transport.requests() };
}

function fakePort(dir: string): LinearPort {
  return createFakeLinearPort(loadWorld(dir));
}

// ── US1 walkthrough ──────────────────────────────────────────────────────────────

const US1_SCOPE: IssueScope = {
  teamKeys: ["acme-team", "globex-team", "initech-team"],
  perTeam: {
    "acme-team": { projects: ["proj-alpha"], ignoredStateTypes: ["canceled", "duplicate"] },
    "globex-team": { projects: ["proj-main"], ignoredStateTypes: ["canceled", "duplicate"] },
    "initech-team": { projects: ["proj-core"], ignoredStateTypes: ["canceled", "duplicate"] },
  },
  pageSize: 3,
};

async function us1Journey(port: LinearPort): Promise<{ byTeam: Record<string, string[]>; metaTeams: string[] }> {
  const byTeam: Record<string, string[]> = {};
  for await (const row of port.listIssues(US1_SCOPE)) (byTeam[row.teamKey] ??= []).push(row.key);
  const meta = await port.discoverMetadata(["globex-team", "acme-team"]);
  return { byTeam, metaTeams: meta.map((m) => m.teamKey) };
}

test("e2e US1 [fake]: full inventory walk is scope-isolated; metadata resolves in requested order", async () => {
  const journey = await us1Journey(fakePort("multi-team-inventory"));
  assert.deepEqual(journey.byTeam, {
    "acme-team": ["ACM-101", "ACM-102", "ACM-103", "ACM-104"],
    "globex-team": ["GLX-201", "GLX-202", "GLX-203", "GLX-204", "GLX-205"],
    "initech-team": ["INI-301"],
  }, "100% in-scope rows, 0 out-of-scope rows (SC-001)");
  assert.deepEqual(journey.metaTeams, ["globex-team", "acme-team"]);
});

test("e2e US1 [real-over-recorded]: the identical journey produces identical results (parity)", async () => {
  const journey = await us1Journey(recordedPort("multi-team-inventory").port);
  assert.deepEqual(journey.byTeam, {
    "acme-team": ["ACM-101", "ACM-102", "ACM-103", "ACM-104"],
    "globex-team": ["GLX-201", "GLX-202", "GLX-203", "GLX-204", "GLX-205"],
    "initech-team": ["INI-301"],
  });
  assert.deepEqual(journey.metaTeams, ["globex-team", "acme-team"]);
});

// ── US2 walkthrough ──────────────────────────────────────────────────────────────

async function us2IdentityAndUpsert(port: LinearPort): Promise<void> {
  // Identity resolves via the canonical attachment URL — adversarial descriptions match 0.
  const carriers = await resolveIssueByTaskIdentity(port, cfg, syntheticUuid(1));
  assert.deepEqual(carriers?.map((i) => i.key), ["ACM-501"]);
  assert.equal(await resolveIssueByTaskIdentity(port, cfg, syntheticUuid(2)), null, "UUID-shaped DESCRIPTION text is not an identity (SC-003)");
}

test("e2e US2 [fake]: identity resolve → upsert twice (in place) → chain enumerate (gap/orphans)", async () => {
  const identity = fakePort("adversarial-descriptions");
  await us2IdentityAndUpsert(identity);

  const up = fakePort("upsert-idempotency");
  const url = canonicalAttachmentUrl(cfg, syntheticUuid(9));
  const first = await up.upsertAttachmentByUrl({ issueId: syntheticUuid(701), url, title: "sync state", metadata: { v: 1 } });
  const second = await up.upsertAttachmentByUrl({ issueId: syntheticUuid(701), url, title: "sync state", metadata: { v: 2 } });
  assert.equal(second.id, first.id, "one attachment per URL — updated in place (SC-002)");
  assert.equal(second.metadata.v, 2);

  const chain = await enumerateAttachmentChain(fakePort("attachment-chain"), cfg, syntheticUuid(7));
  assert.deepEqual(chain.pages.map((p) => p.title), ["page-1", "page-2"]);
  assert.deepEqual(chain.orphans, [4], "the gap is reported, never skipped (FR-006)");
});

test("e2e US2 [real-over-recorded]: the identical journey — then scripted rate-limit recovery, then create-failure indeterminate", async () => {
  await us2IdentityAndUpsert(recordedPort("adversarial-descriptions").port);

  const up = recordedPort("upsert-idempotency");
  const url = canonicalAttachmentUrl(cfg, syntheticUuid(9));
  const first = await up.port.upsertAttachmentByUrl({ issueId: syntheticUuid(701), url, title: "sync state", metadata: { v: 1 } });
  const second = await up.port.upsertAttachmentByUrl({ issueId: syntheticUuid(701), url, title: "sync state", metadata: { v: 2 } });
  assert.equal(second.id, first.id);
  const chain = await enumerateAttachmentChain(recordedPort("attachment-chain").port, cfg, syntheticUuid(7));
  assert.deepEqual(chain.pages.map((p) => p.title), ["page-1", "page-2"]);
  assert.deepEqual(chain.orphans, [4]);

  // Recovery: a real 429 + `Retry-After: 3` becomes exactly one deterministic 3000ms wait.
  const rl = recordedPort("rate-limit-sequences");
  const issue = await rl.port.getIssue("1001");
  assert.equal(issue?.key, "SEQ-1001");
  assert.deepEqual(rl.sleeper.waits, [3000], "one wait, straight from the header (FR-003)");

  // Create failure: exactly ONE request, indeterminate, never replayed (constitution Resilience).
  const cf = recordedPort("create-failure");
  const input = { teamKey: "acme-team", projectId: "proj-alpha", title: "Never replayed", description: "d" };
  await assert.rejects(cf.port.createIssue(input), (e: unknown) => e instanceof IndeterminateCreateError && e.attempts === 1);
  assert.equal(cf.requests().filter((r) => r.operationName === "issueCreate").length, 1, "zero replay");
});

test("e2e US2 [pre-dispatch]: unknown project identity is rejected before ANY request (config, not indeterminate)", async () => {
  const cf = recordedPort("create-failure");
  await assert.rejects(
    cf.port.createIssue({ teamKey: "acme-team", projectId: "proj-ghost", title: "t", description: "d" }),
    (e: unknown) => e instanceof TrackerConfigError && /proj-ghost/.test(e.detail),
  );
  assert.equal(cf.requests().filter((r) => r.operationName === "issueCreate").length, 0);
});
