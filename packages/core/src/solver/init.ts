/**
 * Initialisation: solves the initial system (equations + initial equations) for the
 * algebraic variables, the derivatives and the free states at `startTime`.
 *
 * A state is free when `fixed = false` was given explicitly or when initial equations exist
 * (then min(#initial equations, #states without fixed=true) states are freed, preferring
 * those with fixed=false); all other states keep their `start` value. Newton starts from the
 * `start` guesses; on failure it retries with a full (refreshed every iteration) damped Newton
 * and finally with a Newton homotopy from the start values.
 *
 * Before the simultaneous solve, the initial system is sorted into BLT blocks
 * (`structural/blt-init.ts`) and solved block by block; the simultaneous strategies are the
 * fallback when a block does not converge or when the structural matching is not perfect.
 */
import { ModelicaError } from '../ast.js';
import type { UnknownInfo } from './compile.js';
import type { EventHandler } from './events.js';
import { JacobianCache, newtonSolve, type NewtonProblem, type NewtonResult } from './newton.js';
import { analyzeInitialization, solveInitializationBlockwise } from './structural/blt-init.js';
import { fmt, type System } from './system.js';

const INIT_RTOL = 1e-10;
const INIT_RELAXED = 1e3; // accept ~1e-7 relative accuracy after exhausting iterations

