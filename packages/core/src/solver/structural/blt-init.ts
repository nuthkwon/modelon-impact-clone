/**
 * Block-wise initialisation. The initial system (equations + initial equations, unknowns =
 * algebraics, derivatives and free states) is matched and sorted into BLT blocks; blocks are
 * solved in dependency order: 1x1 blocks by a safeguarded scalar Newton/secant iteration
 * (exact after one step for linear equations), larger blocks by the damped Newton of
 * `newton.ts`. Because every block only involves unknowns that earlier blocks already fixed,
 * bilinear equations such as `v = R_actual * i` with both factors starting at 0 are no longer
 * a problem: `R_actual` is solved first and the equation becomes linear in `i`.
 */
import type { CompiledModel, UnknownInfo } from '../compile.js';
import { JacobianCache, newtonSolve, type NewtonProblem, type NewtonResult } from '../newton.js';
import type { System } from '../system.js';
import { bltSort, incidenceColumns, maximumMatching, type BltBlock } from './matching.js';

const INIT_RTOL = 1e-10;
const INIT_RELAXED = 1e3;
const SQRT_EPS = 1.4901161193847656e-8;

export interface InitializationBlt {
  /** Unknown count: nA algebraics, nS derivatives, then the free states. */
  n: number;
  blocks: BltBlock[];
  /** Largest block size. */
  maxBlock: number;
}

/**
 * Builds the BLT decomposition of the initialisation problem. Returns undefined when the
 * structural matching is not perfect (the caller then falls back to the simultaneous solve).
 */
export function analyzeInitialization(m: CompiledModel, free: UnknownInfo[]): InitializationBlt | undefined {
  const nS = m.nS;
  const nA = m.nA;
  const n = nA + nS + free.length;
  const nEq = m.residuals.length + m.initialResiduals.length;
  if (n !== nEq) return undefined;
  const freePos = new Map<number, number>();
  free.forEach((u, j) => freePos.set(u.index, j));
  const column = (base: string, order: number): number | undefined => {
    const idx = m.index.get(base);
    if (idx === undefined) return undefined;
    const u = m.unknowns[idx];
    if (order === 0) {
      if (u.kind === 'algebraic') return idx - nS;
      if (u.kind === 'state') {
        const p = freePos.get(idx);
        return p === undefined ? undefined : nA + nS + p;
      }
      return undefined;
    }
    if (order === 1 && u.kind === 'state') return nA + idx;
    return undefined;
  };
  const isUnknown = (name: string): boolean => m.index.has(name);
  const adjacency: number[][] = [];
  const dependencies: number[][] = [];
  for (const eq of [...m.flat.equations, ...m.flat.initialEquations]) {
    adjacency.push(incidenceColumns(eq.left, eq.right, isUnknown, column));
    dependencies.push(incidenceColumns(eq.left, eq.right, isUnknown, column, true));
  }
  const matching = maximumMatching(nEq, n, adjacency);
  if (matching.size !== n) return undefined;
  // Blocks are ordered by all dependencies, including variables that only appear in
  // if-conditions/relations (they must be known before the block is solved).
  const blocks = bltSort(nEq, dependencies, matching);
  return { n, blocks, maxBlock: blocks.reduce((mx, b) => Math.max(mx, b.equations.length), 0) };
}

export interface BlockwiseResult extends NewtonResult {
  /** Description of the block that failed, if any. */
  failedBlock?: string;
}

/**
 * Solves the initialisation problem block by block. `problem` is the full initialisation
 * Newton problem (its `residual` writes `z` into the system and evaluates every equation);
 * `z` is updated in place with the solution.
 */
