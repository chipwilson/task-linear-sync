# Phase 1 Data Model: Task-Depth Folding

Entities and invariants introduced or extended by feature 020. Existing
frozen entities (`Task`, `TaskFile`, `ExclusionRecord`, `ResolvedConfig`) are
extended only as recorded here — never re-declared (governance rule: frozen
types are imported, amendments are dated and labeled).

## 1. Configuration key — `maxTaskIssueDepth` (new, optional)

| Property | Value |
|---|---|
| Location | `ResolvedConfig.maxTaskIssueDepth` and the `ConfigOverrides` deep-partial twin (`src/config/schema.ts`) |
| Type | `number` (integer) |
| Valid range | `1 .. 64` inclusive |
| Default | **absent** — effective cap = unlimited (pre-feature behavior, byte-identical) |
| Merge semantics | Scalar: replaced wholesale by any higher layer (file → programmatic); `null` = value, `undefined` = absent (frozen 002 merge rules — no new rules) |
| In `builtInDefaults` | **Not present** (release-scan target untouched; SC-001 holds structurally) |
| Diagnostics | Errors name only the key and the numeric value — screening-safe |

Validation (lane-entry, pure): absent passes; present values must be
integers within range. Any violation throws `TaskDepthConfigError` (below) at
the `parseTaskFile` entry, so every lane refuses identically.

## 2. Derived entity — `Task_Depth` (pure computation, not stored)

Computed over the FULL draft tree (before folding), in `src/parsing/depth.ts`:

```
depth(heading task)                 = 1
depth(checklist task)               = 1 + depth(nearest task ancestor)
   nearest task ancestor            = indent-stack parent, else enclosing
                                      heading task (orphan rule) — exactly the
                                      frozen parent pointer of extract.ts
```

No new grammar, no new parentage. A checklist task directly beneath a heading
task is therefore depth 2.

## 3. Derived state — `Folded_Task`

A draft with `depth > maxTaskIssueDepth`. Consequences (all downstream of one
decision made in the parsing lane):

| Property | Folded task |
|---|---|
| In `TaskFile.tasks` | No |
| In `TaskFile.exclusions` | Yes — one record, `kind: "checklist"`, `reason: "depth-folded"`, `{ lineNumber, text }` = the draft's line |
| Stable_UUID / ordinal | Not assigned (ordinals are positions among SURVIVING tasks — unchanged definition) |
| `parentUuid` link in Linear | Never created |
| Reaching matching/plan/report/gates/CI | Never (it is not a task) |
| Its line in the file | Reproduced byte-for-byte by the renderer (unassigned line); never receives an issue reference token |
| Its content | Verbatim body of the nearest SURVIVING ancestor via the unchanged extent rule |

Monotonicity: depth strictly increases down a chain ⇒ folding a task folds its
whole task-subtree automatically; no special handling.

## 4. Extended entity — `ExclusionRecord` (frozen type, amended)

```diff
- readonly reason: "summary-section" | "rollup";
+ readonly reason: "summary-section" | "rollup" | "depth-folded";
```

Precedence stays upstream of folding: fenced-interior and conflict-frozen
lines never become task drafts, so they are never `depth-folded`; summary-
section and rollup exclusions are decided by grammar BEFORE depth is
considered (a rollup line is excluded regardless of depth).

## 5. New typed error — `TaskDepthConfigError`

| Field | Content |
|---|---|
| `key` | `"maxTaskIssueDepth"` (constant) |
| `value` | the offending value as provided |
| `reason` | `"not-an-integer"` \| `"below-minimum"` \| `"above-maximum"` |
| Thrown at | `parseTaskFile` entry (all lanes) |
| CLI mapping | exit code `3` (configuration) |

Pattern precedent: `src/matching/config-check.ts` (named lane-entry config
failure); the message carries no file paths, identifiers, or secrets.

## 6. Relationships (unchanged pipeline, one new cut point)

```
content lines ─ extractTasks ─► draft tree (parents, kinds)     [grammar exclusions first]
                    │ depth.ts: depth per draft (pure)
                    ▼
        surviving drafts ──► Task[] ─ uuids, parentUuid, childUuids ─► plan/match/engine   [unchanged]
        folded drafts  ──► exclusions ("depth-folded")                                    [never reach]
                    │
        deriveExtents over SURVIVING drafts ─► Task_Body spans   [span-invariant, see I3]
```

## 7. Invariants

- **I1 — Default fidelity.** Key absent ⇒ `parseTaskFile` output is
  byte-identical to the pre-feature build for every input (SC-001).
- **I2 — Cap adherence.** No surviving task has depth > cap. At cap 1 no
  surviving task carries `parentUuid` ⇒ the engine creates zero Linear
  sub-issues (the "flat board" guarantee).
- **I3 — Span invariance.** For any task that survives under caps `a` and
  `b`, its `Task_Body` line span is identical: folded drafts are always
  descendants of survivors, and descendant task lines were never extent
  boundaries to begin with. The parent's mirrored description therefore
  already contains the folded subtree verbatim in source order — folding adds
  nothing to the body and removes nothing from it.
- **I4 — No writes to folded lines.** Folded lines are unassigned; the
  renderer reproduces them byte-for-byte and never writes a reference token.
- **I5 — Exclusion fidelity.** Exactly the over-cap drafts are excluded, one
  ascending record each, in addition to grammar exclusions.
- **I6 — Determinism.** Folding is a pure function of (content, conventions,
  cap); repeated runs are byte-for-byte identical (plan output too).

## 8. Configuration-toggle transitions (behavior, not stored state)

| Transition | Task-set effect | Pre-existing issues | Identity effect |
|---|---|---|---|
| absent → cap | deeper drafts fold | none (fresh posture) | ordinal-seeded tasks may shift if the file was synced before; local-id and reference-token tasks stable |
| cap `a` → stricter `b` | tasks in `(b, a]` fold | their issues appear ONCE in the unmapped-issue report; **zero** archive/delete operations | tokens on now-folded lines remain as inert text |
| cap `a` → looser `b` | newly in-range drafts become tasks | none | same ordinal-shift caveat |

No migration ships with this feature; guidance lives in the docs (set the cap
before the first sync; prefer local ids).

## 9. Validation rules summary

| Input | Outcome |
|---|---|
| absent | pass (unlimited) |
| `1` … `64` (integer) | pass |
| `0`, negative | throw `TaskDepthConfigError` (`below-minimum`) |
| non-integer, `NaN`, `Infinity` | throw (`not-an-integer`) |
| `> 64` | throw (`above-maximum`) |
| non-number in the config file layer | throw (`not-an-integer`) — the typed merge tolerates it structurally; the lane-entry check rejects it semantically |
