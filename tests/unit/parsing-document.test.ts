/**
 * T016 [022] — pure front-matter / document-core unit tests (research R5/R6/R7;
 * contracts/spec-kitty-work-packages.md C2.1–C2.2/C3, data-model §2). RED-FIRST: the
 * module is loaded through a NON-analyzable specifier so this file compiles and every
 * assertion fails at runtime (module missing) until T017 lands.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

/** The data-model §3 row values — the rule object the module consumes. */
const RULE = {
  collectionPattern: "^kitty-specs/[^/]+/tasks/.+\\.md$",
  idKey: "work_package_id",
  titleKey: "title",
  fileNameIdPattern: "(?i)^WP(\\d+)[^/]*\\.md$",
};

const moduleSpecifier = "../../src/parsing/document.js";
const mod = (await import(moduleSpecifier).catch(() => null)) as {
  scanFrontMatter?: (lines: readonly string[]) => { scalars: Record<string, string>; closingLine: number } | null;
  deriveDocumentTask?: (
    filePath: string,
    lines: readonly string[],
    rule: typeof RULE,
  ) => { kind: string; localTaskId: string; title: string; lineNumber: number; startLine: number; endLine: number } | null;
  readableFileSlug?: (fileName: string) => string;
} | null;

function lines(content: string | string[]): string[] {
  return Array.isArray(content) ? content : content.split("\n");
}

test("document core: the module exists (T017 subject)", () => {
  assert.ok(mod, "src/parsing/document.ts must exist and export the document core");
  assert.equal(typeof mod?.scanFrontMatter, "function");
  assert.equal(typeof mod?.deriveDocumentTask, "function");
});

test("document scan: leading --- fence as FIRST non-blank line, closed by a following --- fence", () => {
  const scan = mod?.scanFrontMatter?.(
    lines(["", "---", "work_package_id: WP01", "title: Scaffold", "---", "", "# Body"]),
  );
  assert.ok(scan, "front matter recognized");
  assert.equal(scan?.closingLine, 5, "1-based line of the CLOSING fence");
  assert.deepEqual(scan?.scalars, { work_package_id: "WP01", title: "Scaffold" });
});

test("document scan: the alternative closing fence … also closes; quoted scalars are unwrapped", () => {
  const scan = mod?.scanFrontMatter?.(lines(["---", "title: 'Quoted Title'", "lane: planned", "...", "body"]));
  assert.equal(scan?.closingLine, 4);
  assert.equal(scan?.scalars?.title, "Quoted Title");
  assert.equal(scan?.scalars?.lane, "planned");
});

test("document scan: only TOP-LEVEL scalar keys are read — nested structures, lists and comments are skipped", () => {
  const scan = mod?.scanFrontMatter?.(
    lines(["---", "work_package_id: WP01", "dependencies:", "  - WP00", "subtasks:", "  - T001", "  key: indented-not-top-level", "# comment", "title: Real", "---"]),
  );
  assert.deepEqual(scan?.scalars, { work_package_id: "WP01", title: "Real" }, "flat top-level scalars only; everything else ignored by the parser");
});

test("document scan: malformed / unterminated / absent fences ⇒ NO front matter, the whole file is body (R5)", () => {
  assert.equal(mod?.scanFrontMatter?.(lines(["---", "work_package_id: WP01", "no closing fence"])), null, "unterminated");
  assert.equal(mod?.scanFrontMatter?.(lines(["# Heading", "---", "title: Nope", "---"])), null, "fence does not open on the first non-blank line");
  assert.equal(mod?.scanFrontMatter?.(lines(["plain", "document"])), null, "no fence at all");
});

test("recognition (C2.1): a non-empty front-matter idKey scalar WINS over the file-name token", () => {
  const draft = mod?.deriveDocumentTask?.(
    "kitty-specs/001-demo/tasks/other-name.md",
    lines(["---", "work_package_id: WP09", "title: From Front Matter", "---", "# Deco", "", "body"]),
    RULE,
  );
  assert.equal(draft?.localTaskId, "WP09");
});

test("recognition (C2.1): no front-matter id ⇒ the file-name WPnn token identifies the document", () => {
  const draft = mod?.deriveDocumentTask?.(
    "kitty-specs/002-x/tasks/planned/WP04-export.md",
    lines(["---", "lane: planned", "---", "", "body"]),
    RULE,
  );
  assert.equal(draft?.localTaskId, "WP04", "legacy lane sub-folder is the same collection (R12)");
});

test("recognition (C2.1): no id anywhere ⇒ zero documents; the roll-up NEVER identifies (C2.2)", () => {
  assert.equal(mod?.deriveDocumentTask?.("kitty-specs/001-demo/tasks/notes.md", lines(["---", "lane: planned", "---", "", "notes"]), RULE), null);
  assert.equal(mod?.deriveDocumentTask?.("kitty-specs/001-demo/tasks.md", lines(["# Roll-up", "", "- [ ] T001 index fragment"]), RULE), null, "the roll-up is not in the collection — no task, no error");
});

