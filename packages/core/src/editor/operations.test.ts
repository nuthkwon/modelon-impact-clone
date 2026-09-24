import { afterAll, describe, expect, it } from 'vitest';
import type { ClassDef, ComponentDecl, Equation, Modifier } from '../ast.js';
import type { EditOperation, EditResult } from '../diagram.js';
import { parseConnectionLine, parseExperiment, parsePlacement } from '../graphics/annotations.js';
import { parse } from '../parser/parser.js';
import { printClass, printExpr } from '../parser/printer.js';
import { ClassRegistry } from '../registry.js';
import {
  applyEdit,
  canonicalizeTransformation,
  findClassDef,
  generateComponentName,
  isValidIdentifier,
  listConnectorRefs,
  normalizeSignedAngle,
} from './operations.js';

// -------------------------------------------------------------------------------------------------
// Fixtures
// -------------------------------------------------------------------------------------------------

const MODELICA = `package Modelica "Mini standard library"
  package Units
    package SI
      type Voltage = Real(unit="V");
      type Current = Real(unit="A");
      type Resistance = Real(unit="Ohm");
    end SI;
  end Units;
  package Constants
    constant Real pi = 3.14159265358979;
  end Constants;
  package Blocks
    package Interfaces
      connector RealInput = input Real "'input Real' as connector"
        annotation(Icon(coordinateSystem(extent={{-100,-100},{100,100}}), graphics={Polygon(points={{-100,100},{100,0},{-100,-100},{-100,100}}, lineColor={0,0,127}, fillColor={0,0,127}, fillPattern=FillPattern.Solid)}));
      connector RealOutput = output Real "'output Real' as connector";
      partial block SO
        RealOutput y annotation(Placement(transformation(extent={{100,-10},{120,10}})));
      end SO;
    end Interfaces;
    package Sources
      block Sine "Sine signal"
        extends Interfaces.SO;
        parameter Real amplitude = 1;
        parameter Real f(start = 1);
      equation
        y = amplitude*sin(2*Modelica.Constants.pi*f*time);
        annotation(defaultComponentName="sine", Icon(coordinateSystem(extent={{-100,-100},{100,100}})));
      end Sine;
    end Sources;
    package Math
      block Gain
        extends Interfaces.SO;
        Interfaces.RealInput u annotation(Placement(transformation(extent={{-140,-20},{-100,20}})));
        parameter Real k = 1;
      equation
        y = k*u;
      end Gain;
    end Math;
  end Blocks;
  package Electrical
    package Analog
      package Interfaces
        connector Pin
          Modelica.Units.SI.Voltage v;
          flow Modelica.Units.SI.Current i;
          annotation(Icon(coordinateSystem(extent={{-100,-100},{100,100}}), graphics={Rectangle(extent={{-100,-100},{100,100}}, lineColor={0,0,255}, fillColor={0,0,255}, fillPattern=FillPattern.Solid)}));
        end Pin;
        partial model OnePort
          Pin p annotation(Placement(transformation(extent={{-110,-10},{-90,10}})));
          Pin n annotation(Placement(transformation(extent={{90,-10},{110,10}})));
          Modelica.Units.SI.Voltage v;
          Modelica.Units.SI.Current i;
        equation
          v = p.v - n.v;
          0 = p.i + n.i;
          i = p.i;
        end OnePort;
      end Interfaces;
      package Basic
        model Resistor "Ideal linear electrical resistor"
          extends Interfaces.OnePort;
          parameter Modelica.Units.SI.Resistance R(start = 1) "Resistance";
        equation
          v = R*i;
          annotation(Icon(coordinateSystem(extent={{-100,-100},{100,100}}), graphics={Rectangle(extent={{-70,30},{70,-30}}, lineColor={0,0,255})}));
        end Resistor;
        model Capacitor
          extends Interfaces.OnePort;
          parameter Real C(start = 1) "Capacitance";
        equation
          i = C*der(v);
        end Capacitor;
        model Ground "Ground node"
          Interfaces.Pin p annotation(Placement(transformation(extent={{-10,90},{10,110}}, rotation=270)));
        equation
          p.v = 0;
        end Ground;
      end Basic;
      package Sources
        model SineVoltage "Sine voltage source"
          extends Interfaces.OnePort;
          parameter Real V = 1 "Amplitude";
          parameter Real f = 1 "Frequency";
        equation
          v = V*sin(2*Modelica.Constants.pi*f*time);
        end SineVoltage;
      end Sources;
    end Analog;
  end Electrical;
  package Mechanics
    model World "Global settings"
      parameter Real g = 9.81;
      annotation(defaultComponentName="world", defaultComponentPrefixes="inner");
    end World;
  end Mechanics;
end Modelica;
`;

const EXAMPLES_PATH = 'Examples/Electrical.mo';
const EXAMPLES = `within Examples;
package Electrical "Electrical examples"
  model Circuit "Simple circuit"
    import Modelica.Electrical.Analog.Basic;
    parameter Real R = 100 "Total resistance";
    parameter Real amp(start = 1) "Amplitude";
    Modelica.Electrical.Analog.Basic.Resistor resistor(R=R) annotation(Placement(transformation(extent={{-10,-10},{10,10}})));
    Modelica.Electrical.Analog.Basic.Resistor resistor1(R=200, i(start=0.5)) annotation(Placement(transformation(origin={40,0}, extent={{-10,-10},{10,10}}, rotation=90)));
    Modelica.Electrical.Analog.Basic.Capacitor capacitor(C.start=2) annotation(Placement(transformation(extent={{60,-10},{80,10}})));
    Modelica.Electrical.Analog.Basic.Ground ground annotation(Placement(transformation(extent={{-10,-50},{10,-30}})));
    Modelica.Electrical.Analog.Sources.SineVoltage sineVoltage(V=amp) annotation(Placement(transformation(origin={-40,0}, extent={{-10,-10},{10,10}}, rotation=270)));
    Modelica.Blocks.Sources.Sine sine(amplitude=resistor.R) annotation(Placement(transformation(extent={{-90,50},{-70,70}})));
    Modelica.Blocks.Math.Gain gain annotation(Placement(transformation(extent={{-50,50},{-30,70}})));
    Modelica.Blocks.Interfaces.RealInput u annotation(Placement(transformation(extent={{-120,-20},{-80,20}}), iconTransformation(extent={{-120,-20},{-80,20}})));
    Real power "Dissipated power" annotation(HideResult=true);
  equation
    connect(sineVoltage.p, resistor.p) annotation(Line(points={{-40,10},{-40,20},{-10,20},{-10,0}}, color={0,0,255}));
    connect(resistor.n, resistor1.p) annotation(Line(points={{10,0},{40,0},{40,-10}}, color={0,0,255}));
    connect(ground.p, sineVoltage.n) annotation(Line(points={{0,-30},{-40,-30},{-40,-10}}, color={0,0,255}));
    connect(sine.y, gain.u) annotation(Line(points={{-69,60},{-52,60}}, color={0,0,127}));
    power = resistor.v*resistor.i;
    annotation(experiment(StopTime=10, Tolerance=1e-6), Diagram(coordinateSystem(extent={{-100,-100},{100,100}})));
  end Circuit;

  model Derived "Circuit with a load"
    extends Circuit(R=50);
    Modelica.Electrical.Analog.Basic.Resistor load annotation(Placement(transformation(extent={{60,-50},{80,-30}})));
  equation
    connect(resistor1.n, load.p);
  end Derived;

  model Loose "Component of an unknown class"
    Missing.Type mystery;
  end Loose;

  model Bare
    Real x;
    Modelica.Blocks.Math.Gain g(final k=3);
  end Bare;
end Electrical;

model Other "Another top-level class in the same file"
  Real y;
equation
  y = time;
end Other;
`;

