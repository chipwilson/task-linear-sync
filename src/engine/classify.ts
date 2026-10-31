/**
 * T020 [US1] — Three-way description-conflict classification (research R3/R5; data-model §3;
 * FR-002/005/006/007; conflict-resolution-matrix.md §1/§4/§5/§6; unit tests T013).
 *
 * One `ClassificationOutcome` per task per run drives plan entries and apply actions.
 * Normalized-hash baseline rule (R3 — the single-baseline invariant that makes SC-002
 * structural): `specChanged = sha256(normalize(section)) ≠ checkpoint.descriptionContentHash`,
 * `linearChanged = sha256(normalize(issueDescription)) ≠ same`; both ⇒ `both-changed`,
 * spec-only ⇒ `spec-changed`, linear-only ⇒ `linear-changed`, neither ⇒ `null`. The verdict
 * is mechanical on those two predicates — classification never shortcuts the formula, even
 * when both sides carry the identical edit (convergence is the actions layer's job, §6).
 * Bootstrap (no checkpoint — data-model §3 computes `descriptionConflict` only when a
 * baseline exists, so an absent checkpoint selects this case whatever the mode label says):
 * both sides are normalized and compared to EACH OTHER; identical ⇒ `null`, any meaningful
 * difference ⇒ `both-changed`, the only conflict type bootstrap ever observes (matrix §1).
 * Title/checkbox/state-type drift ride separate fields and NEVER route through the
 * description machinery (FR-006; matrix §5); formatting-only drift MUST NOT appear on
 * either side (SC-002) because both sides and the stored baseline are hashed through the
 * same profile (`normalizedContentHash`, R5).
 *
 * Hashing always honors `input.normalizer` — the profile seam, never a hard-coded built-in
 * (R5; constitution III). Because `ClassificationInput` carries a resolved *function*, the
 * configured-name alias of pinned cross-lane decision 2 applies at name-resolution time:
 * frozen config spells the built-in `"default"` profile `"standard"`
 * (`config.defaults.ts` → `descriptionNormalizationProfile: "standard"`), so
 * {@link resolveConfiguredNormalizer} maps `"standard"` → built-in `"default"` while
 * unknown names still fail loudly (never a silent fallback). `build.ts` (T024) resolves its
 * profile through the same helper.
 *
 * Purity/determinism: `classifyTask` reads its input, mutates nothing, and yields a
 * deep-equal outcome for equal inputs (constitution VI — no clock, no I/O, no port calls).
 */
import type { Checkpoint, DescriptionConflictType } from "../domain/checkpoint.js";
import type { Task } from "../domain/task.js";
import {
  DEFAULT_NORMALIZATION_PROFILE_NAME,
  normalizedContentHash,
  resolveNormalizationProfile,
} from "./normalize.js";
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
  /**
   * ADDITIVE (T020, T013 modeling choice 1): the matched issue's CURRENT workflow state type
   * as the tracker reports it this run (006 match result / 007 issue snapshot). Data-model §3
   * defines `stateTypeDrift` as *tracker* state ≠ `Checkpoint.issueStateType`, so drift is
   * undecidable without this live value; a checkpoint's recorded state type alone is never
   * drift. Optional and defaulted: when absent, `stateTypeDrift` is `false` (callers that
   * hold the live state elsewhere — e.g. `build.ts` — may merge drift upstream instead).
   * Drift is recorded only (R7) and NEVER populates `descriptionConflict` (matrix §5).
   */
  readonly liveIssueStateType?: string;
}

/**
 * Frozen config spells the built-in `"default"` normalization profile `"standard"`
 * (`src/config/defaults.ts`). Pinned cross-lane decision 2: resolution sites map the alias
 * to the built-in `"default"`; unknown names keep failing loudly.
 */
const CONFIG_PROFILE_ALIAS = "standard";

/**
 * Resolve a CONFIGURED profile name to its normalizer with the `"standard"` ⇒
 * `"default"` alias applied (pinned decision 2; research R5; constitution III).
 *
 * Precedence: an explicitly registered extension under the configured name wins over the
 * alias (a consumer that registers their own `"standard"` gets it), otherwise the alias
 * resolves to the built-in `"default"`. Anything neither registered nor built-in throws —
 * resolution never silently falls back (`resolveNormalizationProfile`, T009).
 */
export function resolveConfiguredNormalizer(
  name: string,
  extensions?: Readonly<Record<string, DescriptionNormalizer>>,
): DescriptionNormalizer {
  if (extensions !== undefined && Object.hasOwn(extensions, name)) {
    return resolveNormalizationProfile(name, extensions);
  }
  const resolved = name === CONFIG_PROFILE_ALIAS ? DEFAULT_NORMALIZATION_PROFILE_NAME : name;
  return resolveNormalizationProfile(resolved, extensions);
}

