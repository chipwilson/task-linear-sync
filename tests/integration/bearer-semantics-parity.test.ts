/**
 * T029 (feature 014) — cross-surface bearer parity (contracts/bearer-parity.md;
 * FR-008, research R5). Boots the REAL history server (its `node:http` handler
 * over the fake tracker) and the REAL MCP server (`listenHttp()`, port 0) and
 * runs the §2 verdict matrix against BOTH, asserting:
 *  - row-by-row verdict equality (same status on both surfaces);
 *  - `www-authenticate: Bearer` on every scheme rejection from BOTH;
 *  - the zero-dispatch rule: every rejection row leaves both call logs empty;
 *  - the leak rule: no credential sentinel appears in ANY response byte.
 * The parity lives in the TEST — no shared runtime module is added.
 */

import assert from "node:assert/strict";
import test from "node:test";

import { createSyncHistoryServer } from "../../src/history-server/create.js";
import { TOKEN_SENTINEL, withHistoryServer } from "../helpers/history-harness.js";
import type { HistoryServerHandle } from "../helpers/history-harness.js";
import type { CliWorld } from "../helpers/cli-harness.js";
import { MCP_TEST_TOKEN, withHttpServer } from "../helpers/mcp-harness.js";

const WRONG_TOKEN = "wrong-credential-parity-9e2f7b";
const JSON_HEADERS = { accept: "application/json" };

type Verdict = "accept" | "scheme" | "token";

/** contracts/bearer-parity.md §2 — the full matrix, both surfaces. */
const MATRIX: ReadonlyArray<{ readonly header?: string; readonly verdict: Verdict }> = [
  { header: `Bearer ${MCP_TEST_TOKEN}`, verdict: "accept" }, // history side re-keys below
  { header: `bearer ${MCP_TEST_TOKEN}`, verdict: "accept" },
  { header: `BEARER ${MCP_TEST_TOKEN}`, verdict: "accept" },
  { header: `BeArEr ${MCP_TEST_TOKEN}`, verdict: "accept" },
  { header: `Bearer  ${MCP_TEST_TOKEN}`, verdict: "accept" }, // extra space
  { header: `\tbearer ${MCP_TEST_TOKEN}`, verdict: "accept" }, // leading HTAB (OWS)
  { header: `  bearer ${MCP_TEST_TOKEN}`, verdict: "accept" }, // leading OWS
  { header: "Bearer", verdict: "scheme" }, // no token
  { header: "Bearer ", verdict: "scheme" }, // empty token
  { header: undefined, verdict: "scheme" }, // absent header
  { header: `Basic ${MCP_TEST_TOKEN}`, verdict: "scheme" }, // wrong scheme
  { header: `Bearer ${WRONG_TOKEN}`, verdict: "token" }, // wrong token
];

/** The matrix with the header value's token replaced per surface. */
function headerFor(row: { header?: string }, token: string): string | undefined {
  if (row.header === undefined) return undefined;
  return row.header.split(MCP_TEST_TOKEN).join(token);
}

const EXPECTED_STATUS: Record<Verdict, number> = { accept: 200, scheme: 401, token: 403 };

interface Probe {
  status: number;
  raw: string;
  headers: [string, string][];
}

async function probeHistory(h: HistoryServerHandle, path: string, header?: string): Promise<Probe> {
  const res = await fetch(h.baseUrl + path, {
    headers: header === undefined ? { ...JSON_HEADERS } : { ...JSON_HEADERS, authorization: header },
  });
  return { status: res.status, raw: await res.text(), headers: [...res.headers.entries()] };
}

async function probeMcp(url: string, header?: string): Promise<Probe> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (header !== undefined) headers.authorization = header;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } }),
  });
  return { status: res.status, raw: await res.text(), headers: [...res.headers.entries()] };
}

function wwwAuthenticate(probe: Probe): string | undefined {
  return probe.headers.find(([name]) => name === "www-authenticate")?.[1];
}

test("bearer parity: the §2 matrix yields identical verdicts on BOTH real surfaces, leak- and dispatch-free", async () => {
  await withHttpServer(
    async (mcp) => {
      const mcpWorld: CliWorld = mcp.world;
      await withHistoryServer(createSyncHistoryServer, {}, async (h) => {
        const historyPath = new URL(h.world.addressOf(0)).pathname;
        const collected: Probe[] = [];

        for (const row of MATRIX) {
          const historyCallsBefore = h.getAttachmentCalls();
          const mcpCallsBefore = mcpWorld.fake.callLog.length;

          const mcpProbe = await probeMcp(mcp.url, row.header);
          const historyProbe = await probeHistory(h, historyPath, headerFor(row, TOKEN_SENTINEL));
          collected.push(mcpProbe, historyProbe);

          const expected = EXPECTED_STATUS[row.verdict];
          assert.equal(mcpProbe.status, expected, `MCP ${JSON.stringify(row.header)} ⇒ ${expected}`);
          assert.equal(historyProbe.status, expected, `history ${JSON.stringify(row.header)} ⇒ ${expected}`);
          assert.equal(
            historyProbe.status,
            mcpProbe.status,
            `verdict parity for ${JSON.stringify(row.header)}`,
          );

          if (row.verdict === "scheme") {
            assert.equal(wwwAuthenticate(mcpProbe), "Bearer", "MCP scheme rejection carries the challenge");
            assert.equal(wwwAuthenticate(historyProbe), "Bearer", "history scheme rejection carries the challenge");
          }

          // Zero-dispatch rule: every rejection row — including scheme-casing
          // rejections — performs zero handler/engine/port/state work.
          if (row.verdict !== "accept") {
            assert.equal(
              h.getAttachmentCalls(),
              historyCallsBefore,
              `history rejection ${JSON.stringify(row.header)} probed the tracker ZERO times`,
            );
            assert.equal(
              mcpWorld.fake.callLog.length,
              mcpCallsBefore,
              `MCP rejection ${JSON.stringify(row.header)} dispatched ZERO port calls`,
            );
          } else {
            assert.equal(mcpWorld.fake.callLog.length, 0, "even the MCP accepts only handshake (initialize)");
          }
        }

        // Leak rule: no presented credential VALUE — right or wrong — appears in
        // ANY response byte (body or headers) on either surface.
        const all = collected.map((p) => p.raw + p.headers.map(([k, v]) => `${k}:${v}`).join("\n")).join("\n");
        for (const secret of [MCP_TEST_TOKEN, TOKEN_SENTINEL, WRONG_TOKEN]) {
          assert.equal(all.includes(secret), false, `response corpus leaks ${JSON.stringify(secret)}`);
        }
      });
    },
    {},
  );
});
