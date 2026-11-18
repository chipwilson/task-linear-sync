# Phase 0 Research: Task-Depth Folding

All "as-built" statements below were verified against the working tree at
branch `020-task-depth-folding` (main `581e45c`+), the way the 019 audit
method requires: source pointers, not recollection.

## Verified baseline behavior (research inputs)

- Task parentage is the indent stack + orphan rule: deeper-indented checklist
  tasks adopt the nearest shallower checklist task, else the enclosing heading
  task (`src/parsing/extract.ts:119,179–202`). Heading drafts always have
  `parent: null` (`extract.ts:158`).
- `Task.parentUuid` / `Task.childUuids` are built in `src/parsing/taskfile.ts:83–96`;
  the engine turns `parentUuid` into the Linear `parentId` at create
  (`src/engine/apply.ts:908,979–983`) and mandates parent-before-child order
  (`specs/requirements.md`, apply-lane requirement).
- `Task_Body` extents keep descendant task lines INSIDE the ancestor's section
  (`src/parsing/extent.ts` — boundary = next NON-descendant task or a
  heading at/above the task's level). So a parent's mirrored description
  already contains its whole subtree verbatim today; folding changes which
  lines are tasks, not what the parent body covers.
- The `spec-superpower` adapter already demonstrates the fold pattern via
  `rollupPattern: "^\\s*[-*+]\\s*\\[[ xX]\\]"` — checkboxes become exclusions
  and verbatim body content (`src/discovery/adapters/spec-superpower.ts:24-25`).
- Exclusion records carry `reason: "summary-section" | "rollup"` and kind
  `"checklist"` (`src/parsing/extract.ts:21`); exclusions do NOT flow into
  plan/report layers (grep-verified in `src/engine/report.ts`/`build.ts`).
- Precedent for extending the frozen configuration contract: feature 014's
  dated amendment added six bounded keys; precedent for amending
  `specs/requirements.md` inline: 018 `A-018-1/A-018-2` tags.
- Absent-by-default typed keys precedent: `stateDirectory`,
  `historyLogMaxBytes`, `syncAttachmentSubtitle`, `agentHooksDirectory`
  (`src/config/schema.ts`). (Precedent stands for those keys; per the
  Maintainer Ruling 2026-11-18 `maxTaskIssueDepth` does NOT follow it — it
  ships a built-in default, see reversed R1.)
- Lane-entry config validation precedent: `src/matching/config-check.ts`
  (named problems at lane entry); `loadConfig()` is deliberately merge-only
  (`src/config/load.ts`), identity validation is a separate explicit gate.

## R1 — Key name, type, and default posture (REVERSED)

- **Decision** — **Maintainer Ruling 2026-11-18, documented reversal**:
  `maxTaskIssueDepth?: number` on `ResolvedConfig` (and the
  `ConfigOverrides` twin), integer range **1..64**, **built-in default 1**
  carried by `builtInDefaults` (`src/config/defaults.ts:34`, Grammar block
  lines 49–55). An absent value resolves to that built-in default at the
  parsing entry, so the default posture is a flat board; the pre-feature
  (effectively unlimited) behavior is reached by explicitly configuring
  `64` (practically-unlimited escape hatch — every existing fixture is far
  shallower).
- **Reversal rationale**: the ruling adopts the previously-rejected
  "value in `builtInDefaults`" option, at value `1`, honestly — it is a
  documented default applied when the consumer does not override (Principle
  III), not a magic sentinel number. SC-001 moves accordingly: pre-feature
  byte fidelity is asserted at explicit `64`, never at absence. 1..64 still
  mirrors the 014 bounded-key posture.
- **Original decision (superseded 2026-11-18)**: absent by default, absent
  = unlimited, `builtInDefaults` untouched so default drift was
  structurally impossible. The maintainer reversed it: that posture traded
  Principle III's ship-a-sensible-default duty for a structurally frozen
  defaults snapshot; the intelligent default is 1.
- **Alternatives considered**:
  - `maxIssueTaskDepth` (earlier shorthand) — rejected: reads as "depth of an
    issue's tasks"; the cap is on *task tree depth at which tasks get issues*.
  - Enum `subIssueMode: "issues" | "fold-into-parent"` — rejected: loses the
    two-level board (US2); a depth cap subsumes the boolean case (`1`).
  - Shipping the large default `64` in `builtInDefaults` — rejected (and
    stays rejected): `64` is the escape hatch consumers opt into, not the
    default; the intelligent default is `1` per the ruling.

## R2 — Depth semantics

- **Decision**: depth is computed on the FULL task tree before any folding:
  heading tasks are depth 1; a checklist task is 1 + depth(nearest task
  ancestor by the existing parent pointer). A task is folded iff
  `depth > maxTaskIssueDepth`. Because depth strictly increases down a chain,
  folding a subtree is automatic — every descendant of a folded task is also
  over the cap.
- **Rationale**: uses the frozen indent/orphan rules as the single source of
  parentage (no new grammar); yields the clean invariant that cap 1 ⇔ zero
  tasks carry `parentUuid` ⇔ the engine creates zero Linear sub-issues. A
  checklist task orphaned directly under a heading task is depth 2 and folds
  at cap 1 — that IS the requested "no sub-issues" behavior.
- **Alternatives**: counting only checklist levels (heading not a level) —
  rejected: contradicts the frozen orphan rule (the heading IS the parent) and
  would silently keep sub-issues under headings at cap 1.

## R3 — Fold point and mechanics (parsing lane)

- **Decision**: fold in the pure parsing lane. After `extractTasks` builds the
  draft tree and depths are computed (new pure module `src/parsing/depth.ts`),
  drafts over the cap are removed from the returned task list and pushed into
  `exclusions` with `kind: "checklist"`, `reason: "depth-folded"`. Surviving
  drafts keep their existing structure; `taskfile.ts` builds uuids/parentUuid/
  childUuids only from surviving drafts; `deriveExtents` sees folded lines as
  ordinary non-task lines — and since descendant lines were already inside the
  ancestor's extent, the parent body content is identical to today's.
- **Rationale**: zero changes to matching/engine/report/gates/CI (folded
  lines never exist as tasks); determinism holds (pure function of content +
  conventions + cap); renderer needs no change — folded lines are unassigned
  and reproduce byte-for-byte, and no reference token is ever written to them.
- **Alternatives**:
  - Engine-level "task but no issue" verdict — rejected (Option B): ripples a
    new verdict through the frozen 002/008/009 plan/report/checkpoint schemas,
    matching, gates, and CI counting for the same user-visible outcome.
  - `rollupPattern` pattern workaround (documented, stays as the escape
    hatch) — insufficient: pattern-based not depth-aware, global across
    adapters, and clobbers adapter rows that ship their own pattern.

## R4 — Validation point and failure shape

- **Decision**: a pure, typed validation helper (e.g. `validateTaskDepthConfig`)
  runs at the `parseTaskFile` entry for every lane; an absent value resolves
  to the built-in default `1`; a
  present-but-invalid value (non-integer, < 1, > 64) throws a named
  configuration error carrying the key name and the offending value. The CLI
  maps it to exit code 3 (configuration) — verify the existing error-mapping
  reaches 3; add a single mapping line if it does not.
- **Rationale**: `loadConfig` is merge-only by design; lane-entry config
  checks are the established pattern (`matching/config-check.ts`); plan-build
  parses before any mutation, so refusal is mutation-free in every lane
  (SC-004) — CLI, programmatic API, worker, MCP, CI action all share the one
  choke point. The diagnostic carries only a key name and a number — no
  identifier to screen.
- **Alternatives**: reject in `loadConfig` (rejected — breaks its contract and
  the three-category file-failure posture); clamp silently (rejected — the
  codebase's stated posture is "fail loudly, never silently fall back").

## R5 — Exclusion reason vocabulary

- **Decision**: extend the frozen reason union to
  `"summary-section" | "rollup" | "depth-folded"`.
- **Rationale**: kebab-case parity with the existing values; "folded" alone is
  ambiguous against rollup; distinct reason keeps the audit story honest
  (a folded line was a *task candidate*, unlike body text).
- **Alternatives**: reuse `"rollup"` (rejected — conflates grammar exclusion
  with policy folding and would mislead the parsing docs); reuse
  summary-section semantics (nonsense).

## R6 — Identity churn on toggle (accepted risk)

- **Decision**: accept documented churn. Ordinal = position among SURVIVING
  tasks (unchanged definition). Changing the cap (or the content) can shift
  ordinals for tasks whose seed falls back to `ordinal:filePath`;
  local-id-seeded tasks never shift, and any task whose line already carries
  a visible issue-reference token re-matches via `issueRefExact` (500 ≫ the
  50 medium floor) even when its UUID shifts. Ship guidance, not migration:
  set the cap before the first sync; prefer local ids where toggling is
  plausible. No auto-archive of orphaned child issues (report-only via the
  existing unmapped-issues section).
- **Rationale**: no ordinal scheme can be invariant across arbitrary cap
  changes (ordinal is defined over the task set); the durable-identity
  machinery is untouched; report-only orphans preserve Principle I.
- **Alternatives**: reserve ordinals for folded drafts (rejected — ordinals
  still shift whenever the folded SET changes; adds complexity for a partial
  fix); automatic archive on tightening (rejected — a destructive default;
  rollback's archive machinery stays rollback-only).

## R7 — Scope: global key, no CLI flag, no per-adapter lane

- **Decision**: the cap is a single global configuration key. No CLI flag, no
  per-adapter override lane in this feature, no CI action input.
- **Rationale**: per-adapter suppression already exists through the
  programmatic `overrides.adapters.<id>` lane (`rollupPattern`); a flag would
  fork the precedence model (flags today carry only per-command concerns; the
  config file is the single config surface besides programmatic overrides).
- **Alternatives**: per-adapter `maxTaskIssueDepth` in the overrides lane —
  plausible follow-up, deliberately deferred (YAGNI; keeps the amendment
  minimal).

## R8 — Downstream surfaces (verified: nothing to change)

- Plan/report/gates: folded lines are not tasks ⇒ never matched, never counted
  by `fail-on-unmapped`, never conflict-checked. `check --json` totals simply
  exclude them (consistent with all exclusions).
- History/attachments/rollback: keyed per surviving task — unchanged.
- CI action inputs: unchanged semantics (three gate conditions untouched).
- MCP: plans come from the same engine ⇒ automatically consistent.

## R9 — Frozen-surface and snapshot amendments (exact list)

- `src/config/schema.ts`: + `readonly maxTaskIssueDepth?: number` (ResolvedConfig).
- `src/parsing/extract.ts`: reason union + `"depth-folded"`; the new typed
  error class IS exported from the parsing surface, so the
  `parsing-surface` snapshot is amended deliberately (`UPDATE_PARSING_SNAPSHOT=1 npm run test:contract`).
- `tests/types/`: config-shape and exclusion-union type pins extended.
- `src/config/defaults.ts`: `builtInDefaults` (Grammar block lines 49–55)
  IS touched — `maxTaskIssueDepth: 1` is added (reversed R1 ships the
  default; the key is never absent post-`loadConfig` for the effective
  value). `defaults-scan` is **verified green**, not unchanged: the added
  value is a benign integer and the release scan still passes.
- `tests/contract/snapshots/frozen-surface.json`: amended deliberately for
  the new default (`UPDATE_FROZEN_SNAPSHOT=1 npm run test:contract`).
- Amendment records: `specs/002-core-domain-contracts/contracts/configuration.md`
  (dated amendment), `specs/requirements.md` (inline `A-020-1/A-020-2`),
  `docs/contract-amendments.md` entry.

## R10 — Documentation placement

- **Decision**: configuration-reference: new row in the Grammar table (it is
  task-detection semantics) with default `1`, NOT added to the "defaults to
  absent" list — it ships a built-in default per the ruling, and a pointer
  note under that list explains why;
  configuration.md: cross-reference line; parsing.md: fold rule + reason
  table row; README: one sentence in the adapter-selection paragraph pointing
  at the key; CHANGELOG + contract-amendments records.
- **Rationale**: keeps the exhaustive catalogue truthful (it is a per-key
  contract); README stays a pointer, not a second table.
- **Alternatives**: new docs page — rejected (fragmentation; configuration
  reference already owns per-key truth).

## Open questions

None — all NEEDS CLARIFICATION resolved; spec FR-001..FR-009 fully determined.
