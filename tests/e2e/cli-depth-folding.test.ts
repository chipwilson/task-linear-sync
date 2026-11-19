/**
 * T032 + T033 [P] [US3] — CLI lane e2e for task-depth folding (feature 020 C6/C9;
 * SC-004; quickstart Scenarios 4–5). Drives the REAL compiled CLI entry point
 * (`dist/cli/main.js`) over scratch repositories (quickstart Scenario 4 shape: task file
 * + `task-linear-sync.json` config file), plus `writeDriver` child processes over the
 * fake-port world `tests/fixtures/cli/worlds/depth-folding` for the determinism cell.
 *
 * Cells:
 *  1. Invalid `maxTaskIssueDepth` FILE-layer values (0, −1, 1.5, 65, "1") — every one
 *     refuses on `inventory` with exit 3 and EXACTLY ONE diagnostic naming the key and
 *     the offending value with the contract reason (below-minimum / not-an-integer /
 *     above-maximum); zero state written (the configured state dir is never created) and
 *     zero repo writes (git status stays clean). The values pass the typed config merge
 *     structurally (C10: `loadConfig` stays merge-only) and refuse at the parsing entry
 *     (C6) — refusal happens before any task is parsed. A placeholder
 *     `LINEAR_ACCESS_TOKEN` is exported solely to get past the offline credential
 *     preflight (the read-only lane constructs the port eagerly; `inventory` itself
 *     never touches a port member — zero network by construction, so the placeholder is
 *     never used for a request).
 *  2. Valid caps 1/2/3/64 — `inventory` exits 0; the visible per-cap task totals are
 *     1/2/3/4. `inventory` has no dedicated folded-count field (and no `--json`), so the
 *     honest folded-count signal is the task total itself: folded lines at cap `c` are
 *     exactly `4 − tasks(c)` (3 folded at the flat-board default, 0 at the escape hatch).
 *  3. Determinism (C9/I6) — the frozen command surface has NO `plan --json` and NO
 *     `inventory --json` (quickstart Scenario 5 predates the surface freeze; `check` is
 *     its machine-readable plan lane). Two consecutive REAL `inventory` processes over
 *     the SAME scratch repo with the cap key ABSENT (⇒ built-in default 1, folded)
 *     produce byte-identical raw stdout/stderr Buffers. A cross-process byte compare of
 *     the `check` lane is structurally impossible with the shared harness: every
 *     `writeDriver` child materializes the repo under a FRESH temp path, and the plan
 *     embeds its absolute `repositoryRoot` (planId + report paths ride that identity),
 *     so the two runs do not share identical inputs — the compare would measure the
 *     harness's temp-dir churn, not the fold. `check` is therefore single-run asserted
 *     (folded lines invisible in plan totals), and the byte-identity plus stable
 *     ascending ordering of the `depth-folded` exclusion records — which appear on NO
 *     stdout surface — is verified at the parsing entry (the contract's “plan (or parse)
 *     runs” wording): two consecutive `parseTaskFile` runs are byte-identical
 *     (`JSON.stringify` compare per the `discovery.test.ts` determinism precedent) with
 *     the records strictly ascending.
 *
 * Header task IDs: T032, T033.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { loadConfig } from "task-linear-sync/config";
import { builtInAdapters } from "task-linear-sync/discovery";
import { parseTaskFile, type TaskFileAdapter } from "task-linear-sync/parsing";

import { cliWorldDir, writeDriver } from "../helpers/cli-harness.js";

// ─────────────────────────────────────────────────────────────────────── plumbing

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));

/** The REAL compiled CLI bin (quickstart Scenario 4 runs exactly this entry point). */
const CLI_MAIN = join(pkgRoot, "dist", "cli", "main.js");

/** Offline credential-preflight placeholder — never used for a request (see docblock). */
const PLACEHOLDER_TOKEN = "tls-020-e2e-placeholder-token";

const scratch = mkdtempSync(join(tmpdir(), "tls-020-depth-e2e-"));

test.after(() => {
  rmSync(scratch, { recursive: true, force: true });
});

/** Fixture world repo (four nested levels; routing identities live in world.json). */
const WORLD_DIR = cliWorldDir("depth-folding");
const TASKS_REL = "specs/demo/tasks.md";

/** Generic adapter narrowed to the parsing-facing type (engine `build.ts` precedent). */
const GENERIC = builtInAdapters["generic"] as unknown as TaskFileAdapter;

/** `git` helper with a hermetic identity (never touches the developer config). */
function git(args: readonly string[], cwd: string): string {
  const r = spawnSync(
    "git",
    ["-c", "user.email=tls-e2e@example.invalid", "-c", "user.name=tls-e2e", "-c", "commit.gpgsign=false", ...args],
    { cwd, encoding: "utf8", timeout: 60_000 },
  );
  assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout;
}

/**
 * Materialize one scratch repository per quickstart Scenario 4: task file copied from
 * the fixture world + a `task-linear-sync.json` whose `maxTaskIssueDepth` carries the
 * raw candidate value (JSON literal), committed so ANY later change shows in porcelain.
 */
