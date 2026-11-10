/**
 * 019 doc-truthfulness guard suite — CI contract check (feature 019, FR-006).
 *
 * Pattern source: feature 016 `framework-support-consistency.test.ts` (consumed
 * and extended, not duplicated — C-004/C-005 stay pinned there and are NOT
 * re-pinned here). Three guard families per
 * specs/019-speckit-doc-truthfulness/contracts/doc-truthfulness-guards.md:
 *
 *   family 1  disproven phrasings must stay out of the audited documents;
 *   family 2  corrected passages must keep asserting their evidence-backed facts;
 *   family 3  the audit record itself obeys contracts/audit-record-format.md.
 *
 * Static inputs only (readFileSync); no I/O outside the repository, no clock, no
 * network (Principle VI). Authored RED-FIRST against the uncorrected baseline —
 * the failing guards are the US3-AS1 trail recorded in audit.md's
 * "Verification notes". Every failure names its guard id, the audit entry
 * (C-\d{3}), and the offending document.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const pkgRoot = fileURLToPath(new URL("../../../", import.meta.url));
const read = (rel: string): string => readFileSync(join(pkgRoot, rel), "utf8");

const AUDITED: ReadonlyArray<readonly [string, string]> = [
  ["README.md", read("README.md")],
  ["docs/framework-adapters.md", read("docs/framework-adapters.md")],
  ["docs/discovery.md", read("docs/discovery.md")],
  ["docs/parsing.md", read("docs/parsing.md")],
  ["specs/requirements.md", read("specs/requirements.md")],
];
const readme = AUDITED[0]![1];
const requirements = AUDITED[4]![1];
const allDocs = AUDITED.map(([, text]) => text).join("\n");

const auditPath = "specs/019-speckit-doc-truthfulness/audit.md";
const defectsPath = "specs/019-speckit-doc-truthfulness/defects.md";
const audit = read(auditPath);
const defects = read(defectsPath);

/** Docs whose text matches `pattern` — named in every family-1 failure message. */
function offenders(pattern: RegExp): string {
  const hit = AUDITED.filter(([, text]) => pattern.test(text)).map(([name]) => name);
  return hit.length > 0 ? hit.join(", ") : "(none)";
}

function forbid(guard: string, claim: string, pattern: RegExp, description: string): void {
  const hit = offenders(pattern);
  if (hit !== "(none)") {
    assert.fail(`${guard} (${claim}): ${description} — forbidden phrasing present in ${hit}`);
  }
}

// ── Family 1 — forbidden phrasing (reintroduction guards) ─────────────────────

test("doc-truthfulness: GUARD-01 disproven tags-and-edges phrasing stays out of audited docs", () => {
  forbid(
    "GUARD-01",
    "C-001",
    /`\[P\]\/\[US<n>\]` tags|"Preceded by" edges recorded on the issue/,
    "the sync records no issue tags and no dependency edges (createIssueImpl admits title/description/state/parent only)",
  );
});

test("doc-truthfulness: GUARD-02 disproven out-of-the-box T001-checkbox-capture phrasing stays out of audited docs", () => {
  forbid(
    "GUARD-02",
    "C-002",
    /use T001-style ids — this is the\s+out-of-the-box convention/,
    "plain `- [ ] T001 …` checkbox lines capture NO local id (LOCAL_ID_SPAN_RE needs a separator)",
  );
});

test("doc-truthfulness: GUARD-03 native DEP-dependency parsing claim never reappears in audited docs", () => {
  forbid(
    "GUARD-03",
    "C-003",
    /\[DEP:\]|\[Dep:\]/,
    "no native `[DEP:]`/`[Dep:]` parsing exists (removed with 016; C-003 keeps the topic visible)",
  );
});

test("doc-truthfulness: GUARD-04 the clipboard marker-line phrasing stays out of audited docs", () => {
  forbid(
    "GUARD-04",
    "C-006",
    /📋/,
    "no `📋 Task [T###]` marker line exists — Constitution Principle II forbids reasserting in-file identity markers",
  );
});

