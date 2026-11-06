/**
 * T021 — Managed git-hook installation (spec 010 FR-006..FR-008; contracts/
 * hook-installation.md §1). The managed region is the canonical marker block — byte-
 * stable across machines (SC-001: zero repository/machine paths inside), idempotent on
 * re-install, drift-repairing on the next install, and NEVER clobbering user bytes.
 * The frozen 002 hook-name vocabulary (research R10) is enforced BEFORE any write with
 * a complete offender listing. No git binary is invoked: a `.git` FILE is parsed via
 * its `gitdir:` line directly.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { isAbsolute, join, resolve as resolvePath } from "node:path";

import type { QueueOutcomeResult } from "./types.js";

/** The frozen managed vocabulary (research R10 / hook-installation.md §1 table). */
export const MANAGED_HOOK_NAMES: readonly string[] = Object.freeze([
  "applypatch-msg",
  "commit-msg",
  "fsmonitor-watchman",
  "post-update",
  "post-applypatch",
  "post-checkout",
  "post-commit",
  "post-merge",
  "post-receive",
  "post-rewrite",
  "pre-applypatch",
  "pre-commit",
  "pre-merge-commit",
  "pre-push",
  "pre-rebase",
  "pre-receive",
  "prepare-commit-msg",
  "push-to-checkout",
  "update",
]);

export interface GitHookSettings {
  readonly toolId: string;
  readonly hookNames: readonly string[];
  readonly hookScriptPrefix: string;
  /** Absolute override (queue.hooksDirectory); null ⇒ the repository's own hooks dir. */
  readonly hooksDirectory: string | null;
}

function markers(toolId: string): { readonly start: string; readonly end: string } {
  return { start: `# >>> ${toolId} managed hooks v1 >>>`, end: `# <<< ${toolId} managed hooks v1 <<<` };
}

function canonicalBlock(settings: GitHookSettings): readonly string[] {
  const m = markers(settings.toolId);
  return [
    m.start,
    `"${settings.hookScriptPrefix}" last-run 1>&2 || true`,
    `"${settings.hookScriptPrefix}" enqueue 1>&2 || true`,
    m.end,
  ];
}

/** Resolve the hooks directory; undefined when the repository has no `.git` at all. */
function resolveHooksDir(repositoryRoot: string, settings: GitHookSettings): string | undefined {
  if (settings.hooksDirectory !== null && settings.hooksDirectory !== undefined) {
    return settings.hooksDirectory; // absolute override wins (validated in config.ts)
  }
  const dotGit = join(repositoryRoot, ".git");
  let stats;
  try {
    stats = statSync(dotGit);
  } catch {
    return undefined;
  }
  if (stats.isDirectory()) return join(dotGit, "hooks");
  if (stats.isFile()) {
    // worktree/indirection layout: parse `gitdir: <path>` — no git binary involved.
    const firstLine = readFileSync(dotGit, "utf8").split(/\r?\n/, 1)[0] ?? "";
    const match = /^gitdir:\s*(.+?)\s*$/.exec(firstLine);
    if (match === null) return undefined;
    const gitdir = match[1]!;
    return join(isAbsolute(gitdir) ? gitdir : resolvePath(repositoryRoot, gitdir), "hooks");
  }
  return undefined;
}

interface HookResult {
  readonly installed: boolean;
  readonly repaired: boolean;
  readonly note?: string;
}

/** Splice the canonical block into one hook file (create / append / repair / skip). */
function installOneHook(target: string, settings: GitHookSettings): HookResult {
  const block = canonicalBlock(settings);
  if (!existsSync(target)) {
    writeFileSync(target, `#!/bin/sh\n${block.join("\n")}\n`, { mode: 0o755 });
    return { installed: true, repaired: false };
  }
  const text = readFileSync(target, "utf8");
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(eol);
  const m = markers(settings.toolId);
  const start = lines.indexOf(m.start);
  const end = lines.indexOf(m.end);
  if (start !== -1 && end !== -1 && end >= start) {
    const current = lines.slice(start, end + 1).join(eol);
    const canonical = block.join(eol);
    if (current === canonical) return { installed: true, repaired: false }; // idempotent
    const repaired = [...lines.slice(0, start), ...block, ...lines.slice(end + 1)].join(eol);
    writeFileSync(target, repaired); // drift ⇒ re-splice; head/tail bytes preserved
    return { installed: true, repaired: true, note: `restored the drifted managed block in ${target.slice(target.lastIndexOf("/") + 1)}` };
  }
  if (!text.startsWith("#!")) {
    // byte-preservation rule wins over managed content (hook-installation.md §1.3)
    return { installed: false, repaired: false, note: `skipped ${target.slice(target.lastIndexOf("/") + 1)}: existing hook file has no shebang — left byte-intact` };
  }
  // user bytes untouched; exactly one blank-line separator before the managed block
  writeFileSync(target, `${text}${eol}${block.join(eol)}${eol}`);
  return { installed: true, repaired: false };
}

/**
 * Install the managed hook set. Refusals write NOTHING (complete vocabulary listing up
 * front); partial successes list every per-file note in ONE sanitized detail line.
 */
export async function installGitHooks(
  repositoryRoot: string,
  settings: GitHookSettings,
): Promise<QueueOutcomeResult> {
  // 1. Vocabulary gate BEFORE any write — every offender named at once.
  const offenders = settings.hookNames.filter((name) => !MANAGED_HOOK_NAMES.includes(name));
  if (offenders.length > 0) {
    return {
      status: "refused",
      detail: `unknown git hook name(s): ${offenders.join(", ")} — the managed vocabulary is: ${MANAGED_HOOK_NAMES.join(", ")}`,
    };
  }
  if (settings.hookNames.length === 0) {
    return { status: "skipped", detail: "no managed git hooks configured (managedGitHooks is empty) — nothing to install" };
  }

  // 2. Hooks directory resolution (`.git` dir | `gitdir:` file | absolute override).
  const hooksDir = resolveHooksDir(repositoryRoot, settings);
  if (hooksDir === undefined) {
    return {
      status: "refused",
      detail: `${repositoryRoot} is not a git repository — no .git directory (or gitdir: file) found; cannot locate the hooks directory`,
    };
  }

  const notes: string[] = [];
  const installed: string[] = [];
  try {
    mkdirSync(hooksDir, { recursive: true });
    for (const name of settings.hookNames) {
      const result = installOneHook(join(hooksDir, name), settings);
      if (result.installed) installed.push(name);
      if (result.note !== undefined) notes.push(result.note);
    }
  } catch (error) {
    return {
      status: "refused",
      detail: `could not write hooks into ${hooksDir}: ${(error as Error).message}`,
    };
  }

  if (installed.length === 0 && notes.length > 0) {
    return { status: "refused", detail: notes.join("; ") };
  }
  return notes.length > 0
    ? { status: "installed", installed, detail: notes.join("; ") }
    : { status: "installed", installed };
}
