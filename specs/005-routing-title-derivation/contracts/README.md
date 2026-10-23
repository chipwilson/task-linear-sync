# Contracts — 005 Path Routing and Title Derivation

These documents describe the **005-local interfaces** only: the routing-resolution function and
the title-derivation/strip functions, with their normative behavior. They **consume the frozen
`002` contracts by reference and never redefine them** (ROADMAP rule 2 / 002 FR-008). The frozen
types imported here — `Task`, `ProjectByPathEntry`, `RoutingResolution`
(`specs/002-core-domain-contracts/contracts/task-model.md`, `src/domain/routing.ts`) and the
`ResolvedConfig` slices (`contracts/configuration.md`) — are **not** re-specified in this directory.

| Contract | Document | Behavior owned by 005? | Provided to |
|---|---|---|---|
| Routing resolution | [routing-resolution.md](./routing-resolution.md) | **Yes** — the longest-prefix algorithm producing the frozen `RoutingResolution` | 006 (container gating), 008 (destination), 009 (report routing) |
| Title derivation & render-back strip | [title-derivation.md](./title-derivation.md) | **Yes** — ordered rule evaluation, feature decoration, render-back strip | 008 (title apply), 004 (render-back), 009 (report) |

Consumers depend only on (a) frozen `002` types (`RoutingResolution`) and (b) the 005-local value
objects (`TitleRule`, `TitleDerivation`) plus plain `string` results documented here — **never**
on 005 module internals. This keeps Wave-2 module boundaries disjoint and lets Wave-3 integration
(008) wire these functions into the single engine without 006/004/009 importing `src/routing` or
`src/titles` implementation details.
