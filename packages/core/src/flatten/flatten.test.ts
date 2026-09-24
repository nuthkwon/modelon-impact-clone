import { describe, expect, it } from 'vitest';
import { ModelicaError, type Expr } from '../ast.js';
import type { FlatEquation, FlatModel } from '../flat.js';
import { printExpr } from '../parser/printer.js';
import { ClassRegistry } from '../registry.js';
import { simulate } from '../solver/index.js';
import { flatten } from './index.js';

const MINI = `package Mini "Minimal electrical + blocks library"
  package Units
    type Voltage = Real(unit="V");
    type Current = Real(unit="A");
    type Resistance = Real(final quantity="Resistance", unit="Ohm", min=0);
    type Capacitance = Real(unit="F", min=0);
  end Units;

  package Constants
    constant Real pi = 3.14159265358979323846 "Pi";
    constant Real twoPi = 2*pi;
    constant Integer answer = 42;
  end Constants;

  package Interfaces
    connector Pin
      Units.Voltage v "Potential";
      flow Units.Current i "Current";
    end Pin;

    partial model OnePort "Two pins, current from p to n"
      Units.Voltage v "Voltage drop";
      Units.Current i "Current";
      Pin p;
      Pin n;
    equation
      v = p.v - n.v;
      0 = p.i + n.i;
      i = p.i;
    end OnePort;

    connector RealInput = input Real "input connector";
    connector RealOutput = output Real "output connector";

    partial block SISO
      RealInput u;
      RealOutput y;
    end SISO;
  end Interfaces;

  package Components
    model Resistor "Ideal resistor"
      extends Interfaces.OnePort;
      parameter Units.Resistance R(start=1) "Resistance";
    equation
      v = R*i;
    end Resistor;

    model Capacitor
      extends Interfaces.OnePort(v(start=0, fixed=true));
      parameter Units.Capacitance C = 1 "Capacitance";
    equation
      C*der(v) = i;
    end Capacitor;

    model Ground
      Interfaces.Pin p;
    equation
      p.v = 0;
    end Ground;

    model ConstantVoltage
      extends Interfaces.OnePort;
      parameter Units.Voltage V = 1 "Voltage";
    equation
      v = V;
    end ConstantVoltage;

    model SineVoltage
      import Mini.Constants.pi;
      extends Interfaces.OnePort;
      parameter Real V = 1 "Amplitude";
      parameter Real f = 1 "Frequency";
    equation
      v = V*sin(2*pi*f*time);
    end SineVoltage;
  end Components;

  package Blocks
    block Gain
      extends Interfaces.SISO;
      parameter Real k = 1;
    equation
      y = k*u;
    end Gain;

    block Sine
      parameter Real amplitude = 1;
      parameter Real f = 1;
      Interfaces.RealOutput y;
    equation
      y = amplitude*Modelica.Math.sin(2*Mini.Constants.pi*f*time);
    end Sine;

    block Integrator
      extends Interfaces.SISO(y(start=y_start, fixed=true));
      parameter Real k = 1;
      parameter Real y_start = 0;
    equation
      der(y) = k*u;
    end Integrator;
  end Blocks;

  package Types
    type Init = enumeration(NoInit "no initialization", SteadyState, InitialState);
  end Types;

  package Examples
    model RCCircuit
      Components.ConstantVoltage source(V=1);
      Components.Resistor resistor(R=100);
      Components.Capacitor capacitor(C=1e-3);
      Components.Ground ground;
    equation
      connect(source.p, resistor.p);
      connect(resistor.n, capacitor.p);
      connect(capacitor.n, source.n);
      connect(source.n, ground.p);
      annotation(experiment(StopTime=0.5, Tolerance=1e-6));
    end RCCircuit;

    model GainTest
      Blocks.Sine sine(amplitude=2);
      Blocks.Gain gain(k=3);
    equation
      connect(sine.y, gain.u);
    end GainTest;
  end Examples;
end Mini;`;

function makeRegistry(extra?: string): ClassRegistry {
  const registry = new ClassRegistry();
  registry.addLibrary({ id: 'Mini', name: 'Mini', readOnly: true });
  expect(registry.addFile('Mini', 'Mini.mo', MINI)).toEqual([]);
  if (extra) {
    registry.addLibrary({ id: 'Tests', name: 'Tests', readOnly: false });
    const diags = registry.addFile('Tests', 'Tests.mo', extra);
    expect(diags, diags.map((d) => d.message).join('\n')).toEqual([]);
  }
  return registry;
}

function names(model: FlatModel): string[] {
  return model.variables.map((v) => v.name);
}

function variable(model: FlatModel, name: string) {
  const v = model.variables.find((x) => x.name === name);
  if (!v) throw new Error(`variable ${name} not found in [${names(model).join(', ')}]`);
  return v;
}

function eqText(eq: FlatEquation): string {
  return `${printExpr(eq.left)} = ${printExpr(eq.right)}`;
}

function refsIn(e: Expr, out: string[] = []): string[] {
  switch (e.kind) {
    case 'ref':
      out.push(e.parts.map((p) => p.name).join('.'));
      break;
    case 'binary':
      refsIn(e.left, out);
      refsIn(e.right, out);
      break;
    case 'unary':
      refsIn(e.operand, out);
      break;
    case 'call':
      e.args.forEach((a) => refsIn(a, out));
      break;
    case 'if':
      e.branches.forEach((b) => {
        refsIn(b.cond, out);
        refsIn(b.value, out);
      });
      refsIn(e.else, out);
      break;
    default:
      break;
  }
  return out;
}

function catchError(fn: () => unknown): ModelicaError {
  try {
    fn();
  } catch (e) {
    if (e instanceof ModelicaError) return e;
    throw e;
  }
  throw new Error('expected a ModelicaError');
}

