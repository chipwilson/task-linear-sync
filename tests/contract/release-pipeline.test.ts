/**
 * T012 + T021 + T023 + T028 [015] — release-pipeline contract
 * (contracts/release-pipeline.md §1–§5; FR-003/006/007/009; SC-002/SC-003).
 *
 * Four layers, all hermetic (real npm/git/network legs never run here — that
 * is tests/e2e/release-dry-run.test.ts):
 *   1. core: stage catalog vs data-model §2, flag/usage machine, exit codes,
 *      MODE_CONFLICT, verdict JSON secret-safety (scan module reused);
 *   2. mutation harness 6/6 (SC-002): synthetic fault worlds through the
 *      orchestrator — every refusal names its stage + code AND publish never
 *      executes;
 *   3. workflow shapes: ci.yml `release-dry-run` (zero secrets, PR-triggered)
 *      and release.yml (workflow_dispatch-only, permissions exactly
 *      contents:read + id-token:write);
 *   4. preflight refusals (T028): dirty tree / missing tag / tag≠HEAD /
 *      TAG_MISMATCH naming both versions with ZERO stages executed; dry-run
 *      skips preflight entirely.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));

interface StageResult {
  name: string;
  status: string;
  ms: number;
}
interface Verdict {
  verdict: string;
  stage: string | null;
  reason: string | null;
  tag: string | null;
  dryRun: boolean;
  durationMs: number;
  stages: StageResult[];
}
interface ReleaseRun {
  verdict: Verdict;
  exitCode: number;
}
interface ReleaseModule {
  STAGES: readonly string[];
  Refuse: new (code: string, detail?: string) => Error & { code: string };
  parseArgs(argv: string[]): { mode: string | null; tag: string | null; allowUnattested: boolean; usageErrors: string[] };
  preflight(tag: string, exec?: (cmd: string, args: string[], opts?: object) => { status: number | null; stdout?: string; stderr?: string }): void;
  runRelease(io: {
    argv: string[];
    env?: Record<string, string | undefined>;
    executors?: Record<string, (ctx: Record<string, unknown>) => void>;
    log?: (line: string) => void;
    preflightImpl?: (tag: string) => void;
    repoVersion?: string;
    ctx?: Record<string, unknown>;
  }): ReleaseRun;
  defaultExecutors(ctx: Record<string, unknown>, opts: object): Record<string, (ctx?: Record<string, unknown>) => void>;
}
const rel = (await import(new URL("../../../scripts/release.mjs", import.meta.url).href)) as unknown as ReleaseModule;
const scan = (await import(new URL("../../../scripts/lib/secret-scan.mjs", import.meta.url).href)) as unknown as {
  scanText(text: string): Array<{ why: string; hit: string }>;
};

const manifestVersion = (JSON.parse(readFileSync(join(pkgRoot, "package.json"), "utf8")) as { version: string }).version;

const scratch = mkdtempSync(join(tmpdir(), "u12-pipeline-"));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

function capture() {
  const lines: string[] = [];
  return { lines, log: (l: string) => lines.push(l) };
}

/** Stage executors that simply pass; `publishCalls` counts any publish attempt. */
function stubWorld(opts: { failAt?: string; failWith?: Error; publishCalls?: { n: number } } = {}) {
  const executors: Record<string, (ctx: Record<string, unknown>) => void> = {};
  for (const name of rel.STAGES) {
    executors[name] = () => {
      if (name === "publish") {
        if (opts.publishCalls) opts.publishCalls.n += 1;
        return;
      }
      if (name === opts.failAt && opts.failWith !== undefined) throw opts.failWith;
    };
  }
  return executors;
}

// ---------------------------------------------------------------------------
// 1. Core machine (T012)
// ---------------------------------------------------------------------------

test("catalog: STAGES deep-equals the data-model §2 table (names + order)", () => {
  assert.deepEqual([...rel.STAGES], [
    "install-locked",
    "lint",
    "typecheck",
    "build-clean",
    "test-full",
    "pack",
    "archive-verify",
    "defaults-scan",
    "publish",
  ]);
});

