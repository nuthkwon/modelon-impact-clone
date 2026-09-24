import { describe, expect, it } from 'vitest';
import { E, ModelicaError, type ClassDef, type Equation, type Expr } from '../ast.js';
import { parse, parseExpression, parseModification } from './parser.js';

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

const expr = (text: string): Expr => stripLoc(parseExpression(text));
const firstClass = (text: string): ClassDef => parse(text).classes[0];

function expectParseError(text: string, message: string | RegExp, loc?: { line: number; column: number }) {
  let caught: unknown;
  try {
    parse(text, 'T.mo');
  } catch (e) {
    caught = e;
  }
  expect(caught, `expected a parse error for:\n${text}`).toBeInstanceOf(ModelicaError);
  const err = caught as ModelicaError;
  if (typeof message === 'string') expect(err.message).toBe(message);
  else expect(err.message).toMatch(message);
  expect(err.diagnostics[0].file).toBe('T.mo');
  expect(err.diagnostics[0].message).toBe(err.message);
  if (loc) expect(err.diagnostics[0].loc).toMatchObject(loc);
  else expect(err.diagnostics[0].loc).toBeDefined();
}

describe('stored definitions and classes', () => {
  it('parses within, several classes and records the file', () => {
    const def = parse('within Modelica.Electrical.Analog.Basic;\nmodel A end A;\nfinal package B "b" end B;', 'A.mo');
    expect(def.within).toBe('Modelica.Electrical.Analog.Basic');
    expect(def.file).toBe('A.mo');
    expect(def.classes.map((c) => [c.restriction, c.name, c.description])).toEqual([['model', 'A', undefined], ['package', 'B', 'b']]);
  });

  it('treats an empty within as top-level', () => {
    expect(parse('within;\nmodel A end A;').within).toBeUndefined();
    expect(parse('model A end A;').within).toBeUndefined();
  });

  it('parses class prefixes and restrictions', () => {
    const def = parse(`
      package P
        partial model PM end PM;
        encapsulated partial function F end F;
        expandable connector Bus end Bus;
        operator record Complex Real re; end Complex;
        pure function G end G;
        impure operator function H end H;
        operator O end O;
        replaceable model RM end RM;
        final inner outer block B end B;
        type T = Real;
        connector C end C;
        class K end K;
      end P;`);
    const [P] = def.classes;
    const summary = P.classes.map((c) => `${c.encapsulated ? 'E' : ''}${c.partial ? 'P' : ''}${c.expandable ? 'X' : ''} ${c.restriction} ${c.name}`.trim());
    expect(summary).toEqual([
      'P model PM', 'EP function F', 'X connector Bus', 'record Complex', 'function G', 'function H', 'operator O',
      'model RM', 'block B', 'type T', 'connector C', 'class K',
    ]);
  });

  it('checks the end name', () => {
    expectParseError('model M\nend N;', "Expected 'end M' but found 'end N' (line 2, column 5)", { line: 2, column: 5 });
  });

  it('parses descriptions with string concatenation', () => {
    const cls = firstClass('model M "first " + "second"\n  Real x "a" + "b";\nend M;');
    expect(cls.description).toBe('first second');
    expect(cls.components[0].description).toBe('ab');
  });

  it('sets loc and nameLoc on classes', () => {
    const text = 'within A;\n\npartial model M "d"\n  Real x;\nend M;\n';
    const cls = parse(text).classes[0];
    expect(cls.nameLoc).toEqual({ line: 3, column: 15, offset: text.indexOf('M "d"'), length: 1 });
    expect(cls.loc).toEqual({ line: 3, column: 1, offset: text.indexOf('partial'), length: 'partial model M "d"\n  Real x;\nend M;'.length });
  });
});