const CIRCUIT = 'Examples.Electrical.Circuit';
const DERIVED = 'Examples.Electrical.Derived';
const LOOSE = 'Examples.Electrical.Loose';
const BARE = 'Examples.Electrical.Bare';
const RESISTOR = 'Modelica.Electrical.Analog.Basic.Resistor';

function makeRegistry(): ClassRegistry {
  const reg = new ClassRegistry();
  reg.addLibrary({ id: 'Modelica', name: 'Modelica', readOnly: true });
  reg.addLibrary({ id: 'Examples', name: 'Examples', readOnly: false });
  expect(reg.addFile('Modelica', 'Modelica.mo', MODELICA)).toEqual([]);
  expect(reg.addFile('Examples', 'Examples/package.mo', 'package Examples "Examples" end Examples;')).toEqual([]);
  expect(reg.addFile('Examples', EXAMPLES_PATH, EXAMPLES)).toEqual([]);
  return reg;
}

/** Shared registry: `applyEdit` must never mutate it (checked in `afterAll`). */
const registry = makeRegistry();
const registrySnapshot = JSON.stringify(registry.fileOf(CIRCUIT)!.definition);

afterAll(() => {
  expect(JSON.stringify(registry.fileOf(CIRCUIT)!.definition)).toBe(registrySnapshot);
  expect(registry.fileOf(CIRCUIT)!.text).toBe(EXAMPLES);
});

/** Removes `loc`/`nameLoc` recursively so ASTs can be compared structurally. */
function stripLoc<T>(value: T): T {
  if (Array.isArray(value)) return value.map(stripLoc) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (k === 'loc' || k === 'nameLoc' || v === undefined) continue;
      out[k] = stripLoc(v);
    }
    return out as T;
  }
  return value;
}

interface Applied {
  result: EditResult;
  cls: ClassDef;
  text: string;
}

/** Applies `op`, asserts success, that the text parses and that the rest of the file is intact. */
function apply(op: EditOperation, className = CIRCUIT, reg = registry): Applied {
  const result = applyEdit(reg, className, op);
  expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  const def = parse(result.text, EXAMPLES_PATH);
  expect(def.within).toBe('Examples');
  expect(def.classes.map((c) => c.name)).toEqual(['Electrical', 'Other']);
  expect(def.classes[0].classes.map((c) => c.name)).toEqual(['Circuit', 'Derived', 'Loose', 'Bare']);
  expect(stripLoc(def.classes[1])).toEqual(stripLoc(parse(EXAMPLES).classes[1]));
  const cls = findClassDef(def, className);
  expect(cls).toBeDefined();
  return { result, cls: cls!, text: result.text };
}

/** Applies `op`, asserts an error diagnostic and that the original text is returned. */
function applyError(op: EditOperation, match: RegExp | string, className = CIRCUIT): EditResult {
  const original = registry.fileOf(className)!.text;
  const result = applyEdit(registry, className, op);
  expect(result.text).toBe(original);
  const errors = result.diagnostics.filter((d) => d.severity === 'error');
  expect(errors.length).toBeGreaterThan(0);
  expect(errors.map((d) => d.message).join('\n')).toMatch(match);
  return result;
}

/** Applies several operations in sequence, committing each result to a private registry. */
function chain(ops: EditOperation[], className = CIRCUIT): Applied {
  const reg = makeRegistry();
  let last: Applied | undefined;
  for (const op of ops) {
    last = apply(op, className, reg);
    expect(reg.addFile('Examples', EXAMPLES_PATH, last.text)).toEqual([]);
  }
  return last!;
}

const comp = (cls: ClassDef, name: string): ComponentDecl => {
  const c = cls.components.find((x) => x.name === name);
  expect(c, `component ${name}`).toBeDefined();
  return c!;
};
const placementOf = (cls: ClassDef, name: string) => {
  const p = parsePlacement(comp(cls, name).annotation);
  expect(p, `placement of ${name}`).toBeDefined();
  return p!;
};
const modNames = (mods: Modifier[] | undefined) => (mods ?? []).map((m) => m.name);
/** A component declaration printed on one line (continuation lines joined). */
const modText = (c: ComponentDecl) => printClass({ ...emptyClass('X'), components: [c] }).split('\n').slice(1, -1).map((l) => l.trim()).join(' ');
const connectText = (eq: Equation) => (eq.kind === 'connect' ? `connect(${printExpr(eq.a)}, ${printExpr(eq.b)})` : '');
const circuitText = (text: string) => {
  const start = text.indexOf('  model Circuit');
  return text.slice(start, text.indexOf('  end Circuit;', start));
};

function emptyClass(name: string): ClassDef {
  return {
    kind: 'class', restriction: 'model', name, partial: false, encapsulated: false, expandable: false,
    extends: [], imports: [], components: [], classes: [], equations: [], initialEquations: [],
  };
}

// -------------------------------------------------------------------------------------------------
// Infrastructure
// -------------------------------------------------------------------------------------------------

describe('applyEdit infrastructure', () => {
  it('throws only for a class without a file', () => {
    expect(() => applyEdit(registry, 'Nope.Missing', { op: 'setDescription', description: 'x' })).toThrow(/no file declares/);
  });

  it('rejects edits of read-only library classes with a diagnostic and the original text', () => {
    const original = registry.fileOf(RESISTOR)!.text;
    const result = applyEdit(registry, RESISTOR, { op: 'addComponent', className: 'Modelica.Electrical.Analog.Basic.Ground', position: [0, 0] });
    expect(result.text).toBe(original);
    expect(result.diagnostics).toEqual([expect.objectContaining({ severity: 'error', message: expect.stringMatching(/read-only library 'Modelica'/) })]);
    const replaced = applyEdit(registry, RESISTOR, { op: 'replaceText', text: 'model X end X;' });
    expect(replaced.text).toBe(original);
    expect(replaced.diagnostics[0].severity).toBe('error');
  });

  it('keeps within, the other top-level class and sibling nested classes intact', () => {
    const { text } = apply({ op: 'setDescription', description: 'Renamed circuit' });
    expect(text.startsWith('within Examples;\n\npackage Electrical "Electrical examples"\n')).toBe(true);
    expect(text).toContain('model Circuit "Renamed circuit"');
    expect(text).toContain('model Derived "Circuit with a load"');
    expect(text).toContain('model Other "Another top-level class in the same file"');
    expect(text.trimEnd().endsWith('end Other;')).toBe(true);
  });

  it('exports identifier validation', () => {
    for (const ok of ['a', '_x1', 'resistor2', "'a b'", 'R']) expect(isValidIdentifier(ok), ok).toBe(true);
    for (const bad of ['', 'model', 'end', '1abc', 'a.b', 'a-b', 'a b', "'"]) expect(isValidIdentifier(bad), bad).toBe(false);
  });
});

