/**
 * T005 [Foundational] — glob-matcher unit tests (research R2, contracts/discovery-api.md
 * rule 2): exact basenames, case sensitivity, `*` (never crossing `/`), `?` single char,
 * `[abc]`/`[a-z]`/`[!x]` classes. Task-file patterns match the file BASENAME; skip-directory
 * patterns match the directory NAME (at any depth — traversal applies the matcher per name).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { compileNamePattern } from "task-linear-sync/discovery";

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
