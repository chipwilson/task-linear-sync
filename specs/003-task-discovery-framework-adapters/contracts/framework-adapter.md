# Contract: Framework Adapter Interface & Conventions

Module: `src/discovery/adapter.ts` (interface + types), `src/discovery/adapters/*.ts` (built-ins),
`src/discovery/registry.ts` (selection), `src/discovery/conventions.ts` (merge),
`src/discovery/agent-hooks.ts`. Selection algorithm: [../research.md](../research.md) R7–R9,
R11; fields: [../data-model.md](../data-model.md) §3–§6. **This interface is frozen for feature
004** — 004 imports `FrameworkAdapter` and the built-in `generic` adapter from
`task-linear-sync/discovery` and never touches discovery internals or individual adapter files.

```ts
import type { FrameworkId, FrameworkMetadata } from "task-linear-sync/domain"; // frozen 002 — consumed, never redefined

/**
 * Identity vocabulary (003-local, research R5). Built-in adapters use ONLY the five frozen
 * FrameworkId literals, so every built-in value is assignable to 002's TaskFile.frameworkId /
 * FrameworkMetadata.frameworkId. Custom adapter ids (FR-011) are additional strings; the 002
 * union itself is unchanged (widening it is an amendment candidate, not executed here).
 */
export type FrameworkIdentity = FrameworkId | (string & Record<never, never>);
export function isBuiltInFrameworkId(value: string): value is FrameworkId;

/** Directory context handed to detect()/featureName() — non-symlink regular-file basenames in the task file's directory. */
export interface DetectionContext {
  readonly repoRelativePosixPath: string;         // e.g. ".kiro/specs/auth/tasks.md"
  readonly siblingFileNames: readonly string[];   // basenames present in the same dir (missing siblings absent)
  readonly specsBaseDirectories: readonly string[]; // from ResolvedConfig (frozen)
}

/** A single adapter's declarative match for a path (+ optional sibling markers). */
export interface DetectionMatch {
  readonly adapterId: string;
  readonly matchedPattern: string;   // the literal path/base-dir pattern or sibling name that matched; its length is the rank key (research R8)
  readonly via: "path" | "path+siblings" | "siblings";
}

/** Declarative Feature_Name extraction (research R9). */
export type FeatureNameRule =
  | { readonly kind: "parent-dir" }                       // immediate parent beneath a base dir (kiro, spec-kit)
  | { readonly kind: "parent-or-basename" }               // bmad
  | { readonly kind: "segment-after"; readonly markers: readonly string[] } // open-spec: ["openspec/","changes/","specs/"]
  | { readonly kind: "none" };

/**
 * Per-framework convention bundle — the 003 realization of 002 data-model §3's member list
 * ("003 implements, 004 consumes the interface only"). All fields overridable via
 * AdapterOverrides (research R7). Grammars are regex SOURCE strings (compiled lazily); 003 does
 * not parse task content — 004 consumes these sources.
 */
export interface FrameworkAdapter {
  readonly id: FrameworkIdentity;
  readonly taskFilePatterns: readonly string[];         // basename globs (research R2)
  readonly baseDirectories: readonly string[];          // repo-root-relative POSIX, e.g. ".kiro/specs/"
  readonly detection: {
    readonly pathPrefixes?: readonly string[];          // POSIX path startsWith any
    readonly pathContains?: readonly string[];          // path substring any (e.g. "openspec/")
    readonly siblingsAnyOf?: readonly string[];         // sibling basename any (e.g. "prd.md")
    readonly requirePathAndSiblings?: boolean;          // spec-kit: path AND sibling must match (001 R7.2)
  };
  readonly featureNameRule: FeatureNameRule;
  readonly headingGrammar: string;                      // regex source (consumed by 004)
  readonly phasePattern?: string;
  readonly summaryPattern?: string;
  readonly rollupPattern?: string;
  readonly titleBehavior?: { readonly stripPrefixes: readonly string[] }; // consumed by 005
  readonly siblingDocuments: readonly string[];         // configured sibling doc names (001 R7.5)
  readonly agentHooksDirectory?: string;                // e.g. ".kiro/hooks/"
  readonly agentHookTemplate?: "kiro-json" | "command-json" | "none"; // research R11
  readonly frameworkSpecificExclusions?: readonly string[]; // MUST be empty for "generic" (FR-010)

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
  readonly candidates: readonly string[];               // adapter ids that matched, sorted alphabetically
}

/**
 * Selection (data-model §4). Rank: (1) longest matchedPattern, (2) index in precedence list,
 * (3) alphabetical. Precedence default = ["kiro","open-spec","spec-kit","bmad","generic"] — the
 * spec's fixed marker precedence, overridable via overrides.precedence. Zero matches → generic
 * (via: "fallback"). overrides.selection short-circuits (via: "explicit").
 */
export function selectAdapter(
  filePath: string, ctx: DetectionContext, registry: AdapterRegistry,
): DetectionRecord;

export interface AdapterRegistry {
  readonly enabledAdapters: readonly FrameworkAdapter[];
  readonly precedence: readonly string[];
  readonly selectionOverride?: FrameworkIdentity | ((fp: string, c: DetectionContext) => FrameworkIdentity | undefined);
  readonly config: import("task-linear-sync/config").ResolvedConfig; // frozen; read-only
}

/**
 * Build the registry from the frozen config + optional programmatic overrides (highest
 * precedence layer, research R7). Adds custom adapters (validated: id + path/base-dir patterns
 * + heading grammar; missing any → CustomAdapterError listing every miss). Applies per-adapter
 * convention overrides (deep-merged, arrays replace).
 */
export function createAdapterRegistry(
  config: import("task-linear-sync/config").ResolvedConfig,
  overrides?: DiscoveryOverrides,
): AdapterRegistry;   // throws CustomAdapterError

/** FR-011 minimal custom adapter: at least id, path/base-directory patterns, heading grammar. */
export interface CustomAdapterDescriptor {
  readonly id: FrameworkIdentity;                       // non-empty; not a built-in id (data-model §5)
  readonly taskFilePatterns: readonly string[];
  readonly baseDirectories: readonly string[];
  readonly headingGrammar: string;                      // regex source (required minimum)
  readonly detection?: FrameworkAdapter["detection"];   // default: pathPrefixes/baseDirectories-derived
  readonly featureNameRule?: FeatureNameRule;           // default: { kind: "none" }
  readonly phasePattern?: string; readonly summaryPattern?: string; readonly rollupPattern?: string;
  readonly titleBehavior?: { readonly stripPrefixes: readonly string[] };
  readonly siblingDocuments?: readonly string[];
  readonly agentHooksDirectory?: string; readonly agentHookTemplate?: "kiro-json" | "command-json" | "none";
}

export interface AdapterConventions {   // FR-011 overridable-convention subset for a known adapter
  readonly taskFilePatterns?: readonly string[];
  readonly baseDirectories?: readonly string[];
  readonly detection?: Partial<FrameworkAdapter["detection"]>;
  readonly headingGrammar?: string; readonly phasePattern?: string;
  readonly summaryPattern?: string; readonly rollupPattern?: string;
  readonly titleBehavior?: { readonly stripPrefixes: readonly string[] };
  readonly siblingDocuments?: readonly string[];
  readonly featureNameRule?: FeatureNameRule;
  readonly agentHooksDirectory?: string; readonly agentHookTemplate?: "kiro-json" | "command-json" | "none";
}

/** Programmatic override layer (highest precedence, research R7). */
export interface DiscoveryOverrides {
  readonly selection?: FrameworkIdentity | ((fp: string, c: DetectionContext) => FrameworkIdentity | undefined);
  readonly precedence?: readonly string[];                     // override adapter precedence (FR-011)
  readonly adapters?: Readonly<Record<string, AdapterConventions>>; // per-known-adapter convention overrides
  readonly customAdapters?: readonly CustomAdapterDescriptor[];      // FR-011 custom adapters
}

export class CustomAdapterError extends Error {
  readonly adapterId: string;
  readonly missing: readonly string[];   // e.g. ["taskFilePatterns","headingGrammar"] — every miss at once (002 precedent)
}

/** Built-in adapter table (defaults layer, FR-007). Exported for 004's generic fixture + tests. */
export const builtInAdapters: Readonly<Record<FrameworkId, FrameworkAdapter>>;
//   .kiro:      baseDirectories [".kiro/specs/"], tasks.md, Feature=parent-dir, siblings [requirements.md, design.md],
//               agentHooksDirectory ".kiro/hooks/", agentHookTemplate "kiro-json"   (001 R7.5, FR-010)
//   .spec-kit:  baseDirectories ["specs/","spec/"], tasks.md, Feature=parent-dir,
//               siblings [spec.md, plan.md, requirements.md]; detect: pathPrefix AND sibling(spec.md|plan.md)  (001 R7.2)
//   .open-spec: baseDirectories ["openspec/","open-spec/"], tasks.md,
//               Feature=segment-after ["openspec/","changes/","specs/"], siblings [spec.md, proposal.md, tasks.md],
//               detect: pathContains("openspec/"|"open-spec/") OR sibling(openspec.json|proposal.md)
//   .bmad:      baseDirectories ["bmad/","bmad-method/","docs/"], tasks.md, Feature=parent-or-basename,
//               siblings [requirements.md, design.md, architecture.md, prd.md, spec.md],
//               detect: pathContains("bmad/"|"bmad-method/") OR sibling(prd.md|architecture.md)
//   .generic:   baseDirectories from config.specsBaseDirectories, tasks.md, Feature=parent-dir-if-under-base,
//               broad heading grammar; frameworkSpecificExclusions: [] (FR-010: "no framework-specific exclusions
//               beyond the global summary/rollup defaults"); agentHooksDirectory ".task-linear-sync/hooks/"

/** Kiro/generic agent-hook scaffold record for 010 (FR-007, FR-010). Pure — writes nothing (research R11). */
export function agentHookScaffold(
  frameworkId: FrameworkIdentity, binName: string,
): { readonly directory: string; readonly fileName: string; readonly contents: string } | undefined;
//   kiro (template "kiro-json")  -> { directory: ".kiro/hooks/", fileName: `<toolId>-sync.json`,
//               contents: JSON Agent_Hook whose `command` action runs `<binName> enqueue` }  (001 Glossary Agent_Hook)
//   generic ("command-json")     -> { directory: ".task-linear-sync/hooks/", fileName: `<toolId>-sync.json`,
//               contents: same `command`-action enqueue record }  (001 Glossary Agent_Hooks_Directory)
//   others ("none"/absent)       -> undefined. Zero org literals (binName derives from toolId).

/**
 * Convenience: build the frozen 002 FrameworkMetadata field set from a discovered file
 * (FR-009 input; 008 persists it). For built-in adapters the result is exactly assignable to
 * FrameworkMetadata; custom-adapter ids pass through as strings at runtime (payload JSON is
 * type-independent) — the type-level union widening is the amendment candidate of research R5.
 */
export function frameworkMetadataFragment(
  f: import("./types.js").DiscoveredFile,
): Omit<FrameworkMetadata, "frameworkId"> & { frameworkId: FrameworkIdentity };
```

