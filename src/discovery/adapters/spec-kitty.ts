/**
 * Built-in `spec-kitty` adapter row — RE-BASED for feature 022 per data-model §3. Spec
 * Kitty's task source is the work-package DOCUMENT: every Markdown document under a
 * mission's `tasks/` folder (`taskPathPatterns`, A-022-1) that carries a work-package id
 * (`documentTaskRule`, A-022-2) is exactly one task. The roll-up (`tasks.md`/`TASKS.md`)
 * stays claimed — as documentation: its checklist lines, work-package headings and prose
 * are content, never extraction inputs (FR-005). The 017 roll-up grammar members
 * (`checklistIdPattern`, `titleTagPattern`, `phasePattern`, `summaryPattern`) are retired
 * from the row (the whitelist members remain available to custom adapters), and the 017
 * C2.5 tasks-directory exclusion is REMOVED — the collection descends. Detection stays
 * path-only (017 C2.1); scaffold requests keep refusing (C1.3).
 */
import { builtInDefaults } from "../../config/defaults.js";
import type { FrameworkAdapter } from "../adapter.js";
import { defineFrameworkAdapter, type ResolvedConventions } from "../conventions.js";

export const specKittyConventions: ResolvedConventions = {
  id: "spec-kitty",
  taskFilePatterns: [...builtInDefaults.taskFilePatterns], // roll-up claim — unchanged semantics
  taskPathPatterns: ["kitty-specs/*/tasks/**/*.md"], // A-022-1: the work-package collection (R2)
  baseDirectories: ["kitty-specs/"],
  detection: {
    pathPrefixes: ["kitty-specs/"], // C2.1 — path claims with NO sibling requirement
  },
  featureNameRule: { kind: "segment-under-base" }, // the mission beneath the specs root (R3)
  headingGrammar: "(?!)", // never-matching placeholder retained; document mode never consults it
  documentTaskRule: {
    // A-022-2 (data-model §3, verbatim): collection gate + recognition keys + file-name id.
    collectionPattern: "^kitty-specs/[^/]+/tasks/.+\\.md$",
    idKey: "work_package_id",
    titleKey: "title",
    fileNameIdPattern: "(?i)^WP(\\d+)[^/]*\\.md$",
  },
  // A-023-1 (023): the mission's append-only lane-event log — the SOLE status authority
  // (feature contract C6). Read by the engine during plan build ONLY; never a task source.
  statusEventFileName: "status.events.jsonl",
  titleBehavior: { stripPrefixes: [...builtInDefaults.titleStripPrefixes] },
  siblingDocuments: [...builtInDefaults.siblingDocuments],
  // C1.3 — no agentHooksDirectory and no template: scaffold requests refuse with zero writes.
  frameworkSpecificExclusions: [], // 022: the tasks/ folder IS the collection (supersedes 017 C2.5)
};

export const specKittyAdapter: FrameworkAdapter = defineFrameworkAdapter(specKittyConventions);
