# Contract: Audit Record Format (`audit.md` / `defects.md`)

**Feature**: `019-speckit-doc-truthfulness`

The audit record is the feature's durable research output (FR-003): future audits
extend it, they do not re-derive it. This contract fixes the file layout so the
record is both human-readable and machine-checkable by the guard suite
([doc-truthfulness-guards.md](./doc-truthfulness-guards.md), G-family 3).

## `specs/019-speckit-doc-truthfulness/audit.md`

### Header block (exact keys, machine-parsed)

```markdown
# Claim Audit: Documentation Truthfulness

- Baseline commit: <full-hash>            # the merged document set audited (research R10)
- Audited documents: README.md, docs/framework-adapters.md, docs/discovery.md,
  docs/parsing.md, specs/requirements.md  # the FR-001 scope, one per line of this list
- Open false/ambiguous verdicts: 0        # MUST reach 0 at feature close (SC-001)
```

### Claim entry template (one `###` section per claim, fields as `- **Field**:` lines)

```markdown
### C-001 — README.md:195-196 — tags and dependency edges on issues

- **Verdict**: false
- **Framework scope**: spec-kit
- **Claim**: "One milestone per spec folder, one issue per T-task, with `[P]/[US<n>]`
  tags and "Preceded by" edges recorded on the issue."
- **Evidence kind**: absence-search
- **Evidence pointer**: src/tracker/operations/mutations.ts::createIssueImpl
- **Evidence search scope**: no tag/label extraction and no dependency-edge
  construction anywhere in src/; the issue create/patch surface admits title,
  description, state, parent only.
- **Requirements check**: requirements-silent
- **Correction**: rewrite — one issue per task; description mirrors the task body;
  visible `[KEY-N]` reference token on the task line; durable state in the canonical
  Sync_Attachment metadata. (Landing: README.md Spec Kit section, step 1.)
- **Guards**: GUARD-01, GUARD-05
```

Field vocabulary is the enum set in [../data-model.md](../data-model.md)
(`Verdict.status`, `EvidenceEntry.kind`, `Verdict.requirementsCheck`,
`Correction.action`). Self-check rules enforced by guards:

1. Every `###` claim section carries a `Verdict` and an `Evidence pointer` whose
   target resolves (a `tests/...::name` matches a real test, a `src/...::symbol` or
   `file:line` exists at HEAD).
2. Every entry with `Verdict: false` or `ambiguous` carries a `**Correction**:` line.
3. `Open false/ambiguous verdicts` in the header equals the counted number of
   false/ambiguous entries (guards run green only when it is 0 — US2 Independent Test,
   mechanically).
4. The six FR-002 suspect topics each appear in the record: tags, "Preceded by"
   edges, native `[DEP:]`/`[Dep:]` parsing, checkbox `T001` capture, selection
   precedence, agent-hook scaffold table (SC-002).

## Coverage table (appendix of audit.md)

One row per audited document listing every framework-behavior sentence located
(verbatim) and the claim id adjudicating it, or `N/A` with a reason (e.g.
"requirements.md R7.5 spec-kit row — pure defaults listing, matches code"). This
table is the SC-001 coverage proof and the entry point for future audits.

## `specs/019-speckit-doc-truthfulness/defects.md`

Header `# Follow-up Entries (defect log)`, then one `###` section per entry:

```markdown
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
```

Self-check: every `defects.md` `Source claim` id exists in `audit.md`; entries are
append-only except `Status`.
