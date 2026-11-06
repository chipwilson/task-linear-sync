/**
 * T040 (feature 014) — SC-005/SC-006 machine checks for the promotion
 * (contracts/stability-declaration.md §1/§3; quickstart Scenario 6).
 *
 * Red until the T041/T042 promotion labels land: the `preview` grep and the
 * `Stable · effective … · promoted by feature 014` symmetry stay honest —
 * every check reads the REAL files at the repository root.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string): string => readFileSync(pkgRoot + rel, "utf8");

const SURFACE_DOC_FILES = ["README.md", "docs/agent-tools.md", "docs/history-server.md"] as const;

/** 014 path citations contain the slug preview-to-stable-hardening; they are
 * directory names, not stability labels — neutralized before the grep. */
function previewLabelLines(text: string): string[] {
  const neutral = text.split("014-preview-to-stable-hardening").join("SPEC-DIR");
  return neutral.split("\n").filter((line) => /\bpreview\b/i.test(line));
}

// ── SC-005 — no preview labels; no ghost wording in the requirements doc ──

test("stability-docs: no `preview` label survives in README or either usage doc (SC-005)", () => {
  for (const file of SURFACE_DOC_FILES) {
    assert.deepEqual(previewLabelLines(read(file)), [], `${file} still carries a preview label`);
  }
});

test("stability-docs: specs/requirements.md claims no Next.js/React and no HTTP/SSE MCP transport (SC-005)", () => {
  const text = read("specs/requirements.md");
  for (const ghost of ["Next.js", "React", "HTTP/SSE transport"]) {
    assert.equal(text.includes(ghost), false, `requirements.md still mentions ${ghost}`);
  }
});

test("stability-docs: every npm script the README mentions exists in package.json", () => {
  const scripts = new Set(Object.keys(JSON.parse(read("package.json")).scripts as Record<string, string>));
  const mentioned = [...read("README.md").matchAll(/npm run ([A-Za-z][A-Za-z0-9:_-]*)/g)].map((m) => m[1]!);
  assert.ok(mentioned.length > 0, "sanity: the README does reference npm scripts");
  for (const name of mentioned) {
    assert.ok(scripts.has(name), `README references \`npm run ${name}\` but package.json has no such script`);
  }
});

// ── FR-003 — one status everywhere ──────────────────────────────────────────

const DOC_STATUS_RE = /\*\*Status\*\*:\s*Stable · effective (\d{4}-\d{2}-\d{2}) · promoted by feature 014/;
const SPEC_STATUS_RE = /\*\*Status\*\*:\s*Stable \(promoted by feature 014, (\d{4}-\d{2}-\d{2})\)/;

test("stability-docs: both usage docs declare the identical Stable promotion status (FR-003)", () => {
  const dates: string[] = [];
  for (const file of ["docs/agent-tools.md", "docs/history-server.md"]) {
    const match = DOC_STATUS_RE.exec(read(file));
    assert.ok(match !== null, `${file} lacks "Stable · effective <date> · promoted by feature 014"`);
    dates.push(match[1]!);
  }
  assert.equal(dates[0], dates[1], "the two surfaces share one effective date");
});

test("stability-docs: spec status lines mirror the promotion; 014 reads Delivered (FR-003)", () => {
  const docDate = DOC_STATUS_RE.exec(read("docs/agent-tools.md"))?.[1];
  assert.ok(docDate !== undefined, "docs must carry the effective date first");
  for (const file of ["specs/011-sync-history-web-page/spec.md", "specs/012-ai-agent-tool-interface/spec.md"]) {
    const match = SPEC_STATUS_RE.exec(read(file));
    assert.ok(match !== null, `${file} status line must reference the 014 promotion with its date`);
    assert.equal(match[1], docDate, `${file} date must equal the docs' effective date`);
  }
  assert.match(read("specs/014-preview-to-stable-hardening/spec.md"), /\*\*Status\*\*:\s*Delivered/);
});

test("stability-docs: the README surface table shows both 011/012 rows as merged, unlabelled", () => {
  const readme = read("README.md");
  for (const row of [/Sync History web page \| ✅ merged \|/, /\| MCP server \| ✅ merged \|/]) {
    assert.match(readme, row, "surface-table row must read plain ✅ merged");
  }
});

// ── SC-006 — non-goal register: slugs, decisions, non-empty revisit triggers ──

const REQUIRED_NON_GOALS: ReadonlyArray<{ readonly doc: string; readonly slug: string }> = [
  { doc: "docs/agent-tools.md", slug: "mcp-sdk-protocol-surface" },
  { doc: "docs/agent-tools.md", slug: "mcp-tls-remote-exposure" },
  { doc: "docs/history-server.md", slug: "sse-last-event-id-resume" },
  { doc: "docs/history-server.md", slug: "history-inbound-identity-limiting" },
];

function stabilitySection(text: string): string {
  const start = text.indexOf("\n## Stability");
  assert.ok(start >= 0, "the doc must end with a ## Stability section");
  return text.slice(start);
}

test("stability-docs: every required non-goal slug is recorded with a non-empty revisit trigger (SC-006)", () => {
  for (const { doc, slug } of REQUIRED_NON_GOALS) {
    const section = stabilitySection(read(doc));
    const bullet = section
      .split(/\n\n+/)
      .find((block) => block.includes(`\`${slug}\``));
    assert.ok(bullet !== undefined, `${doc}: non-goal \`${slug}\` is missing (0 silent deferrals)`);
    assert.match(bullet, /\*\*(re-deferred|implemented)\*\*/, `${slug}: decision must be recorded`);
    const trigger = /Revisit trigger:\s*(.+)/s.exec(bullet) ?? /revisit trigger[^\n]*:\s*(.+)/si.exec(bullet);
    const triggerText = trigger === null ? "" : trigger[1]!.trim();
    assert.ok(triggerText.length > 0, `${slug}: no "Revisit trigger:" line (FR-011)`);
    assert.ok(triggerText.length >= 20, `${slug}: revisit trigger is empty or trivial`);
  }
});

test("stability-docs: each Stability section carries the five required elements in order", () => {
  for (const doc of ["docs/agent-tools.md", "docs/history-server.md"]) {
    const section = stabilitySection(read(doc));
    const needles = ["**Status**", "**Guaranteed scope**", "**Not guaranteed**", "**Explicit non-goals**", "**Deployment assumptions**"];
    const marks = needles.map((needle) => section.indexOf(needle));
    for (const [i, at] of marks.entries()) {
      assert.ok(at >= 0, `${doc}: Stability element "${needles[i]}" missing`);
      if (i > 0) assert.ok(at > marks[i - 1]!, `${doc}: Stability elements out of order at "${needles[i]}"`);
    }
    assert.match(section, /snapshots\/[a-z-]+surface\.json/, `${doc}: scope must point at the snapshot`);
  }
});
