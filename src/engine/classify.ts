/**
 * Three-way description-conflict classification (research R3; data-model §3; FR-002;
 * task T020 implements; unit tests T013). One `ClassificationOutcome` per task per run
 * drives plan entries and apply actions. Normalized-hash baseline rule:
 * `specChanged = sha256(normalize(section)) ≠ checkpoint.descriptionContentHash`,
 * `linearChanged = sha256(normalize(issueDescription)) ≠ same`; both ⇒ `both-changed`,
 * spec-only ⇒ `spec-changed`, linear-only ⇒ `linear-changed`, neither ⇒ `null`.
 * Bootstrap: normalized-identical ⇒ `null`, any meaningful difference ⇒ `both-changed`.
 * Title/checkbox/state-type drift ride separate fields and NEVER route through the
 * description machinery (FR-006; conflict-resolution-matrix.md §5). Formatting-only
 * drift MUST NOT appear on either side (SC-002).
 */
import type { Checkpoint, DescriptionConflictType } from "../domain/checkpoint.js";
import type { Task } from "../domain/task.js";
import type { SyncMode } from "./mode.js";
import type { DescriptionNormalizer } from "./options.js";

/** One per task per run; drives plan entries and apply actions (data-model §3). */
export interface ClassificationOutcome {
  /** FK → frozen `Task`/`Checkpoint` (`Task.stableUuid`). */
  readonly taskUuid: string;
  /** Run mode the classification ran under (data-model §2). */
  readonly mode: SyncMode;
  /** `null` ⇒ no description conflict; computed from normalized hash comparison (R3). */
  readonly descriptionConflict: DescriptionConflictType | null;
  /** Derived title ≠ `Checkpoint.title` — independent of the description machinery. */
  readonly titleChanged: boolean;
  /** `Task.checked ≠ Checkpoint.checked` — drives the §6 completion op (FR-006). */
  readonly checkedChanged: boolean;
  /** Tracker state ≠ `Checkpoint.issueStateType` — recorded, never pushed back (R7). */
  readonly stateTypeDrift: boolean;
  /** Frozen §1 field true ⇒ plan decision `skip-unresolved` (FR-007 freeze rule). */
  readonly unresolvedConflict: boolean;
  /** Machine-readable labels incl. conflict type + resolved action (FR-005). */
  readonly reasons: readonly string[];
}

/** Inputs of one task classification (all pre-fetched by `build.ts`; pure here). */
export interface ClassificationInput {
  /** Reality-selected run mode (data-model §2). */
  readonly mode: SyncMode;
  /** Parsed frozen task record (004 output, 002 shape). */
  readonly task: Task;
  /** 005 `TitleDerivation.finalTitle` compared against `Checkpoint.title`. */
  readonly derivedTitle: string;
  /** Mirrored task-section text as it appears in the spec file (R3 spec side). */
  readonly specSection: string;
  /** Matched issue's description (R3 tracker side); empty string when no issue. */
  readonly issueDescription: string;
  /** Baseline checkpoint; absent ⇒ bootstrap seeding case (no conflict machinery). */
  readonly checkpoint?: Checkpoint;
  /** Active normalization profile (resolved via `normalize.ts`, R5). */
  readonly normalizer: DescriptionNormalizer;
}

/**
 * Classify one task: normalized-hash description conflict (FR-002), title/checkbox/
 * state-type drift, unresolved-freeze flag, and FR-005 reason labels. Pure; formatting-
 * only drift yields `descriptionConflict: null` on both sides (SC-002). Bootstrap with
 * no checkpoint: identical-after-normalization ⇒ `null`, else `both-changed` (FR-002).
 * T020 implements (T013).
 */
export function classifyTask(input: ClassificationInput): ClassificationOutcome {
  void [input]; // signature stub — the owning task (header JSDoc) implements the body
  throw new Error("not implemented: classify");
}