test("usage: no mode flag → USAGE_ERROR exit 2 with a named usage line", () => {
  const { lines, log } = capture();
  const r = rel.runRelease({ argv: [], log });
  assert.equal(r.exitCode, 2);
  assert.equal(r.verdict.verdict, "USAGE_ERROR");
  assert.ok(lines.some((l) => l.startsWith("usage-error: ")), lines.join("\n"));
});

test("usage: contradictory flags all produce usage errors, never a silent run", () => {
  const cases: Array<[string[], RegExp]> = [
    [["--dry-run", "--tag", "v1.2.3"], /dry-run takes no --tag/],
    [["--release"], /requires --tag/],
    [["--release", "--tag", "banana"], /must match v<semver>/],
    [["--bogus"], /unknown flag '--bogus'/],
    [["--dry-run", "--release", "--tag", "v1.2.3"], /only one mode flag|dry-run takes no --tag/],
  ];
  for (const [argv, want] of cases) {
    const r = rel.runRelease({ argv, log: () => {} });
    assert.equal(r.verdict.verdict, "USAGE_ERROR", argv.join(" "));
    assert.equal(r.exitCode, 2, argv.join(" "));
    const { lines } = capture();
    rel.runRelease({ argv, log: lines.push.bind(lines) });
    assert.ok(lines.some((l) => want.test(l)), `${argv.join(" ")}: expected ${want} in ${lines.join(" | ")}`);
  }
});

test("parseArgs: valid invocations carry no usage errors", () => {
  assert.deepEqual(rel.parseArgs(["--dry-run"]).usageErrors, []);
  assert.deepEqual(rel.parseArgs(["--release", "--tag", "v1.2.3"]).usageErrors, []);
  const a = rel.parseArgs(["--release", "--tag", "v1.2.3", "--allow-unattested"]);
  assert.deepEqual(a.usageErrors, []);
  assert.equal(a.allowUnattested, true);
});

test("MODE_CONFLICT: dry-run with a publish credential REFUSED (exit 1), names only", () => {
  const { lines, log } = capture();
  const r = rel.runRelease({ argv: ["--dry-run"], env: { NPM_TOKEN: "SENTINEL-TOKEN-VALUE-9182" }, log });
  assert.equal(r.verdict.verdict, "REFUSED");
  assert.equal(r.verdict.reason, "MODE_CONFLICT");
  assert.equal(r.exitCode, 1);
  const all = lines.join("\n") + JSON.stringify(r.verdict);
  assert.ok(!all.includes("SENTINEL-TOKEN-VALUE-9182"), "credential VALUES never appear");
  assert.match(lines.join("\n"), /NPM_TOKEN/, "the credential NAME is named");
});

test("MODE_CONFLICT: an empty-string credential does not conflict (Actions empty inputs)", () => {
  const r = rel.runRelease({
    argv: ["--dry-run"],
    env: { NPM_TOKEN: "", NODE_AUTH_TOKEN: "" },
    log: () => {},
    executors: stubWorld(),
  });
  assert.equal(r.verdict.verdict, "WOULD_PUBLISH");
  assert.equal(r.exitCode, 0);
});

test("dry-run success: stage lines in FR-003 order, publish skipped, WOULD_PUBLISH exit 0", () => {
  const publishCalls = { n: 0 };
  const { lines, log } = capture();
  const r = rel.runRelease({ argv: ["--dry-run"], env: {}, log, executors: stubWorld({ publishCalls }) });
  assert.equal(r.verdict.verdict, "WOULD_PUBLISH");
  assert.equal(r.exitCode, 0);
  assert.equal(publishCalls.n, 0, "dry-run never invokes publish — not even a stub");
  assert.equal(r.verdict.stages.length, rel.STAGES.length);
  assert.deepEqual(r.verdict.stages.map((s) => s.name), [...rel.STAGES]);
  assert.equal(r.verdict.stages.at(-1)!.status, "skipped");
  assert.ok(r.verdict.stages.slice(0, -1).every((s) => s.status === "passed"));
  for (const [i, line] of rel.STAGES.entries()) {
    assert.match(lines[i]!, new RegExp(`^stage=${line} status=(passed|skipped) ms=\\d+$`));
  }
  assert.ok(lines.some((l) => l === "VERDICT WOULD_PUBLISH"));
});

