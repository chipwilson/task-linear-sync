/**
 * T035 [US2] — identity/attachment integration tests on BOTH bindings: adversarial fixtures
 * (descriptions embedding UUID-shaped text yield **0** matches — SC-003: "Identity lookups
 * resolve 100% via attachment metadata and 0 via description content"); `upsert-idempotency/`
 * (two upserts of one canonical URL ⇒ exactly 1 attachment updated in place, adapter stores no
 * attachment id — SC-002/FR-005); `findIssuesByAttachmentUrl` returns all 0/1/2+ carriers
 * (>1 = the caller's constitution-II integrity signal — the port reports, never hides);
 * `getAttachmentByUrl` absent ⇒ null; `listAttachments` cursor pages + the FR-004 scan route
 * finds the identity-bearing attachment.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { builtInDefaults } from "task-linear-sync/config";
import { attachmentUrlConfigFrom, createLinearPort, issueCarriesTaskIdentity, resolveIssueByTaskIdentity, type LinearPort } from "task-linear-sync/tracker";
import { canonicalAttachmentUrl } from "task-linear-sync/urls";
import { createFakeLinearPort, createRecordedTransport, syntheticUuid } from "task-linear-sync/tracker/testing";
import { FakeClock, FakeSleeper, fixtureEnv, loadWorld, scenarioDir, splitmixRng } from "../helpers/tracker-harness.js";

const cfg = attachmentUrlConfigFrom(builtInDefaults);
const canon = (n: number): string => canonicalAttachmentUrl(cfg, syntheticUuid(n));

interface Bundle {
  name: string;
  make(dir: string): { port: LinearPort; createCalls(): number; listCalls(): number };
}

const bindings: Bundle[] = [
  {
    name: "fake",
    make(dir) {
      const port = createFakeLinearPort(loadWorld(dir));
      return {
        port,
        createCalls: () => port.requests().filter((r) => r.op === "attachmentCreate").length,
        listCalls: () => port.requests().filter((r) => r.op === "issueAttachments").length,
      };
    },
  },
  {
    name: "real-over-recorded",
    make(dir) {
      const transport = createRecordedTransport(scenarioDir(dir));
      const port = createLinearPort({
        config: { ...builtInDefaults, pageSize: 2 },
        options: {
          transport,
          env: fixtureEnv(),
          clock: new FakeClock("2026-10-23T12:00:00.000Z"),
          rng: splitmixRng(9),
          sleep: new FakeSleeper().sleep,
        },
      });
      return {
        port,
        createCalls: () => transport.requests().filter((r) => r.operationName === "attachmentCreate").length,
        listCalls: () => transport.requests().filter((r) => r.operationName === "issueAttachments").length,
      };
    },
  },
];

for (const binding of bindings) {
  test(`identity [${binding.name}]: SC-003 — the carrier matches, UUID-shaped DESCRIPTION never does`, async () => {
    const h = binding.make("adversarial-descriptions");
    const matches = await h.port.findIssuesByAttachmentUrl(canon(1));
    assert.deepEqual(matches.map((i) => i.key), ["ACM-501"], "identity resolves via attachment metadata");
    const adversarial = await h.port.getIssue(syntheticUuid(502));
    assert.ok(adversarial !== null, "adversarial issue exists in the world");
    assert.ok(adversarial.description.includes(canon(1)), "the fixture really embeds the canonical URL as description TEXT");
    assert.deepEqual(await h.port.findIssuesByAttachmentUrl(canon(2)), [], "UUID-like description content: 0 matches");
    assert.equal(await h.port.getAttachmentByUrl(canon(2)), null);
  });

  test(`attachments [${binding.name}]: SC-002 — two upserts of one URL update IN PLACE, no duplicate, no stored id`, async () => {
    const h = binding.make("upsert-idempotency");
    const url = canon(9);
    const first = await h.port.upsertAttachmentByUrl({ issueId: syntheticUuid(701), url, title: "sync state", subtitle: "canonical", metadata: { v: 1 } });
    const second = await h.port.upsertAttachmentByUrl({ issueId: syntheticUuid(701), url, title: "sync state", subtitle: "canonical updated", metadata: { v: 2 } });
    assert.equal(second.id, first.id, "updated in place — one attachment per URL");
    assert.equal(second.subtitle, "canonical updated");
    assert.equal(second.metadata.v, 2);
    assert.equal(h.createCalls(), 2, "one platform create call per upsert — idempotency is the platform's (no read-before-write)");
    const fetched = await h.port.getAttachmentByUrl(url);
    assert.equal(fetched?.id, first.id, "the adapter stored NOTHING client-side — fetch went over the wire again");
  });

  test(`attachments [${binding.name}]: listAttachments cursor pages + scan route finds the identity-bearing attachment`, async () => {
    const h = binding.make("upsert-idempotency");
    const url = canon(9);
    await h.port.upsertAttachmentByUrl({ issueId: syntheticUuid(701), url, title: "sync state", metadata: { v: 1 } });
    const urls: string[] = [];
    let pageCount = 0;
    let cursor: string | null = null;
    for (;;) {
      const page = await h.port.listAttachments(syntheticUuid(701), cursor);
      pageCount += 1;
      urls.push(...page.items.map((a) => a.url));
      if (page.nextCursor === null) break;
      cursor = page.nextCursor;
      assert.ok(pageCount < 10, "cursor walk terminates");
    }
    assert.equal(pageCount, 2, "two cursor pages at page size 2");
    assert.ok(urls.includes(url), "FR-004 scan route (page 0..n over listAttachments) finds the carrier");
    assert.equal(h.listCalls(), 2);
  });
}

test("identity [fake]: findIssuesByAttachmentUrl reports ALL carriers — 0, 1, and 2+ (>1 is the caller's integrity signal)", async () => {
  const port = createFakeLinearPort(loadWorld("adversarial-descriptions"));
  const url = canon(1);
  assert.equal((await port.findIssuesByAttachmentUrl(url)).length, 1, "one carrier");
  await port.upsertAttachmentByUrl({ issueId: syntheticUuid(502), url, title: "second carrier", metadata: {} });
  const carriers = await port.findIssuesByAttachmentUrl(url);
  assert.deepEqual(carriers.map((i) => i.key).sort(), ["ACM-501", "ACM-502"], "2+ carriers reported, not hidden");
  assert.deepEqual(await port.findIssuesByAttachmentUrl(canon(77)), [], "0 carriers");
});

for (const binding of bindings) {
  test(`identity helpers [${binding.name}] (T039): resolveIssueByTaskIdentity + issueCarriesTaskIdentity`, async () => {
    const h = binding.make("adversarial-descriptions");
    // Resolution rides the page-0 canonical URL only.
    const carriers = await resolveIssueByTaskIdentity(h.port, cfg, syntheticUuid(1));
    assert.deepEqual(carriers?.map((i) => i.key), ["ACM-501"]);
    assert.equal(await resolveIssueByTaskIdentity(h.port, cfg, syntheticUuid(77)), null, "0 carriers ⇒ null");

    // Scan route: ACM-501 carries the identity; ACM-502 only MENTIONS uuid-shaped text.
    assert.equal(await issueCarriesTaskIdentity(h.port, cfg, syntheticUuid(501), syntheticUuid(1)), true);
    assert.equal(await issueCarriesTaskIdentity(h.port, cfg, syntheticUuid(502), syntheticUuid(1)), false, "description text is never a carrier");

    // A carrier reached through the CURSOR route (upsert world, pageSize 2).
    const up = binding.make("upsert-idempotency");
    const url = canon(9);
    await up.port.upsertAttachmentByUrl({ issueId: syntheticUuid(701), url, title: "sync state", metadata: { v: 1 } });
    assert.equal(await issueCarriesTaskIdentity(up.port, cfg, syntheticUuid(701), syntheticUuid(9)), true);
    assert.ok(up.listCalls() >= 1, "the scan walked listAttachments cursors over the wire");
  });
}