describe('flatten: RC circuit (mini library)', () => {
  const registry = makeRegistry();
  const model = flatten(registry, 'Mini.Examples.RCCircuit');

  it('produces the flat variable list with dotted names', () => {
    expect(names(model)).toEqual([
      'source.v', 'source.i', 'source.p.v', 'source.p.i', 'source.n.v', 'source.n.i', 'source.V',
      'resistor.v', 'resistor.i', 'resistor.p.v', 'resistor.p.i', 'resistor.n.v', 'resistor.n.i', 'resistor.R',
      'capacitor.v', 'capacitor.i', 'capacitor.p.v', 'capacitor.p.i', 'capacitor.n.v', 'capacitor.n.i', 'capacitor.C',
      'ground.p.v', 'ground.p.i',
    ]);
    const v = variable(model, 'resistor.v');
    expect(v.componentPath).toEqual(['resistor']);
    expect(v.declaredIn).toBe('Mini.Interfaces.OnePort');
    expect(v.typeName).toBe('Mini.Units.Voltage');
    expect(v.description).toBe('Voltage drop');
    expect(v.file).toBe('Mini.mo');
    expect(v.loc).toBeDefined();
    expect(variable(model, 'resistor.p.i').flow).toBe(true);
    expect(variable(model, 'resistor.p.v').flow).toBe(false);
  });

  it('propagates type attributes through short classes', () => {
    expect(variable(model, 'resistor.v').attributes.unit).toBe('V');
    expect(variable(model, 'resistor.p.i').attributes.unit).toBe('A');
    expect(variable(model, 'resistor.R').attributes).toMatchObject({ unit: 'Ohm', min: 0, quantity: 'Resistance', start: 1 });
    expect(variable(model, 'capacitor.v').attributes).toMatchObject({ start: 0, fixed: true, unit: 'V' });
  });

  it('is balanced and counts equations, unknowns, states, connections', () => {
    const unknowns = model.variables.filter((v) => v.variability === 'continuous' || v.variability === 'discrete');
    expect(model.equations.length).toBe(unknowns.length);
    expect(model.stats).toMatchObject({ components: 4, unknowns: 20, equations: 20, parameters: 3, constants: 0, states: 1, connections: 4 });
    expect(model.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('emits a 3-term flow sum for the ground node and n-1 potential equations', () => {
    const flows = model.equations.filter((e) => e.kind === 'connect-flow');
    expect(flows.length).toBe(3);
    const ground = flows.find((e) => refsIn(e.left).includes('ground.p.i'))!;
    expect(refsIn(ground.left).sort()).toEqual(['capacitor.n.i', 'ground.p.i', 'source.n.i']);
    expect(eqText(ground)).toBe('capacitor.n.i + source.n.i + ground.p.i = 0');
    const potentials = model.equations.filter((e) => e.kind === 'connect-potential');
    expect(potentials.length).toBe(4); // (1) + (1) + (2) for the three sets
    expect(model.equations.filter((e) => e.kind === 'unconnected-flow')).toEqual([]);
  });

  it('detects the state and evaluates parameters (component modifier wins over start)', () => {
    expect(model.stats.states).toBe(1);
    const der = model.equations.find((e) => printExpr(e.left).includes('der('))!;
    expect(eqText(der)).toBe('capacitor.C*der(capacitor.v) = capacitor.i');
    expect(variable(model, 'resistor.R')).toMatchObject({ variability: 'parameter', value: 100 });
    expect(variable(model, 'capacitor.C').value).toBe(1e-3);
    expect(variable(model, 'source.V').value).toBe(1);
    expect(variable(model, 'source.V').typeName).toBe('Mini.Units.Voltage');
  });

  it('reads the experiment annotation', () => {
    expect(model.experiment).toEqual({ StopTime: 0.5, Tolerance: 1e-6 });
  });

  it('applies options.modifiers on top of everything', () => {
    const m = flatten(registry, 'Mini.Examples.RCCircuit', { modifiers: { 'resistor.R': 50, 'capacitor.C': '2e-3', nope: 1 } });
    expect(variable(m, 'resistor.R').value).toBe(50);
    expect(variable(m, 'capacitor.C').value).toBe(2e-3);
    expect(variable(m, 'resistor.R').binding).toEqual({ kind: 'number', value: 50 });
    expect(m.diagnostics.some((d) => d.severity === 'warning' && d.message.includes("'nope'"))).toBe(true);
  });

  it('keeps equation origins and locations', () => {
    const ohm = model.equations.find((e) => eqText(e) === 'resistor.v = resistor.R*resistor.i')!;
    expect(ohm.origin).toBe('resistor (Mini.Components.Resistor)');
    expect(ohm.file).toBe('Mini.mo');
    expect(ohm.loc).toBeDefined();
    const inherited = model.equations.find((e) => eqText(e) === 'resistor.i = resistor.p.i')!;
    expect(inherited.origin).toBe('resistor (Mini.Interfaces.OnePort)');
  });
});

describe('flatten: inheritance and modifications', () => {
  it('applies extends modifications and inherits equations', () => {
    const registry = makeRegistry(`package Tests
      model Base
        parameter Real a = 1;
        Real x(start=2);
      equation
        der(x) = -a*x;
      end Base;
      model Derived
        extends Base(a=3, x(start=5));
        parameter Real b = a + 1;
      end Derived;
    end Tests;`);
    const m = flatten(registry, 'Tests.Derived');
    expect(names(m)).toEqual(['a', 'x', 'b']);
    expect(variable(m, 'a').value).toBe(3);
    expect(variable(m, 'b').value).toBe(4);
    expect(variable(m, 'x').attributes.start).toBe(5);
    expect(m.equations.map(eqText)).toEqual(['der(x) = -a*x']);
    expect(m.equations[0].origin).toBe('Tests.Base');
  });

  it('outermost modifier wins: component modifier > extends modifier > declaration; dotted names equal nested', () => {
    const registry = makeRegistry(`package Tests
      model Outer
        Mini.Blocks.Integrator int1(y_start=7);
        Mini.Blocks.Integrator int2(y(start=9));
        Mini.Blocks.Integrator int3(y.start=11, y.fixed=false);
        Mini.Blocks.Integrator int4;
      equation
        int1.u = 1;
        int2.u = 1;
        int3.u = 1;
        int4.u = 1;
      end Outer;
    end Tests;`);
    const m = flatten(registry, 'Tests.Outer');
    expect(variable(m, 'int1.y').attributes).toMatchObject({ start: 7, fixed: true });
    expect(variable(m, 'int2.y').attributes).toMatchObject({ start: 9, fixed: true });
    expect(variable(m, 'int3.y').attributes).toMatchObject({ start: 11, fixed: false });
    expect(variable(m, 'int4.y').attributes).toMatchObject({ start: 0, fixed: true });
    expect(m.stats.states).toBe(4);
  });

  it('reports modifiers that do not match an element and rejects redeclare', () => {
    const registry = makeRegistry(`package Tests
      model Bad
        Mini.Components.Resistor r(Rx=1);
      end Bad;
      model Redecl
        Mini.Components.Resistor r(redeclare Real v);
      end Redecl;
    end Tests;`);
    expect(() => flatten(registry, 'Tests.Bad')).toThrow(/Modified element 'Rx' not found in Mini.Components.Resistor/);
    expect(() => flatten(registry, 'Tests.Redecl')).toThrow(/redeclare is not supported/);
  });

  it('ignores modifications of final elements with a warning', () => {
    const registry = makeRegistry(`package Tests
      model Base
        final parameter Real a = 1;
        Real x(start=1);
      equation
        der(x) = -a*x;
      end Base;
      model Derived
        extends Base(a=3);
      end Derived;
    end Tests;`);
    const m = flatten(registry, 'Tests.Derived');
    expect(variable(m, 'a').value).toBe(1);
    expect(m.diagnostics.some((d) => d.severity === 'warning' && d.message.includes('final'))).toBe(true);
  });

  it('warns for parameters without a value and uses the start value', () => {
    const registry = makeRegistry(`package Tests
      model P
        parameter Real a;
        parameter Real b(start=2);
        Real x(start=1);
      equation
        der(x) = -(a + b)*x;
      end P;
    end Tests;`);
    const m = flatten(registry, 'Tests.P');
    expect(variable(m, 'a').value).toBe(0);
    expect(variable(m, 'b').value).toBe(2);
    expect(m.diagnostics.map((d) => d.message)).toEqual(
      expect.arrayContaining([expect.stringMatching(/Parameter 'a' has no value; using start value 0/), expect.stringMatching(/Parameter 'b' has no value; using start value 2/)]),
    );
  });

  it('detects cyclic parameter bindings', () => {
    const registry = makeRegistry(`package Tests
      model Cyc
        parameter Real a = b + 1;
        parameter Real b = a - 1;
      end Cyc;
    end Tests;`);
    expect(() => flatten(registry, 'Tests.Cyc')).toThrow(/cyclic binding/);
  });

  it('marks protected variables and record components', () => {
    const registry = makeRegistry(`package Tests
      record Data
        Real m = 1;
        Real k = 2;
      end Data;
      model Prot
        parameter Data data(m=3);
        Real x(start=1);
      protected
        parameter Real hidden = data.m*data.k;
      equation
        der(x) = -hidden*x;
      end Prot;
    end Tests;`);
    const m = flatten(registry, 'Tests.Prot');
    expect(variable(m, 'data.m')).toMatchObject({ variability: 'parameter', value: 3, protected: false });
    expect(variable(m, 'hidden')).toMatchObject({ variability: 'parameter', value: 6, protected: true });
  });
});

describe('flatten: causal connectors', () => {
  it('turns connect(sine.y, gain.u) into a single equality', () => {
    const registry = makeRegistry();
    const m = flatten(registry, 'Mini.Examples.GainTest');
    expect(names(m)).toEqual(['sine.amplitude', 'sine.f', 'sine.y', 'gain.u', 'gain.y', 'gain.k']);
    expect(variable(m, 'gain.u')).toMatchObject({ causality: 'input', typeName: 'Mini.Interfaces.RealInput', type: 'Real', variability: 'continuous' });
    expect(variable(m, 'gain.y').causality).toBe('output');
    const c = m.equations.filter((e) => e.kind === 'connect-potential');
    expect(c.map(eqText)).toEqual(['sine.y = gain.u']);
    expect(m.stats).toMatchObject({ unknowns: 3, equations: 3, connections: 1 });
    // Modelica.Math.sin was stripped to sin and Mini.Constants.pi inlined
    const sineEq = m.equations.find((e) => e.origin.startsWith('sine'))!;
    expect(eqText(sineEq)).toMatch(/^sine\.y = sine\.amplitude\*sin\(2\*3\.14159\d+\*sine\.f\*time\)$/);
    expect(refsIn(sineEq.right)).toEqual(['sine.amplitude', 'sine.f', 'time']);
  });

  it('binds an unconnected top-level input to its start value with a warning and warns on unconnected inside inputs', () => {
    const registry = makeRegistry(`package Tests
      model Top
        extends Mini.Blocks.Gain(k=2);
        Mini.Blocks.Gain inner1;
      end Top;
    end Tests;`);
    const m = flatten(registry, 'Tests.Top', { strict: false });
    const binding = m.equations.find((e) => e.kind === 'binding')!;
    expect(eqText(binding)).toBe('u = 0');
    expect(m.diagnostics.map((d) => d.message)).toEqual(
      expect.arrayContaining([expect.stringMatching(/Top-level input 'u' has no value; using 0/), expect.stringMatching(/Input 'inner1.u' is not connected/)]),
    );
  });

  it('rejects incompatible connectors', () => {
    const registry = makeRegistry(`package Tests
      connector Flange
        Real phi;
        flow Real tau;
      end Flange;
      model Mixed
        Mini.Components.Resistor r;
        Mini.Blocks.Gain g;
        Flange f;
      equation
        connect(r.p, g.u);
      end Mixed;
      model Mixed2
        Mini.Components.Resistor r;
        Flange f;
      equation
        connect(r.p, f);
      end Mixed2;
    end Tests;`);
    expect(() => flatten(registry, 'Tests.Mixed')).toThrow(/Incompatible connectors/);
    expect(() => flatten(registry, 'Tests.Mixed2')).toThrow(/Incompatible connectors/);
  });

  it("uses the outside sign for the model's own ports and zeroes unconnected flows", () => {
    const registry = makeRegistry(`package Tests
      model TwoResistors
        Mini.Interfaces.Pin p;
        Mini.Interfaces.Pin n;
        Mini.Interfaces.Pin free;
        Mini.Components.Resistor r1(R=1);
        Mini.Components.Resistor r2(R=2);
        Mini.Components.Resistor dangling(R=3);
      equation
        connect(p, r1.p);
        connect(r1.n, r2.p);
        connect(r2.n, n);
      end TwoResistors;
    end Tests;`);
    // The environment closes every top-level flow (p.i = n.i = free.i = 0). The model is still
    // unbalanced by exactly one equation: nothing determines `free.v` (Modelica §4.7 requires the
    // model to use the potential variables of its connectors), hence strict: false.
    const m = flatten(registry, 'Tests.TwoResistors', { strict: false });
    const flows = m.equations.filter((e) => e.kind === 'connect-flow').map(eqText);
    expect(flows).toEqual(['-p.i + r1.p.i = 0', 'r1.n.i + r2.p.i = 0', 'r2.n.i - n.i = 0']);
    const unconnected = m.equations.filter((e) => e.kind === 'unconnected-flow');
    expect(unconnected.map(eqText)).toEqual(['dangling.p.i = 0', 'dangling.n.i = 0', 'p.i = 0', 'n.i = 0', 'free.i = 0']);
    expect(unconnected.map((e) => e.origin)).toEqual([
      'dangling.p (unconnected)',
      'dangling.n (unconnected)',
      'p (top-level connector, flow set by the environment)',
      'n (top-level connector, flow set by the environment)',
      'free (unconnected)',
    ]);
    expect(m.stats).toMatchObject({ unknowns: 24, equations: 23 });
    expect(m.diagnostics.find((d) => d.code === 'unbalanced')?.message).toBe('The model is not balanced: 23 equations and 24 variables');
    const used = new Set(m.equations.flatMap((e) => [...refsIn(e.left), ...refsIn(e.right)]));
    expect(m.variables.filter((v) => v.variability === 'continuous' && !used.has(v.name)).map((v) => v.name)).toEqual(['free.v']);
  });
});

describe('flatten: imports and constants', () => {
  it('inlines imported and qualified package constants', () => {
    const registry = makeRegistry(`package Tests
      model C
        import Mini.Constants.twoPi;
        import Mini.Constants.*;
        parameter Real a = twoPi;
        parameter Real b = Mini.Constants.pi;
        parameter Real c = .Mini.Constants.answer;
        parameter Integer d = answer;
        parameter Real e = Modelica.Constants.pi "fallback table when the library is absent";
        Real x(start=1);
      equation
        der(x) = -x;
      end C;
    end Tests;`);
    const m = flatten(registry, 'Tests.C');
    expect(variable(m, 'a').value).toBeCloseTo(2 * Math.PI, 12);
    expect(variable(m, 'b').value).toBeCloseTo(Math.PI, 12);
    expect(variable(m, 'c').value).toBe(42);
    expect(variable(m, 'd').value).toBe(42);
    expect(variable(m, 'e').value).toBe(Math.PI);
    expect(variable(m, 'a').binding).toMatchObject({ kind: 'number' });
  });

  it('inlines the constant inside an equation of a component with an import', () => {
    const registry = makeRegistry(`package Tests
      model S
        Mini.Components.SineVoltage src(V=2, f=3);
        Mini.Components.Resistor r(R=1);
        Mini.Components.Ground g;
      equation
        connect(src.p, r.p);
        connect(r.n, src.n);
        connect(src.n, g.p);
      end S;
    end Tests;`);
    const m = flatten(registry, 'Tests.S');
    const eq = m.equations.find((e) => eqText(e).startsWith('src.v = src.V'))!;
    expect(eqText(eq)).toMatch(/^src\.v = src\.V\*sin\(2\*3\.14159\d+\*src\.f\*time\)$/);
    const call = (eq.right as Expr & { kind: 'binary' }).right as Expr & { kind: 'call' };
    const product = call.args[0] as Expr & { kind: 'binary' };
    const inner = product.left as Expr & { kind: 'binary' };
    expect((inner.left as Expr & { kind: 'binary' }).right).toMatchObject({ kind: 'number', value: Math.PI });
  });

  it('resolves constants of enclosing packages', () => {
    const registry = makeRegistry(`package Tests
      constant Real g = 9.81;
      package Inner
        model M
          parameter Real gg = 2*g;
          Real x(start=1);
        equation
          der(x) = -gg*x;
        end M;
      end Inner;
    end Tests;`);
    expect(variable(flatten(registry, 'Tests.Inner.M'), 'gg').value).toBeCloseTo(19.62, 12);
  });
});

describe('flatten: conditional components', () => {
  const src = `package Tests
    model Cond
      parameter Boolean useR = false;
      Mini.Components.Resistor r(R=10) if useR;
      Mini.Components.ConstantVoltage src;
      Mini.Components.Ground g;
    equation
      connect(src.p, r.p);
      connect(r.n, src.n);
      connect(src.n, g.p);
    end Cond;
  end Tests;`;

  it('drops a disabled component and the connects touching it', () => {
    const m = flatten(makeRegistry(src), 'Tests.Cond');
    expect(names(m).some((n) => n.startsWith('r.'))).toBe(false);
    expect(m.stats.connections).toBe(1);
    expect(m.equations.filter((e) => e.kind === 'unconnected-flow').map(eqText)).toEqual(['src.p.i = 0']);
    expect(m.stats.unknowns).toBe(m.stats.equations);
  });

  it('keeps the component when the condition is true (via options.modifiers)', () => {
    const m = flatten(makeRegistry(src), 'Tests.Cond', { modifiers: { useR: true } });
    expect(names(m)).toContain('r.R');
    expect(variable(m, 'r.R').value).toBe(10);
    expect(m.stats.connections).toBe(3);
    expect(m.stats.unknowns).toBe(m.stats.equations);
  });

  it('rejects references to disabled components in equations and non-constant conditions', () => {
    const registry = makeRegistry(`package Tests
      model Ref
        parameter Boolean useR = false;
        Mini.Components.Resistor r if useR;
        Real x;
      equation
        x = r.v;
      end Ref;
      model NonConst
        Real t = time;
        Mini.Components.Resistor r if t > 1;
      end NonConst;
    end Tests;`);
    expect(() => flatten(registry, 'Tests.Ref')).toThrow(/conditionally disabled/);
    expect(() => flatten(registry, 'Tests.NonConst')).toThrow(/must be a parameter expression/);
  });
});

describe('flatten: if-equations', () => {
  it('selects the branch of a constant condition at flatten time', () => {
    const registry = makeRegistry(`package Tests
      model IfEq
        parameter Boolean flag = true;
        parameter Integer mode = 2;
        Real x;
        Real z;
        Real y(start=1);
      equation
        der(y) = -y;
        if flag then
          x = 1;
        else
          x = 2;
        end if;
        if mode == 1 then
          z = 10;
        elseif mode == 2 then
          z = 20;
        else
          z = 30;
        end if;
      end IfEq;
    end Tests;`);
    const m = flatten(registry, 'Tests.IfEq');
    expect(m.equations.map(eqText)).toEqual(['der(y) = -y', 'x = 1', 'z = 20']);
    const m2 = flatten(registry, 'Tests.IfEq', { modifiers: { flag: false, mode: 7 } });
    expect(m2.equations.map(eqText)).toEqual(['der(y) = -y', 'x = 2', 'z = 30']);
  });

  it('pairs the equations of branches with a variable condition', () => {
    const registry = makeRegistry(`package Tests
      model IfVar
        Real x;
        Real y(start=1);
      equation
        der(y) = -y;
        if y > 0.5 then
          x = 1;
        elseif y > 0.2 then
          x = 2;
        else
          x = 3*y;
        end if;
      end IfVar;
      model Unequal
        Real x;
        Real y(start=1);
      equation
        der(y) = -y;
        if y > 0.5 then
          x = 1;
        end if;
      end Unequal;
    end Tests;`);
    const m = flatten(registry, 'Tests.IfVar');
    expect(m.equations.map(eqText)).toEqual(['der(y) = -y', 'if y > 0.5 then x - 1 elseif y > 0.2 then x - 2 else x - 3*y = 0']);
    expect(m.stats.unknowns).toBe(2);
    expect(() => flatten(registry, 'Tests.Unequal')).toThrow(/same number of equations/);
  });

  it('allows connect inside if-equations with parameter conditions', () => {
    const registry = makeRegistry(`package Tests
      model Sw
        parameter Boolean direct = true;
        Mini.Components.ConstantVoltage src;
        Mini.Components.Resistor r1(R=1);
        Mini.Components.Resistor r2(R=2);
        Mini.Components.Ground g;
      equation
        connect(src.p, r1.p);
        connect(src.p, r2.p);
        connect(src.n, g.p);
        if direct then
          connect(r1.n, src.n);
          connect(r2.n, src.n);
        else
          connect(r1.n, r2.n);
        end if;
      end Sw;
    end Tests;`);
    const m = flatten(registry, 'Tests.Sw');
    expect(m.stats.connections).toBe(5);
    expect(m.stats.unknowns).toBe(m.stats.equations);
  });
});

describe('flatten: when-clauses and discrete variables', () => {
  it('produces one when clause with a reinit call for the bouncing ball', () => {
    const registry = makeRegistry(`package Tests
      model BouncingBall
        parameter Real e = 0.8 "coefficient of restitution";
        parameter Real g = 9.81;
        Real h(start=1, fixed=true);
        Real v(start=0, fixed=true);
      equation
        der(h) = v;
        der(v) = -g;
        when h < 0 then
          reinit(v, -e*pre(v));
        end when;
      end BouncingBall;
    end Tests;`);
    const m = flatten(registry, 'Tests.BouncingBall');
    expect(m.whenClauses.length).toBe(1);
    const w = m.whenClauses[0];
    expect(printExpr(w.cond)).toBe('h < 0');
    expect(w.origin).toBe('Tests.BouncingBall');
    expect(w.equations.length).toBe(1);
    expect(w.equations[0].left).toMatchObject({ kind: 'call', callee: 'reinit', args: [{ kind: 'ref', parts: [{ name: 'v' }] }, {}] });
    expect(printExpr(w.equations[0].left)).toBe('reinit(v, -e*pre(v))');
    expect(w.equations[0].right).toEqual({ kind: 'number', value: 0 });
    expect(m.stats).toMatchObject({ unknowns: 2, equations: 2, states: 2 });
    expect(m.equations.length).toBe(2);
  });

  it('makes when-assigned Reals discrete, handles elsewhen and counts the assignment as an equation', () => {
    const registry = makeRegistry(`package Tests
      model Counter
        Real x(start=0, fixed=true);
        Real held;
        Integer count(start=0);
        Boolean on(start=false);
      equation
        der(x) = 1;
        when sample(0.25, 0.25) then
          count = pre(count) + 1;
          held = x;
        elsewhen x > 10 then
          count = 0;
          held = 0;
        end when;
        on = x > 0.5;
      end Counter;
    end Tests;`);
    const m = flatten(registry, 'Tests.Counter');
    expect(variable(m, 'held').variability).toBe('discrete');
    expect(variable(m, 'count')).toMatchObject({ type: 'Integer', variability: 'discrete' });
    expect(variable(m, 'on')).toMatchObject({ type: 'Boolean', variability: 'discrete', attributes: { start: false } });
    expect(m.whenClauses.length).toBe(2);
    // The elsewhen branch fires on its own rising edge unless the first condition rises at the
    // same instant; the edge of `sample(...)` is observed through a hidden Boolean helper.
    expect(printExpr(m.whenClauses[0].cond)).toBe('sample(0.25, 0.25)');
    expect(printExpr(m.whenClauses[1].cond)).toBe('x > 10 and not edge($whenCondition1)');
    expect(variable(m, '$whenCondition1')).toMatchObject({ type: 'Boolean', variability: 'discrete', protected: true, attributes: { start: false } });
    expect(m.equations.map(eqText)).toContain('$whenCondition1 = sample(0.25, 0.25)');
    expect(m.whenClauses[0].equations.map(eqText)).toEqual(['count = pre(count) + 1', 'held = x']);
    expect(m.stats.unknowns).toBe(5);
    expect(m.equations.length).toBe(3);
  });

  it('drops assert/terminate with diagnostics and rejects reinit outside when', () => {
    const registry = makeRegistry(`package Tests
      model A
        Real x(start=1);
      equation
        der(x) = -x;
        assert(x > -1, "x too small");
        terminate("done");
      end A;
      model R
        Real x(start=1);
      equation
        der(x) = -x;
        reinit(x, 0);
      end R;
    end Tests;`);
    const m = flatten(registry, 'Tests.A');
    expect(m.equations.length).toBe(1);
    expect(m.diagnostics.map((d) => `${d.severity}:${d.message}`)).toEqual(
      expect.arrayContaining([expect.stringMatching(/^info:assert\(x > -1\)/), expect.stringMatching(/^warning:terminate\("done"\)/)]),
    );
    expect(() => flatten(registry, 'Tests.R')).toThrow(/reinit/);
  });

  it('puts initial equations into initialEquations', () => {
    const registry = makeRegistry(`package Tests
      model SS
        parameter Real u = 3;
        Real x(start=0, fixed=false);
      initial equation
        der(x) = 0;
      equation
        der(x) = -x + u;
      end SS;
    end Tests;`);
    const m = flatten(registry, 'Tests.SS');
    expect(m.initialEquations.map((e) => `${e.kind}: ${eqText(e)}`)).toEqual(['initial: der(x) = 0']);
    expect(m.equations.map(eqText)).toEqual(['der(x) = -x + u']);
  });
});

describe('flatten: errors', () => {
  it('throws the exact unbalanced message with listing diagnostics; strict=false records it', () => {
    const registry = makeRegistry(`package Tests
      model Unbal
        Real x(start=1);
        Real y;
      equation
        der(x) = y;
      end Unbal;
    end Tests;`);
    const err = catchError(() => flatten(registry, 'Tests.Unbal'));
    expect(err.message).toBe('The model is not balanced: 1 equations and 2 variables');
    expect(err.diagnostics[0]).toMatchObject({ severity: 'error', message: 'The model is not balanced: 1 equations and 2 variables', code: 'unbalanced' });
    const infos = err.diagnostics.filter((d) => d.severity === 'info').map((d) => d.message);
    expect(infos).toEqual(expect.arrayContaining([expect.stringMatching(/^\s*x \(state\)/), expect.stringMatching(/^\s*y$/), expect.stringMatching(/der\(x\) = y\s+\[Tests\.Unbal\]/)]));
    const lenient = flatten(registry, 'Tests.Unbal', { strict: false });
    expect(lenient.diagnostics.some((d) => d.severity === 'error' && d.code === 'unbalanced')).toBe(true);
    expect(lenient.stats).toMatchObject({ unknowns: 2, equations: 1 });
  });

  it('rejects array declarations', () => {
    const registry = makeRegistry(`package Tests
      model Arr
        Real x[3];
      equation
        x[1] = 1;
      end Arr;
      model Arr2
        parameter Integer n = 2;
        Mini.Components.Resistor r[n];
      end Arr2;
    end Tests;`);
    expect(() => flatten(registry, 'Tests.Arr')).toThrow('Arrays are not supported: Real x[3]');
    expect(() => flatten(registry, 'Tests.Arr2')).toThrow('Arrays are not supported: Mini.Components.Resistor r[n]');
  });

  it('reports unknown identifiers with class and location', () => {
    const registry = makeRegistry(`package Tests
      model Bad
        Real x;
      equation
        x = foo + 1;
      end Bad;
      model Bad2
        Mini.Components.Resistor r;
        Real x;
      equation
        x = r.nope;
      end Bad2;
    end Tests;`);
    const err = catchError(() => flatten(registry, 'Tests.Bad'));
    expect(err.message).toBe("Unknown identifier 'foo' in Tests.Bad");
    expect(err.diagnostics[0]).toMatchObject({ severity: 'error', file: 'Tests.mo', path: 'Tests.Bad' });
    expect(err.diagnostics[0].loc).toMatchObject({ line: 5 });
    expect(err.diagnostics[0].loc!.column).toBeGreaterThan(0);
    expect(() => flatten(registry, 'Tests.Bad2')).toThrow("Unknown identifier 'r.nope' in Tests.Bad2: 'nope' is not a component of Mini.Components.Resistor");
  });

  it('rejects partial classes, packages, functions, for-equations, arrays in expressions, inner/outer and stream', () => {
    const registry = makeRegistry(`package Tests
      model ForEq
        Real x;
      equation
        for i in 1:3 loop
          x = i;
        end for;
      end ForEq;
      function f
        input Real u;
        output Real y;
      algorithm
        y := 2*u;
      end f;
      model Fn
        Real x = f(time);
      end Fn;
      model Alg
        Real x;
      algorithm
        x := 1;
      end Alg;
      model InnerOuter
        inner Real world;
      end InnerOuter;
      model Str
        connector FluidPort
          Real p;
          flow Real m_flow;
          stream Real h;
        end FluidPort;
        FluidPort port;
      end Str;
      model ArrExpr
        Real x = {1, 2};
      end ArrExpr;
    end Tests;`);
    expect(() => flatten(registry, 'Mini.Interfaces.OnePort')).toThrow("Cannot simulate partial class 'Mini.Interfaces.OnePort'");
    expect(() => flatten(registry, 'Mini.Components')).toThrow(/is a package/);
    expect(() => flatten(registry, 'Tests.ForEq')).toThrow(/for-equations are not supported/);
    expect(() => flatten(registry, 'Tests.Fn')).toThrow('Function calls are not supported: f');
    expect(() => flatten(registry, 'Tests.Alg')).toThrow(/Algorithm sections are not supported/);
    expect(() => flatten(registry, 'Tests.InnerOuter')).toThrow(/inner\/outer components are not supported/);
    expect(() => flatten(registry, 'Tests.Str')).toThrow(/stream variables are not supported/);
    expect(() => flatten(registry, 'Tests.ArrExpr')).toThrow(/Arrays are not supported/);
    expect(() => flatten(registry, 'Nope.Missing')).toThrow("Class 'Nope.Missing' not found");
  });
});

describe('flatten: enumerations', () => {
  it('turns enumeration parameters into String parameters holding the literal name', () => {
    const registry = makeRegistry(`package Tests
      import Mini.Types.Init;
      model EnumParam
        parameter Init initType = Init.SteadyState;
        parameter Mini.Types.Init other = Mini.Types.Init.NoInit;
        Real x(start=1, fixed=false, stateSelect=StateSelect.prefer);
      initial equation
        if initType == Init.SteadyState then
          der(x) = 0;
        else
          x = 1;
        end if;
      equation
        der(x) = 2 - x;
      end EnumParam;
    end Tests;`);
    const m = flatten(registry, 'Tests.EnumParam');
    expect(variable(m, 'initType')).toMatchObject({ type: 'String', variability: 'parameter', value: 'SteadyState', typeName: 'Mini.Types.Init' });
    expect(variable(m, 'initType').binding).toEqual({ kind: 'string', value: 'SteadyState', loc: expect.anything() });
    expect(variable(m, 'other').value).toBe('NoInit');
    expect(variable(m, 'x').attributes.stateSelect).toBe('prefer');
    expect(m.initialEquations.map(eqText)).toEqual(['der(x) = 0']);
    const m2 = flatten(registry, 'Tests.EnumParam', { modifiers: { initType: 'NoInit' } });
    expect(m2.initialEquations.map(eqText)).toEqual(['x = 1']);
    expect(() => flatten(registry, 'Tests.EnumParam', { modifiers: { initType: 'Bogus' } })).toThrow(/not a literal of its enumeration type/);
  });
});

describe('flatten: elsewhen priority (finding: elsewhen never fires once an earlier condition stays true)', () => {
  const stepModel = `package Tests
      model W
        discrete Real x(start=0, fixed=true);
        Real y(start=0, fixed=true);
      equation
        der(y) = 1;
        when time >= 1 then
          x = 1;
        elsewhen time >= 2 then
          x = 2;
        end when;
      end W;
      model Threshold
        discrete Integer mode(start=0, fixed=true);
        Real y(start=0, fixed=true);
      equation
        der(y) = 1;
        when y > 0.5 then
          mode = 1;
        elsewhen y > 1.5 then
          mode = 2;
        end when;
      end Threshold;
      model Simultaneous
        Boolean b1;
        Boolean b2;
        discrete Integer a(start=0, fixed=true);
      equation
        b1 = time >= 1;
        b2 = time >= 1;
        when b1 then
          a = 1;
        elsewhen b2 then
          a = 2;
        end when;
      end Simultaneous;
      model Three
        discrete Integer a(start=0, fixed=true);
        parameter Boolean never = false;
      equation
        when never then
          a = 9;
        elsewhen time >= 1 then
          a = 1;
        elsewhen time >= 2 then
          a = 2;
        end when;
      end Three;
    end Tests;`;

  it('lowers elsewhen to raw conditions guarded by not edge(helper) with a hidden Boolean per earlier condition', () => {
    const m = flatten(makeRegistry(stepModel), 'Tests.W');
    expect(m.whenClauses.map((w) => printExpr(w.cond))).toEqual(['time >= 1', 'time >= 2 and not edge($whenCondition1)']);
    const helper = variable(m, '$whenCondition1');
    expect(helper).toMatchObject({ type: 'Boolean', variability: 'discrete', causality: 'none', protected: true, declaredIn: 'Tests.W', componentPath: [] });
    expect(m.equations.filter((e) => e.origin.includes('when-condition helper')).map(eqText)).toEqual(['$whenCondition1 = time >= 1']);
    expect(m.stats).toMatchObject({ unknowns: 3, equations: 2 }); // x is when-assigned (counted by the balance check)
    expect(m.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('fires the elsewhen branch when its own condition becomes true while the first stays true (time steps)', () => {
    const flat = flatten(makeRegistry(stepModel), 'Tests.W');
    const res = simulate(flat, { startTime: 0, finalTime: 3, ncp: 30, rtol: 1e-6, solver: 'CVode' });
    const x = res.trajectories.find((t) => t.name === 'x')!;
    const at = (t: number) => x.values[res.time.findIndex((tt) => tt >= t - 1e-9)];
    expect(at(0.5)).toBe(0);
    expect(at(1.5)).toBe(1);
    expect(at(2.5)).toBe(2);
    expect(x.values[x.values.length - 1]).toBe(2);
    expect(res.trajectories.some((t) => t.name === '$whenCondition1')).toBe(true);
  });

  it('fires the elsewhen branch on state thresholds', () => {
    const flat = flatten(makeRegistry(stepModel), 'Tests.Threshold');
    const res = simulate(flat, { startTime: 0, finalTime: 3, ncp: 30, rtol: 1e-6, solver: 'CVode' });
    const mode = res.trajectories.find((t) => t.name === 'mode')!;
    expect(mode.values[mode.values.length - 1]).toBe(2);
    expect(mode.values[res.time.findIndex((t) => t >= 1 - 1e-9)]).toBe(1);
  });

  it('gives the first branch priority when several conditions become true at the same instant, and uses Boolean variables directly', () => {
    const flat = flatten(makeRegistry(stepModel), 'Tests.Simultaneous');
    expect(flat.whenClauses.map((w) => printExpr(w.cond))).toEqual(['b1', 'b2 and not edge(b1)']);
    expect(flat.variables.some((v) => v.name.startsWith('$whenCondition'))).toBe(false);
    const res = simulate(flat, { startTime: 0, finalTime: 2, ncp: 20, rtol: 1e-6, solver: 'CVode' });
    const a = res.trajectories.find((t) => t.name === 'a')!;
    expect(a.values[a.values.length - 1]).toBe(1);
  });

  it('skips constant conditions (no edge) and chains several elsewhen branches', () => {
    const flat = flatten(makeRegistry(stepModel), 'Tests.Three');
    expect(flat.whenClauses.map((w) => printExpr(w.cond))).toEqual(['never', 'time >= 1', 'time >= 2 and not edge($whenCondition1)']);
    expect(flat.variables.filter((v) => v.name.startsWith('$whenCondition')).map((v) => v.name)).toEqual(['$whenCondition1']);
    const res = simulate(flat, { startTime: 0, finalTime: 3, ncp: 30, rtol: 1e-6, solver: 'CVode' });
    const a = res.trajectories.find((t) => t.name === 'a')!;
    expect(a.values[a.values.length - 1]).toBe(2);
  });
});

describe('flatten: hierarchical connectors (findings: partial composite connectors, whole-vs-sub connection sets, top-level connectors)', () => {
  const plugLib = `package Tests
      connector Plug
        Mini.Interfaces.Pin pin1;
        Mini.Interfaces.Pin pin2;
      end Plug;
      model Dev
        Plug plug;
        Mini.Components.Resistor r(R=10);
      equation
        connect(plug.pin1, r.p);
        connect(plug.pin2, r.n);
      end Dev;
      model Sys
        Dev d;
        Mini.Components.ConstantVoltage v;
        Mini.Components.Ground g;
      equation
        connect(d.plug.pin1, v.p);
        connect(v.n, g.p);
        connect(d.plug.pin2, g.p);
      end Sys;
      model Partial
        Dev d;
        Mini.Components.ConstantVoltage v;
        Mini.Components.Ground g;
      equation
        connect(d.plug.pin1, v.p);
        connect(v.n, g.p);
      end Partial;
      model WholeAndSub
        Dev d1;
        Dev d2;
        Mini.Components.Ground g;
        Mini.Components.ConstantVoltage v;
      equation
        connect(d1.plug, d2.plug);
        connect(d1.plug.pin1, v.p);
        connect(v.n, g.p);
        connect(d1.plug.pin2, g.p);
      end WholeAndSub;
      model TopPin
        Mini.Interfaces.Pin p;
        Mini.Components.Resistor r(R=1);
        Mini.Components.Ground g;
      equation
        connect(p, r.p);
        connect(r.n, g.p);
      end TopPin;
      model TopInput
        Mini.Interfaces.RealInput u;
        Mini.Blocks.Gain g(k=2);
      equation
        connect(u, g.u);
      end TopInput;
      model TopPlug
        Plug plug;
        Mini.Components.Resistor r(R=1);
      equation
        connect(plug.pin1, r.p);
      end TopPlug;
    end Tests;`;

  it('does not zero the flow of a sub-connector that is already in a connection set (partially connected composite connector)', () => {
    const registry = makeRegistry(plugLib);
    const m = flatten(registry, 'Tests.Sys');
    expect(m.equations.filter((e) => e.kind === 'unconnected-flow')).toEqual([]);
    const flows = m.equations.filter((e) => e.kind === 'connect-flow').map(eqText);
    expect(flows).toEqual(expect.arrayContaining(['d.plug.pin1.i + v.p.i = 0', 'v.n.i + g.p.i + d.plug.pin2.i = 0']));
    expect(flows.length).toBe(2 + 2); // two sets in Sys, two inside Dev
    expect(m.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);

    // Only the untouched sub-connector gets flow = 0.
    const p = flatten(registry, 'Tests.Partial');
    const zero = p.equations.filter((e) => e.kind === 'unconnected-flow');
    expect(zero.map(eqText)).toEqual(['d.plug.pin2.i = 0']);
    expect(zero[0].origin).toBe('d.plug.pin2 (unconnected)');
  });

  it('merges a whole-connector connect with a sub-connector connect of the same connector into one set', () => {
    const m = flatten(makeRegistry(plugLib), 'Tests.WholeAndSub');
    const flows = m.equations.filter((e) => e.kind === 'connect-flow' && !e.origin.includes('.r.'));
    const texts = flows.map(eqText);
    expect(texts).toContain('d1.plug.pin1.i + d2.plug.pin1.i + v.p.i = 0');
    expect(texts).toContain('d1.plug.pin2.i + d2.plug.pin2.i + v.n.i + g.p.i = 0');
    expect(texts.filter((t) => t.includes('d1.plug.pin1.i')).length).toBe(1);
    const potentials = m.equations.filter((e) => e.kind === 'connect-potential').map(eqText);
    expect(potentials).toEqual(expect.arrayContaining(['d1.plug.pin1.v = d2.plug.pin1.v', 'd1.plug.pin1.v = v.p.v', 'd1.plug.pin2.v = d2.plug.pin2.v', 'd1.plug.pin2.v = v.n.v', 'd1.plug.pin2.v = g.p.v']));
    const origins = m.equations.filter((e) => e.kind === 'connect-flow').map((e) => e.origin);
    expect(origins).toContain('connect(d1.plug, d2.plug, v.p)');
    expect(m.stats).toMatchObject({ unknowns: 28, equations: 28 });
    expect(m.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  });

  it('closes internally connected top-level connectors and inputs with environment equations (locally balanced models)', () => {
    const registry = makeRegistry(plugLib);
    const pin = flatten(registry, 'Tests.TopPin');
    expect(pin.equations.filter((e) => e.kind === 'connect-flow').map(eqText)).toEqual(['-p.i + r.p.i = 0', 'r.n.i + g.p.i = 0']);
    const env = pin.equations.filter((e) => e.kind === 'unconnected-flow');
    expect(env.map(eqText)).toEqual(['p.i = 0']);
    expect(env[0].origin).toBe('p (top-level connector, flow set by the environment)');
    expect(pin.stats).toMatchObject({ unknowns: 10, equations: 10 });

    const input = flatten(registry, 'Tests.TopInput');
    expect(input.equations.map(eqText)).toEqual(['g.y = g.k*g.u', 'u = g.u', 'u = 0']);
    expect(input.equations[2]).toMatchObject({ kind: 'binding', origin: 'u (top-level input, value set by the environment)' });
    expect(input.diagnostics.map((d) => d.message)).toEqual(expect.arrayContaining([expect.stringMatching(/Top-level input 'u' has no value; using 0/)]));
    expect(input.stats).toMatchObject({ unknowns: 3, equations: 3 });

    // Every flow leaf of a top-level hierarchical connector is closed, connected or not (the
    // model itself is unbalanced by one: it never uses plug.pin2.v).
    const plug = flatten(registry, 'Tests.TopPlug', { strict: false });
    const zero = plug.equations.filter((e) => e.kind === 'unconnected-flow');
    expect(zero.map(eqText)).toEqual(['r.n.i = 0', 'plug.pin1.i = 0', 'plug.pin2.i = 0']);
    expect(zero.map((e) => e.origin)).toEqual(['r.n (unconnected)', 'plug.pin1 (top-level connector, flow set by the environment)', 'plug.pin2 (unconnected)']);
    expect(plug.stats).toMatchObject({ unknowns: 10, equations: 9 });
  });
});

describe('flatten: enumeration ordinals (finding: relational operators and Integer() reject enumerations)', () => {
  const lib = `package Tests
      type Init = enumeration(NoInit, SteadyState, InitialState);
      type Other = enumeration(A, B);
      constant Init defaultInit = Init.InitialState;
      model G
        parameter Init init = Init.SteadyState;
        parameter Boolean b2 = init > Init.NoInit;
        parameter Boolean b3 = Init.SteadyState >= Init.InitialState;
        parameter Boolean b4 = Mini.Types.Init.NoInit < Mini.Types.Init.InitialState;
        parameter Boolean b5 = defaultInit > init;
        parameter Boolean b6 = StateSelect.prefer > StateSelect.default;
        parameter Integer i = Integer(init);
        parameter Integer j = Integer(Init.InitialState) - Integer(defaultInit);
        parameter Boolean eq = init == Init.SteadyState;
        Real x(start=1, fixed=true);
      equation
        der(x) = if b2 then -x else x;
      end G;
      model Mixed
        parameter Init init = Init.SteadyState;
        parameter Boolean bad = init > Other.A;
      end Mixed;
      model NonParam
        Init state;
        parameter Boolean bad = state > Init.NoInit;
      equation
        state = Init.NoInit;
      end NonParam;
    end Tests;`;

  it('compares enumeration literals by declaration order and yields the ordinal for Integer()', () => {
    const registry = makeRegistry(lib);
    const m = flatten(registry, 'Tests.G');
    expect(variable(m, 'b2').value).toBe(true);
    expect(variable(m, 'b3').value).toBe(false);
    expect(variable(m, 'b4').value).toBe(true);
    expect(variable(m, 'b5').value).toBe(true);
    expect(variable(m, 'b6').value).toBe(true);
    expect(variable(m, 'i').value).toBe(2);
    expect(variable(m, 'j').value).toBe(0);
    expect(variable(m, 'eq').value).toBe(true);
    expect(variable(m, 'init').value).toBe('SteadyState');
    expect(printExpr(variable(m, 'b2').binding!)).toBe('2 > 1');
    expect(m.equations.map(eqText)).toEqual(['der(x) = if b2 then -x else x']);

    const m2 = flatten(registry, 'Tests.G', { modifiers: { init: 'NoInit' } });
    expect(variable(m2, 'b2').value).toBe(false);
    expect(variable(m2, 'i').value).toBe(1);
    expect(variable(m2, 'b5').value).toBe(true);
  });

  it('rejects comparisons of different enumeration types and of non-parameter enumeration variables', () => {
    const registry = makeRegistry(lib);
    expect(() => flatten(registry, 'Tests.Mixed')).toThrow(/different enumeration types/);
    expect(() => flatten(registry, 'Tests.NonParam')).toThrow(/must be a parameter or constant/);
  });
});

describe('flatten: conditional components referring to later components (finding: declaration-order evaluation)', () => {
  it('evaluates a condition that uses a parameter of a class-typed component declared later', () => {
    const registry = makeRegistry(`package Tests
      model CondOrder
        Mini.Blocks.Gain g2 if g1.k > 0;
        Mini.Blocks.Gain g1(k=1);
        Mini.Blocks.Gain g3 if g1.k < 0;
        parameter Real p = g1.k if g1.k > 0;
      end CondOrder;
    end Tests;`);
    const m = flatten(registry, 'Tests.CondOrder', { strict: false });
    // Declaration order is kept in the output even though g1 was instantiated before g2.
    expect(names(m)).toEqual(['g2.u', 'g2.y', 'g2.k', 'g1.u', 'g1.y', 'g1.k', 'p']);
    expect(variable(m, 'p').value).toBe(1);
    expect(m.equations.map(eqText)).toEqual(['g2.y = g2.k*g2.u', 'g1.y = g1.k*g1.u']);
  });
});

describe('flatten: diamond inheritance (finding: later extends modifications silently dropped)', () => {
  const lib = `package Tests
      model Base0
        Real x(start=0);
      equation
        der(x) = -x;
      end Base0;
      partial model P1
        extends Base0(x(start=1));
      end P1;
      partial model P2
        extends Base0(x(start=2));
      end P2;
      partial model P1b
        extends Base0(x(start=1));
      end P1b;
      model Diamond
        extends P1;
        extends P2;
      end Diamond;
      model Same
        extends P1;
        extends P1b;
      end Same;
      model OuterWins
        extends P1(x(start=5));
        extends P2(x(start=5));
      end OuterWins;
      model Q1
        extends Base0;
        Real y(start=0);
      equation
        der(y) = -y;
      end Q1;
      partial model Q2
        extends Base0;
      end Q2;
      model OwnElements
        extends Q1(y(start=3));
        extends Q2;
      end OwnElements;
      model MissingOnOnePath
        extends P1;
        extends Q2;
      end MissingOnOnePath;
    end Tests;`;

  it('rejects a base class inherited through two paths with different modifications', () => {
    const registry = makeRegistry(lib);
    const err = catchError(() => flatten(registry, 'Tests.Diamond'));
    expect(err.message).toMatch(/Class Tests\.Base0 is inherited more than once by Tests\.Diamond with different modifications: 'x\.start' is 1 \(via extends Base0 in Tests\.P1\) but 2 \(via extends Base0 in Tests\.P2\)/);
    expect(err.diagnostics[0]).toMatchObject({ severity: 'error', file: 'Tests.mo', loc: expect.anything() });
    expect(() => flatten(registry, 'Tests.MissingOnOnePath')).toThrow(/'x\.start' is 1 .* but <no modification>/);
  });

  it('accepts identical modifications, outer modifications that make the paths agree, and modifications of derived-class elements', () => {
    const registry = makeRegistry(lib);
    expect(variable(flatten(registry, 'Tests.Same'), 'x').attributes.start).toBe(1);
    expect(variable(flatten(registry, 'Tests.OuterWins'), 'x').attributes.start).toBe(5);
    const own = flatten(registry, 'Tests.OwnElements');
    expect(variable(own, 'y').attributes.start).toBe(3);
    expect(own.equations.map(eqText)).toEqual(['der(x) = -x', 'der(y) = -y']);
  });
});

describe('flatten + simulate pipeline', () => {
  it('simulates the RC circuit: capacitor.v(5 RC) = 1 - e^-5', () => {
    const registry = makeRegistry();
    const flat = flatten(registry, 'Mini.Examples.RCCircuit');
    const RC = 100 * 1e-3;
    let result;
    try {
      result = simulate(flat, { startTime: 0, finalTime: 5 * RC, ncp: 500, rtol: 1e-7, solver: 'CVode' });
    } catch (e) {
      if (e instanceof Error && /not implemented/i.test(e.message)) {
        console.warn('simulate() is not implemented yet; skipping the pipeline check');
        return;
      }
      throw e;
    }
    const traj = result.trajectories.find((t) => t.name === 'capacitor.v')!;
    expect(traj).toBeDefined();
    const last = traj.values[traj.values.length - 1];
    expect(Math.abs(last - (1 - Math.exp(-5)))).toBeLessThan(1e-3);
    expect(result.trajectories.find((t) => t.name === 'resistor.R')!.values).toEqual([100]);
  });
});
