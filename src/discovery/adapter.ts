/**
 * 003 Task Discovery & Framework Adapters — adapter interface + types (data-model §3–§5;
 * contracts/framework-adapter.md is the spec-facing mirror).
 *
 * **FROZEN FOR 004 — amendments only, snapshot-enforced.** Feature 004 imports
 * `FrameworkAdapter` and the built-in `generic` adapter from `task-linear-sync/discovery`
 * and never touches discovery internals or individual adapter files
 * (tests/contract/discovery-surface.test.ts gates this surface; drift is a Wave-2 build
 * break by design — contracts/README.md amendment rule).
 *
 * This file is interface + types ONLY (no behavior): implementations live in
 * `./adapters/*`, selection in `./registry`, merge in `./conventions`.
 */
import type { FrameworkMetadata } from "../domain/task.js";
import type { ResolvedConfig } from "../config/schema.js";
import type { DiscoveredFile, FrameworkIdentity } from "./types.js";

/** Directory context handed to detect()/featureName() — non-symlink regular-file basenames in the task file's directory. */
export interface DetectionContext {
  /** e.g. ".kiro/specs/auth/tasks.md". */
  readonly repoRelativePosixPath: string;
  /** Basenames present in the same dir (missing siblings absent). */
  readonly siblingFileNames: readonly string[];
  /** From ResolvedConfig (frozen). */
  readonly specsBaseDirectories: readonly string[];
}

/** A single adapter's declarative match for a path (+ optional sibling markers). */
export interface DetectionMatch {
  readonly adapterId: string;
  /** The literal path/base-dir pattern that matched; its length is the rank key (research R8). A siblings-only match contributes "". */
  readonly matchedPattern: string;
  readonly via: "path" | "path+siblings" | "siblings";
}

/** Declarative Feature_Name extraction (research R9). */
export type FeatureNameRule =
  /** Immediate parent beneath a base dir (kiro, spec-kit, generic). */
  | { readonly kind: "parent-dir" }
  /** Parent directory or task-file basename when no parent feature directory is present (bmad). */
  | { readonly kind: "parent-or-basename" }
  /** Meaningful segment after one of the markers, e.g. ["openspec/","changes/","specs/"] (open-spec). */
  | { readonly kind: "segment-after"; readonly markers: readonly string[] }
  | { readonly kind: "none" };

/**
 * Per-framework convention bundle — the 003 realization of 002 data-model §3's member list
 * ("003 implements, 004 consumes the interface only"). All fields overridable via
 * DiscoveryOverrides (research R7). Grammars are regex SOURCE strings (consumed by 004);
 * 003 does not parse task content.
 */
export interface FrameworkAdapter {
  /** Built-ins are the five frozen literals; custom = any non-empty string outside them (R5). */
  readonly id: FrameworkIdentity;
  /** Basename globs (research R2); effective value after merge (R7). */
  readonly taskFilePatterns: readonly string[];
  /** Repo-root-relative POSIX dir patterns; also discovery hints + rank material. */
  readonly baseDirectories: readonly string[];
  /** Declarative markers driving detection (001 R7.2). */
  readonly detection: {
    /** POSIX path startsWith any (segment-bounded "beneath"). */
    readonly pathPrefixes?: readonly string[];
    /** Path substring any (e.g. "openspec/"). */
    readonly pathContains?: readonly string[];
    /** Sibling basename any (e.g. "prd.md"). */
    readonly siblingsAnyOf?: readonly string[];
    /** spec-kit: path AND sibling must match (001 R7.2). */
    readonly requirePathAndSiblings?: boolean;
  };
  readonly featureNameRule: FeatureNameRule;
  /** Regex source (consumed by 004). */
  readonly headingGrammar: string;
  readonly phasePattern?: string;
  readonly summaryPattern?: string;
  readonly rollupPattern?: string;
  /** Default title strip prefixes (FR-007); hook for 005 derivation. */
  readonly titleBehavior?: { readonly stripPrefixes: readonly string[] };
  /** Per-adapter configured sibling doc names (001 R7.5). */
  readonly siblingDocuments: readonly string[];
  /** e.g. ".kiro/hooks/" (001 Glossary Agent_Hooks_Directory). */
  readonly agentHooksDirectory?: string;
  /** Agent-hook template behavior (research R11; consumed by 010). */
  readonly agentHookTemplate?: "kiro-json" | "command-json" | "none";
  /** MUST be empty for "generic" (FR-010: no framework-specific exclusions beyond global summary/rollup defaults). */
  readonly frameworkSpecificExclusions?: readonly string[];

  /** Pure predicate. Returns the best match for this adapter, or null. Deterministic; no I/O (ctx is pre-supplied). */
  detect(candidatePath: string, ctx: DetectionContext): DetectionMatch | null;
  /** Derived feature name from the path alone, or undefined when underivable (never throws). */
  featureName(relPath: string): string | undefined;
}

/** Deterministic detection outcome recorded on every DiscoveredFile (data-model §4). */
export interface DetectionRecord {
  readonly adapterId: string;
  readonly frameworkId: FrameworkIdentity;
  readonly matchedPattern: string;
  readonly via: "explicit" | "path" | "path+siblings" | "siblings" | "fallback";
  /** Adapter ids that matched, sorted alphabetically. */
  readonly candidates: readonly string[];
}

/** The enabled-adapter pool + selection inputs (data-model §4).
 * Selection (`selectAdapter`) and registry construction (`createAdapterRegistry`) are
 * declared in contracts/framework-adapter.md as part of this contract's surface; they are
 * implemented in `./registry.ts` (this file is interface + types ONLY, no behavior). */