// -------------------------------------------------------------------------------------------------
// addComponent
// -------------------------------------------------------------------------------------------------

describe('addComponent', () => {
  it('adds a fully-qualified declaration with an absolute snapped extent after the last component', () => {
    const { result, cls, text } = apply({ op: 'addComponent', className: RESISTOR, position: [33, 41] });
    expect(result.createdName).toBe('resistor2');
    const c = cls.components[cls.components.length - 1];
    expect(c.name).toBe('resistor2');
    expect(c.typeName).toBe(RESISTOR);
    expect(c.prefixes.inner).toBe(false);
    expect(c.modification).toBeUndefined();
    const p = placementOf(cls, 'resistor2');
    expect(p.transformation).toEqual({ origin: [0, 0], extent: [[24, 32], [44, 52]], rotation: 0 });
    expect(p.iconTransformation).toBeUndefined();
    expect(text).toContain('Modelica.Electrical.Analog.Basic.Resistor resistor2');
    expect(text).toContain('Placement(transformation(extent={{24,32},{44,52}}))');
  });

  it('writes rotated components centred on their origin with the rotation normalised to (-180, 180]', () => {
    const rotated = apply({ op: 'addComponent', className: RESISTOR, position: [33, 41], rotation: 90 });
    expect(placementOf(rotated.cls, 'resistor2').transformation).toEqual({ origin: [34, 42], extent: [[-10, -10], [10, 10]], rotation: 90 });
    expect(rotated.text).toContain('transformation(origin={34,42}, extent={{-10,-10},{10,10}}, rotation=90)');
    expect(placementOf(apply({ op: 'addComponent', className: RESISTOR, position: [0, 0], rotation: 270 }).cls, 'resistor2').transformation.rotation).toBe(-90);
    expect(placementOf(apply({ op: 'addComponent', className: RESISTOR, position: [0, 0], rotation: -450 }).cls, 'resistor2').transformation.rotation).toBe(-90);
    expect(placementOf(apply({ op: 'addComponent', className: RESISTOR, position: [0, 0], rotation: 360 }).cls, 'resistor2').transformation.rotation).toBe(0);
  });

  it('honours size and resolves relative class names through imports', () => {
    const { cls, result } = apply({ op: 'addComponent', className: 'Basic.Ground', position: [-60, -60], size: 40 });
    expect(result.createdName).toBe('ground1');
    expect(comp(cls, 'ground1').typeName).toBe('Modelica.Electrical.Analog.Basic.Ground');
    expect(placementOf(cls, 'ground1').transformation.extent).toEqual([[-80, -80], [-40, -40]]);
  });

  it('uses defaultComponentName and appends a numeric suffix when taken', () => {
    expect(apply({ op: 'addComponent', className: 'Modelica.Blocks.Sources.Sine', position: [0, 0] }).result.createdName).toBe('sine1');
    expect(apply({ op: 'addComponent', className: 'Modelica.Blocks.Sources.Sine', position: [0, 0] }, BARE).result.createdName).toBe('sine');
    expect(apply({ op: 'addComponent', className: 'Modelica.Electrical.Analog.Sources.SineVoltage', position: [0, 0] }, BARE).result.createdName).toBe('sineVoltage');
    // Inherited names count as taken.
    expect(apply({ op: 'addComponent', className: RESISTOR, position: [0, 0] }, DERIVED).result.createdName).toBe('resistor2');
  });

  it('applies defaultComponentPrefixes', () => {
    const { cls, result, text } = apply({ op: 'addComponent', className: 'Modelica.Mechanics.World', position: [0, 0] });
    expect(result.createdName).toBe('world');
    expect(comp(cls, 'world').prefixes.inner).toBe(true);
    expect(text).toContain('inner Modelica.Mechanics.World world');
  });

  it('gives connectors an iconTransformation equal to the transformation', () => {
    const { cls, result } = apply({ op: 'addComponent', className: 'Modelica.Blocks.Interfaces.RealInput', position: [-100, 20] });
    expect(result.createdName).toBe('realInput');
    const p = placementOf(cls, 'realInput');
    expect(p.transformation).toEqual({ origin: [0, 0], extent: [[-110, 10], [-90, 30]], rotation: 0 });
    expect(p.iconTransformation).toEqual(p.transformation);
  });

  it('accepts an explicit valid unique name and rejects invalid or duplicate ones', () => {
    expect(apply({ op: 'addComponent', className: RESISTOR, name: 'myR', position: [0, 0] }).result.createdName).toBe('myR');
    applyError({ op: 'addComponent', className: RESISTOR, name: 'model', position: [0, 0] }, /not a valid Modelica identifier/);
    applyError({ op: 'addComponent', className: RESISTOR, name: '1abc', position: [0, 0] }, /not a valid Modelica identifier/);
    applyError({ op: 'addComponent', className: RESISTOR, name: 'resistor', position: [0, 0] }, /already used/);
    applyError({ op: 'addComponent', className: RESISTOR, name: 'resistor', position: [0, 0] }, /already used/, DERIVED);
  });

  it('rejects unknown, partial and package classes', () => {
    applyError({ op: 'addComponent', className: 'Modelica.Nope', position: [0, 0] }, /Unknown class 'Modelica.Nope'/);
    applyError({ op: 'addComponent', className: 'Modelica.Electrical.Analog.Interfaces.OnePort', position: [0, 0] }, /partial/);
    applyError({ op: 'addComponent', className: 'Modelica.Blocks', position: [0, 0] }, /package/);
  });

  it('exports generateComponentName', () => {
    expect(generateComponentName(registry, RESISTOR, CIRCUIT)).toBe('resistor2');
    expect(generateComponentName(registry, RESISTOR, DERIVED)).toBe('resistor2');
    expect(generateComponentName(registry, 'Modelica.Blocks.Sources.Sine', CIRCUIT)).toBe('sine1');
    expect(generateComponentName(registry, 'Modelica.Blocks.Sources.Sine', BARE)).toBe('sine');
    expect(generateComponentName(registry, 'Basic.Capacitor', CIRCUIT)).toBe('capacitor1');
  });
});

