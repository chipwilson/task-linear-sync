/**
 * T037 [US2] — state-fs unit tests (research R7): owner-only dirs 0o700 (every created
 * level), files via temp+rename at 0o600, JSON codecs reject non-object roots, and a
 * concurrent reader observes old-or-new content only (no torn reads).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  chmodSync,
  mkdtempSync,
  rmSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { ensurePrivateDir, atomicWriteJson, atomicWriteText, readJsonFile, StateFileError } from "task-linear-sync/state";

let scratch: string;
const posix = process.platform !== "win32";

before(() => {
  scratch = mkdtempSync(join(tmpdir(), "tls-fs-"));
});
after(() => {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 3 });
});

test("state fs — ensurePrivateDir: recursive creation applies 0o700 to every created level", () => {
  if (!posix) return;
  const deep = join(scratch, "a1", "b2", "c3");
  const before = new Set(readdirSync(scratch));
  ensurePrivateDir(deep);
  assert.equal(before.has("a1"), false, "a1 was created by this call");
  for (const level of [join(scratch, "a1"), join(scratch, "a1", "b2"), deep]) {
    const mode = statSync(level).mode & 0o777;
    assert.equal(mode, 0o700, `${level} must be 0o700, got 0o${mode.toString(8)}`);
  }
});

test("state fs — ensurePrivateDir is idempotent and enforces mode on an existing dir", () => {
  if (!posix) return;
  const dir = join(scratch, "idempotent");
  ensurePrivateDir(dir);
  chmodSync(dir, 0o755); // simulate drift
  ensurePrivateDir(dir); // re-enforce
  assert.equal(statSync(dir).mode & 0o777, 0o700);
});

test("state fs — atomicWriteJson: file lands 0o600 with no temp residue; content round-trips", () => {
  const dir = join(scratch, "atomic");
  const file = join(dir, "record.json");
  atomicWriteJson(file, { b: 2, a: 1, nested: { z: [1, 2, 3] } });
  if (posix) {
    assert.equal(statSync(file).mode & 0o777, 0o600, "state file must be 0o600");
  }
  assert.deepEqual(readJsonFile<Record<string, unknown>>(file), { b: 2, a: 1, nested: { z: [1, 2, 3] } });
  const leftovers = readdirSync(dir).filter((n) => n.startsWith(".tmp-"));
  assert.deepEqual(leftovers, [], "temp file must be renamed away");
  // Deterministic serialization: sorted keys.
  assert.equal(readFileSync(file, "utf8"), '{"a":1,"b":2,"nested":{"z":[1,2,3]}}');
  // Overwrite replaces wholesale.
  atomicWriteJson(file, { replaced: true });
  assert.deepEqual(readJsonFile<Record<string, unknown>>(file), { replaced: true });
});

test("state fs — atomicWriteText: same discipline for raw text artifacts", () => {
  const file = join(scratch, "text", "report.md");
  atomicWriteText(file, "# report\n");
  if (posix) assert.equal(statSync(file).mode & 0o777, 0o600);
  assert.equal(readFileSync(file, "utf8"), "# report\n");
});

test("state fs — readJsonFile: null for absent; StateFileError for non-object roots and bad JSON", () => {
  const dir = join(scratch, "codec");
  mkdirSync(dir);
  assert.equal(readJsonFile(join(dir, "absent.json")), null);
  writeFileSync(join(dir, "array.json"), "[1,2]");
  writeFileSync(join(dir, "string.json"), '"x"');
  writeFileSync(join(dir, "null.json"), "null");
  writeFileSync(join(dir, "broken.json"), "{oops");
  for (const bad of ["array.json", "string.json", "null.json"]) {
    assert.throws(() => readJsonFile(join(dir, bad)), StateFileError, `non-object root must be rejected: ${bad}`);
  }
  assert.throws(() => readJsonFile(join(dir, "broken.json")), StateFileError);
});

test("state fs — concurrent reader observes old-or-new content only (no torn reads)", async () => {
  const file = join(scratch, "race", "value.json");
  const A = { v: "A", pad: "x".repeat(4096) };
  const B = { v: "B", pad: "y".repeat(4096) };
  atomicWriteJson(file, A);
  const observed: string[] = [];
  let stop = false;
  const reader = (async () => {
    while (!stop) {
      try {
        const parsed = JSON.parse(readFileSync(file, "utf8")) as { v?: string };
        if (parsed.v !== undefined) observed.push(parsed.v);
      } catch (e) {
        // A torn read would surface here: JSON must always parse to a complete value.
        assert.fail(`torn/invalid read observed: ${(e as Error).message}`);
      }
      await new Promise((r) => setImmediate(r));
    }
  })();
  for (let i = 0; i < 10; i++) {
    atomicWriteJson(file, i % 2 === 0 ? B : A);
    await new Promise((r) => setImmediate(r));
  }
  stop = true;
  await reader;
  assert.ok(observed.length > 0, "reader observed at least one write");
  for (const v of observed) {
    assert.ok(v === "A" || v === "B", `observed unexpected content: ${v}`);
  }
});