## Behavior rules (normative)

1. **Determinism (Principle IV / FR-008)**: `detect`, `featureName`, and `selectAdapter` are pure
   functions of `(path, DetectionContext, registry)`. Given identical inputs, selection is
   byte-identical across runs (SC-002 for selection ordering). Rank keys are fixed in
   [data-model.md](../data-model.md) §4 — never wall-clock, env, or readdir order.
2. **Marker-based precedence (FR-008)**: automatic selection infers `kiro` beneath `.kiro/`;
   `open-spec` where the path contains `openspec/`/`open-spec/` or sibling `openspec.json`/
   `proposal.md`; `spec-kit` where the path is beneath `specs/`/`spec/` **and** sibling
   `spec.md`/`plan.md` present; `bmad` where the path contains `bmad/`/`bmad-method/` or sibling
   `prd.md`/`architecture.md`; else `generic` (001 R7.2). Multiple matches resolve by longest
   `matchedPattern` → precedence index → alphabetical (FR-008 verbatim).
3. **Generic purity (FR-010)**: when `generic` is selected, no framework-specific exclusions
   apply beyond the global summary/rollup defaults — `frameworkSpecificExclusions` is `[]` and
   downstream (004) MUST read that empty set rather than any framework list.
4. **Kiro compatibility (FR-010)**: `.kiro/specs/*/tasks.md` is discovered, `Feature_Name` is the
   Kiro feature directory, and `.kiro/hooks/` scaffold support is advertised via
   `agentHookTemplate: "kiro-json"`.
