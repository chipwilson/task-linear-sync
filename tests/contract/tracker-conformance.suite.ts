/**
 * T010 [P] — the fake-versus-real conformance suite (contracts/tracker-testing.md §3 — the
 * constitution-mandated cross-cutting "contract (fake-versus-real `Linear_Port`)" test).
 *
 * `linearPortConformance(name, binding)` registers one node:test per scenario for a BINDING.
 * The binding runner (tracker-conformance.test.ts, T011) registers the suite TWICE — the fake
 * and the real adapter over `createRecordedTransport` — and the parity assertion compares
 * per-scenario results: both bindings must produce identical summaries; scenarios whose
 * real-side members are still T023 placeholders report skip (placeholder error detail.code
 * "not-implemented"), while the fake binding always runs everything. Scenario summaries carry
 * only binding-agnostic observables (keys/urls/categories/counts) so deep-equality is
 * meaningful across bindings.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isNotImplemented,
  TrackerError,
  enumerateAttachmentChain,
  attachmentUrlConfigFrom,
  type LinearPort,
  type IssueScope,
} from "task-linear-sync/tracker";
import { canonicalAttachmentUrl } from "task-linear-sync/urls";
import { builtInDefaults } from "task-linear-sync/config";

import { syntheticUuid } from "task-linear-sync/tracker/testing";

/** Binding-observable request log entry. */
export interface ConformanceHandle {
  readonly port: LinearPort;
  /** Successful underlying request-equivalents for `op`, filtered by pinned variable keys. */
  successful(op: string, pin?: Record<string, unknown>): number;
  /** All issued request-equivalents for `op` (successes AND failures/retries). */
  total(op: string, pin?: Record<string, unknown>): number;
}

export interface ConformanceBinding {
  readonly name: string;
  makePort(scenarioDir: string): ConformanceHandle | Promise<ConformanceHandle>;
}

export type ConformanceSummary = Record<string, unknown>;

export interface ScenarioDef {
  readonly dir: string;
  readonly members: readonly (keyof LinearPort)[];
  run(h: ConformanceHandle): Promise<ConformanceSummary>;
}

export interface ScenarioResult {
  readonly status: "pass" | "skip" | "fail";
  readonly summary?: ConformanceSummary;
  readonly note?: string;
}

const registry = new Map<string, Map<string, ScenarioResult>>();
const bindingOrder: string[] = [];

function record(binding: string, dir: string, result: ScenarioResult): void {
  let per = registry.get(binding);
  if (!per) {
    per = new Map();
    registry.set(binding, per);
  }
  per.set(dir, result);
}

export function scenarioResults(binding: string, dir: string): ScenarioResult | undefined {
  return registry.get(binding)?.get(dir);
}

export function registeredBindings(): readonly string[] {
  return bindingOrder;
}

// ── Shared fixtures constants (mirror tests/fixtures/tracker/scenarios worlds) ──

const URL_CFG = attachmentUrlConfigFrom(builtInDefaults);
const uuid = syntheticUuid;
const canon = (n: number): string => canonicalAttachmentUrl(URL_CFG, uuid(n));

async function collectKeys(it: AsyncIterableIterator<{ id: string; key: string; teamKey: string }>): Promise<Record<string, string[]>> {
  const byTeam: Record<string, string[]> = {};
  for await (const row of it) (byTeam[row.teamKey] ??= []).push(row.key);
  return byTeam;
}

async function errorOf(fn: () => Promise<unknown>): Promise<{ category: string; attempts: number; indeterminate: boolean } | "no-error"> {
  try {
    await fn();
    return "no-error";
  } catch (e) {
    if (e instanceof TrackerError) {
      return { category: e.category, attempts: e.attempts, indeterminate: e.category === "create-indeterminate" };
    }
    return { category: `non-tracker:${String(e)}`, attempts: -1, indeterminate: false };
  }
}

const CREATE_INPUT = { teamKey: "acme-team", projectId: "proj-alpha", title: "Created by conformance", description: "created body" } as const;

// ── Scenario definitions ────────────────────────────────────────────────────────

