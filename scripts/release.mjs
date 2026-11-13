#!/usr/bin/env node
/**
 * Feature 015 — the release orchestrator (contracts/release-pipeline.md).
 *
 * One fail-closed stage machine. NOTHING reaches the registry unless every
 * earlier stage passed; the final stdout line is exactly ONE JSON verdict
 * object (env VALUES never appear — names only). Exit codes: 0 success ·
 * 1 refusal/stage-failure · 2 usage.
 *
 *   node scripts/release.mjs --dry-run                 # rehearsal (CI job)
 *   node scripts/release.mjs --release --tag v1.2.3    # gated publish
 *
 * `--allow-unattested` (documented operator override, docs/release-process.md)
 * is the ONLY way past the provenance capability gate — loud, never silent.
 * Stage executors are injectable so contract tests run without real npm legs.
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { scanFileTree } from "./lib/secret-scan.mjs";

const repoRoot = resolve(import.meta.dirname, "..");

/** Stage catalog — order and names frozen by data-model §2 (tested). */
export const STAGES = Object.freeze([
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

const TAG_SHAPE = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const CREDENTIAL_ENV_NAMES = ["NPM_TOKEN", "NODE_AUTH_TOKEN"];

export class Refuse extends Error {
  /** @param {string} code reason code, e.g. TAG_MISMATCH */
  constructor(code, detail = "") {
    super(code + (detail ? `: ${detail}` : ""));
    this.code = code;
  }
}

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: opts.cwd ?? repoRoot, encoding: "utf8", stdio: opts.capture ? ["ignore", "pipe", "pipe"] : "inherit", env: opts.env ?? process.env });
  return r;
}

function runOrThrow(label, cmd, args, opts = {}) {
  // Tool output streams LIVE (stdio inherit), it is not captured and discarded:
  // a failed lint/typecheck/build/test leg previously surfaced only four banner
  // lines, leaving the CI log without the failing test (v0.3.0, stage test-full).
  // The live stream IS the diagnosis; the verdict stays a one-line machine code.
  const r = sh(cmd, args, opts);
  if (r.status !== 0) throw new Refuse(label, `exit ${r.status} — the tool output was streamed live above this line`);
  return r;
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  /** @type {{mode: string|null, tag: string|null, allowUnattested: boolean, keepWorkdir: boolean, usageErrors: string[]}} */
  const out = { mode: null, tag: null, allowUnattested: false, keepWorkdir: false, usageErrors: [] };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--dry-run") {
      if (out.mode !== null) out.usageErrors.push("only one mode flag (--dry-run | --release) allowed");
      out.mode = "dry-run";
    } else if (token === "--release") {
      if (out.mode !== null) out.usageErrors.push("only one mode flag (--dry-run | --release) allowed");
      out.mode = "release";
      const next = argv[i + 1];
      if (next === undefined || !next.startsWith("--")) {
        out.tag = next ?? null;
        if (next === undefined) out.usageErrors.push("--release requires --tag v<X.Y.Z>");
        else i += 1;
      }
    } else if (token === "--tag") {
      const next = argv[i + 1];
      if (next === undefined) out.usageErrors.push("--tag requires a value");
      else {
        out.tag = next;
        i += 1;
      }
    } else if (token === "--allow-unattested") out.allowUnattested = true;
    else if (token === "--keep-workdir") out.keepWorkdir = true;
    else out.usageErrors.push(`unknown flag '${token}'`);
  }
  if (out.mode === null) out.usageErrors.push("one of --dry-run or --release --tag v<X.Y.Z> is required");
  if (out.mode === "release" && out.tag === null) out.usageErrors.push("release mode requires --tag v<X.Y.Z>");
  if (out.tag !== null && !TAG_SHAPE.test(out.tag)) out.usageErrors.push(`--tag must match v<semver> (got '${out.tag}')`);
  if (out.mode === "dry-run" && out.tag !== null) out.usageErrors.push("--dry-run takes no --tag");
  return out;
}

function manifest() {
  return JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
}