export interface AdapterRegistry {
  readonly enabledAdapters: readonly FrameworkAdapter[];
  /** Built-in default ["kiro","open-spec","spec-kit","bmad","generic"]; overridable (FR-011). */
  readonly precedence: readonly string[];
  readonly selectionOverride?: FrameworkIdentity | ((fp: string, c: DetectionContext) => FrameworkIdentity | undefined);
  /** Frozen 002 merged config; read-only. */
  readonly config: ResolvedConfig;
}

/**
 * Selection (data-model §4). Rank: (1) longest matchedPattern, (2) index in precedence list,
 * (3) alphabetical. Precedence default = ["kiro","open-spec","spec-kit","bmad","generic"] — the
 * spec's fixed marker precedence, overridable via overrides.precedence. Zero matches → generic
 * (via: "fallback"). overrides.selection short-circuits (via: "explicit").
 */
export declare function selectAdapter(filePath: string, ctx: DetectionContext, registry: AdapterRegistry): DetectionRecord;

/**
 * Build the registry from the frozen config + optional programmatic overrides (highest
 * precedence layer, research R7). Adds custom adapters (validated: id + path/base-dir patterns
 * + heading grammar; missing any → CustomAdapterError listing every miss). Applies per-adapter
 * convention overrides (deep-merged, arrays replace).
 */
export declare function createAdapterRegistry(config: ResolvedConfig, overrides?: DiscoveryOverrides): AdapterRegistry;

/** FR-011 minimal custom adapter: at least id, path/base-directory patterns, heading grammar. */
export interface CustomAdapterDescriptor {
  /** Non-empty; not a built-in id (data-model §5) unless `shadowBuiltInId` opts in. */
  readonly id: FrameworkIdentity;
  readonly taskFilePatterns: readonly string[];
  readonly baseDirectories: readonly string[];
  /** Regex source (required minimum; compiled at registration). */
  readonly headingGrammar: string;
  /** Default: derived pathPrefixes from baseDirectories. */
  readonly detection?: FrameworkAdapter["detection"];
  /** Default: { kind: "none" }. */
  readonly featureNameRule?: FeatureNameRule;
  /** Defaults to the global grammar values when absent. */
  readonly phasePattern?: string;
  readonly summaryPattern?: string;
  readonly rollupPattern?: string;
  readonly titleBehavior?: { readonly stripPrefixes: readonly string[] };
  /** Defaults to the configured `siblingDocuments` when absent. */
  readonly siblingDocuments?: readonly string[];
  readonly agentHooksDirectory?: string;
  readonly agentHookTemplate?: "kiro-json" | "command-json" | "none";
  /** Explicit opt-in to register an id shadowing a built-in (data-model §5); rejected without it. */
  readonly shadowBuiltInId?: boolean;
}

/** FR-011 overridable-convention subset for a known adapter. */
export interface AdapterConventions {
  readonly taskFilePatterns?: readonly string[];
  readonly baseDirectories?: readonly string[];
  readonly detection?: Partial<FrameworkAdapter["detection"]>;
  readonly headingGrammar?: string;
  readonly phasePattern?: string;
  readonly summaryPattern?: string;
  readonly rollupPattern?: string;
  readonly titleBehavior?: { readonly stripPrefixes: readonly string[] };
  readonly siblingDocuments?: readonly string[];
  readonly featureNameRule?: FeatureNameRule;
  readonly agentHooksDirectory?: string;
  readonly agentHookTemplate?: "kiro-json" | "command-json" | "none";
  /** Programmatic Feature_Name extraction override (research R9); beats `featureNameRule`. */
  readonly featureName?: (relPath: string) => string | undefined;
}

/** Programmatic override layer (highest precedence, research R7). */
export interface DiscoveryOverrides {
  readonly selection?: FrameworkIdentity | ((fp: string, c: DetectionContext) => FrameworkIdentity | undefined);
  /** Override adapter precedence (FR-011). */
  readonly precedence?: readonly string[];
  /** Per-known-adapter convention overrides (deep-merged; arrays replace wholesale). */
  readonly adapters?: Readonly<Record<string, AdapterConventions>>;
  /** FR-011 custom adapters. */
  readonly customAdapters?: readonly CustomAdapterDescriptor[];
}

/** Thrown when a custom adapter descriptor is incomplete (002 fail-fast-and-complete precedent). */
export class CustomAdapterError extends Error {
  override readonly name = "CustomAdapterError";
  readonly adapterId: string;
  /** Every missing required part at once, e.g. ["taskFilePatterns","headingGrammar"]. */
  readonly missing: readonly string[];

  constructor(adapterId: string, missing: readonly string[]) {
    super(
      missing.length > 0
        ? `custom adapter '${adapterId || "(missing id)"}' is not valid — missing/invalid required part(s): ${missing.join(", ")}`
        : `custom adapter '${adapterId}' conflicts with the enabled adapter registry`,
    );
    this.adapterId = adapterId;
    this.missing = missing;
  }
}

/** Thrown when `overrides.selection` (or the generic fallback) names an id outside the enabled pool. */
export class SelectionOverrideError extends Error {
  override readonly name = "SelectionOverrideError";
  readonly requestedId: string;

  constructor(requestedId: string, detail: string) {
    super(`framework selection '${requestedId}' is not selectable: ${detail}`);
    this.requestedId = requestedId;
  }
}

/**
 * Convenience: build the frozen 002 FrameworkMetadata field set from a discovered file
 * (FR-009 input; 008 persists it). For built-in adapters the result is exactly assignable to
 * FrameworkMetadata; custom-adapter ids pass through as strings at runtime (payload JSON is
 * type-independent) — the type-level union widening is the amendment candidate of research R5.
 */
export declare function frameworkMetadataFragment(
  f: DiscoveredFile,
): Omit<FrameworkMetadata, "frameworkId"> & { frameworkId: FrameworkIdentity };
