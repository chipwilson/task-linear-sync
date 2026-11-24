/**
 * Document-unit task core (022 amendment A-022-2; contracts/parsing-api.md rule 13;
 * specs/022-spec-kitty-work-packages.md C2/C3; research R5/R6/R7).
 *
 * PURE and dependency-free (constitution: zero runtime deps — the front-matter scan is a
 * leading-fence LINE parser, no YAML library): it consumes the `documentTaskRule` member
 * values (regex SOURCE strings) plus the raw line array and derives 0-or-1 document draft
 * per file. The parser never references a framework name here — recognition, the title
 * cascade, and identity normalization are all driven by the declarative rule.
 *
 * Line indexing mirrors `splitLines`: `lines[0]` is line 1.
 */

/** The whitelisted rule object (see `TaskFileAdapter.documentTaskRule`, 004 contract). */
export interface DocumentTaskRule {
  readonly collectionPattern: string;
  readonly idKey: string;
  readonly titleKey: string;
  readonly fileNameIdPattern: string;
  /**
   * A-023-2 (023, optional): subtask recognition for the document lane (feature
   * contract C2). All members are regex SOURCE strings (the `(?i)` prefix convention
   * applies); absent ⇒ the pre-023 single-draft path stays byte-identical (inert for
   * every adapter that does not declare it).
   */
  readonly subtaskRule?: {
    /** Front-matter list key carrying the subtask roster (e.g. `subtasks`). */
    readonly rosterKey: string;
    /** Anchor line grammar: an ATX heading or checklist line opening with the subtask token. */
    readonly anchorPattern: string;
    /** Heading that ENDS the anchor region (restatements beyond it are content, never anchors). */
    readonly anchorRegionStopPattern: string;
  };
}

/** One captured single-level front-matter list entry (A-023-2). `line` is 1-based. */
export interface FrontMatterListEntry {
  readonly value: string;
  readonly line: number;
}

export interface FrontMatterScan {
  /** Top-level scalar keys only (`key: value` lines at zero indentation); quoted scalars unwrapped. */
  readonly scalars: Readonly<Record<string, string>>;
  /**
   * A-023-2 (additive): top-level keys whose value is a SINGLE-LEVEL list — block form
   * (`key:` then indented `- value` lines) or flow form (`key: [a, b]`). Scalars keep
   * their byte-identical capture (a flow value stays a scalar string too); nested or
   * otherwise malformed lists stay fully ignored, exactly as before.
   */
  readonly lists: Readonly<Record<string, readonly FrontMatterListEntry[]>>;
  /** 1-based line number of the CLOSING fence line. */
  readonly closingLine: number;
}

export interface DocumentDraft {
  readonly kind: "document";
  /** Normalized identifier (canonical upper-case letters+digits token, e.g. `WP01`). */
  readonly localTaskId: string;
  /** Raw title per the cascade; front-matter text never appears in it. */
  readonly title: string;
  /** First body line — the task's own line (front matter excluded). */
  readonly lineNumber: number;
  /** Inclusive mirrored extent: `startLine..endLine` IS the content range (R11). */
  readonly startLine: number;
  readonly endLine: number;
}

/**
 * Compile a rule regex source. The declarative members are regex SOURCE strings; a
 * leading `(?i)` group is the documented case-insensitivity convention (JavaScript has
 * no inline flags) and is applied as the `i` flag.
 */
export function compileRuleSource(source: string): RegExp {
  if (source.startsWith("(?i)")) return new RegExp(source.slice(4), "i");
  return new RegExp(source);
}

