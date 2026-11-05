/**
 * T029 [US2] — CLI-produced plan reports conform to the FROZEN plan-report schema
 * (`specs/002-core-domain-contracts/contracts/plan-report.schema.json`, draft 2020-12,
 * `additionalProperties: false` at every level). The pair is produced by running the
 * real `plan` lane through `runCli` over the `review-report/` and `zero-task/` CLI
 * worlds and validating the generated `reports/<runId>/report.json` with the shared
 * T028 validator (FR-006/008; plan-artifact.md § Test obligations).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { runCli } from "../../src/cli/index.js";
import { buildCliWorld, type CliWorld } from "../helpers/cli-harness.js";
import { assertSchemaValid, type JsonSchema } from "../helpers/json-schema-mini.js";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const schema = JSON.parse(
  readFileSync(new URL("specs/002-core-domain-contracts/contracts/plan-report.schema.json", `file://${pkgRoot}`), "utf8"),
) as JsonSchema;

/** Run `plan`; return the parsed JSON artifact (path taken from the printed pair). */
async function planArtifact(w: CliWorld): Promise<unknown> {
  const { cliContext, stdout, stderr } = w.createContext();
  const outcome = await runCli(["plan", w.repositoryRoot], cliContext);
  assert.equal(outcome.exitCode, 0, stderr.join("\n"));
  const jsonLine = stdout.find((l) => l.startsWith("report ") && l.endsWith("report.json"));
  assert.ok(jsonLine, `report.json line printed: ${stdout.join("\n")}`);
  return JSON.parse(readFileSync(jsonLine.slice("report ".length), "utf8")) as unknown;
}

test("review-report plan artifact validates against the frozen plan-report schema", async () => {
  const w = await buildCliWorld("review-report");
  try {
    const report = (await planArtifact(w)) as {
      groups: unknown[];
      unmapped: unknown[];
      securityAssertions: unknown[];
    };
    assertSchemaValid(report, schema, "review-report report.json");
    assert.ok(report.groups.length > 0, "grouped entries exist");
    assert.ok(report.securityAssertions.length >= 1, "minItems: 1 security assertions");
  } finally {
    await w.dispose();
  }
});

test("zero-task plan artifact validates with empty groups and unmapped sections", async () => {
  const w = await buildCliWorld("zero-task");
  try {
    const report = (await planArtifact(w)) as { groups: unknown[]; unmapped: unknown[] };
    assertSchemaValid(report, schema, "zero-task report.json");
    assert.deepEqual(report.groups, []);
    assert.deepEqual(report.unmapped, []);
  } finally {
    await w.dispose();
  }
});
