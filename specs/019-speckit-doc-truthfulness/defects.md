# Follow-up Entries (defect log)

Entries are append-only except `Status` (contract:
[contracts/audit-record-format.md](./contracts/audit-record-format.md)). Category
`defect` is permitted only for claims whose audit entry carries
`Requirements check: requirements-mandate-code-lacks` (FR-005; unimplemented mandates
are never deleted from `specs/requirements.md` to make docs match).

### FU-001 — separator-free checklist identifier capture

- **Category**: enhancement
- **Source claim**: C-002
- **Expectation**: reader-facing expectation that Spec Kit `- [ ] T001 …` checkbox
  ids sync as `Local_Task_ID`s.
- **As built**: `LOCAL_ID_SPAN_RE` (src/parsing/content.ts) requires separator
  punctuation + whitespace after the id; Spec Kit prints a plain space, so checkbox
  tasks sync without local ids (ordinal fallback).
- **Suggested home**: a future feature amending requirements R2.12 grammar +
  `docs/parsing.md`.
- **Status**: open

### FU-002 — mandated grammar defaults in requirements.md not shipped

- **Category**: defect
- **Source claim**: C-054, C-055, C-056, C-057, C-059
- **Expectation**: requirements.md R2.2/R2.5/R2.6/R2.7/R2.8 mandate specific default
  grammars — heading-id `(?:[A-Z][A-Z0-9_]{1,8}-\d+(?:\.\d+)?|Task\s+\d+(?:\.\d+)?|T\d{2,5})`,
  phase `(?:phase|story|milestone)\s+\d+`, the seven-phrase summary default, the
  bold-label rollup defaults, and an EMPTY flat-checklist marker list.
- **As built**: src/config/defaults.ts:50-54 ships different, broader/narrower
  defaults (`headingIdGrammar` captures a single leading token; `phasePattern`
  matches only `Phase <n>` in H1/H2; `summaryPattern` is `Summary|Overview` at
  levels 2–4; `rollupPattern` is `parent|roll-?up`; `flatChecklistMarkers` is
  non-empty checkbox literals). Behavior exists; the mandated DEFAULT VALUES do
  not match.
- **Suggested home**: a future feature aligning shipped defaults with the
  requirement (or amending the requirement defaults); per Governance the
  requirement text stays until then.
- **Status**: open

### FU-003 — checklist identifier grammar is not adapter-supplied

- **Category**: defect
- **Source claim**: C-058
- **Expectation**: requirements.md R7.4 mandates that the active `Framework_Adapter`
  supply "heading/checklist identifier grammar" (adapter- or config-provided).
- **As built**: adapters/config supply only the **heading** grammar
  (`headingIdGrammar`); the checklist leading-id span grammar (`LOCAL_ID_SPAN_RE`,
  src/parsing/content.ts:167-168) is a module-local constant — not adapter-supplied
  and not configurable.
- **Suggested home**: a future feature threading the checklist grammar into
  adapter conventions/config; per Governance the requirement text stays until then.
- **Status**: open