// -------------------------------------------------------------------------------------------------
// Placement operations
// -------------------------------------------------------------------------------------------------

describe('moveComponents', () => {
  it('translates absolute extents, origins of rotated components and creates placements', () => {
    const { cls } = apply({ op: 'moveComponents', names: ['ground', 'resistor1', 'power'], delta: [10, -6] });
    expect(placementOf(cls, 'ground').transformation).toEqual({ origin: [0, 0], extent: [[0, -56], [20, -36]], rotation: 0 });
    expect(placementOf(cls, 'resistor1').transformation).toEqual({ origin: [50, -6], extent: [[-10, -10], [10, 10]], rotation: 90 });
    expect(placementOf(cls, 'power').transformation).toEqual({ origin: [0, 0], extent: [[0, -16], [20, 4]], rotation: 0 });
    // Other annotation entries survive.
    expect(modNames(comp(cls, 'power').annotation?.mods)).toEqual(['HideResult', 'Placement']);
    // Untouched components keep their placement.
    expect(placementOf(cls, 'resistor').transformation.extent).toEqual([[-10, -10], [10, 10]]);
  });

  it('rounds coordinates to 2 decimals without snapping', () => {
    const { cls } = apply({ op: 'moveComponents', names: ['resistor'], delta: [0.333, 0.126] });
    expect(placementOf(cls, 'resistor').transformation.extent).toEqual([[-9.67, -9.87], [10.33, 10.13]]);
  });

  it('rejects unknown and inherited components', () => {
    applyError({ op: 'moveComponents', names: ['ground', 'nope'], delta: [1, 1] }, /Unknown component 'nope'/);
    applyError({ op: 'moveComponents', names: ['resistor'], delta: [1, 1] }, /inherited from 'Examples.Electrical.Circuit'/, DERIVED);
  });
});

describe('setPlacement', () => {
  it('replaces the Placement annotation verbatim', () => {
    const placement = { visible: false, transformation: { origin: [5, 5] as [number, number], extent: [[-10, -10], [10, 10]] as [[number, number], [number, number]], rotation: 45 } };
    const { cls, text } = apply({ op: 'setPlacement', name: 'resistor', placement });
    expect(placementOf(cls, 'resistor')).toEqual(placement);
    expect(text).toContain('Placement(visible=false, transformation(origin={5,5}, extent={{-10,-10},{10,10}}, rotation=45))');
    applyError({ op: 'setPlacement', name: 'nope', placement }, /Unknown component/);
  });
});

describe('rotateComponent', () => {
  it('rotates about the visual centre and normalises the angle to (-180, 180]', () => {
    expect(placementOf(apply({ op: 'rotateComponent', name: 'resistor', deltaDegrees: 90 }).cls, 'resistor').transformation)
      .toEqual({ origin: [0, 0], extent: [[-10, -10], [10, 10]], rotation: 90 });
    expect(placementOf(apply({ op: 'rotateComponent', name: 'ground', deltaDegrees: 90 }).cls, 'ground').transformation)
      .toEqual({ origin: [0, -40], extent: [[-10, -10], [10, 10]], rotation: 90 });
    expect(placementOf(apply({ op: 'rotateComponent', name: 'resistor1', deltaDegrees: 90 }).cls, 'resistor1').transformation.rotation).toBe(180);
    expect(placementOf(apply({ op: 'rotateComponent', name: 'resistor1', deltaDegrees: 180 }).cls, 'resistor1').transformation.rotation).toBe(-90);
    expect(placementOf(apply({ op: 'rotateComponent', name: 'resistor', deltaDegrees: -90 }).cls, 'resistor').transformation.rotation).toBe(-90);
  });

  it('drops rotation and origin when a component becomes unrotated', () => {
    const { cls, text } = apply({ op: 'rotateComponent', name: 'sineVoltage', deltaDegrees: 90 });
    expect(placementOf(cls, 'sineVoltage').transformation).toEqual({ origin: [0, 0], extent: [[-50, -10], [-30, 10]], rotation: 0 });
    expect(text).toMatch(/sineVoltage\(V=amp\)\s+annotation\(Placement\(transformation\(extent=\{\{-50,-10\},\{-30,10\}\}\)\)\);/);
  });

  it('four quarter turns restore the placement', () => {
    const op: EditOperation = { op: 'rotateComponent', name: 'ground', deltaDegrees: 90 };
    const { cls } = chain([op, op, op, op]);
    expect(placementOf(cls, 'ground').transformation).toEqual({ origin: [0, 0], extent: [[-10, -50], [10, -30]], rotation: 0 });
  });

  it('exposes the angle and canonical-form helpers', () => {
    expect([0, 90, 180, 270, 360, -90, -180, 540].map(normalizeSignedAngle)).toEqual([0, 90, 180, -90, 0, -90, 180, 180]);
    expect(canonicalizeTransformation({ origin: [0, 0], extent: [[30, -10], [50, 10]], rotation: 90 }))
      .toEqual({ origin: [0, 40], extent: [[-10, -10], [10, 10]], rotation: 90 });
    expect(canonicalizeTransformation({ origin: [5, 5], extent: [[-10, -10], [10, 10]], rotation: 0 }))
      .toEqual({ origin: [0, 0], extent: [[-5, -5], [15, 15]], rotation: 0 });
  });
});

describe('flipComponent', () => {
  it('mirrors extents and negates the rotation', () => {
    expect(placementOf(apply({ op: 'flipComponent', name: 'resistor', axis: 'horizontal' }).cls, 'resistor').transformation)
      .toEqual({ origin: [0, 0], extent: [[10, -10], [-10, 10]], rotation: 0 });
    expect(placementOf(apply({ op: 'flipComponent', name: 'ground', axis: 'vertical' }).cls, 'ground').transformation)
      .toEqual({ origin: [0, 0], extent: [[-10, -30], [10, -50]], rotation: 0 });
    expect(placementOf(apply({ op: 'flipComponent', name: 'resistor1', axis: 'horizontal' }).cls, 'resistor1').transformation)
      .toEqual({ origin: [40, 0], extent: [[10, -10], [-10, 10]], rotation: -90 });
  });

  it('is its own inverse', () => {
    const op: EditOperation = { op: 'flipComponent', name: 'resistor1', axis: 'vertical' };
    const { cls } = chain([op, op]);
    expect(placementOf(cls, 'resistor1').transformation).toEqual({ origin: [40, 0], extent: [[-10, -10], [10, 10]], rotation: 90 });
  });
});

// -------------------------------------------------------------------------------------------------
// rename / delete
// -------------------------------------------------------------------------------------------------

