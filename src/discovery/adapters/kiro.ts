/**
 * Built-in `kiro` adapter row (001 R7.2/R7.5; contracts/framework-adapter.md built-in
 * table; T027). FR-010 Kiro-compatibility behaviors live here: `.kiro/specs/<feature>/tasks.md`
 * discovery, the feature directory as `Feature_Name`, and `.kiro/hooks/` scaffold support
 * advertised via `agentHookTemplate: "kiro-json"`.
 */
import { builtInDefaults } from "../../config/defaults.js";
import type { FrameworkAdapter } from "../adapter.js";
import { defineFrameworkAdapter, type ResolvedConventions } from "../conventions.js";

export const kiroConventions: ResolvedConventions = {
  id: "kiro",
  taskFilePatterns: [...builtInDefaults.taskFilePatterns],
  baseDirectories: [".kiro/specs/"],
  detection: { pathPrefixes: [".kiro/"] }, // "kiro WHERE the path is beneath `.kiro/`" (001 R7.2)
  featureNameRule: { kind: "parent-dir" }, // feature directory beneath `.kiro/specs/` (FR-010)
  headingGrammar: builtInDefaults.headingIdGrammar,
  phasePattern: builtInDefaults.phasePattern,
  summaryPattern: builtInDefaults.summaryPattern,
  rollupPattern: builtInDefaults.rollupPattern,
  titleBehavior: { stripPrefixes: [...builtInDefaults.titleStripPrefixes] },
  siblingDocuments: ["requirements.md", "design.md"], // 001 R7.5 row
  agentHooksDirectory: ".kiro/hooks/", // 001 Glossary Agent_Hooks_Directory (Kiro)
  agentHookTemplate: "kiro-json", // research R11 — consumed by 010
  frameworkSpecificExclusions: [], // no framework-owned task directories to exclude (T027 row)
};

export const kiroAdapter: FrameworkAdapter = defineFrameworkAdapter(kiroConventions);