export function solveInitializationBlockwise(sys: System, blt: InitializationBlt, problem: NewtonProblem, z: Float64Array, freeStates: readonly number[]): BlockwiseResult {
  const m = sys.m;
  const ctx = sys.ctx;
  const nS = sys.nS;
  const nA = sys.nA;
  const nEq = m.residuals.length;
  const n = blt.n;
  const freeStart = nA + nS;
  const full = new Float64Array(n);
  let iterations = 0;
  let jacobians = 0;

  // Write all of z into the context once, then update individual entries as blocks are solved.
  problem.residual(z, full);
  const setZ = (j: number, value: number): void => {
    z[j] = value;
    if (j < nA) ctx.v[nS + j] = value;
    else if (j < freeStart) ctx.dv[j - nA] = value;
    else ctx.v[freeStates[j - freeStart]] = value;
  };
  const residualAt = (i: number): number => (i < nEq ? m.residuals[i].fn(ctx) : m.initialResiduals[i - nEq].fn(ctx));
  const describe = (b: BltBlock): string => b.equations.map((i) => `'${sys.equationName(i)}'`).join(', ');

  for (const block of blt.blocks) {
    const size = block.equations.length;
    if (size === 1) {
      const j = block.variables[0];
      const i = block.equations[0];
      const r = solveScalar((x) => {
        setZ(j, x);
        return residualAt(i);
      }, z[j], problem.typical[j], problem.perturbation ? problem.perturbation[j] : 0);
      iterations += r.iterations;
      setZ(j, r.x);
      if (!r.converged) {
        return failure(problem, z, full, iterations, jacobians, `equation ${describe(block)} could not be solved for '${unknownName(sys, freeStates, j)}'`);
      }
      continue;
    }
    const vars = block.variables;
    const sub: NewtonProblem = {
      n: size,
      residual(zb, out) {
        for (let k = 0; k < size; k++) setZ(vars[k], zb[k]);
        for (let k = 0; k < size; k++) out[k] = residualAt(block.equations[k]);
      },
      weights(zb, w) {
        for (let k = 0; k < size; k++) w[k] = INIT_RTOL * (problem.typical[vars[k]] + Math.abs(zb[k]));
      },
      typical: Float64Array.from(vars, (j) => problem.typical[j]),
      perturbation: problem.perturbation ? Float64Array.from(vars, (j) => problem.perturbation![j]) : undefined,
    };
    const zb0 = Float64Array.from(vars, (j) => z[j]);
    const zb = Float64Array.from(zb0);
    const cache = new JacobianCache(size);
    let res = newtonSolve(sub, zb, cache, { maxIterations: 60, maxJacobians: 20, relaxedTolerance: INIT_RELAXED });
    iterations += res.iterations;
    jacobians += res.jacobians;
    if (!res.converged && res.reason !== 'singular' && res.reason !== 'non-finite') {
      zb.set(zb0);
      cache.invalidate();
      res = newtonSolve(sub, zb, cache, { maxIterations: 200, maxJacobians: 200, alwaysRefresh: true, relaxedTolerance: INIT_RELAXED });
      iterations += res.iterations;
      jacobians += res.jacobians;
    }
    for (let k = 0; k < size; k++) setZ(vars[k], zb[k]);
    if (!res.converged) {
      return failure(problem, z, full, iterations, jacobians, `the ${size}x${size} block ${describe(block)} did not converge (${res.reason})`);
    }
  }
  problem.residual(z, full);
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(full[i])) return failure(problem, z, full, iterations, jacobians, `equation '${sys.equationName(i)}' is not finite`);
  }
  return { converged: true, iterations, jacobians, stepNorm: 0, residual: full, worstEquation: worstIndex(full) };
}

function failure(problem: NewtonProblem, z: Float64Array, full: Float64Array, iterations: number, jacobians: number, why: string): BlockwiseResult {
  problem.residual(z, full);
  return { converged: false, iterations, jacobians, stepNorm: Infinity, residual: full, reason: 'max-iterations', worstEquation: worstIndex(full), failedBlock: why };
}

function worstIndex(f: Float64Array): number {
  let idx = 0;
  let mx = -1;
  for (let i = 0; i < f.length; i++) {
    const a = Math.abs(f[i]);
    if (!(a <= mx)) {
      mx = a;
      idx = i;
    }
  }
  return idx;
}

