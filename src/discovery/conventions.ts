/**
 * Effective-convention resolution + adapter behavior helpers (research R7/R9; data-model §5–§6).
 *
 * Precedence is exactly constitution III — "built-in defaults, then config file, then
 * programmatic overrides" — merged with the frozen 002 `deepMerge` ("Arrays and scalars
 * replace wholesale", 002 research R3). Layer 2 uses ONLY the frozen `ResolvedConfig` keys
 * (no new config keys — frozen-contract guard):
 *
 * - `taskFilePatterns`, `headingIdGrammar`/`phasePattern`/`summaryPattern`/`rollupPattern`,
 *   `titleStripPrefixes`, `agentHooksDirectory` apply to all enabled adapters when the config
 *   deviates from the frozen built-in defaults (the merged config always carries values, so
 *   "when set" is evaluated as "when different from the built-in defaults", which keeps each
 *   adapter's own table entry intact under a default configuration).
 * - `specsBaseDirectories` and `siblingDocuments` feed the GENERIC adapter (T019: generic's
 *   baseDirectories/siblingDocuments come from config); framework adapters keep their per-
 *   framework 001 R7.5 rows (FR-007 — replacing them would violate the built-in table and
 *   SC-001, so research R7's blanket sentence is realized per-adapter here).
 * - `frameworkAdapters` is the enabled set (registry membership) and `skipDirectories` the
 *   traversal-level skip set — both consumed outside this file.
 *
 * NOTE (task sequencing): this file is seeded in the US1 phase because US1's traversal
 * already consumes the frozen-config layer (`taskFilePatterns`/`skipDirectories` overrides,
 * T013); T032 completes and test-gates the full three-layer matrix here.
 */
import type { FrameworkMetadata } from "../domain/task.js";
import type { ResolvedConfig } from "../config/schema.js";
import { builtInDefaults } from "../config/defaults.js";
import { deepMerge } from "../config/merge.js";
import type {
  AdapterConventions,
  CustomAdapterDescriptor,
  DetectionContext,
  DetectionMatch,
  FeatureNameRule,
  FrameworkAdapter,
} from "./adapter.js";
import { CustomAdapterError } from "./adapter.js";
import type { DiscoveredFile, FrameworkIdentity } from "./types.js";
import { isBuiltInFrameworkId } from "./types.js";

/** Fully-resolved per-adapter conventions — the ONLY input adapter behavior reads (§6). */
export interface ResolvedConventions {
  readonly id: FrameworkIdentity;
  readonly taskFilePatterns: readonly string[];
  readonly baseDirectories: readonly string[];
  readonly detection: FrameworkAdapter["detection"];
  readonly featureNameRule: FeatureNameRule;
  readonly headingGrammar: string;
  readonly phasePattern?: string;
  readonly summaryPattern?: string;
  readonly rollupPattern?: string;
  readonly titleBehavior?: { readonly stripPrefixes: readonly string[] };
  readonly siblingDocuments: readonly string[];
  readonly agentHooksDirectory?: string;
  readonly agentHookTemplate?: "kiro-json" | "command-json" | "none";
  readonly frameworkSpecificExclusions: readonly string[];
  /** Programmatic Feature_Name override (research R9) beats the declarative rule. */
  readonly featureNameOverride?: (relPath: string) => string | undefined;
}

function deepEqualJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Layer 2: the frozen-config contributions for one adapter (empty when config equals defaults). */
export function configConventionLayer(adapterId: FrameworkIdentity, config: ResolvedConfig): AdapterConventions {
  const layer: Record<string, unknown> = {};
  if (!deepEqualJson(config.taskFilePatterns, builtInDefaults.taskFilePatterns)) {
    layer.taskFilePatterns = [...config.taskFilePatterns];
  }
  if (config.headingIdGrammar !== builtInDefaults.headingIdGrammar) layer.headingGrammar = config.headingIdGrammar;
  if (config.phasePattern !== builtInDefaults.phasePattern) layer.phasePattern = config.phasePattern;
  if (config.summaryPattern !== builtInDefaults.summaryPattern) layer.summaryPattern = config.summaryPattern;
  if (config.rollupPattern !== builtInDefaults.rollupPattern) layer.rollupPattern = config.rollupPattern;
  if (!deepEqualJson(config.titleStripPrefixes, builtInDefaults.titleStripPrefixes)) {
    layer.titleBehavior = { stripPrefixes: [...config.titleStripPrefixes] };
  }
  if (config.agentHooksDirectory !== undefined && config.agentHooksDirectory !== (adapterId === "kiro" ? ".kiro/hooks/" : adapterId === "generic" ? ".task-linear-sync/hooks/" : undefined)) {
    layer.agentHooksDirectory = config.agentHooksDirectory;
  }
  if (adapterId === "generic") {
    if (!deepEqualJson(config.specsBaseDirectories, builtInDefaults.specsBaseDirectories)) {
      // Generic's base directories ARE the configured spec bases (001 R7.5) — they drive
      // the parent-dir-if-under-base Feature_Name rule; detection stays marker-free (T019).
      layer.baseDirectories = [...config.specsBaseDirectories];
    }
    if (!deepEqualJson(config.siblingDocuments, builtInDefaults.siblingDocuments)) {
      layer.siblingDocuments = [...config.siblingDocuments];
    }
  }
  return layer as AdapterConventions;
}

/** Merge one adapter's conventions: built-in table → frozen config keys → programmatic overrides. */
export function resolveConventions(
  base: ResolvedConventions,
  config: ResolvedConfig,
  programmatic?: AdapterConventions,
): ResolvedConventions {
  const merged = deepMerge(
    deepMerge(stripFunctions(base) as unknown, configConventionLayer(base.id, config) as unknown),
    programmatic ? (stripFunctions(programmatic) as unknown) : {},
  );
  const restored = { ...(merged as ResolvedConventions) };
  if (programmatic?.featureName) restored.featureNameOverride = programmatic.featureName;
  return restoreFunctions(restored, base, programmatic);
}

function stripFunctions<T extends object>(value: T): T {
  const { featureNameOverride: _o, featureName: _f, ...rest } = value as Record<string, unknown>;
  return rest as T;
}

function restoreFunctions(target: ResolvedConventions, base: ResolvedConventions, programmatic?: AdapterConventions): ResolvedConventions {
  const withOverride = { ...target };
  if (programmatic?.featureName) withOverride.featureNameOverride = programmatic.featureName;
  else if (base.featureNameOverride) withOverride.featureNameOverride = base.featureNameOverride;
  else delete withOverride.featureNameOverride;
  return withOverride;
}

/** Separator-bounded "beneath a directory pattern" at any depth (".kiro/specs/" under root). */
export function isBeneathDirectory(relPath: string, dirPattern: string): boolean {
  return relPath.startsWith(dirPattern) || relPath.includes(`/${dirPattern}`);
}

function parentDir(relPath: string): string | undefined {
  const cut = relPath.lastIndexOf("/");
  return cut <= 0 ? undefined : relPath.slice(0, cut);
}

function basename(relPath: string): string {
  return relPath.slice(relPath.lastIndexOf("/") + 1);
}

