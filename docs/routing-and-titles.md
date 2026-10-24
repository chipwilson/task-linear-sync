# Path routing and title derivation

Feature 005 ships two pure, dependency-free rule engines over the frozen 002 shapes:
`resolveRouting` (path → team + project) and the title module set (`deriveTitle`,
`stripTitleForRender`, …). Neither touches the tracker, the filesystem, or the network —
routing consults only `task.filePath` and the configuration; title derivation is pure over
task attributes. Every example below uses **placeholder identifiers only** (`acme-team`,
`proj-alpha`, `<areaPrefixA>`, …); the tool ships **zero** organization-specific values.

## Routing: longest prefix wins, defaults, unassigned

`resolveRouting(filePath, { projectByPath, defaultTeamKey, defaultProject })` evaluates the
consumer-supplied `ProjectByPath` map and returns the frozen `RoutingResolution`
(imported from `src/domain/routing.js`, never widened):

```jsonc
// consumer configuration — placeholders, supplied entirely by the consumer
"projectByPath": [
  { "prefix": "specs/",          "teamKey": "acme-team",   "project": "proj-alpha" },
  { "prefix": "specs/api/",      "teamKey": "acme-team-b", "project": "proj-beta"  },
  { "prefix": "specs/api/auth/", "teamKey": "acme-team",   "project": "proj-gamma" }
],
"defaultTeamKey": "acme-team",
"defaultProject": "proj-default"
```

| Outcome | When | Result |
| --- | --- | --- |
| Matched | ≥1 non-empty prefix matches (`filePath.startsWith(prefix)`, literal, no segment normalization) | **greatest character length wins**; `matchedPrefix` records it; `defaulted: false` |
| Tied match | ≥2 matching prefixes of equal max length | earliest entry **by map order** wins + `tieBreak: "first-by-map-order"` (deterministic, re-run identical) |
| Defaulted | no prefix matches; `defaultTeamKey` AND `defaultProject` non-empty | defaults apply, `defaulted: true` |
| Unassigned | no prefix matches and no complete default | `{ teamKey: "", project: "", defaulted: false, unassigned: true }` — an **indication**, not an abort; remaining tasks keep processing |

- An **absent or empty map** applies the default path to every task (else every task is
  unassigned).
- **Routing values are consumer-required — there are ZERO built-in teams, projects, or path
  prefixes** (constitution III). Routing never invents a destination: with no match and no
  defaults the task is left visibly unassigned.
- Consumers branch on `res.unassigned === true`, not on the empty strings; `006` consumes
  the frozen `RoutingResolution` without importing any 005 internals.

## Title rules: an ordered, conditional string grammar

`ResolvedConfig.titleRules` is frozen as `readonly string[]`; 005 owns its interpretation
via a total, deterministic grammar:

```
<rule>      ::= <guard> " => " <template>   |   <template>       // no arrow ⇒ catch-all
<guard>     ::= <cond> ( "," <cond> )*                           // AND of all conditions
<cond>      ::= [ "!" ] <attr> [ <op> <literal> ]
<attr>      ::= featureName | localId | phase | framework | kind | path | child | issueRef
<op>        ::= "=" (equality)  |  "~" (starts-with, path only)
<template>  ::= text with {placeholder} tokens; a literal arrow is escaped as "\=>"
```

Rules are evaluated **in config order; the first matching rule wins** (`matchedRuleIndex`).
A rule with no guard is a catch-all. A malformed rule raises `TitleRuleParseError`
(carrying `index` + `rule`) at parse time — never a silent template pass.

Example preset (the shape from the 001 Requirement 6 informative note — area names and
prefixes are consumer-supplied placeholders):

```jsonc
"titleRules": [
  "path~specs/infra/,   localId => <areaPrefixA> {localId}: {title}",
  "path~specs/delivery/,  phase => <areaPrefixB> Phase {phase}: {title}",
  "path~specs/delivery/, !phase => <areaPrefixB>: {title}",
  "child => {title}",
  "<areaPrefixC>: {title}"
],
"titleStripPrefixes": [
  "<areaPrefixA> ", "<areaPrefixB> Phase Setup: ", "<areaPrefixB>: ", "<areaPrefixC>: "
]
```

Substituted placeholders: `{title}`, `{featureName}` (alias `{feature}`), `{localId}`,
`{framework}`, `{phase}`, `{prefix}` (the visible `[KEY-N]` issue reference). A placeholder
whose attribute is absent or empty — or an unknown token — is replaced with an **empty
string and reported in `unresolvedPlaceholders`**; a token is never left literal. With no
rule matching (or none configured, the built-in default), the **pass-through default**
applies: the raw title carries through unchanged (`matchedRuleIndex: -1`, `defaulted: true`).

## The `<Feature_Name>: ` discipline — decorate exactly once, strip on render

The feature-prefix rule is a built-in, **non-configurable** step applied on every
derivation path (consumer rule, no match, pass-through alike):

- A task **with** a `Feature_Name` gets `<Feature_Name>: ` prepended **exactly once**. If
  the derived title already begins with that exact prefix it is retained unchanged, so
  repeated derivations are byte-for-byte identical — titles are never progressively
  prefixed across runs (SC-002).
- A task **without** a `Feature_Name` is never prefixed.

On render-back into Markdown, `stripTitleForRender(finalTitle, task, config)` removes —
from the front, **in this order** — (1) the leading `<Feature_Name>: ` prefix,
(2) every configured `titleStripPrefixes` entry (leading the framework adapter's default
strip prefixes), (3) a redundant leading `[<confirmationKey>-<N>]` issue prefix, and
(4) a duplicate leading `<localTaskId>: ` prefix (only when the rendered line already
carries that identifier). All other characters are preserved. With `titleStripPrefixes`
empty, the built-in default strip removes **only** the leading local-ID prefix and any
redundant leading issue prefix — and no other prefix; no organization- or product-specific
literal prefix exists in any default.

Round trip (proven as a 10-cycle property test):

```
raw title ──deriveTitle──▶ "user-authentication: <derived>"
          ──(008 writes it to the tracker)──▶ stored title
          ──(004 renders)── stripTitleForRender ──▶ clean Markdown title
          ──re-parse + deriveTitle──▶ identical final title (byte-for-byte)
```

## Module surface and Wave-3 wiring

`src/routing/` (`resolve.ts`, `types.ts`) and `src/titles/` (`rules`, `match`, `template`,
`decorate`, `strip`, `derive`, `types`) are 005-owned with barrel `index.ts` files.
Public subpath export registration (`./routing`, `./titles`) is deferred to Wave-3
integration; consumers use the frozen `RoutingResolution` plus the 005-local value objects
(`TitleRule`, `TitleDerivation`) and plain strings documented in
`specs/005-routing-title-derivation/contracts/` — never module internals. The final
`Feature_Name`-prefixed title is screened by the propagation owner (008/009) via the
`SecurityScreener` before leaving the process.
