/**
 * T032 — negative-type assertions for `task-linear-sync/parsing` (002 T050 precedent;
 * compiled by `npm run typecheck`, never executed). Each @ts-expect-error must fail for
 * the RIGHT reason: if the code becomes legal, the unused expectation itself breaks the
 * typecheck. Certifies Principle I (zero-I/O by types: no fs/write/stream surface escapes)
 * and the adapter-consumption boundary (TaskFileAdapter is the only adapter accepted).
 */
import type {
  CleanTitleOptions,
  LineAssignment,
  ParseResult,
  RenderResult,
  TaskFileAdapter,
} from "task-linear-sync/parsing";
import { parseTaskFile, renderTaskLines, deriveStableUuid } from "task-linear-sync/parsing";
import type * as parsing from "task-linear-sync/parsing";
import type { ResolvedConfig, Task } from "task-linear-sync";

declare const cfg: ResolvedConfig;
declare const task: Task;
declare const adapter: TaskFileAdapter;

// ── 1. Purity (Principle I): no fs/write/stream surface escapes the module ───────────

type HasNoWriteFile = "writeFile" extends keyof typeof parsing ? true : false;
const _noWriteFile: HasNoWriteFile extends false ? true : false = true;
type HasNoWriteStream = "createWriteStream" extends keyof typeof parsing ? true : false;
const _noWriteStream: HasNoWriteStream extends false ? true : false = true;
type HasNoOpen = "open" extends keyof typeof parsing ? true : false;
const _noOpen: HasNoOpen extends false ? true : false = true;

// RenderResult.content is a PLAIN STRING — not a handle, stream, or writer.
type ContentIsBareString = RenderResult["content"] extends string
  ? string extends RenderResult["content"]
    ? true
    : false
  : false;
const _contentString: ContentIsBareString = true;
type NoHandleEscapes = RenderResult extends
  | { handle: unknown }
  | { fd: unknown }
  | { stream: unknown }
  | { writer: unknown }
  | { fileHandle: unknown }
  ? true
  : false;
const _noHandles: NoHandleEscapes extends false ? true : false = true;

// Output values are readonly; results cannot be mutated into a "write path".
declare const rendered: RenderResult;
// @ts-expect-error — content is readonly (the engine owns all writes; 004 never writes)
rendered.content = "overwrite";
// @ts-expect-error — changes is a readonly array (009 consumes, never mutates)
rendered.changes.push({ lineNumber: 1, before: "", after: "" });

// No parsing function takes a callback that could smuggle I/O through generics.
type RenderParams = Parameters<typeof renderTaskLines>;
type FnPresent = [Extract<RenderParams[number], (...a: never[]) => unknown>] extends [never] ? false : true;
const _noCallbacks: FnPresent extends false ? true : false = true;

// ── 2. parseTaskFile requires ALL FOUR parameters ────────────────────────────────────

// @ts-expect-error — filePath alone is not a parse
void parseTaskFile("specs/x/tasks.md");

// @ts-expect-error — the adapter argument is mandatory (no implicit `generic`)
void parseTaskFile("specs/x/tasks.md", "# 1: Task\n", cfg);

// @ts-expect-error — config is mandatory and must be a ResolvedConfig
void parseTaskFile("specs/x/tasks.md", "# 1: Task\n", adapter, {});

// @ts-expect-error — argument order is (filePath, content, adapter, config): two strings swapped at positions 2/3
void parseTaskFile("specs/x/tasks.md", adapter, "content", cfg);

// The complete form compiles.
declare const result: ParseResult;
void result;

// ── 3. TaskFileAdapter is the ONLY adapter shape accepted (constitution V analogue) ──

// @ts-expect-error — a raw fetch-like tracker dependency is not a TaskFileAdapter (no `id`)
void parseTaskFile("specs/x/tasks.md", "", { fetch: globalThis.fetch }, cfg);

// @ts-expect-error — id must be a FrameworkId string, never an object/port
void parseTaskFile("specs/x/tasks.md", "", { id: { fetch: globalThis.fetch } }, cfg);

type ThirdParamIsAdapter = Parameters<typeof parseTaskFile>[2] extends TaskFileAdapter ? true : false;
const _adapterBoundary: ThirdParamIsAdapter extends true ? true : false = true;

// ── 4. LineAssignment + render options are content-shaped, never path-shaped ─────────

const good: LineAssignment = { task, desiredTitle: "Ship it", issueRef: { key: "SYNC", number: 300 }, checked: true };
void good;

// @ts-expect-error — checked is a boolean state, not a string
const badChecked: LineAssignment = { task, desiredTitle: "x", checked: "true" };
void badChecked;

// @ts-expect-error — issueRef is the structured IssueRef, never a bare token string
const badRef: LineAssignment = { task, desiredTitle: "x", issueRef: "SYNC-300" };
void badRef;

// @ts-expect-error — a partial task literal is not a Task
const badTask: LineAssignment = { task: { lineNumber: 1 }, desiredTitle: "x" };
void badTask;

// @ts-expect-error — options reject unknown keys (no dryRun/writer/backdoors)
void renderTaskLines("specs/x/tasks.md", "", [], cfg, { dryRun: false });

// @ts-expect-error — preserveLocalTaskId is boolean
void renderTaskLines("specs/x/tasks.md", "", [], cfg, { preserveLocalTaskId: "yes" });

// @ts-expect-error — render is content-in/content-out; there is no path-only overload
void renderTaskLines("specs/x/tasks.md");

// ── 5. cleanTitle options + deriveStableUuid are total, side-effect-free shapes ──────

// @ts-expect-error — confirmationKey is required for cleaning (no implicit key)
const badClean: CleanTitleOptions = { titleStripPrefixes: [] };
void badClean;

type DeriveReturnsString = ReturnType<typeof deriveStableUuid> extends string ? true : false;
const _deriveString: DeriveReturnsString extends true ? true : false = true;
