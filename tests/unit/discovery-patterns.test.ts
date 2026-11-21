/**
 * T005 [Foundational] — glob-matcher unit tests (research R2, contracts/discovery-api.md
 * rule 2): exact basenames, case sensitivity, `*` (never crossing `/`), `?` single char,
 * `[abc]`/`[a-z]`/`[!x]` classes. Task-file patterns match the file BASENAME; skip-directory
 * patterns match the directory NAME (at any depth — traversal applies the matcher per name).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import * as discovery from "task-linear-sync/discovery";
import { compileNamePattern } from "task-linear-sync/discovery";

/**
 * A-022-1 (022) — the path-glob compiler under test. Resolved through the namespace so
 * the red-first run fails AT RUNTIME inside the assertions below while every existing
 * test still compiles and runs (Principle VI observation requirement).
 */
const compilePathPattern = (discovery as Record<string, unknown>)["compilePathPattern"] as
  | ((pattern: string) => (relPath: string) => boolean)
  | undefined;

test("discovery patterns: exact basename 'tasks.md' matches only itself", () => {
  const m = compileNamePattern("tasks.md");
  assert.equal(m("tasks.md"), true);
  assert.equal(m("TASKS.md"), false, "matching is case-sensitive");
  assert.equal(m("tasks.mdx"), false, "anchored — no trailing material");
  assert.equal(m("xtasks.md"), false, "anchored — no leading material");
  assert.equal(m("a/tasks.md"), false, "basenames only — pattern never crosses '/'");
});

test("discovery patterns: 'TASKS.md' matches itself only (frozen default pair is case-distinct)", () => {
  const m = compileNamePattern("TASKS.md");
  assert.equal(m("TASKS.md"), true);
  assert.equal(m("tasks.md"), false);
});

test("discovery patterns: literal dot is not a regex wildcard", () => {
  const m = compileNamePattern("tasks.md");
  assert.equal(m("tasksXmd"), false, "'.' must be escaped");
});

test("discovery patterns: '*' matches any run of characters, never crossing '/'", () => {
  const m = compileNamePattern("TODO-*.md");
  assert.equal(m("TODO-1.md"), true);
  assert.equal(m("TODO-anything-else.md"), true);
  const star = compileNamePattern("*");
  assert.equal(star("anything"), true);
  assert.equal(star("a/b"), false, "`*` never crosses a '/' separator");
});

test("discovery patterns: '?' matches exactly one character", () => {
  const m = compileNamePattern("task?.md");
  assert.equal(m("tasks.md"), true);
  assert.equal(m("task1.md"), true);
  assert.equal(m("task.md"), false, "zero characters is not one");
  assert.equal(m("taskss.md"), false, "two characters is not one");
  assert.equal(compileNamePattern("a?b")("a/b"), false, "'?' never matches '/'");
});

test("discovery patterns: [abc] and [a-z] classes", () => {
  assert.equal(compileNamePattern("task[0-9].md")("task1.md"), true);
  assert.equal(compileNamePattern("task[0-9].md")("taskX.md"), false);
  assert.equal(compileNamePattern("[abc]-tasks.md")("b-tasks.md"), true);
  assert.equal(compileNamePattern("[abc]-tasks.md")("d-tasks.md"), false);
});

test("discovery patterns: [!x] negated class", () => {
  const m = compileNamePattern("task[!x].md");
  assert.equal(m("task1.md"), true);
  assert.equal(m("taskx.md"), false, "negated class excludes its characters");
});

test("discovery patterns: skip-directory names match the directory NAME exactly (001 R1.3)", () => {
  // Traversal applies these matchers to a directory's name at any depth; the matcher
  // itself is an anchored whole-name match (frozen defaults are literal names).
  const skip = [".git", "node_modules", "dist", ".next", "coverage"].map((p) => compileNamePattern(p));
  const skipMatch = (name: string): boolean => skip.some((m) => m(name));
  assert.equal(skipMatch(".git"), true);
  assert.equal(skipMatch("node_modules"), true);
  assert.equal(skipMatch("coverage"), true);
  assert.equal(skipMatch("modules"), false, "name match, not substring match");
  assert.equal(skipMatch("git"), false);
  assert.equal(skipMatch("tasks.md"), false);
});