test("release success (stubbed worlds): PUBLISHED, publish executed exactly once", () => {
  const publishCalls = { n: 0 };
  const r = rel.runRelease({
    argv: ["--release", "--tag", `v${manifestVersion}`],
    env: {},
    log: () => {},
    preflightImpl: () => {},
    executors: stubWorld({ publishCalls }),
  });
  assert.equal(r.verdict.verdict, "PUBLISHED");
  assert.equal(r.exitCode, 0);
  assert.equal(publishCalls.n, 1);
});

test("stage failure ends the run: later stages never execute", () => {
  const seen: string[] = [];
  const executors: Record<string, (ctx: Record<string, unknown>) => void> = {};
  for (const name of rel.STAGES) {
    executors[name] = () => {
      seen.push(name);
      if (name === "typecheck") throw new Error("tsc exploded");
    };
  }
  const { lines, log } = capture();
  const r = rel.runRelease({ argv: ["--dry-run"], env: {}, log, executors });
  assert.equal(r.verdict.verdict, "STAGE_FAILED");
  assert.equal(r.verdict.stage, "typecheck");
  assert.equal(r.exitCode, 1);
  assert.deepEqual(seen, ["install-locked", "lint", "typecheck"]);
  assert.ok(lines.some((l) => l.startsWith("FAILED:STAGE_FAILED:typecheck")));
});

test("verdict JSON is secret-safe: sentinel env values never leak (log + JSON)", () => {
  const sentinel = "sup3r-visible-sentinel-42";
  const { lines, log } = capture();
  const r = rel.runRelease({
    argv: ["--release", "--tag", "v9.9.9"],
    env: { NPM_TOKEN: sentinel, GITHUB_TOKEN: sentinel + "-2" },
    log,
    preflightImpl: () => {},
    executors: stubWorld({ failAt: "lint", failWith: new rel.Refuse("STAGE_FAILED_DETAIL", "lint failed") }),
  });
  assert.equal(r.verdict.verdict, "STAGE_FAILED");
  const corpus = lines.join("\n") + JSON.stringify(r.verdict);
  assert.ok(!corpus.includes(sentinel), "env VALUES must never reach stdout");
  // stronger: the frozen defaults-scan finds no credential-shaped material either
  assert.deepEqual(scan.scanText(corpus), []);
  assert.deepEqual(Object.keys(r.verdict).sort(), ["dryRun", "durationMs", "reason", "stage", "stages", "tag", "verdict"].sort());
});

