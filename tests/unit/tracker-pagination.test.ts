/**
 * T026 [US1] — pagination unit tests per R6 against the frozen wording: "Pagination until
 * exhausted … Yields complete pages; failure after retries surfaces with no partial-inventory
 * consumption". The real adapter runs over a SCRIPTED in-memory transport (hermetic — the
 * transport seam, zero network): per-team sequential `after = endCursor` until
 * `hasNextPage: false`; teams proceed in configured `teamKeys` order, parallelism bounded by
 * the `concurrency` semaphore; a page's views are yielded ONLY after the whole page arrives;
 * a scripted page-k failure after the retry budget throws from the iterator with ZERO rows of
 * page k emitted (spec edge case "Mid-pagination failure"); the client-side guard ABORTS on a
 * cross-team leak (never yielded, never silent).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { builtInDefaults } from "task-linear-sync/config";
import {
  createLinearPort,
  TrackerConfigError,
  TrackerError,
  type HttpTransport,
  type HttpRequest,
  type HttpResponse,
  type IssueScope,
  type TrackerDiagnostic,
} from "task-linear-sync/tracker";
import { FakeClock, FakeSleeper, fixtureEnv, splitmixRng } from "../helpers/tracker-harness.js";

// ── Scripted tracker-over-HTTP (GraphQL envelope responses, platform node shapes) ──

interface PlatformNode {
  readonly id: string;
  readonly identifier: string;
  readonly title: string;
  readonly description: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
  readonly team: { key: string };
  readonly project: { id: string } | null;
  readonly state: { type: string } | null;
}

interface PageSpec {
  readonly after: string | null;
  readonly rows?: readonly PlatformNode[];
  readonly hasNextPage?: boolean;
  readonly endCursor?: string | null;
  /** Replay this status for EVERY request to this page (terminal failure fixtures). */
  readonly failStatus?: number;
}

interface TeamSpec {
  readonly key: string;
  readonly id: string;
  readonly projects: ReadonlyArray<{ id: string; name: string }>;
  readonly workflowStates: ReadonlyArray<{ id: string; name: string; type: string }>;
  readonly pages: readonly PageSpec[];
}

class ScriptedTransport implements HttpTransport {
  readonly events: string[] = [];
  readonly requests: Array<{ operationName: string; variables: Record<string, unknown> }> = [];
  private inFlight = 0;
  maxInFlight = 0;

  constructor(
    private readonly teams: readonly TeamSpec[],
    private readonly log?: (event: string) => void,
  ) {}

  emit(event: string): void {
    this.events.push(event);
    this.log?.(event);
  }

  async postJson(req: HttpRequest): Promise<HttpResponse> {
    this.inFlight += 1;
    this.maxInFlight = Math.max(this.maxInFlight, this.inFlight);
    try {
      const doc = req.json as { operationName: string; variables: Record<string, unknown> };
      const { operationName, variables } = doc;
      this.requests.push({ operationName, variables });
      if (operationName === "teamMetadata") {
        this.emit("req:teamMetadata");
        const wanted = (variables["teamKeys"] as string[]) ?? [];
        return this.json({
          data: {
            teams: {
              nodes: this.teams
                .filter((t) => wanted.includes(t.key))
                .map((t) => ({
                  id: t.id,
                  key: t.key,
                  projects: { nodes: t.projects },
                  states: { nodes: t.workflowStates },
                })),
            },
          },
        });
      }
      if (operationName === "issues") {
        const teamKey = String(variables["teamKey"]);
        const after = (variables["after"] as string | null) ?? null;
        this.emit(`req:issues:${teamKey}:${after ?? "null"}`);
        const team = this.teams.find((t) => t.key === teamKey);
        const index = team?.pages.findIndex((p) => p.after === after) ?? -1;
        if (team === undefined || index === -1) {
          throw new Error(`scripted tracker: unexpected issues request ${teamKey} after=${after}`);
        }
        const page = team.pages[index];
        if (page.failStatus !== undefined) {
          return { status: page.failStatus, headers: {}, body: { __rawText: `scripted HTTP ${page.failStatus}` } };
        }
        const hasNext = page.hasNextPage ?? index + 1 < team.pages.length;
        const endCursor = page.endCursor !== undefined ? page.endCursor : `end-${teamKey}-${index}`;
        return this.json({
          data: { issues: { nodes: page.rows ?? [], pageInfo: { hasNextPage: hasNext, endCursor } } },
        });
      }
      throw new Error(`scripted tracker: unsupported operation ${operationName}`);
    } finally {
      this.inFlight -= 1;
    }
  }

  private json(body: unknown): HttpResponse {
    return { status: 200, headers: {}, body };
  }
}

