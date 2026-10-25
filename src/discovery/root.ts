/**
 * Canonical root + pre-read escape guard (FR-001–FR-003; research R4;
 * contracts/discovery-api.md rules 1 + 3).
 */
import { constants as fsConstants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import { resolve, sep } from "node:path";

import { DiscoveryRootError } from "./types.js";

function isErrno(err: unknown): { code?: string } {
  return typeof err === "object" && err !== null ? (err as { code?: string }) : {};
}

/**
 * Canonicalize a supplied repository root to an absolute, link-resolved path (FR-001) and
 * run the FR-002 pre-flight: missing / not-a-directory / unreadable (R_OK probe) abort with
 * `DiscoveryRootError` naming the failing condition, BEFORE any traversal or file read.
 * Reusable by 008 plan guards.
 */
export async function canonicalizeRepositoryRoot(root: string): Promise<string> {
  const absolute = resolve(root);
  let canonical: string;
  try {
    canonical = await realpath(absolute);
  } catch (err) {
    const code = isErrno(err).code;
    if (code === "ENOENT") throw new DiscoveryRootError("missing", root);
    if (code === "ENOTDIR") throw new DiscoveryRootError("not-a-directory", root);
    // EACCES/EPERM/ELOOP/etc — the root cannot be safely observed.
    throw new DiscoveryRootError("unreadable", root);
  }
  let st;
  try {
    st = await stat(canonical);
  } catch (err) {
    const code = isErrno(err).code;
    throw new DiscoveryRootError(code === "ENOENT" ? "missing" : code === "EACCES" || code === "EPERM" ? "unreadable" : "not-a-directory", root);
  }
  if (!st.isDirectory()) throw new DiscoveryRootError("not-a-directory", root);
  try {
    await access(canonical, fsConstants.R_OK);
  } catch {
    throw new DiscoveryRootError("unreadable", root);
  }
  return canonical;
}

/** Separator-bounded containment test on already-resolved paths (research R4). */
export function isInsideCanonicalRoot(canonicalRoot: string, resolvedCandidate: string): boolean {
  return resolvedCandidate === canonicalRoot || resolvedCandidate.startsWith(canonicalRoot + sep);
}

/**
 * Pre-read containment guard (FR-003). Resolves `candidateAbsolute` via `fs.realpath` and
 * requires separator-bounded containment in the canonical root — `/work/repo-evil` does NOT
 * pass for root `/work/repo`. REQUIRED before every repository file read; exported so 004
 * (parses discovered files) and 008 (state-relevant repo reads) honor the same guard.
 * A candidate whose realpath fails (gone, unparsable) is refused, never thrown.
 */
export async function verifyInsideRoot(canonicalRoot: string, candidateAbsolute: string): Promise<boolean> {
  let resolved: string;
  try {
    resolved = await realpath(candidateAbsolute);
  } catch {
    return false;
  }
  return isInsideCanonicalRoot(canonicalRoot, resolved);
}
