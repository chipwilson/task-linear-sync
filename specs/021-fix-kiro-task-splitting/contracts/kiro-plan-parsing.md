# Contract: Shared-Default Task Extraction for Title-Headed Checklist Documents (C1–C9)

Behavioral contract for the parsing core shared by the default-grammar adapters (kiro, generic, spec-kit,
bmad, open-spec). This is the contract the new tests enforce; it is additive to the frozen
`contracts/framework-adapter.md` built-in table and the 020 fold contract, and implements requirements
amendments A-021-1, A-021-2, A-021-3 (`specs/requirements.md` Requirement 2 criteria 2/4/9/13;
Requirement 15.4).

## Scope

Applies to every task file parsed through `parseTaskFile` with the effective built-in default grammars,
regardless of adapter classification. Adapter-supplied grammar overrides (`spec-kitty`,
`spec-superpower`) keep their precedence and are out of amendment scope (pinned immune, C9).

## Rules

- **C1 — Document-title heading.** A heading task is the document-title heading iff: first non-blank
  non-fenced line of the file; ATX level 1; matches the heading grammar; yields no `Local_Task_ID`. It
  remains a heading task with title = full heading text and a `Task_Body` ending before the first
  following task line.
- **C2 — Orphan adoption exemption.** With an empty indent stack, a column-0 checklist line adopts the
  current heading task as parent EXCEPT when that heading is the document-title heading; then parent is
  `null` and depth is 1. All other orphan-adoption behavior is unchanged.
- **C3 — Flat-document equivalence.** A document whose only grammar-matching heading is the
  document-title heading is a flat document (criterion 9); the determination governs C2 and the internal
  flat-document signal MUST equal it (dead-flag disposition; no public API change).
- **C4 — Per-task regions.** Each surviving task's `Task_Body` spans its own line to the next task line
  or heading (exclusive), including its own indented detail bullets and annotation lines; a task
  immediately followed by another task line has an empty body. No task's `Task_Body` MAY contain text
  belonging to another task, and no `Task_Body` spans the whole file when the file holds multiple tasks.
- **C5 — Fold invariance.** Depth computation and the A-020-2 fold rule are unchanged; after C2, a file
  with top-level checkbox tasks MUST retain zero `depth-folded` exclusions attributable to the
  document-title heading.
- **C6 — Identifier grammar (word form).** The heading grammar's word-form id branch MUST require a
  digit; `# Implementation Plan` yields no id and title `Implementation Plan`; `TASK-1`/`SYNC1`/`T001`
  ids still parse.
- **C7 — Identifier grammar (dotted numeric).** A checklist line beginning with a dotted-numeric id
  followed by whitespace captures it as `Local_Task_ID` separator-free (`- [x] 4.1 Create …` → id `4.1`,
  title `Create …`); bare integers still require a trailing separator; adapter `checklistIdPattern`
  overrides keep precedence.
- **C8 — Classification parity.** Identical content parsed under kiro and generic classification MUST
  produce identical extraction results (tasks, kinds, ids, titles, depths, extents, exclusions).
- **C9 — Immunity pins.** spec-kitty (no heading tasks; dotted-id capture) and spec-superpower
  (`Task N:` heading tasks; every checkbox a rollup-excluded body line) parse exactly as today; the
  existing corpus fixture, goldens, depth-folding worlds, and `parsing-corpus.test.ts` expectations are
  byte-unchanged.

## Reported-file conformance (fixture `tests/fixtures/parsing/kiro-plan/tasks.md`)

At **default** configuration (no `maxTaskIssueDepth` override): 14 task drafts — 13 checklist tasks
(depth 1; ids `1`,`2`,`3`,`4`,`4.1`,`4.2`,`4.3`,`5`–`10`; checked all `true`) + 1 title-heading task
(`Implementation Plan`, no id, body = preamble only); 0 `depth-folded` exclusions; mirrored issue
descriptions equal each task's own region; a created-issue set in which no description contains another
task's content. Sync-level: 14 creates on first apply, 0 actions on re-plan, 1 update on a single
checkbox toggle.