/** Declarative Feature_Name extraction (research R9; 001 R7.5 semantics per kind). */
export function applyFeatureNameRule(rule: FeatureNameRule, baseDirectories: readonly string[], relPath: string): string | undefined {
  switch (rule.kind) {
    case "none":
      return undefined;
    case "parent-dir": {
      // Immediate parent beneath a base directory; absent when the file sits directly in the base.
      const dir = parentDir(relPath);
      if (dir === undefined) return undefined;
      return baseDirectories.some((b) => dir.startsWith(b)) ? basename(dir) : undefined;
    }
    case "parent-or-basename": {
      // Immediate parent directory, or the task-file basename when no parent feature directory is present.
      const dir = parentDir(relPath);
      if (dir === undefined) return basename(relPath).replace(/\.[^./]+$/, "");
      const isBaseItself = baseDirectories.some((b) => dir === b.replace(/\/$/, ""));
      return isBaseItself ? basename(relPath).replace(/\.[^./]+$/, "") : basename(dir);
    }
    case "segment-after": {
      const segments = relPath.split("/");
      for (const marker of rule.markers) {
        const wanted = marker.replace(/\/$/, "");
        const at = segments.indexOf(wanted);
        if (at >= 0 && at + 1 <= segments.length - 2) return segments[at + 1];
      }
      return undefined;
    }
  }
}

/** Pure marker detection per contracts/framework-adapter.md rule 2 + research R8 rank material. */
export function detectFromConventions(c: ResolvedConventions): (candidatePath: string, ctx: DetectionContext) => DetectionMatch | null {
  return (candidatePath: string, ctx: DetectionContext): DetectionMatch | null => {
    let pathPattern: string | undefined;
    const consider = (pattern: string): void => {
      if (pathPattern === undefined || pattern.length > pathPattern.length) pathPattern = pattern;
    };
    for (const p of c.detection.pathPrefixes ?? []) if (isBeneathDirectory(candidatePath, p)) consider(p);
    for (const p of c.detection.pathContains ?? []) if (candidatePath.includes(p)) consider(p);
    const pathHit = pathPattern !== undefined;
    const siblingHit = (c.detection.siblingsAnyOf ?? []).some((n) => ctx.siblingFileNames.includes(n));
    const matched = c.detection.requirePathAndSiblings === true ? pathHit && siblingHit : pathHit || siblingHit;
    if (!matched) return null;
    if (pathPattern === undefined) return { adapterId: c.id, matchedPattern: "", via: "siblings" };
    // Rank material: base-directory patterns are "discovery hints + rank material" (data-model §3).
    for (const b of c.baseDirectories) if (isBeneathDirectory(candidatePath, b)) consider(b);
    return { adapterId: c.id, matchedPattern: pathPattern, via: siblingHit ? "path+siblings" : "path" };
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    for (const v of Object.values(value as Record<string, unknown>)) deepFreeze(v);
    Object.freeze(value);
  }
  return value;
}

export { deepFreeze };

/** Materialize an immutable FrameworkAdapter from resolved conventions (no other behavior). */
export function defineFrameworkAdapter(c: ResolvedConventions): FrameworkAdapter {
  const detect = detectFromConventions(c);
  const featureName = (relPath: string): string | undefined =>
    c.featureNameOverride ? c.featureNameOverride(relPath) : applyFeatureNameRule(c.featureNameRule, c.baseDirectories, relPath);
  return deepFreeze<FrameworkAdapter>({
    id: c.id,
    taskFilePatterns: [...c.taskFilePatterns],
    baseDirectories: [...c.baseDirectories],
    detection: c.detection,
    featureNameRule: c.featureNameRule,
    headingGrammar: c.headingGrammar,
    phasePattern: c.phasePattern,
    summaryPattern: c.summaryPattern,
    rollupPattern: c.rollupPattern,
    titleBehavior: c.titleBehavior,
    siblingDocuments: [...c.siblingDocuments],
    agentHooksDirectory: c.agentHooksDirectory,
    agentHookTemplate: c.agentHookTemplate,
    frameworkSpecificExclusions: [...c.frameworkSpecificExclusions],
    detect,
    featureName,
  });
}

