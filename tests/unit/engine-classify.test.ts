/**
 * T013 [P] [US1] — Classification unit tests for `src/engine/classify.ts`
 * (FR-002; data-model §3; research R3/R5; conflict-resolution-matrix.md §1/§6; SC-002).
 * Implementation lands in T020 — these tests COMPILE against the stub signatures
 * (`ClassificationInput` / `ClassificationOutcome` / `classifyTask`) and MUST FAIL at
 * runtime until T020 replaces the `not implemented: classify` body.
 *
 * Pinned behavior:
 * - Sync mode, normalized-hash baseline (R3): `specChanged = sha256(normalize(section))
 *   ≠ checkpoint.descriptionContentHash`, `linearChanged` likewise on the issue
 *   description; both ⇒ `both-changed`, spec-only ⇒ `spec-changed`, linear-only ⇒
 *   `linear-changed`, neither ⇒ `null`. The comparison is mechanical on the two hash
 *   predicates — identical edits applied to BOTH sides still yield `both-changed`.
 * - Bootstrap (no checkpoint): identical-after-normalization ⇒ `null`; any meaningful
 *   difference ⇒ `both-changed` (the only conflict type bootstrap ever observes —
 *   matrix §1). Absent checkpoint ⇒ bootstrap case regardless of the mode label
 *   (stub `checkpoint?` JSDoc; data-model §3 validation: `descriptionConflict` is
 *   computed only when a checkpoint exists).
 * - `titleChanged` / `checkedChanged` / `stateTypeDrift` ride separate fields and NEVER
 *   route through the description machinery (FR-006; matrix §5) — e.g. a checked-only
 *   change leaves `descriptionConflict: null`.
 * - Formatting-only drift (CRLF/CR, trailing whitespace, blank-line RUNS, NFC/NFD,
 *   trailing-newline drift) is invisible on BOTH sides (SC-002): baselines are built by
 *   hashing `normalize()` output — `normalizedContentHash(defaultDescriptionNormalizer, …)`
 *   (implemented in T009) — encoding the R3 single-baseline invariant, while
 *   content-bearing Markdown (heading `#` counts, emphasis) is NOT invisible (R5).
 * - The configured profile seam is honored: hashing uses `input.normalizer`, never a
 *   hard-coded built-in (R5; constitution III).
 * - `reasons` carries machine-readable labels including the conflict type (FR-005).
 * - `unresolvedConflict` passes through from `Task.unresolvedConflict` (data-model §3);
 *   the FR-007 freeze itself governs plan/apply (matrix §4; integration T019), not
 *   classification, so description classification still runs against the stored
 *   baseline while a block is present.
 *
 * Modeling choices this frozen stub signature forces on T020 (documented at each test):
 * 1. `ClassificationInput` carries NO live tracker state type, so `stateTypeDrift`
 *    cannot be computed here — it MUST be `false` for every input this shape can
 *    express. T020 may only surface drift by widening `ClassificationInput`
 *    BACKWARD-COMPATIBLY (new OPTIONAL field, consumed-or-defaulted) or by merging
 *    upstream drift in `build.ts`; the always-false assertions below must keep holding.
 * 2. `Task.checked`/`Checkpoint.checked` are optional; absence normalizes to `false`
 *    (`(task.checked ?? false) !== (checkpoint.checked ?? false)`) — a heading task with
 *    no checkbox never drifts against a `checked: false` checkpoint.
 *
 * Inputs are constructed in-memory per the T013 brief — no fixture worlds, no fake port.
 * UUIDs are synthetic via the harness `uuidFromLabel` (Principle III: zero real ids).
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyTask } from "../../src/engine/classify.js";
import type { ClassificationInput, ClassificationOutcome } from "../../src/engine/classify.js";
import { defaultDescriptionNormalizer, normalizedContentHash } from "../../src/engine/normalize.js";
import type { SyncMode } from "../../src/engine/mode.js";
import type { DescriptionNormalizer } from "../../src/engine/options.js";

import type { Checkpoint, DescriptionConflictType, Task } from "task-linear-sync/domain";

import { uuidFromLabel } from "../helpers/engine-harness.js";

// ──────────────────────────────────────────────── content baselines + noise model

/**
 * Baseline mirrored section — carries content-bearing Markdown (heading `#` count,
 * `**` emphasis, non-ASCII) so formatting-only noise can be proven invisible while
 * semantic changes are proven visible (R5 boundary).
 */
