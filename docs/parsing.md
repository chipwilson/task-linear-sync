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
