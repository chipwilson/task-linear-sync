/**
 * T004 — seeded deterministic corpus generator for 006 property tests (research R7).
 * Hand-rolled xorshift32 PRNG with constant seeds — no new dependencies, no
 * `Math.random`, no wall clock (constitution IV/VI: hermetic, reproducible failures).
 *
 * Generators:
 * - `generateCorpus` / `mutateCorpus` — the SC-001 fixture shape: 100 tasks with
 *   "renames, moves, and checkbox flips", durable attachments injected at configured rates.
 * - `generatePairMatrices` + `bruteForceOptimum` — exhaustive ≤8×8 small-case oracle
 *   enumerating all injective partial assignments (SC-003).
 * - `shuffle` — Fisher–Yates input-shuffle helpers for permutation-invariance tests (SC-002).
 *
 * Candidate records are structurally identical to `MatchCandidate` (data-model §2) but
 * intentionally NOT imported from `task-linear-sync/matching`: this helper compiles at
 * the Setup checkpoint before the module's vocabulary exists, and stays a plain data
 * source afterwards (structural typing carries them into the API).
 */
import type { FrameworkId, RoutingResolution, Task } from "task-linear-sync/domain";

// ── seeded PRNG (xorshift32) ─────────────────────────────────────────────────────

/** xorshift32 stream (research R7): deterministic for a constant seed, never zero-state. */
export function xorshift32(seed: number): () => number {
  let s = seed >>> 0;
  if (s === 0) s = 0x9e3779b9;
  return () => {
    s ^= (s << 13) >>> 0;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s;
  };
}

export interface Rng {
  /** Integer in [0, maxExclusive). */
  nextInt(maxExclusive: number): number;
  /** True with probability p (deterministic draw). */
  bool(p: number): boolean;
  pick<T>(items: readonly T[]): T;
  stream(): () => number;
}

export function makeRng(seed: number): Rng {
  const f = xorshift32(seed);
  return {
    nextInt: (maxExclusive) => f() % maxExclusive,
    bool: (p) => f() / 0x1_0000_0000 < p,
    pick: <T>(items: readonly T[]): T => {
      const value = items[f() % items.length];
      if (value === undefined) throw new Error("Rng.pick: empty items");
      return value;
    },
    stream: () => f,
  };
}

/** Fisher–Yates shuffle (seeded): permutation helper for SC-002 invariance tests. */
export function shuffle<T>(items: readonly T[], seed: number): T[] {
  const f = xorshift32(seed);
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = f() % (i + 1);
    const tmp = out[i] as T;
    out[i] = out[j] as T;
    out[j] = tmp;
  }
  return out;
}

/** Fixed test UUIDv4-shaped constant from the PRNG stream (placeholder identity only). */
export function uuidFrom(rng: Rng): string {
  const f = rng.stream();
  const hex = (n: number): string =>
    Array.from({ length: n }, () => (f() % 16).toString(16)).join("");
  return `${hex(8)}-${hex(4)}-4${hex(3)}-8${hex(3)}-${hex(12)}`;
}

/** Deterministic UUIDv4-shaped constant (constant seed → constant uuid). */
export function fixedUuid(seed: number): string {
  return uuidFrom(makeRng(seed));
}

// ── corpus shapes (structural twins of data-model §1–§2) ─────────────────────────

export interface CorpusInput {
  readonly task: Task;
  readonly routing?: RoutingResolution;
}

export interface CorpusCandidate {
  readonly issueId: string;
  readonly issueKey: string;
  readonly teamKey: string;
  readonly projectRef: string;
  readonly title: string;
  readonly durableTaskUuid?: string;
  readonly frameworkId?: FrameworkId;
  readonly featureName?: string;
  readonly filePath?: string;
  readonly localTaskId?: string;
}

export interface Corpus {
  readonly inputs: readonly CorpusInput[];
  readonly candidates: readonly CorpusCandidate[];
  /** taskUuid → the issueId constructed as its correct pairing (SC-001 truth). */
  readonly truth: ReadonlyMap<string, string>;
  /** taskUuids whose true issue carries the durable identity anchor. */
  readonly durableTaskUuids: ReadonlySet<string>;
}

const WORDS = [
  "alpha",
  "bravo",
  "cache",
  "delta",
  "engine",
  "form",
  "gateway",
  "hash",
  "index",
  "journal",
  "queue",
  "report",
  "sync",
  "token",
  "vault",
] as const;

const TEAMS = ["acme-team", "glob-team", "initeam"] as const;
const PROJECTS = ["proj-alpha", "proj-beta", "proj-gamma"] as const;
const FRAMEWORKS: readonly FrameworkId[] = ["spec-kit", "kiro", "open-spec", "bmad", "generic"];