function unknownName(sys: System, freeStates: readonly number[], j: number): string {
  const nS = sys.nS;
  const nA = sys.nA;
  if (j < nA) return sys.m.unknowns[nS + j].name;
  if (j < nA + nS) return `der(${sys.m.unknowns[j - nA].name})`;
  return sys.m.unknowns[freeStates[j - nA - nS]]?.name ?? `#${j}`;
}

// -------------------------------------------------------------------------------------------
// Scalar solver
// -------------------------------------------------------------------------------------------

export interface ScalarResult {
  x: number;
  converged: boolean;
  iterations: number;
}

/**
 * Solves f(x) = 0 for one unknown: Newton steps with a finite-difference slope (exact after
 * one step for linear residuals), backtracking when the residual does not decrease, and
 * bisection on a sign-change bracket when the slope vanishes.
 */
export function solveScalar(f: (x: number) => number, x0: number, typical: number, perturbation: number): ScalarResult {
  let x = x0;
  let fx = f(x);
  let iterations = 0;
  if (!Number.isFinite(fx)) {
    if (x !== 0) {
      x = 0;
      fx = f(0);
    }
    if (!Number.isFinite(fx)) return { x: x0, converged: false, iterations };
  }
  let bracket: [number, number] | undefined; // [a, b] with sign change of f
  let fBracket: [number, number] | undefined;
  const typ = Math.max(typical, 1e-300);
  for (; iterations < 80; iterations++) {
    if (fx === 0) return { x, converged: true, iterations };
    const w = INIT_RTOL * (typ + Math.abs(x));
    let h = perturbation > 0 ? (x >= 0.5 ? -perturbation : perturbation) : SQRT_EPS * Math.max(Math.abs(x), typ);
    let fh = f(x + h);
    let slope = (fh - fx) / h;
    if (!Number.isFinite(slope) || slope === 0) {
      // Try a larger perturbation before giving up on Newton.
      h = perturbation > 0 ? h : 1e-3 * Math.max(Math.abs(x), typ);
      fh = f(x + h);
      slope = (fh - fx) / h;
    }
    let xNew: number;
    let fNew: number;
    if (!Number.isFinite(slope) || slope === 0) {
      if (!bracket) return { x, converged: false, iterations };
      xNew = 0.5 * (bracket[0] + bracket[1]);
      fNew = f(xNew);
    } else {
      let dx = -fx / slope;
      // Limit huge steps (e.g. tiny slopes) to keep the iteration finite.
      const cap = 1e8 * (typ + Math.abs(x));
      if (Math.abs(dx) > cap) dx = Math.sign(dx) * cap;
      let lambda = 1;
      xNew = x + dx;
      fNew = f(xNew);
      for (let ls = 0; ls < 12 && (!Number.isFinite(fNew) || Math.abs(fNew) > Math.abs(fx) * (1 - 1e-4 * lambda)); ls++) {
        lambda *= 0.5;
        xNew = x + lambda * dx;
        fNew = f(xNew);
      }
      if ((!Number.isFinite(fNew) || Math.abs(fNew) > Math.abs(fx)) && bracket) {
        xNew = 0.5 * (bracket[0] + bracket[1]);
        fNew = f(xNew);
      }
      if (!Number.isFinite(fNew)) return { x, converged: false, iterations };
    }
    // Maintain the bracket.
    if (Math.sign(fNew) !== Math.sign(fx) && fNew !== 0) {
      bracket = [x, xNew];
      fBracket = [fx, fNew];
    } else if (bracket && fBracket) {
      if (Math.sign(fNew) === Math.sign(fBracket[0])) {
        bracket[0] = xNew;
        fBracket[0] = fNew;
      } else {
        bracket[1] = xNew;
        fBracket[1] = fNew;
      }
    }
    const step = Math.abs(xNew - x);
    x = xNew;
    fx = fNew;
    if (step <= w) return { x, converged: true, iterations: iterations + 1 };
    if (bracket && Math.abs(bracket[1] - bracket[0]) <= w) return { x, converged: true, iterations: iterations + 1 };
  }
  return { x, converged: Math.abs(fx) <= 1e-12 * (1 + Math.abs(x)), iterations };
}
