/**
 * T020 — FAILING unit tests for managed git-hook installation (spec 010, FR-006..FR-008,
 * contracts/hook-installation.md §1). Module under test: `src/queue/git-hooks.ts` —
 * installGitHooks over the frozen hook-name vocabulary with the canonical marker block.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { installGitHooks, type GitHookSettings } from "../../src/queue/git-hooks.js";
import { makeQueueHarness, stripHookBlock, type QueueHarness } from "../helpers/queue-harness.js";

function hookSettings(overrides: Partial<GitHookSettings> = {}): GitHookSettings {
  return { toolId: "task-linear-sync", hookNames: ["pre-push", "post-merge"], hookScriptPrefix: "task-linear-sync", hooksDirectory: null, ...overrides };
}

const CANONICAL_BLOCK = [
  "# >>> task-linear-sync managed hooks v1 >>>",
  '"task-linear-sync" last-run 1>&2 || true',
  '"task-linear-sync" enqueue 1>&2 || true',
  "# <<< task-linear-sync managed hooks v1 <<<",
].join("\n");

function hooksDir(h: QueueHarness): string {
  return join(h.repositoryRoot, ".git", "hooks");
}

test("absent hook files are created 0o755 as '#!/bin/sh' + canonical block", async () => {
  const h = await makeQueueHarness();
  try {
    const res = await installGitHooks(h.repositoryRoot, hookSettings());
    assert.equal(res.status, "installed");
    assert.deepEqual(res.installed, ["pre-push", "post-merge"]);

    const body = readFileSync(join(hooksDir(h), "pre-push"), "utf8");
    assert.equal(body, `#!/bin/sh\n${CANONICAL_BLOCK}\n`);
    assert.ok(statSync(join(hooksDir(h), "pre-push")).mode & 0o111, "executable bit set");
  } finally {
    h.dispose();
  }
});

test("re-install is byte-for-byte idempotent (SC-003: zero bytes change)", async () => {
  const h = await makeQueueHarness();
  try {
    await installGitHooks(h.repositoryRoot, hookSettings());
    const first = readFileSync(join(hooksDir(h), "pre-push"));
    const res = await installGitHooks(h.repositoryRoot, hookSettings());
    assert.equal(res.status, "installed");
    assert.deepEqual(readFileSync(join(hooksDir(h), "pre-push")), first);
  } finally {
    h.dispose();
  }
});

test("existing user hooks keep their bytes; the block is appended once", async () => {
  const h = await makeQueueHarness();
  try {
    const user = "#!/bin/sh\necho user pre-push work\n";
    writeFileSync(join(hooksDir(h), "pre-push"), user, { mode: 0o700 });

    await installGitHooks(h.repositoryRoot, hookSettings());
    const body = readFileSync(join(hooksDir(h), "pre-push"), "utf8");
    assert.ok(body.startsWith(user), "user content byte-identical at the top");
    assert.equal(body.split(CANONICAL_BLOCK).length - 1, 1, "exactly one managed region");
    assert.equal(stripHookBlock(body).startsWith("#!/bin/sh\necho user pre-push work\n"), true);
  } finally {
    h.dispose();
  }
});

test("foreign content after the end marker survives re-splice", async () => {
  const h = await makeQueueHarness();
  try {
    await installGitHooks(h.repositoryRoot, hookSettings());
    const target = join(hooksDir(h), "pre-push");
    const drifted = readFileSync(target, "utf8").replace('"task-linear-sync" last-run 1>&2 || true', "# tampered") + "# trailing foreign tail\n";
    writeFileSync(target, drifted);

    await installGitHooks(h.repositoryRoot, hookSettings());
    const repaired = readFileSync(target, "utf8");
    assert.ok(repaired.includes('"task-linear-sync" last-run 1>&2 || true'), "drifted region re-spliced to canonical");
    assert.ok(repaired.includes("# trailing foreign tail\n"), "content after the end marker preserved");
    assert.ok(!repaired.includes("# tampered"));
  } finally {
    h.dispose();
  }
});

test("drift inside the managed region is repaired on the next install", async () => {
  const h = await makeQueueHarness();
  try {
    await installGitHooks(h.repositoryRoot, hookSettings());
    const target = join(hooksDir(h), "pre-push");
    writeFileSync(target, readFileSync(target, "utf8").replace("enqueue", "enqueue-tampered"));

    const res = await installGitHooks(h.repositoryRoot, hookSettings());
    assert.equal(res.status, "installed");
    assert.match(res.detail ?? "", /repair|re-splice|restored/i);
    assert.equal(readFileSync(target, "utf8"), `#!/bin/sh\n${CANONICAL_BLOCK}\n`, "golden bytes restored");
  } finally {
    h.dispose();
  }
});

test("an existing hook without a shebang is left byte-intact with a warning; other hooks continue", async () => {
  const h = await makeQueueHarness();
  try {
    const user = "echo no shebang here\n";
    const target = join(hooksDir(h), "pre-push");
    writeFileSync(target, user);

    const res = await installGitHooks(h.repositoryRoot, hookSettings());
    assert.equal(readFileSync(target, "utf8"), user, "byte-preservation rule wins");
    assert.match(res.detail ?? "", /no shebang/);
    assert.ok(existsSync(join(hooksDir(h), "post-merge")), "the other hooks still install");
    assert.deepEqual(res.installed, ["post-merge"]);
  } finally {
    h.dispose();
  }
});

test("unknown hook names are refused BEFORE any write, every offender listed at once", async () => {
  const h = await makeQueueHarness();
  try {
    const res = await installGitHooks(h.repositoryRoot, hookSettings({ hookNames: ["pre-push", "bogus-hook", "checkout"] }));
    assert.equal(res.status, "refused");
    assert.match(res.detail ?? "", /bogus-hook/);
    assert.match(res.detail ?? "", /checkout/);
    assert.equal(existsSync(join(hooksDir(h), "pre-push")), false, "zero partial installs");
    assert.equal(existsSync(join(hooksDir(h), "bogus-hook")), false);
  } finally {
    h.dispose();
  }
});

test("post-checkout is in the vocabulary and installs normally", async () => {
  const h = await makeQueueHarness();
  try {
    const res = await installGitHooks(h.repositoryRoot, hookSettings({ hookNames: ["post-checkout"] }));
    assert.equal(res.status, "installed");
    assert.ok(existsSync(join(hooksDir(h), "post-checkout")));
  } finally {
    h.dispose();
  }
});

test("missing .git is refused with a naming diagnostic", async () => {
  const h = await makeQueueHarness({ gitDir: false });
  try {
    const res = await installGitHooks(h.repositoryRoot, hookSettings());
    assert.equal(res.status, "refused");
    assert.match(res.detail ?? "", /\.git/);
  } finally {
    h.dispose();
  }
});

test("a '.git' file (gitdir: indirection) resolves to the real hooks directory — no git binary", async () => {
  const h = await makeQueueHarness({ gitDir: false });
  try {
    const realGit = join(h.root, "real-git");
    mkdirSync(join(realGit, "hooks"), { recursive: true });
    writeFileSync(join(h.repositoryRoot, ".git"), `gitdir: ${realGit}\n`, { mode: 0o600 });

    const res = await installGitHooks(h.repositoryRoot, hookSettings({ hookNames: ["pre-push"] }));
    assert.equal(res.status, "installed");
    assert.ok(existsSync(join(realGit, "hooks", "pre-push")), "hook landed in the gitdir-resolved hooks dir");
  } finally {
    h.dispose();
  }
});

test("queue.hooksDirectory override (absolute) wins over the repository default", async () => {
  const h = await makeQueueHarness();
  try {
    const custom = join(h.root, "custom-hooks");
    mkdirSync(custom, { recursive: true });
    const res = await installGitHooks(h.repositoryRoot, hookSettings({ hookNames: ["pre-push"], hooksDirectory: custom }));
    assert.equal(res.status, "installed");
    assert.ok(existsSync(join(custom, "pre-push")));
    assert.equal(existsSync(join(hooksDir(h), "pre-push")), false);
  } finally {
    h.dispose();
  }
});

test("hookScriptPrefix configures the command token; toolId configures the markers", async () => {
  const h = await makeQueueHarness();
  try {
    await installGitHooks(h.repositoryRoot, hookSettings({ toolId: "mytool", hookNames: ["pre-push"], hookScriptPrefix: "mytool-sync" }));
    const body = readFileSync(join(hooksDir(h), "pre-push"), "utf8");
    assert.ok(body.includes('# >>> mytool managed hooks v1 >>>'), body);
    assert.ok(body.includes('"mytool-sync" last-run 1>&2 || true'), body);
    assert.ok(body.includes('"mytool-sync" enqueue 1>&2 || true'), body);
  } finally {
    h.dispose();
  }
});

test("the managed block never embeds repository or machine paths (SC-001 stability)", async () => {
  const h = await makeQueueHarness();
  try {
    await installGitHooks(h.repositoryRoot, hookSettings({ hookNames: ["pre-push"] }));
    const body = readFileSync(join(hooksDir(h), "pre-push"), "utf8");
    assert.ok(!body.includes(h.root) && !body.includes(h.repositoryRoot), "no absolute paths in the hook");
  } finally {
    h.dispose();
  }
});

test("CRLF user hooks keep their line endings; the managed block joins with the file EOL", async () => {
  const h = await makeQueueHarness();
  try {
    const user = "#!/bin/sh\r\necho crlf user\r\n";
    const target = join(hooksDir(h), "pre-push");
    writeFileSync(target, user);

    await installGitHooks(h.repositoryRoot, hookSettings({ hookNames: ["pre-push"] }));
    const body = readFileSync(target, "utf8");
    assert.ok(body.startsWith(user), "CRLF user bytes untouched");
    assert.ok(!body.slice(user.length).includes("\n\n\n"));
  } finally {
    h.dispose();
  }
});
