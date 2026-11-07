/**
 * Feature 015 (T005, research R6) — the shared identity/secret defaults-scan,
 * EXTRACTED VERBATIM from `tests/contract/ci-defaults-scan.test.ts` (013/012
 * precedent): "the release MUST reuse this scan, not author a parallel one."
 * Consumed by:
 *   - tests/contract/ci-defaults-scan.test.ts (behavior-preserving refactor);
 *   - scripts/release.mjs stage 8 (`defaults-scan`) over the packed archive;
 *   - tests/contract/secret-scan.test.ts (the module's own contract test).
 *
 * Zero dependencies; plain ESM with JSDoc types.
 */

import { readFileSync, readdirSync } from "node:fs";

/** @typedef {[RegExp, string]} BannedPattern  [pattern, human-readable why] */

/**
 * The banned-shape inventory — VERBATIM from the 013 defaults-scan.
 * @type {ReadonlyArray<BannedPattern>}
 */
export const BANNED = Object.freeze([
  [/lin_api_[A-Za-z0-9]{8,}/, "lin_api_-shaped token VALUE"],
  [/-----BEGIN/, "PEM material"],
  [/(proxy-authorization|x-api-key)\s*["']?\s*[:=]/i, "credential-header key"],
  [/\b(contoso|globex|initech|umbrella|hooli|vandelay|acme)\b/i, "fictional-org literal standing in for a real tenant"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}/, "email address"],
  [/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?![0-9a-f-])/, "UUID-shaped identifier"],
  [/\b[0-9a-f]{32,}\b(?![0-9a-f])/, "hex-digest-shaped secret"],
]);

/** Long base64-ish runs are decoded and RE-scanned (FR-005 obfuscation posture). */
export const BASE64_RUN = /[A-Za-z0-9+/]{48,}={0,2}/g;

/**
 * Documented placeholder shapes (fixture README / docs) — allowed hits.
 * @param {string} why @param {string} hit @returns {boolean}
 */
export function isPlaceholder(why, hit) {
  if (why.includes("hex-digest")) {
    return /^([0-9a-f])\1{31,}$/.test(hit); // single-repeat hex = shape probe
  }
  if (why.includes("UUID")) {
    return /^ac000000-0000-4000-8000-\d{12}$/.test(hit); // fixture placeholder seed
  }
  if (why.includes("email")) {
    // RFC-2606 reserved documentation hosts (contracts/artifact-verification.md §3:
    // "example.invalid hosts" — the whole example.* family).
    return /@(?:example\.(?:com|net|org|invalid|test)|localhost)$/i.test(hit);
  }
  return false;
}

/**
 * Prose documents (`.md`/`.txt`) legitimately carry FICTIONAL-ORG example tenants
 * (`acme`, `globex`, …) — the repo's long-standing documentation convention. The
 * fictional-org entry in BANNED guards CONFIG/artifact defaults against standing
 * in for a real tenant; in prose it IS the example, and the artifact ships docs
 * (FR-001). Allowance is scoped to this one `why` and to prose extensions only —
 * credentials, PEM, UUIDs, emails, and hex digests stay banned everywhere
 * (contracts/artifact-verification.md §3 ALLOWED list; secret-scan.test.ts
 * pins the scoping).
 * @param {string} file path relative to the scanned root
 * @param {string} why
 * @returns {boolean}
 */
export function isProseAllowance(file, why) {
  return /\.(?:md|txt)$/i.test(file) && why.includes("fictional-org");
}

/**
 * Scan one text — the behavior frozen from ci-defaults-scan.
 * @param {string} text @returns {Array<{why: string, hit: string}>}
 */
export function scanText(text) {
  const findings = [];
  for (const [pattern, why] of BANNED) {
    const flags = pattern.flags.includes("i") ? "gi" : "g";
    for (const m of text.matchAll(new RegExp(pattern.source, flags))) {
      if (isPlaceholder(why, m[0])) continue;
      findings.push({ why, hit: m[0] });
    }
  }
  return findings;
}

/**
 * Scan text INCLUDING base64 payloads: every long base64-ish run is decoded
 * and re-scanned; undecodable/empty runs are noise. Used by release stage 8
 * over the packed archive (FR-005 obfuscation posture).
 * @param {string} text @returns {Array<{why: string, hit: string, viaBase64?: boolean}>}
 */
export function scanTextHardened(text) {
  const findings = scanText(text).map((f) => ({ ...f }));
  for (const m of text.matchAll(BASE64_RUN)) {
    let decoded;
    try {
      decoded = Buffer.from(m[0], "base64").toString("utf8");
    } catch {
      continue;
    }
    if (decoded.length === 0) continue;
    for (const f of scanText(decoded)) {
      findings.push({ ...f, viaBase64: true });
    }
  }
  return findings;
}

/** Depth-first file walk. @param {string} dir @returns {Generator<string>} */
export function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

/**
 * Scan every file under `dir` (hardened: base64 payloads included).
 * @param {string} dir @returns {Array<{file: string, why: string, hit: string, viaBase64?: boolean}>}
 */
export function scanFileTree(dir) {
  const findings = [];
  for (const file of walk(dir)) {
    const rel = file.slice(dir.length + 1);
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue; // binary/unreadable: nothing textual to find
    }
    for (const f of scanTextHardened(text)) {
      if (isProseAllowance(rel, f.why)) continue;
      findings.push({ file: rel, ...f });
    }
  }
  return findings;
}
