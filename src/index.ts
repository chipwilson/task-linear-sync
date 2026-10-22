/**
 * task-linear-sync public entry — re-exports the frozen contract modules (plan.md § Source
 * Code; FR-008). Other features import only through this package's declared subpath
 * exports; none may edit these modules except by constitution-governed cross-feature
 * amendment.
 */
export * from "./domain/index.js";
export * from "./config/index.js";
export * from "./state/index.js";
export * from "./urls/index.js";
export * from "./gates/index.js";
export * from "./ports/index.js";
