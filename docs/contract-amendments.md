# Contract amendments (FR-008)

The modules under `src/domain`, `src/config`, `src/state`, `src/urls`, `src/gates`, and
`src/ports` are the **frozen contract surface** of feature 002: every shape and behavior
they define mirrors a normative document in
[`specs/002-core-domain-contracts/contracts/`](../specs/002-core-domain-contracts/contracts/).
Later features (003–013) consume these contracts and may **not** edit them.

## The amendment rule

A contract change is a **constitution-governed cross-feature amendment**. One amendment
updates all three artifacts **together, in one change**, noted against feature 001:

1. the contract document in `specs/002-core-domain-contracts/contracts/`,
2. the `src/` module that mirrors it,
3. the contract-test snapshot `tests/contract/snapshots/frozen-surface.json`.

Nothing else may ride along with the amendment; behavior changes additionally require
spec/plan updates for the affected consumer features.

## How drift is enforced

`tests/contract/frozen-surface.test.ts` parses the generated `.d.ts` of every frozen
module and diffs the exported-name sets against the checked-in snapshot. Any addition,
removal, or module rename fails the suite with a per-module drift list:

```
config/schema: ADDED NewThing
domain/task:   REMOVED IssueRef
```

Regenerating the snapshot is deliberate, never automatic:

```sh
UPDATE_FROZEN_SNAPSHOT=1 npm run test:contract
```

Because `npm test` runs that suite on every CI run, an unnoticed edit to a frozen module
breaks the build — amendments are visible by construction (feature 002 SC-004
"contract-drift" scenario).

## Companion freeze tests

- `tests/contract/report-schema.test.ts` — the plan-report schema forbids raw
  task-body/issue-description fields structurally (`additionalProperties: false` +
  schema scan).
- `tests/contract/package-surface.test.ts` — the exports map must keep resolving for the
  root and all six subpaths.
- `tests/contract/defaults-scan.test.ts` — shipped defaults stay free of real
  organization identifiers.

## Log — 002 frozen surface

Amendments to the 002 frozen contracts, same entry format as the per-surface logs below
(`YYYY-MM-DD · surface · element-id · before → after · rationale · migration`), recorded in
the same change as the contract doc + module + snapshot trio (three-artifact rule).

- 2026-11-10 · domain · `type.FrameworkId` · `"bmad" | "spec-kit" | "open-spec" | "kiro" |
  "generic"` → `"bmad" | "spec-kit" | "open-spec" | "kiro" | "spec-superpower" | "generic"` ·
  A-018-0 (feature 018): `spec-superpower` ships as a built-in, default-enabled identity
  (FR-001); the widening was pre-authorized as an amendment candidate in
  `src/discovery/types.ts`. Mirrored in lockstep within this entry: `src/domain/task.ts`,
  `specs/002-core-domain-contracts/contracts/task-model.md`, the `plan-report.schema.json`
  `framework` enum, `specs/002-core-domain-contracts/data-model.md` §1, and the regenerated
  `tests/contract/snapshots/frozen-surface.json` · no migration: the member is additive,
  existing records and seeds are unchanged

