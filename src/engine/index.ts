/**
 * `task-linear-sync/engine` — the single public barrel for the 008 sync-engine module
 * group (plan.md module map; research R1: one additive `./engine` subpath; the
 * composition root `createSyncEngine` is the only engine entry point — constitution V).
 * T012 delivers the surface; wiring tasks (T026/T045) replace skeleton bodies but keep
 * exported names stable. Named re-exports ONLY so the public surface stays explicit.
 *
 * Frozen 002 surfaces (`SyncEngine`, `EngineDependencies`, `GateRequest`/`GateFailure`,
 * entity shapes) keep their own authority in `task-linear-sync/{ports,domain,gates,state}`
 * and are deliberately NOT restated here — except the `KeyProvider` type alias re-export
 * for `EngineOptions` ergonomics (identical binding, never a copy).
 */

// ── Composition root (T012; frozen SyncEngine implemented behind it) ──────────────
export { createSyncEngine } from "./create.js";

// ── Options (T008 — implemented) ──────────────────────────────────────────────────
export type {
  EngineOptions,
  ResolvedEngineOptions,
  DescriptionNormalizer,
} from "./options.js";
export { envVarKeyProvider, resolveEngineOptions, resolveScreener } from "./options.js";
export type { KeyProvider } from "../state/manifest.js";

// ── Error taxonomy (T007 — implemented; refusals reuse frozen GateFailure codes) ───
export { EngineError, EngineFailError, IntegrityError, JournalError } from "./errors.js";

// ── Mode + CheckpointStore (T011; data-model §1–§2; tests T004) ───────────────────
export type { SyncMode, CheckpointStoreFile, ModeSelection } from "./mode.js";
export {
  CHECKPOINT_STORE_REL_PATH,
  readCheckpointStore,
  writeCheckpointStore,
  selectMode,
  restoreCheckpointStoreFromSnapshot,
} from "./mode.js";

// ── Normalization-profile registry (T009; research R5; tests T005) ─────────────────
export {
  DEFAULT_NORMALIZATION_PROFILE_NAME,
  defaultDescriptionNormalizer,
  builtInNormalizationProfiles,
  resolveNormalizationProfile,
  normalizedContentHash,
} from "./normalize.js";

// ── Default SecurityScreener (T010; research R12; tests T006/T039) ─────────────────
export type { ScreenerRule, ScreeningRuleSet } from "./screening.js";
export { builtInScreeningRules, createDefaultSecurityScreener } from "./screening.js";

// ── Classification (T020; data-model §3; tests T013) ───────────────────────────────
export type { ClassificationOutcome, ClassificationInput } from "./classify.js";
export { classifyTask } from "./classify.js";

// ── Action resolution + FR-004 default maps (T021; matrix contract; tests T014) ────
export type {
  ActionEffect,
  ConflictResolutionContext,
  ResolvedConflictAction,
  AppliedAction,
} from "./actions.js";
export {
  bootstrapConflictDefaults,
  syncConflictDefaults,
  resolveConflictAction,
  appliedAction,
} from "./actions.js";

// ── Conflict-marker synthesis (T022; research R4; tests T015) ──────────────────────
export type { ConflictMarkerInput } from "./markers.js";
export { synthesizeConflictMarkerBlock } from "./markers.js";

// ── Completion mapping (T023; research R7; tests T016/T033) ────────────────────────
export { desiredCompletionStateName, resolveWorkflowStateId } from "./completion.js";

// ── Payload rewrite + history append/rollover (T042; history-log contract; T029/T035)
export type {
  AttachmentRunContext,
  PageZeroRewriteInput,
  HistoryAppendResult,
  RolloverSplit,
} from "./payload.js";
export {
  readPageZeroPayload,
  rewritePageZeroPayload,
  computeRolloverSplit,
  appendHistoryEvent,
} from "./payload.js";

// ── Continuation pages (T042; data-model §7; tests T029) ───────────────────────────
export type { HistoryPageRecord } from "./history-page.js";
export {
  historyPageAddress,
  serializeHistoryPageRecord,
  parseHistoryPageRecord,
} from "./history-page.js";

// ── Op taxonomy, deterministic ids, FR-011 order (T040; research R14; tests T028) ───
export type { EngineOpKind, OpBeforeSnapshot, OpAfterSnapshot, PlannedOp } from "./ops.js";
export {
  deriveOpId,
  deriveRunId,
  emissionOrder,
  historyKindForUpdatedField,
} from "./ops.js";

// ── Journal artifacts (T041; journal-rollback contract; tests T030/T036) ───────────
export type {
  JournalStep,
  JournalArtifacts,
  MaterializeJournalInput,
  StepTransition,
} from "./journal.js";
export {
  manifestRelPath,
  journalRelPath,
  materializeJournal,
  recordStepTransition,
  readManifestEnvelope,
  journalArtifactsExist,
  readJournalArtifacts,
} from "./journal.js";

// ── Pipelines (T024/T043/T044; wired into createSyncEngine by T026/T045) ───────────
export { buildSyncPlan } from "./build.js";
export { applySyncPlan } from "./apply.js";
export { rollbackRun } from "./rollback.js";

// ── Reports + last-run marker (T025/T045; frozen plan-report schema; tests T047) ───
export type {
  PlanReportAssertion,
  ReportRouting,
  ReportTaskEntry,
  PlanReportJson,
  ReportPaths,
  LastRunMarker,
} from "./report.js";
export {
  persistPlan,
  renderPlanReportMarkdown,
  writePlanReportArtifacts,
  writeRunReportWithMarker,
} from "./report.js";