function node(identifier: string, over: Partial<PlatformNode> & { teamKey?: string } = {}): PlatformNode {
  return {
    id: `iss-${identifier}`,
    identifier,
    title: `title ${identifier}`,
    description: "d",
    updatedAt: "2026-10-01T00:00:00.000Z",
    archivedAt: null,
    team: { key: over.team?.key ?? "acme-team" },
    project: over.project === null ? null : (over.project ?? { id: "prj-alpha" }),
    state: over.state === null ? null : (over.state ?? { type: "unstarted" }),
    ...(over.archivedAt !== undefined ? { archivedAt: over.archivedAt } : {}),
  };
}

const ACME: Omit<TeamSpec, "pages"> = {
  key: "acme-team",
  id: "team-acme",
  projects: [{ id: "prj-alpha", name: "proj-alpha" }],
  workflowStates: [{ id: "st-todo", name: "Todo", type: "unstarted" }],
};
const GLOBEX: Omit<TeamSpec, "pages"> = {
  key: "globex-team",
  id: "team-globex",
  projects: [{ id: "prj-main", name: "proj-main" }],
  workflowStates: [{ id: "st-glx", name: "Todo", type: "unstarted" }],
};

function makePort(teams: readonly TeamSpec[], log?: (event: string) => void, diagnostics?: (d: TrackerDiagnostic) => void) {
  const transport = new ScriptedTransport(teams, log);
  const sleeper = new FakeSleeper();
  const port = createLinearPort({
    config: builtInDefaults,
    options: {
      transport,
      env: fixtureEnv(),
      clock: new FakeClock("2026-10-23T12:00:00.000Z"),
      rng: splitmixRng(11),
      sleep: sleeper.sleep,
      ...(diagnostics ? { diagnostics } : {}),
    },
  });
  return { port, transport, sleeper };
}

const scope = (over: Partial<IssueScope> = {}): IssueScope => ({
  teamKeys: ["acme-team"],
  perTeam: { "acme-team": { projects: ["proj-alpha"], ignoredStateTypes: ["canceled", "duplicate"] } },
  pageSize: 10,
  ...over,
});

async function collect(it: AsyncIterableIterator<{ key: string }>, events?: string[]): Promise<string[]> {
  const out: string[] = [];
  for await (const row of it) {
    out.push(row.key);
    events?.push(`yield:${row.key}`);
  }
  return out;
}

test("pagination: complete pages, sequential endCursor chaining, teams in teamKeys order", async () => {
  const seen: string[] = [];
  const { port, transport } = makePort(
    [
      {
        ...ACME,
        pages: [
          { after: null, rows: [node("ACM-1"), node("ACM-2")] },
          { after: "end-acme-team-0", rows: [node("ACM-3")] },
        ],
      },
      { ...GLOBEX, pages: [{ after: null, rows: [node("GLX-1", { team: { key: "globex-team" }, project: { id: "prj-main" } })] }] },
    ],
    (e) => seen.push(e),
  );
  const keys = await collect(
    port.listIssues(
      scope({
        teamKeys: ["acme-team", "globex-team"],
        perTeam: {
          "acme-team": { projects: ["proj-alpha"], ignoredStateTypes: ["canceled", "duplicate"] },
          "globex-team": { projects: ["proj-main"], ignoredStateTypes: ["canceled", "duplicate"] },
        },
        pageSize: 2,
      }),
    ),
    seen,
  );
  assert.deepEqual(keys, ["ACM-1", "ACM-2", "ACM-3", "GLX-1"]);
  // Yield ordering proves "a page's views are yielded ONLY after the whole page arrives"
  // and "teams proceed in configured teamKeys order" (discovery warm happens once, first):
  assert.deepEqual(seen, [
    "req:teamMetadata",
    "req:issues:acme-team:null",
    "yield:ACM-1",
    "yield:ACM-2",
    "req:issues:acme-team:end-acme-team-0",
    "yield:ACM-3",
    "req:issues:globex-team:null",
    "yield:GLX-1",
  ]);
  // The per-team filter carries THIS team's resolved project ids only — never a union:
  const acmeCall = transport.requests.find((r) => r.operationName === "issues" && r.variables["teamKey"] === "acme-team");
  assert.deepEqual(acmeCall?.variables["projectIds"], ["prj-alpha"]);
  assert.deepEqual(acmeCall?.variables["ignoredStateTypes"], ["canceled", "duplicate"]);
  assert.equal(transport.maxInFlight, 1, "sequential per-team fetching");
  assert.ok(transport.maxInFlight <= builtInDefaults.concurrency, "bounded by the concurrency semaphore");
});