describe('renameComponent', () => {
  it('renames the declaration, connect refs, equation refs and modifiers of other components', () => {
    const { cls, text } = apply({ op: 'renameComponent', name: 'resistor', newName: 'r1' });
    expect(cls.components.map((c) => c.name)).toContain('r1');
    expect(cls.components.map((c) => c.name)).not.toContain('resistor');
    expect(cls.components.map((c) => c.name)).toContain('resistor1');
    expect(cls.equations.map(connectText).filter(Boolean)).toEqual([
      'connect(sineVoltage.p, r1.p)', 'connect(r1.n, resistor1.p)', 'connect(ground.p, sineVoltage.n)', 'connect(sine.y, gain.u)',
    ]);
    const power = cls.equations[4];
    expect(power.kind === 'equals' && printExpr(power.right)).toBe('r1.v*r1.i');
    expect(modText(comp(cls, 'sine'))).toContain('sine(amplitude=r1.R)');
    expect(circuitText(text)).not.toMatch(/\bresistor\b/);
    // Connection annotations are untouched.
    expect(parseConnectionLine(cls.equations[0].kind === 'connect' ? cls.equations[0].annotation : undefined)?.points).toEqual([[-40, 10], [-40, 20], [-10, 20], [-10, 0]]);
  });

  it('renames a parameter used in modifiers without touching modifier names', () => {
    const { cls } = apply({ op: 'renameComponent', name: 'R', newName: 'Rtot' });
    expect(comp(cls, 'Rtot').prefixes.parameter).toBe(true);
    expect(modText(comp(cls, 'resistor'))).toContain('resistor(R=Rtot)');
    expect(modText(comp(cls, 'resistor1'))).toContain('resistor1(R=200, i(start=0.5))');
  });

  it('validates the new name', () => {
    applyError({ op: 'renameComponent', name: 'resistor', newName: 'connect' }, /not a valid Modelica identifier/);
    applyError({ op: 'renameComponent', name: 'resistor', newName: 'ground' }, /already used/);
    applyError({ op: 'renameComponent', name: 'nope', newName: 'x' }, /Unknown component 'nope'/);
    applyError({ op: 'renameComponent', name: 'resistor', newName: 'x' }, /inherited/, DERIVED);
    applyError({ op: 'renameComponent', name: 'load', newName: 'resistor' }, /already used/, DERIVED);
  });
});

describe('deleteComponents', () => {
  it('removes declarations and their connect equations, warning about other references', () => {
    const { result, cls } = apply({ op: 'deleteComponents', names: ['resistor'] });
    expect(cls.components.map((c) => c.name)).not.toContain('resistor');
    expect(cls.components.map((c) => c.name)).toContain('resistor1');
    expect(cls.equations.map(connectText).filter(Boolean)).toEqual(['connect(ground.p, sineVoltage.n)', 'connect(sine.y, gain.u)']);
    expect(cls.equations).toHaveLength(3);
    expect(result.diagnostics).toEqual([expect.objectContaining({ severity: 'warning' })]);
    expect(result.diagnostics[0].message).toContain("'resistor'");
    expect(result.diagnostics[0].message).toContain('power = resistor.v*resistor.i');
    expect(result.diagnostics[0].message).toContain("declaration of 'sine'");
  });

  it('deletes several components at once without warnings when nothing else refers to them', () => {
    const { result, cls } = apply({ op: 'deleteComponents', names: ['ground', 'gain', 'gain'] });
    expect(cls.components.map((c) => c.name)).toEqual(['R', 'amp', 'resistor', 'resistor1', 'capacitor', 'sineVoltage', 'sine', 'u', 'power']);
    expect(cls.equations.map(connectText).filter(Boolean)).toEqual(['connect(sineVoltage.p, resistor.p)', 'connect(resistor.n, resistor1.p)']);
    expect(result.diagnostics).toEqual([]);
  });

  it('is atomic: an unknown or inherited name fails the whole edit', () => {
    applyError({ op: 'deleteComponents', names: ['ground', 'nope'] }, /Unknown component 'nope'/);
    applyError({ op: 'deleteComponents', names: ['resistor'] }, /inherited/, DERIVED);
  });
});

// -------------------------------------------------------------------------------------------------
// Connections
// -------------------------------------------------------------------------------------------------

describe('addConnection', () => {
  it('appends connect(from, to) with Line points and colour', () => {
    const points: [number, number][] = [[40, 10], [40, 20], [70, 20], [70, 0]];
    const { cls, text } = apply({ op: 'addConnection', from: 'resistor1.n', to: 'capacitor.p', points, color: [0, 127, 0] });
    const eq = cls.equations[cls.equations.length - 1];
    expect(connectText(eq)).toBe('connect(resistor1.n, capacitor.p)');
    const line = parseConnectionLine(eq.kind === 'connect' ? eq.annotation : undefined)!;
    expect(line.points).toEqual(points);
    expect(line.color).toEqual([0, 127, 0]);
    expect(text).toContain('connect(resistor1.n, capacitor.p) annotation(Line(points={{40,10},{40,20},{70,20},{70,0}}, color={0,127,0}));');
  });

  it('defaults the colour to Modelica blue and the points to the component centres', () => {
    const { cls } = apply({ op: 'addConnection', from: 'capacitor.n', to: 'ground.p' });
    const eq = cls.equations[cls.equations.length - 1];
    const line = parseConnectionLine(eq.kind === 'connect' ? eq.annotation : undefined)!;
    expect(line.color).toEqual([0, 0, 255]);
    expect(line.points).toEqual([[70, 0], [0, -40]]);
  });

  it('connects the class\'s own connectors, inherited components and unresolvable classes', () => {
    expect(connectText(apply({ op: 'addConnection', from: 'u', to: 'gain.u', points: [[-100, 0], [-52, 60]] }).cls.equations.at(-1)!)).toBe('connect(u, gain.u)');
    expect(connectText(apply({ op: 'addConnection', from: 'capacitor.n', to: 'load.p', points: [[80, 0], [60, -40]] }, DERIVED).cls.equations.at(-1)!)).toBe('connect(capacitor.n, load.p)');
    expect(connectText(apply({ op: 'addConnection', from: 'mystery.a', to: 'mystery.b', points: [[0, 0], [1, 1]] }, LOOSE).cls.equations.at(-1)!)).toBe('connect(mystery.a, mystery.b)');
  });

  it('rejects duplicates (either order), self-connections and non-connectors', () => {
    applyError({ op: 'addConnection', from: 'resistor.p', to: 'sineVoltage.p', points: [[0, 0], [1, 1]] }, /Connection already exists/);
    applyError({ op: 'addConnection', from: 'sineVoltage.p', to: 'resistor.p', points: [[0, 0], [1, 1]] }, /Connection already exists/);
    applyError({ op: 'addConnection', from: 'resistor.p', to: 'resistor.p', points: [[0, 0], [1, 1]] }, /to itself/);
    applyError({ op: 'addConnection', from: 'resistor.R', to: 'ground.p', points: [[0, 0], [1, 1]] }, /'resistor.R' is not a connector/);
    applyError({ op: 'addConnection', from: 'power', to: 'ground.p', points: [[0, 0], [1, 1]] }, /'power' is not a connector/);
    applyError({ op: 'addConnection', from: 'resistor.x', to: 'ground.p', points: [[0, 0], [1, 1]] }, /Unknown connector 'resistor.x'/);
    applyError({ op: 'addConnection', from: 'nope.p', to: 'ground.p', points: [[0, 0], [1, 1]] }, /Unknown component 'nope'/);
    applyError({ op: 'addConnection', from: 'a+b', to: 'ground.p', points: [[0, 0], [1, 1]] }, /Invalid connector reference/);
  });

  it('exports listConnectorRefs', () => {
    const refs = listConnectorRefs(registry, CIRCUIT);
    for (const r of ['resistor.p', 'resistor.n', 'resistor1.p', 'resistor1.n', 'capacitor.p', 'ground.p', 'sineVoltage.n', 'sine.y', 'gain.u', 'gain.y', 'u']) {
      expect(refs, r).toContain(r);
    }
    for (const r of ['resistor.R', 'resistor.v', 'power', 'R', 'amp', 'sine.amplitude']) expect(refs, r).not.toContain(r);
    expect(listConnectorRefs(registry, DERIVED)).toEqual([...refs, 'load.p', 'load.n']);
    expect(listConnectorRefs(registry, LOOSE)).toEqual([]);
  });
});