const BASELINE = [
  "## Implementation notes",
  "",
  "Wire the **naïve** widget before the frobnicator.",
  "",
  "- Step one",
  "- Step two",
  "",
].join("\n");

/** Same section with a REAL edit (content-bearing line change). */
const REVISED = BASELINE.replace("- Step one", "- Step one (revised)");

/** Heading demotion `##`→`###` — content-bearing (the profile never touches `#` counts). */
const DEMOTED = BASELINE.replace("## Implementation notes", "### Implementation notes");

/** Title of the task/checkpoint when the test does not override it. */
const DEFAULT_TITLE = "Synced task title";

const CONFLICT_TYPES: readonly DescriptionConflictType[] = ["linear-changed", "spec-changed", "both-changed"];

// Formatting-only platform noise (exactly the R5-documented round-trip classes).
const crlf = (t: string): string => t.replace(/\n/gu, "\r\n");
const crOnly = (t: string): string => t.replace(/\n/gu, "\r");
const trailingWs = (t: string): string =>
  t
    .split("\n")
    .map((line) => `${line} \t `)
    .join("\n");
/** Runs of blank lines (existing paragraph gaps) widened — collapse equates, R5. */
const blankRuns = (t: string): string => t.replace(/\n{2,}/gu, "\n\n\n\n");
/** Whitespace-only "blank" lines (tabs/spaces) between paragraphs. */
const tabBlankLines = (t: string): string => t.replace(/\n\n/gu, "\n\t \n");
const nfd = (t: string): string => t.normalize("NFD");
const trailingNewlines = (t: string): string => `${t}\n\n\n`;

// ──────────────────────────────────────────────── input builders (in-memory only)

interface Scenario {
  readonly mode: SyncMode;
  /** Mirrored task-section text (R3 spec side). */
  readonly spec: string;
  /** Matched issue description (R3 tracker side). */
  readonly issue: string;
  /** When set ⇒ a Checkpoint seeded with `sha256(normalize(profileOrDefault(baseline)))`. */
  readonly baseline?: string;
  /** Normalization profile under test (default: the built-in `"default"` function). */
  readonly profile?: DescriptionNormalizer;
  readonly checked?: boolean; // Task.checked
  readonly checkpointChecked?: boolean; // Checkpoint.checked
  readonly derivedTitle?: string; // 005 finalTitle vs Checkpoint.title
  readonly checkpointTitle?: string;
  readonly stateType?: string; // Checkpoint.issueStateType
  readonly unresolved?: boolean; // Task.unresolvedConflict
  readonly label?: string; // distinct uuid per task under classification
}

/** Deterministic synthetic Task (frozen 002 shape); identity via harness `uuidFromLabel`. */
function makeTask(label: string, opts: { readonly checked?: boolean; readonly unresolved?: boolean }): Task {
  return {
    stableUuid: uuidFromLabel(`classify:${label}`),
    kind: "checklist",
    filePath: "specs/demo-feature/tasks.md",
    lineNumber: 4,
    frameworkId: "generic",
    title: "raw parsed title",
    childUuids: [],
    taskBody: { startLine: 4, endLine: 10 },
    unresolvedConflict: opts.unresolved ?? false,
    ...(opts.checked !== undefined ? { checked: opts.checked } : {}),
  };
}

