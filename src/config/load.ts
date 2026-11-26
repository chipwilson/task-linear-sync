/**
 * Layered config load: built-in defaults -> JSON file -> programmatic overrides
 * (constitution III). Abort semantics with exactly three failure categories (R4):
 * on ANY category loading aborts naming the file path and the category, and applies NO
 * partial configuration from that file (FR-006, SC-002).
 */
import { statSync, readFileSync } from "node:fs";

import { builtInDefaults, DEFAULT_LANE_STATE_MAP, DEFAULT_WORKFLOW_STATE_NAMES, DERIVATIONS } from "./defaults.js";
import { deepMerge } from "./merge.js";
import { ConfigFileError } from "./schema.js";
import type { ConfigOverrides, LoadConfigOptions, ResolvedConfig } from "./schema.js";

/** R4 category decision order: stat-miss → missing; read throw → unreadable; parse/root → invalid-json. */
function readConfigFileObject(configFilePath: string): Record<string, unknown> {
  try {
    const st = statSync(configFilePath);
    if (!st.isFile()) {
      throw new ConfigFileError("unreadable", configFilePath, "path is not a regular file");
    }
  } catch (e) {
    if (e instanceof ConfigFileError) throw e;
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      throw new ConfigFileError("missing", configFilePath, code);
    }
    throw new ConfigFileError("unreadable", configFilePath, code ?? String(e));
  }
  let text: string;
  try {
    text = readFileSync(configFilePath, "utf8");
  } catch (e) {
    throw new ConfigFileError("unreadable", configFilePath, (e as NodeJS.ErrnoException).code ?? String(e));
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new ConfigFileError("invalid-json", configFilePath, (e as Error).message);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ConfigFileError("invalid-json", configFilePath, "root must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

/** Dot-paths explicitly present in a layer (undefined leaves are absent). */
function collectPresentPaths(layer: unknown, prefix: string, into: Set<string>): void {
  if (layer === null || layer === undefined) return;
  if (Array.isArray(layer)) {
    into.add(prefix);
    return;
  }
  if (typeof layer !== "object") {
    into.add(prefix);
    return;
  }
  for (const [key, value] of Object.entries(layer as Record<string, unknown>)) {
    if (value === undefined) continue; // undefined = absent (R3)
    const path = prefix.length === 0 ? key : `${prefix}.${key}`;
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      collectPresentPaths(value, path, into);
      into.add(path); // presence of a partial group object must also suppress re-derivation of its own path only
    } else {
      into.add(path);
    }
  }
}

function setDeep(target: Record<string, unknown>, dotPath: string, value: unknown): void {
  const parts = dotPath.split(".");
  let node = target;
  for (const part of parts.slice(0, -1)) {
    const next = node[part];
    if (next === undefined || typeof next !== "object" || next === null) {
      node[part] = {};
    }
    node = node[part] as Record<string, unknown>;
  }
  node[parts[parts.length - 1]] = value;
}

/**
 * 001 R17.9: when the merged toolId differs from the shipped default, every toolId-derived
 * value re-derives — UNLESS it was explicitly provided by the file or overrides layer
 * (each derivable value independently overridable).
 */
function applyToolIdDerivations(merged: Record<string, unknown>, explicit: Set<string>): void {
  const toolId = merged.toolId;
  if (typeof toolId !== "string" || toolId === builtInDefaults.toolId) return;
  for (const { path, derive } of DERIVATIONS) {
    if (explicit.has(path)) continue;
    setDeep(merged, path, derive(toolId));
  }
}

/**
 * 024 resolution pass (research R1; contract C2.1/C2.2; data-model §2): after the
 * defaults→file→overrides merge, materialize the task-state-mapping defaults for
 * EVERY team key present in `merged.teams` — the resolved config is the single
 * source of truth, so `resolveLaneState`/`desiredCompletionStateName` consume the
 * defaults as ordinary configured values (zero mapping-logic change).
 *
 * Fill rules (deterministic and total — identical inputs ⇒ byte-identical
 * `canonicalizeConfig`, C2.3):
 *  - identity entries (`backlog`/`todo`/`inProgress`/`done`): `undefined` ⇒ filled
 *    from `DEFAULT_WORKFLOW_STATE_NAMES`; a configured non-empty string wins (FR-006);
 *    a configured blank/`null` string is KEPT (validation unchanged — C2.4; the
 *    resolver treats `null` as missing, research R7);
 *  - `lanes`: absent ⇒ a FRESH per-team copy of `DEFAULT_LANE_STATE_MAP`; present
 *    map ⇒ every absent table key filled, configured lane keys kept; an explicit
 *    `null` map SURVIVES as `null` (lane-mapping OFF — research R3; `"lanes": {}`
 *    is NOT the disable — it deep-merges into all-defaults);
 *  - a team ABSENT from the config is never created; a non-object team row or
 *    `workflowStates` value is left untouched (the identity gate names it).
 */
export function applyStateMappingDefaults(merged: Record<string, unknown>): void {
  const teams = merged.teams;
  if (teams === null || typeof teams !== "object" || Array.isArray(teams)) return;
  for (const teamKey of Object.keys(teams as Record<string, unknown>)) {
    const team = (teams as Record<string, unknown>)[teamKey];
    if (team === null || typeof team !== "object" || Array.isArray(team)) continue;
    const teamRecord = team as Record<string, unknown>;
    let workflowStates = teamRecord.workflowStates;
    if (workflowStates === undefined) {
      // A team row with only `projects` adopts the full default mapping (SC-001).
      workflowStates = {};
      teamRecord.workflowStates = workflowStates;
    }
    if (workflowStates === null || typeof workflowStates !== "object" || Array.isArray(workflowStates)) continue;
    const ws = workflowStates as Record<string, unknown>;
    for (const [identity, defaultName] of Object.entries(DEFAULT_WORKFLOW_STATE_NAMES)) {
      if (ws[identity] === undefined) ws[identity] = defaultName; // configured (incl. blank/null) wins — kept verbatim
    }
    if (ws.lanes === undefined) {
      ws.lanes = { ...DEFAULT_LANE_STATE_MAP }; // fresh per-team copy — never a shared object (C2.2)
    } else if (ws.lanes !== null && typeof ws.lanes === "object" && !Array.isArray(ws.lanes)) {
      const lanes = ws.lanes as Record<string, unknown>;
      for (const [lane, defaultName] of Object.entries(DEFAULT_LANE_STATE_MAP)) {
        if (lanes[lane] === undefined) lanes[lane] = defaultName;
      }
    }
    // `lanes: null` — explicit lane-mapping-off — survives untouched (R3).
  }
}

/** Layered load: built-in defaults -> JSON file -> programmatic overrides (constitution III). */
export function loadConfig(o: LoadConfigOptions = {}): ResolvedConfig {
  // `o.env` and `o.clock` are accepted per contract: env supplies NAME-based lookups at use
  // time (credential values never enter the model) and the clock is reserved for derived
  // values (none are time-based today).
  void o.env;
  void o.clock;

  const fileValue = o.configFile === undefined ? undefined : readConfigFileObject(o.configFile);

  const explicit = new Set<string>();
  collectPresentPaths(fileValue, "", explicit);
  collectPresentPaths(o.overrides as Record<string, unknown> | undefined, "", explicit);

  const merged = deepMerge(
    deepMerge(structuredClone(builtInDefaults), fileValue),
    o.overrides as ConfigOverrides | undefined,
  ) as Record<string, unknown>;

  applyToolIdDerivations(merged, explicit);
  // 024 (research R1): resolution pass runs immediately after the toolId
  // re-derivations — before any consumer (validation, engine, reports) reads the
  // config, so the resolved document is the single truth (C2.4).
  applyStateMappingDefaults(merged);
  return merged as unknown as ResolvedConfig;
}
