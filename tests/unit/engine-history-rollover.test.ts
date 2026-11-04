/**
 * T029 [P] [US2] — History-log vocabulary + rollover-split unit tests
 * (`src/engine/payload.ts computeRolloverSplit` + `src/engine/ops.ts
 * historyKindForUpdatedField`; FR-009/010; contracts/history-log.md §2–§3; data-model §5
 * §7).
 *
 * Scope honesty: the exactly-one-append / zero-events-for-no-change/refused-gates behavior
 * lives in `apply` (T043) and the page walk in `appendHistoryEvent` (T042) — neither is a
 * pure unit-testable surface yet. This file asserts what the PURE stub surface honestly
 * shows:
 *  1. The frozen `SyncHistoryEventKind` vocabulary is exactly the 8 kinds (type-level 1:1
 *     pin + runtime event construction) — GREEN (frozen domain, already real).
 *  2. `historyKindForUpdatedField` maps each `IssueUpdatePatch` field to its per-field
 *     kind (data-model §5: title→`title-updated`, description→`description-updated`,
 *     stateTypeId→`checkbox-changed`, FR-006) — RED on the ops.ts stub (T040).
 *  3. `computeRolloverSplit` (payload.ts stub — RED until T042; every test below throws
 *     `not implemented: payload`): table-driven per history-log §3 step 2 —
 *     `len(candidate) > historyLogMaxEntries` (default 50, STRICT `>`) or
 *     `bytes(canonicalSerialize(candidate)) > historyLogMaxBytes` (when configured)
 *     moves ONLY the new tail to page n+1.
 *
 * Pinning choices T040/T042 MUST honor:
 *  A. Byte measure = `Buffer.byteLength(canonicalJson(candidateEventArray), "utf8")` over
 *     the CANDIDATE EVENT ARRAY itself (`canonicalJson` is the frozen canonical
 *     serializer exported by `task-linear-sync/domain`), threshold compared with STRICT
 *     `>`; UTF-8 bytes, not code units.
 *  B. Split = the LONGEST prefix of `candidate` satisfying BOTH thresholds; `tail` is the
 *     complementary suffix, so `head ++ tail === candidate` element-wise and the head/tail
 *     entries are the IDENTICAL candidate objects (never re-serialized/copied/edited —
 *     FR-009 append-only, "never edited, reordered, removed"). Byte size of the canonical
 *     array serialization is strictly monotone in prefix length, so this longest-prefix
 *     rule can never evict entries an earlier page already holds.
 *  C. Empty candidate → `{ head: [], tail: [] }` — the pure mirror of "zero events for
 *     non-affecting outcomes" (§2): nothing splits, nothing pages.
 *  D. A single event already over `historyLogMaxBytes` on an empty page → `head: []`,
 *     `tail: [event]` (the new event alone starts page n+1; no existing entry is touched).
 *  E. The append simulation below (page-local rollover loop) pins the §3 invariants
 *     end-to-end on the pure surface: existing page content stays a strict PREFIX of the
 *     page after every append (entries never move backwards or get rewritten), rollover
 *     only ADDS pages, and total entry count is conserved.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { computeRolloverSplit } from "../../src/engine/payload.js";
import type { RolloverSplit } from "../../src/engine/payload.js";
import { historyKindForUpdatedField } from "../../src/engine/ops.js";

import { canonicalJson } from "task-linear-sync/domain";
import type { SyncHistoryEvent, SyncHistoryEventKind } from "task-linear-sync/domain";
import { loadConfig } from "task-linear-sync/config";
import type { ResolvedConfig } from "task-linear-sync/config";
import type { IssueUpdatePatch } from "task-linear-sync/ports";

// ── Fixtures (hermetic: fixed ISO stamps, placeholder descriptions, zero real ids) ──

const FROZEN_KINDS = [
  "discovered",
  "issue-created",
  "matched",
  "title-updated",
  "description-updated",
  "checkbox-changed",
  "conflict-detected",
  "rollback",
] as const satisfies readonly SyncHistoryEventKind[];

/** Compile-time 1:1 pin: each side of the pairing must cover the other exactly. */
type CoversFrozen = SyncHistoryEventKind extends (typeof FROZEN_KINDS)[number] ? true : never;
type CoversList = (typeof FROZEN_KINDS)[number] extends SyncHistoryEventKind ? true : never;
const VOCABULARY_FROZEN_COVERED: CoversFrozen = true;
const VOCABULARY_LIST_FROZEN: CoversList = true;