/** Assemble a `ClassificationInput` (task + checkpoint share one synthetic uuid). */
function scenarioInput(o: Scenario): ClassificationInput {
  const normalizer = o.profile ?? defaultDescriptionNormalizer;
  const task = makeTask(o.label ?? "task", { checked: o.checked, unresolved: o.unresolved });
  const checkpoint: Checkpoint | undefined =
    o.baseline === undefined
      ? undefined
      : {
          taskUuid: task.stableUuid,
          issueId: "SYNC-PLACEHOLDER-1", // placeholder id — Principle III
          title: o.checkpointTitle ?? DEFAULT_TITLE,
          issueUpdatedAt: "2026-01-01T00:00:00.000Z",
          issueStateType: o.stateType ?? "started",
          // R3 baseline construction: the checkpoint hash IS sha256(normalize(baseline))
          // under the SAME profile the run classifies with.
          descriptionContentHash: normalizedContentHash(normalizer, o.baseline),
          ...(o.checkpointChecked !== undefined ? { checked: o.checkpointChecked } : {}),
        };
  return {
    mode: o.mode,
    task,
    derivedTitle: o.derivedTitle ?? DEFAULT_TITLE,
    specSection: o.spec,
    issueDescription: o.issue,
    normalizer,
    ...(checkpoint !== undefined ? { checkpoint } : {}),
  };
}

function classify(s: Scenario): ClassificationOutcome {
  return classifyTask(scenarioInput(s));
}

// ──────────────────────────────────────────────── sync: the hash-comparison matrix

test("engine-classify — sync: neither side moved since the checkpoint ⇒ descriptionConflict null", () => {
  const out = classify({ mode: "sync", spec: BASELINE, issue: BASELINE, baseline: BASELINE });
  assert.equal(out.taskUuid, uuidFromLabel("classify:task"));
  assert.equal(out.mode, "sync");
  assert.equal(out.descriptionConflict, null);
  assert.equal(out.titleChanged, false);
  assert.equal(out.checkedChanged, false);
  assert.equal(out.stateTypeDrift, false);
  assert.equal(out.unresolvedConflict, false);
});

test("engine-classify — sync: spec-only edit ⇒ spec-changed", () => {
  const out = classify({ mode: "sync", spec: REVISED, issue: BASELINE, baseline: BASELINE, label: "spec-only" });
  assert.equal(out.descriptionConflict, "spec-changed");
});

test("engine-classify — sync: tracker-only edit ⇒ linear-changed", () => {
  const out = classify({ mode: "sync", spec: BASELINE, issue: REVISED, baseline: BASELINE, label: "lin-only" });
  assert.equal(out.descriptionConflict, "linear-changed");
});

test("engine-classify — sync: both sides edited ⇒ both-changed", () => {
  const out = classify({
    mode: "sync",
    spec: REVISED,
    issue: BASELINE.replace("**naïve**", "**jaded**"),
    baseline: BASELINE,
    label: "both",
  });
  assert.equal(out.descriptionConflict, "both-changed");
});

test("engine-classify — sync: the SAME meaningful edit on both sides still classifies both-changed (the R3 rule is mechanical on the two hash predicates)", () => {
  // specChanged = specHash ≠ baseline; linearChanged = linearHash ≠ baseline; both ⇒
  // both-changed. Convergence (matrix §6) is the ACTIONS layer's job — classification
  // never shortcuts the two-predicate formula, even when the two sides agree.
  const out = classify({ mode: "sync", spec: REVISED, issue: REVISED, baseline: BASELINE, label: "same-edit" });
  assert.equal(out.descriptionConflict, "both-changed");
});

// ──────────────────────────────────────────────── bootstrap (no checkpoint)

test("engine-classify — bootstrap: sides identical after normalization ⇒ null (no conflict machinery without a checkpoint)", () => {
  // Identical-after-normalization includes noise-equated sides (R3: bootstrap compares
  // the two NORMALIZED sides, no baseline exists yet).
  const out = classify({ mode: "bootstrap", spec: BASELINE, issue: nfd(trailingWs(tabBlankLines(BASELINE))) });
  assert.equal(out.mode, "bootstrap");
  assert.equal(out.descriptionConflict, null);
});