test("doc-truthfulness: GUARD-04b milestone-mapping phrasing stays out of audited docs", () => {
  forbid(
    "GUARD-04b",
    "C-007",
    /map 1:1 to Linear\s+milestones|One milestone per\s+spec folder/,
    "the tool never creates or assigns Linear milestones (report grouping by featureName is read-side presentation only)",
  );
});

test("doc-truthfulness: GUARD-08 sync-owned delivery-state enumeration stays out of audited docs", () => {
  forbid(
    "GUARD-08",
    "C-008",
    /delivery state \(assignee, branch, PR, labels, status\)/,
    "the sync itself writes only title/description/workflow state — the enumeration must read as your-team's Linear state, not synced fields",
  );
});

test("doc-truthfulness: GUARD-09 every-convention-configurable overclaim stays out of audited docs", () => {
  forbid(
    "GUARD-09",
    "C-012",
    /every\s+per-adapter convention are configuration keys/,
    "detection markers, sibling sets, and feature-name rules are fixed in the adapter modules — not configuration keys",
  );
});

test("doc-truthfulness: GUARD-10 sync-on-every-commit phrasing stays out of audited docs", () => {
  forbid(
    "GUARD-10",
    "C-014",
    /Linear stays current as you commit/,
    "default managed hooks are pre-push + post-merge — commits alone do not trigger a sync",
  );
});

test("doc-truthfulness: GUARD-11 bare Task 1.2 grammar example stays out of audited docs", () => {
  forbid(
    "GUARD-11",
    "C-019",
    /`T001`,\s*`TASK-1`,\s*`Task 1\.2`/,
    "the shipped heading grammar captures the single token `Task` from `## Task 1.2 …`, never the two-token id",
  );
});

// ── Family 2 — required wording (drift guards) ────────────────────────────────

test("doc-truthfulness: GUARD-05 Spec Kit section states the as-built per-task sync outcome", () => {
  assert.match(
    readme,
    /mirrors the task body,[\s\S]{0,200}`\[KEY-N\]` reference token is written back on the task line,[\s\S]{0,220}sync-attachment metadata/,
    "GUARD-05 (C-001): README.md Spec Kit section must state mirrored description body + visible [KEY-N] token + sync-attachment durability",
  );
});

