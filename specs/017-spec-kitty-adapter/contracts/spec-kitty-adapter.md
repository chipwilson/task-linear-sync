# Contract: `spec-kitty` Framework Adapter (built-in, syncable)

**Feature**: `017-spec-kitty-adapter` | **Status**: Draft (normative for implementation)
**Consumes**: 003 adapter contract (`specs/003-task-discovery-framework-adapters/contracts/framework-adapter.md`), 004 adapter-consumption contract, 002 task model — amended per `docs/contract-amendments.md` entries 1–3 of this feature.

## C1. Identity and surface

- **C1.1** `spec-kitty` MUST be a member of `FrameworkId`, `BUILT_IN_FRAMEWORK_IDS`,
  `DEFAULT_PRECEDENCE`, and the `frameworkAdapters` built-in default enabled set.
- **C1.2** The identity MUST be accepted end-to-end by the sync surface
  (discover → parse → match → create → mirror → reconcile → write-back → rollback) with the
  identical gating of the existing five; no surface may special-case it (FR-001, FR-005 parity).
- **C1.3** `spec-kitty` MUST declare no agent-hook scaffold template;
  `install-agent-hook --framework spec-kitty` MUST refuse with zero writes (FR-012).

## C2. Detection and layout

- **C2.1** A candidate file is claimed by `spec-kitty` when its repository-relative path
  starts with a configured specs-root prefix (default `kitty-specs/`) — with **no sibling
  document requirement** (FR-002).
- **C2.2** Competing matches resolve by the unchanged ranking (longest matched pattern →
  precedence index → alphabetical). `spec-kit` detection is unchanged; on repositories
  containing both `specs/` (with `spec.md`/`plan.md` siblings) and `kitty-specs/` trees, the
  two adapters' match sets are disjoint (spec edge case).
- **C2.3** `featureName(filePath)` = the directory immediately beneath the specs root
  (the mission) (FR-003).
- **C2.4** Task-file discovery inside a mission matches only `taskFilePatterns`
  (default `tasks.md` / `TASKS.md`) (FR-004).
- **C2.5** Every directory matching the exclusion pattern `<root>/<*>/tasks/` (default
  `kitty-specs/*/tasks/`; `*` = exactly one path segment — amendment 3) MUST be skipped by
  traversal, so per-work-package agent-prompt files are never candidates for **any** adapter,
  including `generic` (FR-004).
- **C2.6** Disabling `spec-kitty` MUST remove its exclusions and claims such that affected
  files behave exactly as before this feature (FR-011).

## C3. Parsing rules (mission roll-up)

- **C3.1 heading tasks**: the adapter heading grammar matches no heading; **zero** tasks of
  kind `heading` may originate in a spec-kitty roll-up — work-package headings, the
  standard template/prose sections (Inputs, Prerequisites, Organization, Subtask Format,
  Path Conventions, Goal, Independent Test, Implementation Notes, Parallel Opportunities,
  Dependencies, Risks & Mitigations), and any other heading are document structure only
  (FR-007).
- **C3.2 front matter**: YAML front-matter lines MUST NOT become tasks or appear in any
  task title (structural containment; pinned by test) (FR-007).
- **C3.3 subtasks**: every checkbox line outside excluded sections yields exactly one
  `checklist` task (FR-005). Checkbox lines inside sections matched by `summaryPattern`
  yield exclusion records (reason `summary-section`), not tasks.
- **C3.4 local id**: the id token (`T\d{2,}` or bare `\d{2,}`, dot-separated variants
  allowed, trailing `.` `:` `—` `–` `-` optional) captured by `checklistIdPattern` is the
  task's `localTaskId`; the id span is excluded from derived titles (FR-005).
- **C3.5 capability tags**: tokens matching `titleTagPattern` (default `[P]`, `[Pn]`,
  `[USn]`) are absent from derived and mirrored issue titles, present verbatim in the
  repository file and in mirrored task bodies, and bracketed issue references `[<KEY>-N]`
  are never treated as tags (the tag pattern admits no hyphen inside brackets) (FR-006).
- **C3.6 work packages**: a heading matching the work-package phase pattern
  (`## Work Package WPxx: <title>`, levels 2–4) sets the grouping (`phase`) `WPxx: <title>`
  for subtasks beneath it until the next heading; a work package with no subtasks yields
  zero tasks (FR-007).
- **C3.7 dependencies**: dependency sections/prose are content, never machine-readable
  edges; sync plans report no dependency edges for this identity (FR-008).
- **C3.8 round-trip**: parse → render → parse keeps the file byte-identical apart from the
  visible `[<KEY>-N]` prefix; derived titles are stable across repeated cycles — no
  progressive prefixing, no tag loss (Principle IV, US2-AC4).

## C4. Identity

- **C4.1** `Stable_UUID` uses the frozen seed layout with
  `Framework_Id = "spec-kitty"`, `Feature_Name = <mission>`,
  `Local_Task_ID = <captured id>`; the ordinal fallback applies only to id-less checkbox
  lines (FR-010).
- **C4.2** Inserting, removing, or reordering other subtasks or whole work packages MUST
  not change any surviving task's identity or match (SC-004).

## C5. Configuration and layering

- **C5.1** Every default in §C2–C3 (root, file names, detection prefix, exclusion list,
  five grammars including the two new members) MUST resolve through the existing
  `adapter.<member> ?? default` consumption and the three-layer merge (built-in → config
  file → `DiscoveryOverrides.adapters["spec-kitty"]`); no new `ResolvedConfig` key is
  introduced (FR-009).
- **C5.2** Defaults contain zero organization-specific literals.
- **C5.3** `checklistIdPattern` and `titleTagPattern` are absent on every other built-in;
  the effective global defaults equal today's behavior byte-for-byte for the existing five
  identities (SC-005).

## C6. Documentation and consistency gates (test-pinned)

- **C6.1** README overview sentence, adapter table, precedence sentence (exactly
  `DEFAULT_PRECEDENCE.join(" → ")`), and a `### Spec Kitty (\`spec-kitty\`)` subsection
  (> 120-char body) MUST name the identity; the 016 consistency suite's fabricated-name pin
  MUST narrow to `spec-superpower` only (FR-013).
- **C6.2** `specs/requirements.md` Requirement 7 and the `Framework` /
  `Supported_Framework` / `Framework_Id` glossary lines, `docs/framework-adapters.md`, and
  `CHANGELOG.md` MUST enumerate the sixth identity in the same change.
- **C6.3** `docs/contract-amendments.md` MUST carry entries for: union widening (with
  `task-model.md` + `frozen-surface.json`), the 004 member-whitelist extension
  (`checklistIdPattern`, `titleTagPattern`), and the 003 exclusion-entry `*`-segment grammar.
