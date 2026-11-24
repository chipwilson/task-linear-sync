/**
 * T020 [P] [US3] — unit tests for the (T022) status-event loader `src/parsing/status.ts`
 * (feature 023 contract C6.1; data-model §1 "Status event"; research R5). RED-FIRST: the
 * module does not exist until T022, so the guarded import yields no function and every
 * assertion fails.
 *
 * Pinned rules:
 *  - qualifying line = valid JSON OBJECT with a string `wp_id` AND a string `to_lane` at
 *    the TOP level (envelope events like `WPCreated` carry `wp_id` only inside `payload`
 *    — non-qualifying, skipped without poisoning order);
 *  - the LAST qualifying line per `wp_id` in FILE ORDER wins (append-only = canonical);
 *  - malformed lines are COUNTED only — their content never propagates anywhere;
 *  - blank lines and non-object JSON are skips, not malformations;
 *  - values ride verbatim: the nine-lane vocabulary is `LANE_VOCABULARY`, and anything
 *    else (bootstrap `genesis`) is simply not in it — the engine treats it as known-unmapped;
 *  - unknown `wp_id`s stay in the map — ignoring-with-a-finding is the engine's job.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { LANE_VOCABULARY } from "task-linear-sync/domain";

const moduleSpecifier = "../../src/parsing/status.js";
const mod = (await import(moduleSpecifier).catch(() => null)) as {
  parseStatusEventLog?: (lines: readonly string[]) => {
    readonly lanes: ReadonlyMap<string, string>;
    readonly malformedCount: number;
  };
} | null;

function parse(lines: readonly string[]): { lanes: ReadonlyMap<string, string>; malformedCount: number } {
  assert.equal(typeof mod?.parseStatusEventLog, "function", "src/parsing/status.ts exposes parseStatusEventLog (T022 subject)");
  return mod!.parseStatusEventLog!(lines);
}

test("023 status log: qualifying lines map wp_id → to_lane; envelope and annotation lines skip without poisoning order", () => {
  const d = parse([
    '{"aggregate_type":"work_package","event_type":"WPCreated","payload":{"wp_id":"WP01"},"schema_version":"5.0.0"}', // envelope — no top-level wp_id/to_lane
    '{"wp_id":"WP02","from_lane":"genesis","to_lane":"planned"}',
    '{"kind":"annotation","wp_id":"WP01","delta":"opened"}', // annotation — no to_lane
    '{"wp_id":"WP02","from_lane":"planned","to_lane":"in_progress"}',
  ]);
  assert.deepEqual([...d.lanes.entries()], [["WP02", "in_progress"]], "ONLY the qualifying lines count; LAST wins in FILE ORDER");
  assert.equal(d.malformedCount, 0);
});

test("023 status log: last qualifying line wins even when later lines are junk or other wp_ids", () => {
  const d = parse([
    '{"wp_id":"WP03","to_lane":"in_progress"}',
    '{"wp_id":"WP99","to_lane":"done"}', // unknown ids stay — the engine reports and ignores
    'not json at all',
    '{"wp_id":"WP03","to_lane":"canceled"}',
    '{"wp_id":42,"to_lane":"done"}', // non-string wp_id — non-qualifying skip
    '{"wp_id":"WP04","to_lane":404}', // non-string to_lane — non-qualifying skip
    '{"wp_id":"WP03","to_lane":"blocked"}',
  ]);
  assert.deepEqual(
    [...d.lanes.entries()].sort(),
    [
      ["WP03", "blocked"],
      ["WP99", "done"],
    ],
    "append-only order is authoritative; junk between events never reorders anything",
  );
  assert.equal(d.malformedCount, 1, "only the unparseable line is malformed; type-strict skips are not");
});

test("023 status log: malformed lines are counted ONLY — content never propagates", () => {
  const SECRET_LINE = "{ this line is deliberately malformed — SECRET9 never leaves the log";
  const d = parse([SECRET_LINE, '{"wp_id":"WP01","to_lane":"planned"}', "{ broken again"]);
  assert.equal(d.malformedCount, 2, "one reported finding carries the COUNT");
  assert.equal(d.lanes.get("WP01"), "planned", "surviving events still parse");
  assert.ok(!JSON.stringify([...d.lanes.entries()]).includes("deliberately"), "malformed content never propagates");
  assert.ok(!JSON.stringify([...d.lanes.entries()]).includes("SECRET9"));
});

test("023 status log: blank lines, non-object JSON, and arrays are skips, not malformations", () => {
  const d = parse(["", "   ", "[]", "null", '"bare string"', "42", '{"wp_id":"WP01","to_lane":"done"}']);
  assert.equal(d.malformedCount, 0);
  assert.deepEqual([...d.lanes.entries()], [["WP01", "done"]]);
});

test("023 status log: empty input yields an empty map — a missing file is never an error", () => {
  const d = parse([]);
  assert.equal(d.lanes.size, 0);
  assert.equal(d.malformedCount, 0);
});

test("023 lane vocabulary: the nine lanes are the key space; bootstrap genesis and anything else is known-unmapped", () => {
  assert.deepEqual(
    [...LANE_VOCABULARY],
    ["planned", "claimed", "in_progress", "for_review", "in_review", "approved", "done", "blocked", "canceled"],
    "the shipped vocabulary, in order",
  );
  const d = parse([
    '{"wp_id":"WP01","to_lane":"genesis"}', // bootstrap pseudo-lane
    '{"wp_id":"WP02","to_lane":"in_progress"}',
  ]);
  assert.equal(d.lanes.get("WP01"), "genesis", "the value rides verbatim — recognition is vocabulary membership");
  assert.ok(!(LANE_VOCABULARY as readonly string[]).includes(d.lanes.get("WP01")!), "genesis is NOT a lane — the engine maps it to untouched + finding");
  assert.ok((LANE_VOCABULARY as readonly string[]).includes(d.lanes.get("WP02")!));
});
