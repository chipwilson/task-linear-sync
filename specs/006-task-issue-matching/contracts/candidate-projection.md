# Contract: Candidate Projection & Durable-Identity Integrity

Module: `src/matching/projection.ts`. Turns **already-fetched** frozen tracker views
(`IssueView` + `AttachmentView[]` per issue, 007-populated in production; fixtures/fakes in
tests) into `MatchCandidate`s (data-model §2). 006 never fetches: "Candidate issues arrive
already scoped by the tracker port (007); matching never fetches" (spec Assumption).

## Projection rules (deterministic, per candidate)

1. **Identity source — page-0 canonical attachment only.** An attachment is a durable
   identity carrier iff:
   - `parseAttachmentUrl(attachment.url)` (frozen `src/urls`) returns
     `{ kind: "canonical", taskUuid }` under the configured templates, **and**
   - `attachment.metadata[config.metadataNamespaceKey]` parses via frozen
     `parseSyncStatePayload` into a payload whose `taskUuid` is a valid identity.
   The candidate gets `durableTaskUuid = payload.taskUuid`. Continuation URLs (`kind:
   "continuation"`) are history-only and never set identity (glossary `Continuation_Attachment`:
   "Page 0 is the canonical `Attachment_URL` and remains the sole identity anchor").
2. **Never description, never in-file marker.** Identity read from any other source (title,
   description, any metadata key other than `metadataNamespaceKey`) MUST NOT set
   `durableTaskUuid` — constitution II and the frozen port rule "implementations MUST NOT
   search descriptions for identity" (002 `contracts/tracker-port.md`, 001 R5 c11). A
   malformed payload string under the namespace key is ignored for identity (candidate
   treated as non-durable); it is never partially trusted.
3. **Framework context**: `frameworkId`/`featureName`/`filePath` come from the page-0
   payload's `frameworkMetadata`; absent payload ⇒ unknown ⇒ the both-known framework gate
   (R5 c5) is not evaluated for that candidate.
4. **Issue number** (signal `issue-ref-exact`): `issueNumber = int(key suffix match of
   /-(\d+)$/)`; non-matching keys contribute 0 to that signal.
5. **Containers**: `teamKey = IssueView.teamKey`, `projectRef = IssueView.projectId`
   compared as-is against routing values (research R5 — configured-identity alignment is the
   provider's responsibility, mirroring `IssueScope.perTeam.projects` = "configured project
   identities").
6. Output is sorted by `issueId` ascending; two attachments on one issue qualifying under
   rule 1 with different task UUIDs is an input-integrity abort (§Integrity case b).

## Integrity — duplicate durable UUIDs across issues (constitution II, US2 AC2)

> "More than one issue carrying the same task UUID is a hard integrity failure: the run MUST
> abort with no changes applied." (constitution II); R5 c3: "THE System SHALL abort the run,
> apply no changes, and report the task UUID and the identifiers of all conflicting issues".

- **Case a — across issues**: after projection, if a `durableTaskUuid` appears on ≥ 2
  candidates, throw `DurableIdentityCollisionError { taskUuid, issueIds }` with **all**
  conflicting `issueId`s sorted ascending. Purity makes "no changes" structural: the throw
  emits no `MatchingResult`.
- **Case b — one issue, contradictory anchors**: two qualifying attachments on the same
  issue with different task UUIDs ⇒ same typed error (the issue id repeated is the conflict
  set of size… both UUIDs reported via one error per UUID — deterministic: throw on the
  lexicographically-smallest offending `taskUuid` first).
- The scan runs in `projectCandidates`, before any scoring, so the abort cannot be sidestepped
  by configuration.

## Provider contract (who feeds `projectCandidates`)

- **007** (real/fake port) fetches `IssueView`s and attachment lists within configured scope
  (its FR-004 identity query is `findIssuesByAttachmentUrl`; 006's projection is the pure
  mirror of the same reading rule).
- **008** (engine) composes fetch → `projectCandidates` → `matchAllTasks` and handles
  `DurableIdentityCollisionError` as a run-abort.
- **Tests (006-owned)**: fixtures and the in-memory fake `LinearPort`
  (`tests/helpers/matching-linear-fake.ts`, research R8) supply the identical frozen shapes;
  006's tests never import 007.

## Gating inputs from 005 (data, not imports)

`TaskMatchInput.routing` carries a frozen `RoutingResolution` **value** (research R6). The
projection module does not read routing; the gate (confidence-scoring.md §2) compares it
against projected `teamKey`/`projectRef`. Wave-2 parallel safety: no import of `src/routing`
(005) or `src/tracker` (007) exists anywhere in `src/matching/` — enforced by a contract
grep task (tasks.md).
