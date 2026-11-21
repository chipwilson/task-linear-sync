/**
 * Extraction pass (FR-001…FR-006; contracts/parsing-api.md rules 1–6).
 *
 * Convention resolution is exactly research R2: `adapter.<member> ?? config.<grammar key>`
 * over `headingIdGrammar`, `phasePattern`, `summaryPattern`, `rollupPattern` — "No key is
 * added to the frozen `ResolvedConfig`". Phase/summary semantics follow research R6;
 * nesting is the monotonic indent stack with the orphan rule (FR-002, research R5).
 *
 * Pure over the line model — zero I/O, zero clock, no adapter internals (R1 boundary).
 */
import type { IssueRef, TaskKind } from "../domain/task.js";
import type { ResolvedConfig } from "../config/schema.js";
import type { TaskFileAdapter } from "./adapter.js";
import { escapeRegExp, headingLevelOf, LOCAL_ID_SPAN_RE, matchCheckbox, stripLeadingLocalId } from "./content.js";
import type { ContentLine } from "./content.js";

/** 004-local exclusion record (data-model § 2; FR-004). */
export interface ExclusionRecord {
  readonly lineNumber: number;
  readonly kind: "heading" | "checklist";
  readonly reason: "summary-section" | "rollup" | "depth-folded"; // "depth-folded" — 020 amendment A-020-2
  readonly text: string;
}

/** Internal extraction draft: Task fields before uuid/extent/nesting-link materialization. */
export interface TaskDraft {
  readonly kind: TaskKind;
  readonly lineNumber: number;
  /** Raw title with the visible issue reference stripped (parsing-api rule 6). */
  readonly title: string;
  readonly checked?: boolean;
  readonly localTaskId?: string;
  readonly issueRef?: IssueRef;
  readonly phase?: string;
  readonly headingLevel?: number;
  readonly indentWidth: number;
  parent: TaskDraft | null;
  readonly children: TaskDraft[];
}

export interface ResolvedConventions {
  readonly headingGrammar: RegExp;
  readonly phasePattern: RegExp;
  readonly summaryPattern: RegExp;
  readonly rollupPattern: RegExp;
  /** 017 amendment 2: adapter `checklistIdPattern` ?? built-in `LOCAL_ID_SPAN_RE` (no config key). */
  readonly checklistIdPattern: RegExp;
}

/** Override precedence (adapter-consumption rule 3, verbatim): `adapter.<member> ?? config.<grammar key>`. */
export function resolveConventions(adapter: TaskFileAdapter, config: ResolvedConfig): ResolvedConventions {
  return {
    headingGrammar: new RegExp(adapter.headingGrammar ?? config.headingIdGrammar, "u"),
    phasePattern: new RegExp(adapter.phasePattern ?? config.phasePattern, "u"),
    summaryPattern: new RegExp(adapter.summaryPattern ?? config.summaryPattern, "u"),
    rollupPattern: new RegExp(adapter.rollupPattern ?? config.rollupPattern, "u"),
    checklistIdPattern: new RegExp(adapter.checklistIdPattern ?? LOCAL_ID_SPAN_RE.source, "u"),
  };
}

/** The `[<KEY>-(\d+)]` pattern built from `config.confirmationKey` (research R2, exact key). */
function issueRefRe(confirmationKey: string, flags: string): RegExp {
  return new RegExp(`\\[${escapeRegExp(confirmationKey)}-(\\d+)\\]`, `u${flags}`);
}

/**
 * Parse the first visible `\[(<confirmationKey>)-(\d+)\]` reference (number ≥ 1) and
 * strip every occurrence from the stored raw title (parsing-api rule 6).
 */
export function parseIssueRefAndCleanTitle(text: string, confirmationKey: string): { rest: string; issueRef?: IssueRef } {
  const first = issueRefRe(confirmationKey, "").exec(text);
  const number = first?.[1] !== undefined ? Number(first[1]) : undefined;
  const stripped = text.replace(issueRefRe(confirmationKey, "g"), "").replace(/[ \t]{2,}/gu, " ").trim();
  const issueRef = number !== undefined && number >= 1 ? { key: confirmationKey, number } : undefined;
  return issueRef ? { rest: stripped, issueRef } : { rest: stripped };
}

