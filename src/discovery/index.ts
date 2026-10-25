/**
 * 003 Task Discovery & Framework Adapters — public barrel for the additive
 * `task-linear-sync/discovery` subpath (research R1).
 *
 * Export-surface is amendment-gated: tests/contract/discovery-surface.test.ts snapshots
 * the exact exported-name set (002 R15 precedent; contracts/README.md amendment rule).
 * Named re-exports ONLY (the snapshot test forbids `export *`) so the public surface is
 * explicit. Tiers land deliberately: foundational (T008–T012), US1 discovery (T016–T021),
 * US2 adapters/registry/conventions (T027–T034).
 */

// ── Foundational (T012): 003 records, the FROZEN adapter interface (004's seam),
//    the zero-dependency matcher, and the safe-path root primitives ──
export { DiscoveryRootError, isBuiltInFrameworkId } from "./types.js";
export type {
  DiscoveredFile,
  DiscoveryDiagnostic,
  DiscoveryOptions,
  DiscoveryResult,
  DiscoverOptions,
  FrameworkIdentity,
  GitContext,
  Refusal,
} from "./types.js";
export type {
  AdapterConventions,
  AdapterRegistry,
  CustomAdapterDescriptor,
  DetectionContext,
  DetectionMatch,
  DetectionRecord,
  FeatureNameRule,
  FrameworkAdapter,
  DiscoveryOverrides,
} from "./adapter.js";
export { compileNamePattern } from "./patterns.js";
export { canonicalizeRepositoryRoot, verifyInsideRoot } from "./root.js";

// ── US1 discovery tier (T021): the entry point, git context, registry + selection, and
//    the selection error. `createAdapterRegistry`/`selectAdapter` are DECLARED in the
//    frozen interface file (adapter.ts) and implemented in registry.ts (that file is
//    interface + types only) — the barrel exports the implementations. ──
export { discoverTaskFiles } from "./discover.js";
export { discoverGitContext } from "./git.js";
export { createAdapterRegistry, selectAdapter } from "./registry.js";
export { SelectionOverrideError } from "./adapter.js";