describe('short class definitions', () => {
  it('parses type attribute short classes', () => {
    const cls = firstClass('type Voltage = Real(unit="V", displayUnit="mV") "volt";');
    expect(cls.restriction).toBe('type');
    expect(cls.description).toBe('volt');
    expect(stripLoc(cls.shortClass)).toEqual({
      typeName: 'Real',
      modification: {
        mods: [
          { name: 'unit', modification: { mods: [], value: E.str('V') } },
          { name: 'displayUnit', modification: { mods: [], value: E.str('mV') } },
        ],
      },
    });
  });

  it('parses input/output connectors and array types', () => {
    const input = firstClass('connector RealInput = input Real "in" annotation(defaultComponentName="u");');
    expect(input.shortClass).toMatchObject({ typeName: 'Real', input: true });
    expect(input.annotation?.mods[0]).toMatchObject({ name: 'defaultComponentName' });
    expect(firstClass('connector RealOutput = output Real;').shortClass).toMatchObject({ typeName: 'Real', output: true });
    const arr = firstClass('type Y = Real[3];');
    expect(stripLoc(arr.shortClass?.arrayDims)).toEqual([E.num(3)]);
    expect(firstClass('type Z = Modelica.Units.SI.Voltage;').shortClass?.typeName).toBe('Modelica.Units.SI.Voltage');
  });

  it('parses enumerations as modifiers named by literal', () => {
    const cls = firstClass('type StateSelect = enumeration(never "Do not use", avoid, default) "desc";');
    expect(cls.shortClass?.typeName).toBe('enumeration');
    expect(cls.shortClass?.modification?.mods.map((m) => m.name)).toEqual(['never', 'avoid', 'default']);
    expect(cls.shortClass?.modification?.mods[0].modification.value).toMatchObject({ kind: 'string', value: 'Do not use' });
    expect(cls.description).toBe('desc');
    expect(firstClass('type E = enumeration(:);').shortClass?.modification?.mods).toEqual([]);
  });
});

describe('extends and imports', () => {
  it('parses extends with modification and annotation', () => {
    const cls = firstClass(`model M
      extends Modelica.Electrical.Analog.Interfaces.OnePort;
      extends ConditionalHeatPort(T=T_ref, final useHeatPort=false) annotation(Placement(visible=false));
    protected
      extends Modelica.Icons.Package;
    end M;`);
    expect(cls.extends).toHaveLength(3);
    expect(cls.extends[0]).toMatchObject({ kind: 'extends', typeName: 'Modelica.Electrical.Analog.Interfaces.OnePort', protected: false });
    expect(cls.extends[0].modification).toBeUndefined();
    expect(stripLoc(cls.extends[1].modification)).toEqual({
      mods: [
        { name: 'T', modification: { mods: [], value: E.ref('T_ref') } },
        { name: 'useHeatPort', final: true, modification: { mods: [], value: E.bool(false) } },
      ],
    });
    expect(cls.extends[1].annotation?.mods[0].name).toBe('Placement');
    expect(cls.extends[2].protected).toBe(true);
  });

  it('parses all import forms', () => {
    const cls = firstClass(`model M
      import SI = Modelica.Units.SI;
      import Modelica.Math.*;
      import Modelica.Math.{sin, cos};
      import Modelica.Constants "the constants";
    end M;`);
    expect(stripLoc(cls.imports)).toEqual([
      { kind: 'import', alias: 'SI', path: 'Modelica.Units.SI', wildcard: false },
      { kind: 'import', path: 'Modelica.Math', wildcard: true },
      { kind: 'import', path: 'Modelica.Math', wildcard: false, names: ['sin', 'cos'] },
      { kind: 'import', path: 'Modelica.Constants', wildcard: false },
    ]);
    expect(cls.imports[0].loc).toMatchObject({ line: 2 });
  });
});

