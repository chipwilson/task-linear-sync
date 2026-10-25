/**
 * Escape-guarded traversal (FR-001–FR-003; contracts/discovery-api.md rules 2, 3, 7;
 * research R3/R4/R10) — one POSIX-sorted single-pass `opendir` walk at unlimited depth.
 *
 * Posture: skip configured skip-directory NAMES at any depth without descending; symlinked
 * files and directories are silently excluded and never traversed (an escaping symlink —
 * realpath resolves outside the canonical root — is instead refused with `reason: "escape"`,
 * no read performed); only regular files match, on BASENAME; every opened directory is
 * verified inside the canonical root BEFORE its contents are read and observed through the
 * open-counting probe (SC-003). Non-root failures become diagnostics; the walk continues.
 */
import { type Dirent } from "node:fs";
import { lstat, readdir, realpath } from "node:fs/promises";
import { join } from "node:path";

import { isInsideCanonicalRoot, verifyInsideRoot } from "./root.js";
import type { DiscoveryDiagnostic, Refusal } from "./types.js";

/** Candidate task file found by the walk (root-relative POSIX). */
export interface WalkCandidate {
  readonly filePath: string;
  /** Root-relative POSIX directory containing the file ("" = root). */
  readonly dir: string;
}

export interface TraversalInput {
  /** Canonical absolute root (pre-flight already passed). */
  readonly root: string;
  /** Effective task-file matchers over file BASENAMES (union over enabled adapters). */
  readonly taskFileMatchers: readonly ((name: string) => boolean)[];
  /** Skip predicates over (root-relative directory path, directory NAME). */
  readonly skipDirectoryMatchers: readonly ((dirPath: string, dirName: string) => boolean)[];
  /** Open observer for every directory opened (SC-003 proof, research R12). */
  readonly observe?: (absolutePath: string) => void;
}

export interface TraversalOutput {
  readonly candidates: readonly WalkCandidate[];
  /** dir relPath → non-symlink regular-file basenames (ONE shared listing per dir, R9). */
  readonly regularFileNames: ReadonlyMap<string, readonly string[]>;
  /** Escapes refused pre-read, sorted by path. */
  readonly refusals: readonly Refusal[];
  /** Non-root partial failures, sorted by path then condition. */
  readonly diagnostics: readonly DiscoveryDiagnostic[];
}

function compareByPath(a: { path: string }, b: { path: string }): number {
  return a.path < b.path ? -1 : a.path > b.path ? 1 : 0;
}

/**
 * Single-pass walk collecting task-file candidates with their shared per-directory
 * listings; escapes become refusals, unreadable subdirectories diagnostics (R10).
 */
export async function traverseRepository(input: TraversalInput): Promise<TraversalOutput> {
  const { root, taskFileMatchers, skipDirectoryMatchers, observe } = input;
  const candidates: WalkCandidate[] = [];
  const regularFileNames = new Map<string, string[]>();
  const refusals: Refusal[] = [];
  const diagnostics: DiscoveryDiagnostic[] = [];

  async function classifySymlink(relPath: string): Promise<void> {
    // Defense-in-depth (FR-003): a symlink resolving OUTSIDE the root is refused with no
    // read; in-root and dangling symlinks are routine silent exclusions (001 R1.4).
    try {
      const target = await realpath(join(root, ...relPath.split("/")));
      if (!isInsideCanonicalRoot(root, target)) refusals.push({ path: relPath, reason: "escape" });
    } catch {
      /* dangling — nothing to read, nothing to refuse */
    }
  }

  async function walkDir(relDir: string): Promise<void> {
    const dirAbs = relDir === "" ? root : join(root, ...relDir.split("/"));
    if (!(await verifyInsideRoot(root, dirAbs))) {
      if (relDir !== "") refusals.push({ path: relDir, reason: "escape" });
      return;
    }
    let entries: Dirent[];
    try {
      observe?.(dirAbs);
      entries = await readdir(dirAbs, { withFileTypes: true });
    } catch {
      diagnostics.push({ path: relDir === "" ? "." : relDir, condition: "unreadable-directory" });
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const listing: string[] = [];
    regularFileNames.set(relDir, listing);

    for (const entry of entries) {
      const relPath = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      let isLink = entry.isSymbolicLink();
      if (!isDir && !isFile && !isLink) {
        // Unreliable d_type — classify with lstat (never follows the link).
        try {
          const st = await lstat(join(root, ...relPath.split("/")));
          isDir = st.isDirectory();
          isFile = st.isFile();
          isLink = st.isSymbolicLink();
        } catch {
          continue;
        }
      }
      if (isLink) {
        await classifySymlink(relPath);
        continue;
      }
      if (isDir) {
        if (skipDirectoryMatchers.some((matches) => matches(relPath, entry.name))) continue;
        await walkDir(relPath);
        continue;
      }
      if (!isFile) continue;
      listing.push(entry.name);
      if (taskFileMatchers.some((matches) => matches(entry.name))) {
        candidates.push({ filePath: relPath, dir: relDir });
      }
    }
  }

  await walkDir("");
  candidates.sort((a, b) => (a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0));
  return {
    candidates,
    regularFileNames,
    refusals: refusals.sort(compareByPath),
    diagnostics: diagnostics.sort((a, b) => compareByPath(a, b) || (a.condition < b.condition ? -1 : a.condition > b.condition ? 1 : 0)),
  };
}

/** Directory-skip predicate for one configured `skipDirectories` NAME entry (001 R1.3). */
export function skipByName(matchesName: (name: string) => boolean): (dirPath: string, dirName: string) => boolean {
  return (_dirPath, dirName) => matchesName(dirName);
}

/**
 * Directory-skip predicate for one framework-specific exclusion entry: an entry with a
 * `/` is a root-relative directory prefix; a bare entry is a name at any depth.
 */
export function skipByExclusion(entry: string): (dirPath: string, dirName: string) => boolean {
  if (entry.includes("/")) {
    const prefix = entry.endsWith("/") ? entry.slice(0, -1) : entry;
    return (dirPath) => dirPath === prefix || dirPath.startsWith(`${prefix}/`);
  }
  return (_dirPath, dirName) => dirName === entry;
}
