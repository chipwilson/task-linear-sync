/**
 * Built-in `spec-superpower` adapter row (feature 018; data-model.md §2.2 values verbatim,
 * contracts/spec-superpower-adapter.md). Superpowers-style implementation plans:
 * date-prefixed plan documents under `docs/superpowers/plans/`, each `Task N:` heading is
 * exactly one task, every checkbox is mirrored body content (rollup capture, never a task),
 * the feature name is the date-stripped filename, and `identityFileScope` keeps same-name
 * plans' identities collision-free (FR-010, amendment A-018-2). No agent-hook scaffold
 * (FR-012) — the install lane keeps refusing this identity.
 */
import { builtInDefaults } from "../../config/defaults.js";
import type { FrameworkAdapter } from "../adapter.js";
import { defineFrameworkAdapter, type ResolvedConventions } from "../conventions.js";

export const specSuperpowerConventions: ResolvedConventions = {
  id: "spec-superpower",
  // FR-002: date-prefixed plan filenames only (basename glob, compiled via compileNamePattern).
  taskFilePatterns: ["[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]-*.md"],
  baseDirectories: ["docs/superpowers/plans/"],
  // Plans root, beneath-any-depth; path-only detection — no siblings (contract Rule 2).
  detection: { pathPrefixes: ["docs/superpowers/plans/"] },
  featureNameRule: { kind: "date-stripped-basename" }, // FR-003 / SC-003 (research R5)
  // FR-004: levels 2–4 `Task N:` headings only; `id` group is the local id, excluded from the title.
  headingGrammar: "^\\s{0,3}#{2,4}\\s+(?<id>Task\\s+[0-9]+)\\s*:\\s*(?<title>.+)$",
  // FR-005 / research R3: every checkbox line is a rollup exclusion AND verbatim body content.
  rollupPattern: "^\\s*[-*+]\\s*\\[[ xX]\\]",
  phasePattern: builtInDefaults.phasePattern, // harmless: phase headings stay organizers (data-model §2.2)
  summaryPattern: builtInDefaults.summaryPattern,
  titleBehavior: { stripPrefixes: [...builtInDefaults.titleStripPrefixes] },
  siblingDocuments: [], // plans carry no spec-sibling markers (FR-002)
  // FR-010 / amendment A-018-2: seed inputs compose the file basename (contract Rule 6).
  identityFileScope: true,
  // FR-012: NO agentHooksDirectory / agentHookTemplate — refusal path unchanged (research R9).
  frameworkSpecificExclusions: [], // step containment is grammar-driven, not an exclusion list
};

export const specSuperpowerAdapter: FrameworkAdapter = defineFrameworkAdapter(specSuperpowerConventions);