describe('component clauses', () => {
  const noPrefixes = {
    flow: false, stream: false, input: false, output: false, parameter: false, constant: false, discrete: false,
    final: false, inner: false, outer: false, replaceable: false, redeclare: false, protected: false,
  };

  it('splits multiple declarations per clause', () => {
    const cls = firstClass('model M\n  parameter Real a, b(start=1) "bee";\nend M;');
    expect(cls.components).toHaveLength(2);
    expect(stripLoc(cls.components[0])).toEqual({ kind: 'component', typeName: 'Real', name: 'a', prefixes: { ...noPrefixes, parameter: true } });
    expect(stripLoc(cls.components[1])).toEqual({
      kind: 'component', typeName: 'Real', name: 'b', description: 'bee',
      prefixes: { ...noPrefixes, parameter: true },
      modification: { mods: [{ name: 'start', modification: { mods: [], value: E.num(1) } }] },
    });
  });

  it('parses prefixes, protected sections and locations', () => {
    const text = `model M
  flow Real i;
  stream Real h;
  input Real u;
  output Real y;
  constant Real c = 1;
  discrete Real d;
  final parameter Real fp = 2;
  inner outer Real io;
  replaceable Real r;
  redeclare Real rd;
protected
  Real p;
public
  Real q;
end M;`;
    const cls = firstClass(text);
    const by = Object.fromEntries(cls.components.map((c) => [c.name, c.prefixes]));
    expect(by.i.flow).toBe(true);
    expect(by.h.stream).toBe(true);
    expect(by.u.input).toBe(true);
    expect(by.y.output).toBe(true);
    expect(by.c.constant).toBe(true);
    expect(by.d.discrete).toBe(true);
    expect(by.fp).toMatchObject({ final: true, parameter: true });
    expect(by.io).toMatchObject({ inner: true, outer: true });
    expect(by.r.replaceable).toBe(true);
    expect(by.rd.redeclare).toBe(true);
    expect(by.p.protected).toBe(true);
    expect(by.q.protected).toBe(false);
    const fp = cls.components.find((c) => c.name === 'fp')!;
    expect(fp.loc).toEqual({ line: 8, column: 3, offset: text.indexOf('final parameter'), length: 'final parameter Real fp = 2'.length });
  });

  it('parses array dimensions in every position', () => {
    const cls = firstClass('model M\n  Real x[3];\n  Real m[n,2];\n  Real[3] y;\n  Real[2] z[n];\n  Real f[:, size(A, 1)];\n  Integer e[end];\nend M;');
    const dims = Object.fromEntries(cls.components.map((c) => [c.name, stripLoc(c.arrayDims)]));
    expect(dims.x).toEqual([E.num(3)]);
    expect(dims.m).toEqual([E.ref('n'), E.num(2)]);
    expect(dims.y).toEqual([E.num(3)]);
    expect(dims.z).toEqual([E.num(2), E.ref('n')]);
    expect(dims.f).toEqual([E.ref(':'), E.call('size', [E.ref('A'), E.num(1)])]);
    expect(dims.e).toEqual([{ kind: 'end' }]);
  });

  it('parses bindings, conditions, descriptions and annotations', () => {
    const cls = firstClass(`model M
      parameter Real R(start=1, fixed=true) = 100 "res" annotation(Dialog(group="Basic"));
      Resistor r if useR "cond" annotation(Placement(transformation(extent={{-10,-10},{10,10}}, rotation=90)));
      Real x := 2;
    end M;`);
    const [R, r, x] = cls.components;
    expect(stripLoc(R.modification)).toEqual({
      mods: [
        { name: 'start', modification: { mods: [], value: E.num(1) } },
        { name: 'fixed', modification: { mods: [], value: E.bool(true) } },
      ],
      value: E.num(100),
    });
    expect(R.description).toBe('res');
    expect(stripLoc(R.annotation)).toEqual({ mods: [{ name: 'Dialog', modification: { mods: [{ name: 'group', modification: { mods: [], value: E.str('Basic') } }] } }] });
    expect(stripLoc(r.condition)).toEqual(E.ref('useR'));
    expect(r.description).toBe('cond');
    const transformation = r.annotation!.mods[0].modification.mods[0];
    expect(transformation.name).toBe('transformation');
    expect(stripLoc(transformation.modification.mods[0].modification.value)).toEqual(E.points([[-10, -10], [10, 10]]));
    expect(stripLoc(transformation.modification.mods[1].modification.value)).toEqual(E.num(90));
    expect(stripLoc(x.modification)).toEqual({ mods: [], value: E.num(2) });
  });

  it('drops constrainedby but keeps the trailing comment for the element', () => {
    const cls = firstClass(`model M
      replaceable Resistor r constrainedby OnePort(R=1) "desc" annotation(Placement(visible=true));
      replaceable model Sub = Base constrainedby Iface "sub desc";
    end M;`);
    expect(cls.components[0]).toMatchObject({ typeName: 'Resistor', name: 'r', description: 'desc', prefixes: { replaceable: true } });
    expect(cls.components[0].annotation?.mods[0].name).toBe('Placement');
    expect(cls.classes[0]).toMatchObject({ name: 'Sub', description: 'sub desc', shortClass: { typeName: 'Base' } });
  });

  it('accepts global type names', () => {
    expect(firstClass('model M\n  .Modelica.Blocks.Interfaces.RealInput u;\nend M;').components[0].typeName).toBe('.Modelica.Blocks.Interfaces.RealInput');
  });
});

