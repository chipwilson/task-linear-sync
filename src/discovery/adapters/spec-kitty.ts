/**
 * Built-in `spec-kitty` adapter row (017; contracts/spec-kitty-adapter.md C1–C3; the
 * exact defaults of data-model.md §2). Spec Kitty lays out one roll-up task file per
 * mission (`kitty-specs/<mission>/tasks.md`): work-package headings group subtasks, the
 * template/prose sections are excluded, checklist lines carry `T001`-style local ids,
 * and `[P]`/`[USn]` capability tags belong to the file, not to derived titles.
 * The heading grammar never matches — zero `heading` tasks originate here (C3.1).
 */
import { builtInDefaults } from "../../config/defaults.js";
import type { FrameworkAdapter } from "../adapter.js";
import { defineFrameworkAdapter, type ResolvedConventions } from "../conventions.js";

export const specKittyConventions: ResolvedConventions = {
  id: "spec-kitty",
  taskFilePatterns: [...builtInDefaults.taskFilePatterns],
  baseDirectories: ["kitty-specs/"],
  detection: {
    pathPrefixes: ["kitty-specs/"], // C2.1 — path claims with NO sibling requirement
  },
  featureNameRule: { kind: "parent-dir" }, // the mission beneath the specs root (C2.3)
  headingGrammar: "(?!)", // never-matching: work-package/template headings are structure only (C3.1)
  phasePattern: "^#{2,4}\\s+Work Package\\s+(?<phase>WP\\d+(?::\\s*[^\\n]*)?)\\s*$", // C3.6
  summaryPattern:
    "^\\s{0,3}#{2,4}\\s+(?:Inputs|Prerequisites|Organization|Subtask Format|Path Conventions|Goal|Independent Test|Implementation Notes|Parallel Opportunities|Dependencies|Risks & Mitigations)\\b", // C3.3
  checklistIdPattern: "^(?<id>[Tt]?\\d{2,}(?:\\.\\d+)*|\\d+(?:\\.\\d+)+)[ \\t]*[.:—–-]?[ \\t]+", // C3.4 (amendment 2) — second alternation: dotted variants with single-digit heads ("2.1"), per T012/C3.4
  titleTagPattern: "\\[(?:P\\d*|US\\d+)\\]", // C3.5 (amendment 2) — derived titles only
  titleBehavior: { stripPrefixes: [...builtInDefaults.titleStripPrefixes] },
  siblingDocuments: [...builtInDefaults.siblingDocuments],
  // C1.3 — no agentHooksDirectory and no template: scaffold requests refuse with zero writes.
  frameworkSpecificExclusions: ["kitty-specs/*/tasks/"], // C2.5 (amendment 3 `*`-segment grammar)
};

export const specKittyAdapter: FrameworkAdapter = defineFrameworkAdapter(specKittyConventions);
