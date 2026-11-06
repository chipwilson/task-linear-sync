/**
 * T008 (feature 014) — surface contract-freeze machinery for the 011/012 surfaces
 * (contracts/surface-freeze.md; mirrors the 002 frozen-surface posture).
 *
 * Inventories are BUILT FROM the runtime registries (tool registry, error
 * envelopes, protocol set, refusal table, config defaults, cookie builder) —
 * never hand-written. The comparator emits deterministic drift lines
 * (`ADDED`/`REMOVED/CHANGED`, one per element, sorted), and the amendment-entry
 * reader parses the per-surface logs in docs/contract-amendments.md so the
 * freeze tests can assert entry integrity.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { builtInDefaults } from "../../src/config/index.js";
import { ERROR_ENVELOPES } from "../../src/history-server/errors.js";
import { createAccessGate } from "../../src/history-server/auth.js";
import { HTTP_REFUSALS } from "../../src/mcp/auth.js";
import type { HttpRefusal } from "../../src/mcp/auth.js";
import {
  DEFAULT_PROTOCOL_VERSION,
  RPC_ERROR_CODES,
  SUPPORTED_PROTOCOL_VERSIONS,
} from "../../src/mcp/jsonrpc.js";
import { TOOL_DEFINITIONS, isVisible } from "../../src/mcp/tools.js";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));

export type SurfaceName = "history" | "mcp";

/** Element-id → frozen element. Deterministic keys/arrays. */
export type Inventory = Record<string, unknown>;

const SNAPSHOT_PATHS: Record<SurfaceName, URL> = {
  history: new URL(`file://${pkgRoot}tests/contract/snapshots/history-surface.json`),
  mcp: new URL(`file://${pkgRoot}tests/contract/snapshots/mcp-surface.json`),
};

/** Recursively key-sorted JSON — the canonical form for compare and snapshot files. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) out[key] = sortDeep((value as Record<string, unknown>)[key]);
    return out;
  }
  return value;
}

/** CHANGED payloads stay readable but bounded. */
export function shorten(canonical: string): string {
  return canonical.length <= 120 ? canonical : canonical.slice(0, 117) + "...";
}

/** Drift lines between a checked-in snapshot and the live inventory (sorted, one per element). */
export function diffInventories(checkedIn: Inventory, current: Inventory): string[] {
  const drift: string[] = [];
  const ids = [...new Set([...Object.keys(checkedIn), ...Object.keys(current)])].sort();
  for (const id of ids) {
    const before = Object.hasOwn(checkedIn, id) ? canonicalJson(checkedIn[id]) : undefined;
    const after = Object.hasOwn(current, id) ? canonicalJson(current[id]) : undefined;
    if (before === undefined) drift.push(`ADDED ${id}`);
    else if (after === undefined) drift.push(`REMOVED ${id}`);
    else if (before !== after) drift.push(`CHANGED ${id}: ${shorten(before)} -> ${shorten(after)}`);
  }
  return drift.sort();
}

/** Element ids named by drift lines (verb and value payload stripped). */
export function driftElementIds(lines: readonly string[]): string[] {
  return lines.map((line) => {
    const rest = line.slice(line.indexOf(" ") + 1);
    return line.startsWith("CHANGED") ? rest.slice(0, rest.indexOf(":")) : rest;
  });
}

/** Serialize a snapshot file body (sorted keys, trailing newline). */
export function serializeSnapshot(inventory: Inventory): string {
  return JSON.stringify(sortDeep(inventory), null, 2) + "\n";
}

export function loadSnapshot(surface: SurfaceName): Inventory | null {
  const path = fileURLToPath(SNAPSHOT_PATHS[surface]);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as Inventory;
}

export function writeSnapshot(surface: SurfaceName, inventory: Inventory): void {
  const path = fileURLToPath(SNAPSHOT_PATHS[surface]);
  mkdirSync(fileURLToPath(new URL(".", SNAPSHOT_PATHS[surface])), { recursive: true });
  writeFileSync(path, serializeSnapshot(inventory));
}

export const UPDATE_SURFACE_SNAPSHOTS = process.env.UPDATE_SURFACE_SNAPSHOTS === "1";

// ── Live inventories (runtime-derived) ────────────────────────────────────────

function flattenGroup(prefix: string, group: object): Inventory {
  const out: Inventory = {};
  for (const [key, value] of Object.entries(group)) out[`${prefix}.${key}`] = value;
  return out;
}