describe('modifications', () => {
  it('parses nested, dotted, each, final and redeclare modifiers', () => {
    const m = stripLoc(parseModification('R=100, i(start=1, fixed=true), each x=1, final y=2, v.start=3, a(b(c=1)), redeclare Modelica.Foo.Bar r(R=1)'));
    expect(m.value).toBeUndefined();
    expect(m.mods.map((x) => x.name)).toEqual(['R', 'i', 'x', 'y', 'v.start', 'a', 'r']);
    expect(m.mods[2].each).toBe(true);
    expect(m.mods[3].final).toBe(true);
    expect(m.mods[5]).toEqual({ name: 'a', modification: { mods: [{ name: 'b', modification: { mods: [{ name: 'c', modification: { mods: [], value: E.num(1) } }] } }] } });
    expect(m.mods[6]).toEqual({ name: 'r', modification: { mods: [] }, redeclare: { typeName: 'Modelica.Foo.Bar' } });
  });

  it('parses class redeclarations inside modifications', () => {
    const m = parseModification('redeclare replaceable package Medium = Modelica.Media.Water.StandardWater constrainedby Modelica.Media.Interfaces.PartialMedium "medium"');
    expect(m.mods[0]).toMatchObject({ name: 'Medium', redeclare: { typeName: 'Modelica.Media.Water.StandardWater' } });
    expect(parseModification('redeclare each final Real x = 1').mods[0]).toMatchObject({ name: 'x', each: true, final: true, redeclare: { typeName: 'Real' } });
  });

  it('accepts complete modifications and bindings', () => {
    expect(stripLoc(parseModification('(R=100) = 5'))).toEqual({ mods: [{ name: 'R', modification: { mods: [], value: E.num(100) } }], value: E.num(5) });
    expect(stripLoc(parseModification('= 5'))).toEqual({ mods: [], value: E.num(5) });
    expect(stripLoc(parseModification(''))).toEqual({ mods: [] });
    expect(() => parseModification('R=1 x')).toThrow(/Expected end of input after modification but found 'x'/);
  });

  it('ignores string comments on modifiers', () => {
    expect(stripLoc(parseModification('R=1 "the resistance"').mods[0])).toEqual({ name: 'R', modification: { mods: [], value: E.num(1) } });
  });
});

describe('equations', () => {
  const eqs = (body: string): Equation[] => stripLoc(firstClass(`model M\nequation\n${body}\nend M;`).equations);

  it('parses equality, connect, call equations with descriptions and annotations', () => {
    const [a, b, c, d, e] = eqs(`
      v = R*i "ohm";
      connect(r.p, c.n) annotation(Line(points={{0,0},{10,10}}, color={0,0,255}));
      assert(x > 0, "x must be positive");
      reinit(x, 0);
      terminate("done") annotation(__Dymola_x=1);`);
    expect(a).toEqual({ kind: 'equals', left: E.ref('v'), right: E.bin('*', E.ref('R'), E.ref('i')), description: 'ohm' });
    expect(b).toEqual({
      kind: 'connect', a: E.ref('r', 'p'), b: E.ref('c', 'n'),
      annotation: { mods: [{ name: 'Line', modification: { mods: [
        { name: 'points', modification: { mods: [], value: E.points([[0, 0], [10, 10]]) } },
        { name: 'color', modification: { mods: [], value: E.array([E.num(0), E.num(0), E.num(255)]) } },
      ] } }] },
    });
    expect(c).toEqual({ kind: 'call', call: E.call('assert', [E.bin('>', E.ref('x'), E.num(0)), E.str('x must be positive')]) });
    expect(d).toEqual({ kind: 'call', call: E.call('reinit', [E.ref('x'), E.num(0)]) });
    expect(e).toMatchObject({ kind: 'call', call: E.call('terminate', [E.str('done')]), annotation: { mods: [{ name: '__Dymola_x' }] } });
  });

  it('parses if/elseif/else, for and when/elsewhen equations', () => {
    const [ifEq, forEq, whenEq] = eqs(`
      if a > 0 then
        q = 1;
      elseif a < 0 then
        q = -1;
      else
        q = 0;
      end if;
      for i in 1:n, j in 1:2 loop
        m[i,j] = i*j;
      end for;
      when time > 1 then
        reinit(x, 0);
      elsewhen {time > 2, sample(0, 1)} then
        terminate("done");
      end when;`);
    expect(ifEq).toEqual({
      kind: 'if',
      branches: [
        { cond: E.bin('>', E.ref('a'), E.num(0)), equations: [{ kind: 'equals', left: E.ref('q'), right: E.num(1) }] },
        { cond: E.bin('<', E.ref('a'), E.num(0)), equations: [{ kind: 'equals', left: E.ref('q'), right: E.num(-1) }] },
      ],
      else: [{ kind: 'equals', left: E.ref('q'), right: E.num(0) }],
    });
    expect(forEq).toEqual({
      kind: 'for',
      indices: [{ name: 'i', range: { kind: 'range', start: E.num(1), end: E.ref('n') } }, { name: 'j', range: { kind: 'range', start: E.num(1), end: E.num(2) } }],
      equations: [{ kind: 'equals', left: { kind: 'ref', parts: [{ name: 'm', subscripts: [E.ref('i'), E.ref('j')] }] }, right: E.bin('*', E.ref('i'), E.ref('j')) }],
    });
    expect(whenEq).toMatchObject({ kind: 'when', branches: [{ cond: E.bin('>', E.ref('time'), E.num(1)) }, { cond: { kind: 'array' } }] });
    expect((whenEq as Extract<Equation, { kind: 'when' }>).branches[1].equations[0].kind).toBe('call');
  });

  it('parses initial equations and output tuples', () => {
    const cls = firstClass('model M\ninitial equation\n  der(x) = 0;\n  (a, b) = f(x);\nequation\n  der(x) = -x;\nend M;');
    expect(stripLoc(cls.initialEquations)).toEqual([
      { kind: 'equals', left: E.call('der', [E.ref('x')]), right: E.num(0) },
      { kind: 'equals', left: E.call('', [E.ref('a'), E.ref('b')]), right: E.call('f', [E.ref('x')]) },
    ]);
    expect(cls.equations).toHaveLength(1);
    expect(cls.equations[0].loc).toMatchObject({ line: 6, column: 3, length: 'der(x) = -x;'.length });
  });

  it('allows the class annotation inside the equation section (MSL style)', () => {
    const cls = firstClass('model M\nequation\n  x = 1;\n  annotation (experiment(StopTime=1.0), Documentation(info="<html></html>"));\nend M;');
    expect(cls.equations).toHaveLength(1);
    expect(cls.annotation?.mods.map((m) => m.name)).toEqual(['experiment', 'Documentation']);
  });

  it('reports useful errors', () => {
    expectParseError('model M\nequation\n  x + 1;\nend M;', "Expected '=' after expression in equation but found ';' (line 3, column 8)");
    expectParseError('model M\nequation\n  x := 1;\nend M;', /Assignment ':=' is not allowed in an equation section/);
    expectParseError('model M\nequation\n  if a then x = 1;\nend M;', "Expected 'if' after 'end' but found 'M' (line 4, column 5)");
    expectParseError('model M\nequation\n  for i loop x = 1; end for;\nend M;', /Loop variable 'i' must have an explicit range/);
    expectParseError('model M\nequation\n  connect(1, a);\nend M;', /Expected component reference as first connect argument/);
  });
});

