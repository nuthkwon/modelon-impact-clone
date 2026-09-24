/**
 * Programmatic FlatModel builders used by the solver tests. They emit models in the shape the
 * flattener produces (dotted names, connect-potential / connect-flow equations, evaluated
 * parameter values).
 */
import { E, type Expr } from '../ast.js';
import { flatRef, type BaseType, type FlatEquation, type FlatEquationKind, type FlatModel, type FlatVariable, type FlatWhenClause, type Variability } from '../flat.js';

export interface VarOptions {
  type?: BaseType;
  variability?: Variability;
  start?: number | boolean;
  fixed?: boolean;
  nominal?: number;
  min?: number;
  max?: number;
  unit?: string;
  displayUnit?: string;
  description?: string;
  flow?: boolean;
  binding?: Expr;
  value?: number | boolean | string;
}

export function variable(name: string, opts: VarOptions = {}): FlatVariable {
  const parts = name.split('.');
  return {
    name,
    type: opts.type ?? 'Real',
    variability: opts.variability ?? 'continuous',
    causality: 'none',
    flow: opts.flow ?? false,
    typeName: opts.type ?? 'Real',
    attributes: {
      start: opts.start,
      fixed: opts.fixed,
      nominal: opts.nominal,
      min: opts.min,
      max: opts.max,
      unit: opts.unit,
      displayUnit: opts.displayUnit,
    },
    description: opts.description,
    binding: opts.binding,
    value: opts.value,
    protected: false,
    componentPath: parts.slice(0, -1),
    declaredIn: 'Test',
  };
}

export function param(name: string, value: number | boolean | string, opts: VarOptions = {}): FlatVariable {
  const type: BaseType = opts.type ?? (typeof value === 'number' ? 'Real' : typeof value === 'boolean' ? 'Boolean' : 'String');
  return variable(name, { ...opts, type, variability: opts.variability ?? 'parameter', value });
}

export const r = flatRef;
export const n = E.num;
export const der = (name: string): Expr => E.call('der', [flatRef(name)]);
export const pre = (name: string): Expr => E.call('pre', [flatRef(name)]);
export const add = (a: Expr, b: Expr): Expr => E.bin('+', a, b);
export const sub = (a: Expr, b: Expr): Expr => E.bin('-', a, b);
export const mul = (a: Expr, b: Expr): Expr => E.bin('*', a, b);
export const div = (a: Expr, b: Expr): Expr => E.bin('/', a, b);
export const lt = (a: Expr, b: Expr): Expr => E.bin('<', a, b);
export const gt = (a: Expr, b: Expr): Expr => E.bin('>', a, b);
export const ifExpr = (cond: Expr, a: Expr, b: Expr): Expr => ({ kind: 'if', branches: [{ cond, value: a }], else: b });
export const time: Expr = flatRef('time');

export function eq(left: Expr, right: Expr, origin = 'Test', kind: FlatEquationKind = 'equation'): FlatEquation {
  return { kind, left, right, origin };
}

export function when(cond: Expr, equations: FlatEquation[], origin = 'Test'): FlatWhenClause {
  return { cond, equations, origin };
}

export function reinit(state: string, value: Expr, origin = 'Test'): FlatEquation {
  return { kind: 'equation', left: E.call('reinit', [flatRef(state), value]), right: E.num(0), origin };
}