5. **Total overridability (FR-011 / SC-004)**: every convention in `FrameworkAdapter` —
   selection, precedence, task-file patterns, base directories, detection markers, heading/phase/
   summary/rollup grammars, `Feature_Name` rule, title strip prefixes, sibling documents, agent-
   hook directory/template — is overridable through `DiscoveryOverrides` (or the frozen config
   keys), and a `CustomAdapterDescriptor` supplying at least `id`, `taskFilePatterns`+
   `baseDirectories`, and `headingGrammar` is accepted; an incomplete descriptor aborts with
   `CustomAdapterError` naming **every** missing required part.
6. **No org literals (constitution III / "No organization-specific literals")**: adapter
   directory names (`.kiro/specs/`, `specs/`, `openspec/`, `bmad/`) are "generic discovery
   defaults", never routing values, and adapters carry zero real organization identifiers, team
   keys, project identifiers, workflow-state identifiers, tokens, or UUIDs (001 R7.8).
7. **Read-only**: no adapter function or the registry performs I/O or writes; `DetectionContext`
   is supplied by the discovery caller (research R9), keeping 003's file access confined to the
   canonical root (contract [discovery-api.md](./discovery-api.md)).

## Test obligations (mapped in quickstart)

- **Selection matrix** (unit, `tests/unit/discovery-selection.test.ts`): a fixture tree with
  competing markers asserts every rank rule — kiro-beats-all under `.kiro/`; `.kiro/specs/`
  (12 chars) beating a `specs/` substring; spec-kit requires BOTH path and sibling (a `specs/`
  file with no `spec.md`/`plan.md` sibling falls through to generic); open-spec `pathContains`
  vs bmad sibling; alphabetical tie-break on equal length; explicit-selection and precedence-list
  overrides; zero-match generic fallback (FR-008, US2 AC1, SC-004).
- **Generic purity + Kiro** (unit, `tests/unit/discovery-adapters-builtin.test.ts`): generic
  `frameworkSpecificExclusions.length === 0`; kiro `Feature_Name` = feature dir, `agentHookTemplate
  === "kiro-json"`, `agentHooksDirectory === ".kiro/hooks/"` (FR-010, US2 AC2/AC3).
- **Override matrix** (unit, `tests/unit/discovery-overrides.test.ts`): each convention overridden
  at least once and the override observed to win (SC-004).
- **Custom-adapter validation** (contract, `tests/contract/adapter-contract.test.ts`): a minimal
  `{id, taskFilePatterns, baseDirectories, headingGrammar}` custom adapter is accepted and
  selectable; incomplete descriptors abort listing every miss (FR-011).
- **Surface snapshot**: `builtInAdapters` keys === the five frozen `FrameworkId`s; the exported-name
  set of `src/discovery` matches the checked-in snapshot — drift is a Wave-2 build break for 004
  by design.