export function initialize(sys: System, events: EventHandler): void {
  const m = sys.m;
  const ctx = sys.ctx;
  const nS = sys.nS;
  const nA = sys.nA;
  const t0 = sys.options.startTime;

  sys.t = t0;
  for (const u of m.unknowns) sys.v[u.index] = u.start;
  sys.dv.fill(0);
  ctx.pre.set(sys.v);
  ctx.initial = true;
  ctx.frozen = true;
  ctx.sampleActive.fill(0);
  sys.bindCanonical();

  // ---- free states -------------------------------------------------------------------------
  const states = m.unknowns.slice(0, nS);
  const nInit = m.initialResiduals.length;
  const candidates = states
    .filter((u) => u.fixed !== true)
    .sort((a, b) => (a.fixed === false ? 0 : 1) - (b.fixed === false ? 0 : 1));
  let free: UnknownInfo[] = [];
  if (nInit > 0) {
    if (candidates.length < nInit) {
      throw new ModelicaError(
        `Initialization problem is overdetermined: ${nInit} initial equation${nInit === 1 ? '' : 's'} but only ${candidates.length} state${candidates.length === 1 ? '' : 's'} without fixed=true can be determined by them (${m.flat.className})`,
      );
    }
    free = candidates.slice(0, nInit);
  }
  for (const u of states) {
    if (u.fixed === false && !free.includes(u)) {
      sys.log('warning', `State '${u.name}' has fixed=false but no initial equation determines it; using start value ${fmt(u.start)}`);
    }
  }
  const nFree = free.length;
  const n = nA + nS + nFree;
  const nEq = sys.nEq;

  // ---- Newton problem --------------------------------------------------------------------
  const problem: NewtonProblem = {
    n,
    residual(z, out) {
      const v = ctx.v;
      const dv = ctx.dv;
      for (let i = 0; i < nA; i++) v[nS + i] = z[i];
      for (let i = 0; i < nS; i++) dv[i] = z[nA + i];
      for (let j = 0; j < nFree; j++) v[free[j].index] = z[nA + nS + j];
      const res = m.residuals;
      for (let i = 0; i < nEq; i++) out[i] = res[i].fn(ctx);
      const ires = m.initialResiduals;
      for (let k = 0; k < ires.length; k++) out[nEq + k] = ires[k].fn(ctx);
    },
    weights(z, w) {
      for (let i = 0; i < n; i++) w[i] = INIT_RTOL * (problem.typical[i] + Math.abs(z[i]));
    },
    typical: new Float64Array(n),
    perturbation: new Float64Array(n),
  };
  for (let i = 0; i < nA; i++) {
    problem.typical[i] = sys.nominal[nS + i];
    problem.perturbation![i] = sys.perturbation[nS + i];
  }
  for (let i = 0; i < nS; i++) problem.typical[nA + i] = sys.nominal[i];
  for (let j = 0; j < nFree; j++) problem.typical[nA + nS + j] = sys.nominal[free[j].index];

  const unknownName = (j: number): string => {
    if (j < nA) return m.unknowns[nS + j].name;
    if (j < nA + nS) return `der(${m.unknowns[j - nA].name})`;
    return free[j - nA - nS].name;
  };

  const z0 = new Float64Array(n);
  for (let i = 0; i < nA; i++) z0[i] = sys.v[nS + i];
  for (let j = 0; j < nFree; j++) z0[nA + nS + j] = free[j].start;
  const z = new Float64Array(z0);
  const cache = new JacobianCache(n);
  const relFresh = new Uint8Array(m.relations.length);

  // Block-wise (BLT) solve first; the simultaneous strategies are the fallback.
  const freeStates = free.map((u) => u.index);
  const blt = n > 0 ? analyzeInitialization(m, free) : undefined;
  if (n > 0 && !blt) sys.log('debug', 'Initialization: the initial system has no perfect structural matching; solving all equations simultaneously');

  // Relations are frozen during Newton; iterate until they are consistent with the solution.
  events.evalRelations(t0, sys.v, sys.dv, ctx.relVals);
  sys.bindCanonical();
  let consistent = false;
  for (let iter = 0; iter < 20 && !consistent; iter++) {
    if (n > 0) {
      let res: NewtonResult | undefined;
      if (blt) {
        const zb = new Float64Array(z);
        const br = solveInitializationBlockwise(sys, blt, problem, zb, freeStates);
        sys.stats.newtonIterations += br.iterations;
        sys.stats.jacobianEvaluations += br.jacobians;
        if (br.converged) {
          z.set(zb);
          res = br;
        } else {
          sys.log('debug', `Initialization: block-wise solve failed (${br.failedBlock ?? 'unknown block'}); retrying with the simultaneous Newton`);
          problem.residual(z, new Float64Array(nEq + nInit));
        }
      }
      if (!res) {
        res = solveWithStrategies(sys, problem, z, z0, cache);
        sys.stats.newtonIterations += res.iterations;
        sys.stats.jacobianEvaluations += res.jacobians;
      }
      if (!res.converged) throw initializationFailure(sys, res, problem, z, unknownName);
      if (res.relaxed) sys.log('warning', `Initialization converged only to a relaxed tolerance (scaled step ${fmt(res.stepNorm)})`);
      // Sync v/dv with the solution.
      const out = new Float64Array(nEq + nInit);
      problem.residual(z, out);
    }
    events.evalRelations(t0, sys.v, sys.dv, relFresh);
    sys.bindCanonical();
    consistent = true;
    for (let i = 0; i < relFresh.length; i++) {
      if (relFresh[i] !== ctx.relVals[i]) {
        consistent = false;
        break;
      }
    }
    if (!consistent) {
      ctx.relVals.set(relFresh);
      cache.invalidate();
    }
  }
  if (!consistent) {
    sys.log('warning', `Initialization: the if/relation structure did not become consistent after 20 iterations; continuing with the last solution`);
  }

  // ---- when-clauses that are active at initialisation (e.g. `when initial()`) ---------------
  if (m.whens.length > 0) {
    const cond = new Uint8Array(m.whens.length);
    events.evalConditions(t0, sys.v, sys.dv, cond);
    let applied = false;
    for (let w = 0; w < m.whens.length; w++) {
      if (!cond[w]) continue;
      sys.bindCanonical();
      for (const act of m.whens[w].actions) {
        const value = act.value(ctx);
        if (!Number.isFinite(value)) {
          throw new ModelicaError(`'${act.text}' evaluated to ${Number.isNaN(value) ? 'NaN' : 'Infinity'} during initialization (${m.whens[w].origin})`);
        }
        sys.v[act.target] = m.unknowns[act.target].type === 'Boolean' ? (value >= 0.5 ? 1 : 0) : value;
        applied = true;
      }
    }
    if (applied && nA + nS > 0) {
      sys.algebraicCache.invalidate();
      const res = sys.solveAlgebraic(t0, sys.v, sys.dv, { maxIterations: 50, maxJacobians: 5 });
      if (!res.converged) sys.log('warning', `Could not re-solve the algebraic variables after the initial when-clauses: ${sys.describeAlgebraicFailure(res, t0)}`);
    }
  }

  ctx.initial = false;
  sys.bindCanonical();
  sys.checkFinite('at initialization');
  ctx.pre.set(sys.v);
  events.initializeConditions();
  sys.implicitCache.invalidate();
  sys.algebraicCache.invalidate();
}

// ---------------------------------------------------------------------------------------------

