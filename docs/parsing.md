# Task parsing & in-place line rendering (`task-linear-sync/parsing`)

`src/parsing/` turns task-file **content strings** into faithful `Task` objects, and
rewrites assigned lines **byte-surgically** — the pure substrate features 005 (derivation),
008 (gated engine), and 009 (reconciliation) build on. Zero filesystem, zero network, zero
clock (constitution I): parsing takes content in; rendering returns rewritten content out;
**the gated engine (008) is the only writer**. The only Node import is `node:crypto`.

```ts
import { parseTaskFile, renderTaskLines, cleanTitle, deriveStableUuid } from "task-linear-sync/parsing";
```

## `parseTaskFile(filePath, content, adapter, config)`

All four parameters are required. Content is split into terminator-preserving lines
(`splitLines` — the same model the renderer uses, so parsing and rendering can never
disagree about line numbers or bytes), then extracted with the adapter's conventions
falling back to merged config defaults.

```ts
const result = parseTaskFile(`specs/${featureName}/tasks.md`, content, adapter, config);
// result.file          — TaskFile: tasks with kind, position, localTaskId, checked,
//                        issueRef, nesting (childUuids), taskBody extents, conflict flags
// result.exclusions    — everything recognized-but-excluded, ascending by line (FR-004)
// result.conflictBlocks— unresolved-conflict spans: the renderer's freeze set (FR-009)
// result.warnings      — deterministic order: kind, then shared value (FR-007)
// result.featureName   — adapter-derived Feature_Name, ABSENT when underivable (FR-008)
```

Stable_UUIDs are computed here, never read from files (002 R11): build the seed with the
frozen `taskStableSeed()` and pass it to `deriveStableUuid(seed, toolId)` — a SHA-256
digest folded into a lowercase RFC 4122 v5-shaped UUID. Same inputs, same UUID, forever.

### Task-depth folding (`maxTaskIssueDepth`, 020)

Depth is computed over the FULL draft tree before any folding, walking exactly the
frozen indent-stack/orphan parent pointers (no extra grammar, 020 R2): a heading task
is depth 1; a checklist task is 1 + the depth of its nearest task ancestor — a
checklist directly beneath a heading task is depth 2. `config.maxTaskIssueDepth`
(integers 1..64) caps which depths stay tasks: the built-in default `1` is a flat
board, and `64` is the effectively-unlimited escape hatch (pre-020 behavior). Any
other value — fractional, `0`, negative, above `64`, non-number — refuses at the
`parseTaskFile` entry, **before any parsing**, with `TaskDepthConfigError` naming the
key and the offending value (the CLI maps the name to exit 3); never clamped, never ignored.

A draft at `depth > cap` **folds**. It stops being a task — no Stable_UUID, no
`parentUuid`/`childUuids`, never assigned or rewritten by the renderer, never
receiving a `[<Confirmation_Key>-<N>]` token, never reaching matching, plan, report,
gates, or CI — and its line stays verbatim body content of the nearest surviving
ancestor; because depth strictly increases down a chain, folding a draft folds its
whole subtree. Each folded draft is recorded exactly once in `exclusions`, adding one
reason:

| reason | cause |
| --- | --- |
| `depth-folded` | checklist draft over the cap (`kind: "checklist"`, ascending by line) |

The canonical exclusion-record discipline is `contracts/parsing-api.md` rule 4 and
the canonical shape of this reason is rule C5 of
`specs/020-task-depth-folding/contracts/depth-folding.md` — neither is re-declared
here. Precedence is fixed upstream: fenced-interior and conflict-frozen lines never
draft (so they never appear as `depth-folded`), and `summary-section` and `rollup`
exclusions win over folding.

**Span invariance (020 I3):** descendant task lines were never extent boundaries, so
a surviving task's `Task_Body` span is identical across caps — the same content parsed
at caps 1, 2, and 64 yields byte-equal spans, with the folded subtree sitting in the
nearest surviving ancestor's body verbatim and in source order.

> **Toggling risk (020 R6, accepted):** set `maxTaskIssueDepth` **before** the first
> sync of a repository. Tightening it later surfaces previously created child issues
> once each in the unmapped-issue report and archives nothing (zero archive/delete
> operations — report-only). Toggling can shift the ordinal of tasks whose identity
> seeds through the `ordinal:filePath` fallback — prefer local ids where toggling is
> plausible (they never shift); a task whose line already carries a visible
> issue-reference token re-matches at high confidence via `issueRefExact` despite the
> ordinal shift.

## `renderTaskLines(filePath, content, assignments, config, options?)`

Rewrites ONLY assigned lines. Every rendered line keeps its original bytes from line start
through the heading hashes (or checklist marker + checkbox) and its leading local-task-ID
span; after that comes `` `[${issueRef.key}-${issueRef.number}] ` + cleanTitle(desiredTitle) ``
— the token is omitted when the assignment carries no `issueRef`. Options:
`preserveLocalTaskId` (default `true`) drops the local-ID span when `false`.

```ts
const { content: rewritten, changes } = renderTaskLines(filePath, content, assignments, config);
// changes — one { lineNumber, before, after } per assignment, ascending, terminators
//           included on both sides: 009's expectedMarkdownChanges material.
```

Checkbox state: `checked: true` writes `[x]`, `checked: false` writes `[ ]`; when the
assignment omits `checked` the existing state byte survives **byte-for-byte** (`[X]` stays
`[X]`). Unassigned lines, per-line terminators, the trailing-newline style, and a final
unterminated line all reproduce exactly (FR-012, SC-002).

### Abort-all validation (FR-013, SC-003)

Assignments are validated **ascending, ALL before ANY rewriting**. The first structural
surprise throws `LineRenderError { filePath, lineNumber, reason }` and the call produces
nothing — a half-written file can never reach a writer:

| reason | cause |
| --- | --- |
| `structure-mismatch` | line kind/heading-level/checkbox no longer matches the assigned task |
| `inside-fence` | line lies inside a fenced region |
| `inside-conflict-block` | line lies within a conflict block span (never rendered into) |
| `line-out-of-range` | line number is not an integer within the file |

## `cleanTitle(text, options)`

Strips configured `titleStripPrefixes`, redundant `[<Confirmation_Key>-<N>]` references
(bracketed anywhere, bare leading — other keys are never touched), and duplicate leading
local-ID prefixes, **iterating to a fixpoint**. Idempotent by construction: render →
parse → render emits identical titles with no progressive prefixing (constitution IV).
Exported for 005's derivation reuse.

## Adapter-consumption boundary

`src/parsing/` consumes trackers **only** through the consumer-owned `TaskFileAdapter`
interface (`contracts/adapter-consumption.md`): no imports from `src/discovery/` or any
feature-003 module, no I/O (both enforced by the import-purity contract). Test fixtures
supply `genericFixtureAdapter` plus the four framework fixture adapters — the sanctioned
oracle until Wave 3.

**Wave-3 seam (deferred, not a 004 task):** when 003 lands, the integrating wave adds
`003-generic-adapter-satisfies-consumption-contract` — a test importing 003's real
`generic` adapter and re-running the parsing contract suite against it — **with zero
changes inside `src/parsing/`**.

## Surface drift alarms

The public export set is snapshot-gated (`tests/contract/parsing-surface.test.ts` +
`tests/contract/snapshots/parsing-surface.json`) and the negative-type boundary is
compile-checked (`tests/types/parsing.test-d.ts`). 005/008/009 consumers get a failing
suite — not a surprise — whenever the surface moves; amend the snapshot deliberately with
`UPDATE_PARSING_SNAPSHOT=1 npm run test:contract`.
