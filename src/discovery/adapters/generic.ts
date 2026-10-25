/**
 * Built-in `generic` adapter row (001 R7.5; contracts/framework-adapter.md built-in
 * table). FR-010 (US2 AC3): `frameworkSpecificExclusions` is EMPTY — when `generic` is
 * selected, no framework-specific exclusions apply beyond the global summary/rollup
 * defaults. Base directories and sibling documents are config-driven (`specsBaseDirectories`
 * / `siblingDocuments`, frozen 002 keys); the conventions row here carries the built-in
 * defaults layer — per-run config deviations merge in via `resolveConventions` (research R7).
 */
import { builtInDefaults } from "../../config/defaults.js";
import type { FrameworkAdapter } from "../adapter.js";
import { defineFrameworkAdapter, type ResolvedConventions } from "../conventions.js";

/** Built-in defaults-layer conventions for the generic adapter. */
export const genericConventions: ResolvedConventions = {
  id: "generic",
  taskFilePatterns: [...builtInDefaults.taskFilePatterns],
  baseDirectories: [...builtInDefaults.specsBaseDirectories],
  detection: {}, // matches NOTHING by marker — generic is the fallback only (T018/T019)
  featureNameRule: { kind: "parent-dir" }, // parent-dir-IF-UNDER-BASE (built-in table note)
  headingGrammar: builtInDefaults.headingIdGrammar,
  phasePattern: builtInDefaults.phasePattern,
  summaryPattern: builtInDefaults.summaryPattern,
  rollupPattern: builtInDefaults.rollupPattern,
  titleBehavior: { stripPrefixes: [] }, // no framework title conventions (T019)
  siblingDocuments: [...builtInDefaults.siblingDocuments],
  agentHooksDirectory: ".task-linear-sync/hooks/", // 001 Glossary Agent_Hooks_Directory
  agentHookTemplate: "command-json", // research R11 — consumed by 010
  frameworkSpecificExclusions: [], // FR-010: MUST be empty for "generic"
};

/** The built-in `generic` adapter (004's fixture adapter; `builtInAdapters.generic`). */
export const genericAdapter: FrameworkAdapter = defineFrameworkAdapter(genericConventions);
