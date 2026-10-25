/**
 * THE discovery entry point (contracts/discovery-api.md; research D1/D3/D4) — read-only
 * orchestration: root pre-flight (FR-002, zero reads on abort) → registry construction
 * (custom-adapter validation happens before any I/O) → single escape-guarded traversal
 * (FR-003) → per-candidate selection + feature name + sibling association (FR-005/FR-009,
 * one shared lstat-filtered listing per directory, research R9) → file-based git context
 * (FR-006) → deterministically ordered result (FR-004/SC-002).
 *
 * Zero writes, zero tracker calls, zero state-directory involvement (Principle I).
 */
import { compileNamePattern } from "./patterns.js";
import { canonicalizeRepositoryRoot } from "./root.js";
import { discoverGitContext } from "./git.js";
import { createAdapterRegistry, selectAdapter } from "./registry.js";
import { skipByExclusion, traverseRepository, type WalkCandidate } from "./traverse.js";
import type {
  AdapterRegistry,
  DetectionContext,
} from "./adapter.js";
import type {
  DiscoveredFile,
  DiscoverOptions,
  DiscoveryDiagnostic,
  DiscoveryResult,
  GitContext,
} from "./types.js";

/** Union of the enabled pool's effective task-file matchers (basenames). */
function taskFileMatchers(registry: AdapterRegistry): ((name: string) => boolean)[] {
  const unique = new Set<string>();
  for (const adapter of registry.enabledAdapters) {
    for (const pattern of adapter.taskFilePatterns) unique.add(pattern);
  }
  return [...unique].map(compileNamePattern);
}

/**
 * Skip set: configured `skipDirectories` names (frozen 002 defaults) at any depth, plus
 * the enabled pool's framework-specific exclusions (empty for `generic`, FR-010).
 */
function skipDirectoryMatchers(registry: AdapterRegistry): ((dirPath: string, dirName: string) => boolean)[] {
  const matchers = registry.config.skipDirectories.map((entry) => skipByExclusion(entry));
  const exclusions = new Set<string>();
  for (const adapter of registry.enabledAdapters) {
    for (const entry of adapter.frameworkSpecificExclusions ?? []) exclusions.add(entry);
  }
  for (const entry of exclusions) matchers.push(skipByExclusion(entry));
  return matchers;
}

/** Existing configured sibling docs in the candidate's directory, in list order (FR-005).
 * The task file's OWN basename is excluded (open-spec lists `tasks.md` as a sibling doc). */
function siblingDocumentsFor(
  dir: string,
  fileName: string,
  listing: readonly string[],
  siblingDocuments: readonly string[],
): string[] {
  const present = new Set(listing);
  return siblingDocuments
    .filter((name) => name !== fileName && present.has(name))
    .map((name) => (dir === "" ? name : `${dir}/${name}`));
}

/** Fixed key insertion order keeps the serialized result byte-identical across runs. */
function toDiscoveredFile(candidate: WalkCandidate, registry: AdapterRegistry, ctx: DetectionContext): DiscoveredFile {
  const detection = selectAdapter(candidate.filePath, ctx, registry);
  const adapter = registry.enabledAdapters.find((candidateAdapter) => candidateAdapter.id === detection.adapterId);
  const featureName = adapter?.featureName(candidate.filePath);
  const siblingDocuments =
    adapter === undefined
      ? []
      : siblingDocumentsFor(
          candidate.dir,
          candidate.filePath.slice(candidate.filePath.lastIndexOf("/") + 1),
          ctx.siblingFileNames,
          adapter.siblingDocuments,
        );
  return {
    filePath: candidate.filePath,
    frameworkId: detection.frameworkId,
    adapterId: detection.adapterId,
    ...(featureName === undefined ? {} : { featureName }),
    siblingDocuments,
    detection,
  };
}

/** THE discovery entry point. Read-only: zero writes, zero tracker calls. */
export async function discoverTaskFiles(options: DiscoverOptions): Promise<DiscoveryResult> {
  // Pre-flight first: invalid roots throw BEFORE any traversal or file read (FR-002).
  const root = await canonicalizeRepositoryRoot(options.repositoryRoot);
  const registry = createAdapterRegistry(options.config, options.overrides); // validation errors precede I/O

  const walk = await traverseRepository({
    root,
    taskFileMatchers: taskFileMatchers(registry),
    skipDirectoryMatchers: skipDirectoryMatchers(registry),
    ...(options.openCountingProbe === undefined ? {} : { observe: options.openCountingProbe }),
  });

  const files: DiscoveredFile[] = [];
  for (const candidate of walk.candidates) {
    const ctx: DetectionContext = {
      repoRelativePosixPath: candidate.filePath,
      siblingFileNames: walk.regularFileNames.get(candidate.dir) ?? [],
      specsBaseDirectories: registry.config.specsBaseDirectories,
    };
    files.push(toDiscoveredFile(candidate, registry, ctx));
  }
  files.sort((a, b) => (a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0));

  const diagnostics: DiscoveryDiagnostic[] = [...walk.diagnostics];
  let git: GitContext | undefined;
  if (options.gitContext !== false) {
    // Never throws for availability reasons (FR-006); problems land in `diagnostics`.
    git = await discoverGitContext(root, options.openCountingProbe, diagnostics);
  }
  diagnostics.sort(
    (a, b) =>
      (a.path < b.path ? -1 : a.path > b.path ? 1 : 0) ||
      (a.condition < b.condition ? -1 : a.condition > b.condition ? 1 : 0),
  );

  return {
    root,
    files,
    refusals: walk.refusals,
    diagnostics,
    ...(git === undefined ? {} : { git }),
  };
}