function makeEvent(index: number, description?: string): SyncHistoryEvent {
  return {
    kind: FROZEN_KINDS[index % FROZEN_KINDS.length] as SyncHistoryEventKind,
    at: `2026-01-01T00:${String(index % 60).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
    description: description ?? `sync-affecting action ${index}`,
  };
}

function events(count: number, description?: string): SyncHistoryEvent[] {
  return Array.from({ length: count }, (_, i) => makeEvent(i, description));
}

function configWith(overrides: { historyLogMaxEntries?: number; historyLogMaxBytes?: number }): ResolvedConfig {
  return loadConfig({ overrides });
}

function canonicalBytes(candidate: readonly SyncHistoryEvent[]): number {
  return Buffer.byteLength(canonicalJson(candidate), "utf8");
}

const SPLIT_KEYS = ["head", "tail"] as const;

/** Deep shape assertions every split must satisfy (pinning B) — before per-row expectations. */
function assertSplitIsAPureSlice(split: RolloverSplit, candidate: readonly SyncHistoryEvent[]): void {
  assert.deepEqual(Object.keys(split).sort(), [...SPLIT_KEYS].sort(), "exactly { head, tail }");
  assert.ok(split.head.length + split.tail.length === candidate.length, "head ++ tail covers candidate");
  split.head.forEach((entry, i) => {
    assert.equal(entry, candidate[i], `head[${i}] is the identical candidate object (never re-written)`);
  });
  split.tail.forEach((entry, i) => {
    assert.equal(entry, candidate[split.head.length + i], `tail[${i}] is the identical candidate object`);
  });
  assert.deepEqual([...split.head, ...split.tail], candidate, "head ++ tail === candidate");
}

// ── 1. Frozen vocabulary (GREEN — frozen domain surface already real) ───────────────

test("engine-history-rollover — SyncHistoryEvent kind union is 1:1 with the frozen eight-kind vocabulary", () => {
  assert.equal(VOCABULARY_FROZEN_COVERED, true, "frozen union ⊆ list compiled");
  assert.equal(VOCABULARY_LIST_FROZEN, true, "list ⊆ frozen union compiled");
  assert.deepEqual(
    [...FROZEN_KINDS].sort(),
    [
      "checkbox-changed",
      "conflict-detected",
      "description-updated",
      "discovered",
      "issue-created",
      "matched",
      "rollback",
      "title-updated",
    ],
    "history-log §2 table, verbatim",
  );
  for (const kind of FROZEN_KINDS) {
    const event: SyncHistoryEvent = { kind, at: "2026-01-01T00:00:00.000Z", description: `event ${kind}` };
    assert.ok(FROZEN_KINDS.includes(event.kind), `${kind} is a constructible frozen event`);
  }
});

// ── 2. historyKindForUpdatedField (RED — ops.ts stub, not implemented: ops; T040) ───

test("engine-history-rollover — every IssueUpdatePatch field maps 1:1 to its frozen history kind (data-model §5)", () => {
  const fields: readonly (keyof IssueUpdatePatch)[] = ["title", "description", "stateTypeId"];
  const mapped = fields.map((field) => historyKindForUpdatedField(field));
  assert.deepEqual(mapped, ["title-updated", "description-updated", "checkbox-changed"], "per-field kinds, in field order");
  assert.equal(new Set(mapped).size, 3, "three distinct kinds — no two fields collapse");
  for (const kind of mapped) {
    assert.ok(FROZEN_KINDS.includes(kind), `${kind} stays inside the frozen vocabulary`);
  }
});

// ── 3. computeRolloverSplit table (RED — payload.ts stub, not implemented: payload; T042)

const DEFAULTS = configWith({});

test("engine-history-rollover — default config carries historyLogMaxEntries 50 and no byte threshold (data-model §7)", () => {
  assert.equal(DEFAULTS.historyLogMaxEntries, 50);
  assert.equal(DEFAULTS.historyLogMaxBytes, undefined);
});

type RolloverRow = {
  readonly name: string;
  readonly candidate: readonly SyncHistoryEvent[];
  readonly config: ResolvedConfig;
  readonly headLength: number;
};

const ROWS: readonly RolloverRow[] = [
  { name: "empty candidate → no split, no page (pinning C)", candidate: [], config: DEFAULTS, headLength: 0 },
  { name: "49 < 50 default entries → whole candidate stays", candidate: events(49), config: DEFAULTS, headLength: 49 },
  { name: "exactly 50 entries (STRICT >) → no rollover", candidate: events(50), config: DEFAULTS, headLength: 50 },
  {
    name: "51 > 50 entries → ONLY the new tail rolls",
    candidate: events(51),
    config: DEFAULTS,
    headLength: 50,
  },
  {
    name: "custom maxEntries 3 with 6 candidates → head 3, tail 3",
    candidate: events(6),
    config: configWith({ historyLogMaxEntries: 3 }),
    headLength: 3,
  },
  {
    name: "maxEntries 3 with exactly 3 → no rollover",
    candidate: events(3),
    config: configWith({ historyLogMaxEntries: 3 }),
    headLength: 3,
  },
];

for (const row of ROWS) {
  test(`engine-history-rollover — count threshold: ${row.name}`, () => {
    const split = computeRolloverSplit(row.candidate, row.config);
    assertSplitIsAPureSlice(split, row.candidate);
    assert.equal(split.head.length, row.headLength);
    assert.equal(split.tail.length, row.candidate.length - row.headLength);
  });
}

test("engine-history-rollover — byte threshold uses canonicalJson(candidate) UTF-8 bytes with strict > (pinning A)", () => {
  const candidate = events(5, "x".repeat(120));
  const bytes3 = canonicalBytes(candidate.slice(0, 3));
  const bytes4 = canonicalBytes(candidate.slice(0, 4));
  assert.ok(bytes4 > bytes3, "canonical array size is strictly monotone in prefix length");
  for (const [maxBytes, headLength] of [
    [bytes3, 3], // == threshold stays (strict >)
    [bytes3 + 1, 3],
    [bytes4, 4],
    [bytes4 - 1, 3],
    [bytes3 - 1, 2],
  ] as const) {
    const split = computeRolloverSplit(candidate, configWith({ historyLogMaxBytes: maxBytes }));
    assertSplitIsAPureSlice(split, candidate);
    assert.equal(split.head.length, headLength, `maxBytes=${maxBytes} → longest in-threshold prefix`);
  }
});

test("engine-history-rollover — unconfigured maxBytes keeps the count rule authoritative", () => {
  const candidate = events(60, "y".repeat(400));
  const split = computeRolloverSplit(candidate, configWith({ historyLogMaxBytes: 10 ** 9 }));
  assertSplitIsAPureSlice(split, candidate);
  assert.equal(split.head.length, 50, "default 50-entry page even though entries are fat");
  assert.equal(split.tail.length, 10);
});

test("engine-history-rollover — both thresholds combine: head is the LONGEST prefix satisfying both (pinning B)", () => {
  const candidate = events(10, "z".repeat(80));
  const bytes3 = canonicalBytes(candidate.slice(0, 3));
  const split = computeRolloverSplit(candidate, configWith({ historyLogMaxEntries: 10, historyLogMaxBytes: bytes3 }));
  assertSplitIsAPureSlice(split, candidate);
  assert.equal(split.head.length, 3, "count would allow 10, bytes cap at 3");
  assert.equal(split.tail.length, 7);
});

test("engine-history-rollover — one over-threshold event on an empty page rolls whole, head empty (pinning D)", () => {
  const candidate = events(1, "q".repeat(500));
  const split = computeRolloverSplit(candidate, configWith({ historyLogMaxBytes: canonicalBytes(candidate) - 1 }));
  assertSplitIsAPureSlice(split, candidate);
  assert.deepEqual(split.head, []);
  assert.equal(split.tail.length, 1);
});

test("engine-history-rollover — append simulation: pages only grow by prefix + new pages, never backwards (pinning E)", () => {
  const config = configWith({ historyLogMaxEntries: 10 });
  const pages: SyncHistoryEvent[][] = [[]];
  let landed = 0;
  for (const event of events(25)) {
    const index = pages.length - 1;
    const prior = pages[index];
    const candidate = [...prior, event];
    const split = computeRolloverSplit(candidate, config);
    assertSplitIsAPureSlice(split, candidate);
    // Entries already on this page are a strict prefix of the new head — never edited,
    // reordered, removed, or moved backwards (history-log §3 append-only invariants).
    assert.deepEqual(
      split.head.slice(0, prior.length),
      prior,
      `append ${landed}: prior page-${index} content preserved as prefix`,
    );
    assert.ok(split.head.length >= prior.length, "a page never shrinks on append");
    pages[index] = [...split.head];
    if (split.tail.length > 0) {
      pages.push([...split.tail]); // rollover ADDS page n+1 only; existing pages untouched
      assert.ok(index + 1 === pages.length - 1, "tail lands on the fresh next page");
    }
    landed += 1;
    assert.ok(
      pages.every((page) => page.length <= config.historyLogMaxEntries),
      "no page exceeds historyLogMaxEntries after the append settles",
    );
  }
  const total = pages.reduce((n, page) => n + page.length, 0);
  assert.equal(total, 25, "every landed event is on exactly one page — none lost or duplicated");
  assert.ok(pages.length > 1, "25 events on 10-entry pages must have rolled");
  assert.deepEqual(pages[0], events(10), "page 0 holds the first ten events, in order");
});

test("engine-history-rollover — computeRolloverSplit is pure: repeated calls agree and inputs are untouched", () => {
  const candidate = events(7, "p".repeat(200));
  const snapshot = [...candidate];
  const config = configWith({ historyLogMaxEntries: 4 });
  const first = computeRolloverSplit(candidate, config);
  const second = computeRolloverSplit(candidate, config);
  assert.deepEqual(first.head, second.head);
  assert.deepEqual(first.tail, second.tail);
  assert.deepEqual(candidate, snapshot, "candidate array untouched");
});