export function model(
  className: string,
  variables: FlatVariable[],
  equations: FlatEquation[],
  extra: { initialEquations?: FlatEquation[]; whenClauses?: FlatWhenClause[] } = {},
): FlatModel {
  const params = variables.filter((v) => v.variability === 'parameter').length;
  const constants = variables.filter((v) => v.variability === 'constant').length;
  const unknowns = variables.length - params - constants;
  return {
    className,
    variables,
    equations,
    initialEquations: extra.initialEquations ?? [],
    whenClauses: extra.whenClauses ?? [],
    diagnostics: [],
    stats: {
      components: 0,
      unknowns,
      equations: equations.length,
      parameters: params,
      constants,
      states: 0,
      connections: 0,
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Electrical helpers (the shape the flattener emits for Modelica.Electrical.Analog components)
// ---------------------------------------------------------------------------------------------

function pinVars(prefix: string): FlatVariable[] {
  return [variable(`${prefix}.v`, { unit: 'V' }), variable(`${prefix}.i`, { unit: 'A', flow: true })];
}

/** OnePort equations: v = p.v - n.v; 0 = p.i + n.i; i = p.i */
function onePort(c: string, cls: string): FlatEquation[] {
  const origin = `${c} (${cls})`;
  return [
    eq(r(`${c}.v`), sub(r(`${c}.p.v`), r(`${c}.n.v`)), origin),
    eq(n(0), add(r(`${c}.p.i`), r(`${c}.n.i`)), origin),
    eq(r(`${c}.i`), r(`${c}.p.i`), origin),
  ];
}

function resistor(c: string, R: number): { vars: FlatVariable[]; eqs: FlatEquation[] } {
  const cls = 'Modelica.Electrical.Analog.Basic.Resistor';
  return {
    vars: [param(`${c}.R`, R, { unit: 'Ohm' }), variable(`${c}.v`, { unit: 'V' }), variable(`${c}.i`, { unit: 'A' }), ...pinVars(`${c}.p`), ...pinVars(`${c}.n`)],
    eqs: [...onePort(c, cls), eq(r(`${c}.v`), mul(r(`${c}.R`), r(`${c}.i`)), `${c} (${cls})`)],
  };
}

function capacitor(c: string, C: number, v0: number): { vars: FlatVariable[]; eqs: FlatEquation[] } {
  const cls = 'Modelica.Electrical.Analog.Basic.Capacitor';
  return {
    vars: [
      param(`${c}.C`, C, { unit: 'F' }),
      variable(`${c}.v`, { unit: 'V', start: v0, fixed: true, description: 'Voltage drop of the two pins (= p.v - n.v)' }),
      variable(`${c}.i`, { unit: 'A' }),
      ...pinVars(`${c}.p`),
      ...pinVars(`${c}.n`),
    ],
    eqs: [...onePort(c, cls), eq(mul(r(`${c}.C`), der(`${c}.v`)), r(`${c}.i`), `${c} (${cls})`)],
  };
}

function constantVoltage(c: string, V: number): { vars: FlatVariable[]; eqs: FlatEquation[] } {
  const cls = 'Modelica.Electrical.Analog.Sources.ConstantVoltage';
  return {
    vars: [param(`${c}.V`, V, { unit: 'V' }), variable(`${c}.v`, { unit: 'V' }), variable(`${c}.i`, { unit: 'A' }), ...pinVars(`${c}.p`), ...pinVars(`${c}.n`)],
    eqs: [...onePort(c, cls), eq(r(`${c}.v`), r(`${c}.V`), `${c} (${cls})`)],
  };
}

function ground(c: string): { vars: FlatVariable[]; eqs: FlatEquation[] } {
  return { vars: pinVars(`${c}.p`), eqs: [eq(r(`${c}.p.v`), n(0), `${c} (Modelica.Electrical.Analog.Basic.Ground)`)] };
}

/** Connection set of pins: n-1 potential equalities and one flow sum (all inside connectors). */
function connectSet(pins: string[]): FlatEquation[] {
  const eqs: FlatEquation[] = [];
  for (let i = 1; i < pins.length; i++) eqs.push(eq(r(`${pins[0]}.v`), r(`${pins[i]}.v`), `connect(${pins[0]}, ${pins[i]})`, 'connect-potential'));
  let sum: Expr = r(`${pins[0]}.i`);
  for (let i = 1; i < pins.length; i++) sum = add(sum, r(`${pins[i]}.i`));
  eqs.push(eq(sum, n(0), `connect(${pins.join(', ')})`, 'connect-flow'));
  return eqs;
}

/** Series RC circuit driven by a constant voltage: capacitor.v = V (1 - exp(-t/RC)). */
export function rcCircuit(R = 100, C = 1e-3, V = 1): FlatModel {
  const src = constantVoltage('source', V);
  const res = resistor('resistor', R);
  const cap = capacitor('capacitor', C, 0);
  const gnd = ground('ground');
  return model(
    'Examples.RC',
    [...src.vars, ...res.vars, ...cap.vars, ...gnd.vars],
    [
      ...src.eqs,
      ...res.eqs,
      ...cap.eqs,
      ...gnd.eqs,
      ...connectSet(['source.p', 'resistor.p']),
      ...connectSet(['resistor.n', 'capacitor.p']),
      ...connectSet(['capacitor.n', 'source.n', 'ground.p']),
    ],
  );
}

/** Two resistors in parallel across a constant voltage source (an algebraic loop, no states). */
export function parallelResistors(V = 10, R1 = 100, R2 = 200): FlatModel {
  const src = constantVoltage('source', V);
  const r1 = resistor('r1', R1);
  const r2 = resistor('r2', R2);
  const gnd = ground('ground');
  return model(
    'Examples.ParallelResistors',
    [...src.vars, ...r1.vars, ...r2.vars, ...gnd.vars],
    [
      ...src.eqs,
      ...r1.eqs,
      ...r2.eqs,
      ...gnd.eqs,
      ...connectSet(['source.p', 'r1.p', 'r2.p']),
      ...connectSet(['r1.n', 'r2.n', 'source.n', 'ground.p']),
    ],
  );
}

// ---------------------------------------------------------------------------------------------
// Mechanics / classic ODE test models
// ---------------------------------------------------------------------------------------------

/** m der(v) = -k x - d v, der(x) = v, x(0) = x0, v(0) = 0. */
export function massSpringDamper(m = 1, k = 10, d = 0.5, x0 = 1): FlatModel {
  return model(
    'Examples.MassSpringDamper',
    [
      param('m', m, { unit: 'kg' }),
      param('k', k, { unit: 'N/m' }),
      param('d', d, { unit: 'N.s/m' }),
      variable('x', { unit: 'm', start: x0, fixed: true }),
      variable('v', { unit: 'm/s', start: 0, fixed: true }),
      variable('f', { unit: 'N' }),
    ],
    [eq(r('f'), sub(E.neg(mul(r('k'), r('x'))), mul(r('d'), r('v')))), eq(mul(r('m'), der('v')), r('f')), eq(der('x'), r('v'))],
  );
}

export function massSpringDamperAnalytic(m: number, k: number, d: number, x0: number): (t: number) => number {
  const w0 = Math.sqrt(k / m);
  const zeta = d / (2 * Math.sqrt(k * m));
  const wd = w0 * Math.sqrt(1 - zeta * zeta);
  return (t) => Math.exp(-zeta * w0 * t) * (x0 * Math.cos(wd * t) + ((zeta * w0 * x0) / wd) * Math.sin(wd * t));
}

/** der(x) = y, der(y) = mu (1 - x^2) y - x, x(0) = 2, y(0) = 0. */
export function vanDerPol(mu = 1000): FlatModel {
  return model(
    'Examples.VanDerPol',
    [param('mu', mu), variable('x', { start: 2, fixed: true }), variable('y', { start: 0, fixed: true })],
    [eq(der('x'), r('y')), eq(der('y'), sub(mul(mul(r('mu'), sub(n(1), E.bin('^', r('x'), n(2)))), r('y')), r('x')))],
  );
}

/** Bouncing ball: der(h) = v, der(v) = -g, when h < 0 then reinit(v, -e pre(v)). */
export function bouncingBall(e = 0.8, h0 = 1, g = 9.81): FlatModel {
  return model(
    'Examples.BouncingBall',
    [
      param('e', e, { description: 'coefficient of restitution' }),
      param('g', g, { unit: 'm/s2' }),
      variable('h', { unit: 'm', start: h0, fixed: true }),
      variable('v', { unit: 'm/s', start: 0, fixed: true }),
    ],
    [eq(der('h'), r('v')), eq(der('v'), E.neg(r('g')))],
    { whenClauses: [when(lt(r('h'), n(0)), [reinit('v', mul(E.neg(r('e')), pre('v')))], 'Examples.BouncingBall')] },
  );
}

/** Pure algebraic model: y = sin(time), z = 2 y + 1. */
export function algebraicModel(): FlatModel {
  return model(
    'Examples.Algebraic',
    [variable('y'), variable('z')],
    [eq(r('y'), E.call('sin', [time])), eq(r('z'), add(mul(n(2), r('y')), n(1)))],
  );
}

/** Nonlinear algebraic loop: x^2 + y = 3 + time, x - y = time - 1 (x = sqrt(2 + ... )) */
export function nonlinearAlgebraic(): FlatModel {
  return model(
    'Examples.NonlinearAlgebraic',
    [variable('x', { start: 1 }), variable('y', { start: 1 })],
    [eq(add(E.bin('^', r('x'), n(2)), r('y')), add(n(3), time)), eq(sub(r('x'), r('y')), sub(time, n(1)))],
  );
}

/** Unbalanced: two unknowns, one equation. */
export function unbalanced(): FlatModel {
  return model('Examples.Unbalanced', [variable('x', { start: 1 }), variable('y')], [eq(der('x'), r('y'))]);
}

/** der(x) = 1 from 0; y = if x > 0.5 then 1 else 0 (switch at t = 0.5); z = if time > 0.5 then 2 else 0. */
export function ifSwitch(): FlatModel {
  return model(
    'Examples.IfSwitch',
    [variable('x', { start: 0, fixed: true }), variable('y'), variable('z')],
    [eq(der('x'), n(1)), eq(r('y'), ifExpr(gt(r('x'), n(0.5)), n(1), n(0))), eq(r('z'), ifExpr(gt(time, n(0.5)), n(2), n(0)))],
  );
}

/** Integrator plus a sampled counter: when sample(start, dt) then count = pre(count) + 1. */
export function sampleCounter(start = 0.25, dt = 0.25): FlatModel {
  return model(
    'Examples.SampleCounter',
    [
      variable('x', { start: 0, fixed: true }),
      variable('count', { type: 'Integer', variability: 'discrete', start: 0 }),
      variable('y'),
    ],
    [eq(der('x'), n(1)), eq(r('y'), add(r('x'), r('count')))],
    { whenClauses: [when(E.call('sample', [n(start), n(dt)]), [eq(r('count'), add(pre('count'), n(1)))], 'Examples.SampleCounter')] },
  );
}

/** Only a discrete counter (no continuous states or algebraics). */
export function pureDiscreteCounter(dt = 0.1): FlatModel {
  return model(
    'Examples.PureDiscrete',
    [variable('count', { type: 'Integer', variability: 'discrete', start: 0 })],
    [],
    { whenClauses: [when(E.call('sample', [n(0), n(dt)]), [eq(r('count'), add(pre('count'), n(1)))], 'Examples.PureDiscrete')] },
  );
}

/** Steady-state initialisation: der(x) = -x + u with initial equation der(x) = 0, x fixed=false. */
export function steadyStateInit(u = 3): FlatModel {
  return model(
    'Examples.SteadyState',
    [param('u', u), variable('x', { start: 0, fixed: false })],
    [eq(der('x'), add(E.neg(r('x')), r('u')))],
    { initialEquations: [eq(der('x'), n(0), 'Examples.SteadyState', 'initial')] },
  );
}

/** Hysteresis with a Boolean algebraic variable and pre(): on = (x > 1) or (pre(on) and x > -1); x = sin(time)*2. */
export function hysteresis(): FlatModel {
  return model(
    'Examples.Hysteresis',
    [variable('x'), variable('on', { type: 'Boolean', variability: 'discrete', start: false }), variable('y')],
    [
      eq(r('x'), mul(n(2), E.call('sin', [time]))),
      eq(r('on'), E.bin('or', gt(r('x'), n(1)), E.bin('and', pre('on'), gt(r('x'), n(-1))))),
      eq(r('y'), ifExpr(r('on'), n(1), n(0))),
    ],
  );
}
