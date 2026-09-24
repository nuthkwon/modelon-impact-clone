/**
 * Bipartite matching (Hopcroft–Karp) between equations and unknowns, BLT sorting (Tarjan's
 * strongly connected components over the matched dependency graph) and incidence helpers for
 * flat models.
 */
import type { Expr } from '../../ast.js';
import type { FlatModel } from '../../flat.js';
import { incidence } from './expr.js';

// -------------------------------------------------------------------------------------------
// Maximum matching
// -------------------------------------------------------------------------------------------

export interface Matching {
  /** Equation (left vertex) -> variable (right vertex), or -1. */
  leftToRight: Int32Array;
  /** Variable -> equation, or -1. */
  rightToLeft: Int32Array;
  /** Number of matched pairs. */
  size: number;
}

/**
 * Maximum cardinality matching of a bipartite graph with `nLeft` left vertices whose
 * adjacency lists (`adj[i]`, right vertex indices < nRight) are given. Hopcroft–Karp,
 * O(E sqrt(V)).
 */
export function maximumMatching(nLeft: number, nRight: number, adj: ReadonlyArray<ReadonlyArray<number>>): Matching {
  const leftToRight = new Int32Array(nLeft).fill(-1);
  const rightToLeft = new Int32Array(nRight).fill(-1);
  const dist = new Int32Array(nLeft);
  const queue = new Int32Array(nLeft);
  const INF = 0x3fffffff;
  let size = 0;

  const bfs = (): boolean => {
    let head = 0;
    let tail = 0;
    let found = false;
    for (let u = 0; u < nLeft; u++) {
      if (leftToRight[u] === -1) {
        dist[u] = 0;
        queue[tail++] = u;
      } else dist[u] = INF;
    }
    while (head < tail) {
      const u = queue[head++];
      for (const v of adj[u]) {
        const w = rightToLeft[v];
        if (w === -1) found = true;
        else if (dist[w] === INF) {
          dist[w] = dist[u] + 1;
          queue[tail++] = w;
        }
      }
    }
    return found;
  };

  const dfs = (u: number): boolean => {
    for (const v of adj[u]) {
      const w = rightToLeft[v];
      if (w === -1 || (dist[w] === dist[u] + 1 && dfs(w))) {
        leftToRight[u] = v;
        rightToLeft[v] = u;
        return true;
      }
    }
    dist[u] = INF;
    return false;
  };

  // Greedy initialisation speeds up the phases considerably on near-diagonal systems.
  for (let u = 0; u < nLeft; u++) {
    for (const v of adj[u]) {
      if (rightToLeft[v] === -1) {
        leftToRight[u] = v;
        rightToLeft[v] = u;
        size++;
        break;
      }
    }
  }
  while (bfs()) {
    for (let u = 0; u < nLeft; u++) {
      if (leftToRight[u] === -1 && dfs(u)) size++;
    }
  }
  return { leftToRight, rightToLeft, size };
}

/** True if every left vertex can be matched (a perfect matching of the left side exists). */
export function hasPerfectMatching(nLeft: number, nRight: number, adj: ReadonlyArray<ReadonlyArray<number>>): boolean {
  return maximumMatching(nLeft, nRight, adj).size === nLeft;
}

// -------------------------------------------------------------------------------------------
// BLT sorting
// -------------------------------------------------------------------------------------------

/** One block of the BLT form: equations and the variables matched to them (same length). */
export interface BltBlock {
  equations: number[];
  variables: number[];
}

/**
 * Sorts a perfectly matched system into blocks (strongly connected components of the graph
 * "equation i depends on equation j when i contains the variable matched to j"), in an order
 * in which every block only depends on earlier blocks. Tarjan's algorithm, iterative.
 */
