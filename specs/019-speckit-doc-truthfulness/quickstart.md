# Quickstart: Validating Documentation Truthfulness (Feature 019)

Validation guide for the delivered change. Entity/field shapes:
[data-model.md](./data-model.md); guard semantics and catalog:
[contracts/doc-truthfulness-guards.md](./contracts/doc-truthfulness-guards.md);
record layout: [contracts/audit-record-format.md](./contracts/audit-record-format.md).

## Prerequisites

- Node.js ≥ 20.0.0, npm (locked `package-lock.json`)
- Repository at the delivered `019-speckit-doc-truthfulness` branch

```bash
npm ci
```

## 1. Full suite green with zero behavior changes (US3-AS2, SC-003)

```bash
npm test
git diff --stat main...HEAD    # touched paths must be only: README.md, CHANGELOG.md,
                               # docs/** (if corrected), specs/019-*/**, tests/contract/doc-truthfulness.test.ts
```

Expected: all tiers pass; **no file under `src/`** and no pre-existing test file appears
in the diff (behavior tests unchanged).

## 2. Guard suite alone + record self-checks

```bash
npm run test:contract
```

Expected: `doc-truthfulness:` tests all pass, including Family-3 self-checks reading
`specs/019-speckit-doc-truthfulness/audit.md`. Confirm the header line
`Open false/ambiguous verdicts: 0` (SC-001) and that the six FR-002 suspect topics
each have a claim section (SC-002).

## 3. Guards are real: restore a disproven claim, expect a named failure (US3-AS1)

On a scratch branch, re-insert the original README sentence (verbatim from the
`C-001` entry of `audit.md`):

```bash
git switch -c scratch-019-restore
# edit README.md Spec Kit step 1 to re-add:
#   "...with `[P]/[US<n>]` tags and \"Preceded by\" edges recorded on the issue."
npm run test:contract
```

Expected: exactly the named guard fails —
`doc-truthfulness: GUARD-01 ...` — with a diagnostic naming `C-001` and `README.md`.
Repeat for each Family-1 guard using that claim's recorded original wording
(GUARD-02…GUARD-04b); then discard the scratch branch.

## 4. Evidence spot-check: reproduce recorded verdicts (US1 Independent Test)

Pick any five audit entries and re-verify the pointer cheaply:

- `src/...:line` pointers: open the file at the baseline commit recorded in the
  `audit.md` header (`git show <baseline>:<path>`) — e.g.
  `src/parsing/content.ts` `LOCAL_ID_SPAN_RE` still requires separator punctuation.
- `tests/...::name` pointers: run the named test (e.g. the 016 pin
  `framework-support-consistency.test.ts::framework-consistency: README precedence
  line matches DEFAULT_PRECEDENCE`).
- `demo` entries: parse a Spec-Kit-shaped checkbox line through the built parsing
  surface and observe no `localTaskId` — e.g.
  `node -e` driving `dist/parsing` `parseTaskFile` over `- [ ] T001 Create the scaffold`.

Expected: every spot check reproduces the recorded verdict (SC independence of the
evidence record).

## 5. Reader-facing outcome check (SC-004, US2-AS1/AS2)

Read the corrected README intro and `### GitHub Spec Kit (spec-kit)` section in
isolation (no source). You should be able to state exactly what a synced Spec Kit task
produces: one issue per task; description mirrors the task body; the visible `[KEY-N]`
reference token written on the task line; durable sync state carried in the sync
attachment — and that checkbox `T001` ids sync only under the documented identifier
grammar. No `📋` marker, no tags/edges, and no milestone-creation promise should
appear anywhere in the audited documents.

## 6. Changelog and follow-ups (US3-AS3, FR-005, FR-007)

- `CHANGELOG.md` `## [Unreleased]` carries an entry recording the correction
  (existing `changelog.test.ts` contract enforces hygiene).
- `specs/019-speckit-doc-truthfulness/defects.md` lists every routed gap — at minimum
  `FU-001` (separator-free checklist identifier capture) — and each entry's
  `Source claim` id resolves in `audit.md`.

## Exit criteria

Steps 1–6 all green/verified ⇒ the feature's SC-001…SC-004 are demonstrated
end-to-end: audit complete and evidence-backed, documents corrected to as-built
truth, disproven claims CI-guarded, and genuine gaps tracked rather than silently
dropped.
