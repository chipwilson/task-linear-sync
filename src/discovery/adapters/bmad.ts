/**
 * Built-in `bmad` adapter row (001 R7.2/R7.5; contracts/framework-adapter.md built-in
 * table; T030). Detection is DISJUNCTIVE and `docs/` is deliberately a BASE directory,
 * NOT a detection marker — "directory names are generic discovery defaults, not routing
 * defaults" (001 R7.8): a `docs/**` task file without bmad markers resolves to `generic`.
 */
import { builtInDefaults } from "../../config/defaults.js";
import type { FrameworkAdapter } from "../adapter.js";
import { defineFrameworkAdapter, type ResolvedConventions } from "../conventions.js";

export const bmadConventions: ResolvedConventions = {
  id: "bmad",
  taskFilePatterns: [...builtInDefaults.taskFilePatterns],
  baseDirectories: ["bmad/", "bmad-method/", "docs/"],
  detection: {
    pathContains: ["bmad/", "bmad-method/"],
    siblingsAnyOf: ["prd.md", "architecture.md"], // disjunctive with the path marker
  },
  featureNameRule: { kind: "parent-or-basename" }, // parent dir, or task-file basename when no feature dir (001 R7.5)
  headingGrammar: builtInDefaults.headingIdGrammar,
  phasePattern: builtInDefaults.phasePattern,
  summaryPattern: builtInDefaults.summaryPattern,
  rollupPattern: builtInDefaults.rollupPattern,
  titleBehavior: { stripPrefixes: [...builtInDefaults.titleStripPrefixes] },
  siblingDocuments: ["requirements.md", "design.md", "architecture.md", "prd.md", "spec.md"], // 001 R7.5 row
  frameworkSpecificExclusions: [],
};

export const bmadAdapter: FrameworkAdapter = defineFrameworkAdapter(bmadConventions);
