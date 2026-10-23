# Contract: Title Derivation & Render-Back Strip

Modules: `src/titles/{rules,match,template,decorate,strip,derive}.ts` (+ `src/titles/types.ts`).
005 owns the title-rule **model and behavior**; the input config slices `titleRules` /
`titleStripPrefixes` (`readonly string[]`) and `confirmationKey`, and the `Task` attribute fields,
are **frozen in 002** and imported, never retyped. Behavior source: 005 FR-003/FR-004/FR-005
(001 FR-033/FR-034/FR-035 → 001 Requirement 6 criteria 1–12); model in
[../data-model.md](../data-model.md) §3–7; the `titleRules` string grammar in
[../research.md](../research.md) R2.

```ts
import type { Task } from "../domain/task.js";               // FROZEN 002
import type { TitleRule, TitlePredicate, TitleDerivation, TitleConfigSlice } from "./types.js"; // 005-local

/** Deterministic total parse of the frozen `titleRules: readonly string[]` (research R2). */
export function parseTitleRules(raw: readonly string[]): TitleRule[];
export class TitleRuleParseError extends Error { readonly index: number; readonly rule: string }

/** Pure evaluation of one rule's guard against a task (data-model §4). */
export function evaluateGuard(when: readonly TitlePredicate[], task: Task): boolean;

/** {placeholder} substitution; absent attribute ⇒ "" + indicator name (never literal). */
export function renderTemplate(template: string, task: Task):
  { readonly text: string; readonly unresolved: readonly string[] };

/** Prepend `<featureName>: ` exactly once; no-op when featureName absent or already prefixed. */
export function decorateFeaturePrefix(baseTitle: string, featureName: string | undefined): string;

/** Ordered rule evaluation → pass-through default → feature decoration (US2 entry point). */
export function deriveTitle(task: Task, config: TitleConfigSlice): TitleDerivation;

/** Render-back strip, provided to 004 (remove feature prefix + strip prefixes + issue/local-ID prefixes). */
export function stripTitleForRender(finalTitle: string, task: Task, config: TitleConfigSlice): string;
```

## Normative behavior (verbatim constraints the implementation MUST honor)

**Derivation (FR-003):**

1. **First match wins** (001 R6.1): "evaluate the configured ordered title rules in ascending order
   and select the **first rule whose conditions match** the task attributes." (Conditions per the
   R2 grammar — `TitleRule.when`; an absent guard is a catch-all.)
2. **Pass-through on no match** (001 R6.2/R6.3): "IF no configured title rule matches … THEN THE
   System SHALL fall back to the built-in default title derivation … **without terminating
   processing of remaining tasks**"; and "IF the configured ordered title rules collection is empty
   or absent (the built-in default is an empty rule set), THEN … apply the built-in default title
   derivation to all tasks." → `baseTitle = task.title`, `matchedRuleIndex = -1`, `defaulted = true`.
3. **Template substitution** (001 R6.4): "apply that rule's template, substituting each declared
   task attribute placeholder (including prefix, local ID, framework, feature, phase, and title)
   with the corresponding task attribute value."
4. **Unresolved placeholder** (001 R6.5): "IF a matched rule's template references a placeholder for
   which the task provides no corresponding attribute value, THEN THE System SHALL substitute an
   empty string for that placeholder and produce an outcome **indicator** identifying the unresolved
   placeholder." → `unresolvedPlaceholders`; "never left literal" (spec edge case).

**Feature_Name decoration (FR-004 / FR-005):**

5. **Exactly-once prefix on every path** (001 R6.8/R6.9): "as a built-in **non-configurable** step
   applied **automatically after** the title derivation … completes, prepend the verbatim
   `Feature_Name` followed by a colon and a single space … `producing <Feature_Name>: <derived-title>`
   … independent of any consumer title rule"; applied "regardless of whether a consumer title rule
   matched, no consumer title rule matched, or the built-in pass-through default … produced the
   title." → decoration runs after derivation for **all** `matchedRuleIndex` outcomes.
6. **Idempotence** (001 R6.10): "IF the derived title already begins with the exact prefix formed
   by the `Feature_Name` followed by a colon and a single space, THEN … retain the title unchanged
   and SHALL NOT prepend a second occurrence … so that repeated derivations over unchanged inputs
   produce a **byte-for-byte identical final title**."
7. **No feature ⇒ no prefix** (001 R6.11 / FR-005): "WHERE a task has no `Feature_Name`, THE System
   SHALL produce the final title as the derived title … unchanged and SHALL add no feature prefix."

**Render-back strip (FR-004, provided to 004):**

8. **Strip set** (001 R6.6 + R6.12): on render-back remove "a leading prefix formed by the
   `Feature_Name` followed by a colon and a single space, in addition to … every configured
   strip-prefix pattern, redundant issue prefix, and duplicate local ID", "preserving all other
   title characters unchanged", "such that a subsequent parse then derivation reproduces the same
   final title and titles are **not progressively prefixed across runs**." Strip order: feature
   prefix → configured `titleStripPrefixes` (leading the 003 adapter default strip prefixes) →
   redundant leading `[<confirmationKey>-<N>]` issue prefix → duplicate leading `<localTaskId>: `
   prefix (removed "only when the preserved line already carries that identifier", 001 R5.2/R6.7).
9. **Default strip** (001 R6.7): where no strip patterns are configured, "removes only the leading
   local-task-identifier prefix … and any redundant leading issue prefix, and removes **no other**
   prefix, such that neither built-in default contains any organization-specific or
   product-specific literal prefix."

## Consumption by other features (frozen-compatible outputs)

- **008** (apply): writes `TitleDerivation.finalTitle` to the issue title on create/update; applies
  `SecurityScreener` to `finalTitle` before propagation (001 R6.13 — the screened value is the fully
  prefixed title, done by the propagation owner, not 005).
- **004** (render-back): calls `stripTitleForRender(finalTitle, task, cfg)` to produce the clean
  Markdown title; 005 owns the canonical feature-prefix strip so 004 honors one algorithm.
- **006**: consumes **routing** only (`RoutingResolution`, see routing-resolution.md); title
  comparison inputs for matching are plain strings supplied via the composed engine/report.
- **009**: surfaces `TitleDerivation.matchedRuleIndex` / `unresolvedPlaceholders` and
  `RoutingResolution` as report indications.

No consumer imports `src/routing` / `src/titles` internals — only frozen `002` types plus the
005-local `TitleDerivation`/`TitleRule` value objects and plain `string` results documented above.

## Test obligations (mapped in quickstart)

- Ordered rules `[guardA => tplA, catch-all => tplC]`: task matching `guardA` → `tplA`
  (`matchedRuleIndex = 0`); task matching neither → pass-through (`matchedRuleIndex = -1`).
- Matched rule with an absent attribute placeholder → that token `""` + name in `unresolvedPlaceholders`.
- `Feature_Name` present: consumer-rule path, no-match path, and pass-through path all yield a
  `finalTitle` beginning with `<featureName>: ` **exactly once**; re-deriving that output is a
  no-op (idempotent). A title already carrying the prefix is returned unchanged.
- `Feature_Name` absent → final title unprefixed.
- Round trip (SC-002): 10 cycles of `deriveTitle → stripTitleForRender → deriveTitle` are
  byte-stable from cycle 1; strip removes exactly the decorated prefix set.
- Release-scan mirror: the built-in pass-through and default-strip behaviors contain no
  organization/product literal prefix (fixtures use `acme-*`, `proj-*`, `<areaPrefix*>` placeholders).
