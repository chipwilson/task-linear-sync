# Feature Roadmap: task-linear-sync

Decomposition of `specs/001-extract-functional-requirements/spec.md` performed
2026-10-21 (see its Clarifications session). 001 remains the **traceability catalog**;
specs 002–013 are the **independently specced, independently testable features** that
own each FR's normative behavior. Every one of 001's FR-001…FR-097 appears in exactly
one feature spec, renumbered locally with a `(001 FR-0xx)` citation on each line.

## Feature Index

| Spec | Feature | Owns (001 groups / FRs) | Depends on |
|---|---|---|---|
| [001](001-extract-functional-requirements/spec.md) | Requirements traceability catalog | FR-001…097 source text + constitution exclusion map | — (not a build target) |
| [002](002-core-domain-contracts/spec.md) | Core domain contracts, configuration, run state | I (052–056), O (080–081), shared entity/contract freeze | — |
| [003](003-task-discovery-framework-adapters/spec.md) | Task discovery & framework adapters | A (001–006), D (022–026) | 002 |
| [004](004-task-parsing-line-rendering/spec.md) | Task parsing & in-place line rendering | B (007–019) | 002 (+003 adapter contract) |
| [005](005-routing-title-derivation/spec.md) | Path routing & title derivation | C (020–021), E-title (033–035) | 002 |
| [006](006-task-issue-matching/spec.md) | Task↔issue matching & confidence | E-match (027–032) | 002 (+005 gating inputs) |
| [007](007-issue-tracker-integration/spec.md) | Issue-tracker integration port | G (043–048) | 002 |
| [008](008-sync-engine-apply-rollback/spec.md) | Sync engine: conflicts, state, apply, rollback | F (036–042), H (049–051), J (057–062) | 002–007 |
| [009](009-operator-cli-plan-report/spec.md) | Operator CLI & plan review report | M (072–075), N (076–079) | 002, 008 (+010 delegates) |
| [010](010-background-queue-sync-hooks/spec.md) | Background queue, worker, hooks | K (063–067), L (068–071) | 002, 003, 008 |
| [011](011-sync-history-web-page/spec.md) | Sync-history web component | P (082–089) | 002, 007 |
| [012](012-ai-agent-tool-interface/spec.md) | AI-agent tool interface | Q (090–094) | 002, 008 |
| [013](013-ci-enforcement-layer/spec.md) | CI/CD enforcement layer | R (095–097) | 009 |

## Parallel Development Waves

- **Wave 1** (sequential, unblocks everything): **002** — freezes shared entities, the
  tracker-port contract, the gated engine-apply entry, the attachment URL scheme, and
  the plan/report JSON schema. No other feature may redefine a frozen contract; changes
  are cross-feature amendments.
- **Wave 2** (5 agents, fully parallel — disjoint modules, no shared files):
  **003**, **004**, **005**, **006**, **007**. Each is a pure/contained slice testable
  against the 002 contracts and the tracker fake; 004 codes against the 003 adapter
  *interface* (using the built-in `generic` adapter as its fixture), never its internals.
- **Wave 3** (integration): **008** composes 003–007 into the single gated engine.
- **Wave 4** (5 agents, fully parallel against the frozen engine/report contracts):
  **009**, **010**, **011**, **012**, **013**. Per constitution Principle V they are
  additive surfaces over one engine — with the exception of 009's `install-hooks`,
  `install-agent-hook`, `enqueue`, `worker`, and `last-run` commands, which present
  010's behaviors at the command surface. 011 is the most independent surface (needs
  only the attachment URL scheme + history event shape + tracker reads).

Peak parallelism: **5 concurrent agents** in each of Waves 2 and 4.

## Rules that keep parallel work safe

1. **One FR, one owner** — a requirement lives in exactly one feature spec; 001 cites
   the origin (`001 FR-0xx`) on every relocated FR.
2. **Contracts change by amendment only** — anything frozen in 002 (entities, ports,
   URLs, schemas, gate vocabulary) is edited only via an amendment noted in 001.
3. **Constitution supremacy** — every spec inherits constitution v1.0.0 (gates, durable
   identity, determinism, screening, resilience); no feature spec weakens it.
4. **Independent test per spec** — each spec's User Stories keep an independently
   runnable test; a feature "done" means its own scenarios + SCs pass against contract
   fakes, with integration verified in the consuming wave.