describe('algorithm sections and external bodies', () => {
  it('stores algorithms as dedented opaque text including comments and nested blocks', () => {
    const cls = firstClass(`function f
      input Real x;
      output Real y;
    protected
      Real z[3];
    algorithm
      // compute
      z := {1, 2, 3};
      y := z[end];
      if x > 0 then
        for i in 1:3 loop
          y := y + z[i];
        end for;
      elseif x < 0 then
        while y > 0 loop
          y := y - 1;
        end while;
      else
        when x == 0 then
          y := 0;
        end when;
      end if;
      annotation (Inline=true);
    end f;`);
    expect(cls.algorithms).toHaveLength(1);
    expect(cls.algorithms![0].initial).toBe(false);
    expect(cls.algorithms![0].text.split('\n')).toEqual([
      '// compute',
      'z := {1, 2, 3};',
      'y := z[end];',
      'if x > 0 then',
      '  for i in 1:3 loop',
      '    y := y + z[i];',
      '  end for;',
      'elseif x < 0 then',
      '  while y > 0 loop',
      '    y := y - 1;',
      '  end while;',
      'else',
      '  when x == 0 then',
      '    y := 0;',
      '  end when;',
      'end if;',
    ]);
    expect(cls.annotation?.mods[0].name).toBe('Inline');
    expect(cls.components.map((c) => c.name)).toEqual(['x', 'y', 'z']);
  });

  it('handles initial algorithms and sections following an algorithm', () => {
    const cls = firstClass('model M\n  Real x;\ninitial algorithm\n  x := 1;\nalgorithm\n  x := 2;\nequation\n  der(x) = 1;\nend M;');
    expect(cls.algorithms).toEqual([{ initial: true, text: 'x := 1;' }, { initial: false, text: 'x := 2;' }]);
    expect(cls.equations).toHaveLength(1);
  });

  it('skips external function bodies', () => {
    const cls = firstClass('function ext\n  input Real x;\n  output Real y;\nexternal "C" y = foo(x) annotation(Library="bar", Include="#include <foo.h>");\n  annotation(Documentation(info="doc"));\nend ext;');
    expect(cls.components).toHaveLength(2);
    expect(cls.algorithms).toBeUndefined();
    expect(cls.annotation?.mods[0].name).toBe('Documentation');
  });
});