function materialize(name: string, capLiteral: string | null): { repo: string; stateDir: string } {
  const repo = join(scratch, name, "repo");
  const stateDir = join(scratch, name, "state"); // OUTSIDE the repo (frozen placement rule)
  mkdirSync(repo, { recursive: true });
  cpSync(join(WORLD_DIR, "repo"), repo, { recursive: true });
  const lines = [
    "{",
    ...(capLiteral === null ? [] : [`  "maxTaskIssueDepth": ${capLiteral},`]),
    `  "stateDirectory": ${JSON.stringify(stateDir)},`,
    '  "teams": { "acme": { "projects": ["p"], "workflowStates": { "backlog": "B", "done": "D" } } },',
    '  "defaultTeamKey": "acme",',
    '  "defaultProject": "p",',
    '  "confirmationKey": "ACME"',
    "}",
  ];
  writeFileSync(join(repo, "task-linear-sync.json"), lines.join("\n") + "\n", "utf8");
  git(["init", "-q"], repo);
  git(["add", "-A"], repo);
  git(["commit", "-q", "-m", "seed"], repo);
  return { repo, stateDir };
}

/** Spawn the real CLI `inventory` against a scratch repo. */
function driveInventory(repo: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync(process.execPath, [CLI_MAIN, "inventory"], {
    cwd: repo,
    encoding: "utf8",
    timeout: 120_000,
    env: { ...process.env, LINEAR_ACCESS_TOKEN: PLACEHOLDER_TOKEN },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** Raw-byte child-process drive (no line splitting — determinism byte compare). */
function driveRaw(driverPath: string): { status: number | null; stdout: Buffer } {
  const r = spawnSync(process.execPath, [driverPath], { timeout: 120_000 });
  return { status: r.status, stdout: r.stdout };
}

/** Raw-byte spawn of the real CLI `inventory` (byte-identity assertions, C9). */
function driveRawInventory(repo: string): { status: number | null; stdout: Buffer; stderr: Buffer } {
  const r = spawnSync(process.execPath, [CLI_MAIN, "inventory"], {
    cwd: repo,
    timeout: 120_000,
    env: { ...process.env, LINEAR_ACCESS_TOKEN: PLACEHOLDER_TOKEN },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

// ───────────────────────────────────────────────────────── T032 — refusal + success

test("cli-depth-folding — invalid maxTaskIssueDepth file values refuse inventory with exit 3, one named diagnostic, zero writes (C6/SC-004)", () => {
  const refusals: readonly { readonly json: string; readonly reason: string; readonly shown: string }[] = [
    { json: "0", reason: "below-minimum", shown: "0" },
    { json: "-1", reason: "below-minimum", shown: "-1" },
    { json: "1.5", reason: "not-an-integer", shown: "1.5" },
    { json: "65", reason: "above-maximum", shown: "65" },
    { json: '"1"', reason: "not-an-integer", shown: '"1"' },
  ];
  for (const { json, reason, shown } of refusals) {
    const { repo, stateDir } = materialize(`refuse-${json.replace(/[^a-z0-9]/gi, "_")}`, json);
    const run = driveInventory(repo);
    assert.equal(run.status, 3, `cap ${json} must exit 3 (configuration) — stdout: ${run.stdout}`);
    assert.equal(run.stdout, "", `cap ${json}: refusal prints nothing on stdout`);
    const lines = run.stderr.split("\n").filter((l) => l.length > 0);
    assert.equal(lines.length, 1, `cap ${json}: exactly one diagnostic line, got: ${run.stderr}`);
    assert.equal(
      lines[0],
      `error: configuration key 'maxTaskIssueDepth' failed: ${reason} (value: ${shown})`,
      `cap ${json}: the diagnostic names the key, the reason, and the offending value only`,
    );
    assert.ok(lines[0]!.includes("maxTaskIssueDepth") && lines[0]!.includes(shown), "key + value are named");
    assert.equal(existsSync(stateDir), false, `cap ${json}: zero state written (state dir never created)`);
    assert.equal(git(["status", "--porcelain"], repo), "", `cap ${json}: repo git status clean — zero repo writes`);
  }
});

test("cli-depth-folding — caps 1/2/3/64 succeed on inventory and the task totals expose the fold (SC-004)", () => {
  const expected: readonly { readonly json: string; readonly tasks: number }[] = [
    { json: "1", tasks: 1 },
    { json: "2", tasks: 2 },
    { json: "3", tasks: 3 },
    { json: "64", tasks: 4 },
  ];
  const totals: number[] = [];
  for (const { json, tasks } of expected) {
    const { repo, stateDir } = materialize(`cap-${json}`, json);
    const run = driveInventory(repo);
    assert.equal(run.status, 0, `cap ${json} must succeed — stderr: ${run.stderr}`);
    assert.equal(run.stderr, "", `cap ${json}: clean run prints no diagnostics`);
    assert.equal(
      run.stdout,
      `${TASKS_REL}  framework=generic  tasks=${tasks}\n`,
      `cap ${json}: visible task total`,
    );
    assert.equal(existsSync(stateDir), false, `cap ${json}: read-only inventory wrote no state`);
    assert.equal(git(["status", "--porcelain"], repo), "", `cap ${json}: repo git status clean`);
    totals.push(tasks);
  }
  // The honest folded-count signal: inventory reports surviving tasks only, so folded
  // lines show up as a shrinking total. 4 nested drafts total ⇒ folded(c) = 4 − tasks(c).
  assert.deepEqual(totals, [1, 2, 3, 4], "task totals strictly increase with the cap");
  assert.equal(4 - totals[0]!, 3, "flat board at cap 1 folds 3 lines (no parented survivors)");
  assert.equal(4 - totals[3]!, 0, "cap 64 (escape hatch) folds nothing");
});

// ─────────────────────────────────────────────────────────────── T033 — determinism

test("cli-depth-folding — double runs are byte-identical; depth-folded exclusions keep stable ascending order (C9/I6)", () => {
  // (1) Two consecutive REAL CLI processes over the SAME scratch repo, cap key ABSENT
  // (⇒ built-in default 1 ⇒ folded board), sharing one state dir. Byte-for-byte stdout
  // compare on raw Buffers (quickstart Scenario 5 shape — minus the `--json` flags that
  // the frozen inventory/plan surfaces do not offer).
  const { repo, stateDir } = materialize("determinism-inventory", null);
  const runA = driveRawInventory(repo);
  const runB = driveRawInventory(repo);
  assert.equal(runA.status, 0, "first inventory run succeeds");
  assert.equal(runB.status, 0, "second inventory run succeeds");
  assert.equal(
    Buffer.compare(Buffer.from(runA.stdout), Buffer.from(runB.stdout)),
    0,
    "two consecutive runs are byte-identical on stdout (cmp-style Buffer compare)",
  );
  assert.equal(
    Buffer.compare(Buffer.from(runA.stderr), Buffer.from(runB.stderr)),
    0,
    "stderr equally byte-identical (both empty)",
  );
  assert.equal(runA.stdout.toString("utf8"), `${TASKS_REL}  framework=generic  tasks=1\n`, "the deterministic output is the folded (flat-board) total");
  assert.equal(existsSync(stateDir), false, "deterministic read-only runs still write zero state");

  // (2) The plan lane (`check`, the JSON-summary command) is asserted SINGLE-run here —
  // see docblock for why a cross-process byte compare of its stdout would measure the
  // harness temp-path churn rather than the fold (plan identity embeds `repositoryRoot`).
  const stateDir2 = join(scratch, "check-state");
  const driverPath = join(scratch, "driver-check.mjs");
  writeDriver({ driverPath, worldDir: WORLD_DIR, argv: ["check"], stateDir: stateDir2 });
  const checked = driveRaw(driverPath);
  assert.equal(checked.status, 0, "check (JSON plan lane) succeeds on the folded world");
  const summaryLine = checked.stdout
    .toString("utf8")
    .split("\n")
    .filter((l) => l.startsWith("OUT|"))
    .map((l) => l.slice(4))
    .at(-1)!;
  const summary = JSON.parse(summaryLine) as {
    planId: string;
    counts: { entries: number; unmapped: number; unresolvedConflicts: number; lowConfidence: number };
  };
  assert.match(summary.planId, /^[0-9a-f]{64}$/, "deterministic-shape planId");
  assert.equal(summary.counts.entries, 1, "plan totals see ONLY the surviving depth-1 task (C8 — folded lines invisible downstream)");
  assert.equal(summary.counts.unmapped, 0, "no unmapped noise from folded lines");

  // (3) NO stdout surface carries the exclusion list, so the ORDERING half of C9/I6 is
  // verified at the parsing entry (the contract's “plan (or parse) runs” wording): two
  // consecutive parseTaskFile runs are byte-identical and the depth-folded records sit
  // strictly ascending (I5), verbatim, one per over-cap line.
  const content = readFileSync(join(WORLD_DIR, "repo", TASKS_REL), "utf8");
  const config = loadConfig({}); // key absent ⇒ built-in default cap 1
  assert.equal(config.maxTaskIssueDepth, 1, "absent key resolves to the built-in default 1");
  const first = JSON.stringify(parseTaskFile(TASKS_REL, content, GENERIC, config));
  const second = JSON.stringify(parseTaskFile(TASKS_REL, content, GENERIC, config));
  assert.equal(first, second, "byte-identical serialized ParseResult across consecutive runs (SC-002 precedent, discovery.test.ts)");
  const parsed = parseTaskFile(TASKS_REL, content, GENERIC, config);
  const folded = parsed.exclusions.filter((e) => e.reason === "depth-folded");
  assert.deepEqual(folded.map((e) => e.lineNumber), [6, 9, 12], "exactly the three over-cap lines, ascending by line (I5)");
  const sourceLines = content.split("\n");
  for (const exclusion of folded) {
    assert.equal(exclusion.kind, "checklist");
    assert.ok(
      sourceLines[exclusion.lineNumber - 1]?.includes(exclusion.text.trim()),
      `exclusion text is the source line verbatim (L${exclusion.lineNumber})`,
    );
  }
});