function solveWithStrategies(sys: System, problem: NewtonProblem, z: Float64Array, z0: Float64Array, cache: JacobianCache): NewtonResult {
  // 1. Modified Newton with line search from the start values.
  let res = newtonSolve(problem, z, cache, { maxIterations: 60, maxJacobians: 20, relaxedTolerance: INIT_RELAXED });
  if (res.converged || res.reason === 'singular' || res.reason === 'non-finite') return res;
  let total = res;

  // 2. Full Newton (Jacobian refreshed every iteration) with damping.
  sys.log('debug', 'Initialization: Newton did not converge, retrying with full damped Newton');
  z.set(z0);
  cache.invalidate();
  res = newtonSolve(problem, z, cache, { maxIterations: 200, maxJacobians: 200, alwaysRefresh: true, relaxedTolerance: INIT_RELAXED });
  total = accumulate(total, res);
  if (res.converged || res.reason === 'singular' || res.reason === 'non-finite') return total;

  // 3. Newton homotopy: F(z) - (1 - lambda) F(z0) = 0, lambda: 0 -> 1.
  sys.log('debug', 'Initialization: retrying with homotopy from the start values');
  const n = problem.n;
  const f0 = new Float64Array(n);
  problem.residual(z0, f0);
  z.set(z0);
  const zTrial = new Float64Array(n);
  let lambda = 0;
  let dl = 0.1;
  let last: NewtonResult = res;
  while (lambda < 1) {
    const ln = Math.min(1, lambda + dl);
    const hp: NewtonProblem = {
      n,
      residual(zz, out) {
        problem.residual(zz, out);
        const s = 1 - ln;
        for (let i = 0; i < n; i++) out[i] -= s * f0[i];
      },
      weights: problem.weights,
      typical: problem.typical,
    };
    zTrial.set(z);
    cache.invalidate();
    last = newtonSolve(hp, zTrial, cache, { maxIterations: 50, maxJacobians: 50, alwaysRefresh: true, relaxedTolerance: ln < 1 ? 1e6 : INIT_RELAXED });
    total = accumulate(total, last);
    if (last.converged) {
      z.set(zTrial);
      lambda = ln;
      dl = Math.min(0.5, dl * 1.5);
    } else {
      if (last.reason === 'singular' || last.reason === 'non-finite') break;
      dl *= 0.5;
      if (dl < 1e-4) break;
    }
  }
  if (lambda >= 1 && last.converged) {
    // Final polish on the original problem.
    cache.invalidate();
    const polish = newtonSolve(problem, z, cache, { maxIterations: 30, maxJacobians: 30, alwaysRefresh: true, relaxedTolerance: INIT_RELAXED });
    total = accumulate(total, polish);
    return { ...polish, iterations: total.iterations, jacobians: total.jacobians };
  }
  // Report the failure of the original problem at the best point reached.
  const fin = newtonSolve(problem, z, cache, { maxIterations: 1, maxJacobians: 1 });
  return { ...fin, converged: false, reason: fin.reason ?? 'max-iterations', iterations: total.iterations, jacobians: total.jacobians };
}

function accumulate(a: NewtonResult, b: NewtonResult): NewtonResult {
  return { ...b, iterations: a.iterations + b.iterations, jacobians: a.jacobians + b.jacobians };
}

function initializationFailure(sys: System, res: NewtonResult, problem: NewtonProblem, z: Float64Array, unknownName: (j: number) => string): ModelicaError {
  const m = sys.m;
  const eqName = (i: number) => sys.equationName(i);
  if (res.reason === 'singular') {
    const parts: string[] = [];
    if (res.singularRow !== undefined) parts.push(`equation '${eqName(res.singularRow)}' does not depend on any unknown of the initialization problem`);
    if (res.singularCol !== undefined) parts.push(`'${unknownName(res.singularCol)}' is not determined by the initialization problem`);
    return new ModelicaError(`Initialization failed: the Jacobian of the initialization problem is singular${parts.length ? ' (' + parts.join('; ') + ')' : ''}`);
  }
  if (res.reason === 'non-finite') {
    const i = res.nonFiniteIndex ?? 0;
    return new ModelicaError(`Initialization failed: equation '${eqName(i)}' evaluated to NaN or Infinity at the start values`);
  }
  const f = new Float64Array(problem.n);
  problem.residual(z, f);
  const ranked = Array.from(f, (r, i) => ({ i, r: Math.abs(r) }))
    .filter((x) => Number.isFinite(x.r))
    .sort((a, b) => b.r - a.r)
    .slice(0, 5);
  const lines = ranked.map((x) => `  ${eqName(x.i)}: residual ${fmt(f[x.i])}`);
  return new ModelicaError(
    `Initialization failed: Newton iteration did not converge (${res.reason}) after ${res.iterations} iterations. Largest residuals:\n${lines.join('\n')}\n(${m.flat.className}; check start values and fixed attributes)`,
  );
}