/** Release-mode preflight (T027): clean tree, tag exists, tag == manifest version. */
export function preflight(tag, exec = sh) {
  const dirty = exec("git", ["status", "--porcelain"], { capture: true });
  if (dirty.status !== 0) throw new Refuse("GIT_UNAVAILABLE", "git status failed");
  if (String(dirty.stdout ?? "").trim() !== "") throw new Refuse("DIRTY_TREE", "commit or stash everything before releasing");
  const tagCheck = exec("git", ["rev-parse", "--verify", `refs/tags/${tag}`], { capture: true });
  if (tagCheck.status !== 0) throw new Refuse("TAG_MISSING", tag);
  const tagCommit = String(exec("git", ["rev-list", "-n", "1", tag], { capture: true }).stdout).trim();
  const head = String(exec("git", ["rev-parse", "HEAD"], { capture: true }).stdout).trim();
  if (tagCommit !== head) throw new Refuse("TAG_NOT_HEAD", `${tag} is not HEAD`);
  const tagVersion = tag.replace(/^v/, "");
  const pkgVersion = manifest().version;
  if (tagVersion !== pkgVersion) throw new Refuse("TAG_MISMATCH", `tag ${tag} vs package.json ${pkgVersion}`);
}

/**
 * Build the default (real) executors. `ctx` carries pack results between
 * stages; `opts` come from parsed flags; `log` receives human lines.
 */