describe('setConnectionPoints / deleteConnection', () => {
  it('replaces Line.points and keeps the other attributes', () => {
    const { cls, text } = apply({ op: 'setConnectionPoints', equationIndex: 1, points: [[10, 0], [25, 0], [25, -10], [40, -10]] });
    const line = parseConnectionLine(cls.equations[1].kind === 'connect' ? cls.equations[1].annotation : undefined)!;
    expect(line.points).toEqual([[10, 0], [25, 0], [25, -10], [40, -10]]);
    expect(line.color).toEqual([0, 0, 255]);
    expect(text).toContain('connect(resistor.n, resistor1.p) annotation(Line(points={{10,0},{25,0},{25,-10},{40,-10}}, color={0,0,255}));');
  });

  it('creates a Line annotation when the connect has none', () => {
    const { cls } = apply({ op: 'setConnectionPoints', equationIndex: 0, points: [[40, 10], [70, -40]] }, DERIVED);
    expect(parseConnectionLine(cls.equations[0].kind === 'connect' ? cls.equations[0].annotation : undefined)?.points).toEqual([[40, 10], [70, -40]]);
  });

  it('validates the equation index and the points', () => {
    applyError({ op: 'setConnectionPoints', equationIndex: 4, points: [[0, 0], [1, 1]] }, /not a connect equation/);
    applyError({ op: 'setConnectionPoints', equationIndex: 99, points: [[0, 0], [1, 1]] }, /No equation at index 99/);
    applyError({ op: 'setConnectionPoints', equationIndex: 0, points: [[0, 0]] }, /at least two points/);
    applyError({ op: 'deleteConnection', equationIndex: 4 }, /not a connect equation/);
    applyError({ op: 'deleteConnection', equationIndex: -1 }, /No equation at index/);
  });

  it('deletes a connect equation', () => {
    const { cls } = apply({ op: 'deleteConnection', equationIndex: 0 });
    expect(cls.equations).toHaveLength(4);
    expect(connectText(cls.equations[0])).toBe('connect(resistor.n, resistor1.p)');
  });
});

// -------------------------------------------------------------------------------------------------
// Parameters
// -------------------------------------------------------------------------------------------------

describe('setParameter on a component', () => {
  it('sets, replaces and removes flat modifiers', () => {
    expect(modText(comp(apply({ op: 'setParameter', component: 'resistor', name: 'R', valueText: '100' }).cls, 'resistor'))).toContain('resistor(R=100)');
    expect(modText(comp(apply({ op: 'setParameter', component: 'resistor', name: 'R', valueText: ' 2*R ' }).cls, 'resistor'))).toContain('resistor(R=2*R)');
    expect(modText(comp(apply({ op: 'setParameter', component: 'ground', name: 'p.v', valueText: '0' }).cls, 'ground'))).toContain('ground(p(v=0))');
    const removed = comp(apply({ op: 'setParameter', component: 'resistor1', name: 'R', valueText: null }).cls, 'resistor1');
    expect(modText(removed)).toContain('resistor1(i(start=0.5))');
    const bare = comp(apply({ op: 'setParameter', component: 'resistor', name: 'R', valueText: null }).cls, 'resistor');
    expect(bare.modification).toBeUndefined();
    expect(modText(bare)).toContain('Resistor resistor annotation(');
    expect(comp(apply({ op: 'setParameter', component: 'resistor', name: 'R', valueText: '' }).cls, 'resistor').modification).toBeUndefined();
  });

  it('creates and updates nested attribute modifiers in whichever form they are written', () => {
    expect(modText(comp(apply({ op: 'setParameter', component: 'resistor', name: 'i.start', valueText: '2' }).cls, 'resistor'))).toContain('resistor(R=R, i(start=2))');
    const nested = comp(apply({ op: 'setParameter', component: 'resistor1', name: 'i.start', valueText: '1' }).cls, 'resistor1');
    expect(modText(nested)).toContain('resistor1(R=200, i(start=1))');
    expect(modNames(nested.modification?.mods)).toEqual(['R', 'i']);
    const flat = comp(apply({ op: 'setParameter', component: 'capacitor', name: 'C.start', valueText: '3' }).cls, 'capacitor');
    expect(modText(flat)).toContain('capacitor(C.start=3)');
    expect(modNames(flat.modification?.mods)).toEqual(['C.start']);
    expect(modText(comp(apply({ op: 'setParameter', component: 'capacitor', name: 'C', valueText: '4' }).cls, 'capacitor'))).toContain('capacitor(C.start=3, C=4)'.replace('3', '2'));
  });

  it('removing the last nested modifier deletes the parent modifier', () => {
    expect(modText(comp(apply({ op: 'setParameter', component: 'resistor1', name: 'i.start', valueText: null }).cls, 'resistor1'))).toContain('resistor1(R=200)');
    expect(comp(apply({ op: 'setParameter', component: 'capacitor', name: 'C.start', valueText: null }).cls, 'capacitor').modification).toBeUndefined();
    // Removing something that is not set is a no-op.
    expect(modText(comp(apply({ op: 'setParameter', component: 'resistor', name: 'T.start', valueText: null }).cls, 'resistor'))).toContain('resistor(R=R)');
  });

  it('puts modifiers of inherited components on the extends clause', () => {
    const { cls, text } = apply({ op: 'setParameter', component: 'resistor', name: 'R', valueText: '5' }, DERIVED);
    expect(cls.extends[0].modification && modNames(cls.extends[0].modification.mods)).toEqual(['R', 'resistor']);
    expect(text).toContain('extends Circuit(R=50, resistor(R=5));');
    const twice = chain([
      { op: 'setParameter', component: 'resistor', name: 'R', valueText: '5' },
      { op: 'setParameter', component: 'resistor', name: 'i.start', valueText: '0.1' },
      { op: 'setParameter', component: 'resistor', name: 'R', valueText: '6' },
    ], DERIVED);
    expect(twice.text).toContain('extends Circuit(R=50, resistor(R=6, i(start=0.1)));');
    const cleared = chain([
      { op: 'setParameter', component: 'resistor', name: 'R', valueText: '5' },
      { op: 'setParameter', component: 'resistor', name: 'R', valueText: null },
    ], DERIVED);
    expect(cleared.text).toContain('extends Circuit(R=50);');
  });

  it('reports invalid expressions, unknown components and final modifiers', () => {
    applyError({ op: 'setParameter', component: 'resistor', name: 'R', valueText: '2*(' }, /Invalid expression '2\*\('/);
    applyError({ op: 'setParameter', component: 'nope', name: 'R', valueText: '1' }, /Unknown component 'nope'/);
    applyError({ op: 'setParameter', component: 'resistor', name: 'R.', valueText: '1' }, /Invalid parameter path/);
    applyError({ op: 'setParameter', component: 'g', name: 'k', valueText: '1' }, /final/, BARE);
  });
});

