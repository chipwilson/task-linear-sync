/**
 * Feature 011 (Sync-History Web Component) — T011: US1 unit tests (spec
 * user-story-1: read the complete history for one task).
 *
 * SC-001 fidelity is verified here in-process: a 10-page × 1000-event chain
 * (10 000 events, cross-page interleaved timestamps, an identifiable marker
 * event every 1000 events) must reconstruct into exactly 10 000 events in
 * exact chronological order, with every marker present and chain pages
 * merged correctly. Integrity rules and gap semantics per
 * contracts/history-reconstruction.md.
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { loadConfig } from "../../src/config/load.js";
import { createDefaultSecurityScreener } from "../../src/engine/screening.js";
import type { ResolvedConfig } from "../../src/config/schema.js";
import {
  HISTORY_ALT_TASK_UUID,
  HISTORY_OTHER_TASK_UUID,
  HISTORY_TASK_UUID,
  buildChainWorld,
  makeFixedClock,
  type ChainWorld,
  type ChainWorldSpec,
} from "../helpers/history-harness.js";
import { reconstructHistory, MAX_CHAIN_PAGES } from "../../src/history-server/reconstruct.js";
import type { ReconstructDeps } from "../../src/history-server/reconstruct.js";
import type { HistoryErrorCode } from "../../src/history-server/errors.js";

const config: ResolvedConfig = loadConfig({});

function deps(world: ChainWorld): ReconstructDeps {
  return {
    port: world.fake,
    config,
    clock: makeFixedClock(),
    screener: createDefaultSecurityScreener(config),
  };
}

function urlsCalled(world: ChainWorld): string[] {
  return world.fake.callLog
    .filter((entry) => entry.method === "getAttachmentByUrl")
    .map((entry) => String(entry.args[0]));
}

function envelopeCode(fn: () => Promise<unknown>): Promise<HistoryErrorCode> {
  return fn().then(
    () => assert.fail("expected a HistoryRequestError"),
    (error: { envelope?: { code: HistoryErrorCode } }) => {
      assert.equal(typeof error.envelope?.code, "string", "must be a HistoryRequestError");
      return error.envelope!.code;
    },
  );
}

function reconstruct(world: ChainWorld) {
  return reconstructHistory(deps(world), HISTORY_TASK_UUID);
}

test("history-reconstruct: SC-001: a 10-page x 1000-event chain reconstructs to exactly 10 000 ordered events", async () => {
  const world = buildChainWorld({ pages: 10, eventsPerPage: 1000, interleave: true });
  const view = await reconstruct(world);

  assert.equal(view.taskUuid, HISTORY_TASK_UUID);
  assert.equal(view.pages.length, 10);
  assert.equal(view.events.length, 10000, "no event missing");
  assert.deepEqual(
    view.pages,
    Array.from({ length: 10 }, (_, p) => ({ index: p, eventCount: 1000 })),
  );

  // exact chronological order
  for (let i = 1; i < view.events.length; i += 1) {
    assert.ok(
      Date.parse(view.events[i]!.at) >= Date.parse(view.events[i - 1]!.at),
      `events[${String(i)}] breaks chronology`,
    );
  }

  // every marker present, correct kind, its references carried through
  const markers = view.events.filter((event) => event.kind === "rollback");
  assert.equal(markers.length, 10);
  for (const markerText of world.markers) {
    const n = Number(markerText.slice("SC001-MARKER-".length));
    const event = view.events.find((candidate) => candidate.description === markerText);
    assert.ok(event !== undefined, `marker ${markerText} lost`);
    assert.deepEqual(event.references, [`op-${String(n * 1000 - 1)}`]);
  }

  // interleaved page slices prove the merge is chronological, not chain-order:
  // the 3rd event chronologically came from page 2, not the page-0 run.
  assert.equal(view.events[2]!.description, "sync event 2000 page 2");
});

test("history-reconstruct: merge keeps a stable order for events sharing one timestamp", async () => {
  const world = buildChainWorld({ pages: 3, eventsPerPage: 4, tieAllAt: true });
  const view = await reconstruct(world);
  assert.equal(view.events.length, 12);
  assert.deepEqual(
    view.events.map((event) => event.description),
    world.events.map((event) => event.description),
    "stable sort keeps chain order on ties",
  );
});

test("history-reconstruct: the walk follows addresses and stops at the first absent page (gap-stops-walk)", async () => {
  const world = buildChainWorld({ pages: 4, eventsPerPage: 2, presentPages: [0, 1, 3] });
  const view = await reconstruct(world);
  assert.equal(view.pages.length, 2);
  assert.equal(view.events.length, 4);
  assert.deepEqual(
    view.pages,
    [
      { index: 0, eventCount: 2 },
      { index: 1, eventCount: 2 },
    ],
    "served view covers pages 0-1 only",
  );

  const urls = urlsCalled(world);
  assert.equal(urls.length, 3, "pages beyond the gap are never probed");
  assert.equal(urls[0], world.canonicalUrl);
  assert.equal(urls[1], world.addressOf(1));
  assert.equal(urls[2], world.addressOf(2));
  assert.ok(!urls.includes(world.addressOf(3)), "no orphan probe past the gap");
});

test("history-reconstruct: the fake call log contains zero mutation members", async () => {
  const world = buildChainWorld({ pages: 2, eventsPerPage: 2 });
  await reconstruct(world);
  const methods = new Set(world.fake.callLog.map((entry) => entry.method));
  assert.deepEqual([...methods], ["getAttachmentByUrl"]);
});

test("history-reconstruct: page payload identity mismatch is a chain-integrity refusal (502)", async () => {
  const world = buildChainWorld({
    pages: 2,
    eventsPerPage: 1,
    corruptPage: 1,
    corruptKind: "task-uuid",
  });
  assert.equal(await envelopeCode(() => reconstruct(world)), "TRACKER_UNAVAILABLE");
});

test("history-reconstruct: a page record contradicting its addressed index is refused (502)", async () => {
  const world = buildChainWorld({ pages: 2, eventsPerPage: 1, corruptPage: 1, corruptKind: "page" });
  assert.equal(await envelopeCode(() => reconstruct(world)), "TRACKER_UNAVAILABLE");
});

test("history-reconstruct: an unparseable page mid-chain surfaces as unavailable (502)", async () => {
  const world = buildChainWorld({ pages: 2, eventsPerPage: 1, corruptPage: 1, corruptKind: "json" });
  assert.equal(await envelopeCode(() => reconstruct(world)), "TRACKER_UNAVAILABLE");
});

test("history-reconstruct: a page record with a non-array history is refused (502)", async () => {
  const world = buildChainWorld({
    pages: 2,
    eventsPerPage: 1,
    corruptPage: 1,
    corruptKind: "history",
  });
  assert.equal(await envelopeCode(() => reconstruct(world)), "TRACKER_UNAVAILABLE");
});

test("history-reconstruct: an empty history is a valid complete story (200)", async () => {
  const world = buildChainWorld({ pages: 1, eventsPerPage: 0 });
  const view = await reconstruct(world);
  assert.deepEqual(view.events, []);
  assert.equal(view.pages.length, 1);
  assert.equal(view.lastSyncAt, "2026-01-15T08:00:00.000Z", "page-0 cursor passthrough");
});

test("history-reconstruct: a page-0 payload claiming another task is refused (502)", async () => {
  const world = buildChainWorld({ pages: 1, eventsPerPage: 1, corruptPage: 0 });
  // corruptPage on page 0 rewrites the payload taskUuid to the ALT uuid while
  // the addressed URL names HISTORY_TASK_UUID — the identity check must refuse.
  assert.equal(await envelopeCode(() => reconstruct(world)), "TRACKER_UNAVAILABLE");
});

test("history-reconstruct: the 1000-page chain bound refuses safely after exactly the bound", async () => {
  assert.equal(MAX_CHAIN_PAGES, 1000);
  const spec: ChainWorldSpec = { pages: MAX_CHAIN_PAGES + 1, eventsPerPage: 0 };
  const world = buildChainWorld(spec);
  assert.equal(await envelopeCode(() => reconstruct(world)), "TRACKER_UNAVAILABLE");
  assert.equal(
    urlsCalled(world).length,
    MAX_CHAIN_PAGES + 1,
    "exactly bound+1 probes, then refusal, no orphan probes",
  );
});

test("history-reconstruct: a chain ending at page index 999 stays within the bound", async () => {
  const world = buildChainWorld({ pages: MAX_CHAIN_PAGES, eventsPerPage: 0 });
  const view = await reconstruct(world);
  assert.equal(view.pages.length, MAX_CHAIN_PAGES);
  // pages 0..999 present + one probe of the absent page 1000 = bound + 1 reads
  assert.equal(urlsCalled(world).length, MAX_CHAIN_PAGES + 1);
});

test("history-reconstruct: reconstruction never mutates the tracker world", async () => {
  const world = buildChainWorld({ pages: 3, eventsPerPage: 2, interleave: true });
  const before = JSON.stringify(world.fake.world.attachments);
  await reconstruct(world);
  assert.equal(JSON.stringify(world.fake.world.attachments), before);
});

test("history-reconstruct: a task without a canonical attachment is not found (404)", async () => {
  const world = buildChainWorld({
    taskUuid: HISTORY_OTHER_TASK_UUID,
    pages: 1,
    eventsPerPage: 2,
  });
  assert.equal(await envelopeCode(() => reconstruct(world)), "NOT_FOUND");
  assert.equal(urlsCalled(world).length, 1, "no orphan probes after a missing canonical page");
});

test("history-reconstruct: lastSyncAt is the page-0 cursor; generatedAt is the injected clock", async () => {
  const world = buildChainWorld({ pages: 2, eventsPerPage: 3, interleave: true });
  const view = await reconstruct(world);
  assert.equal(view.lastSyncAt, "2026-01-15T08:00:00.000Z");
  assert.equal(view.generatedAt, makeFixedClock().now().toISOString());
});

test("history-reconstruct: secret-shaped event text never reaches the view", async () => {
  const world = buildChainWorld({ pages: 1, eventsPerPage: 1, secretShape: true });
  const view = await reconstruct(world);
  const json = JSON.stringify(view);
  for (const secret of world.secretValues) {
    assert.ok(!json.includes(secret), "secret-shaped value must never reach the view");
  }
  assert.ok(json.includes("[blocked:"), "blocked content replaced by category sentinel");
  const routine = view.events.find((event) => event.description === "routine update with no secrets");
  assert.ok(routine !== undefined, "benign events pass through untouched");
});

test("history-reconstruct: the ALT uuid sanity constant differs from the task uuid", () => {
  assert.notEqual(HISTORY_ALT_TASK_UUID, HISTORY_TASK_UUID);
});