export const SCENARIOS: readonly ScenarioDef[] = [
  {
    dir: "multi-team-inventory",
    members: ["listIssues", "discoverMetadata"],
    async run(h) {
      const scope: IssueScope = {
        teamKeys: ["acme-team", "globex-team", "initech-team"],
        perTeam: {
          "acme-team": { projects: ["proj-alpha"], ignoredStateTypes: ["canceled", "duplicate"] },
          "globex-team": { projects: ["proj-main"], ignoredStateTypes: ["canceled", "duplicate"] },
          "initech-team": { projects: ["proj-core"], ignoredStateTypes: ["canceled", "duplicate"] },
        },
        pageSize: 3,
      };
      const byTeam = await collectKeys(h.port.listIssues(scope));
      // SC-001: 100% of in-scope, 0 out-of-scope — exact expectation (both bindings):
      assert.deepEqual(byTeam, {
        "acme-team": ["ACM-101", "ACM-102", "ACM-103", "ACM-104"],
        "globex-team": ["GLX-201", "GLX-202", "GLX-203", "GLX-204", "GLX-205"],
        "initech-team": ["INI-301"],
      });
      return {
        byTeam,
        successfulPages: h.successful("issues"),
        totalIssuesRequests: h.total("issues"),
        metadataRequests: h.successful("teamMetadata"),
      };
    },
  },
  {
    dir: "metadata-discovery",
    members: ["discoverMetadata"],
    async run(h) {
      const meta = await h.port.discoverMetadata(["globex-team", "acme-team"]);
      const summary = {
        order: meta.map((m) => m.teamKey),
        collections: meta.map((m) => ({
          teamKey: m.teamKey,
          projects: m.projects.map((p) => `${p.id}:${p.name}`).sort(),
          workflowStates: m.workflowStates.map((s) => `${s.id}:${s.name}:${s.type}`).sort(),
        })),
        metadataRequests: h.successful("teamMetadata"),
      };
      assert.deepEqual(summary.order, ["globex-team", "acme-team"], "requested order preserved");
      assert.equal(summary.metadataRequests, 1, "one discovery query");
      return summary;
    },
  },
  {
    dir: "crud-roundtrip",
    members: ["getIssue", "createIssue", "updateIssue", "archiveIssue"],
    async run(h) {
      const known = await h.port.getIssue(uuid(401));
      const unknownIsNull = (await h.port.getIssue(uuid(4010))) === null;
      const created = await h.port.createIssue({ ...CREATE_INPUT });
      const reread = await h.port.getIssue(created.id);
      const updated = await h.port.updateIssue(created.id, { title: "Updated title", stateTypeId: "started" });
      await h.port.archiveIssue(created.id);
      const archived = await h.port.getIssue(created.id);
      const updateMissing = await errorOf(() => h.port.updateIssue(uuid(4099), { title: "x" }));
      return {
        knownMatches: known !== null && known.key === "ACM-401" && known.archived === false && known.stateType === "unstarted",
        unknownIsNull,
        createRoundTrip:
          reread !== null && reread.title === created.title && reread.teamKey === "acme-team" && reread.stateType === "unstarted",
        updateApplied:
          updated.title === "Updated title" && updated.stateType === "started" && updated.description === created.description,
        archiveApplied: archived !== null && archived.archived === true,
        updateMissing,
      };
    },
  },
  {
    dir: "adversarial-descriptions",
    members: ["findIssuesByAttachmentUrl", "getIssue"],
    async run(h) {
      const canonical = canon(1);
      const matches = await h.port.findIssuesByAttachmentUrl(canonical);
      const adversarial = await h.port.getIssue(uuid(502));
      const noneForOther = await h.port.findIssuesByAttachmentUrl(canon(2));
      const summary = {
        onlyCarrier: matches.length === 1 && matches[0].key === "ACM-501",
        adversarialCarriesUuidText: adversarial !== null && adversarial.description.includes(canonical),
        descriptionSearchMatches: noneForOther.length,
      };
      // SC-003: 100% via attachment metadata, 0 via description content:
      assert.equal(summary.onlyCarrier, true, "only the attachment carrier matches");
      assert.equal(summary.adversarialCarriesUuidText, true, "adversarial fixture really carries UUID-shaped text");
      assert.equal(summary.descriptionSearchMatches, 0, "UUID-shaped descriptions never match");
      return summary;
    },
  },
  {
    dir: "upsert-idempotency",
    members: ["upsertAttachmentByUrl", "getAttachmentByUrl"],
    async run(h) {
      const url = canon(9);
      const first = await h.port.upsertAttachmentByUrl({ issueId: uuid(701), url, title: "sync state", subtitle: "canonical", metadata: { v: 1, tag: "first" } });
      const second = await h.port.upsertAttachmentByUrl({ issueId: uuid(701), url, title: "sync state", subtitle: "canonical updated", metadata: { v: 2, tag: "second" } });
      const fetched = await h.port.getAttachmentByUrl(url);
      const summary = {
        stableIdAcrossUpserts: first.id === second.id,
        updatedMetadata: second.metadata.v === 2 && second.metadata.tag === "second",
        updatedSubtitle: second.subtitle === "canonical updated",
        fetchAgrees: fetched !== null && fetched.id === second.id && fetched.metadata.v === 2,
        createCalls: h.total("attachmentCreate"),
      };
      assert.equal(summary.stableIdAcrossUpserts, true, "SC-002: one attachment per URL, updated in place");
      assert.equal(summary.createCalls, 2);
      return summary;
    },
  },
  {
    dir: "upsert-idempotency",
    members: ["upsertAttachmentByUrl", "listAttachments"],
    async run(h) {
      const url = canon(9);
      await h.port.upsertAttachmentByUrl({ issueId: uuid(701), url, title: "sync state", metadata: { v: 1 } });
      const urls: string[] = [];
      let pageCount = 0;
      let cursor: string | null = null;
      let sawNull = false;
      for (;;) {
        const page = await h.port.listAttachments(uuid(701), cursor);
        pageCount++;
        urls.push(...page.items.map((a) => a.url));
        if (page.nextCursor === null) {
          sawNull = true;
          break;
        }
        cursor = page.nextCursor;
        assert.ok(pageCount < 10, "cursor walk terminates");
      }
      const summary = { urls, pageCount, sawNullEnd: sawNull, scanFound: urls.includes(url) };
      assert.equal(pageCount, 2, "two cursor pages at page size 2");
      assert.equal(summary.scanFound, true, "FR-004 scan route finds the identity-bearing attachment");
      return summary;
    },
  },
  {
    dir: "attachment-chain",
    members: ["getAttachmentByUrl"],
    async run(h) {
      const taskUuid = uuid(7);
      const chain = await enumerateAttachmentChain(h.port, URL_CFG, taskUuid);
      const again = await enumerateAttachmentChain(h.port, URL_CFG, taskUuid);
      const summary = {
        canonicalUrl: chain.canonical?.url ?? null,
        pageCount: chain.pages.length,
        pageTitles: chain.pages.map((p) => p.title),
        orphans: [...chain.orphans],
        deterministicRepeat: JSON.stringify(chain) === JSON.stringify(again),
      };
      assert.equal(summary.pageCount, 2, "walk stops at first absent index");
      assert.deepEqual(summary.orphans, [4], "page-4 orphan reported, not skipped");
      assert.equal(summary.canonicalUrl, canon(7));
      assert.equal(summary.deterministicRepeat, true);
      return summary;
    },
  },
  {
    dir: "mid-pagination-failure",
    members: ["listIssues", "discoverMetadata"],
    async run(h) {
      const scope: IssueScope = {
        teamKeys: ["acme-team"],
        perTeam: { "acme-team": { projects: ["proj-alpha"], ignoredStateTypes: ["canceled", "duplicate"] } },
        pageSize: 3,
      };
      const yielded: string[] = [];
      let error: { category: string; attempts: number } | null = null;
      try {
        for await (const row of h.port.listIssues(scope)) yielded.push(row.key);
      } catch (e) {
        if (isNotImplemented(e)) throw e; // placeholder skip signal must surface, not become the "terminal error"
        if (e instanceof TrackerError) error = { category: e.category, attempts: e.attempts };
        else throw e;
      }
      const summary = { yielded, error };
      assert.deepEqual(yielded, ["ACM-801", "ACM-802", "ACM-803"], "page 1 valid; page 2 contributes nothing");
      assert.deepEqual(error, { category: "server", attempts: 6 }, "terminal after full retry budget");
      return summary;
    },
  },
  {
    dir: "error-taxonomy",
    members: ["getIssue", "updateIssue", "listAttachments", "archiveIssue", "createIssue", "updateAttachment"],
    async run(h) {
      const id = uuid(901);
      const steps = {
        getRateLimited: await errorOf(() => h.port.getIssue(id)),
        updateServer: await errorOf(() => h.port.updateIssue(id, { title: "x" })),
        listNetwork: await errorOf(() => h.port.listAttachments(id)),
        archiveGraphql: await errorOf(() => h.port.archiveIssue(id)),
        create5xx: await errorOf(() => h.port.createIssue({ ...CREATE_INPUT })),
        create429: await errorOf(() => h.port.createIssue({ ...CREATE_INPUT })),
        attachmentMissing: await errorOf(() => h.port.updateAttachment("att-missing", { a: 1 })),
        unknownGetIsNull: (await h.port.getIssue(uuid(4098))) === null,
      };
      const six = { category: "server", attempts: 6, indeterminate: false };
      assert.deepEqual(steps.getRateLimited, { category: "rate-limit", attempts: 6, indeterminate: false });
      assert.deepEqual(steps.updateServer, six);
      assert.deepEqual(steps.listNetwork, { category: "network", attempts: 6, indeterminate: false });
      assert.deepEqual(steps.archiveGraphql, { category: "graphql", attempts: 1, indeterminate: false });
      assert.deepEqual(steps.create5xx, { category: "create-indeterminate", attempts: 1, indeterminate: true });
      assert.deepEqual(steps.create429, { category: "create-indeterminate", attempts: 1, indeterminate: true });
      assert.deepEqual(steps.attachmentMissing, { category: "not-found", attempts: 1, indeterminate: false });
      assert.equal(steps.unknownGetIsNull, true);
      return steps;
    },
  },
];