function titleWords(rng: Rng, uniqueToken: string): string {
  const n = 2 + rng.nextInt(3);
  const words: string[] = [];
  for (let i = 0; i < n; i += 1) words.push(rng.pick(WORDS));
  words.push(`tk${uniqueToken}`); // guarantees cross-corpus title uniqueness
  return words.join(" ");
}

function baseTask(uuid: string, title: string, frameworkId: FrameworkId, over: Partial<Task>): Task {
  return {
    stableUuid: uuid,
    kind: "checklist",
    filePath: "specs/demo-feature/tasks.md",
    lineNumber: 10,
    frameworkId,
    title,
    checked: false,
    childUuids: [],
    taskBody: { startLine: 10, endLine: 12 },
    unresolvedConflict: false,
    ...over,
  };
}

export interface CorpusOptions {
  readonly tasks: number;
  /** Additional non-true decoy issues (default 0). */
  readonly extraIssues?: number;
  /** Probability a true candidate carries the durable page-0 identity (default 0.5). */
  readonly durableRate?: number;
  /** Probability a non-durable true pair keeps a stable issue reference (default 0.3). */
  readonly refRate?: number;
  readonly seed: number;
}

/**
 * Build a task↔issue corpus whose `truth` mapping is correct-by-construction:
 * durable pairs anchor on the uuid; reference pairs anchor on the `[SYNC-N]`↔`KEY-N`
 * suffix (weight 500 ⇒ dominant); everything else leans on title/container signals.
 */
export function generateCorpus(options: CorpusOptions): Corpus {
  const rng = makeRng(options.seed);
  const extraIssues = options.extraIssues ?? 0;
  const durableRate = options.durableRate ?? 0.5;
  const refRate = options.refRate ?? 0.3;

  const inputs: CorpusInput[] = [];
  const candidates: CorpusCandidate[] = [];
  const truth = new Map<string, string>();
  const durableTaskUuids = new Set<string>();

  for (let i = 0; i < options.tasks; i += 1) {
    const uuid = uuidFrom(rng);
    const teamKey = rng.pick(TEAMS);
    const project = rng.pick(PROJECTS);
    const frameworkId = rng.pick(FRAMEWORKS);
    const title = titleWords(rng, String(i));
    const durable = rng.bool(durableRate);
    const refNumber = durable && rng.bool(0.15) ? 5000 + i : 1000 + i;
    const withRef = durable ? refNumber === 5000 + i : rng.bool(refRate);
    const localTaskId = rng.bool(0.25) ? `Task 1.${i + 1}` : undefined;

    const routing: RoutingResolution = { teamKey, project, defaulted: false };
    const task = baseTask(uuid, title, frameworkId, {
      ...(withRef ? { issueRef: { key: "SYNC", number: refNumber } } : {}),
      ...(localTaskId !== undefined ? { localTaskId } : {}),
    });
    inputs.push({ task, routing });

    const candidate: CorpusCandidate = {
      issueId: `i-${String(i).padStart(4, "0")}`,
      issueKey: `${teamKey.slice(0, 3).toUpperCase()}-${refNumber}`,
      teamKey,
      projectRef: project,
      title,
      frameworkId,
      filePath: "specs/demo-feature/tasks.md",
      ...(durable ? { durableTaskUuid: uuid } : {}),
      ...(localTaskId !== undefined ? { localTaskId } : {}),
    };
    candidates.push(candidate);
    truth.set(uuid, candidate.issueId);
    if (durable) durableTaskUuids.add(uuid);
  }

  for (let d = 0; d < extraIssues; d += 1) {
    candidates.push({
      issueId: `d-${String(d).padStart(4, "0")}`,
      issueKey: `DECOY-${9000 + d}`,
      teamKey: rng.pick(TEAMS),
      projectRef: rng.pick(PROJECTS),
      title: titleWords(rng, `decoy${d}`),
      frameworkId: rng.pick(FRAMEWORKS),
    });
  }

  candidates.sort((a, b) => (a.issueId < b.issueId ? -1 : a.issueId > b.issueId ? 1 : 0));
  return { inputs, candidates, truth, durableTaskUuids };
}

export interface MutationOptions {
  /** Rename (Linear-side title rewrite) every true candidate. */
  readonly renameTitles: boolean;
  /** Move durable candidates across teams/projects/frameworks. */
  readonly moveContainers: boolean;
  /** Flip `checked` on a share of tasks (field excluded from identity — 002 posture). */
  readonly flipCheckboxes: boolean;
}

