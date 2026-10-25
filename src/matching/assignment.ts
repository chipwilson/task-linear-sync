/**
 * T025 [US1] — FR-004 maximum-weight one-to-one assignment (research R4).
 * "Solve a maximum-weight one-to-one assignment (each task at most one issue, each
 * issue at most one task), selecting deterministically among equally optimal solutions
 * so unchanged inputs reproduce matches byte-for-byte."
 *
 * Jonker–Volgenant shortest-augmenting-path Hungarian variant over INTEGER weights on
 * the square matrix (`n = max(|tasks|, |issues|)`):
 *  - non-usable cells carry weight 0 — the SAME weight as the dummy rows/columns, so a
 *    perfect assignment of the padded square problem maximizes the total weight of the
 *    USEABLE pairs chosen (usable totals are integers ≥ plausible ≥ 1 > 0, so the solver
 *    only takes a 0 cell where an injective partial assignment would simply stop);
 *  - dummy rows/columns carry weight 0 — exactly "leave this task unmatched / this
 *    issue unmapped" — which is what makes partial injective optima (SC-003 oracle)
 *    reachable even when more rows than `n − m` prefer to be unmatched;
 *  - inputs are pre-sorted canonically (tasks by `stableUuid`, issues by `issueId`);
 *    augmentation tie-breaks prefer the lowest canonical row index then column index
 *    (strict `<` comparisons);
 *  - a post-solve canonical pass replaces the found optimum with the
 *    lexicographically-smallest optimal matching (rows in canonical order taking the
 *    smallest feasible zero-reduced-cost column), restricted to zero-reduced-cost
 *    equal-optimum moves — provably the same optimum under any input permutation.
 *
 * Deviation note (contracts/confidence-scoring.md §3 / research R4 wording, "forbidden
 * sentinels for excluded cells"): a sentinel makes the PERFECT square assignment demand
 * that every real row take a REAL column, so whenever `t == m` — or more rows than the
 * available `n − m` dummies want to be unmatched — the partial-injective optima that
 * FR-004/SC-003 require (e.g. the ≥100-fixture oracle sweep) become unreachable. Weight-
 * 0 excluded cells are the standard LAP reduction of the partial problem to the perfect
 * one; every BEHAVIORAL clause still holds: excluded pairs are never selected (they are
 * filtered out when the solution is read back), dummies mean "unmatched", and the
 * achieved usable total provably equals the brute-force partial optimum.
 */
import type { PairScore } from "./types.js";

/**
 * Weight of a cell the solver treats as "not a real pairing" (non-usable pair, dummy
 * row/column). Usable pair totals are integers ≥ `confidenceFloors.plausible` ≥ 1, so a
 * 0 cell is taken exactly where an injective PARTIAL assignment would leave both sides
 * unmatched — making the partial optima of the SC-003 oracle reachable in the perfect
 * square assignment (a forbidden sentinel would force surplus rows onto real columns).
 */
const UNMATCHED_WEIGHT = 0;

interface SquareWeights {
  readonly n: number;
  /** cost[r][c] = maxWeight - weight[r][c] (non-negative integers). */
  readonly cost: number[][];
  /** weight[r][c] for real cells (dummy cells are 0). */
  readonly weight: number[][];
}

/**
 * JV shortest-augmenting-path Hungarian LAP (min-cost over integer costs).
 * Returns the column assigned to each row plus the dual potentials (u, v) whose
 * zero-reduced-cost graph contains every optimal matching.
 */
function hungarian(cost: readonly number[][]): { colOf: number[]; u: number[]; v: number[] } {
  const n = cost.length;
  const INF = Number.MAX_SAFE_INTEGER;
  const u = new Array<number>(n).fill(0);
  const v = new Array<number>(n).fill(0);
  const p = new Array<number>(n + 1).fill(-1); // p[j] = row matched to column j; slot n = sentinel
  const way = new Array<number>(n + 1).fill(0);

  for (let i = 0; i < n; i += 1) {
    p[n] = i;
    let j0 = n;
    const minv = new Array<number>(n + 1).fill(INF);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = INF;
      let j1 = -1;
      for (let j = 0; j < n; j += 1) {
        if (used[j]) continue;
        const cur = cost[i0]![j]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j += 1) {
        if (used[j]) {
          u[p[j]!] = u[p[j]!]! + delta;
          v[j] = v[j]! - delta;
        } else {
          minv[j] = minv[j]! - delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== -1);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1];
      j0 = j1;
    } while (j0 !== n);
  }

  const colOf = new Array<number>(n).fill(-1);
  for (let j = 0; j < n; j += 1) {
    const row = p[j]!;
    if (row !== -1) colOf[row] = j;
  }
  return { colOf, u, v };
}

/**
 * Canonical pass (research R4): among the zero-reduced-cost optimal matchings, walk
 * rows in canonical order and take the smallest column that still admits a perfect
 * matching of the remaining subproblem — an exact greedy with a Berge alternating-path
 * feasibility oracle, yielding the lexicographically-smallest optimal assignment.
 * Locked rows (< i) are never disturbed.
 */
