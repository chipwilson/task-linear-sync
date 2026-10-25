/**
 * T027 [US1] — inventory integration tests on BOTH bindings (fake worlds AND recorded
 * scenarios `multi-team-inventory/` + `metadata-discovery/` + `mid-pagination-failure/`):
 * SC-001 — "listing retrieves 100% of in-scope issues and 0 out-of-scope issues over the
 * multi-team, multi-page fixture corpus"; request counts prove `ceil(count / pageSize)` page
 * requests per team (no extra fan-out); per-team result isolation partitions; the mid-
 * pagination scenario end-to-end (page 1 valid, terminal throw); metadata discovery returns
 * "the team key, its projects, and its workflow states as three collections per team" in
 * requested order (FR-002, spec AC US1.3).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { builtInDefaults } from "task-linear-sync/config";
import { createLinearPort, TrackerError, type IssueScope, type LinearPort } from "task-linear-sync/tracker";
import { createFakeLinearPort, createRecordedTransport } from "task-linear-sync/tracker/testing";
import { FakeClock, FakeSleeper, fixtureEnv, loadWorld, scenarioDir, splitmixRng } from "../helpers/tracker-harness.js";

interface Binding {
  readonly name: string;
  make(dir: string): {
    port: LinearPort;
    /** Per-team page request counts (attempt-level, both bindings' native request logs). */
    issuesByTeam(): Record<string, number>;
    metadataCalls(): number;
  };
}

const bindings: Binding[] = [
  {
    name: "fake",
    make(dir) {
      const port = createFakeLinearPort(loadWorld(dir));
      return {
        port,
        issuesByTeam() {
          const out: Record<string, number> = {};
          for (const r of port.requests()) {
            if (r.op === "issues") out[String(r.vars["teamKey"])] = (out[String(r.vars["teamKey"])] ?? 0) + 1;
          }
          return out;
        },
        metadataCalls: () => port.requests().filter((r) => r.op === "teamMetadata").length,
      };
    },
  },
  {
    name: "real-over-recorded",
    make(dir) {
      const transport = createRecordedTransport(scenarioDir(dir));
      const sleeper = new FakeSleeper();
      const port = createLinearPort({
        config: builtInDefaults,
        options: {
          transport,
          env: fixtureEnv(),
          clock: new FakeClock("2026-10-23T12:00:00.000Z"),
          rng: splitmixRng(9),
          sleep: sleeper.sleep,
        },
      });
      return {
        port,
        issuesByTeam() {
          const out: Record<string, number> = {};
          for (const r of transport.requests()) {
            if (r.operationName === "issues") out[String(r.variables["teamKey"])] = (out[r.variables["teamKey"] as string] ?? 0) + 1;
          }
          return out;
        },
        metadataCalls: () => transport.requests().filter((r) => r.operationName === "teamMetadata").length,
      };
    },
  },
];

const MULTI_TEAM_SCOPE: IssueScope = {
  teamKeys: ["acme-team", "globex-team", "initech-team"],
  perTeam: {
    "acme-team": { projects: ["proj-alpha"], ignoredStateTypes: ["canceled", "duplicate"] },
    "globex-team": { projects: ["proj-main"], ignoredStateTypes: ["canceled", "duplicate"] },
    "initech-team": { projects: ["proj-core"], ignoredStateTypes: ["canceled", "duplicate"] },
  },
  pageSize: 3,
};

async function keysByTeam(port: LinearPort, scope: IssueScope): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  for await (const row of port.listIssues(scope)) (out[row.teamKey] ??= []).push(row.key);
  return out;
}

for (const binding of bindings) {
  test(`inventory [${binding.name}]: SC-001 — 100% in-scope, 0 out-of-scope, per-team isolation, ceil page counts`, async () => {
    const h = binding.make("multi-team-inventory");
    const byTeam = await keysByTeam(h.port, MULTI_TEAM_SCOPE);
    assert.deepEqual(byTeam, {
      "acme-team": ["ACM-101", "ACM-102", "ACM-103", "ACM-104"],
      "globex-team": ["GLX-201", "GLX-202", "GLX-203", "GLX-204", "GLX-205"],
      "initech-team": ["INI-301"],
    }, "exactly the in-scope corpus: foreign-project, canceled, duplicate, and cross-team trap rows excluded");
    // Isolation partitions: every yielded row carries its team, no row appears twice.
    const all = Object.values(byTeam).flat();
    assert.equal(new Set(all).size, all.length, "no duplicates across teams");
    // ceil(count / pageSize) page requests per team — no extra fan-out:
    assert.deepEqual(h.issuesByTeam(), { "acme-team": 2, "globex-team": 2, "initech-team": 1 });
    assert.equal(h.metadataCalls(), 1, "one discovery warm for the whole scope");
  });

  test(`inventory [${binding.name}]: metadata discovery — three collections per team, requested order`, async () => {
    const h = binding.make("metadata-discovery");
    const meta = await h.port.discoverMetadata(["globex-team", "acme-team"]);
    assert.deepEqual(meta.map((m) => m.teamKey), ["globex-team", "acme-team"]);
    for (const team of meta) {
      assert.ok(team.projects.length > 0 && team.projects.every((p) => p.id !== "" && p.name !== ""), "projects: {id,name}");
      assert.ok(
        team.workflowStates.length > 0 && team.workflowStates.every((s) => s.id !== "" && s.name !== "" && s.type !== ""),
        "workflowStates: {id,name,type}",
      );
      assert.ok(Object.keys(team).sort().join(",") === "projects,teamKey,workflowStates", "exactly the three collections");
    }
    assert.equal(h.metadataCalls(), 1, "one query for all teams (007 FR-002)");
  });

  test(`inventory [${binding.name}]: mid-pagination failure end-to-end — page 1 stays, terminal throw`, async () => {
    const h = binding.make("mid-pagination-failure");
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
      if (e instanceof TrackerError) error = { category: e.category, attempts: e.attempts };
      else throw e;
    }
    assert.deepEqual(yielded, ["ACM-801", "ACM-802", "ACM-803"]);
    assert.deepEqual(error, { category: "server", attempts: 6 });
  });
}
