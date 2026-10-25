/**
 * T036 [US2] — chain-walk integration through the REAL adapter over the recorded
 * `attachment-chain/` scenario (the gap world: pages 0,1,2 present; 3 absent; 4 orphaned
 * inside the probe window; 5..11 absent): continuation pages are "addressed purely by URL
 * (scheme contract)" — one `attachmentsForURL` lookup per probed page + the bounded orphan
 * window; the end-to-end `enumerateAttachmentChain` result EQUALS the fake binding's (parity).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { builtInDefaults } from "task-linear-sync/config";
import { attachmentUrlConfigFrom, createLinearPort, enumerateAttachmentChain } from "task-linear-sync/tracker";
import { createFakeLinearPort, createRecordedTransport, syntheticUuid } from "task-linear-sync/tracker/testing";
import { FakeClock, FakeSleeper, fixtureEnv, loadWorld, scenarioDir, splitmixRng } from "../helpers/tracker-harness.js";

const cfg = attachmentUrlConfigFrom(builtInDefaults);
const TASK = syntheticUuid(7);

test("chain walk [real-over-recorded]: gap/orphans end-to-end; one lookup per probed page; parity with the fake", async () => {
  const transport = createRecordedTransport(scenarioDir("attachment-chain"));
  const port = createLinearPort({
    config: builtInDefaults,
    options: {
      transport,
      env: fixtureEnv(),
      clock: new FakeClock("2026-10-23T12:00:00.000Z"),
      rng: splitmixRng(9),
      sleep: new FakeSleeper().sleep,
    },
  });
  const chain = await enumerateAttachmentChain(port, cfg, TASK);
  assert.equal(chain.pages.length, 2, "stop at the first absent index (page 3)");
  assert.deepEqual(chain.orphans, [4]);
  assert.notEqual(chain.canonical, null);

  const lookups = transport.requests();
  assert.equal(lookups.length, 12, "canonical + pages 1..3 (stop) + 8-page orphan window = 12 lookups");
  assert.ok(lookups.every((r) => r.operationName === "attachmentsForURL"), "continuation is addressed purely by URL");

  // Parity: the identical walk against the fake world yields the identical result.
  const fake = createFakeLinearPort(loadWorld("attachment-chain"));
  const fakeChain = await enumerateAttachmentChain(fake, cfg, TASK);
  assert.deepEqual(JSON.parse(JSON.stringify(chain)), JSON.parse(JSON.stringify(fakeChain)));
});

test("chain walk [real-over-recorded]: a canonical-less task resolves to an empty chain", async () => {
  const transport = createRecordedTransport(scenarioDir("attachment-chain"));
  const port = createLinearPort({
    config: builtInDefaults,
    options: {
      transport,
      env: fixtureEnv(),
      clock: new FakeClock("2026-10-23T12:00:00.000Z"),
      rng: splitmixRng(9),
      sleep: new FakeSleeper().sleep,
    },
  });
  const chain = await enumerateAttachmentChain(port, cfg, syntheticUuid(4242));
  assert.equal(chain.canonical, null);
  assert.deepEqual([...chain.pages], []);
  assert.deepEqual([...chain.orphans], []);
  assert.equal(transport.requests().length, 1, "no anchor ⇒ no walk, a single probe only");
});