/**
 * C1 (021 amendment A-021-1; data-model §1) — the **document-title heading**: the heading
 * that names the DOCUMENT rather than a task. Verbatim conditions: the document's first
 * non-blank, non-fenced line; ATX level exactly 1; matches the effective heading-id
 * grammar (it would otherwise be a heading task); its title span yields no
 * `Local_Task_ID`; at most one per document (a second level-1 heading mid-file is an
 * ordinary heading task). Fenced `#` lines never qualify (V2); a checkbox-first file has
 * none (V3). Returns the title heading's line number when the determination holds.
 */
export function detectDocumentTitleHeading(
  lines: readonly ContentLine[],
  conventions: ResolvedConventions,
): number | undefined {
  for (const line of lines) {
    if (line.inFence || line.text.trim() === "") continue; // scan to the FIRST non-blank, non-fenced line
    if (headingLevelOf(line.text) !== 1) return undefined; // ATX level exactly 1
    const m = conventions.headingGrammar.exec(line.text);
    if (!m || m.groups?.title === undefined) return undefined; // a grammar-matching heading TASK
    return m.groups?.id === undefined ? line.number : undefined; // yields no Local_Task_ID → title heading
  }
  return undefined;
}

/**
 * FR-005 flat-document pre-scan (021 amendment A-021-3 / contract C3; "a pure pre-scan of
 * the fenced-line set"). The determination is normative for top-level checkbox parenting:
 * flat iff NO grammar-matching heading exists OR the only grammar-matching heading is the
 * document-title heading (previously false for title-headed documents — the defect);
 * the configured flat-checklist marker trigger is unchanged.
 */
export function detectFlatDocument(
  lines: readonly ContentLine[],
  conventions: ResolvedConventions,
  config: ResolvedConfig,
): boolean {
  const titleHeadingLine = detectDocumentTitleHeading(lines, conventions);
  const hasOtherGrammarHeading = lines.some(
    (line) =>
      !line.inFence &&
      headingLevelOf(line.text) !== undefined &&
      line.number !== titleHeadingLine &&
      conventions.headingGrammar.test(line.text),
  );
  if (!hasOtherGrammarHeading) return true; // C3 rows 1–2: none, or only the title heading
  const firstTextLine = lines.find((line) => line.text.trim() !== "" && !line.inFence);
  if (!firstTextLine) return false;
  return config.flatChecklistMarkers.some(
    (marker) => new RegExp(`^[ \\t]*${escapeRegExp(marker)}`, "u").test(firstTextLine.text),
  );
}

export interface ExtractOutput {
  readonly drafts: TaskDraft[];
  readonly exclusions: ExclusionRecord[];
  readonly flatDocument: boolean;
}

/**
 * Single forward scan producing Task drafts (ascending lineNumber) and exclusion
 * records (FR-001…FR-006). Lines inside fences or conflict blocks are never tasks;
 * excluded items "never appear in `file.tasks`" but still act as document structure
 * (headings bound extents — see extent.ts).
 */