export function defaultExecutors(ctx, opts) {
  const npm = (args, o) => runOrThrow("STAGE", process.platform === "win32" ? "npm.cmd" : "npm", args, o);
  return {
    "install-locked": () => {
      const r = sh("npm", ["ci", "--no-audit", "--no-fund"], { capture: true });
      if (r.status !== 0) {
        const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
        if (/lock file|lockfile|ETARGET|Cannot read|invalid/i.test(out)) throw new Refuse("LOCKFILE_UNSATISFIABLE", out.split("\n").slice(0, 3).join(" | "));
        throw new Refuse("STAGE_FAILED_DETAIL", `npm ci exit ${r.status}`);
      }
    },
    lint: () => npm(["run", "lint"]),
    // src self-imports (task-linear-sync/domain) resolve via the exports map to
    // BUILT declarations, so typecheck needs dist/ to exist on a fresh clone
    // (same order as the existing CI job: build before typecheck). The
    // authoritative clean rebuild is the next stage.
    typecheck: () => {
      if (!existsSync(join(repoRoot, "dist", "domain", "index.d.ts"))) npm(["run", "build"]);
      npm(["run", "typecheck"]);
    },
    "build-clean": () => {
      rmSync(join(repoRoot, "dist"), { recursive: true, force: true }); // no stale/partial cache ships
      npm(["run", "build"]);
    },
    "test-full": () => npm(["test"], { env: { ...process.env, TLS_RELEASE_NESTED: "1" } }), // guard: the e2e dry-run test self-skips when nested (no recursion)
    pack: () => {
      ctx.workdir = mkdtempSync(join(tmpdir(), "release-pack-"));
      const r = sh("npm", ["pack", "--json", "--pack-destination", ctx.workdir], { capture: true });
      if (r.status !== 0) throw new Refuse("STAGE_FAILED_DETAIL", `npm pack exit ${r.status}`);
      let entries;
      try {
        entries = JSON.parse(String(r.stdout));
      } catch {
        throw new Refuse("STAGE_FAILED_DETAIL", "npm pack --json unparseable");
      }
      if (!Array.isArray(entries) || entries.length !== 1) throw new Refuse("STAGE_FAILED_DETAIL", `expected exactly one tarball, got ${Array.isArray(entries) ? entries.length : "?"}`);
      ctx.tarball = join(ctx.workdir, entries[0].filename); // npm wrote it to --pack-destination, not repoRoot
      ctx.packFiles = entries[0].files ?? null;
      ctx.npmShasum = entries[0].shasum ?? null;
      if (!existsSync(ctx.tarball)) throw new Refuse("STAGE_FAILED_DETAIL", `tarball missing: ${ctx.tarball}`);
    },
    "archive-verify": () => {
      const r = sh(process.execPath, [join(repoRoot, "scripts", "verify-package.mjs"), ctx.tarball, ...(ctx.expectedVersion ? ["--expect-changelog", ctx.expectedVersion] : [])], { capture: true });
      if (r.status !== 0) {
        const first = String(r.stdout || r.stderr).split("\n").find((l) => l.startsWith("REFUSED:")) ?? "verify-package failed";
        throw new Refuse(first.replace(/^REFUSED:/, "").split(":")[0].trim(), first);
      }
    },
    "defaults-scan": () => {
      const extract = mkdtempSync(join(tmpdir(), "release-scan-"));
      try {
        const t = sh("tar", ["-xzf", ctx.tarball, "-C", extract], { capture: true });
        if (t.status !== 0) throw new Refuse("STAGE_FAILED_DETAIL", "tar extraction failed");
        const findings = scanFileTree(extract);
        if (findings.length > 0) {
          const named = findings.slice(0, 5).map((f) => `${f.file}: ${f.why}`);
          throw new Refuse("DEFAULTS_SCAN", `${findings.length} finding(s) — ${named.join("; ")}`);
        }
      } finally {
        rmSync(extract, { recursive: true, force: true });
      }
    },
    publish: () => {
      // Capability probe BEFORE contacting the registry (research R2/FR-006).
      // The token fallback IS the "Trusted Publishing unconfigured" path
      // (docs/release-process.md, One-time setup step 2) — and npm cannot attest a
      // token-authenticated publish: provenance requires OIDC, which npm only uses
      // when no token exists. So a PRESENT NPM_TOKEN means attestation is
      // structurally unavailable even on an Actions runner, and publishing under
      // it is an --allow-unattested operation by construction.
      const tokenPresent = process.env.NPM_TOKEN !== undefined && process.env.NPM_TOKEN !== "";
      const provenanceCapable =
        !tokenPresent && (opts.trustedPublishing === true || process.env.CI !== undefined || process.env.GITHUB_ACTIONS !== undefined);
      const attested = provenanceCapable && !opts.allowUnattested; // docs: --allow-unattested drops ONLY the --provenance flag
      if (!provenanceCapable && !opts.allowUnattested) throw new Refuse("PROVENANCE_UNAVAILABLE", "attestation capability not detected (the NPM_TOKEN fallback cannot attest); publish needs Trusted Publishing configured or the documented --allow-unattested override");
      if (!attested) (opts.log ?? (() => {}))("WARNING: publishing WITHOUT attestation under --allow-unattested (documented override — record the reason)");
      // Publish THE VERIFIED TARBALL (stage 7/8 artifact), never whatever cwd
      // happens to resolve to — what archive-verify approved is what ships.
      const args = ["publish", ctx.tarball, ...(attested ? ["--provenance"] : []), "--access", "public", "--tag", "latest"];
      const publishEnv = { ...process.env };
      if (tokenPresent) {
        // fallback store path (research R2): token reaches npm via the environment
        // only — never argv (visible in ps) and never a log line (value never echoed).
        publishEnv["NPM_CONFIG_//registry.npmjs.org/:_authToken"] = process.env.NPM_TOKEN;
      }
      const r = sh("npm", args, { capture: true, env: publishEnv });
      if (r.status !== 0) {
        // Carry npm's own words into the verdict (names only, values masked —
        // belt & braces beyond npm's log redaction), so a refused publish is
        // diagnosable from the CI log alone. npm errors ride stderr while
        // stdout carries pack notices — stderr first, notices dropped, or the
        // excerpt shows a tarball listing instead of the reason.
        const combined = `${r.stderr ?? ""}${r.stdout ?? ""}`;
        const out = tokenPresent ? combined.split(process.env.NPM_TOKEN).join("[redacted]") : combined;
        const detail = out.split("\n").map((l) => l.trim()).filter((l) => l !== "" && !/^npm notice\b/.test(l)).slice(0, 6).join(" | ");
        if (/cannot publish over|existing package version|forbidden.*version/i.test(out)) throw new Refuse("PUBLISH_REJECTED", `the registry already has this version — cut a new version instead (nothing partial was published); npm said: ${detail}`);
        throw new Refuse("PUBLISH_AMBIGUOUS", `registry transport may have completed — reconcile against the registry before any retry, do not blindly republish; npm said: ${detail}`);
      }
    },
  };
}

/**
 * Run the stage machine. Returns the verdict object; NEVER throws for
 * expected failures (refusals/stage failures are verdicts).
 * @param {{argv: string[], env?: Record<string,string|undefined>, executors?: Record<string,(ctx: object)=>void|Promise<void>>, log?: (line: string)=>void, preflightImpl?: (tag: string)=>void, repoVersion?: string, ctx?: object}} io
 */
