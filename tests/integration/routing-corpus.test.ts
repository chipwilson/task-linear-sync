/**
 * T009 [US1] — SC-001 integration: resolve the full fixture path corpus and prove
 * determinism. SC-001: "Routing over the fixture corpus resolves 100% of paths to the
 * designed team/project or a correct unassigned-with-indication, with identical results
 * on every re-run."
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveRouting } from "../../src/routing/resolve.js";
import { pathCorpus } from "../fixtures/routing-titles/factories.js";

/** One independent pass over the corpus, in order. */
function resolveCorpus(): unknown[] {
  return pathCorpus.map((row) => resolveRouting(row.filePath, row.slice));
}

test("routing corpus — SC-001: 100% of fixture paths resolve to the designed RoutingResolution", () => {
  assert.ok(pathCorpus.length >= 8, "corpus covers nested/tie/default/empty-map/unassigned paths");
  pathCorpus.forEach((row, i) => {
    const res = resolveRouting(row.filePath, row.slice);
    assert.deepEqual(res, row.expected, `corpus row ${i} (${row.filePath}) diverged from design`);
  });
});

test("routing corpus — SC-001: results are byte-identical on every re-run (determinism)", () => {
  const pass1 = JSON.stringify(resolveCorpus());
  const pass2 = JSON.stringify(resolveCorpus());
  const pass3 = JSON.stringify(resolveCorpus());
  assert.equal(pass2, pass1, "re-run 2 diverged from run 1");
  assert.equal(pass3, pass1, "re-run 3 diverged from run 1");
  assert.deepEqual(resolveCorpus(), resolveCorpus());
});