describe('annotations', () => {
  it('parses a real MSL Icon annotation into calls with named arguments', () => {
    const cls = firstClass(`model R
      annotation(Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Rectangle(extent={{-70,30},{70,-30}}, lineColor={0,0,255}, fillColor={255,255,255}, fillPattern=FillPattern.Solid), Line(points={{-90,0},{-70,0}}, color={0,0,255}), Text(extent={{-150,-40},{150,-80}}, textString="R=%R")}));
    end R;`);
    const icon = cls.annotation!.mods[0];
    expect(icon.name).toBe('Icon');
    const [coordinateSystem, graphics] = icon.modification.mods;
    expect(coordinateSystem.name).toBe('coordinateSystem');
    expect(stripLoc(coordinateSystem.modification.mods[1].modification.value)).toEqual(E.points([[-100, -100], [100, 100]]));
    const items = graphics.modification.value as Extract<Expr, { kind: 'array' }>;
    expect(items.elements.map((e) => (e as Extract<Expr, { kind: 'call' }>).callee)).toEqual(['Rectangle', 'Line', 'Text']);
    const rect = stripLoc(items.elements[0]) as Extract<Expr, { kind: 'call' }>;
    expect(rect.args).toEqual([]);
    expect(rect.namedArgs).toEqual([
      { name: 'extent', value: E.points([[-70, 30], [70, -30]]) },
      { name: 'lineColor', value: E.array([E.num(0), E.num(0), E.num(255)]) },
      { name: 'fillColor', value: E.array([E.num(255), E.num(255), E.num(255)]) },
      { name: 'fillPattern', value: E.ref('FillPattern', 'Solid') },
    ]);
    expect(stripLoc(items.elements[2])).toEqual(E.call('Text', [], [{ name: 'extent', value: E.points([[-150, -40], [150, -80]]) }, { name: 'textString', value: E.str('R=%R') }]));
  });

  it('parses Documentation strings with escaped quotes and multiple lines', () => {
    const cls = firstClass('model D\n  annotation (Documentation(info="<html>\n<a href=\\"modelica://Modelica\\">Modelica</a>\n</html>", revisions="<html>rev</html>"));\nend D;');
    const doc = cls.annotation!.mods[0];
    expect(doc.name).toBe('Documentation');
    expect(doc.modification.mods[0].modification.value).toMatchObject({ kind: 'string', value: '<html>\n<a href="modelica://Modelica">Modelica</a>\n</html>' });
    expect(doc.modification.mods[1].modification.value).toMatchObject({ kind: 'string', value: '<html>rev</html>' });
  });

  it('parses experiment, DynamicSelect, if-expressions and vendor annotations', () => {
    const cls = firstClass(`model X
      Real x annotation(Placement(transformation(extent={{-10,-10},{10,10}}, rotation=90), iconTransformation(origin={0,100}, extent={{-20,-20},{20,20}})));
      annotation (experiment(StartTime=0, StopTime=1.0, Interval=0.01, Tolerance=1e-6), __Dymola_Commands(file="x.mos"),
        Icon(graphics={Line(points=DynamicSelect({{0,0},{1,1}}, if on then {{0,0}} else {{1,1}}))}));
    end X;`);
    const names = cls.annotation!.mods.map((m) => m.name);
    expect(names).toEqual(['experiment', '__Dymola_Commands', 'Icon']);
    const experiment = cls.annotation!.mods[0].modification.mods;
    expect(experiment.map((m) => [m.name, (m.modification.value as { value: number }).value])).toEqual([['StartTime', 0], ['StopTime', 1], ['Interval', 0.01], ['Tolerance', 1e-6]]);
    const placement = cls.components[0].annotation!.mods[0];
    expect(placement.modification.mods.map((m) => m.name)).toEqual(['transformation', 'iconTransformation']);
  });

  it('merges several class annotations', () => {
    const cls = firstClass('model M\n  annotation(a=1);\n  Real x;\n  annotation(b=2);\nend M;');
    expect(cls.annotation?.mods.map((m) => m.name)).toEqual(['a', 'b']);
  });
});

