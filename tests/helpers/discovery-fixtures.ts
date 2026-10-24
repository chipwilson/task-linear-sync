/**
 * T004 — runtime temp-tree fixtures for 003 discovery tests (research R12).
 *
 * Symlink loops, escaping links, and permission modes CANNOT be committed via git
 * (checkout does not transport them reliably), so adversarial trees are built at test
 * runtime under `node:os.tmpdir()` in a feature-scoped directory with guaranteed
 * cleanup. Static committed fixtures (regular files only) live under
 * `tests/fixtures/repos/discovery/`; the git-variant fixtures commit their `.git`
 * content as `_git/` (git refuses to transport `.git` path components at all) and are
 * materialized into temp trees with the real `.git` name by `withGitFixture`.
 */
import { mkdtemp, mkdir, rm, writeFile, symlink, chmod, readdir, copyFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Package root (compiled helpers live at build/tests/helpers → three levels up). */
const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** Static committed fixture repository (read-only source artifact). */
export function fixtureRepoPath(name: string): string {
  return join(pkgRoot, "tests", "fixtures", "repos", "discovery", name);
}

/** Permission/symlink-mode assertions only run on POSIX, non-root runners (002 precedent). */
export const posixOnly: boolean =
  process.platform !== "win32" &&
  !(typeof process.geteuid === "function" && process.geteuid() === 0);

/** One entry of a runtime tree spec. */
export type TreeEntry =
  | { kind: "file"; path: string; content?: string }
  | { kind: "dir"; path: string }
  /** `target` is used verbatim — relative (resolved against the link's directory) or absolute; may be dangling. */
  | { kind: "symlink"; path: string; target: string }
  /** Two mutual links a → b → a; traversal must terminate and both must be excluded. */
  | { kind: "symlink-loop"; first: string; second: string }
  /** Link whose target file is created OUTSIDE the discovery tree (sandbox-escape fixture). */
  | { kind: "escaping-symlink"; path: string; targetContent?: string }
  /** Directory made unreadable (chmod 000) AFTER its children are built; restored before cleanup. */
  | { kind: "mode-000-dir"; path: string; children?: TreeEntry[] }
  | { kind: "mode-000-file"; path: string; content?: string };

export type TreeSpec = readonly TreeEntry[];

async function applyEntry(baseDir: string, outsideDir: string, entry: TreeEntry, chmodBack: string[]): Promise<void> {
  const at = (p: string): string => join(baseDir, p);
  switch (entry.kind) {
    case "file": {
      const abs = at(entry.path);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, entry.content ?? `placeholder ${entry.path}\n`, "utf8");
      return;
    }
    case "dir": {
      await mkdir(at(entry.path), { recursive: true });
      return;
    }
    case "symlink": {
      const abs = at(entry.path);
      await mkdir(dirname(abs), { recursive: true });
      await symlink(entry.target, abs);
      return;
    }
    case "symlink-loop": {
      const a = at(entry.first);
      const b = at(entry.second);
      await mkdir(dirname(a), { recursive: true });
      await mkdir(dirname(b), { recursive: true });
      await symlink(relative(dirname(a), b), a);
      await symlink(relative(dirname(b), a), b);
      return;
    }
    case "escaping-symlink": {
      const linkPath = at(entry.path);
      const targetPath = join(outsideDir, entry.path.replaceAll("/", "_"));
      await mkdir(dirname(linkPath), { recursive: true });
      await mkdir(outsideDir, { recursive: true });
      await writeFile(targetPath, entry.targetContent ?? "outside-the-root secret material (fixture)\n", "utf8");
      await symlink(targetPath, linkPath);
      return;
    }
    case "mode-000-dir": {
      const abs = at(entry.path);
      await mkdir(abs, { recursive: true });
      for (const child of entry.children ?? []) {
        await applyEntry(abs, outsideDir, child, chmodBack);
      }
      chmodBack.push(abs);
      await chmod(abs, 0o000);
      return;
    }
    case "mode-000-file": {
      const abs = at(entry.path);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, entry.content ?? "placeholder content\n", "utf8");
      chmodBack.push(abs);
      await chmod(abs, 0o000);
      return;
    }
  }
}

/**
 * Build a temp tree from `spec` and run `fn` with its root. Guaranteed cleanup:
 * chmod-restores every mode-000 entry before recursive removal.
 */
export async function withTempTree<T>(name: string, spec: TreeSpec, fn: (treeRoot: string) => Promise<T>): Promise<T> {
  const base = await mkdtemp(join(tmpdir(), `tls-discovery-${name.replace(/[^a-zA-Z0-9-]/g, "-")}-`));
  const treeRoot = join(base, "tree");
  const outsideDir = join(base, "outside");
  const chmodBack: string[] = [];
  try {
    await mkdir(treeRoot, { recursive: true });
    for (const entry of spec) await applyEntry(treeRoot, outsideDir, entry, chmodBack);
    return await fn(treeRoot);
  } finally {
    for (const p of chmodBack) {
      await chmod(p, 0o755).catch(() => undefined);
    }
    await rm(base, { recursive: true, force: true });
  }
}

/**
 * Copy a committed fixture repository into `destRoot`, materializing the `_git/`
 * alias as a real `.git` directory (git cannot transport `.git` path components).
 */
export async function materializeGitFixture(name: string, destRoot: string): Promise<void> {
  const src = fixtureRepoPath(name);
  async function walk(from: string, to: string, atTop: boolean): Promise<void> {
    await mkdir(to, { recursive: true });
    for (const ent of await readdir(from, { withFileTypes: true })) {
      const destName = atTop && ent.isDirectory() && ent.name === "_git" ? ".git" : ent.name;
      const f = join(from, ent.name);
      const t = join(to, destName);
      if (ent.isDirectory()) await walk(f, t, false);
      else if (ent.isFile()) await copyFile(f, t);
    }
  }
  await walk(src, destRoot, true);
}

/** Materialize a git-variant fixture in a temp root and run `fn` against it. */
export async function withGitFixture<T>(name: string, fn: (repoRoot: string) => Promise<T>): Promise<T> {
  const base = await mkdtemp(join(tmpdir(), `tls-discovery-${name}-`));
  try {
    const repoRoot = join(base, "repo");
    await materializeGitFixture(name, repoRoot);
    return await fn(repoRoot);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

/** Open-observer factory for `DiscoverOptions.openCountingProbe` (SC-003 proof). */
export function openCountingProbe(): { probe: (absolutePath: string) => void; paths: string[] } {
  const paths: string[] = [];
  return { paths, probe: (absolutePath: string) => void paths.push(absolutePath) };
}

/** Sorted list of every entry path under `dir` — zero-writes posture checks. */
export async function listTree(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(d, { withFileTypes: true });
    } catch {
      return; // unreadable directory — listing is best-effort
    }
    for (const ent of entries) {
      const abs = join(d, ent.name);
      out.push(relative(dir, abs).replaceAll("\\", "/"));
      if (ent.isDirectory()) await walk(abs);
    }
  }
  await walk(dir);
  return out.sort();
}

/** Small existence guard used by specs (avoids re-importing fs everywhere). */
export async function exists(abs: string): Promise<boolean> {
  try {
    await stat(abs);
    return true;
  } catch {
    return false;
  }
}

/** Canonicalize-free path join for readability inside specs. */
export function abs(base: string, rel: string): string {
  return resolve(base, rel);
}