/** FR-011 required parts; EVERY miss collected at once (002 fail-fast-and-complete precedent). */
export function validateCustomDescriptor(descriptor: CustomAdapterDescriptor): void {
  const missing: string[] = [];
  const record = descriptor as unknown as Record<string, unknown>;
  if (typeof descriptor.id !== "string" || descriptor.id.length === 0) missing.push("id");
  if (!Array.isArray(record.taskFilePatterns) || (descriptor.taskFilePatterns ?? []).length === 0) missing.push("taskFilePatterns");
  if (!Array.isArray(record.baseDirectories) || (descriptor.baseDirectories ?? []).length === 0) missing.push("baseDirectories");
  if (typeof descriptor.headingGrammar !== "string" || descriptor.headingGrammar.length === 0) {
    missing.push("headingGrammar");
  } else {
    try {
      new RegExp(descriptor.headingGrammar);
    } catch {
      missing.push("headingGrammar"); // invalid regex source — the failing part is named (T032)
    }
  }
  if (missing.length > 0) throw new CustomAdapterError(String(descriptor.id ?? ""), missing);
}

/** Resolve a validated custom descriptor to conventions (custom fields beat the config layer). */
export function customDescriptorConventions(descriptor: CustomAdapterDescriptor, config: ResolvedConfig): ResolvedConventions {
  const base: ResolvedConventions = {
    id: descriptor.id,
    taskFilePatterns: [...config.taskFilePatterns],
    baseDirectories: [...(descriptor.baseDirectories ?? [])],
    detection: descriptor.detection ?? { pathPrefixes: [...(descriptor.baseDirectories ?? [])] },
    featureNameRule: descriptor.featureNameRule ?? { kind: "none" },
    headingGrammar: config.headingIdGrammar,
    phasePattern: config.phasePattern,
    summaryPattern: config.summaryPattern,
    rollupPattern: config.rollupPattern,
    titleBehavior: { stripPrefixes: [...config.titleStripPrefixes] },
    siblingDocuments: [...config.siblingDocuments],
    agentHookTemplate: "none",
    frameworkSpecificExclusions: [],
  };
  const declared: AdapterConventions = {
    taskFilePatterns: [...descriptor.taskFilePatterns],
    headingGrammar: descriptor.headingGrammar,
    ...(descriptor.detection ? { detection: descriptor.detection } : {}),
    ...(descriptor.featureNameRule ? { featureNameRule: descriptor.featureNameRule } : {}),
    ...(descriptor.phasePattern !== undefined ? { phasePattern: descriptor.phasePattern } : {}),
    ...(descriptor.summaryPattern !== undefined ? { summaryPattern: descriptor.summaryPattern } : {}),
    ...(descriptor.rollupPattern !== undefined ? { rollupPattern: descriptor.rollupPattern } : {}),
    ...(descriptor.titleBehavior ? { titleBehavior: descriptor.titleBehavior } : {}),
    ...(descriptor.siblingDocuments ? { siblingDocuments: [...descriptor.siblingDocuments] } : {}),
    ...(descriptor.agentHooksDirectory !== undefined ? { agentHooksDirectory: descriptor.agentHooksDirectory } : {}),
    ...(descriptor.agentHookTemplate !== undefined ? { agentHookTemplate: descriptor.agentHookTemplate } : {}),
  };
  const merged = deepMerge(base as unknown, declared as unknown) as ResolvedConventions;
  return merged;
}

/** True when `id` collides with a built-in identity (shadowing requires the explicit opt-in flag). */
export function isShadowingBuiltInId(id: FrameworkIdentity): boolean {
  return isBuiltInFrameworkId(id);
}

/**
 * Frozen 002 FrameworkMetadata field set from a discovered file (FR-009 input; 008 persists
 * it). `localTaskId` appears post-parse in 004 — absent pre-parse by design (research R5).
 */
export function frameworkMetadataFragment(
  f: DiscoveredFile,
): Omit<FrameworkMetadata, "frameworkId"> & { frameworkId: FrameworkIdentity } {
  const meta: Omit<FrameworkMetadata, "frameworkId"> & { frameworkId: FrameworkIdentity } = {
    frameworkId: f.frameworkId,
    filePath: f.filePath,
    ...(f.featureName !== undefined ? { featureName: f.featureName } : {}),
  };
  return deepFreeze(meta);
}