describe('expressions', () => {
  it('respects precedence', () => {
    expect(expr('-a^2')).toEqual(E.neg(E.bin('^', E.ref('a'), E.num(2))));
    expect(expr('a-b-c')).toEqual(E.bin('-', E.bin('-', E.ref('a'), E.ref('b')), E.ref('c')));
    expect(expr('a/b/c')).toEqual(E.bin('/', E.bin('/', E.ref('a'), E.ref('b')), E.ref('c')));
    expect(expr('not a and b')).toEqual(E.bin('and', { kind: 'unary', op: 'not', operand: E.ref('a') }, E.ref('b')));
    expect(expr('a or b and c')).toEqual(E.bin('or', E.ref('a'), E.bin('and', E.ref('b'), E.ref('c'))));
    expect(expr('a + b*c^d')).toEqual(E.bin('+', E.ref('a'), E.bin('*', E.ref('b'), E.bin('^', E.ref('c'), E.ref('d')))));
    expect(expr('2^3^2')).toEqual(E.bin('^', E.num(2), E.bin('^', E.num(3), E.num(2))));
    expect(expr('a < b or c >= d')).toEqual(E.bin('or', E.bin('<', E.ref('a'), E.ref('b')), E.bin('>=', E.ref('c'), E.ref('d'))));
    expect(expr('-a*b')).toEqual(E.bin('*', E.neg(E.ref('a')), E.ref('b')));
    expect(expr('a*-b')).toEqual(E.bin('*', E.ref('a'), E.neg(E.ref('b'))));
    expect(expr('(a+b)*c')).toEqual(E.bin('*', E.bin('+', E.ref('a'), E.ref('b')), E.ref('c')));
    expect(expr('a .* b .+ c ./ d .^ 2 .- e')).toEqual(
      E.bin('.-', E.bin('.+', E.bin('.*', E.ref('a'), E.ref('b')), E.bin('./', E.ref('c'), E.bin('.^', E.ref('d'), E.num(2)))), E.ref('e')),
    );
    expect(() => parseExpression('a < b == c')).toThrow(/Expected end of input after expression but found '=='/);
  });

  it('parses literals', () => {
    expect(expr('1')).toEqual(E.num(1));
    expect(expr('-1')).toEqual(E.num(-1));
    expect(expr('- 2.5')).toEqual(E.num(-2.5));
    expect(expr('+3')).toEqual(E.num(3));
    expect(expr('-0.0')).toEqual(E.num(0));
    expect(expr('-x')).toEqual(E.neg(E.ref('x')));
    expect(expr('-(1)')).toEqual(E.num(-1));
    expect(expr('1.5')).toEqual(E.num(1.5));
    expect(expr('.5')).toEqual(E.num(0.5));
    expect(expr('1e-3')).toEqual(E.num(0.001));
    expect(expr('1.5E+3')).toEqual(E.num(1500));
    expect(expr('"a\\"b\\\\n\\n"')).toEqual(E.str('a"b\\n\n'));
    expect(expr('true')).toEqual(E.bool(true));
    expect(expr('false')).toEqual(E.bool(false));
    expect(expr('time')).toEqual(E.ref('time'));
  });

  it('parses references, calls and special functions', () => {
    expect(expr('resistor.p.v')).toEqual(E.ref('resistor', 'p', 'v'));
    expect(expr('.Modelica.Constants.pi')).toEqual({ ...E.refPath('Modelica.Constants.pi'), global: true });
    expect(expr('a[1].b[i, j+1]')).toEqual({ kind: 'ref', parts: [{ name: 'a', subscripts: [E.num(1)] }, { name: 'b', subscripts: [E.ref('i'), E.bin('+', E.ref('j'), E.num(1))] }] });
    expect(expr('x[end]')).toEqual({ kind: 'ref', parts: [{ name: 'x', subscripts: [{ kind: 'end' }] }] });
    expect(expr('x[:, 2]')).toEqual({ kind: 'ref', parts: [{ name: 'x', subscripts: [E.ref(':'), E.num(2)] }] });
    expect(expr('der(x)')).toEqual(E.call('der', [E.ref('x')]));
    expect(expr('initial()')).toEqual(E.call('initial'));
    expect(expr('sin(w*time)')).toEqual(E.call('sin', [E.bin('*', E.ref('w'), E.ref('time'))]));
    expect(expr('Modelica.Math.atan2(y, x)')).toEqual(E.call('Modelica.Math.atan2', [E.ref('y'), E.ref('x')]));
    expect(expr('f(a, b=2, c={1,2})')).toEqual(E.call('f', [E.ref('a')], [{ name: 'b', value: E.num(2) }, { name: 'c', value: E.array([E.num(1), E.num(2)]) }]));
    expect(expr('function f(x=1)')).toEqual(E.call('f', [], [{ name: 'x', value: E.num(1) }]));
    expect(expr('g(function f(x=1), 2)')).toEqual(E.call('g', [E.call('f', [], [{ name: 'x', value: E.num(1) }]), E.num(2)]));
  });

  it('parses arrays, matrices, ranges and if-expressions', () => {
    expect(expr('{}')).toEqual(E.array([]));
    expect(expr('{1, 2, 3}')).toEqual(E.array([E.num(1), E.num(2), E.num(3)]));
    expect(expr('{{-100,-100},{100,100}}')).toEqual(E.points([[-100, -100], [100, 100]]));
    expect(expr('[1, 2; 3, 4]')).toEqual(E.array([E.array([E.num(1), E.num(2)]), E.array([E.num(3), E.num(4)])]));
    expect(expr('[1, 2]')).toEqual(E.array([E.array([E.num(1), E.num(2)])]));
    expect(expr('1:n')).toEqual({ kind: 'range', start: E.num(1), end: E.ref('n') });
    expect(expr('a:b:c')).toEqual({ kind: 'range', start: E.ref('a'), step: E.ref('b'), end: E.ref('c') });
    expect(expr('if c then a else b')).toEqual({ kind: 'if', branches: [{ cond: E.ref('c'), value: E.ref('a') }], else: E.ref('b') });
    expect(expr('if a then 1 elseif b then 2 else 3')).toEqual({ kind: 'if', branches: [{ cond: E.ref('a'), value: E.num(1) }, { cond: E.ref('b'), value: E.num(2) }], else: E.num(3) });
    expect(expr('x + (if c then 1 else 2)')).toEqual(E.bin('+', E.ref('x'), { kind: 'if', branches: [{ cond: E.ref('c'), value: E.num(1) }], else: E.num(2) }));
    expect(expr('(a, b)')).toEqual(E.call('', [E.ref('a'), E.ref('b')]));
  });

  it('sets locations on expressions', () => {
    const e = parseExpression('resistor.R + sin(2)') as Extract<Expr, { kind: 'binary' }>;
    expect(e.loc).toEqual({ line: 1, column: 1, offset: 0, length: 19 });
    expect(e.left.loc).toEqual({ line: 1, column: 1, offset: 0, length: 10 });
    expect(e.right.loc).toEqual({ line: 1, column: 14, offset: 13, length: 6 });
    expect((e.right as Extract<Expr, { kind: 'call' }>).args[0].loc).toEqual({ line: 1, column: 18, offset: 17, length: 1 });
  });

  it('reports errors', () => {
    expect(() => parseExpression('a +')).toThrow(/Expected expression but found end of file \(line 1, column 4\)/);
    expect(() => parseExpression('a b')).toThrow(/Expected end of input after expression but found 'b'/);
    expect(() => parseExpression('f(a=1, 2)')).toThrow(/Positional argument after named argument/);
    expect(() => parseExpression('{x for x in 1:3}')).toThrow(/Array comprehensions .* are not supported/);
    expect(() => parseExpression('sum(x[i] for i in 1:3)')).toThrow(/Iterators in function calls .* are not supported/);
    expect(() => parseExpression('()')).toThrow(/Expected expression inside parentheses/);
  });
});