// ── Skip-legitimacy probe ───────────────────────────────────────────────────────

async function memberIsPlaceholder(port: LinearPort, member: keyof LinearPort): Promise<boolean> {
  try {
    switch (member) {
      case "listIssues": {
        const it = port.listIssues({ teamKeys: [], perTeam: {}, pageSize: 1 });
        await it.next();
        return false;
      }
      case "discoverMetadata":
        await port.discoverMetadata([]);
        return false;
      case "getIssue":
        await port.getIssue("probe-id");
        return false;
      case "createIssue":
        await port.createIssue({ teamKey: "probe-team", projectId: "probe-project", title: "probe", description: "probe" });
        return false;
      case "updateIssue":
        await port.updateIssue("probe-id", { title: "probe" });
        return false;
      case "archiveIssue":
        await port.archiveIssue("probe-id");
        return false;
      case "findIssuesByAttachmentUrl":
        await port.findIssuesByAttachmentUrl("https://sync.example.invalid/probe");
        return false;
      case "upsertAttachmentByUrl":
        await port.upsertAttachmentByUrl({ issueId: "probe", url: "https://sync.example.invalid/probe-att", title: "probe", metadata: {} });
        return false;
      case "updateAttachment":
        await port.updateAttachment("probe-att", {});
        return false;
      case "getAttachmentByUrl":
        await port.getAttachmentByUrl("https://sync.example.invalid/probe");
        return false;
      case "listAttachments":
        await port.listAttachments("probe-id");
        return false;
    }
    return false;
  } catch (e) {
    return isNotImplemented(e);
  }
}