/** Unwrap a surrounding pair of matching quotes. */
function unquote(value: string): string {
  const q = value[0];
  if ((q === "'" || q === '"') && value.length >= 2 && value[value.length - 1] === q) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Leading-front-matter scan (R5, verbatim): an optional leading `---` fence whose FIRST
 * non-blank line opens it, closed by a following `---`/`…` fence line; only top-level
 * scalar keys are read. Malformed, unterminated, or absent ⇒ `null` — no front matter,
 * the whole file is body (conservative: content is never dropped).
 */
export function scanFrontMatter(lines: readonly string[]): FrontMatterScan | null {
  let open = 0;
  while (open < lines.length && (lines[open] ?? "").trim() === "") open += 1;
  if (open >= lines.length || (lines[open] ?? "").trim() !== "---") return null;
  let close = -1;
  for (let i = open + 1; i < lines.length; i += 1) {
    const trimmed = (lines[i] ?? "").trim();
    if (trimmed === "---" || trimmed === "...") {
      close = i;
      break;
    }
  }
  if (close < 0) return null; // unterminated fence — no front matter (R5)
  const scalars: Record<string, string> = {};
  const lists: Record<string, readonly FrontMatterListEntry[]> = {};
  for (let i = open + 1; i < close; i += 1) {
    const raw = lines[i] ?? "";
    if (raw.trim() === "") continue;
    // Top-level only: zero indentation, no list/comment markers, a colon splits key/value.
    if (/^[ \t]/u.test(raw) || /^[#-]/u.test(raw)) continue;
    const colon = raw.indexOf(":");
    if (colon <= 0) continue;
    const key = raw.slice(0, colon).trim();
    const value = raw.slice(colon + 1).trim();
    if (key === "" || !/^[A-Za-z_][A-Za-z0-9_-]*$/u.test(key)) continue;
    if (value === "") {
      // Nested-collection openers (`dependencies:`) carry no scalar — unchanged (R5).
      // A-023-2: the SAME opener may open a single-level BLOCK list; capture it when the
      // following lines are plain scalar items, ignore everything else exactly as before.
      const block = captureBlockList(lines, close, i + 1);
      if (block !== null) lists[key] = block;
      continue;
    }
    scalars[key] = unquote(value); // scalar capture byte-identical (A-023-2)
    // A-023-2: a FLOW value additionally captures as a single-level list; the scalar
    // above stays exactly what 0.6.0 recorded.
    const flow = /^\[(.*)\]$/u.exec(value);
    if (flow !== null) {
      const inner = (flow[1] ?? "").trim();
      const items = inner === "" ? [] : inner.split(",").map((part) => unquote(part.trim())).filter((p) => p !== "");
      lists[key] = items.map((v) => ({ value: v, line: i + 1 }) satisfies FrontMatterListEntry);
    }
  }
  return { scalars, lists, closingLine: close + 1 };
}

/**
 * A-023-2: single-level block list beneath a top-level key — consecutive `- value`
 * items (indented OR flush-left, both are real upstream shapes), stopping at the first
 * non-item line or the closing fence. Returns `null` — list IGNORED, everything else
 * unchanged — when the structure is not a plain scalar list: map-style items
 * (`- key: value`), nested dashes, or no items at all.
 */
function captureBlockList(lines: readonly string[], close: number, from: number): readonly FrontMatterListEntry[] | null {
  const entries: FrontMatterListEntry[] = [];
  for (let i = from; i < close; i += 1) {
    const raw = lines[i] ?? "";
    if (raw.trim() === "") continue; // blank lines keep the list alive
    const item = /^[ \t]*-[ \t]+(.*)$/u.exec(raw);
    if (item === null) break; // any non-item line closes the list
    const value = unquote((item[1] ?? "").trim());
    if (value === "") return null; // `- - x`-style nesting: not a plain scalar list
    if (/^[A-Za-z_][A-Za-z0-9_-]*[ \t]*:/u.test(value)) return null; // map-style item
    entries.push({ value, line: i + 1 });
  }
  return entries.length > 0 ? entries : null;
}

/**
 * Readable file-name slug (R6): drop the extension, strip a leading identifier token
 * (letters+digits such as `WP01`) with its separators, map `-`/`_` to spaces, collapse
 * whitespace, and title-case the words. Never empty for a named file; never contains the
 * identifier token.
 */
export function readableFileSlug(fileName: string): string {
  const stem = fileName.replace(/\.[^./]+$/u, "");
  const deidentified = stem.replace(/^[A-Za-z]+\d+[-_ ]*/u, "");
  const words = deidentified.replace(/[-_]+/gu, " ").replace(/\s+/gu, " ").trim();
  if (words === "") return stem.replace(/[-_]+/gu, " ").replace(/\s+/gu, " ").trim();
  return words.replace(/\b([a-z])/gu, (m) => m.toUpperCase());
}

/** The body's leading ATX heading text (first heading of ANY level), or undefined. */
function leadingHeadingText(lines: readonly string[], fromLine: number): string | undefined {
  for (let i = Math.max(0, fromLine - 1); i < lines.length; i += 1) {
    const text = lines[i] ?? "";
    const m = /^ {0,3}(#{1,6})[ \t]+(\S.*)$/u.exec(text);
    if (m?.[2] !== undefined) return m[2].trim().replace(/[ \t]+#+[ \t]*$/u, "");
  }
  return undefined;
}

/**
 * Normalize an identifier (R7): the leading letters+digits token in UPPER CASE
 * (`wp01-foo` → `WP01`, `wp7` → `WP7`); a value without such a token keeps its trimmed
 * text verbatim.
 */
export function normalizeIdentifierToken(raw: string): string {
  const trimmed = raw.trim();
  const m = /^([A-Za-z]+)(\d+)/u.exec(trimmed);
  return m ? `${(m[1] as string).toUpperCase()}${m[2]}` : trimmed;
}

function baseName(relPath: string): string {
  return relPath.slice(relPath.lastIndexOf("/") + 1);
}

/**
 * Derive 0-or-1 document draft for one claimed file (parsing-api rule 13 pipeline):
 * collection gate → front-matter scan → recognition (front-matter `idKey` scalar wins,
 * else `fileNameIdPattern` on the basename) → title cascade → body extent. Zero drafts —
 * with zero further work — for everything that fails a gate (roll-ups, notes, review
 * artifacts: claimed documentation, never line-scanned).
 */
export function deriveDocumentTask(
  filePath: string,
  lines: readonly string[],
  rule: DocumentTaskRule,
): DocumentDraft | null {
  // Gate 1 — the collection (C0.2/C2.2): the roll-up and anything outside `tasks/` never
  // identifies, whatever its content.
  if (!compileRuleSource(rule.collectionPattern).test(filePath)) return null;

  const front = scanFrontMatter(lines);
  const scalars = front?.scalars ?? {};

  // Gate 2 — recognition (C2.1): a non-empty front-matter scalar beats the file name.
  let rawId = (scalars[rule.idKey] ?? "").trim();
  if (rawId === "") {
    if (!compileRuleSource(rule.fileNameIdPattern).test(baseName(filePath))) return null;
    rawId = baseName(filePath); // token extracted by normalization below
  }
  const localTaskId = normalizeIdentifierToken(rawId);

  // Title cascade (C3.1): front-matter `titleKey` → body's leading ATX heading → slug.
  const bodyFrom = (front?.closingLine ?? 0) + 1; // 1-based first line after the fence
  const heading = leadingHeadingText(lines, bodyFrom);
  const fmTitle = (scalars[rule.titleKey] ?? "").trim();
  const title = fmTitle !== "" ? fmTitle : heading ?? readableFileSlug(baseName(filePath));

  // Body extent (R11): FIRST non-blank body line .. LAST non-blank line of the file.
  // An empty (or front-matter-only) body yields startLine > endLine — the mirrored slice
  // is then the visible empty content, never a silent drop (C3.3).
  let startLine = 0;
  for (let i = bodyFrom - 1; i < lines.length; i += 1) {
    if ((lines[i] ?? "").trim() !== "") {
      startLine = i + 1;
      break;
    }
  }
  let endLine = 0;
  for (let i = lines.length - 1; i >= bodyFrom - 1; i -= 1) {
    if ((lines[i] ?? "").trim() !== "") {
      endLine = i + 1;
      break;
    }
  }
  if (startLine === 0) {
    // No body at all: extent is empty; the line anchors just past the fence (clamped).
    startLine = Math.min(bodyFrom, Math.max(lines.length, 1));
    endLine = startLine - 1;
  }

  return { kind: "document", localTaskId, title, lineNumber: startLine, startLine, endLine };
}