describe('error messages', () => {
  it('reports a missing semicolon with the offending token and location', () => {
    const text = ['model M', ...Array.from({ length: 9 }, (_, i) => `  Real a${i + 1};`), '  Real x', '  model N', '  end N;', 'end M;'].join('\n');
    expectParseError(text, "Expected ';' after component declaration but found 'model' (line 12, column 3)", { line: 12, column: 3 });
  });

  it('reports other structural problems', () => {
    expectParseError('within A.B\nmodel M end M;', "Expected ';' after 'within' clause but found 'model' (line 2, column 1)");
    expectParseError('model M\n  Real x;\nend M', "Expected ';' after class definition 'M' but found end of file (line 3, column 6)");
    expectParseError('model M\n  Real x = ;\nend M;', "Expected expression but found ';' (line 2, column 12)");
    expectParseError('model M\n  Real x;\n', "Expected 'end M' but found end of file (line 3, column 1)");
    expectParseError('model M\n  Real x(start=1;\nend M;', "Expected ')' to close modification but found ';' (line 2, column 17)");
    expectParseError('foo', "Expected class definition but found 'foo' (line 1, column 1)");
    expectParseError('model M\n  Real 1x;\nend M;', /Malformed number '1x'/);
    expectParseError('model M\n  model extends Base\n  end Base;\nend M;', "'extends' class specifiers ('model extends Base ... end Base;') are not supported (line 2, column 9)");
  });

  it('exposes diagnostics through ModelicaError', () => {
    try {
      parse('model M\n  Real x = "unterminated;\nend M;', 'Bad.mo');
      expect.unreachable();
    } catch (e) {
      const err = e as ModelicaError;
      expect(err.name).toBe('ModelicaError');
      expect(err.diagnostics).toEqual([{ severity: 'error', message: 'Unterminated string literal (line 2, column 12)', file: 'Bad.mo', loc: { line: 2, column: 12, offset: 19, length: 1 } }]);
    }
  });
});
