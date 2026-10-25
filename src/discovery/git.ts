/**
 * File-based version-control context (FR-006; research R6; contracts/discovery-api.md
 * rule 6) — reads at most `.git/HEAD`, the resolved loose ref, `.git/packed-refs`,
 * `.git/config`, and one-level `gitdir:` indirection. No `git` binary, no `child_process`
 * (Principle I tooling posture). Never throws for availability reasons: every value is
 * individually omitted when unavailable, and `.git` source problems are recorded as
 * `DiscoveryDiagnostic`s ("unparsable-gitfile" family) instead of failing the run.
 *
 * The gitdir indirection intentionally follows a target outside the repository root —
 * that is where linked worktree git directories live (R6); reads remain bounded to the
 * fixed metadata file set above.
 */
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";

import type { DiscoveryDiagnostic, GitContext } from "./types.js";

const SHA40 = /^[0-9a-f]{40}$/;

async function readText(absPath: string, observe?: (absolutePath: string) => void): Promise<string | undefined> {
  try {
    observe?.(absPath);
    return await readFile(absPath, "utf8");
  } catch {
    return undefined;
  }
}

/** `[remote "origin"] url` value, verbatim; `undefined` when the section or url is absent. */
function parseOriginRemote(config: string): string | undefined {
  let inOrigin = false;
  for (const raw of config.split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) {
      inOrigin = /^\[remote "origin"\]$/.test(line);
      continue;
    }
    if (!inOrigin) continue;
    const match = /^url\s*=\s*(.+?)\s*$/.exec(line);
    if (match?.[1] !== undefined) return match[1];
  }
  return undefined;
}

/** Loose ref then packed-refs resolution of a symbolic HEAD ref (research R6). */
async function resolveRef(
  gitDir: string,
  refName: string,
  observe?: (absolutePath: string) => void,
): Promise<string | undefined> {
  const loose = await readText(join(gitDir, ...refName.split("/")), observe);
  if (loose !== undefined) {
    const value = loose.trim();
    if (SHA40.test(value)) return value;
    // Loose symbolic-ref indirection (rare) — bounded single hop keeps this deterministic.
    const target = /^ref:\s*(.+)$/.exec(value)?.[1]?.trim();
    if (target !== undefined) {
      const followed = (await readText(join(gitDir, ...target.split("/")), observe))?.trim();
      return followed !== undefined && SHA40.test(followed) ? followed : undefined;
    }
  }
  const packed = await readText(join(gitDir, "packed-refs"), observe);
  if (packed !== undefined) {
    for (const line of packed.split(/\r?\n/)) {
      const match = /^([0-9a-f]{40})\s+(\S+)$/.exec(line.trim());
      if (match?.[2] === refName) return match[1];
    }
  }
  return undefined;
}

/**
 * Read the git context for a canonical repository root. `observe` records every absolute
 * file open (SC-003 probe); `diagnostics` collects `.git` availability problems. The
 * exported contract signature is `discoverGitContext(canonicalRoot)` — the two extra
 * parameters are internal wiring consumed by `discoverTaskFiles` only.
 */
export async function discoverGitContext(
  canonicalRoot: string,
  observe?: (absolutePath: string) => void,
  diagnostics?: DiscoveryDiagnostic[],
): Promise<GitContext> {
  const record = (path: string, condition: string): void => {
    diagnostics?.push({ path, condition });
  };
  try {
    const dotGit = join(canonicalRoot, ".git");
    let gitDir = dotGit;
    let dotGitIsDirectory = false;
    try {
      dotGitIsDirectory = (await stat(dotGit)).isDirectory();
    } catch {
      record(".git", "git-directory-unavailable");
      return {};
    }
    if (!dotGitIsDirectory) {
      // `gitfile` with one-level `gitdir:` indirection (research R6).
      const content = await readText(dotGit, observe);
      const target = content === undefined ? undefined : /^gitdir:\s*(.+?)\s*$/m.exec(content)?.[1]?.trim();
      if (content === undefined || target === undefined) {
        record(".git", "unparsable-gitfile");
        return {};
      }
      const resolved = isAbsolute(target) ? target : resolve(canonicalRoot, target);
      const indirectIsDirectory = await stat(resolved).then((st) => st.isDirectory(), () => false);
      if (!indirectIsDirectory) {
        record(".git", "gitdir-unresolvable");
        return {};
      }
      gitDir = resolved;
    }

    const head = await readText(join(gitDir, "HEAD"), observe);
    if (head === undefined) {
      record(".git/HEAD", "unparsable-gitfile");
    } else if (SHA40.test(head.trim())) {
      // Detached HEAD → headCommit only; `branch` individually omitted (FR-006).
      return await withOrigin(gitDir, { headCommit: head.trim() }, observe);
    } else {
      const refName = /^ref:\s*(.+?)\s*$/.exec(head.trim())?.[1]?.trim();
      if (refName !== undefined && refName.startsWith("refs/heads/")) {
        const context: { headCommit?: string; branch?: string } = { branch: refName.slice("refs/heads/".length) };
        const commit = await resolveRef(gitDir, refName, observe);
        if (commit !== undefined) context.headCommit = commit;
        return await withOrigin(gitDir, context, observe);
      }
      record(".git/HEAD", "unparsable-gitfile");
    }
    return await withOrigin(gitDir, {}, observe);
  } catch {
    return {}; // Never fails the run for availability (FR-006 verbatim).
  }
}

/** Append `originRemote` when `[remote "origin"] url` exists; a missing config omits it silently. */
async function withOrigin(
  gitDir: string,
  context: { headCommit?: string; branch?: string },
  observe?: (absolutePath: string) => void,
): Promise<GitContext> {
  const config = await readText(join(gitDir, "config"), observe);
  const originRemote = config === undefined ? undefined : parseOriginRemote(config);
  // Key insertion order is fixed (headCommit, branch, originRemote) → deterministic JSON.
  const result: Record<string, string> = {};
  if (context.headCommit !== undefined) result.headCommit = context.headCommit;
  if (context.branch !== undefined) result.branch = context.branch;
  if (originRemote !== undefined) result.originRemote = originRemote;
  return result;
}