test("pagination: mid-page failure — page-1 rows stay, terminal throw, ZERO page-2 rows, full retry budget", async () => {
  const { port, transport, sleeper } = makePort([
    {
      ...ACME,
      pages: [
        { after: null, rows: [node("ACM-1"), node("ACM-2")] },
        { after: "end-acme-team-0", rows: [node("ACM-3"), node("ACM-4")], failStatus: 503 },
        { after: "end-acme-team-1", rows: [node("ACM-5")] },
      ],
    },
  ]);
  const yielded: string[] = [];
  await assert.rejects(
    (async () => {
      for await (const row of port.listIssues(scope({ pageSize: 2 }))) yielded.push(row.key);
    })(),
    (e: unknown) => {
      assert.ok(e instanceof TrackerError);
      assert.equal(e.category, "server");
      assert.equal(e.attempts, 6, "maxRetries 5 + 1");
      return true;
    },
  );
  assert.deepEqual(yielded, ["ACM-1", "ACM-2"], "no partial-inventory consumption — page 2 contributes nothing");
  const issuesRequests = transport.requests.filter((r) => r.operationName === "issues");
  assert.equal(issuesRequests.length, 7, "1 page-1 success + 6 exhausted page-2 attempts");
  assert.equal(sleeper.waits.length, 5, "5 backoff waits between 6 attempts");
});

test("pagination: hasNextPage without endCursor is a loud config error, not a silent stop", async () => {
  const { port } = makePort([{ ...ACME, pages: [{ after: null, rows: [node("ACM-1")], hasNextPage: true, endCursor: null }] }]);
  await assert.rejects(collect(port.listIssues(scope({ pageSize: 2 }))), (e: unknown) => e instanceof TrackerConfigError);
});

test("pagination: client guard ABORTS on a cross-team leak — the row is never yielded", async () => {
  const seen: string[] = [];
  const { port } = makePort(
    [
      {
        ...ACME,
        pages: [
          {
            after: null,
            rows: [node("ACM-1"), node("GLX-9", { team: { key: "globex-team" }, project: { id: "prj-main" } }), node("ACM-2")],
          },
        ],
      },
    ],
    (e) => seen.push(e),
  );
  const yielded: string[] = [];
  await assert.rejects(
    (async () => {
      for await (const row of port.listIssues(scope())) yielded.push(row.key);
    })(),
    (e: unknown) => {
      assert.ok(e instanceof TrackerError);
      assert.equal(e.category, "client");
      assert.match(e.detail, /never leak/i);
      assert.match(e.detail, /GLX-9/);
      return true;
    },
  );
  assert.deepEqual(yielded, ["ACM-1"], "violating row never leaks downstream");
  assert.equal(seen.includes("yield:GLX-9"), false);
});

test("pagination: ignored-state rows on the payload are EXCLUDED (data-level filter), listing continues", async () => {
  const { port } = makePort([
    { ...ACME, pages: [{ after: null, rows: [node("ACM-1"), node("ACM-2", { state: { type: "canceled" } })] }] },
  ]);
  assert.deepEqual(await collect(port.listIssues(scope())), ["ACM-1"]);
});

test("pagination: foreign-project rows abort too (per-team filter is integrity, not a hint)", async () => {
  const { port } = makePort([
    { ...ACME, pages: [{ after: null, rows: [node("ACM-9", { project: { id: "prj-foreign" } })] }] },
  ]);
  await assert.rejects(
    collect(port.listIssues(scope())),
    (e: unknown) => e instanceof TrackerError && e.category === "client" && /never leak/.test(e.detail),
  );
});

test("pagination: scope.pageSize clamps to the platform max with the diagnostic; warm happens once", async () => {
  const notes: TrackerDiagnostic[] = [];
  const { port, transport } = makePort(
    [{ ...ACME, pages: [{ after: null, rows: [node("ACM-1")] }] }],
    undefined,
    (d) => void notes.push(d),
  );
  const big = scope({ pageSize: 500 });
  await collect(port.listIssues(big));
  await collect(port.listIssues(big));
  const issueCall = transport.requests.find((r) => r.operationName === "issues");
  assert.equal(issueCall?.variables["first"], 250);
  assert.equal(notes.filter((n) => n.code === "page-size-clamped").length, 2, "one diagnostic per clamped call");
  assert.equal(transport.requests.filter((r) => r.operationName === "teamMetadata").length, 1, "discovery cache warm across calls (R10)");
});

test("pagination: scope validation — unknown team named, missing perTeam entry a config error", async () => {
  const { port, transport } = makePort([{ ...ACME, pages: [{ after: null, rows: [] }] }]);
  await assert.rejects(
    collect(port.listIssues(scope({ teamKeys: ["ghost-team"], perTeam: { "ghost-team": { projects: ["p"], ignoredStateTypes: [] } } }))),
    (e: unknown) => e instanceof TrackerConfigError && /ghost-team/.test(e.detail),
  );
  await assert.rejects(
    collect(port.listIssues(scope({ perTeam: {} }))),
    (e: unknown) => e instanceof TrackerConfigError && /acme-team/.test(e.detail),
  );
  assert.equal(transport.requests.filter((r) => r.operationName === "issues").length, 0, "validation is pre-dispatch");
});
