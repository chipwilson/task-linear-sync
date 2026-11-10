# Contract: Doc-Truthfulness Guard Suite (`tests/contract/doc-truthfulness.test.ts`)

**Feature**: `019-speckit-doc-truthfulness` | **Pattern source**: feature 016
`tests/contract/framework-support-consistency.test.ts` (consumed and extended, not
duplicated — claims already pinned there, C-004/C-005, MUST NOT be re-pinned here)

## Interface presented

The suite is a CI contract check, not a runtime API. Its observable contract is the
set of named test names it registers in the `contract` tier:

- Runner: `node:test`, zero dependencies, static inputs only
  (`readFileSync` of the audited documents + `audit.md`/`defects.md`). No I/O outside
  the repository, no clock, no network — deterministic and hermetic (Principle VI).
- Every `test()` name starts with `doc-truthfulness: ` and embeds its guard id, so a
  CI failure names the guard, e.g.
  `doc-truthfulness: GUARD-01 disproven tags-and-edges phrasing stays out of audited docs`.
- Failure messages MUST name the guard id, the audit entry (`C-\d{3}`), and the
  offending document — a reader must not need the test source to find the record.

## Guard catalog

### Family 1 — forbidden phrasing (reintroduction guards, FR-006)

Each guard is `assert.doesNotMatch` over the concatenated audited documents, keyed to
the **exact** phrasing of a disproven claim (phrasing patterns, not general English —
spec Assumption). Each guard is authored **red-first**: on the pre-correction baseline
it must fail against the original sentence (US3 Independent Test), then green after
correction.

| Guard | Source claim | Forbidden pattern (illustrative, final regex authored test-first) |
|---|---|---|
| GUARD-01 | C-001 | ``[P]/[US<n>]`` tags / "Preceded by" edges "recorded on the issue" phrasing |
| GUARD-02 | C-002 | "use T001-style ids" + "out-of-the-box" co-occurrence implying checkbox-id capture |
| GUARD-03 | C-003 | any surviving or reintroduced claim of native `[DEP:]`/`[Dep:]` dependency parsing |
| GUARD-04 | C-006 | the `📋` marker-line claim (`📋 Task` phrasing anywhere in audited docs) |
| GUARD-04b | C-007 | "map 1:1 to Linear milestones" / "One milestone per spec folder" phrasing |
| GUARD-08 | C-008 | "delivery state (assignee, branch, PR, labels, status)" enumeration phrasing |
| GUARD-09 | C-012 | "every per-adapter convention are configuration keys" overclaim phrasing |
| GUARD-10 | C-014 | "Linear stays current as you commit" phrasing |
| GUARD-11 | C-019 | heading-grammar example listing bare `Task 1.2` as a capturable id phrasing |

Extension record (2026-11-10): GUARD-08…GUARD-11 added per the extension rule below
(one guard keyed 1:1 to the `Correction` of each audit entry that reached a
false/ambiguous verdict during the T004 README enumeration).

### Family 2 — required wording (drift guards)

`assert.match` that corrected passages keep asserting their evidence-backed facts:

| Guard | Source claim | Required fact in corrected text |
|---|---|---|
| GUARD-05 | C-001 | the Spec Kit section states what is actually recorded per task: mirrored description body, visible `[KEY-N]` reference token on the task line, durable sync state in the sync attachment (US2-AS1) |
| GUARD-06 | C-002 | the corrected wording keeps both truths: the `specs/<feature>/tasks.md` layout is config-free, and local-id capture follows the documented identifier grammar (headings capture; checkbox ids need the grammar's separator) — no falsehood in either direction (US2-AS2) |
| GUARD-07 | C-006 | the intro states mapping durability via the reference token + attachment-metadata anchor (no in-file marker — Constitution Principle II) |

### Family 3 — audit-record self-checks

Per [audit-record-format.md](./audit-record-format.md) self-check rules 1–4 and the
`defects.md` source-claim rule. These make SC-001/SC-002 mechanically verifiable:
record exists; header keys present; verdict vocabulary legal; every false/ambiguous
entry carries a Correction; the six FR-002 suspect topics are present; open
false/ambiguous count is 0 on the delivered branch; every `FU-` source claim id
resolves in the record.

## Non-goals / extension rules

- Guards pin **named false claims and named corrected facts** — they do not attempt
  semantic verification of arbitrary prose (spec Assumption; the audit record carries
  the rest).
- A new framework-behavior sentence in an audited document does NOT require a new
  guard; only a *re-audit* (extending `audit.md`) does. Guards are added when an audit
  entry reaches a false/ambiguous verdict, keyed 1:1 to its Correction, and when the
  record self-check schema changes.
- The suite MUST NOT read `specs/017-*` or `specs/018-*` spec text: those are
  proposals, not shipped documentation (research R10).
- Zero changes to sync behavior: this file and its assertions touch no engine/parser/
  renderer code paths; running it performs no writes (Principle I posture preserved by
  construction).
