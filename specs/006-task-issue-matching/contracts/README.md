# 006 Contracts — Index

Contracts owned by `006-task-issue-matching` (interfaces the matching module exposes to
008/009/013). These are **new, 006-local interfaces**; nothing here redefines or amends a
frozen 002 contract.

| Contract | Document | Module |
|---|---|---|
| Matching API (entry points, result invariants) | [matching-api.md](./matching-api.md) | `src/matching/matching.ts`, `src/matching/projection.ts`, `src/matching/serialize.ts` |
| Confidence scoring (signals, bands, margin, alternatives) | [confidence-scoring.md](./confidence-scoring.md) | `src/matching/scoring.ts`, `src/matching/gating.ts`, `src/matching/assignment.ts`, `src/matching/bands.ts` |
| Candidate projection & integrity | [candidate-projection.md](./candidate-projection.md) | `src/matching/projection.ts` |

## Frozen contracts consumed (import-only, never edited)

Per ROADMAP rule 2 and 002 FR-008 ("any change to a frozen contract MUST be treated as a
constitution-governed cross-feature amendment"), 006 consumes:

| Frozen contract | 002 source (spec-facing) | 002 module | 006 use |
|---|---|---|---|
| Task model & stable identity | `contracts/task-model.md`, data-model §1 | `src/domain/task.ts` | Input tasks; `stableUuid` durable anchor |
| Match shape | data-model §5 | `src/domain/match.ts` | Output `Match`/`MatchAlternative`/`Confidence` |
| Routing resolution | data-model §4 | `src/domain/routing.ts` | 005 gating inputs as data (research R6) |
| Sync state payload | data-model §8 | `src/domain/state-payload.ts` (`parseSyncStatePayload`) | Durable-identity detection from attachment metadata |
| Tracker port views | `contracts/tracker-port.md` | `src/ports/linear-port.ts` (`IssueView`, `AttachmentView`, `LinearPort` for test fakes) | Candidate projection inputs; fake-driven integration tests |
| Attachment URL scheme | `contracts/attachment-url-scheme.md` | `src/urls/attachment-url.ts` (`parseAttachmentUrl`) | Page-0 canonical-URL recognition |
| Configuration model (matching keys) | `contracts/configuration.md`, data-model §17 | `src/config/schema.ts` (`ResolvedConfig.scoringWeights`, `confidenceFloors`, `minimumMatchMargin`) | Sole weight/threshold source (validated per research R9) |

No contract here authorizes edits to any file under `src/domain|config|state|urls|gates|ports`
or to `specs/002-core-domain-contracts/`.