async function allMembersPlaceholder(h: ConformanceHandle, members: readonly (keyof LinearPort)[]): Promise<boolean> {
  for (const member of members) {
    if (!(await memberIsPlaceholder(h.port, member))) return false;
  }
  return true;
}

// ── Suite registration ──────────────────────────────────────────────────────────

export function linearPortConformance(name: string, binding: ConformanceBinding): void {
  if (!bindingOrder.includes(name)) bindingOrder.push(name);
  SCENARIOS.forEach((scenario, index) => {
    const key = `${index}:${scenario.dir}`;
    test(`conformance ${name}: ${index} ${scenario.dir}`, async (t) => {
      const h = await binding.makePort(scenario.dir);
      try {
        const summary = await scenario.run(h);
        record(name, key, { status: "pass", summary });
      } catch (e) {
        if (isNotImplemented(e)) {
          const legit = await allMembersPlaceholder(h, scenario.members);
          record(name, key, {
            status: "skip",
            note: legit ? "placeholder-backed" : "UNEXPLAINED-SKIP",
          });
          t.skip(legit ? "real-side member not yet implemented (T023 placeholder)" : "unexpected skip");
          return;
        }
        record(name, key, { status: "fail", note: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    });
  });
}

/**
 * Parity assertion — registered ONCE by the binding runner after all bindings. Rules:
 * 1. the fake binding must PASS every scenario (it is complete at T020);
 * 2. a real-binding skip is legal only while placeholder-backed (verified at skip time);
 * 3. scenarios executed by both bindings must return identical summaries.
 */
export function registerParityAssertion(): void {
  test("conformance parity: identical results per scenario across bindings", () => {
    const others = registeredBindings().filter((b) => b !== "fake");
    assert.ok(registeredBindings().includes("fake"), "fake binding registered");
    assert.ok(others.length > 0, "real binding registered");
    SCENARIOS.forEach((scenario, index) => {
      const key = `${index}:${scenario.dir}`;
      const fake = scenarioResults("fake", key);
      assert.ok(fake, `fake result recorded for ${key}`);
      assert.equal(fake.status, "pass", `fake must pass ${key}: ${fake.note ?? ""}`);
      for (const other of others) {
        const result = scenarioResults(other, key);
        assert.ok(result, `${other} result recorded for ${key}`);
        if (result.status === "skip") {
          assert.equal(result.note, "placeholder-backed", `${key} on ${other}: skip must be placeholder-backed`);
          continue;
        }
        assert.equal(result.status, "pass", `${key} on ${other} must pass: ${result.note ?? ""}`);
        assert.deepEqual(result.summary, fake.summary, `${key}: summaries identical across bindings`);
      }
    });
  });
}