describe('setParameter on the class itself', () => {
  it('sets, replaces and removes bindings and attributes of own parameters', () => {
    expect(modText(comp(apply({ op: 'setParameter', name: 'R', valueText: '47' }).cls, 'R'))).toBe('parameter Real R = 47 "Total resistance";');
    expect(modText(comp(apply({ op: 'setParameter', name: 'R', valueText: null }).cls, 'R'))).toBe('parameter Real R "Total resistance";');
    expect(modText(comp(apply({ op: 'setParameter', name: 'amp', valueText: '3' }).cls, 'amp'))).toBe('parameter Real amp(start=1) = 3 "Amplitude";');
    expect(modText(comp(apply({ op: 'setParameter', name: 'amp.start', valueText: '2' }).cls, 'amp'))).toBe('parameter Real amp(start=2) "Amplitude";');
    expect(modText(comp(apply({ op: 'setParameter', name: 'R.start', valueText: '10' }).cls, 'R'))).toBe('parameter Real R(start=10) = 100 "Total resistance";');
    expect(modText(comp(apply({ op: 'setParameter', name: 'amp.start', valueText: null }).cls, 'amp'))).toBe('parameter Real amp "Amplitude";');
  });

  it('modifies inherited parameters through the extends clause', () => {
    expect(apply({ op: 'setParameter', name: 'R', valueText: '10' }, DERIVED).text).toContain('extends Circuit(R=10);');
    expect(apply({ op: 'setParameter', name: 'R', valueText: null }, DERIVED).text).toContain('extends Circuit;');
    expect(apply({ op: 'setParameter', name: 'amp.start', valueText: '2' }, DERIVED).text).toContain('extends Circuit(R=50, amp(start=2));');
  });
});

// -------------------------------------------------------------------------------------------------
// Description, experiment, replaceText
// -------------------------------------------------------------------------------------------------

describe('setDescription', () => {
  it('sets component and class descriptions; an empty string removes them', () => {
    expect(comp(apply({ op: 'setDescription', component: 'resistor', description: 'Load' }).cls, 'resistor').description).toBe('Load');
    expect(comp(apply({ op: 'setDescription', component: 'power', description: '' }).cls, 'power').description).toBeUndefined();
    expect(apply({ op: 'setDescription', description: 'RC circuit' }).cls.description).toBe('RC circuit');
    expect(apply({ op: 'setDescription', description: '' }).cls.description).toBeUndefined();
    applyError({ op: 'setDescription', component: 'nope', description: 'x' }, /Unknown component/);
    applyError({ op: 'setDescription', component: 'resistor', description: 'x' }, /inherited/, DERIVED);
  });
});

describe('setExperiment', () => {
  it('merges with the existing experiment annotation', () => {
    const { cls, text } = apply({ op: 'setExperiment', experiment: { StopTime: 20, Interval: 0.01 } });
    expect(parseExperiment(cls.annotation)).toEqual({ StopTime: 20, Tolerance: 1e-6, Interval: 0.01 });
    expect(modNames(cls.annotation?.mods)).toEqual(['experiment', 'Diagram']);
    expect(text).toContain('experiment(StopTime=20, Tolerance=0.000001, Interval=0.01)');
  });

  it('creates the class annotation when missing', () => {
    const { cls, text } = apply({ op: 'setExperiment', experiment: { StartTime: 0, StopTime: 5, Tolerance: 1e-8 } }, BARE);
    expect(parseExperiment(cls.annotation)).toEqual({ StartTime: 0, StopTime: 5, Tolerance: 1e-8 });
    expect(text).toContain('experiment(StartTime=0, StopTime=5, Tolerance=1e-8)');
    applyError({ op: 'setExperiment', experiment: { StopTime: Number.NaN } }, /finite/);
  });
});

describe('replaceText', () => {
  it('returns user text verbatim when it parses', () => {
    const text = 'within Examples;\n\n\npackage   Electrical\n  model Circuit\n  Real   x ;\n  end Circuit;\nend Electrical;\n';
    const result = applyEdit(registry, CIRCUIT, { op: 'replaceText', text });
    expect(result).toEqual({ text, diagnostics: [] });
  });

  it('returns diagnostics and the original text on a syntax error', () => {
    const result = applyEdit(registry, CIRCUIT, { op: 'replaceText', text: 'within Examples;\npackage Electrical\n  model Circuit\n    Real x = ;\n  end Circuit;\nend Electrical;\n' });
    expect(result.text).toBe(EXAMPLES);
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics[0].severity).toBe('error');
    expect(result.diagnostics[0].loc?.line).toBe(4);
  });
});

// -------------------------------------------------------------------------------------------------
// Round trips
// -------------------------------------------------------------------------------------------------

describe('round trips', () => {
  it('add then delete restores an equivalent AST', () => {
    const reg = makeRegistry();
    const added = applyEdit(reg, CIRCUIT, { op: 'addComponent', className: RESISTOR, position: [20, 20] });
    expect(added.diagnostics).toEqual([]);
    expect(reg.addFile('Examples', EXAMPLES_PATH, added.text)).toEqual([]);
    const removed = applyEdit(reg, CIRCUIT, { op: 'deleteComponents', names: [added.createdName!] });
    expect(removed.diagnostics).toEqual([]);
    expect(stripLoc(parse(removed.text))).toEqual(stripLoc(parse(EXAMPLES)));
  });

  it('add connection then delete it, and rename back and forth, restore the AST', () => {
    const connected = chain([
      { op: 'addConnection', from: 'resistor1.n', to: 'capacitor.p', points: [[40, 10], [70, 0]] },
      { op: 'deleteConnection', equationIndex: 5 },
    ]);
    expect(stripLoc(parse(connected.text))).toEqual(stripLoc(parse(EXAMPLES)));
    const renamed = chain([
      { op: 'renameComponent', name: 'resistor', newName: 'tmp' },
      { op: 'renameComponent', name: 'tmp', newName: 'resistor' },
    ]);
    expect(stripLoc(parse(renamed.text))).toEqual(stripLoc(parse(EXAMPLES)));
  });
});