/**
 * SC-001 re-run inputs: "renames, moves, and checkbox flips" applied while identity is
 * preserved — issue ids, issue keys, durable uuids, and task stable uuids are untouched.
 */
export function mutateCorpus(corpus: Corpus, seed: number, options: MutationOptions): Corpus {
  const rng = makeRng(seed);
  const inputs: CorpusInput[] = corpus.inputs.map((input) =>
    options.flipCheckboxes && rng.bool(0.5)
      ? { ...input, task: { ...input.task, checked: !input.task.checked } }
      : input,
  );
  const candidates: CorpusCandidate[] = corpus.candidates.map((candidate) => {
    const durable = candidate.durableTaskUuid !== undefined;
    const renamed = options.renameTitles && !candidate.issueKey.startsWith("DECOY");
    const moved = options.moveContainers && durable;
    if (!renamed && !moved) return candidate;
    const movedTeam = moved ? rng.pick(TEAMS.filter((t) => t !== candidate.teamKey)) : candidate.teamKey;
    const movedProject = moved
      ? rng.pick(PROJECTS.filter((p) => p !== candidate.projectRef))
      : candidate.projectRef;
    const movedFramework = moved
      ? rng.pick(FRAMEWORKS.filter((f) => f !== candidate.frameworkId))
      : candidate.frameworkId;
    return {
      ...candidate,
      // Rename EXEMPLAR mirrors the committed `moved/` fixture ("Vault token rotation —
      // refreshed"): Linear rewrites are token-preserving edits, not total replacements —
      // a complete replacement would delete the pairing's only remaining evidence, which
      // no scoring contract could recover.
      ...(renamed ? { title: `${candidate.title} — re-synced` } : {}),
      ...(moved ? { teamKey: movedTeam, projectRef: movedProject, frameworkId: movedFramework } : {}),
    };
  });
  return { inputs, candidates, truth: corpus.truth, durableTaskUuids: corpus.durableTaskUuids };
}

// ── SC-003: small-case matrices + brute-force oracle ──────────────────────────────

export interface PairMatrixCase {
  readonly rowIds: readonly string[];
  readonly colIds: readonly string[];
  /** weights[r][c] = usable pair score, or null for a non-usable (gated/below-plausible) cell. */
  readonly weights: ReadonlyArray<ReadonlyArray<number | null>>;
}

/** Randomized ≤8×8 usable-cell matrices (SC-003 "exhaustive small-case fixtures"). */
export function generatePairMatrices(
  seed: number,
  cases: number,
  maxSide = 8,
): PairMatrixCase[] {
  const rng = makeRng(seed);
  const out: PairMatrixCase[] = [];
  for (let k = 0; k < cases; k += 1) {
    const rows = 1 + rng.nextInt(maxSide);
    const cols = 1 + rng.nextInt(maxSide);
    const density = rng.nextInt(100);
    const weights: (number | null)[][] = [];
    for (let r = 0; r < rows; r += 1) {
      const row: (number | null)[] = [];
      for (let c = 0; c < cols; c += 1) {
        row.push(rng.nextInt(100) < density ? 18 + rng.nextInt(400) : null);
      }
      weights.push(row);
    }
    out.push({
      rowIds: Array.from({ length: rows }, (_, r) => `t-${fixedUuid(1000 + k * 31 + r)}`),
      colIds: Array.from({ length: cols }, (_, c) => `i-${String(c).padStart(4, "0")}`),
      weights,
    });
  }
  return out;
}

/**
 * Brute-force oracle: maximum total weight over ALL injective partial assignments of
 * usable cells (each row ≤ 1 col, each col ≤ 1 row). Exact DP over (row, used-mask) —
 * fine at ≤8×8 (SC-003). Null cells are skipped, never taken.
 */
export function bruteForceOptimum(weights: ReadonlyArray<ReadonlyArray<number | null>>): number {
  const rows = weights.length;
  if (rows === 0) return 0;
  const cols = weights[0]?.length ?? 0;
  const memo = new Map<string, number>();

  const solve = (r: number, mask: number): number => {
    if (r >= rows) return 0;
    const key = `${r}|${mask}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let best = solve(r + 1, mask); // leave row r unmatched
    for (let c = 0; c < cols; c += 1) {
      if (mask & (1 << c)) continue;
      const w = weights[r]?.[c];
      if (w === null || w === undefined) continue;
      const total = w + solve(r + 1, mask | (1 << c));
      if (total > best) best = total;
    }
    memo.set(key, best);
    return best;
  };
  return solve(0, 0);
}
