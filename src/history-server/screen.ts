/**
 * Browser-text screening helpers (T018; FR-008, contracts/history-reconstruction.md §4).
 *
 * Every browser-visible string — event descriptions, references, and even
 * the synthetic `atHuman` line — passes `screener.screen()` before it enters
 * a view, and passes HTML escaping before it enters HTML. A blocking finding
 * ships ONLY the `[blocked:<category>]` sentinel (the source text never
 * travels); a throwing screener fails closed the same way. Screening never
 * fails a request.
 */

import type { SecurityScreener } from "../ports/engine.js";

/** Full replacement on any blocking finding (category label only, R-posture). */
export function screenBrowserText(screener: SecurityScreener, text: string): string {
  let outcome: ReturnType<SecurityScreener["screen"]>;
  try {
    outcome = screener.screen(text);
  } catch {
    return "[blocked:screening-unavailable]";
  }
  if (outcome.blocked.length > 0) {
    return `[blocked:${outcome.blocked[0]}]`;
  }
  return outcome.output;
}

/** Total escape of the five markup-significant characters. */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

/**
 * `YYYY-MM-DD HH:MM:SS UTC` by UTC arithmetic (no locale, no Intl). An
 * unparseable instant degrades to a fixed marker — deterministic, never a
 * throw, and it never echoes the malformed input.
 */
export function formatAtHuman(at: string): string {
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) {
    return "unknown time";
  }
  const d = new Date(ms);
  return (
    `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`
  );
}