export function extractTasks(
  lines: readonly ContentLine[],
  frozen: ReadonlySet<number>,
  adapter: TaskFileAdapter,
  config: ResolvedConfig,
): ExtractOutput {
  const conv = resolveConventions(adapter, config);
  const drafts: TaskDraft[] = [];
  const exclusions: ExclusionRecord[] = [];

  let currentPhase: string | undefined;
  let summaryLevel: number | undefined;
  const stack: TaskDraft[] = []; // monotonic indent stack of open CHECKLIST tasks (R5)
  let currentHeading: TaskDraft | null = null; // nearest enclosing heading TASK
  // C2 (021 A-021-1): the document-title heading names the document, never a task parent.
  const titleHeadingLine = detectDocumentTitleHeading(lines, conv);
  let currentHeadingIsTitle = false;

  for (const line of lines) {
    if (line.inFence || frozen.has(line.number)) continue; // fenced pseudo-tasks / conflict interiors are non-task text
    const level = headingLevelOf(line.text);

    if (level !== undefined) {
      // Every heading line starts a fresh section: the checklist stack resets and the
      // orphan target moves to this section's heading task (or none for non-task headings).
      stack.length = 0;
      currentHeading = null;
      currentHeadingIsTitle = false;
      if (summaryLevel !== undefined && level <= summaryLevel) summaryLevel = undefined; // section closed (FR-004)

      if (conv.phasePattern.test(line.text)) {
        // FR-003 + R6: phase headings are section organizers, NOT tasks.
        const m = conv.phasePattern.exec(line.text);
        const captured = m?.groups?.phase?.trim();
        currentPhase = captured && captured.length > 0 ? captured : line.text.trim();
        continue;
      }
      if (conv.summaryPattern.test(line.text)) {
        summaryLevel = level; // opens the summary section (R6); the heading itself is not a task
        continue;
      }
      const hm = conv.headingGrammar.exec(line.text);
      const rawTitle = hm?.groups?.title;
      if (!hm || rawTitle === undefined) continue; // a heading matching NO grammar is structure only
      const localId = hm.groups?.id;
      const { rest, issueRef } = parseIssueRefAndCleanTitle(rawTitle, config.confirmationKey);
      const draft: TaskDraft = {
        kind: "heading",
        lineNumber: line.number,
        title: rest,
        ...(localId !== undefined ? { localTaskId: localId } : {}),
        ...(issueRef !== undefined ? { issueRef } : {}),
        ...(currentPhase !== undefined ? { phase: currentPhase } : {}),
        headingLevel: level,
        indentWidth: line.indentWidth,
        parent: null,
        children: [],
      };
      currentHeading = draft;
      currentHeadingIsTitle = line.number === titleHeadingLine;
      drafts.push(draft);
      continue;
    }

    const cb = matchCheckbox(line.text, config.flatChecklistMarkers);
    if (!cb) continue; // plain content line

    // FR-004 exclusions: summary-section first (a whole configured section), then rollup.
    if (summaryLevel !== undefined) {
      exclusions.push({ lineNumber: line.number, kind: "checklist", reason: "summary-section", text: line.text });
      continue;
    }
    if (conv.rollupPattern.test(line.text)) {
      exclusions.push({ lineNumber: line.number, kind: "checklist", reason: "rollup", text: line.text });
      continue;
    }

    // FR-002 indent stack: pop entries at-or-deeper than this line, adopt the stack top,
    // else the enclosing heading task (orphan rule), else none (flat/top-level).
    // C2 (021 A-021-1): with an EMPTY indent stack the enclosing heading task is skipped
    // when it is the document-title heading — top-level checkboxes beneath the document
    // title attach to no heading (parent null → depth 1). All other orphan adoption,
    // including beneath `## 9.0:`-style organizer headings, is unchanged.
    while (stack.length > 0 && (stack[stack.length - 1]?.indentWidth ?? 0) >= line.indentWidth) stack.pop();
    const parent = stack[stack.length - 1] ?? (stack.length === 0 && currentHeadingIsTitle ? null : currentHeading);

    const idSplit = stripLeadingLocalId(cb.rest, conv.checklistIdPattern);
    const localPart = idSplit?.[0];
    const afterId = idSplit ? idSplit[1] : cb.rest;
    const { rest, issueRef } = parseIssueRefAndCleanTitle(afterId, config.confirmationKey);

    const draft: TaskDraft = {
      kind: "checklist",
      lineNumber: line.number,
      title: rest,
      checked: cb.checked, // present iff checklist (frozen invariant)
      ...(localPart !== undefined ? { localTaskId: localPart } : {}),
      ...(issueRef !== undefined ? { issueRef } : {}),
      ...(currentPhase !== undefined ? { phase: currentPhase } : {}),
      indentWidth: line.indentWidth,
      parent,
      children: [],
    };
    parent?.children.push(draft);
    stack.push(draft);
    drafts.push(draft);
  }

  return { drafts, exclusions, flatDocument: detectFlatDocument(lines, conv, config) };
}