function canonicalize(
  colOfIn: readonly number[],
  cost: readonly number[][],
  u: readonly number[],
  v: readonly number[],
): number[] {
  const n = colOfIn.length;
  const colOf = [...colOfIn];
  const rowOf = new Array<number>(n).fill(-1);
  for (let r = 0; r < n; r += 1) rowOf[colOf[r]!] = r;

  const zero = (r: number, c: number): boolean => cost[r]![c]! - u[r]! - v[c]! === 0;

  for (let i = 0; i < n; i += 1) {
    const d = colOf[i]!;
    // Candidates strictly smaller than the current column (current is trivially feasible).
    for (let c = 0; c < d; c += 1) {
      if (rowOf[c]! < i) continue; // column locked to an already-canonicalized row
      if (!zero(i, c)) continue; // equal-optimum moves only
      const k = rowOf[c]!; // row displaced by fixing i → c (k ≥ i+1, since c ≠ d)

      // Berge oracle: alternating path from the unmatched row k to the free column d
      // over zero-reduced-cost edges, avoiding locked rows/columns.
      colOf[i] = c;
      rowOf[c] = i;
      rowOf[d] = -1;
      const parentRow = new Map<number, number>(); // displaced row → row that displaced it
      const queue: number[] = [k];
      const seen = new Set<number>([k]);
      let reached = -1;
      while (queue.length > 0 && reached === -1) {
        const r = queue.shift()!;
        for (let j = 0; j < n; j += 1) {
          if (!zero(r, j)) continue; // equal-optimum moves only
          if (j === d) {
            reached = r;
            break;
          }
          const owner = rowOf[j]!;
          if (owner < i + 1 || seen.has(owner)) continue;
          seen.add(owner);
          parentRow.set(owner, r);
          queue.push(owner);
        }
      }

      if (reached === -1) {
        // Infeasible: restore and try the next candidate column.
        colOf[i] = d;
        rowOf[d] = i;
        colOf[k] = c;
        rowOf[c] = k;
        continue;
      }

      // Flip the augmenting path: `reached` takes d, its displacer backfills, …, k fills in.
      let curRow = reached;
      let col = d;
      for (;;) {
        const vacated = colOf[curRow]!;
        colOf[curRow] = col;
        rowOf[col] = curRow;
        const parent = parentRow.get(curRow);
        if (parent === undefined) break;
        col = vacated;
        curRow = parent;
      }
      break; // row i now holds its smallest feasible column — lock it
    }
  }
  return colOf;
}

/**
 * Solve the maximum-weight one-to-one assignment over usable pairs.
 * Returns the selected pairs in canonical task order (tasks by `stableUuid`);
 * tasks/issues with no usable cell are simply absent (dummy 0-weight semantics —
 * the orchestrator bands them as `unresolved`).
 */
export function assignUsable(pairs: readonly PairScore[]): PairScore[] {
  const usable = pairs.filter((p) => p.usable);
  if (usable.length === 0) return [];

  const taskUuids = [...new Set(usable.map((p) => p.taskUuid))].sort();
  const issueIds = [...new Set(usable.map((p) => p.issueId))].sort();
  const t = taskUuids.length;
  const m = issueIds.length;
  const n = Math.max(t, m);

  const pairAt = new Map<string, PairScore>();
  for (const p of usable) pairAt.set(`${p.taskUuid}\u0000${p.issueId}`, p);

  let maxWeight = 0;
  const weight: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(UNMATCHED_WEIGHT));
  for (let r = 0; r < t; r += 1) {
    const taskUuid = taskUuids[r]!;
    for (let c = 0; c < m; c += 1) {
      const pair = pairAt.get(`${taskUuid}\u0000${issueIds[c]!}`);
      const w = pair === undefined ? UNMATCHED_WEIGHT : pair.total;
      weight[r]![c] = w;
      if (w > maxWeight) maxWeight = w;
    }
  }
  // Dummy rows/columns stay weight 0: "leave this task unmatched / this issue unmapped".
  const cost = Array.from({ length: n }, (_, r) =>
    Array.from({ length: n }, (_, c) => maxWeight - weight[r]![c]!),
  );

  const square: SquareWeights = { n, cost, weight };
  const { colOf: rawColOf, u, v } = hungarian(square.cost);
  const colOf = canonicalize(rawColOf, square.cost, u, v);

  const selected: PairScore[] = [];
  for (let r = 0; r < t; r += 1) {
    const c = colOf[r]!;
    if (c < 0 || c >= m) continue; // dummy column ⇒ unresolved task
    const pair = pairAt.get(`${taskUuids[r]!}\u0000${issueIds[c]!}`);
    if (pair === undefined) continue; // 0-weight filler cell ⇒ "unmatched" semantics
    selected.push(pair);
  }
  return selected; // rows iterated in canonical task order
}
