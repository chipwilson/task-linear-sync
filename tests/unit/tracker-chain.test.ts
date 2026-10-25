/**
 * T033 [US2] — unit tests for `enumerateAttachmentChain` (FR-006, research R8; data-model §6):
 * page0 (canonical) then continuation pages probed sequentially as DETERMINISTIC URLs built by
 * 002's frozen builders; the walk STOPS at the first absent index; orphaned higher pages inside
 * the bounded `orphanProbeLimit` window are REPORTED, never silently skipped; without a page-0
 * anchor nothing is walked at all. Forgery resistance by construction: the walker only ever
 * visits URLs derived from the frozen scheme — description content can never select a row.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { builtInDefaults } from "task-linear-sync/config";
import {
  attachmentUrlConfigFrom,
  enumerateAttachmentChain,
  TrackerError,
  type AttachmentView,
  type LinearPort,
} from "task-linear-sync/tracker";
import { canonicalAttachmentUrl, continuationAttachmentUrl } from "task-linear-sync/urls";

const cfg = attachmentUrlConfigFrom(builtInDefaults);
const TASK = "00000000-0000-4000-8000-000000000007";

function att(index: number, url: string, title?: string): AttachmentView {
  return { id: `att-${String(index)}`, url, title: title ?? `sync-state-${String(index)}`, metadata: { page: index } };
}

const canonical = canonicalAttachmentUrl(cfg, TASK);
const page = (n: number): string => continuationAttachmentUrl(cfg, TASK, n);

/** A port stub exposing ONLY getAttachmentByUrl — proves nothing else is reachable. */
function chainPort(rows: Record<string, AttachmentView>): { port: LinearPort; probes: string[] } {
  const probes: string[] = [];
  const port = {
    async getAttachmentByUrl(url: string): Promise<AttachmentView | null> {
      probes.push(url);
      return rows[url] ?? null;
    },
  } as unknown as LinearPort;
  return { port, probes };
}

test("chain: contiguous pages walked in index order; nothing orphaned", async () => {
  const { port, probes } = chainPort({
    [canonical]: att(0, canonical),
    [page(1)]: att(1, page(1)),
    [page(2)]: att(2, page(2)),
  });
  const chain = await enumerateAttachmentChain(port, cfg, TASK);
  assert.equal(chain.taskUuid, TASK);
  assert.equal(chain.canonical?.id, "att-0");
  assert.deepEqual(chain.pages.map((p) => p.id), ["att-1", "att-2"]);
  assert.deepEqual(chain.orphans, []);
  assert.deepEqual(probes.slice(0, 4), [canonical, page(1), page(2), page(3)], "sequential URL probes, stopping at the first absent index");
  assert.equal(probes.length, 4 + 8, "then only the bounded orphan window (pages 4..11)");
});

test("chain: canonical absent ⇒ NO continuation probes at all (validation rule §6)", async () => {
  const { port, probes } = chainPort({ [page(1)]: att(1, page(1)) });
  const chain = await enumerateAttachmentChain(port, cfg, TASK);
  assert.equal(chain.canonical, null);
  assert.deepEqual(chain.pages, []);
  assert.deepEqual(chain.orphans, []);
  assert.deepEqual(probes, [canonical], "without the page-0 anchor nothing is walked");
});

test("chain GAP case (R8): pages 1..2 present, 3 absent, 4 present ⇒ pages stop at 2, orphan 4 REPORTED", async () => {
  const { port, probes } = chainPort({
    [canonical]: att(0, canonical),
    [page(1)]: att(1, page(1)),
    [page(2)]: att(2, page(2)),
    // page 3 deliberately absent — the gap
    [page(4)]: att(4, page(4)),
  });
  const chain = await enumerateAttachmentChain(port, cfg, TASK);
  assert.deepEqual(chain.pages.map((p) => p.id), ["att-1", "att-2"], "walk STOPS at the first absent index");
  assert.deepEqual(chain.orphans, [4], "the page-4 row is reported, never silently skipped");
  assert.equal(probes.filter((p) => p === page(4)).length, 1, "page 4 probed exactly once (stop + orphan window)");
});

test("chain: the orphan probe window is BOUNDED — a far page is never probed", async () => {
  const far = continuationAttachmentUrl(cfg, TASK, 30);
  const { port, probes } = chainPort({ [canonical]: att(0, canonical), [far]: att(30, far) });
  const chain = await enumerateAttachmentChain(port, cfg, TASK, { orphanProbeLimit: 8 });
  assert.deepEqual(chain.pages, []);
  assert.deepEqual(chain.orphans, [], "page 30 is outside the 2..9 window — unprobed, unreported");
  assert.ok(!probes.includes(far));
  assert.equal(probes.length, 1 + 1 + 8, "canonical + first absent + bounded window");
});

test("chain: orphanProbeLimit 0 disables lookahead; the walk is deterministic across repeats", async () => {
  const rows = { [canonical]: att(0, canonical), [page(2)]: att(2, page(2)) };
  const { port } = chainPort(rows);
  const first = await enumerateAttachmentChain(port, cfg, TASK, { orphanProbeLimit: 0 });
  const second = await enumerateAttachmentChain(port, cfg, TASK, { orphanProbeLimit: 0 });
  assert.deepEqual(first.orphans, []);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), JSON.parse(JSON.stringify(second)), "repeat walk identical (Principle IV)");
});

test("chain: forgery resistance — only scheme-derived URLs are ever visited", async () => {
  // A row living at a LOOKALIKE url (what forged description text might point at) is
  // never probed and never joins the chain: the walker visits only ITS OWN derived URLs.
  const lookalike = "https://sync.example.invalid/task-linear-sync/00000000-0000-4000-8000-000000000006";
  const { port, probes } = chainPort({ [lookalike]: att(99, lookalike, "planted via description text") });
  const chain = await enumerateAttachmentChain(port, cfg, TASK);
  assert.equal(chain.canonical, null);
  assert.deepEqual(probes, [canonical]);
});

test("chain: only getAttachmentByUrl is reachable on the port", async () => {
  const traps: string[] = [];
  const guard = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "getAttachmentByUrl") return async (): Promise<AttachmentView | null> => null;
        traps.push(prop);
        throw new Error(`chain walker must never call ${prop}`);
      },
    },
  ) as unknown as LinearPort;
  const chain = await enumerateAttachmentChain(guard, cfg, TASK);
  assert.equal(chain.canonical, null);
  assert.deepEqual(traps, []);
});

test("chain: a lookup TrackerError (e.g. exhausted rate limit) propagates unchanged", async () => {
  const failing = {
    async getAttachmentByUrl(): Promise<AttachmentView | null> {
      throw new TrackerError({ category: "rate-limit", retryable: true, attempts: 6, detail: "exhausted" });
    },
  } as unknown as LinearPort;
  await assert.rejects(
    () => enumerateAttachmentChain(failing, cfg, TASK),
    (e: unknown) => e instanceof TrackerError && e.category === "rate-limit" && e.attempts === 6,
  );
});