test("engine-classify — bootstrap: any meaningful difference ⇒ both-changed (the only conflict type bootstrap observes — matrix §1)", () => {
  const out = classify({ mode: "bootstrap", spec: BASELINE, issue: REVISED, label: "boot-diff" });
  assert.equal(out.descriptionConflict, "both-changed");
});

test("engine-classify — bootstrap: no checkpoint means no baseline to drift from ⇒ titleChanged/checkedChanged/stateTypeDrift all false", () => {
  const out = classify({
    mode: "bootstrap",
    spec: REVISED,
    issue: BASELINE,
    derivedTitle: "A brand-new derived title",
    checked: true,
    label: "boot-flags",
  });
  assert.equal(out.titleChanged, false);
  assert.equal(out.checkedChanged, false);
  assert.equal(out.stateTypeDrift, false);
});

test("engine-classify — absent checkpoint selects the bootstrap case even when the mode label says sync (data-model §3: descriptionConflict is computed only when a checkpoint exists)", () => {
  const identical = classify({ mode: "sync", spec: BASELINE, issue: crlf(BASELINE), label: "no-cp-same" });
  assert.equal(identical.descriptionConflict, null);
  const diverged = classify({ mode: "sync", spec: BASELINE, issue: REVISED, label: "no-cp-diff" });
  assert.equal(diverged.descriptionConflict, "both-changed");
});

// ──────────────────────────────────────────────── separate drift channels

test("engine-classify — title-only drift sets titleChanged and NEVER touches the description machinery (matrix §5; FR-006 independence)", () => {
  const out = classify({
    mode: "sync",
    spec: BASELINE,
    issue: BASELINE,
    baseline: BASELINE,
    derivedTitle: "Renamed by 005 derivation",
    checkpointTitle: DEFAULT_TITLE,
    label: "title-only",
  });
  assert.equal(out.titleChanged, true);
  assert.equal(out.descriptionConflict, null);
  assert.equal(out.checkedChanged, false);
});

test("engine-classify — checkbox-only change sets checkedChanged and leaves descriptionConflict null (US1 AC5 shape)", () => {
  const out = classify({
    mode: "sync",
    spec: BASELINE,
    issue: BASELINE,
    baseline: BASELINE,
    checked: true,
    checkpointChecked: false,
    label: "checked-only",
  });
  assert.equal(out.checkedChanged, true);
  assert.equal(out.descriptionConflict, null);
  assert.equal(out.titleChanged, false);

  const back = classify({
    mode: "sync",
    spec: BASELINE,
    issue: BASELINE,
    baseline: BASELINE,
    checked: false,
    checkpointChecked: true,
    label: "unchecked-only",
  });
  assert.equal(back.checkedChanged, true);
  assert.equal(back.descriptionConflict, null);
});

test("engine-classify — absent checkbox normalizes to false (heading tasks never drift against a checked:false checkpoint; a checkpointed check against a checkbox-less task IS a change)", () => {
  // Modeling choice forced by the optional `checked?` fields: comparison is
  // `(task.checked ?? false) !== (checkpoint.checked ?? false)`.
  const quiet = classify({
    mode: "sync",
    spec: BASELINE,
    issue: BASELINE,
    baseline: BASELINE,
    checkpointChecked: false, // task has NO checkbox
    label: "absent-vs-false",
  });
  assert.equal(quiet.checkedChanged, false);

  const lost = classify({
    mode: "sync",
    spec: BASELINE,
    issue: BASELINE,
    baseline: BASELINE,
    // task.checked absent vs checkpoint recorded `true` (checkbox stripped from the line)
    checkpointChecked: true,
    label: "absent-vs-true",
  });
  assert.equal(lost.checkedChanged, true);
  assert.equal(lost.descriptionConflict, null);
});

