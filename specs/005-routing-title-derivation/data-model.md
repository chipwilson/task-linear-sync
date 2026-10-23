# Phase 1 Data Model: Path Routing and Title Derivation

**Feature**: `005-routing-title-derivation` | **Date**: 2026-10-22

This document describes **only 005-local** entities — the routing-resolution algorithm's config
view and the title-derivation model that 005 owns. It **extends, never redefines**, the frozen
`002` entities. All frozen shapes below are **cited by reference**, not restated as new
contracts (ROADMAP rule 2 / 002 FR-008: frozen contracts change by amendment only). TypeScript
signatures for the 005-local types live in `src/routing/types.ts` and `src/titles/types.ts`; the
`contracts/` directory is the spec-facing mirror.

## Frozen 002 inputs (cited, NOT redefined here)

| Frozen entity | 002 source | Role in 005 |
|---|---|---|
| `Task` (`filePath`, `featureName?`, `localTaskId?`, `phase?`, `frameworkId`, `title`, `issueRef?`, `kind`, `parentUuid?`) | 002 `data-model.md` §1 / `contracts/task-model.md` | Routing reads **`filePath` only**; title derivation reads the display attributes only. Neither field is redefined or mutated. |
| `ProjectByPathEntry { prefix, teamKey, project }` | 002 `data-model.md` §4 / `src/domain/routing.ts` | The map 005 resolves over. "Both `teamKey` and `project` required (project-only shape unsupported); longest-character-length match wins; deterministic first-by-map-order tie-break." |
| `RoutingResolution { teamKey, project, matchedPrefix?, defaulted, tieBreak?, unassigned? }` | 002 `data-model.md` §4 / `src/domain/routing.ts` | The **output** of `resolveRouting` — produced verbatim, never widened. 006 consumes this frozen type; it does not import 005 internals. |
| `ResolvedConfig` slices: `projectByPath`, `defaultTeamKey`, `defaultProject`, `titleRules`, `titleStripPrefixes`, `confirmationKey` | 002 `data-model.md` §17 / `contracts/configuration.md` | Read-only inputs; `titleRules: readonly string[]` and `titleStripPrefixes: readonly string[]` are interpreted by 005 (R2/R6), never retyped. |

Relationship (005 additions in brackets):

```
Task.filePath ──resolveRouting──▶ RoutingResolution (frozen) ──▶ [006 container gating, 009 report]
Task attrs  ─┬─ parseTitleRules(config.titleRules: string[]) ─▶ TitleRule[] [005-local]
             ├─ deriveTitle(task, TitleRule[]) ─────────────▶ TitleDerivation [005-local] ─▶ [008 apply, 009 report]
             └─ stripTitleForRender(finalTitle, task, opts) ─▶ cleaned title ─▶ [004 render-back]
```

## 1. RoutingConfigSlice (005-local input view)

A structural, read-only view of the frozen config that `resolveRouting` needs. It is **not** a
new configuration concept — it is the subset of `ResolvedConfig` the resolver reads so routing can
be unit-tested with a hand-built object (no dependency on `loadConfig`).

| Field | Type | Source / rule |
|---|---|---|
| `projectByPath` | `readonly ProjectByPathEntry[]` | Frozen entry shape (002 §4). May be empty/absent → every task takes the default path. |
| `defaultTeamKey` | `string` | Frozen; `""` counts as absent (001 R17.5) → contributes to unassigned. |
| `defaultProject` | `string` | Frozen; `""` counts as absent → contributes to unassigned. |

Validation: none added by 005 (workspace-identity validation is 002's `validateWorkspaceIdentity`
at config init, FR-007). 005 assumes entries reaching `resolveRouting` are already validated; it
still behaves correctly (default/unassigned) on empty maps and empty defaults.

## 2. RoutingResolution — behavior, not a new shape

`resolveRouting(filePath, slice): RoutingResolution` is the algorithm (research R1/R7). The shape
is **frozen in 002**; the table below records only the **behavioral assignment rules 005 owns**:

| Outcome | When | `teamKey` / `project` | `matchedPrefix` | `defaulted` | `tieBreak` | `unassigned` |
|---|---|---|---|---|---|---|
| Matched | ≥1 non-empty `prefix` with `filePath.startsWith(prefix)`; unique longest | matched entry's values | the winning `prefix` | `false` | absent | — |
| Tied match | ≥2 matching prefixes of equal max character length | earliest-by-`projectByPath`-index entry | that entry's `prefix` | `false` | `"first-by-map-order"` | — |
| Defaulted | no prefix matches; `defaultTeamKey` **and** `defaultProject` non-empty | default values | absent | `true` | absent | — |
| Unassigned | no prefix matches **and** no complete default | `""` / `""` | absent | `false` | absent | `true` |

Invariant: an empty/absent `projectByPath` yields "Defaulted" or "Unassigned" for **every** task
(005 FR-002: "an absent or empty routing map applies the default path to every task").

## 3. TitleRule (005-local)

The parsed form of one `ResolvedConfig.titleRules` string (R2). Ordered by array index = config
order = evaluation order.

| Field | Type | Rules |
|---|---|---|
| `order` | `integer ≥ 0` | Index in the source array; first match wins scans ascending. |
| `when` | `TitlePredicate[] \| undefined` | **Absent ⇒ catch-all (matches every task).** Present ⇒ AND of all predicates. Parsed from the `<guard>` before `" => "`. |
| `template` | `string` | Text with `{placeholder}` tokens; rendered by `renderTemplate` (R5). A literal arrow is stored unescaped after parse. |

