/** Shared test helpers (not compiled into the shipped package; tsconfig rootDir keeps tests out of dist). */

/** Deterministic injected clock (research R16) — tests control time, never sleep. */
export class FakeClock {
  private currentMs: number;

  constructor(startIso: string) {
    this.currentMs = Date.parse(startIso);
  }

  now(): Date {
    return new Date(this.currentMs);
  }

  elapsed(sinceIso: string): number {
    return this.currentMs - Date.parse(sinceIso);
  }

  advanceMs(ms: number): void {
    this.currentMs += ms;
  }

  advanceDays(days: number): void {
    this.advanceMs(days * 86_400_000);
  }

  iso(): string {
    return new Date(this.currentMs).toISOString();
  }
}

/** Screened-text test screener implementing the SecurityScreener shape. */
export function makeScreener(): {
  screen(text: string): { output: string; blocked: readonly string[]; findings: readonly string[] };
} {
  return {
    screen(text: string) {
      const findings: string[] = [];
      let output = text;
      if (/SECRET\d+/.test(output)) {
        findings.push("secret-redacted");
        output = output.replace(/SECRET\d+/g, "[REDACTED]");
      }
      const blocked: string[] = [];
      if (/BLOCKED/.test(output)) {
        blocked.push("blocking-secret");
      }
      return { output, blocked, findings };
    },
  };
}