test("engine-classify — stateTypeDrift must stay false for every input this frozen ClassificationInput shape can express (no live tracker state type is delivered to classify)", () => {
  // MODELING CHOICE (report for T020): `ClassificationInput` carries no live issue
  // workflow state, so state-type drift is undecidable HERE (data-model §3 defines it
  // as *tracker* state ≠ Checkpoint.issueStateType). T020 must either widen the input
  // BACKWARD-COMPATIBLY (an OPTIONAL field — my literals below set no such field and
  // must keep compiling + passing) or merge drift upstream in `build.ts`. Whatever the
  // route, a checkpoint state type alone is NOT drift — there is nothing to compare it
  // against inside this boundary — so every classification of these inputs reports
  // false, and drift must still NEVER populate descriptionConflict (matrix §5).
  const done = classify({ mode: "sync", spec: BASELINE, issue: BASELINE, baseline: BASELINE, stateType: "done", label: "drift-done" });
  assert.equal(done.stateTypeDrift, false);
  assert.equal(done.descriptionConflict, null);

  const backlog = classify({
    mode: "sync",
    spec: BASELINE,
    issue: BASELINE,
    baseline: BASELINE,
    stateType: "backlog",
    checked: true, // a toggle alongside a moved tracker state: still no description conflict
    checkpointChecked: false,
    label: "drift-toggle",
  });
  assert.equal(backlog.stateTypeDrift, false);
  assert.equal(backlog.checkedChanged, true);
  assert.equal(backlog.descriptionConflict, null);
});

// ──────────────────────────────────────────────── formatting-only drift (SC-002)

test("engine-classify — formatting-only drift on BOTH sides classifies null (SC-002; R3 single-baseline invariant)", () => {
  // Encode the R3 invariant explicitly: the checkpoint holds sha256(normalize(baseline))
  // and BOTH noisy sides re-hash to exactly that stored value before classify is even
  // consulted — drift is permanently invisible, oscillation structurally impossible.
  const specSide = crlf(trailingWs(blankRuns(tabBlankLines(trailingNewlines(BASELINE)))));
  const issueSide = nfd(crOnly(trailingWs(tabBlankLines(BASELINE))));

  assert.equal(normalizedContentHash(defaultDescriptionNormalizer, specSide), normalizedContentHash(defaultDescriptionNormalizer, BASELINE));
  assert.equal(normalizedContentHash(defaultDescriptionNormalizer, issueSide), normalizedContentHash(defaultDescriptionNormalizer, BASELINE));

  const out = classify({ mode: "sync", spec: specSide, issue: issueSide, baseline: BASELINE, label: "noise" });
  assert.equal(out.descriptionConflict, null);

  // …and the noise is equally invisible in bootstrap (normalized side-vs-side).
  const boot = classify({ mode: "bootstrap", spec: specSide, issue: issueSide, label: "noise-boot" });
  assert.equal(boot.descriptionConflict, null);
});

test("engine-classify — content-bearing Markdown drift is NOT invisible: heading `#` count and emphasis changes classify (R5 boundary)", () => {
  const demoted = classify({ mode: "sync", spec: DEMOTED, issue: BASELINE, baseline: BASELINE, label: "heading" });
  assert.equal(demoted.descriptionConflict, "spec-changed");

  const unbolded = classify({
    mode: "sync",
    spec: BASELINE,
    issue: BASELINE.replace("**naïve**", "naïve"),
    baseline: BASELINE,
    label: "emphasis",
  });
  assert.equal(unbolded.descriptionConflict, "linear-changed");
});

