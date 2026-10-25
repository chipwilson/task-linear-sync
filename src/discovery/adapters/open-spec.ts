/**
 * Built-in `open-spec` adapter row (001 R7.2/R7.5; contracts/framework-adapter.md built-in
 * table; T029). Detection is DISJUNCTIVE: "path contains `openspec/` or `open-spec/` OR
 * sibling markers such as `openspec.json` or `proposal.md`". `Feature_Name` is "the
 * meaningful segment after `openspec/`, `changes/`, or `specs/` where present".
 */
import { builtInDefaults } from "../../config/defaults.js";
import type { FrameworkAdapter } from "../adapter.js";
import { defineFrameworkAdapter, type ResolvedConventions } from "../conventions.js";

export const openSpecConventions: ResolvedConventions = {
  id: "open-spec",
  taskFilePatterns: [...builtInDefaults.taskFilePatterns],
  baseDirectories: ["openspec/", "open-spec/"],
  detection: {
    pathContains: ["openspec/", "open-spec/"],
    siblingsAnyOf: ["openspec.json", "proposal.md"], // requirePathAndSiblings absent → disjunctive
  },
  featureNameRule: { kind: "segment-after", markers: ["openspec/", "changes/", "specs/"] }, // 001 R7.5
  headingGrammar: builtInDefaults.headingIdGrammar,
  phasePattern: builtInDefaults.phasePattern,
  summaryPattern: builtInDefaults.summaryPattern,
  rollupPattern: builtInDefaults.rollupPattern,
  titleBehavior: { stripPrefixes: [...builtInDefaults.titleStripPrefixes] },
  siblingDocuments: ["spec.md", "proposal.md", "tasks.md"], // self-path exclusion is handled in discover.ts
  frameworkSpecificExclusions: [],
};

export const openSpecAdapter: FrameworkAdapter = defineFrameworkAdapter(openSpecConventions);
