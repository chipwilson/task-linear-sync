/**
 * T004/T005 [017] — the two extended adapter-consumption members:
 * `checklistIdPattern` (local-ID span on checklist lines, C3.4) and `titleTagPattern`
 * (capability-tag strip on DERIVED titles only, C3.5). Amendment 2 of
 * docs/contract-amendments.md extends the 004 member whitelist; SC-005 pins the global
 * defaults at today's behavior (members absent ⇒ unchanged byte-for-byte).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { cleanTitle, parseTaskFile, renderTaskLines } from "task-linear-sync/parsing";
import type { ParseResult, TaskFileAdapter } from "task-linear-sync/parsing";

import { genericFixtureAdapter, makeTestConfig } from "../helpers/parsing-fixtures.js";

const cfg = makeTestConfig();
const PATH = "kitty-specs/launch/tasks.md";

// Regex SOURCE literals — exact copies of the data-model.md §2 row defaults.
const KITTY_ID_SOURCE = "^(?<id>[Tt]?\\d{2,}(?:\\.\\d+)*)[ \\t]*[.:—–-]?[ \\t]+";
const KITTY_TAG_SOURCE = "\\[(?:P\\d*|US\\d+)\\]";

/** Consumer-side stand-in for the built-in `spec-kitty` row (fixture-adapter precedent). */
const kittyAdapter = {
  id: "spec-kitty",
  featureName: (p: string) => /^kitty-specs\/([^/]+)\/tasks\.md$/.exec(p)?.[1],
  headingGrammar: "(?!)",
  phasePattern: "^#{2,4}\\s+Work Package\\s+(?<phase>WP\\d+(?::\\s*[^\\n]*)?)\\s*$",
  summaryPattern:
    "^\\s{0,3}#{2,4}\\s+(?:Inputs|Prerequisites|Organization|Subtask Format|Path Conventions|Goal|Independent Test|Implementation Notes|Parallel Opportunities|Dependencies|Risks & Mitigations)\\b",
  checklistIdPattern: KITTY_ID_SOURCE,
  titleTagPattern: KITTY_TAG_SOURCE,
} satisfies TaskFileAdapter;

const MISSION = [
  "---",
  "mission: launch",
  "created: 2026-01-01",
  "---",
  "",
  "## Work Package WP01: Setup",
  "",
  "- [ ] T001 [P] Create the base scaffold",
  "- [ ] T002 [P1] Add the CLI entrypoint",
  "  - [ ] T002.1 [US2] Wire the flag parser",
  "",
  "## Inputs",
  "",
  "- [ ] the design document",
  "",
  "## Dependencies",
  "",
  "- [ ] WP01 must be complete",
  "  depends on: WP01",
  "  blocked-by: nothing",
  "  - [ ] done",
].join("\n");

function parseContent(content: string, adapter: TaskFileAdapter = kittyAdapter, filePath = PATH): ParseResult {
  return parseTaskFile(filePath, content, adapter, cfg);
}

test("parsing 017: spec-kitty conventions yield checklist-only tasks — zero heading tasks, work-package phase, template sections excluded (C3.1, C3.3, C3.6)", () => {
  const { file, exclusions } = parseContent(MISSION);
  assert.deepEqual(
    file.tasks.map((t) => [t.kind, t.lineNumber]),
    [
      ["checklist", 8],
      ["checklist", 9],
      ["checklist", 10],
    ],
    "front-matter lines and EVERY heading are document structure only; the Inputs/Dependencies checkboxes are exclusions",
  );
  assert.equal(file.featureName, "launch");
  for (const t of file.tasks) {
    assert.equal(t.phase, "WP01: Setup", "phase from the `## Work Package WP01: Setup` heading (C3.6)");
    assert.equal(t.frameworkId, "spec-kitty");
  }
  assert.deepEqual(
    exclusions.map((e) => [e.lineNumber, e.reason]),
    [
      [14, "summary-section"],
      [18, "summary-section"],
      [21, "summary-section"],
    ],
    "template sections matched by summaryPattern yield summary-section exclusions (C3.3)",
  );
});

test("parsing 017: checklistIdPattern captures the T-dash id span; raw titles keep the capability tags (C3.4, C3.5)", () => {
  const { file } = parseContent(MISSION);
  assert.deepEqual(
    file.tasks.map((t) => [t.localTaskId, t.title]),
    [
      ["T001", "[P] Create the base scaffold"],
      ["T002", "[P1] Add the CLI entrypoint"],
      ["T002.1", "[US2] Wire the flag parser"],
    ],
    "id span excluded from the stored title; tags are RAW-field content (frozen semantics)",
  );
});