/** The MCP surface: tool registry, protocol set, closed code sets, refusal table, config keys. */
export function mcpInventory(): Inventory {
  const inv: Inventory = {};
  for (const def of TOOL_DEFINITIONS) {
    inv[`tool.${def.name}`] = { description: def.description, visibleByDefault: isVisible(def, { enabled: false }) };
    inv[`tool.${def.name}.inputSchema`] = def.inputSchema;
  }
  for (const version of SUPPORTED_PROTOCOL_VERSIONS) inv[`protocol.${version}`] = "supported";
  inv["protocol.default"] = DEFAULT_PROTOCOL_VERSION;
  for (const [name, code] of Object.entries(RPC_ERROR_CODES)) inv[`error.${code}`] = name;
  for (const refusal of Object.values(HTTP_REFUSALS) as readonly HttpRefusal[]) {
    inv[`httpstatus.${refusal.status}`] = {
      body: refusal.body,
      header: refusal.header ?? null,
      headerValue: refusal.headerValue ?? null,
    };
  }
  inv["transport.http"] = { route: "/mcp", method: "POST" };
  inv["transport.stdio"] = { framing: "line-delimited JSON-RPC" };
  Object.assign(inv, flattenGroup("config.mcp", builtInDefaults.mcp));
  return inv;
}

/** Fixed clock so the cookie-attribute probe is deterministic. */
const fixedClock = {
  now: () => new Date("2026-01-01T00:00:00.000Z"),
  elapsed: (iso: string) => Date.parse("2026-01-01T00:00:00.000Z") - Date.parse(iso),
};

function cookieAttributes(secureCookies?: boolean): string {
  const gate = createAccessGate({
    accessMode: "private",
    tokenEnvVarName: "SURFACE_FREEZE_PROBE_TOKEN",
    env: { SURFACE_FREEZE_PROBE_TOKEN: "probe-token-not-a-secret" },
    toolId: "surface-freeze",
    clock: fixedClock,
    ...(secureCookies === undefined ? {} : { secureCookies }),
  });
  const header = gate.sessionCookieHeader();
  const semi = header.indexOf(";");
  return semi < 0 ? "" : header.slice(semi + 1);
}

/** The history surface: routes, envelopes, SSE framing, cookie set, access modes, config keys. */
export function historyInventory(): Inventory {
  const inv: Inventory = {};
  inv["route.attachment.canonical"] = {
    template: builtInDefaults.attachmentUrlTemplate,
    methods: ["GET", "POST"],
  };
  inv["route.attachment.continuation"] = {
    template: builtInDefaults.continuationUrlTemplate,
    methods: ["GET", "POST"],
  };
  for (const envelope of Object.values(ERROR_ENVELOPES)) {
    inv[`status.${envelope.status}`] = { code: envelope.code, message: envelope.message };
  }
  // Self-protective admission answer (014 R3): same envelope, header addition only.
  inv["selfprotect.admission"] = {
    status: ERROR_ENVELOPES.RATE_LIMITED.status,
    code: ERROR_ENVELOPES.RATE_LIMITED.code,
    retryAfter: "1",
  };
  inv["sse.contentType"] = "text/event-stream";
  inv["sse.cookieAttributes"] = cookieAttributes();
  inv["sse.cookieSecure"] = cookieAttributes(true);
  inv["accessMode.private"] = "default";
  inv["accessMode.public"] = "opt-in";
  Object.assign(inv, flattenGroup("config.web", builtInDefaults.web));
  return inv;
}

export const LIVE_INVENTORIES: Record<SurfaceName, () => Inventory> = {
  history: historyInventory,
  mcp: mcpInventory,
};

// ── Amendment-entry log reader (docs/contract-amendments.md) ─────────────────

const AMENDMENTS_DOC = new URL(`file://${pkgRoot}docs/contract-amendments.md`);

/**
 * Element ids cited (backticked, grammar-conform) by the entries in the
 * `### Log — <surface> surface` section. Tokens containing `<` (the grammar
 * legend) are excluded.
 */
export function amendmentEntryIds(surface: SurfaceName): string[] {
  const text = readFileSync(AMENDMENTS_DOC, "utf8");
  const heading = `### Log — ${surface} surface`;
  const start = text.indexOf(heading);
  if (start < 0) return [];
  const rest = text.slice(start + heading.length);
  const end = rest.search(/^#{2,3} /m);
  const section = end < 0 ? rest : rest.slice(0, end);
  const ids = new Set<string>();
  for (const match of section.matchAll(/`([a-z][A-Za-z]*\.[A-Za-z0-9_.-]+)`/g)) ids.add(match[1]!);
  return [...ids].sort();
}