- 2026-11-10 · discovery (003 contract) · `selectAdapter` zero-match rule +
  `DEFAULT_PRECEDENCE` · zero matches → unconditional `generic` fallback; precedence
  `kiro → open-spec → spec-kit → bmad → generic` → zero matches → `generic` ONLY when the
  basename still matches generic's effective `taskFilePatterns`, else unclaimed (`null`,
  omitted from `DiscoveryResult.files`, no diagnostic); precedence `kiro → open-spec →
  spec-kit → bmad → spec-superpower → generic` · A-018-1 (feature 018): a date-named plan
  outside the configured plans root must never enter the sync through the catch-all
  (spec-superpower-adapter.md Rule 2, US1-AC4); amends
  `specs/003-task-discovery-framework-adapters/contracts/framework-adapter.md` and
  `docs/framework-adapters.md` in the same change · migration: pre-existing candidates are
  unaffected (every built-in row's patterns include `tasks.md`/`TASKS.md`); only files that
  matched NO enabled rule while their basename also missed generic's patterns — previously
  claimed noise — change behavior

- 2026-11-10 · parsing (004 contract) · `TaskFileAdapter.identityFileScope` · absent →
  optional whitelisted member consumed at the `parseTaskFile` seed call site · A-018-2
  (feature 018): plans sharing a derived feature name need file-scoped seed inputs to keep
  pairwise-distinct `Stable_UUID`s (FR-010); amends
  `specs/004-task-parsing-line-rendering/contracts/adapter-consumption.md` rule 2 —
  `taskStableSeed` and its frozen layout are unchanged · no migration: adapters omitting the
  member (all current ones) keep byte-identical seed inputs

## Surface contract freezes (011/012) — feature 014

The history server (011) and the MCP server (012) carry the same freeze regime as the 002
surface, one snapshot each, built **from the runtime registries** at test time and compared
against checked-in JSON (never hand-written):

| Surface | Frozen contract docs | Snapshot |
|---|---|---|
| history | `specs/011-sync-history-web-page/contracts/{http-surface,access-control,history-reconstruction,component-api}.md` | `tests/contract/snapshots/history-surface.json` |
| mcp | `specs/012-ai-agent-tool-interface/contracts/{tool-definitions,jsonrpc-stdio,transport-auth,apply-gating,component-api}.md` | `tests/contract/snapshots/mcp-surface.json` |

Frozen elements: tool names/descriptions/`inputSchema`, route patterns + methods, HTTP status
codes + constant bodies/envelopes, JSON-RPC error codes, protocol-revision set, `web.*`/`mcp.*`
config keys + defaults, transports, SSE framing constants, cookie attribute set. The drift
posture mirrors 002 (`ADDED`/`REMOVED`/`CHANGED`, one line per element). Full format:
[`specs/014-preview-to-stable-hardening/contracts/surface-freeze.md`](../specs/014-preview-to-stable-hardening/contracts/surface-freeze.md).

### Amendment-entry rule

Changing a frozen element requires an **entry in the per-surface log below**, in the same
change as the snapshot regeneration (`UPDATE_SURFACE_SNAPSHOTS=1 npm run test:contract`):

```text
YYYY-MM-DD · surface · element-id · before → after · rationale · migration
```

`element-id` forms: `tool.<name>`, `tool.<name>.inputSchema`, `route.<pattern>`,
`status.<code>`, `error.<CODE>`, `config.<dotted.key>`, `protocol.<revision>`,
`transport.<name>`, `sse.<aspect>`. Entries are append-only; corrections append a new
entry. The freeze tests assert every logged entry-id still exists in the current snapshot,
so entries can never be silently dropped.

### Log — history surface

- 2026-11-06 · history · `config.web.maxCacheEntries` / `config.web.maxConcurrentWalks` /
  `config.web.maxConcurrentSseStreams` / `config.web.secureCookies` · absent → 500 / 8 / 16 /
  false · 014 R1 resource bounds, defaults preserve pre-amendment behavior · no migration
  (defaults keep every existing deployment byte-identical)
- 2026-11-06 · history · `status.429` · tracker-origin trigger only → also self-protective
  (walk/stream admission) with `Retry-After: 1` header · 014 R3 bounded inbound load ·
  clients treat the self-protective 429 exactly like the tracker one (retry later)
- 2026-11-06 · history · `sse.cookieAttributes` / `sse.cookieSecure` · base set → base set
  (default unchanged) with `sse.cookieSecure` gaining conditional `Secure` on
  `web.secureCookies: true` · 014 R4 TLS-front-door deployments · default `false` keeps
  the cookie byte-identical
- 2026-11-06 · history · `status.401` / `status.403` · case-sensitive `Bearer ` prefix
  with any `Authorization` header counting as a presented credential → MCP-canonical
  `<ows>* bearer <token>` (case-insensitive, whitespace-tolerant); a malformed scheme
  or empty token now reads as NO credential ⇒ `401` challenge (was `403`) · 014 R5
  cross-surface bearer parity · envelopes themselves unchanged; well-formed credentials
  keep the exact 401-absent / 403-invalid split

### Log — mcp surface

- 2026-11-06 · mcp · `config.mcp.planReferenceTtlSeconds` / `config.mcp.planReferenceMaxEntries`
  · absent → 3600 / 1000 · 014 R6 bounded session store · no migration (defaults generous)
- 2026-11-06 · mcp · `protocol.2025-06-18` · `{2024-11-05, 2025-03-26}` →
  `{2024-11-05, 2025-03-26, 2025-06-18}`, default `2025-06-18` · 014 R7 current agent hosts ·
  older clients still negotiate their supported revision (unchanged echo/fallback)
- 2026-11-06 · mcp · `tool.task_sync_apply` (apply-gating step 3) · session-membership-only →
  session membership with TTL/capacity expiry folded in; refusal vocabulary unchanged
  (`PLAN_REFERENCE_UNKNOWN`) · 014 R6 long-lived servers · none; expired references refuse
  exactly as unknown ones always did
- 2026-11-06 · mcp · `protocol.default` / `error.-32602` · a PRESENT non-string
  `initialize` `protocolVersion` answered the fallback → answered `-32602` invalid
  params without consuming the handshake (a corrected retry may initialize); a
  MISSING value keeps the lenient fallback · 014 quickstart Scenario 5 shape fault ·
  clients sending string versions (supported or not) see unchanged behavior

## Feature 017 amendments — the `spec-kitty` identity

Adding the `spec-kitty` built-in framework identity (the seventh, after 018 landed
`spec-superpower` first) touches three frozen contracts at once. Each entry names the
amended element, the before → after change, the artifacts moved
together in the same change, and the gate that pins it.

- 2026-11-10 · domain · `FrameworkId` / `BUILT_IN_FRAMEWORK_IDS` · six literals (after
  018 A-018-0) → seven, with `spec-kitty` inserted immediately before `generic` · 017 C1.1 (a Spec Kitty mission
  must be syncable end to end, and the engine refuses any identity outside the frozen
  union) · artifacts: `specs/002-core-domain-contracts/contracts/task-model.md`,
  `src/domain/task.ts`, `tests/contract/snapshots/frozen-surface.json` (regenerated with
  `UPDATE_FROZEN_SNAPSHOT=1 npm run test:contract`; the exported-name sets are unchanged, so
  the snapshot diff is empty) · gate: `tests/contract/frozen-surface.test.ts` plus the
  016 consistency suite · migration: none for existing repositories — every prior value
  keeps its meaning, its state payloads, and its `Stable_UUID` seeds; a state file written
  with `spec-kitty` is simply unreadable by an older build
- 2026-11-10 · parsing · `src/parsing/adapter.ts` member whitelist · the consumed adapter
  members gain optional `checklistIdPattern` and `titleTagPattern` (regex **source** strings,
  like every other grammar member) · 017 C3.4/C3.5 (a Spec Kitty checklist prints its own id
  at the start of the line text, and `[P]`/`[Pn]`/`[USn]` capability tags belong to the file
  rather than to the derived title) · artifacts:
  `specs/004-task-parsing-line-rendering/contracts/adapter-consumption.md` (boundary rule 2),
  `src/parsing/{adapter,extract,title,render}.ts`, `src/discovery/{adapter,conventions}.ts`
  (the members are overridable through `DiscoveryOverrides.adapters["spec-kitty"]` and
  `CustomAdapterDescriptor`, and introduce **no** new `ResolvedConfig` key, C5.1) · gate:
  `tests/unit/parsing-conventions-017.test.ts` · migration: none — both members are absent on
  every other built-in, where resolution falls back to the existing `LOCAL_ID_SPAN_RE` and
  tag-free title cleaning, so every other identity (018's `spec-superpower` included) parses
  byte-identically (C5.3)
- 2026-11-10 · discovery · `frameworkSpecificExclusions` entry grammar · a prefix-or-basename
  entry → an entry whose whole segment is `*` now compiles to exactly one path segment
  (`kitty-specs/*/tasks/` matches `kitty-specs/<mission>/tasks`), root-relative, and a
  matching directory skips its whole subtree · 017 C2.5 (the generated per-work-package agent
  prompts must never be candidates for **any** adapter, including `generic`, at mission depth)
  · artifacts: `specs/003-task-discovery-framework-adapters/contracts/framework-adapter.md`,
  `src/discovery/traverse.ts` (`skipByExclusion`), `docs/framework-adapters.md` · gate:
  `tests/unit/discovery-traverse.test.ts` (exclusion + disable-restores-prior-behavior) ·
  migration: entries without `*` compile to the unchanged predicates; no shipped default used
  `*` before this feature, so a custom entry that carried a literal `*` in a segment now
  needs that segment spelled without the wildcard to keep matching literally

## Feature 020 amendments — task-depth folding

The `maxTaskIssueDepth` cap (records A-020-1/A-020-2/A-020-3, authored in
`specs/020-task-depth-folding/contracts/configuration-amendment.md`) touches four surfaces
at once. Each entry is recorded together with the module + contract-doc + snapshot moves it
licenses, and all four carry the same honest posture: the shipped built-in default `1` — a
flat board — is a **behavior change for existing consumers**, and `maxTaskIssueDepth: 64`
restores the pre-020, effectively unlimited behavior byte-for-byte (0.x breaking-ish
lineage; no schema break, and the behavior change is called out in the CHANGELOG).

- 2026-11-18 · config (002 contract) · `ResolvedConfig.maxTaskIssueDepth` (Grammar group)
  + `builtInDefaults.maxTaskIssueDepth` · absent → optional key, integers `1..64`, built-in
  default `1` · A-020-1 (feature 020): the intelligent default is a **flat board** — only
  depth-1 tasks become issues (Maintainer Ruling 2026-11-18); the added default is a benign
  integer, so the distributed-defaults scan stays green; layering, merge semantics, and the
  three config-file failure categories are unchanged, and `loadConfig` stays merge-only —
  the range guard lives at the parsing entry (see the `depth.ts` entry) · artifacts: the
  `configuration.md` dated amendment (2026-11-18 block), `src/config/{schema,defaults}.ts`,
  the regenerated `tests/contract/snapshots/frozen-surface.json`
  (`UPDATE_FROZEN_SNAPSHOT=1`) · gate: `tests/contract/frozen-surface.test.ts` and
  `tests/contract/defaults-scan.test.ts` (verify green) plus the config-schema
  optional-key/merge pins · migration: **behavior change** — consumers relying on nested
  sub-issues set `maxTaskIssueDepth: 64`, the escape hatch pinned to reproduce pre-feature
  output byte-for-byte (C1 fidelity gate); every other consumer opts into the flat-board
  default

- 2026-11-18 · parsing (004 contract) · `ExclusionRecord.reason` · `"summary-section" |
  "rollup"` → `"summary-section" | "rollup" | "depth-folded"` · A-020-2 (feature 020): a
  task over the cap becomes recognized-but-excluded content and each folded line earns
  exactly one `depth-folded` exclusion, ascending with the grammar exclusions, which were
  decided upstream and win over folding (C3/C5) · artifacts: `src/parsing/extract.ts` and
  `src/parsing/taskfile.ts`, the amended parsing-surface snapshot
  (`UPDATE_PARSING_SNAPSHOT=1`) · gate: `tests/contract/parsing-surface.test.ts` and the
  fold-exclusion unit matrix · migration: additive union member — existing reason values
  keep their meaning; consumers switching exhaustively over `reason` must handle the new
  member, and consumers who want no folding at all set `maxTaskIssueDepth: 64`

- 2026-11-18 · parsing (004 contract) · new module `src/parsing/depth.ts` + barrel export
  `TaskDepthConfigError` from `task-linear-sync/parsing` · absent → `MIN_TASK_DEPTH` (`1`)
  / `MAX_TASK_DEPTH` (`64`) / `DEFAULT_TASK_DEPTH_CAP` (`1`), `TaskDepthFailureReason`,
  `TaskDepthConfigError`, `validateTaskDepthCap`, `computeDepthByLine`, `DepthFoldResult`,
  `foldDraftsOverCap`; the barrel re-exports only the error class · A-020-1/A-020-2
  (feature 020): pure depth/fold/validation module; the cap is validated at the
  `parseTaskFile` entry BEFORE any parsing work so every lane refuses identically
  (C2/C3/C6) — non-integer, `NaN`/`Infinity`, or non-number values refuse as
  `not-an-integer`, `< 1` as `below-minimum`, `> 64` as `above-maximum`, and the diagnostic
  names only the key and the offending value · artifacts: `src/parsing/depth.ts`,
  `src/parsing/taskfile.ts`, `src/parsing/index.ts`,
  `specs/020-task-depth-folding/contracts/depth-folding.md`, the regenerated
  parsing-surface snapshot (`UPDATE_PARSING_SNAPSHOT=1`) · migration: purely additive
  exports, no existing name changes; existing consumers gain no new refusal path unless
  they set an invalid cap, and nested-issue consumers restore pre-020 behavior with `64`

- 2026-11-18 · cli (009 contract) · `exitCodeForError` exit-3 name list ·
  `ConfigFileError` / `MissingIdentityError` / `StatePlacementError` /
  `TrackerConfigError` → those plus `TaskDepthConfigError` mapped to
  `CONFIGURATION_ERROR` (3) · C6 (feature 020): an invalid `maxTaskIssueDepth` is a
  configuration failure, recognized by the stable error `name` like every other class on
  the list · artifacts: `src/cli/exit-codes.ts`; the same-change documentation duty
  extends the `docs/cli.md` exit-code table row 3 with the new mapped error name · gate:
  the 020 e2e CLI pin (invalid cap refuses with exit 3 before any parse output) ·
  migration: the new name fires only for the key this feature adds — consumers setting
  `maxTaskIssueDepth: 64` keep pre-020 behavior and never reach the new exit-3 path


## Feature 022 amendments — the `spec-kitty` work-package task source

Feature 022 corrects the 017 defect: the `spec-kitty` task source is the
per-work-package **document collection** under `kitty-specs/<mission>/tasks/`, not the
roll-up's checkbox lines. Five frozen-surface amendments landed, each with its
contract-doc edit, module change, and (where applicable) regenerated snapshot in the
same change; the corrected behavior itself is owned by
[specs/022-spec-kitty-wp-tasks/contracts/spec-kitty-work-packages.md](../specs/022-spec-kitty-wp-tasks/contracts/spec-kitty-work-packages.md).

- 2026-11-19 · domain · `TaskKind` · `"heading" | "checklist"` → widened union with
  `"document"` · A-022-0 (research R7/R8: one work-package document is one task, and
  duplicate ids inside one mission are a hard refusal, never a silent collision) ·
  artifacts: `specs/002-core-domain-contracts/contracts/task-model.md`,
  `src/domain/task.ts`, the frozen-surface snapshot (regenerated with
  `UPDATE_FROZEN_SNAPSHOT=1`) · gate: `tests/contract/frozen-surface.test.ts` and the
  022 unit tier · migration: additive union member — existing consumers that branch
  exhaustively on `kind` must handle the new member, and no other identity ever emits it

- 2026-11-19 · discovery · `FrameworkAdapter` / `AdapterConventions` · two optional
  members: `taskPathPatterns` (repository-root-relative POSIX globs claiming task files
  by FULL path, `*` one segment / `**` zero-or-more, joined into the candidate union)
  and the `Feature_Name` rule kind `segment-under-base` · A-022-1 (research R2/R3: the
  collection lives under the adapter's base path and the mission — not the intermediate
  directory — names the feature) · artifacts:
  `specs/003-task-discovery-framework-adapters/contracts/framework-adapter.md`,
  `docs/discovery.md`, `src/discovery/{adapter,conventions,patterns,traverse,registry}.ts` ·
  gate: `tests/unit/discovery-traverse.test.ts`, `tests/unit/discovery-adapter-plumbing.test.ts` ·
  migration: both members are absent on the other six built-in rows, whose selection
  decisions are byte-identical (SC-005, pinned by the discovery contract snapshots)

- 2026-11-19 · parsing · adapter member whitelist + `parseTaskFile` lane · optional
  `documentTaskRule` `{ collectionPattern, idKey, titleKey, fileNameIdPattern }` (regex
  **source** strings; `(?i)` prefix compiles to the `i` flag) selects the document-unit
  pipeline INSTEAD of heading/checklist extraction for claimed files (0-or-1
  `document`-kind draft per file, zero line scanning, title cascade, body-minus-front-
  matter extent) · A-022-2 (research R4–R7: front matter without a YAML dependency;
  identity = mission + normalized `WP<digits>` id, stable across renames) · artifacts:
  `specs/004-task-parsing-line-rendering/contracts/parsing-api.md` (rule 13) and
  `adapter-consumption.md`, `src/parsing/{document,taskfile,adapter}.ts`,
  `src/discovery/{adapter,conventions}.ts` (pass-through of the member, same-amendment
  follow-up in 003's `framework-adapter.md`) · gate: `tests/unit/parsing-document.test.ts`,
  `tests/unit/discovery-spec-kitty.test.ts` · migration: the rule is declared ONLY by the
  built-in `spec-kitty` row; every other row keeps heading/checklist extraction unchanged

- 2026-11-21 · matching · pairing-signal rules · a `kind: "document"` task is scored
  through the durable-identity signal ONLY (no other signal is evaluated at any weight
  configuration), and every unanchored document pair is excluded with the new
  `PairExclusion` member `document-kind-not-durable`, which outranks the container gates
  and the plausible floor · A-022-3 (research R9: roll-up-era titles are index prose about
  the work package — heuristic title pairing onto documents is the recurrence of the
  defect, FR-011 is absolute) · artifacts:
  `specs/006-task-issue-matching/contracts/confidence-scoring.md` (§1 scope note, §2 veto
  bullet) and `matching-api.md` (invariant 10), `src/matching/{scoring,gating,types}.ts` ·
  gate: `tests/unit/matching-document-kind.test.ts` + the untouched 006 suites +
  `tests/integration/sync-spec-kitty-rollup-leftovers.test.ts` · migration: heading/
  checklist scoring is byte-identical; consumers switching exhaustively over
  `PairExclusion` must handle the new member

- 2026-11-20 · engine · plan-build and apply lanes for document-kind units · duplicate
  document identities inside one mission refuse plan build with a deterministic
  `DocumentIdentityCollisionError` finding (precedent: `DurableIdentityCollisionError`);
  the mirror region is kind-conditional (`document` slices `startLine..endLine`
  inclusive); an empty mirrored document carries the `no-content` entry label; document
  units take zero render assignments (empty `expectedMarkdownChanges`; `renderTaskLines`
  rejects a document-kind assignment defensively) · A-022-4 (research R8/R10/R11) ·
  artifacts: `specs/022-spec-kitty-wp-tasks/contracts/spec-kitty-work-packages.md`
  (C2.3/C2.4/C6), `src/engine/{build,apply,errors}.ts`, `src/parsing/render.ts` ·
  gate: `tests/integration/engine-spec-kitty-world.test.ts`,
  `tests/integration/sync-spec-kitty-lifecycle.test.ts`,
  `tests/unit/engine-collision-022.test.ts` · migration: only document-kind units change
  lanes; the other six identities' build/apply bytes are untouched (SC-005)

**017 supersession.** Feature 017's task-shaping rules — C2.4/C2.5 (the roll-up as task
file and the `kitty-specs/*/tasks/` exclusion), C3.1–C3.8 (the roll-up line/heading
grammars, capability-tag title stripping, checklist-id capture), and the C4 seed
*inputs* (roll-up line identity) — are SUPERSEDED by
`specs/022-spec-kitty-wp-tasks/contracts/spec-kitty-work-packages.md`. Retained and
still owned by 017: C1 (path-only detection, scaffold-request refusal), C2.1–C2.3/C2.6
(base-directory claiming, mission-level feature attribution, precedence, disable
parity), the C4.2 stance (identity never re-derives from content), C5 (override lanes:
programmatic-only adapter members, no new `ResolvedConfig` keys), and C6 (sibling
documentation). The generic whole-segment `*` exclusion grammar added by 017 remains
available to every adapter — only `spec-kitty` stops declaring it (an empty
`frameworkSpecificExclusions` set; see C8.3 and the README/docs re-bases in 022 T032/T033).
