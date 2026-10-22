# Contract: Adapter-Interface Consumption Boundary

Module: `src/parsing/adapter.ts` (+ fixture adapters in `tests/helpers/parsing-fixtures.ts`).
This is the **parallel-safety seam** of Wave 2: 004 "codes against the 003 adapter
*interface* only — using the built-in `generic` adapter as its test fixture — never its
internals" (ROADMAP Wave-2 note). The interface members are not invented here: they are
the subset of the adapter interface frozen in
[002 data-model § 3](../../002-core-domain-contracts/data-model.md#3-framework-adapter-interface)
that parsing reads.

```ts
import type { FrameworkId } from "task-linear-sync/domain";

/**
 * Consumer-owned structural view of the 002 § 3 Framework Adapter interface —
 * EXACTLY the members 004 reads. 003's real adapters satisfy this structurally;
 * no code in src/parsing/ may import from 003 modules or reference the members
 * 004 never calls (detect, taskFilePatterns, titleBehavior, agentHooksDirectory).
 */
export interface TaskFileAdapter {
  readonly id: FrameworkId;
  featureName(taskFilePath: string): string | undefined;
  readonly headingGrammar?: string;     // named groups: id?, title  (override semantics, research R2)
  readonly phasePattern?: string;
  readonly summaryPattern?: string;
  readonly rollupPattern?: string;
}
```

## Boundary rules (normative)

1. **Import purity** (mechanical): every import inside `src/parsing/**` resolves to
   `node:*`, a relative path within the module, or the frozen
   `task-linear-sync/domain` / `task-linear-sync/config` subpath exports. A contract test
   scans the module's import statements and fails on any 003/005/006/007 module path or on
   `node:fs`/`node:path`/`node:child_process`/`node:net` (research R12).
2. **Member whitelist**: `parseTaskFile` consumes only the members above. Extra members a
   real adapter carries (`detect`, `taskFilePatterns`, `titleBehavior`,
   `agentHooksDirectory`) are invisible to the parser — structural typing means 003 may
   add or evolve them with zero 004 impact.
3. **Override precedence** (research R2): per convention,
   `adapter.<member> ?? config.<grammar key>` — the merged `ResolvedConfig` already
   carries built-in defaults, so the parser needs no third fallback.
4. **The `generic` fixture** (development stand-in):
   `tests/helpers/parsing-fixtures.ts` exports `genericFixtureAdapter` implementing the
   built-in `generic` adapter conventions observable through this interface only
   (001 FR-022/FR-025): no grammar overrides (inherits merged config defaults), no
   framework-specific exclusions, `featureName` derived from the
   `<feature-dir>/<taskfile>` path shape where configured or `undefined`. Four sibling
   fixture adapters (`bmad`, `spec-kit`, `open-spec`, `kiro`) vary only in
   interface-visible conventions for the five-framework corpus (research R10). Fixture
   adapters carry zero framework knowledge beyond what the interface exposes; adding a
   framework must never require parser changes (spec Assumption).
5. **Wave-3 seam** (deferred integration, NOT a Wave-2 task): when 003 lands,
   `003-generic-adapter-satisfies-consumption-contract` — a test importing
   003's real `generic` adapter and re-running the parsing contract suite against it —
   is added by the integrating wave. Until then the fixture is the sanctioned oracle, so
   004 is independently testable end to end (ROADMAP rule 4).

## Test obligations (mapped in quickstart)

- Import-purity scan over `src/parsing/**` (rule 1) — fails on 003 internals or I/O.
- Fixture-adapter conformance: `genericFixtureAdapter` (and the four framework fixtures)
  type-check and behave against `TaskFileAdapter` (compile-time + `featureName` table test).
- Override precedence table: adapter-supplied grammar wins over config default; absent
  adapter member falls back to merged config (custom adapter supplying id + heading
  grammar only still parses files — mirrors 001 FR-026's minimal custom-adapter shape).