/**
 * The R3 two-predicate verdict against the single stored baseline, or the bootstrap
 * side-vs-side rule when no baseline exists (data-model §3: `descriptionConflict` is
 * computed only when a checkpoint exists — absence selects bootstrap, matrix §1).
 */
function describeConflict(
  checkpoint: Checkpoint | undefined,
  specHash: string,
  linearHash: string,
): DescriptionConflictType | null {
  if (checkpoint === undefined) {
    // No baseline to attribute a move to ⇒ any normalized difference is both-sided.
    return specHash === linearHash ? null : "both-changed";
  }
  const baseline = checkpoint.descriptionContentHash;
  const specChanged = specHash !== baseline;
  const linearChanged = linearHash !== baseline;
  if (specChanged && linearChanged) return "both-changed";
  if (specChanged) return "spec-changed";
  if (linearChanged) return "linear-changed";
  return null;
}

/**
 * FR-005 machine-readable labels. The conflict-type label appears ONLY when a conflict
 * exists (SC-001: a zero-change run surfaces no conflict label at all); each label mirrors
 * the outcome field it explains so plan/report reasons stay greppable. The resolved
 * ACTION label is appended by the actions/build layers (T021/T024) — classification knows
 * only the drift it observed.
 */
function buildReasons(
  hasCheckpoint: boolean,
  descriptionConflict: DescriptionConflictType | null,
  titleChanged: boolean,
  checkedChanged: boolean,
  stateTypeDrift: boolean,
  unresolvedConflict: boolean,
): string[] {
  const reasons: string[] = [];
  if (!hasCheckpoint) reasons.push("bootstrap-no-checkpoint");
  reasons.push(
    descriptionConflict === null
      ? "no-description-conflict"
      : `description-conflict:${descriptionConflict}`,
  );
  if (titleChanged) reasons.push("title-changed");
  if (checkedChanged) reasons.push("checkbox-changed");
  if (stateTypeDrift) reasons.push("state-type-drift");
  if (unresolvedConflict) reasons.push("unresolved-conflict");
  return reasons;
}

/**
 * Classify one task: normalized-hash description conflict (FR-002), title/checkbox/
 * state-type drift, unresolved-freeze flag, and FR-005 reason labels. Pure; formatting-
 * only drift yields `descriptionConflict: null` on both sides (SC-002). Bootstrap with
 * no checkpoint: identical-after-normalization ⇒ `null`, else `both-changed` (FR-002).
 *
 * An unresolved block freezes plan/apply (FR-007, matrix §4), NOT classification: the
 * flag passes through from `Task.unresolvedConflict` while the (marker-bearing) section
 * still hashes against the preserved baseline.
 */
export function classifyTask(input: ClassificationInput): ClassificationOutcome {
  const { mode, task, derivedTitle, specSection, issueDescription, normalizer } = input;
  const checkpoint = input.checkpoint;

  // R3 single-baseline invariant: both live sides hashed with the SAME profile the
  // checkpoint was stored under — formatting-only noise normalizes out (SC-002) while
  // content-bearing Markdown survives (R5).
  const specHash = normalizedContentHash(normalizer, specSection);
  const linearHash = normalizedContentHash(normalizer, issueDescription);

  const descriptionConflict = describeConflict(checkpoint, specHash, linearHash);

  // Independent drift channels (FR-006; matrix §5) — never routed through the description
  // verdict above. Without a checkpoint there is nothing to have drifted FROM (§3), so the
  // bootstrap case reports all three false whatever the live values say.
  const titleChanged = checkpoint !== undefined && derivedTitle !== checkpoint.title;
  const checkedChanged =
    checkpoint !== undefined && (task.checked ?? false) !== (checkpoint.checked ?? false);
  const stateTypeDrift =
    checkpoint !== undefined &&
    input.liveIssueStateType !== undefined &&
    input.liveIssueStateType !== checkpoint.issueStateType;

  const unresolvedConflict = task.unresolvedConflict;

  return {
    taskUuid: task.stableUuid,
    mode,
    descriptionConflict,
    titleChanged,
    checkedChanged,
    stateTypeDrift,
    unresolvedConflict,
    reasons: buildReasons(
      checkpoint !== undefined,
      descriptionConflict,
      titleChanged,
      checkedChanged,
      stateTypeDrift,
      unresolvedConflict,
    ),
  };
}