test("discovery patterns: skip globs match directory names too (override layer feeds names)", () => {
  const m = compileNamePattern("vendor*");
  assert.equal(m("vendor"), true);
  assert.equal(m("vendors"), true);
  assert.equal(m("vend"), false);
});

test("discovery patterns: matcher is reusable (compiled once per run, called many times)", () => {
  const m = compileNamePattern("tasks.md");
  for (let i = 0; i < 3; i++) assert.equal(m("tasks.md"), true, `call ${i}`);
});

// ── A-022-1 (022) — path-scoped candidate patterns (contracts/spec-kitty-work-packages.md
// C1.1): root-relative POSIX SEGMENT globs matched against the FULL relative path. `*`
// occupies exactly one path segment, `**` zero or more (segment semantics consistent with
// the 017 A-3 exclusion grammar); matching is anchored — no prefix or suffix leak. ──────

test("path patterns: the compiler exists (A-022-1 amendment member)", () => {
  assert.equal(typeof compilePathPattern, "function", "compilePathPattern must be exported");
});

test("path patterns: 'kitty-specs/*/tasks/**/*.md' matches collection documents at any depth", () => {
  assert.ok(compilePathPattern, "compiler present");
  const m = compilePathPattern("kitty-specs/*/tasks/**/*.md");
  assert.equal(m("kitty-specs/002-x/tasks/WP01-a.md"), true, "`**` = zero segments (flat layout)");
  assert.equal(m("kitty-specs/002-x/tasks/planned/WP01-a.md"), true, "legacy lane sub-folder");
  assert.equal(m("kitty-specs/002-x/tasks/planned/deep/WP01-a.md"), true, "`**` = zero or more segments");
});

test("path patterns: the collection pattern does NOT widen beyond the collection", () => {
  assert.ok(compilePathPattern, "compiler present");
  const m = compilePathPattern("kitty-specs/*/tasks/**/*.md");
  assert.equal(m("kitty-specs/002-x/tasks.md"), false, "the roll-up is not a collection document");
  assert.equal(m("kitty-specs/002-x/tasks/img.png"), false, "non-.md attachments never match");
  assert.equal(m("specs/001-x/tasks/WP01.md"), false, "rooted at kitty-specs/ — other trees never match");
  assert.equal(m("kitty-specs/002-x/tasks"), false, "a directory path is not a .md candidate");
});

test("path patterns: a single '*' occupies exactly one segment and never crosses '/'", () => {
  assert.ok(compilePathPattern, "compiler present");
  const m = compilePathPattern("kitty-specs/*/tasks.md");
  assert.equal(m("kitty-specs/001-a/tasks.md"), true);
  assert.equal(m("kitty-specs/001-a/nested/tasks.md"), false, "`*` crosses no separator");
  assert.equal(m("kitty-specs/tasks.md"), false, "`*` requires exactly one segment");
});

test("path patterns: anchored — no suffix leak and no prefix leak", () => {
  assert.ok(compilePathPattern, "compiler present");
  const m = compilePathPattern("kitty-specs/*/tasks/**/*.md");
  assert.equal(m("kitty-specs/002-x/tasks/WP01-a.md.extra"), false, "no suffix leak");
  assert.equal(m("vendor/kitty-specs/002-x/tasks/WP01-a.md"), false, "root-relative — no prefix leak");
  const exact = compilePathPattern("docs/tasks.md");
  assert.equal(exact("docs/tasks.md"), true);
  assert.equal(exact("docs/tasks.mdx"), false);
  assert.equal(exact("docs/tasks.md/../evil"), false);
});