test("engine-classify — hashing uses the input profile, never a hard-coded built-in (R5 profile seam; constitution III)", () => {
  // A profile that equates case: under IT the sides are identical ⇒ null…
  const caseFold: DescriptionNormalizer = (text) => text.toLowerCase();
  const folded = classify({
    mode: "sync",
    spec: "WIRE THE WIDGET",
    issue: "wire the widget",
    baseline: "Wire the widget",
    profile: caseFold,
    label: "folded",
  });
  assert.equal(folded.descriptionConflict, null);

  // …while the SAME inputs under the default profile are real drift on both sides.
  const exact = classify({
    mode: "sync",
    spec: "WIRE THE WIDGET",
    issue: "wire the widget",
    baseline: "Wire the widget",
    label: "exact",
  });
  assert.equal(exact.descriptionConflict, "both-changed");
});

// ──────────────────────────────────────────────── reasons (FR-005) + freeze + purity

test("engine-classify — reasons carry machine-readable labels including the conflict type (FR-005), and no conflict-type label appears when there is no conflict", () => {
  const cases: ReadonlyArray<{ readonly type: DescriptionConflictType; readonly s: Scenario }> = [
    { type: "spec-changed", s: { mode: "sync", spec: REVISED, issue: BASELINE, baseline: BASELINE, label: "r-spec" } },
    { type: "linear-changed", s: { mode: "sync", spec: BASELINE, issue: REVISED, baseline: BASELINE, label: "r-lin" } },
    { type: "both-changed", s: { mode: "sync", spec: REVISED, issue: DEMOTED, baseline: BASELINE, label: "r-both" } },
    { type: "both-changed", s: { mode: "bootstrap", spec: BASELINE, issue: REVISED, label: "r-boot" } },
  ];
  for (const { type, s } of cases) {
    const out = classify(s);
    assert.ok(Array.isArray(out.reasons) && out.reasons.every((r) => typeof r === "string"), "reasons is a list of machine-readable strings");
    assert.ok(
      out.reasons.some((r) => r.includes(type)),
      `expected a reason label carrying conflict type "${type}", got: ${JSON.stringify(out.reasons)}`,
    );
  }

  const calm = classify({ mode: "sync", spec: BASELINE, issue: BASELINE, baseline: BASELINE, label: "r-calm" });
  assert.ok(Array.isArray(calm.reasons));
  assert.deepEqual(
    calm.reasons.filter((r) => CONFLICT_TYPES.some((t) => r.includes(t))),
    [],
    "no description-conflict label may surface without a conflict (SC-001 zero-change second run)",
  );
});

test("engine-classify — unresolvedConflict passes through from Task (data-model §3) and classification still runs against the stored baseline (matrix §4: removal returns to NORMAL classification; the freeze governs plan/apply, not the outcome shape)", () => {
  const frozenClean = classify({
    mode: "sync",
    spec: BASELINE,
    issue: BASELINE,
    baseline: BASELINE,
    unresolved: true,
    label: "frozen-clean",
  });
  assert.equal(frozenClean.unresolvedConflict, true);
  assert.equal(frozenClean.descriptionConflict, null); // content intact vs the checkpoint

  // While a block is present its marker text changes the section hash — classification
  // still reports the hash verdict against the preserved baseline (data-model §3
  // validation names ONLY checkpoint absence as the suppression condition), and the
  // freeze flag rides along independently.
  const frozenEdited = classify({
    mode: "sync",
    spec: BASELINE.replace("- Step two", "<<<<<<< sync:local specs/demo-feature/tasks.md#L4\n- Step two\n=======\n- Step two (tracker)\n>>>>>>> sync:linear SYNC-1"),
    issue: BASELINE,
    baseline: BASELINE,
    unresolved: true,
    label: "frozen-edited",
  });
  assert.equal(frozenEdited.unresolvedConflict, true);
  assert.equal(frozenEdited.descriptionConflict, "spec-changed");
});

test("engine-classify — classification is pure and deterministic: the same input yields a deep-equal outcome", () => {
  const input = scenarioInput({ mode: "sync", spec: REVISED, issue: DEMOTED, baseline: BASELINE, label: "pure", checked: true, checkpointChecked: false });
  const first = classifyTask(input);
  const second = classifyTask(input);
  assert.deepEqual(first, second);
});