export function bltSort(nEq: number, adj: ReadonlyArray<ReadonlyArray<number>>, matching: Matching): BltBlock[] {
  const index = new Int32Array(nEq).fill(-1);
  const low = new Int32Array(nEq);
  const onStack = new Uint8Array(nEq);
  const stack: number[] = [];
  const blocks: BltBlock[] = [];
  let counter = 0;

  // Dependency edges: i -> owner of each variable in i (excluding i itself).
  const deps: number[][] = new Array(nEq);
  for (let i = 0; i < nEq; i++) {
    const d: number[] = [];
    for (const v of adj[i]) {
      const j = matching.rightToLeft[v];
      if (j >= 0 && j !== i) d.push(j);
    }
    deps[i] = d;
  }

  const strongConnect = (root: number): void => {
    // Iterative DFS with an explicit call stack of (node, next edge position).
    const call: { node: number; pos: number }[] = [{ node: root, pos: 0 }];
    index[root] = low[root] = counter++;
    stack.push(root);
    onStack[root] = 1;
    while (call.length) {
      const frame = call[call.length - 1];
      const u = frame.node;
      if (frame.pos < deps[u].length) {
        const w = deps[u][frame.pos++];
        if (index[w] === -1) {
          index[w] = low[w] = counter++;
          stack.push(w);
          onStack[w] = 1;
          call.push({ node: w, pos: 0 });
        } else if (onStack[w]) {
          if (index[w] < low[u]) low[u] = index[w];
        }
      } else {
        call.pop();
        if (call.length) {
          const parent = call[call.length - 1].node;
          if (low[u] < low[parent]) low[parent] = low[u];
        }
        if (low[u] === index[u]) {
          const eqs: number[] = [];
          for (;;) {
            const w = stack.pop()!;
            onStack[w] = 0;
            eqs.push(w);
            if (w === u) break;
          }
          eqs.sort((a, b) => a - b);
          blocks.push({ equations: eqs, variables: eqs.map((e) => matching.leftToRight[e]) });
        }
      }
    }
  };
  for (let i = 0; i < nEq; i++) if (index[i] === -1) strongConnect(i);
  return blocks;
}

// -------------------------------------------------------------------------------------------
// Flat-model incidence
// -------------------------------------------------------------------------------------------

/** Structural description of a flat model's continuous equations against its highest-order unknowns. */
export interface StructuralSystem {
  /** Unknown names in column order (`der(x)` for states, the variable itself otherwise). */
  unknowns: string[];
  /** Equation index -> incident unknown columns. */
  adjacency: number[][];
  matching: Matching;
}

/**
 * Builds the incidence of `flat.equations` against the "highest-order unknowns": for a state
 * `x` (a variable appearing in `der(x)`) the unknown is `der(x)`, every other unknown is
 * itself. `isUnknown` decides which variables count (parameters, constants and when-assigned
 * discretes do not), `states` names the state variables.
 */
export function analyzeStructure(flat: FlatModel, isUnknown: (name: string) => boolean, states: ReadonlySet<string>): StructuralSystem {
  const columns = new Map<string, number>();
  const unknowns: string[] = [];
  for (const v of flat.variables) {
    if (!isUnknown(v.name)) continue;
    const name = states.has(v.name) ? `der(${v.name})` : v.name;
    columns.set(name, unknowns.length);
    unknowns.push(name);
  }
  const adjacency = flat.equations.map((eq) => {
    const inc = incidence(eq.left, isUnknown);
    incidence(eq.right, isUnknown, inc);
    const cols: number[] = [];
    for (const [base, order] of inc) {
      const isState = states.has(base);
      const key = isState ? `der(${base})` : base;
      if (isState && order < 1) continue; // the state itself is known
      const c = columns.get(key);
      if (c !== undefined) cols.push(c);
    }
    return cols;
  });
  const matching = maximumMatching(adjacency.length, unknowns.length, adjacency);
  return { unknowns, adjacency, matching };
}

/** Incidence columns of one expression pair against an explicit column map (order 0 or 1 symbols). */
export function incidenceColumns(left: Expr, right: Expr, isUnknown: (name: string) => boolean, column: (base: string, order: number) => number | undefined): number[] {
  const inc = incidence(left, isUnknown);
  incidence(right, isUnknown, inc);
  const cols = new Set<number>();
  for (const [base, order] of inc) {
    for (let o = 0; o <= order; o++) {
      const c = column(base, o);
      if (c !== undefined) cols.add(c);
    }
  }
  return [...cols];
}