test("publish token handling: NPM_TOKEN reaches npm via env, never argv (source check)", () => {
  const src = readFileSync(join(pkgRoot, "scripts", "release.mjs"), "utf8");
  const publishBody = src.slice(src.indexOf("publish: () => {"));
  assert.ok(!/args\.push\([^\n]*NPM_TOKEN/.test(publishBody), "token never enters the argv array");
  assert.ok(/publishEnv\[/.test(publishBody), "token travels via the child environment");
});

test("publish ships THE VERIFIED TARBALL, not whatever cwd resolves to (source check)", () => {
  const src = readFileSync(join(pkgRoot, "scripts", "release.mjs"), "utf8");
  assert.match(src, /\["publish", ctx\.tarball/, "publish argument is the stage-6 tarball");
});

// --- publish outcome classification (quickstart scenario 6, no registry) ---

function withEnv(patches: Record<string, string | null>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(patches)) {
    saved[k] = process.env[k];
    if (v === null) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function publishErrorCode(fn: () => void): string {
  try {
    fn();
  } catch (err) {
    return (err as { code?: string }).code ?? "";
  }
  return "";
}

test("publish classification: no attestation capability → PROVENANCE_UNAVAILABLE, registry never contacted", () => {
  withEnv({ CI: null, GITHUB_ACTIONS: null, NPM_TOKEN: null }, () => {
    const exec = rel.defaultExecutors({ tarball: join(scratch, "nonexistent-never-touched.tgz") }, {});
    assert.equal(publishErrorCode(() => exec.publish()!), "PROVENANCE_UNAVAILABLE");
  });
});

test("publish classification: transport failure → PUBLISH_AMBIGUOUS (dead local registry port)", () => {
  const tarball = buildFaultTarball("publish-ambiguous");
  withEnv(
    { CI: null, GITHUB_ACTIONS: "true", npm_config_registry: "http://127.0.0.1:9/", npm_config_fetch_retry_retries: "0" },
    () => {
      const exec = rel.defaultExecutors({ tarball }, {});
      assert.equal(publishErrorCode(() => exec.publish()!), "PUBLISH_AMBIGUOUS");
    },
  );
});

test("publish classification: registry refuses an existing version → PUBLISH_REJECTED (local fake registry)", async () => {
  const http = await import("node:http");
  const { spawn } = await import("node:child_process");
  const server = http.createServer((_req, res) => {
    res.writeHead(403, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "cannot publish over previously published version" }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  const tarball = buildFaultTarball("publish-rejected");
  try {
    // The publish executor is synchronous (spawnSync) — run it in a CHILD
    // process while this test process serves the fake registry.
    const childEnv: Record<string, string | undefined> = { ...process.env };
    delete childEnv.CI;
    delete childEnv.GITHUB_ACTIONS;
    childEnv.npm_config_registry = `http://127.0.0.1:${port}/`;
    childEnv[`npm_config_//127.0.0.1:${port}/:_authToken`] = "fake-token-for-local-classification-only";
    childEnv.npm_config_fetch_retry_retries = "0";
    const child = spawn(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const rel = await import(${JSON.stringify(new URL("../../../scripts/release.mjs", import.meta.url).href)});
         const warns = [];
         const exec = rel.defaultExecutors({ tarball: ${JSON.stringify(tarball)} }, { allowUnattested: true, log: (l) => warns.push(l) });
         try { exec.publish(); console.log("RESULT SUCCESS"); }
         catch (e) { console.log("RESULT " + (e && e.code)); console.log("WARNS " + warns.join(" | ")); }`,
      ],
      { env: childEnv },
    );
    const out = await new Promise<string>((r) => {
      let acc = "";
      child.stdout?.on("data", (d: Buffer) => (acc += d.toString()));
      child.stderr?.on("data", (d: Buffer) => (acc += d.toString()));
      child.on("close", () => r(acc));
    });
    assert.match(out, /RESULT PUBLISH_REJECTED/, `child said: ${out.slice(-1500)}`);
    assert.match(out, /WARNS .*WITHOUT attestation/, "--allow-unattested is LOUD, never silent");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

// ---------------------------------------------------------------------------
// 2. Mutation harness — SC-002 6/6 (T021)
// ---------------------------------------------------------------------------

const FAKE_VERSION = "1.2.3";

interface FaultWorld {
  mutate?: (pkg: string) => void;
}

function buildFaultTarball(label: string, world: FaultWorld = {}): string {
  const root = join(scratch, `world-${label}`);
  const pkg = join(root, "package");
  mkdirSync(join(pkg, "dist"), { recursive: true });
  writeFileSync(
    join(pkg, "package.json"),
    JSON.stringify(
      {
        name: "fake-pkg",
        version: FAKE_VERSION,
        type: "module",
        engines: { node: ">=20.0.0" },
        license: "MIT",
        bin: { "fake-pkg": "./dist/cli.js" },
        exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
      },
      null,
      2,
    ),
  );
  writeFileSync(join(pkg, "README.md"), "# fake-pkg\n\nfixture.\n");
  writeFileSync(join(pkg, "LICENSE"), "MIT\n");
  writeFileSync(join(pkg, "CHANGELOG.md"), `## [${FAKE_VERSION}] - 2026-01-01\n\n- entry\n`);
  writeFileSync(join(pkg, "dist", "index.js"), "export const X = 1;\n");
  writeFileSync(join(pkg, "dist", "index.d.ts"), "export declare const X: number;\n");
  writeFileSync(join(pkg, "dist", "cli.js"), '#!/usr/bin/env node\nif (process.argv[2] === "--version") { process.stdout.write("fake-pkg 1.2.3\\n"); process.exit(0); }\nprocess.exit(9);\n');
  world.mutate?.(pkg);
  const tgz = join(scratch, `${label}.tgz`);
  const r = spawnSync("tar", ["-czf", tgz, "-C", root, "package"], { encoding: "utf8" });
  assert.equal(r.status, 0, "fixture tar built");
  return tgz;
}

/** Orchestrator over a fault world: stages 1–6 stubbed, 7–8 REAL, publish spied. */
function runFaultWorld(label: string, world: FaultWorld): { run: ReleaseRun; publishCalls: { n: number }; lines: string[] } {
  const tgz = buildFaultTarball(label, world);
  const ctx: Record<string, unknown> = {};
  const real = rel.defaultExecutors(ctx, {});
  const publishCalls = { n: 0 };
  const { lines, log } = capture();
  const executors: Record<string, (c: Record<string, unknown>) => void> = {};
  for (const name of rel.STAGES) {
    if (name === "pack") executors[name] = () => { ctx.tarball = tgz; };
    else if (name === "archive-verify" || name === "defaults-scan") executors[name] = () => { real[name]!(); };
    else if (name === "publish") executors[name] = () => { publishCalls.n += 1; };
    else executors[name] = () => {};
  }
  const run = rel.runRelease({
    argv: ["--release", "--tag", `v${FAKE_VERSION}`],
    env: {},
    log,
    preflightImpl: () => {},
    executors,
    ctx,
  });
  return { run, publishCalls, lines };
}

test("mutation 1: org/UUID material in a shipped file → stage 8 DEFAULTS_SCAN, publish unreached", () => {
  const { run, publishCalls } = runFaultWorld("scan-fault", {
    mutate: (p) => writeFileSync(join(p, "README.md"), "# fake-pkg\n\ntenant id 123e4567-e89b-42d3-a456-426614174000\n"),
  });
  assert.equal(run.verdict.verdict, "REFUSED");
  assert.equal(run.verdict.stage, "defaults-scan");
  assert.equal(run.verdict.reason, "DEFAULTS_SCAN");
  assert.equal(publishCalls.n, 0, "SC-002: publish never executed");
  assert.equal(run.exitCode, 1);
});

test("mutation 2: broken export target → stage 7 EXPORT_UNRESOLVED, publish unreached", () => {
  const { run, publishCalls } = runFaultWorld("export-fault", {
    mutate: (p) => {
      const m = JSON.parse(readFileSync(join(p, "package.json"), "utf8")) as { exports: Record<string, Record<string, string>> };
      m.exports["."] = { types: "./dist/index.d.ts", default: "./dist/missing.js" };
      writeFileSync(join(p, "package.json"), JSON.stringify(m, null, 2));
    },
  });
  assert.equal(run.verdict.verdict, "REFUSED");
  assert.equal(run.verdict.stage, "archive-verify");
  assert.match(String(run.verdict.reason), /EXPORT_UNRESOLVED/);
  assert.equal(publishCalls.n, 0);
});

test("mutation 3: non-running CLI binary → stage 7 CLI_VERSION_MISMATCH, publish unreached", () => {
  const { run, publishCalls } = runFaultWorld("cli-fault", {
    mutate: (p) => writeFileSync(join(p, "dist", "cli.js"), "#!/usr/bin/env node\nprocess.exit(7);\n"),
  });
  assert.equal(run.verdict.stage, "archive-verify");
  assert.equal(run.verdict.reason, "CLI_VERSION_MISMATCH");
  assert.equal(publishCalls.n, 0);
});

test("mutation 4: off-allow-list file → stage 7 ARCHIVE_ALLOWLIST, publish unreached", () => {
  const { run, publishCalls } = runFaultWorld("allowlist-fault", {
    mutate: (p) => writeFileSync(join(p, "debug-dump.bin"), "nope"),
  });
  assert.equal(run.verdict.stage, "archive-verify");
  assert.equal(run.verdict.reason, "ARCHIVE_ALLOWLIST");
  assert.equal(publishCalls.n, 0);
});

test("mutation 5: changelog entry for the version removed → CHANGELOG_MISSING, publish unreached", () => {
  const { run, publishCalls } = runFaultWorld("changelog-fault", {
    mutate: (p) => writeFileSync(join(p, "CHANGELOG.md"), "# Changelog\n\nnothing here\n"),
  });
  assert.equal(run.verdict.stage, "archive-verify");
  assert.equal(run.verdict.reason, "CHANGELOG_MISSING");
  assert.equal(publishCalls.n, 0);
});

test("mutation 6: tag ≠ package version → TAG_MISMATCH naming BOTH, zero stages ran", () => {
  const gitOk = { status: 0, stdout: "" };
  const exec = (cmd: string, args: string[]) => {
    if (args[0] === "status") return gitOk;
    if (args[0] === "rev-parse" && args[1] === "--verify") return { status: 0, stdout: "refs/tags/v9.9.9\n" };
    if (args[0] === "rev-list") return { status: 0, stdout: "aaa111\n" };
    if (args[0] === "rev-parse") return { status: 0, stdout: "aaa111\n" };
    return { status: 1, stdout: "" };
  };
  const publishCalls = { n: 0 };
  const { lines, log } = capture();
  const run = rel.runRelease({
    argv: ["--release", "--tag", "v9.9.9"],
    env: {},
    log,
    preflightImpl: (tag) => rel.preflight(tag, exec),
    executors: stubWorld({ publishCalls }),
  });
  assert.equal(run.verdict.verdict, "REFUSED");
  assert.equal(run.verdict.reason, "TAG_MISMATCH");
  assert.equal(run.verdict.stages.length, 0, "zero stages executed — publish never approached");
  assert.equal(publishCalls.n, 0);
  const all = lines.join("\n") + JSON.stringify(run.verdict);
  assert.match(all, /v9\.9\.9/, "the tag value is named");
  assert.ok(all.includes(manifestVersion), `the manifest version (${manifestVersion}) is named too`);
});

// ---------------------------------------------------------------------------
// 3. Workflow shapes (T023)
// ---------------------------------------------------------------------------

test("ci.yml: release-dry-run job is PR-triggered, credential-free, budgeted", () => {
  const ci = readFileSync(join(pkgRoot, ".github", "workflows", "ci.yml"), "utf8");
  assert.match(ci, /^on:\n(?:.*\n)*?  pull_request:/m, "pull_request trigger present");
  const jobStart = ci.indexOf("  release-dry-run:");
  assert.ok(jobStart >= 0, "release-dry-run job exists");
  const job = ci.slice(jobStart);
  assert.ok(!job.includes("secrets."), "SC-003: zero secrets references in the job");
  assert.match(job, /timeout-minutes: 20/);
  assert.match(job, /node-version: "20\.x"/, "engines-floor leg");
  assert.match(job, /node scripts\/release\.mjs --dry-run/);
});

test("release.yml: workflow_dispatch-only, permissions exactly contents:read + id-token:write", () => {
  const ry = readFileSync(join(pkgRoot, ".github", "workflows", "release.yml"), "utf8");
  assert.match(ry, /workflow_dispatch:/);
  assert.ok(!/^\s*(pull_request|push):/m.test(ry), "never automatic-on-merge");
  // permissions block: exact map
  const permLines: string[] = [];
  const lines = ry.split("\n");
  const start = lines.findIndex((l) => l === "permissions:");
  for (let i = start + 1; i < lines.length && /^\s+\S/.test(lines[i]!); i += 1) permLines.push(lines[i]!.trim());
  assert.deepEqual(permLines.sort(), ["contents: read", "id-token: write"], "no broader permissions");
  assert.match(ry, /environment: release/);
  assert.match(ry, /fetch-depth: 0/);
  assert.match(ry, /allow_unattested:/);
  assert.match(ry, /tag:/);
});

// ---------------------------------------------------------------------------
// 4. Preflight refusal worlds (T028)
// ---------------------------------------------------------------------------

function gitWorld(opts: { dirty?: string; tagExists?: boolean; tagCommit?: string; head?: string }) {
  return (cmd: string, args: string[]): { status: number; stdout: string } => {
    if (args[0] === "status") return { status: 0, stdout: opts.dirty ?? "" };
    if (args[0] === "rev-parse" && args[1] === "--verify") return opts.tagExists === false ? { status: 1, stdout: "" } : { status: 0, stdout: "x\n" };
    if (args[0] === "rev-list") return { status: 0, stdout: `${opts.tagCommit ?? "c1"}\n` };
    if (args[0] === "rev-parse") return { status: 0, stdout: `${opts.head ?? "c1"}\n` };
    return { status: 1, stdout: "" };
  };
}

function refusedCode(fn: () => void): { code: string; message: string } {
  try {
    fn();
  } catch (err) {
    const e = err as Error & { code?: string };
    assert.ok(e.code, `expected a Refuse-coded error, got: ${e}`);
    return { code: e.code!, message: e.message };
  }
  assert.fail("expected a refusal");
}

test("preflight: dirty tree refuses before anything else", () => {
  const { code } = refusedCode(() => rel.preflight(`v${manifestVersion}`, gitWorld({ dirty: " M src/x.ts" })));
  assert.equal(code, "DIRTY_TREE");
});

test("preflight: missing tag refuses TAG_MISSING", () => {
  const { code } = refusedCode(() => rel.preflight(`v${manifestVersion}`, gitWorld({ tagExists: false })));
  assert.equal(code, "TAG_MISSING");
});

test("preflight: tag not at HEAD refuses TAG_NOT_HEAD", () => {
  const { code } = refusedCode(() => rel.preflight(`v${manifestVersion}`, gitWorld({ tagCommit: "old", head: "new" })));
  assert.equal(code, "TAG_NOT_HEAD");
});

test("preflight: matching world passes clean", () => {
  rel.preflight(`v${manifestVersion}`, gitWorld({ tagCommit: "c1", head: "c1" })); // no throw
});

test("preflight refusal through the orchestrator: exit 1, zero stages", () => {
  const { lines, log } = capture();
  const run = rel.runRelease({
    argv: ["--release", "--tag", "v0.0.1"],
    env: {},
    log,
    preflightImpl: (tag) => rel.preflight(tag, gitWorld({ dirty: "?? stray" })),
    executors: stubWorld(),
  });
  assert.equal(run.verdict.verdict, "REFUSED");
  assert.equal(run.verdict.reason, "DIRTY_TREE");
  assert.equal(run.exitCode, 1);
  assert.equal(run.verdict.stages.length, 0);
  assert.ok(lines.some((l) => l.startsWith("REFUSED:DIRTY_TREE")));
});

test("dry-run skips preflight entirely (a throwing preflight never fires)", () => {
  const run = rel.runRelease({
    argv: ["--dry-run"],
    env: {},
    log: () => {},
    preflightImpl: () => {
      throw new Error("preflight must not run in dry-run");
    },
    executors: stubWorld(),
  });
  assert.equal(run.verdict.verdict, "WOULD_PUBLISH");
});