Malformed rule strings raise `TitleRuleParseError { index, rule, reason }` at parse time; the
parser is total otherwise (a rule with no `" => "` is a catch-all template).

## 4. TitlePredicate (005-local)

One condition inside a `TitleRule.when`. Evaluated as pure data (research R2 — determinism +
reportability), not closures.

| Field | Type | Matches when |
|---|---|---|
| `attr` | `"featureName" \| "localId" \| "phase" \| "framework" \| "kind" \| "path" \| "child" \| "issueRef"` | attribute selector (001 R6.4 attribute set + `child`/`path` for the illustrative preset's area/child conditions) |
| `negated` | `boolean` | leading `!` in the guard — inverts the result |
| `op` | `"present" \| "eq" \| "startsWith"` | `"present"` for a bare `attr`; `"eq"` for `attr=value`; `"startsWith"` only for `path~value` |
| `value` | `string \| undefined` | the literal after `=`/`~`; absent for `"present"` |

Evaluation (`evaluateGuard(predicates, task)`): `present` → attribute is defined and non-empty
(`child` ⇔ `task.parentUuid !== undefined`; `issueRef` ⇔ `task.issueRef !== undefined`); `eq` →
string equality against the attribute (`framework` ⇔ `task.frameworkId`; `kind` ⇔ `task.kind`;
`featureName`/`localId`/`phase` ⇔ the field); `startsWith` → `task.filePath.startsWith(value)`. A
negation inverts. Empty predicate list (catch-all) evaluates `true`.

## 5. Placeholder set (005-local enumeration)

`renderTemplate` substitutes these tokens from task attributes (001 R6.4 normative set;
`{feature}` is an alias of `{featureName}`):

| Token | Source attribute | Absent ⇒ |
|---|---|---|
| `{title}` | `task.title` (raw, pre-derivation) | (never absent — `title` is required) |
| `{featureName}` / `{feature}` | `task.featureName` | `""` + indicator `featureName` |
| `{localId}` | `task.localTaskId` | `""` + indicator `localId` |
| `{framework}` | `task.frameworkId` | (never absent — required) |
| `{phase}` | `task.phase` | `""` + indicator `phase` |
| `{prefix}` | `task.issueRef` → `[KEY-N]` | `""` + indicator `prefix` |

An unknown token (not in this set) is left as an indicator too (never left silently) — recorded in
`unresolvedPlaceholders` and replaced with `""` (R5; "never left literal").

## 6. TitleDerivation (005-local output)

The value `deriveTitle(task, slice)` returns. Consumed by 008 (write `finalTitle` to the tracker,
then screen it), 009 (report indications), and — via `stripTitleForRender` — 004.

| Field | Type | Rules |
|---|---|---|
| `finalTitle` | `string` | The `<Feature_Name>: `-decorated title, ready to propagate. Byte-stable across repeated derivations of unchanged inputs (FR-004). |
| `baseTitle` | `string` | `finalTitle` **before** decoration (matched template output or pass-through raw title) — diagnostics. |
| `matchedRuleIndex` | `integer ≥ 0 \| -1` | Index of the winning `TitleRule`; `-1` when the pass-through default applied. |
| `defaulted` | `boolean` | `true` ⇔ `matchedRuleIndex === -1` (no rule matched or none configured → built-in pass-through). |
| `unresolvedPlaceholders` | `readonly string[]` | Placeholder names replaced with `""` in the applied rule (R5); empty for pass-through. |
| `decorated` | `boolean` | `true` ⇔ a `Feature_Name` prefix is present on `finalTitle` (present when `task.featureName` is set). |

Built-in defaults (001 R6.3/R6.7): empty `titleRules` ⇒ pass-through (`baseTitle = task.title`,
`matchedRuleIndex = -1`, `defaulted = true`), then decorated if `featureName` present.

## 7. StripInput (005-local input to render-back strip)

`stripTitleForRender(finalTitle, task, slice)` inputs, mirroring R6:

| Field | Type | Source / rule |
|---|---|---|
| `titleStripPrefixes` | `readonly string[]` | Frozen config (leads adapter default strip prefixes, 001 R7.4/7.5). Empty ⇒ built-in default strip (local-ID prefix + redundant issue prefix only). |
| `confirmationKey` | `string` | Frozen (`config.confirmationKey`, default `SYNC`) — used to recognize a redundant leading `[KEY-N]` issue prefix (never compared to a constant). |
| `featureName` | `string \| undefined` | `task.featureName` — the leading `"<featureName>: "` prefix removed first. |
| `localTaskId` | `string \| undefined` | `task.localTaskId` — duplicate leading `"<localTaskId>: "` removed only when the line already carries the identifier. |

Strip is a **leading-prefix** operation; all other characters are preserved unchanged (R6.6).

## State transitions summary

Routing and title derivation are **stateless pure functions** — no persisted records, no lifecycle
states, no clock. The only "transition" is the **render-back round-trip invariant** the feature
exists to guarantee (Principle IV):

```
raw title ──deriveTitle──▶ finalTitle ("<Feature_Name>: " + derived)
          ──(008 writes finalTitle to tracker)──▶ stored title == finalTitle
          ──(004 renders)── stripTitleForRender(finalTitle) ──▶ cleaned title
          ──re-parse + re-deriveTitle──▶ finalTitle  (byte-for-byte identical — no compounding)
```

Invariant (SC-002): applying `deriveTitle ∘ stripTitleForRender` any number of times is idempotent —
`deriveTitle(stripTitleForRender(deriveTitle(t))) === deriveTitle(t)` byte-for-byte, and a task
with no `Feature_Name` is never prefixed (FR-005).
