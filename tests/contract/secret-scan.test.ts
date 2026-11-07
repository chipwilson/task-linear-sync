/**
 * T004 [015 US1] — contract test for `scripts/lib/secret-scan.mjs`, the scan
 * extracted from `ci-defaults-scan.test.ts` (research R6) that release stage 8
 * runs over the packed archive. Locks: every banned shape is detected; every
 * documented placeholder allowance passes; base64 payloads are decoded and
 * re-scanned (FR-005 obfuscation posture).
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

interface Finding {
  why: string;
  hit: string;
  viaBase64?: boolean;
}
interface SecretScanModule {
  readonly BANNED: ReadonlyArray<readonly [RegExp, string]>;
  isPlaceholder(why: string, hit: string): boolean;
  isProseAllowance(file: string, why: string): boolean;
  scanText(text: string): Finding[];
  scanTextHardened(text: string): Finding[];
  scanFileTree(dir: string): Array<{ file: string } & Finding>;
}
const mod = (await import(new URL("../../../scripts/lib/secret-scan.mjs", import.meta.url).href)) as unknown as SecretScanModule;

const whyOf = (needle: string): string => {
  const entry = mod.BANNED.find(([, why]) => why.includes(needle));
  assert.ok(entry, `banned inventory must carry a ${needle} pattern`);
  return entry[1];
};

test("BANNED inventory carries every documented shape", () => {
  for (const needle of [
    "token VALUE",
    "PEM",
    "credential-header",
    "fictional-org",
    "email",
    "UUID",
    "hex-digest",
  ]) {
    whyOf(needle);
  }
});

test("scanText: positives — every banned shape is found", () => {
  const cases: Array<[string, string]> = [
    ["token = lin_api_ABCDEFGH1234", "token VALUE"],
    ["-----BEGIN PRIVATE KEY-----", "PEM"],
    ["Proxy-Authorization: Basic zzz", "credential-header"],
    ["x-api-key = abc", "credential-header"],
    ["the contoso tenant", "fictional-org"],
    ["reach ops@real.example one@fake.de", "email"],
    ["id 123e4567-e89b-42d3-a456-426614174000", "UUID"],
    ["digest bea6d1f3c4b5a6978899aabbccddeeff00112233", "hex-digest"],
  ];
  for (const [text, needle] of cases) {
    const why = whyOf(needle);
    const hits = mod.scanText(text).filter((f) => f.why === why);
    assert.ok(hits.length >= 1, `expected '${needle}' to be found in: ${text}`);
  }
});

test("scanText: negatives — documented placeholders are allowed", () => {
  // single-repeat hex shape probe (docs/linear-api.md precedent)
  assert.deepEqual(mod.scanText("f".repeat(32)).filter((f) => f.why === whyOf("hex-digest")), []);
  // the documented fixture UUID seed
  assert.deepEqual(
    mod.scanText("ac000000-0000-4000-8000-000000000000").filter((f) => f.why === whyOf("UUID")),
    [],
  );
  // clean text stays clean
  assert.deepEqual(mod.scanText("docs/team_playbook.md example.invalid specs/"), []);
});

test("scanText: isPlaceholder table semantics", () => {
  assert.equal(mod.isPlaceholder("hex-digest-shaped secret", "a".repeat(32)), true);
  assert.equal(mod.isPlaceholder("hex-digest-shaped secret", "bea6d1f3c4b5a6978899aabbccddeeff00112233"), false);
  assert.equal(mod.isPlaceholder("UUID-shaped identifier", "ac000000-0000-4000-8000-123456789012"), true);
  assert.equal(mod.isPlaceholder("UUID-shaped identifier", "123e4567-e89b-42d3-a456-426614174000"), false);
  assert.equal(mod.isPlaceholder("email address", "ops@real.example"), false);
  // RFC-2606 documentation hosts are placeholders; real hosts are not.
  assert.equal(mod.isPlaceholder("email address", "someone@example.com"), true);
  assert.equal(mod.isPlaceholder("email address", "docs@example.invalid"), true);
  assert.equal(mod.isPlaceholder("email address", "someone@example.horse"), false);
});

test("prose allowance (artifact-verification §3): fictional-org ONLY, prose files ONLY", () => {
  const fictional = whyOf("fictional-org");
  assert.equal(mod.isProseAllowance("docs/cli.md", fictional), true);
  assert.equal(mod.isProseAllowance("README.md", fictional), true);
  assert.equal(mod.isProseAllowance("notes.txt", fictional), true);
  // never for any other pattern…
  for (const needle of ["token VALUE", "PEM", "email", "UUID", "hex-digest", "credential-header"]) {
    assert.equal(mod.isProseAllowance("docs/cli.md", whyOf(needle)), false, needle);
  }
  // …and never outside prose extensions.
  for (const file of ["dist/defaults.js", "package.json", "config.yaml", "LICENSE"]) {
    assert.equal(mod.isProseAllowance(file, fictional), false, file);
  }
});

test("scanFileTree: prose allowance in action — scoped exactly as documented", () => {
  const dir = mkdtempSync(join(tmpdir(), "u1-prose-"));
  try {
    writeFileSync(join(dir, "guide.md"), "the acme tenant syncs into globex space\n");
    writeFileSync(join(dir, "defaults.json"), '{"workspace":"acme"}\n');
    writeFileSync(join(dir, "support.md"), "write ops@corp.example.org for help\n");
    const findings = mod.scanFileTree(dir);
    // guide.md: fictional-org ALLOWED (prose). defaults.json: fictional-org CAUGHT.
    // support.md: email at a real host CAUGHT even in prose (allowance is scoped).
    assert.deepEqual(
      findings.map((f) => `${f.file}:${f.why.includes("fictional-org") ? "fictional" : f.why.includes("email") ? "email" : "other"}`),
      ["defaults.json:fictional", "support.md:email"],
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("scanTextHardened: base64-wrapped payload is decoded and re-scanned (FR-005)", () => {
  const secret = "lin_api_" + "SUP3RSECRETVALUE12345678";
  const wrapped = Buffer.from(`token=${secret}`, "utf8").toString("base64"); // ≥48 chars
  assert.ok(wrapped.length >= 48, "fixture payload must exceed the base64-run threshold");
  assert.deepEqual(mod.scanText(wrapped).filter((f) => f.why === whyOf("token VALUE")), []);
  const hardened = mod.scanTextHardened(wrapped).filter((f) => f.why === whyOf("token VALUE"));
  assert.equal(hardened.length, 1);
  assert.equal(hardened[0]?.viaBase64, true);
});

test("scanFileTree: findings name the file; clean trees report nothing", () => {
  const dir = mkdtempSync(join(tmpdir(), "u1-scan-"));
  try {
    writeFileSync(join(dir, "clean.txt"), "specs/001-example/hello.md\n");
    writeFileSync(join(dir, "nested-deep.js"), 'const k = "lin_api_NOTAREALTOKEN1";\n');
    const findings = mod.scanFileTree(dir);
    assert.equal(findings.length, 1);
    assert.equal(findings[0]?.file, "nested-deep.js");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