test("WP-id normalization (R7): wp01-foo.md → WP01; a front-matter id normalizes the same way", () => {
  const draft = mod?.deriveDocumentTask?.("kitty-specs/001-demo/tasks/wp01-foo.md", lines(["body"]), RULE);
  assert.equal(draft?.localTaskId, "WP01", "case-insensitive token, canonical upper-case WP + digits");
  const fm = mod?.deriveDocumentTask?.("kitty-specs/001-demo/tasks/whatever.md", lines(["---", "work_package_id: wp7", "---", "body"]), RULE);
  assert.equal(fm?.localTaskId, "WP7");
});

test("title cascade (C3.1, verbatim): front-matter title → body's leading ATX heading text → readable file-name slug", () => {
  const fromFm = mod?.deriveDocumentTask?.(
    "kitty-specs/001-demo/tasks/WP01-release-validation-tooling.md",
    lines(["---", "work_package_id: WP01", "title: Release Validation Tooling", "---", "", "# WP01 — Release Validation Tooling (decorative)", "", "body"]),
    RULE,
  );
  assert.equal(fromFm?.title, "Release Validation Tooling", "front-matter title beats the decorative heading");

  const fromHeading = mod?.deriveDocumentTask?.(
    "kitty-specs/001-demo/tasks/WP02-x.md",
    lines(["---", "work_package_id: WP02", "---", "", "## The Leading Heading", "", "body"]),
    RULE,
  );
  assert.equal(fromHeading?.title, "The Leading Heading", "no front-matter title ⇒ body's leading ATX heading text (any level)");

  const fromSlug = mod?.deriveDocumentTask?.("kitty-specs/001-demo/tasks/WP01-release-validation-tooling.md", lines(["body"]), RULE);
  assert.equal(fromSlug?.title, "Release Validation Tooling", "no front matter, no heading ⇒ readable slug: identifier token stripped, -/_ → spaces, whitespace collapsed");
});

test("title cascade: front-matter text NEVER appears in a title; slug keeps no identifier token", () => {
  const fromSlug = mod?.deriveDocumentTask?.("kitty-specs/001-demo/tasks/WP03-no-title.md", lines(["- plain body, no heading"]), RULE);
  assert.equal(fromSlug?.title, "No Title", "WP03 token stripped, separators to spaces");
  assert.ok(!String(fromSlug?.title).includes("WP03"));
  assert.equal(mod?.readableFileSlug?.("WP01-release_validation__tooling"), "Release Validation Tooling", "- and _ both separate words; whitespace collapses");
});

test("body extent (R11): first body line..last line, front matter excluded, leading heading INCLUDED", () => {
  const doc = lines(["", "---", "work_package_id: WP01", "title: T", "---", "", "# WP01 — T", "", "body text"]);
  const draft = mod?.deriveDocumentTask?.("kitty-specs/001-demo/tasks/WP01-a.md", lines(doc), RULE);
  assert.equal(draft?.kind, "document");
  assert.equal(draft?.lineNumber, 7, "first BODY line (skipping the blank after the fence) is the task's own line");
  assert.equal(draft?.startLine, 7, "extent is INCLUSIVE of the leading heading line");
  assert.equal(draft?.endLine, 9);
});

test("body extent: a front-matter-only document has an EMPTY body (startLine > endLine ⇒ empty mirrored content)", () => {
  const draft = mod?.deriveDocumentTask?.("kitty-specs/001-demo/tasks/front-matter-only.md", lines(["---", "work_package_id: WP02", "title: Empty Body", "---", ""]), RULE);
  assert.ok(draft, "still exactly one document");
  assert.equal(draft?.localTaskId, "WP02");
  assert.ok((draft?.startLine ?? 0) > (draft?.endLine ?? 0), "empty extent: startLine past endLine");
});

test("collection gate: a file OUTSIDE the collection never becomes a document, even with perfect front matter", () => {
  const draft = mod?.deriveDocumentTask?.(
    "kitty-specs/001-demo/tasks.md",
    lines(["---", "work_package_id: WP01", "title: Smuggled", "---", "", "# Smuggled"]),
    RULE,
  );
  assert.equal(draft, null, "collectionPattern is the FIRST gate — the roll-up yields zero tasks in ALL cases (FR-005/C2.2)");
});

test("document core is pure and deterministic: identical inputs produce deep-equal drafts", () => {
  const content = lines(["---", "work_package_id: WP01", "title: Deterministic", "---", "", "# Deterministic", "", "body"]);
  const first = mod?.deriveDocumentTask?.("kitty-specs/001-demo/tasks/WP01-d.md", content, RULE);
  const second = mod?.deriveDocumentTask?.("kitty-specs/001-demo/tasks/WP01-d.md", content, RULE);
  assert.deepEqual(second, first);
});