test("parsing 017: bracketed issue references are never tags — ref parsed, tag kept, no tag eats the ref (C3.5)", () => {
  const line = "- [ ] T003 [SYNC-7] [P] Synced scaffold task\n";
  const { file } = parseContent(line);
  const t = file.tasks[0];
  assert.deepEqual(t?.issueRef, { key: "SYNC", number: 7 });
  assert.equal(t?.localTaskId, "T003");
  assert.equal(t?.title, "[P] Synced scaffold task", "`[SYNC-7]` is stripped as a ref by rule 6, never as a tag");
});

test("parsing 017: cleanTitle strips tags ONLY when titleTagPattern is supplied — absent keeps today byte-for-byte (SC-005)", () => {
  const base = { confirmationKey: "SYNC", titleStripPrefixes: [] as string[] };
  assert.equal(
    cleanTitle("[P] Create [P2] the scaffold", { ...base, titleTagPattern: KITTY_TAG_SOURCE }),
    "Create the scaffold",
    "tags collapse to single spaces and the result is trimmed (fixpoint-stable)",
  );
  assert.equal(cleanTitle("[P] Create the scaffold", base), "[P] Create the scaffold", "no member ⇒ no stripping (global default)");
  assert.equal(
    cleanTitle(cleanTitle("[US12] Keep [US12] stable", { ...base, titleTagPattern: KITTY_TAG_SOURCE }), {
      ...base,
      titleTagPattern: KITTY_TAG_SOURCE,
    }),
    "Keep stable",
    "re-applying the derivation is a no-op (Principle IV — no oscillation)",
  );
  assert.equal(
    cleanTitle("[SYNC-1] [P12] Hybrid", { ...base, titleTagPattern: KITTY_TAG_SOURCE }),
    "Hybrid",
    "ref and tag both strip; the ref rule never removes a tag and vice versa",
  );
});

test("parsing 017: renderTaskLines preserves the T-dash id span when checklistIdPattern is passed; re-parse is stable (C3.8)", () => {
  const { file } = parseContent(MISSION);
  const assignments = file.tasks.map((task) => ({
    task,
    desiredTitle: task.title,
    issueRef: { key: "SYNC", number: 100 + task.lineNumber },
  }));
  const first = renderTaskLines(PATH, MISSION, assignments, cfg, { checklistIdPattern: KITTY_ID_SOURCE });
  assert.equal(
    first.changes.find((c) => c.lineNumber === 8)?.after,
    "- [ ] T001 [SYNC-108] [P] Create the base scaffold\n",
    "id span preserved, ref token inserted, tag kept verbatim in the file (C3.5); the line terminator is carried",
  );
  const reparsed = parseContent(first.content);
  assert.deepEqual(
    reparsed.file.tasks.map((t) => [t.localTaskId, t.title]),
    file.tasks.map((t) => [t.localTaskId, t.title]),
    "parse → render → parse keeps ids and raw titles identical (Principle IV)",
  );
  const second = renderTaskLines(
    PATH,
    first.content,
    reparsed.file.tasks.map((task) => ({
      task,
      desiredTitle: task.title,
      issueRef: task.issueRef ?? { key: "SYNC", number: 100 + task.lineNumber },
    })),
    cfg,
    { checklistIdPattern: KITTY_ID_SOURCE },
  );
  assert.equal(second.content, first.content, "a second render cycle is byte-identical (C3.8 — no progressive prefixing)");
});

test("parsing 017: unknown adapter members stay invisible; absent checklistIdPattern keeps the built-in id grammar (amendment 2 whitelist)", () => {
  const polluted = {
    ...genericFixtureAdapter,
    checklistIdPattern: KITTY_ID_SOURCE,
    someUnknownMember: "T\\d+",
  } as unknown as TaskFileAdapter;
  const line = "- [ ] T001 Create the scaffold\n";
  const withOverride = parseContent(line, polluted, "specs/auth/tasks.md");
  assert.equal(withOverride.file.tasks[0]?.localTaskId, "T001", "the whitelisted member passes through to parse");
  const withoutOverride = parseContent(line, genericFixtureAdapter, "specs/auth/tasks.md");
  assert.ok(!("localTaskId" in (withoutOverride.file.tasks[0] as object)), "built-in default (LOCAL_ID_SPAN_RE) needs a separator — unchanged");
  assert.equal(withoutOverride.file.tasks[0]?.title, "T001 Create the scaffold", "SC-005: existing identities unaffected by the new members");
});
