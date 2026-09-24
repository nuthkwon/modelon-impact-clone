import { describe, expect, it } from 'vitest';
import { E } from '../../ast.js';
import { createParameterEnvironment } from '../compile.js';
import * as M from '../test-models.js';
import { incidence } from './expr.js';
import { analyzeStructure, bltSort, maximumMatching } from './matching.js';
import { createWorkingModel } from './model.js';

describe('maximum matching (Hopcroft-Karp)', () => {
  it('finds a perfect matching when one exists', () => {
    // eq0: {0,1}, eq1: {0}, eq2: {1,2}, eq3: {2,3}  -> eq1-0, eq0-1, eq2-2, eq3-3
    const adj = [[0, 1], [0], [1, 2], [2, 3]];
    const m = maximumMatching(4, 4, adj);
    expect(m.size).toBe(4);
    expect(Array.from(m.leftToRight)).toEqual([1, 0, 2, 3]);
    for (let i = 0; i < 4; i++) expect(m.rightToLeft[m.leftToRight[i]]).toBe(i);
  });

  it('reports the deficiency of structurally singular systems', () => {
    // Three equations sharing only two variables.
    const adj = [[0, 1], [0, 1], [1], [2]];
    const m = maximumMatching(4, 3, adj);
    expect(m.size).toBe(3);
    expect(Array.from(m.leftToRight).filter((v) => v === -1)).toHaveLength(1);
  });

  it('handles larger random bipartite graphs against a brute-force augmenting search', () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    for (let trial = 0; trial < 20; trial++) {
      const n = 8 + Math.floor(rand() * 8);
      const adj: number[][] = [];
      for (let i = 0; i < n; i++) {
        const row: number[] = [];
        for (let j = 0; j < n; j++) if (rand() < 0.25) row.push(j);
        adj.push(row);
      }
      // Reference: simple Kuhn augmenting paths.
      const matchR = new Int32Array(n).fill(-1);
      const tryKuhn = (u: number, seen: Uint8Array): boolean => {
        for (const v of adj[u]) {
          if (seen[v]) continue;
          seen[v] = 1;
          if (matchR[v] === -1 || tryKuhn(matchR[v], seen)) {
            matchR[v] = u;
            return true;
          }
        }
        return false;
      };
      let ref = 0;
      for (let u = 0; u < n; u++) if (tryKuhn(u, new Uint8Array(n))) ref++;
      expect(maximumMatching(n, n, adj).size).toBe(ref);
    }
  });
});

describe('BLT sorting', () => {
  it('orders blocks so that every block depends only on earlier ones and merges cycles', () => {
    // eq0: x0 = 1;  eq1: x1 = f(x0, x2);  eq2: x2 = g(x1);  eq3: x3 = h(x1)
    const adj = [[0], [1, 0, 2], [2, 1], [3, 1]];
    const matching = maximumMatching(4, 4, adj);
    expect(matching.size).toBe(4);
    const blocks = bltSort(4, adj, matching);
    expect(blocks.map((b) => b.equations)).toEqual([[0], [1, 2], [3]]);
    expect(blocks[1].variables.sort()).toEqual([1, 2]);
  });

  it('respects extra dependency edges (e.g. variables used only in conditions)', () => {
    // eq0 can be solved for x0 but its value depends on x1 through a condition; eq1 solves x1.
    const solve = [[0], [1]];
    const deps = [[0, 1], [1]];
    const matching = maximumMatching(2, 2, solve);
    expect(bltSort(2, deps, matching).map((b) => b.equations)).toEqual([[1], [0]]);
  });
});

describe('incidence and structural analysis of flat models', () => {
  it('collects the highest derivative order and ignores pre(), relations and if-conditions', () => {
    const e = M.add(M.mul(M.der('x'), M.r('y')), M.ifExpr(M.gt(M.r('z'), M.n(0)), M.pre('w'), M.r('u')));
    const inc = incidence(e, () => true);
    expect([...inc.entries()].sort()).toEqual([
      ['u', 0],
      ['x', 1],
      ['y', 0],
    ]);
    const withConditions = incidence(e, () => true, new Map(), { conditions: true });
    expect([...withConditions.keys()].sort()).toEqual(['u', 'x', 'y', 'z']);
  });

  it('matches the RC circuit perfectly, with der(capacitor.v) as the unknown of the capacitor', () => {
    const flat = M.rcCircuit();
    const wm = createWorkingModel(flat, createParameterEnvironment(flat, {}).env);
    const s = analyzeStructure(flat, wm.isUnknown, wm.states);
    expect(s.unknowns).toContain('der(capacitor.v)');
    expect(s.unknowns).not.toContain('capacitor.v');
    expect(s.matching.size).toBe(flat.equations.length);
    expect(s.unknowns.length).toBe(flat.equations.length);
  });

  it('detects the structural singularity of a constraint between states', () => {
    // phi_rel = phi_b - phi_a with all three states: the constraint has no highest-order unknown.
    const flat = M.model(
      'T',
      [M.variable('phi_a'), M.variable('phi_b'), M.variable('phi_rel'), M.variable('w_a'), M.variable('w_b'), M.variable('w_rel')],
      [
        M.eq(M.r('phi_rel'), M.sub(M.r('phi_b'), M.r('phi_a'))),
        M.eq(M.r('w_rel'), M.der('phi_rel')),
        M.eq(M.r('w_a'), M.der('phi_a')),
        M.eq(M.r('w_b'), M.der('phi_b')),
        M.eq(M.der('w_a'), E.neg(M.r('phi_rel'))),
        M.eq(M.der('w_b'), M.r('phi_rel')),
      ],
    );
    const wm = createWorkingModel(flat, createParameterEnvironment(flat, {}).env);
    const s = analyzeStructure(flat, wm.isUnknown, wm.states);
    expect(s.adjacency[0]).toEqual([]); // the constraint is incident to no highest-order unknown
    expect(s.matching.size).toBe(flat.equations.length - 1);
  });
});
