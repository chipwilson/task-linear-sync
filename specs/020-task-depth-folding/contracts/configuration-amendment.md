# Contract Amendment Record: Feature 020 (Task-Depth Folding)

Frozen-surface deltas this feature carries, in the form they must land.
Precedents: 014's dated configuration amendment (six bounded keys) and 018's
inline requirements amendments (`A-018-1`, `A-018-2`). This record is the
source text for the implementation phase; Governance requires all three
records to land in the same PR as the code (and they are gated by C10).

## A-020-1 — `specs/002-core-domain-contracts/contracts/configuration.md`

Append a dated amendment block (style: the 2026-11-06 014 amendment):

> **Amendment 2026-11-DD (feature 020 — task-depth folding).** The optional
> key `maxTaskIssueDepth?: number` is added to the configuration model
> (parsing/sync-semantics group). Valid values are integers `1..64`; the
> value is absent by default, and absence means unlimited depth — the
> pre-amendment behavior, reproduced byte-for-byte (the key is NOT present in
> `builtInDefaults`). Lane-entry validation (parsing entry, every surface):
> a present value outside the range or not an integer raises a typed named
> failure identifying `maxTaskIssueDepth` and the offending value; nothing is
> parsed, mutated, or written. Layering, merge semantics, and the three
> config-file failure categories are unchanged. Credential posture unchanged
> (this key is not a credential and names none).

## A-020-2 — `specs/requirements.md` (inline amendments)

Two additive amendments, tagged in the 018 style:

1. **Requirement 2 (parsing), new clause** after the indent-stack/exclusion
   clauses:

   > WHEN the configuration supplies `maxTaskIssueDepth` (integer 1..64;
   > absent by default meaning unlimited; invalid values refused with a named
   > diagnostic before any parsing — 020 amendment A-020-2), THE System SHALL
   > treat every task whose depth — computed as 1 for heading tasks and
   > 1 plus the depth of the nearest task ancestor otherwise, per the indent
   > stack and orphan rules — exceeds that maximum as recognized-but-excluded
   > content with a dedicated fold exclusion reason, keeping its line verbatim
   > within the nearest surviving ancestor task's `Task_Body` region, and
   > SHALL NOT create, rewrite, or reference-marker that line; folded lines
   > SHALL appear in no match, plan, report, or gate evaluation.

2. **Requirement 17.4 (defaults enumeration)**: append
   `maxTaskIssueDepth` (absent default — unlimited) to the overridable
   defaults list sentence, matching the amendment-1 wording.

## A-020-3 — `docs/contract-amendments.md`

One entry following the file's existing format: additive configuration key
+ additive exclusion-reason value + new parsing-surface error export; no
breaking change (0.x minor line; default posture preserves every existing
consumer's behavior).

## Documentation duty matrix (FR-008 — same PR as code)

| File | Change |
|---|---|
| `docs/configuration-reference.md` | New Grammar-table row (`maxTaskIssueDepth`, default *absent* → unlimited, bounds 1..64, named-refusal note) + addition to the "defaults to absent" list |
| `docs/configuration.md` | One cross-reference line (key lives in the reference; refusal at the parsing entry) |
| `docs/parsing.md` | Fold rule + depth definition + `depth-folded` row in the exclusion-reason table; span-invariance note (C4) |
| `README.md` | One sentence in the adapter-selection paragraph ("how deep nested checklists become their own issues is configurable — `maxTaskIssueDepth`") pointing at the reference |
| `CHANGELOG.md` | `[Unreleased]` feature entry (keep-a-changelog grammar stays green) |
| `docs/contract-amendments.md` | A-020-3 record |

All examples use placeholder identifiers; the truthfulness culture of 019
applies: every documented default must match `src/config/schema.ts` and the
validation code exactly.

## Test duty matrix (FR-009 — every contract rule gated)

| Tier | File (new `+` / updated `~`) | Rules |
|---|---|---|
| unit | `tests/unit/parsing-depth-fold.test.ts` (+) | C2–C6 depth/fold/exclusion/validation matrices |
| unit | `tests/unit/config-schema.test.ts` (~/existing config test) | C1 optional-key merge/round-trip |
| parsing golden | `tests/unit/parsing-golden*` (~/world add) | C4 span invariance across caps |
| types | `tests/types/parsing.test-d.ts`, config type pins (~) | C5 union, C1 field, C10 surface |
| contract | `tests/contract/parsing-surface.test.ts` + snapshot (~ deliberate via `UPDATE_PARSING_SNAPSHOT=1`) | C5, C10 |
| contract | `tests/contract/defaults-scan.test.ts` (unchanged, must stay green) | C1 (no default added) |
| integration | engine plan scenarios over a new `depth-folding` fixture world (+) | C3, C4, C7 (zero archive), C8 |
| e2e | CLI: invalid cap → exit 3; `inventory` folded counts; double-run byte-diff (+) | C6, C9 |
| CI lane | CI-action scenario on folded fixture — three gate conditions (~ existing suite) | C8 |

Regression gate: with the key absent, every pre-existing test passes
unmodified (SC-001 / C1) — the amendment is provably behavior-preserving.
