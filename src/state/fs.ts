/**
 * Owner-only, atomic state writes (research R7). A SINGLE primitive used by every state
 * write: directories 0o700 (every created level), files via sibling temp + chmod 0o600 +
 * rename (same filesystem ⇒ atomic replace), permissions re-applied post-rename in case
 * umask interfered. Readers reject non-object roots.
 */
import { chmodSync, mkdirSync, renameSync, rmSync, statSync, writeFileSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";

import { canonicalJson } from "../domain/plan.js";

/** Raised when a state JSON file is unreadable or has a non-object root. */
export class StateFileError extends Error {
  override readonly name = "StateFileError";
}

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

function isDirectoryMissing(p: string): boolean {
  try {
    statSync(p);
    return false;
  } catch {
    return true;
  }
}

/**
 * Create `dir` and every missing ancestor with mode 0o700; chmod applies regardless of
 * umask, so "recursive creation applies it to every created level" holds verbatim.
 * Idempotent; an existing directory gets its mode enforced.
 */
export function ensurePrivateDir(dir: string): void {
  const target = resolve(dir);
  // Collect the missing chain, then create from the shallowest level so EVERY created
  // level gets mode 0o700 (mkdir's own mode is umask-filtered; chmod enforces it).
  const missing: string[] = [];
  let cursor = target;
  while (isDirectoryMissing(cursor)) {
    missing.push(cursor);
    const parent = dirname(cursor);
    if (parent === cursor) break; // filesystem root
    cursor = parent;
  }
  for (const level of missing.reverse()) {
    try {
      mkdirSync(level, { mode: DIR_MODE });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; // lost a creation race: fine
    }
    try {
      chmodSync(level, DIR_MODE);
    } catch {
      /* platform without POSIX permissions (Windows): ACL inheritance applies — best effort */
    }
  }
  // Enforce the mode on the target itself too (covers a pre-existing directory whose mode
  // drifted — idempotent re-creation re-secures it).
  try {
    chmodSync(target, DIR_MODE);
  } catch {
    /* Windows: ignore */
  }
}

/**
 * Atomic, owner-only JSON write: serialize deterministically (sorted keys), write to a
 * sibling temp file in the same directory, chmod 0o600, rename over the target, re-apply
 * 0o600 post-rename.
 */
export function atomicWriteJson(filePath: string, value: unknown): void {
  atomicWriteText(filePath, canonicalJson(value));
}

/** Atomic, owner-only text write with the same temp+rename discipline as atomicWriteJson. */
export function atomicWriteText(filePath: string, text: string): void {
  const target = resolve(filePath);
  const dir = dirname(target);
  ensurePrivateDir(dir);
  const tmp = `${dir}/.tmp-${randomBytes(6).toString("hex")}-${target.startsWith(dir) ? "" : "x"}${baseName(target)}`;
  try {
    writeFileSync(tmp, text, { mode: FILE_MODE });
    try {
      chmodSync(tmp, FILE_MODE); // umask-independent
    } catch {
      /* Windows: ignore */
    }
    renameSync(tmp, target);
    try {
      chmodSync(target, FILE_MODE); // re-applied post-rename (R7)
    } catch {
      /* Windows: ignore */
    }
  } catch (e) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* best effort */
    }
    throw e;
  }
}

function baseName(p: string): string {
  const base = p.slice(dirname(p).length);
  return base.replace(/^[/\\]+/, "").replace(/[/\\]/g, "_") || "file";
}

/**
 * Read a state JSON file; null for absent. Non-object roots are REJECTED (readers go
 * through JSON codecs that reject non-object roots — R7).
 */
export function readJsonFile<T>(filePath: string): T | null {
  let text: string;
  try {
    text = readFileSync(filePath, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new StateFileError(`cannot read state file '${filePath}': ${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new StateFileError(`state file '${filePath}' is not valid JSON: ${(e as Error).message}`);
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new StateFileError(`state file '${filePath}' root must be a JSON object`);
  }
  return parsed as T;
}
