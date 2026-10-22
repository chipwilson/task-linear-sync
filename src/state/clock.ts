/**
 * Injectable clock (research R16). Every time-based decision (manifest expiry, lock age,
 * event timestamps, marker completion) takes the clock as a parameter rather than calling
 * Date.now()/new Date() internally — Principle IV/VI determinism.
 */
export interface Clock {
  /** Current wall-clock time as a Date. */
  now(): Date;
  /** Milliseconds elapsed since the given ISO-8601 instant per this clock. */
  elapsed(sinceIso: string): number;
}

/** Default: system time. Tests inject fixed/fake clocks. */
export const systemClock: Clock = {
  now(): Date {
    return new Date();
  },
  elapsed(sinceIso: string): number {
    return Date.now() - Date.parse(sinceIso);
  },
};

/** Build a deterministic clock fixed at `at` (elapsed computed against the same instant). */
export function fixedClock(at: Date): Clock {
  const ms = at.getTime();
  return {
    now(): Date {
      return new Date(ms);
    },
    elapsed(sinceIso: string): number {
      return ms - Date.parse(sinceIso);
    },
  };
}
