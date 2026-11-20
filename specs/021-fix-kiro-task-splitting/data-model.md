# Phase 1 Data Model: Per-Task Splitting of Kiro Implementation-Plan Task Files

Entities introduced or amended by amendments A-021-1/2/3 (specs/requirements.md Requirement 2). The
existing frozen entities (`Task`, `TaskDraft`, `Task_Body`, `Local_Task_ID`, exclusion records, depth
model) are unchanged in shape; only the rules that populate them change.

## 1. Document_Title_Heading (new parsing concept — A-021-1)

The heading that names a document rather than a task.

| Field/Condition | Rule (validation) |
|-----------------|-------------------|
| Position | The document's first non-blank, non-fenced line |
| Level | ATX level exactly 1 |
| Grammar | Matches the effective heading-id grammar (i.e. it would otherwise be a heading task) |
| Local id | Its title span yields **no** `Local_Task_ID` under the A-021-2 grammar |
| Uniqueness | At most one per document; a second level-1 heading mid-file is an ordinary heading task |

Relationships: still produces a `heading` task draft (title = full remaining heading text, no id), with
`Task_Body` ending immediately before the first following task line (its preamble only — possibly empty).
It is **not** eligible as an orphan-adoption parent: a column-0 checklist line whose indent stack is empty
attaches to no heading while the document-title heading is the "current heading" (state transition:
`currentHeading` adoption → skipped → parent `null` → depth 1).

Validation rules:
- V1: if the first line is a level-1 heading whose title yields a `Local_Task_ID` (e.g. `# Task 1: x`),
  it is a normal heading task; the orphan rule is unchanged beneath it.
- V2: fenced `# …` lines never qualify (fence content is non-task text per Requirement 2 criterion 1).
- V3: a file whose first non-blank line is a checkbox has no title heading (flat document by criterion 9,
  second trigger — behavior unchanged).

## 2. Flat_Document determination (amended — A-021-3)

| Input state | Flat? |
|-------------|-------|
| No grammar-matching heading at all | true (unchanged) |
| Only grammar-matching heading is the Document_Title_Heading | **true** (amended; previously false) |
| Any other grammar-matching heading present | false (unchanged) |
| Configured flat-checklist path markers match | true (unchanged, overridable) |

The determination is now **normative for top-level checkbox parenting** (it governs the extract.ts orphan
decision) and must equal the result of Rule 1; the previously dead `flatDocument` flag is repointed to
this determination (or removed as an internal detail) — no public API surface changes.

## 3. Checklist task (amended depth/parenting only)

Top-level (`indent 0` after tab normalization) checkbox under a Document_Title_Heading:

| Attribute | Before | After |
|-----------|--------|-------|
| parent | the title heading draft | `null` |
| depth | 2 → `depth-folded` at default cap 1 | 1 → survives default flat board |
| `Task_Body` | n/a (folded away) | own line → next task line or heading; own detail bullets and `_Requirements:_` lines included; empty when the next line is another task |
| `Stable_UUID` seed | n/a | `Framework_Id` + `Feature_Name` + `Local_Task_ID` (when captured) else ordinal |

Validation rules:
- V4: checked and unchecked checklist lines are treated identically for survival (checkbox state is
  mutable content, excluded from identity seeds).
- V5: un-checkboxed detail bullets and italic annotation lines are content, never tasks, never boundaries.
- V6: same content under `kiro` or `generic` classification MUST extract identically (spec FR-008).

## 4. Local_Task_ID capture (amended — A-021-2)

| Line shape | Before | After |
|------------|--------|-------|
| `# Implementation Plan` | id `Implementation`, title `Plan` | no id, title `Implementation Plan` |
| `# TASK-1: Boot` / `## SYNC1: Boot` | id captured | id captured (unchanged — contains a digit) |
| `- [x] 1. Set up …` | id `1` | id `1` (unchanged; separator still required for bare integers) |
| `- [x] 4.1 Create EC2 …` | no id (ordinal identity), title keeps `4.1 ` | **id `4.1`**, title `Create EC2 client wrapper with retry logic` |
| `- [x] 2 of 3 done` | no id | no id (unchanged; not dotted-numeric) |
| `Task 2.1: …` / `1.2.3: …` | id captured via separator span | id captured (unchanged) |

Validation rules:
- V7: word-form ids MUST contain at least one digit; the numeric/dotted-numeric branch is unchanged.
- V8: dotted-numeric capture requires whitespace + text after the id; the captured id is stored
  separator-free; the rendered line preserves the original text (Requirement 3 criterion 1 pins id
  preservation — re-verified by golden round-trip, research R8).
- V9: an adapter-supplied `checklistIdPattern` (e.g. spec-kitty) keeps precedence over the built-in span.

## 5. Unchanged, pinned entities (regression invariants)

- Heading task depth is always 1; headings at-or-above a heading task still bound `Task_Body` extents.
- Orphan adoption beneath **non-title** headings (e.g. `## 9.0:`) is unchanged — depth-2 orphans still
  fold into the nearest surviving ancestor's `Task_Body` (world `depth-folding-flat` pin).
- spec-kitty (`"(?!)"` heading grammar, own id pattern) and spec-superpower (`Task N:` grammar,
  checkbox-rollup capture, `identityFileScope`) rows are byte-identical (immunity pins).
- Exclusion record vocabulary (`summary-section`, `rollup`, `depth-folded`) is unchanged in shape; the
  reported file now produces **zero** `depth-folded` exclusions (a signal, not a schema change).