export function runRelease(io) {
  const log = io.log ?? ((line) => process.stdout.write(line + "\n"));
  const env = io.env ?? process.env;
  const parsed = parseArgs(io.argv);
  const started = Date.now();
  const stageResults = [];
  const verdictOf = (verdict, stage = null, reason = null) => {
    const v = {
      verdict,
      stage,
      reason,
      tag: parsed.tag,
      dryRun: parsed.mode === "dry-run",
      durationMs: Date.now() - started,
      stages: stageResults.map(({ name, status, ms }) => ({ name, status, ms })),
    };
    return { verdict: v, exitCode: verdict === "WOULD_PUBLISH" || verdict === "PUBLISHED" ? 0 : verdict === "USAGE_ERROR" ? 2 : 1 };
  };

  if (parsed.usageErrors.length > 0) {
    for (const e of parsed.usageErrors) log(`usage-error: ${e}`);
    return verdictOf("USAGE_ERROR");
  }
  if (parsed.mode === "dry-run") {
    const present = CREDENTIAL_ENV_NAMES.filter((n) => env[n] !== undefined && env[n] !== "");
    if (present.length > 0) {
      log(`REFUSED:MODE_CONFLICT — publish credential(s) ${present.join(", ")} present in a dry-run environment; dry-run must be credential-free (SC-003)`);
      return verdictOf("REFUSED", null, "MODE_CONFLICT");
    }
  }
  if (parsed.mode === "release") {
    try {
      (io.preflightImpl ?? ((t) => preflight(t)))(String(parsed.tag));
    } catch (err) {
      if (err instanceof Refuse) {
        log(`REFUSED:${err.message}`);
        return verdictOf("REFUSED", null, err.code);
      }
      throw err;
    }
  }

  const ctx = io.ctx ?? {};
  if (ctx.expectedVersion === undefined) {
    ctx.expectedVersion = parsed.mode === "release" ? String(parsed.tag).replace(/^v/, "") : io.repoVersion ?? manifest().version;
  }
  const executors = io.executors ?? defaultExecutors(ctx, { ...parsed, log });

  for (const name of STAGES) {
    if (parsed.mode === "dry-run" && name === "publish") {
      stageResults.push({ name, status: "skipped", ms: 0 });
      log(`stage=${name} status=skipped ms=0`);
      continue;
    }
    const t0 = Date.now();
    try {
      const exec = executors[name];
      if (typeof exec !== "function") throw new Refuse("STAGE_FAILED_DETAIL", `no executor for '${name}'`);
      exec(ctx);
      const ms = Date.now() - t0;
      stageResults.push({ name, status: "passed", ms });
      log(`stage=${name} status=passed ms=${ms}`);
    } catch (err) {
      const ms = Date.now() - t0;
      stageResults.push({ name, status: "failed", ms });
      log(`stage=${name} status=failed ms=${ms}`);
      if (err instanceof Refuse) {
        const isStageFailure = err.code === "STAGE_FAILED_DETAIL";
        const code = isStageFailure ? `STAGE_FAILED:${name}` : err.code;
        log(isStageFailure ? `FAILED:${code} ${err.message}` : `REFUSED:${err.message}`);
        return verdictOf(isStageFailure ? "STAGE_FAILED" : "REFUSED", name, isStageFailure || code === "DEFAULTS_SCAN" ? code : err.code);
      }
      log(`FAILED:STAGE_FAILED:${name} ${String(err && err.message ? err.message : err)}`);
      return verdictOf("STAGE_FAILED", name, `STAGE_FAILED:${name}`);
    }
  }
  const finalVerdict = parsed.mode === "dry-run" ? "WOULD_PUBLISH" : "PUBLISHED";
  log(`VERDICT ${finalVerdict}`);
  return verdictOf(finalVerdict);
}

/** CLI entry: stage lines to stdout, then exactly ONE JSON verdict object last. */
if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(import.meta.dirname, "release.mjs")) {
  const r = runRelease({ argv: process.argv.slice(2) });
  process.stdout.write(JSON.stringify(r.verdict) + "\n");
  process.exitCode = r.exitCode;
}
