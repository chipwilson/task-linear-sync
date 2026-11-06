/**
 * T014 — io layer: `Stdout`/`Stderr` writer ports that screen EVERY line through the
 * injected `SecurityScreener` before writing (data-model §7; contracts/command-surface.md
 * §5). A blocking finding replaces the line with a sanitized blocked notice (never the
 * blocked content) and flags the run outcome for exit 5 (`RUN_ABORTED`).
 */
import type { SecurityScreener } from "../ports/engine.js";

/** Line-oriented writer port; handlers never see the raw sink. */
export interface WriterPort {
  /** Screen and emit one line. */
  write(line: string): void;
  /** True once any line produced a blocking screening finding. */
  readonly blocked: boolean;
  /** Blocking finding categories observed (labels only — sanitized by construction). */
  readonly blockedCategories: readonly string[];
}

export function createScreenedWriter(
  sink: (line: string) => void,
  screener: SecurityScreener,
): WriterPort {
  const categories: string[] = [];
  return {
    write(line: string): void {
      const screening = screener.screen(line);
      if (screening.blocked.length > 0) {
        categories.push(...screening.blocked);
        // Blocked content never propagates; the notice names categories only.
        sink(`[output blocked by security screening: ${screening.blocked.join(", ")}]`);
        return;
      }
      sink(screening.output);
    },
    get blocked(): boolean {
      return categories.length > 0;
    },
    get blockedCategories(): readonly string[] {
      return categories;
    },
  };
}

/** Collapse a possibly multi-line message to one stderr line (never a stack trace). */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
