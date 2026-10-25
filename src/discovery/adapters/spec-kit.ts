/**
 * Built-in `spec-kit` adapter row (001 R7.2/R7.5; contracts/framework-adapter.md built-in
 * table; T028). The detection rule is CONJUNCTIVE: "path is beneath `specs/` or `spec/`
 * AND sibling markers such as `spec.md` or `plan.md` are present" — a `specs/` file
 * without those siblings falls through (to `generic` absent other markers).
 */
import { builtInDefaults } from "../../config/defaults.js";
import type { FrameworkAdapter } from "../adapter.js";
import { defineFrameworkAdapter, type ResolvedConventions } from "../conventions.js";

export const specKitConventions: ResolvedConventions = {
  id: "spec-kit",
  taskFilePatterns: [...builtInDefaults.taskFilePatterns],
  baseDirectories: ["specs/", "spec/"],
  detection: {
    pathPrefixes: ["specs/", "spec/"],
    siblingsAnyOf: ["spec.md", "plan.md"],
    requirePathAndSiblings: true, // 001 R7.2 conjunctive rule
  },
  featureNameRule: { kind: "parent-dir" }, // immediate feature directory beneath a base (001 R7.5)
  headingGrammar: builtInDefaults.headingIdGrammar,
  phasePattern: builtInDefaults.phasePattern,
  summaryPattern: builtInDefaults.summaryPattern,
  rollupPattern: builtInDefaults.rollupPattern,
  titleBehavior: { stripPrefixes: [...builtInDefaults.titleStripPrefixes] },
  siblingDocuments: ["spec.md", "plan.md", "requirements.md"], // 001 R7.5 row
  frameworkSpecificExclusions: [],
};

export const specKitAdapter: FrameworkAdapter = defineFrameworkAdapter(specKitConventions);