test("doc-truthfulness: GUARD-06 corrected Spec Kit wording keeps both layout and grammar truths", () => {
  assert.match(
    readme,
    /tasks\.md` — the out-of-the-box layout[\s\S]{0,360}separator punctuation[\s\S]{0,240}ordinal/,
    "GUARD-06 (C-002): README.md must keep BOTH truths — config-free specs/<feature>/tasks.md layout AND grammar-governed id capture (headings capture; checkbox ids need the separator; ordinal fallback)",
  );
});

test("doc-truthfulness: GUARD-07 intro states durability via reference token and attachment anchor", () => {
  assert.match(
    readme,
    /reference token written back[\s\S]{0,160}sync-attachment metadata[\s\S]{0,100}no in-file marker/,
    "GUARD-07 (C-006): README.md intro must anchor mapping durability in the visible [KEY-N] token + attachment metadata, with no in-file marker (Constitution Principle II)",
  );
});

test("doc-truthfulness: GUARD-24 intro states reports never touch Linear milestones", () => {
  assert.match(
    readme,
    /never creates or assigns Linear milestones/,
    "GUARD-24 (C-007): README.md intro must state report-only grouping and that the tool never creates or assigns Linear milestones",
  );
});

test("doc-truthfulness: GUARD-12 requirements.md keeps the mandated heading-grammar default", () => {
  assert.match(
    requirements,
    /T\\d\{2,5\}/,
    "GUARD-12 (C-054): the R2.2 mandated default grammar (incl. the Task\\s+\\d+ alternative the code lacks) stays until FU-002 lands — no erasing unimplemented mandates",
  );
});

test("doc-truthfulness: GUARD-13 requirements.md keeps the mandated phase-pattern default", () => {
  assert.match(
    requirements,
    /\(\?:phase\|story\|milestone\)/,
    "GUARD-13 (C-055): the R2.5 mandated phase pattern stays until FU-002 lands",
  );
});

test("doc-truthfulness: GUARD-14 requirements.md keeps the mandated summary-pattern default", () => {
  assert.match(
    requirements,
    /timeline estimate/,
    "GUARD-14 (C-056): the R2.6 mandated summary phrase set stays until FU-002 lands",
  );
});

test("doc-truthfulness: GUARD-15 requirements.md keeps the mandated rollup-pattern defaults", () => {
  assert.match(
    requirements,
    /completion checklist/,
    "GUARD-15 (C-057): the R2.7 mandated bold-label rollup defaults stay until FU-002 lands",
  );
});

test("doc-truthfulness: GUARD-16 requirements.md keeps the adapter-supplied checklist-grammar mandate", () => {
  assert.match(
    requirements,
    /heading\/checklist identifier grammar/,
    "GUARD-16 (C-058): the R7.4 adapter-supplied checklist-grammar mandate stays until FU-003 lands",
  );
});

test("doc-truthfulness: GUARD-17 requirements.md keeps the mandated flat-checklist default", () => {
  assert.match(
    requirements,
    /the path-marker list is empty/,
    "GUARD-17 (C-059): the R2.8 mandated empty-default marker list stays until FU-002 lands",
  );
});

// ── Family 3 — audit-record self-checks (contracts/audit-record-format.md) ────

const VERDICTS = new Set(["true", "false", "ambiguous", "true-no-claim-present"]);
const KINDS = new Set(["source", "test", "demo", "absence-search"]);
const CHECKS = new Set(["requirements-silent", "requirements-agree", "requirements-mandate-code-lacks"]);

interface ClaimSection {
  id: string;
  verdict?: string;
  kind?: string;
  pointer?: string;
  check?: string;
  hasCorrection: boolean;
}

function claimSections(): ClaimSection[] {
  const parts = audit.split(/^### (C-\d{3})[^\n]*$/m);
  const out: ClaimSection[] = [];
  for (let i = 1; i < parts.length; i += 2) {
    const body = parts[i + 1] ?? "";
    out.push({
      id: parts[i]!,
      verdict: body.match(/^- \*\*Verdict\*\*: (.+)$/m)?.[1]?.trim(),
      kind: body.match(/^- \*\*Evidence kind\*\*: (.+)$/m)?.[1]?.trim(),
      pointer: body.match(/^- \*\*Evidence pointer\*\*: (.+)$/m)?.[1]?.trim(),
      check: body.match(/^- \*\*Requirements check\*\*: (.+)$/m)?.[1]?.trim(),
      hasCorrection: /^- \*\*Correction\*\*:/m.test(body),
    });
  }
  return out;
}

/** Resolve an Evidence pointer: file exists; `::rest` text present; `:N[-M]` in range. */
function pointerResolves(pointer: string): boolean {
  let file = pointer;
  let rest: string | null = null;
  let lastLine: number | null = null;
  const dc = pointer.indexOf("::");
  if (dc >= 0) {
    file = pointer.slice(0, dc);
    rest = pointer.slice(dc + 2);
  } else {
    const lm = pointer.match(/^(.+?):(\d+)(?:-(\d+))?$/);
    if (lm) {
      file = lm[1]!;
      lastLine = Number(lm[3] ?? lm[2]);
    }
  }
  const abs = join(pkgRoot, file);
  if (!existsSync(abs)) return false;
  if (rest !== null) return readFileSync(abs, "utf8").includes(rest);
  if (lastLine !== null) return readFileSync(abs, "utf8").split("\n").length >= lastLine;
  return true;
}

test("doc-truthfulness: GUARD-18 audit record header keys parse", () => {
  const baseline = audit.match(/^- Baseline commit: ([0-9a-f]{40})$/m);
  assert.ok(baseline, `GUARD-18: ${auditPath} must carry a 40-hex Baseline commit header key`);
  for (const doc of AUDITED.map(([name]) => name)) {
    assert.ok(
      /^- Audited documents:.*$/m.test(audit) && audit.includes(doc.split("/").pop()!),
      `GUARD-18: ${auditPath} Audited-documents header must list ${doc}`,
    );
  }
  assert.match(
    audit,
    /^- Open false\/ambiguous verdicts: \d+$/m,
    `GUARD-18: ${auditPath} must carry an integer open-count header key`,
  );
});

test("doc-truthfulness: GUARD-19 every claim entry carries a resolving evidence pointer", () => {
  const sections = claimSections();
  assert.ok(sections.length >= 79, `GUARD-19: ${auditPath} must carry the full claim record (found ${sections.length})`);
  for (const s of sections) {
    assert.ok(s.verdict !== undefined, `GUARD-19 (${s.id}): ${auditPath} entry lacks a Verdict field`);
    assert.ok(s.kind !== undefined && KINDS.has(s.kind), `GUARD-19 (${s.id}): ${auditPath} entry lacks a legal Evidence kind`);
    assert.ok(s.pointer !== undefined && pointerResolves(s.pointer), `GUARD-19 (${s.id}): ${auditPath} Evidence pointer does not resolve: ${s.pointer ?? "(missing)"}`);
  }
});

test("doc-truthfulness: GUARD-20 verdict vocabulary legal and corrections present", () => {
  for (const s of claimSections()) {
    assert.ok(
      s.verdict !== undefined && VERDICTS.has(s.verdict),
      `GUARD-20 (${s.id}): ${auditPath} verdict "${s.verdict}" outside the enum set`,
    );
    if (s.check !== undefined) {
      assert.ok(CHECKS.has(s.check), `GUARD-20 (${s.id}): ${auditPath} requirements check "${s.check}" outside the enum set`);
    }
    if (s.verdict === "false" || s.verdict === "ambiguous") {
      assert.ok(s.hasCorrection, `GUARD-20 (${s.id}): ${auditPath} false/ambiguous entry lacks a **Correction**: line`);
    }
  }
});

test("doc-truthfulness: GUARD-21 open false/ambiguous count reaches zero", () => {
  const open = claimSections().filter((s) => (s.verdict === "false" || s.verdict === "ambiguous") && !s.hasCorrection).length;
  const header = Number(audit.match(/^- Open false\/ambiguous verdicts: (\d+)$/m)?.[1]);
  assert.equal(header, open, `GUARD-21: ${auditPath} header count ${header} disagrees with ${open} open entries`);
  assert.equal(open, 0, `GUARD-21 (SC-001): ${auditPath} still carries ${open} open false/ambiguous verdicts`);
});

test("doc-truthfulness: GUARD-22 the six FR-002 suspect topics appear in the record", () => {
  const topics: ReadonlyArray<readonly [string, RegExp]> = [
    ["[P]/[US<n>] tags", /\[P\]\/\[US<n>\]/],
    ["Preceded-by edges", /Preceded by/],
    ["native [DEP:]/ parsing", /\[DEP:\]/],
    ["checkbox T001 capture", /checkbox/i],
    ["selection precedence", /precedence/i],
    ["agent-hook scaffold table", /agent-hook scaffold/i],
  ];
  for (const [topic, pattern] of topics) {
    assert.match(audit, pattern, `GUARD-22 (SC-002): ${auditPath} is missing the FR-002 suspect topic "${topic}"`);
  }
});

test("doc-truthfulness: GUARD-23 every defect entry's source claim resolves", () => {
  const ids = new Set(claimSections().map((s) => s.id));
  const entries = defects.split(/^### FU-\d{3}[^\n]*$/m).slice(1);
  assert.ok(entries.length > 0, `GUARD-23: ${defectsPath} must carry the follow-up register`);
  for (const entry of entries) {
    const fu = entry.match(/^ — (?:[^\n]*)/m);
    const sources = [...(entry.match(/^- \*\*Source claim\*\*: (.+)$/m)?.[1] ?? "").matchAll(/C-\d{3}/g)].map((m) => m[0]);
    assert.ok(sources.length > 0, `GUARD-23: ${defectsPath} entry "${fu?.[0] ?? "?"}" names no source claim`);
    for (const cid of sources) {
      assert.ok(ids.has(cid), `GUARD-23: ${defectsPath} cites ${cid}, which has no section in ${auditPath}`);
      if (/- \*\*Category\*\*: defect/.test(entry)) {
        const claim = claimSections().find((s) => s.id === cid);
        assert.equal(
          claim?.check,
          "requirements-mandate-code-lacks",
          `GUARD-23: ${defectsPath} category-defect entry must source a requirements-mandate-code-lacks claim (${cid})`,
        );
      }
    }
  }
});
