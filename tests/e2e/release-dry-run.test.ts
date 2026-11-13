/**
 * T014 [015 US1] — the SC-001 proof: a REAL `node scripts/release.mjs --dry-run`
 * over the current tree — real `npm ci`, lint, typecheck, clean build, the full
 * suite, real `npm pack`, real archive verification, real defaults-scan — and
 * publish SKIPPED with verdict WOULD_PUBLISH (exit 0).
 *
 * Hermeticity notes:
 *   - the run happens in a THROWAWAY COPY of the repository (tar copy, no
 *     .git/node_modules/build/dist): deleting/rebuilding `dist/` (stage 4)
 *     must not race with parallel test siblings reading the real dist/;
 *   - the nested `npm test` (stage 5) inherits TLS_RELEASE_NESTED=1 (set by
 *     the orchestrator's test-full executor) and THIS test self-skips when it
 *     sees that marker — otherwise every suite run would recurse forever;
 *   - slow tier by design (contract T014): real npm legs, warm-cache offline.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const STAGES = [
  "install-locked",
  "lint",
  "typecheck",
  "build-clean",
  "test-full",
  "pack",
  "archive-verify",
  "defaults-scan",
  "publish",
];

test(
  "e2e dry-run: the full stage machine rehearses the release end to end (SC-001)",
  { skip: process.env.TLS_RELEASE_NESTED !== undefined ? "nested inside a release dry-run (recursion guard)" : false },
  () => {
    const work = mkdtempSync(join(tmpdir(), "u14-dryrun-"));
    const repo = join(work, "repo");
    mkdirSync(repo);
    try {
      // Tree copy: everything the pipeline needs, minus mutable/derived state.
      const copy = spawnSync(
        "bash",
        [
          "-c",
          `tar -cf - -C ${JSON.stringify(pkgRoot)} ` +
            `--exclude=./node_modules --exclude=./.git --exclude=./build --exclude=./dist ` +
            `--exclude=./coverage --exclude=./.opencode --exclude=./.specify . | tar -xf - -C ${JSON.stringify(repo)}`,
        ],
        { timeout: 300_000 },
      );
      assert.equal(copy.status, 0, `tree copy failed: ${copy.stderr}`);

      const dryEnv: Record<string, string | undefined> = { ...process.env, TLS_RELEASE_NESTED: "1" };
      delete dryEnv.NPM_TOKEN; // rehearsal is credential-free (docs/release-process.md): a stray
      delete dryEnv.NODE_AUTH_TOKEN; // token in the env would (rightly) MODE_CONFLICT the dry-run
      const run = spawnSync(process.execPath, ["scripts/release.mjs", "--dry-run"], {
        cwd: repo,
        encoding: "utf8",
        timeout: 25 * 60_000,
        env: dryEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      const stdout = String(run.stdout ?? "");
      const tail = stdout.split("\n").filter(Boolean).slice(-40).join("\n");
      assert.equal(run.status, 0, `dry-run exited ${run.status}; stdout tail:\n${tail}\nstderr: ${String(run.stderr ?? "").slice(-2000)}`);

      // Stage lines appear in FR-003 order, every real stage passed.
      const stageLines = stdout.split("\n").filter((l) => /^stage=/.test(l));
      assert.deepEqual(
        stageLines.map((l) => l.split(" ")[0]!.replace("stage=", "")),
        STAGES,
        `stage order:\n${stageLines.join("\n")}`,
      );
      for (const line of stageLines.slice(0, -1)) assert.match(line, /status=passed/, line);
      assert.match(stageLines.at(-1)!, /stage=publish status=skipped/);

      // Final verdict: exactly one JSON object on the last line.
      const last = stdout.trimEnd().split("\n").at(-1)!;
      const verdict = JSON.parse(last) as { verdict: string; dryRun: boolean; durationMs: number; stages: Array<{ name: string; status: string }> };
      assert.equal(verdict.verdict, "WOULD_PUBLISH");
      assert.equal(verdict.dryRun, true);
      assert.equal(verdict.stages.at(-1)!.name, "publish");
      assert.equal(verdict.stages.at(-1)!.status, "skipped");
      assert.ok(verdict.durationMs > 0);
    } finally {
      if (process.env.U14_KEEP === undefined) rmSync(work, { recursive: true, force: true });
    }
  },
);
