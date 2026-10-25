/**
 * Adapter registry + selection (contracts/framework-adapter.md rules 1–2; research R7/R8;
 * data-model §4). Pure functions — the registry performs no I/O; `DetectionContext` is
 * supplied by the discovery caller (rule 7).
 *
 * Ranking: (1) longest `matchedPattern` (rank material — base-dir patterns included, R8),
 * (2) index in the precedence list, (3) alphabetical adapter id. Zero matches → `generic`
 * fallback; `overrides.selection` short-circuits (via "explicit").
 */
import type { ResolvedConfig } from "../config/schema.js";
import type {
  AdapterRegistry,
  CustomAdapterDescriptor,
  DetectionContext,
  DetectionMatch,
  DetectionRecord,
  DiscoveryOverrides,
  FrameworkAdapter,
} from "./adapter.js";
import { CustomAdapterError, SelectionOverrideError } from "./adapter.js";
import { genericConventions } from "./adapters/generic.js";
import {
  customDescriptorConventions,
  defineFrameworkAdapter,
  isShadowingBuiltInId,
  resolveConventions,
  validateCustomDescriptor,
  type ResolvedConventions,
} from "./conventions.js";
import type { FrameworkIdentity } from "./types.js";

/** The spec's fixed marker precedence (contracts/framework-adapter.md rule 1). */
export const DEFAULT_PRECEDENCE: readonly string[] = ["kiro", "open-spec", "spec-kit", "bmad", "generic"];

/**
 * Built-in conventions rows (defaults layer, FR-007). US1 lands `generic` only
 * (T018/T019); T031 completes the five-adapter table in `adapters/index.ts`
 * (`builtInAdapters`).
 */
export function builtInConventionRows(): readonly { readonly id: FrameworkIdentity; readonly conventions: ResolvedConventions }[] {
  return [{ id: "generic", conventions: genericConventions }];
}

function toAdapter(
  conventions: ResolvedConventions,
  config: ResolvedConfig,
  overrides?: DiscoveryOverrides,
): FrameworkAdapter {
  return defineFrameworkAdapter(resolveConventions(conventions, config, overrides?.adapters?.[conventions.id]));
}

function addCustomAdapter(
  pool: FrameworkAdapter[],
  descriptor: CustomAdapterDescriptor,
  config: ResolvedConfig,
): void {
  validateCustomDescriptor(descriptor); // lists EVERY missing required part at once (FR-011)
  if (isShadowingBuiltInId(descriptor.id) && descriptor.shadowBuiltInId !== true) {
    throw new CustomAdapterError(descriptor.id, []); // shadows a built-in without the explicit opt-in
  }
  if (pool.some((adapter) => adapter.id === descriptor.id)) {
    throw new CustomAdapterError(descriptor.id, []); // duplicate adapter id
  }
  pool.push(defineFrameworkAdapter(customDescriptorConventions(descriptor, config)));
}

/**
 * Build the enabled-adapter pool from frozen config + programmatic overrides (highest
 * layer, research R7). Throws `CustomAdapterError` for incomplete or conflicting custom
 * descriptors — before any discovery I/O happens.
 */
export function createAdapterRegistry(config: ResolvedConfig, overrides?: DiscoveryOverrides): AdapterRegistry {
  const enabled: FrameworkAdapter[] = [];
  for (const row of builtInConventionRows()) {
    if ((config.frameworkAdapters as readonly string[]).includes(row.id)) {
      enabled.push(toAdapter(row.conventions, config, overrides));
    }
  }
  for (const descriptor of overrides?.customAdapters ?? []) addCustomAdapter(enabled, descriptor, config);
  const precedence = overrides?.precedence ?? DEFAULT_PRECEDENCE;
  return Object.freeze({
    enabledAdapters: Object.freeze(enabled),
    precedence: Object.freeze([...precedence]),
    ...(overrides?.selection !== undefined ? { selectionOverride: overrides.selection } : {}),
    config,
  });
}

/** Rank key: longest matchedPattern wins (R8). */
function longerMatch(a: DetectionMatch, b: DetectionMatch): boolean {
  return a.matchedPattern.length > b.matchedPattern.length;
}

/**
 * Selection (data-model §4, pure). Explicit overrides short-circuit with via "explicit";
 * otherwise rank matched adapters by longest `matchedPattern` → precedence index →
 * alphabetical; zero matches fall back to `generic` (via "fallback").
 */
export function selectAdapter(filePath: string, ctx: DetectionContext, registry: AdapterRegistry): DetectionRecord {
  const byId = new Map(registry.enabledAdapters.map((adapter) => [adapter.id, adapter]));
  const candidates = [...byId.keys()]
    .filter((id) => byId.get(id)?.detect(filePath, ctx) !== null)
    .sort();

  const resolveExplicit = (requested: FrameworkIdentity): DetectionRecord => {
    if (!byId.has(requested)) {
      throw new SelectionOverrideError(requested, "not in the enabled adapter registry");
    }
    return {
      adapterId: requested,
      frameworkId: requested,
      matchedPattern: "",
      via: "explicit",
      candidates,
    };
  };

  const selection = registry.selectionOverride;
  if (typeof selection === "function") {
    const requested = selection(filePath, ctx);
    if (requested !== undefined) return resolveExplicit(requested); // returning undefined defers to marker selection
  } else if (selection !== undefined) {
    return resolveExplicit(selection);
  }

  if (candidates.length === 0) {
    const generic = byId.get("generic");
    if (generic === undefined) {
      throw new SelectionOverrideError("generic", "no adapter matched and the generic fallback is not enabled");
    }
    return { adapterId: "generic", frameworkId: "generic", matchedPattern: "", via: "fallback", candidates: [] };
  }

  const matches = candidates
    .map((id) => byId.get(id)?.detect(filePath, ctx))
    .filter((m): m is DetectionMatch => m !== null);
  const rankIndex = (id: string): number => {
    const at = registry.precedence.indexOf(id);
    return at === -1 ? registry.precedence.length : at;
  };
  let best = matches[0] as DetectionMatch;
  for (const match of matches.slice(1)) {
    if (longerMatch(match, best)) best = match;
  }
  const winners = matches.filter((m) => m.matchedPattern.length === best.matchedPattern.length);
  winners.sort((a, b) => rankIndex(a.adapterId) - rankIndex(b.adapterId) || (a.adapterId < b.adapterId ? -1 : a.adapterId > b.adapterId ? 1 : 0));
  const winner = winners[0] as DetectionMatch;
  return {
    adapterId: winner.adapterId,
    frameworkId: winner.adapterId as FrameworkIdentity,
    matchedPattern: winner.matchedPattern,
    via: winner.via,
    candidates,
  };
}