// -------------------------------------------------------------------------------------------------
// Renaming / deleting: identifiers, loop indices and derived classes
// -------------------------------------------------------------------------------------------------

describe('renameComponent with unusual names and scopes', () => {
  it('renames a quoted identifier containing regex metacharacters', () => {
    const reg = makeRegistry();
    expect(reg.addFile('Examples', 'Examples/Q.mo', `within Examples;
model Q
  Real 'a(b' = 1;
  Real y;
equation
  y = 'a(b';
end Q;
`)).toEqual([]);
    const result = applyEdit(reg, 'Examples.Q', { op: 'renameComponent', name: "'a(b'", newName: 'ab' });
    expect(result.diagnostics).toEqual([]);
    const cls = findClassDef(parse(result.text, 'Examples/Q.mo'), 'Examples.Q')!;
    expect(cls.components.map((c) => c.name)).toEqual(['ab', 'y']);
    expect(cls.equations[0].kind === 'equals' && printExpr(cls.equations[0].right)).toBe('ab');
  });

  it('still warns about algorithm sections mentioning a quoted identifier', () => {
    const reg = makeRegistry();
    expect(reg.addFile('Examples', 'Examples/Q.mo', `within Examples;
model Q
  Real 'a(b' = 1;
  Real y;
algorithm
  y := 'a(b';
end Q;
`)).toEqual([]);
    const result = applyEdit(reg, 'Examples.Q', { op: 'renameComponent', name: "'a(b'", newName: 'ab' });
    expect(result.diagnostics).toEqual([expect.objectContaining({ severity: 'warning', message: expect.stringMatching(/Algorithm sections mention/) })]);
    expect(result.text).toContain('Real ab = 1;');
  });

  const FOR = `within Examples;
model F
  Real i = 1;
  Real x[3];
  Real y;
equation
  for i in 1:3 loop
    x[i] = i*y;
  end for;
  y = i;
end F;
`;

  it('leaves for-loop indices that shadow the component alone', () => {
    const reg = makeRegistry();
    expect(reg.addFile('Examples', 'Examples/F.mo', FOR)).toEqual([]);
    const result = applyEdit(reg, 'Examples.F', { op: 'renameComponent', name: 'i', newName: 'cur' });
    expect(result.diagnostics).toEqual([]);
    const cls = findClassDef(parse(result.text, 'Examples/F.mo'), 'Examples.F')!;
    expect(cls.components.map((c) => c.name)).toEqual(['cur', 'x', 'y']);
    const loop = cls.equations[0];
    expect(loop.kind).toBe('for');
    if (loop.kind !== 'for') return;
    expect(loop.indices.map((ix) => ix.name)).toEqual(['i']);
    const body = loop.equations[0];
    expect(body.kind === 'equals' && `${printExpr(body.left)} = ${printExpr(body.right)}`).toBe('x[i] = i*y');
    const last = cls.equations[1];
    expect(last.kind === 'equals' && printExpr(last.right)).toBe('cur');
  });

  it('does not report shadowed loop indices as leftover references of a deleted component', () => {
    const reg = makeRegistry();
    expect(reg.addFile('Examples', 'Examples/F.mo', FOR)).toEqual([]);
    const result = applyEdit(reg, 'Examples.F', { op: 'deleteComponents', names: ['i'] });
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0].message).toContain('y = i');
    expect(result.diagnostics[0].message).not.toContain('loop');
  });
});

describe('editing a component that derived classes refer to', () => {
  const derivedOf = (text: string): ClassDef => {
    const cls = findClassDef(parse(text, EXAMPLES_PATH), DERIVED);
    expect(cls).toBeDefined();
    return cls!;
  };

  it('renaming updates connect equations of derived classes in the same file', () => {
    const { result, text } = apply({ op: 'renameComponent', name: 'resistor1', newName: 'r2' });
    expect(result.diagnostics).toEqual([]);
    expect(derivedOf(text).equations.map(connectText)).toEqual(['connect(r2.n, load.p)']);
  });

  it('renaming updates the extends modifiers of derived classes in the same file', () => {
    const { result, text } = apply({ op: 'renameComponent', name: 'R', newName: 'Rtot' });
    expect(result.diagnostics).toEqual([]);
    const derived = derivedOf(text);
    expect(modNames(derived.extends[0].modification?.mods)).toEqual(['Rtot']);
    expect(text).toContain('extends Circuit(Rtot=50)');
  });

  it('deleting removes connect equations and extends modifiers of derived classes in the same file', () => {
    const { result, text } = apply({ op: 'deleteComponents', names: ['resistor1'] });
    expect(result.diagnostics).toEqual([]);
    expect(derivedOf(text).equations).toEqual([]);

    const dropped = apply({ op: 'deleteComponents', names: ['R'] });
    const derived = derivedOf(dropped.text);
    expect(derived.extends[0].modification?.mods ?? []).toEqual([]);
    expect(dropped.text).toContain('extends Circuit;');
    // Circuit's own `resistor(R=R)` is still reported, as before.
    expect(dropped.result.diagnostics.map((d) => d.message).join('\n')).toContain("declaration of 'resistor'");
  });

  it('refuses a new name that a derived class already declares', () => {
    applyError({ op: 'renameComponent', name: 'resistor', newName: 'load' }, /Examples\.Electrical\.Derived/);
  });

  it('refuses renaming or deleting when a derived class in another file refers to the component', () => {
    const reg = makeRegistry();
    expect(reg.addFile('Examples', 'Examples/Remote.mo', `within Examples;
model Remote "Derived in another file"
  extends Electrical.Circuit(R=1);
equation
  connect(resistor1.n, u);
end Remote;
`)).toEqual([]);
    const original = reg.fileOf(CIRCUIT)!.text;
    for (const op of [
      { op: 'renameComponent', name: 'R', newName: 'Rtot' },
      { op: 'renameComponent', name: 'resistor1', newName: 'r2' },
      { op: 'deleteComponents', names: ['resistor1'] },
    ] as EditOperation[]) {
      const result = applyEdit(reg, CIRCUIT, op);
      expect(result.text).toBe(original);
      const errors = result.diagnostics.filter((d) => d.severity === 'error');
      expect(errors).toHaveLength(1);
      expect(errors[0].message).toMatch(/Examples\.Remote/);
    }
    // Derived classes that do not mention the component do not block the edit.
    const ok = applyEdit(reg, CIRCUIT, { op: 'renameComponent', name: 'capacitor', newName: 'cap' });
    expect(ok.diagnostics).toEqual([]);
    expect(ok.text).toContain('Capacitor cap(');
  });
});
