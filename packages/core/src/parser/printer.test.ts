import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { E, type Expr, type StoredDefinition } from '../ast.js';
import { parse, parseExpression, parseModification } from './parser.js';
import { printClass, printExpr, printModification, printStoredDefinition } from './printer.js';

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

/** Asserts `parse(print(parse(text)))` equals `parse(text)` and that printing is idempotent. Returns the printed text. */
function expectRoundTrip(text: string, file = 'T.mo'): string {
  const def = parse(text, file);
  const printed = printStoredDefinition(def);
  const reparsed = parse(printed, file);
  expect(stripLoc(reparsed)).toEqual(stripLoc(def));
  expect(printStoredDefinition(reparsed)).toBe(printed);
  return printed;
}

const fmt = (text: string) => printExpr(parseExpression(text));
const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

describe('printExpr', () => {
  it('uses minimal parentheses respecting precedence', () => {
    expect(fmt('-a^2')).toBe('-a^2');
    expect(fmt('(-a)^2')).toBe('(-a)^2');
    expect(fmt('a-b-c')).toBe('a - b - c');
    expect(fmt('a-(b-c)')).toBe('a - (b - c)');
    expect(fmt('(a-b)-c')).toBe('a - b - c');
    expect(fmt('a/b/c')).toBe('a/b/c');
    expect(fmt('a/(b*c)')).toBe('a/(b*c)');
    expect(fmt('(a+b)*c')).toBe('(a + b)*c');
    expect(fmt('a+b*c')).toBe('a + b*c');
    expect(fmt('not a and b')).toBe('not a and b');
    expect(fmt('not (a and b)')).toBe('not (a and b)');
    expect(fmt('not a == b')).toBe('not (a == b)');
    expect(fmt('a or b and c')).toBe('a or b and c');
    expect(fmt('(a or b) and c')).toBe('(a or b) and c');
    expect(fmt('2^3^2')).toBe('2^(3^2)');
    expect(fmt('(2^3)^2')).toBe('(2^3)^2');
    expect(fmt('a*-b')).toBe('a*(-b)');
    expect(fmt('a - -b')).toBe('a - (-b)');
    expect(fmt('-(a*b)')).toBe('-(a*b)');
    expect(fmt('-a*b')).toBe('-a*b');
    expect(fmt('2^-1')).toBe('2^(-1)');
    expect(fmt('a < b or c >= d')).toBe('a < b or c >= d');
    expect(fmt('(a < b) == c')).toBe('(a < b) == c');
    expect(fmt('a < -1')).toBe('a < -1');
    expect(fmt('a and -b')).toBe('a and -b');
    expect(fmt('a*-1')).toBe('a*(-1)');
    expect(fmt('R*(1 + alpha*(T_heatPort - T_ref))')).toBe('R*(1 + alpha*(T_heatPort - T_ref))');
    expect(fmt('a .* b .+ c')).toBe('a.*b .+ c');
    expect(fmt('x + (if c then 1 else 2)')).toBe('x + (if c then 1 else 2)');
    expect(fmt('(1:n) + 1')).toBe('(1:n) + 1');
    expect(fmt('1:2:n')).toBe('1:2:n');
    expect(printExpr(E.bin('-', E.ref('a'), E.num(-1)))).toBe('a - (-1)');
    expect(printExpr(E.bin('^', E.num(-2), E.num(2)))).toBe('(-2)^2');
  });

  it('prints literals, references, calls, arrays and if-expressions', () => {
    expect(fmt('"a\\"b\\\\c"')).toBe('"a\\"b\\\\c"');
    expect(printExpr(E.str('line1\nline2\ttab'))).toBe('"line1\nline2\ttab"');
    expect(fmt('true')).toBe('true');
    expect(fmt('.Modelica.Constants.pi')).toBe('.Modelica.Constants.pi');
    expect(fmt('a[1].b[i, end-1, :]')).toBe('a[1].b[i,end - 1,:]');
    expect(fmt('der(x)')).toBe('der(x)');
    expect(fmt('f(a, b=2, c={1,2})')).toBe('f(a, b=2, c={1,2})');
    expect(fmt('function f(x=1)')).toBe('f(x=1)');
    expect(fmt('{{-100,-100},{100,100}}')).toBe('{{-100,-100},{100,100}}');
    expect(fmt('[1,2;3,4]')).toBe('{{1,2},{3,4}}');
    expect(fmt('if a then 1 elseif b then 2 else 3')).toBe('if a then 1 elseif b then 2 else 3');
    expect(fmt('(a, b)')).toBe('(a, b)');
  });

  it('prints numbers with up to 15 significant digits', () => {
    expect(printExpr(E.num(1))).toBe('1');
    expect(printExpr(E.num(0.5))).toBe('0.5');
    expect(printExpr(E.num(1e-6))).toBe('0.000001');
    expect(printExpr(E.num(1e-7))).toBe('1e-7');
    expect(printExpr(E.num(1.0000000000000002))).toBe('1');
    expect(printExpr(E.num(0.1 + 0.2))).toBe('0.3');
    expect(printExpr(E.num(300.15))).toBe('300.15');
    expect(printExpr(E.num(-2.5))).toBe('-2.5');
    expect(printExpr(E.num(1e21))).toBe('1e+21');
    expect(printExpr(E.num(123456789012345680))).toBe('123456789012345680');
    for (const s of ['1e-7', '1e+21', '0.000001', '300.15', '-2.5']) expect(parseExpression(s)).toMatchObject(stripLoc(parseExpression(printExpr(parseExpression(s)))));
  });
});

describe('printModification', () => {
  it('prints modifier lists and bindings', () => {
    expect(printModification(parseModification('R=100, i(start=1, fixed=true)'))).toBe('(R=100, i(start=1, fixed=true))');
    expect(printModification(parseModification('(a=1) = 5'))).toBe('(a=1) = 5');
    expect(printModification(parseModification('= 5'))).toBe(' = 5');
    expect(printModification(parseModification('each x=1, final y=2, v.start=3, a(b(c=1))'))).toBe('(each x=1, final y=2, v.start=3, a(b(c=1)))');
    expect(printModification(parseModification('redeclare each Modelica.Foo.Bar r(R=1)'))).toBe('(redeclare each Modelica.Foo.Bar r)');
    expect(printModification(parseModification('x(min=0) = 5'))).toBe('(x(min=0) = 5)');
    expect(printModification({ mods: [] })).toBe('');
  });
});

describe('printClass / printStoredDefinition formatting', () => {
  const model = `within Examples.Basic;
model RC "RC circuit" 
  import SI = Modelica.Units.SI;
  extends Modelica.Icons.Example;
  parameter SI.Resistance R = 100 "Resistance" annotation(Dialog(group="Data"));
  Modelica.Electrical.Analog.Basic.Resistor resistor(R=R) annotation(Placement(transformation(extent={{-10,-10},{10,10}}, rotation=90)));
  Modelica.Electrical.Analog.Basic.Capacitor capacitor(C=1e-6, v(start=0, fixed=true)) if useC "cap" annotation(Placement(transformation(extent={{20,-10},{40,10}})));
  Modelica.Electrical.Analog.Basic.Ground ground annotation(Placement(visible=true));
protected
  Real energy;
equation
  connect(resistor.n, capacitor.p) annotation(Line(points={{10,0},{20,0}}, color={0,0,255}));
  connect(ground.p, resistor.p) annotation (Line(points={{-30,-20},{-30,0},{-10,0}}, color={0,0,255}, smooth=Smooth.None));
  der(energy) = resistor.v*resistor.i "power";
  when time > 1 then
    reinit(energy, 0);
  end when;
  annotation (experiment(StopTime=1.0, Tolerance=1e-6), Documentation(info="<html>
<p>An RC circuit with \\"quotes\\".</p>
</html>"), Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Rectangle(extent={{-70,30},{70,-30}}, lineColor={0,0,255}, fillColor={255,255,255}, fillPattern=FillPattern.Solid), Line(points={{-90,0},{-70,0}}, color={0,0,255}), Text(extent={{-150,-40},{150,-80}}, textString="R=%R")}));
end RC;`;

  it('prints the canonical layout', () => {
    const printed = printStoredDefinition(parse(model));
    expect(printed).toBe(`within Examples.Basic;

model RC "RC circuit"
  import SI = Modelica.Units.SI;
  extends Modelica.Icons.Example;
  parameter SI.Resistance R = 100 "Resistance" annotation(Dialog(group="Data"));
  Modelica.Electrical.Analog.Basic.Resistor resistor(R=R)
    annotation(Placement(transformation(extent={{-10,-10},{10,10}}, rotation=90)));
  Modelica.Electrical.Analog.Basic.Capacitor capacitor(C=0.000001, v(start=0, fixed=true)) if useC "cap"
    annotation(Placement(transformation(extent={{20,-10},{40,10}})));
  Modelica.Electrical.Analog.Basic.Ground ground annotation(Placement(visible=true));
protected
  Real energy;
equation
  connect(resistor.n, capacitor.p) annotation(Line(points={{10,0},{20,0}}, color={0,0,255}));
  connect(ground.p, resistor.p) annotation(Line(points={{-30,-20},{-30,0},{-10,0}}, color={0,0,255}, smooth=Smooth.None));
  der(energy) = resistor.v*resistor.i "power";
  when time > 1 then
    reinit(energy, 0);
  end when;
  annotation (
    experiment(StopTime=1, Tolerance=0.000001),
    Documentation(info="<html>
<p>An RC circuit with \\"quotes\\".</p>
</html>"),
    Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
      Rectangle(extent={{-70,30},{70,-30}}, lineColor={0,0,255}, fillColor={255,255,255}, fillPattern=FillPattern.Solid),
      Line(points={{-90,0},{-70,0}}, color={0,0,255}),
      Text(extent={{-150,-40},{150,-80}}, textString="R=%R")}));
end RC;
`);
    expectRoundTrip(model);
  });

  it('prints nested classes, sections and short classes with indentation', () => {
    const printed = printStoredDefinition(parse(`package P "pkg"
      extends Modelica.Icons.Package;
      type Voltage = Real(unit="V") "volt";
      connector RealInput = input Real annotation(defaultComponentName="u");
      type Y = Real[3];
      type S = enumeration(never "n", avoid, default) "sel";
      connector Pin
        Voltage v;
        flow Real i;
      end Pin;
      model M
        Real[3] x;
        Real m[n,2];
      protected
        Real p;
      public
        Real q;
      initial equation
        x[1] = 0;
      equation
        for i in 1:3, j in 1:2 loop
          m[i,j] = i*j;
        end for;
        if a > 0 then
          q = 1;
        elseif a < 0 then
          q = -1;
        else
          q = 0;
        end if;
        assert(a > 0, "positive");
      end M;
    end P;`));
    expect(printed).toBe(`package P "pkg"
  extends Modelica.Icons.Package;

  type Voltage = Real(unit="V") "volt";

  connector RealInput = input Real annotation(defaultComponentName="u");

  type Y = Real[3];

  type S = enumeration(never "n", avoid, default) "sel";

  connector Pin
    Voltage v;
    flow Real i;
  end Pin;

  model M
    Real x[3];
    Real m[n,2];
  protected
    Real p;
  public
    Real q;
  initial equation
    x[1] = 0;
  equation
    for i in 1:3, j in 1:2 loop
      m[i,j] = i*j;
    end for;
    if a > 0 then
      q = 1;
    elseif a < 0 then
      q = -1;
    else
      q = 0;
    end if;
    assert(a > 0, "positive");
  end M;
end P;
`);
  });

  it('prints component prefixes in canonical order and long annotations on a continuation line', () => {
    const cls = parse('model M\n  redeclare final inner outer replaceable flow discrete input Real x;\n  Real y annotation(Placement(transformation(extent={{-100,-10},{-80,10}}), iconTransformation(extent={{-100,-10},{-80,10}})));\nend M;').classes[0];
    const lines = printClass(cls).split('\n');
    expect(lines[1]).toBe('  redeclare final inner outer replaceable flow discrete input Real x;');
    expect(lines[2]).toBe('  Real y');
    expect(lines[3]).toBe('    annotation(Placement(transformation(extent={{-100,-10},{-80,10}}), iconTransformation(extent={{-100,-10},{-80,10}})));');
    expect(printClass(cls, { indent: '    ' }).split('\n')[1]).toBe('    redeclare final inner outer replaceable flow discrete input Real x;');
  });

  it('re-emits algorithm sections verbatim, re-indented', () => {
    const text = 'function f\n  input Real x;\n  output Real y;\nalgorithm\n      // square\n      y := x^2;\n      if y > 1 then\n        y := 1;\n      end if;\n  annotation(Inline=true);\nend f;';
    const printed = expectRoundTrip(text);
    expect(printed).toBe('function f\n  input Real x;\n  output Real y;\nalgorithm\n  // square\n  y := x^2;\n  if y > 1 then\n    y := 1;\n  end if;\n  annotation (\n    Inline=true);\nend f;\n');
  });

  it('does not insert a blank line between a class header and its first nested class', () => {
    expect(printClass(parse('package P\n  model A end A;\n  model B end B;\nend P;').classes[0])).toBe('package P\n  model A\n  end A;\n\n  model B\n  end B;\nend P;');
  });

  it('prints empty classes and an empty annotation', () => {
    expect(printClass(parse('model M annotation(); end M;').classes[0])).toBe('model M\n  annotation ();\nend M;');
    expect(printStoredDefinition({ classes: [] } satisfies StoredDefinition)).toBe('');
  });
});

describe('round trips', () => {
  it('round-trips a realistic ~100-line model', () => {
    const text = `within Examples.Electrical;

model ChuaCircuit "Chua's circuit, ns, V, A"
  import Modelica.Units.SI;
  import Modelica.Electrical.Analog.Basic.*;
  extends Modelica.Icons.Example;
  parameter SI.Inductance L = 18 "Inductance" annotation(Dialog(group="Parameters"));
  parameter SI.Resistance Ro = 0.0125 "Resistance" annotation(Dialog(group="Parameters"));
  parameter Real gamma(min=0) = 0.5 "Damping" annotation(Dialog(tab="Advanced", group="Numerics"));
  parameter Boolean useHeatPort = false "= true, if heat port is enabled"
    annotation(Evaluate=true, HideResult=true, choices(checkBox=true));
  parameter Modelica.Blocks.Types.Init initType = Modelica.Blocks.Types.Init.InitialState "Type of initialization";
  parameter Real x_start[3] = {0,0,0} "Initial states";
  final parameter Real k = 2*Modelica.Constants.pi*gamma;
  constant Real eps = Modelica.Constants.eps;
  Inductor inductor(L=L, i(start=0, fixed=true))
    annotation(Placement(transformation(origin={-75,38}, extent={{-25,-25},{25,25}}, rotation=270)));
  Resistor resistor(R=Ro)
    annotation(Placement(transformation(origin={-75,-29}, extent={{-15,-15},{15,15}}, rotation=270)));
  Capacitor capacitor1(C=10, v(start=4))
    annotation(Placement(transformation(origin={22,-12}, extent={{-20,-20},{20,20}}, rotation=270)));
  Capacitor capacitor2(C=100, v(start=0, fixed=true))
    annotation(Placement(transformation(origin={-45,-32}, extent={{-15,-15},{15,15}}, rotation=270)));
  Conductor conductor(G=0.565)
    annotation(Placement(transformation(origin={-13,-14}, extent={{-15,-15},{15,15}}, rotation=270)));
  Modelica.Electrical.Analog.Basic.Ground ground
    annotation(Placement(transformation(extent={{-33,-100},{7,-60}})));
  Modelica.Electrical.Analog.Basic.HeatingResistor heater(useHeatPort=useHeatPort) if useHeatPort "Optional heater"
    annotation(Placement(transformation(extent={{40,-10},{60,10}})));
  Modelica.Blocks.Interfaces.RealOutput y[3] "Outputs"
    annotation(Placement(transformation(extent={{100,-10},{120,10}}), iconTransformation(extent={{100,-10},{120,10}})));
  Modelica.Blocks.Interfaces.RealInput u
    annotation(Placement(transformation(extent={{-140,-20},{-100,20}})));
  inner Modelica.Fluid.System system
    annotation(Placement(transformation(extent={{60,60},{80,80}})));
protected
  Real energy(start=0, fixed=true) "Stored energy";
  discrete Real lastEvent;
  Boolean above(start=false, fixed=true);
public
  Real power = resistor.v*resistor.i "Dissipated power";
initial equation
  if initType == Modelica.Blocks.Types.Init.SteadyState then
    der(energy) = 0;
  elseif initType == Modelica.Blocks.Types.Init.InitialState then
    energy = x_start[1];
  end if;
  lastEvent = 0;
equation
  connect(inductor.p, conductor.p) annotation(Line(points={{-75,63},{-75,63},{-13,63},{-13,1}}, color={0,0,255}));
  connect(inductor.n, resistor.p) annotation(Line(points={{-75,13},{-75,-14}}, color={0,0,255}));
  connect(resistor.n, ground.p) annotation(Line(points={{-75,-44},{-75,-60},{-13,-60}}, color={0,0,255}));
  connect(capacitor2.n, ground.p) annotation(Line(points={{-45,-47},{-45,-60},{-13,-60}}, color={0,0,255}, smooth=Smooth.Bezier));
  connect(conductor.n, ground.p) annotation(Line(points={{-13,-29},{-13,-60}}, color={0,0,255}, thickness=0.5));
  connect(capacitor1.n, ground.p) annotation(Line(points={{22,-32},{22,-60},{-13,-60}}, color={0,0,255}, pattern=LinePattern.Dash));
  connect(capacitor1.p, conductor.p) annotation(Line(points={{22,8},{22,63},{-13,63},{-13,1}}, color={0,0,255}));
  connect(capacitor2.p, inductor.n) annotation(Line(points={{-45,-17},{-45,0},{-75,0},{-75,13}}, color={0,0,255}));
  connect(heater.p, capacitor1.p) annotation(Line(points={{40,0},{22,0},{22,8}}, color={0,0,255}));
  connect(u, heater.u);
  y = {capacitor1.v,capacitor2.v,inductor.i};
  der(energy) = power - k*energy "energy balance" annotation(__Dymola_hidden=true);
  above = capacitor1.v > 1 and not (capacitor2.v < -1) or inductor.i^2 >= eps;
  when {above,time >= pre(lastEvent) + 0.5} then
    lastEvent = time;
    reinit(energy, if energy > 10 then 10 else energy);
  elsewhen terminal() then
    lastEvent = pre(lastEvent);
  end when;
  for i in 1:3 loop
    assert(abs(y[i]) < 1000000, "output " + String(i) + " out of range", AssertionLevel.warning);
  end for;
  if noEvent(energy < 0) then
    terminate("negative energy");
  end if;
  annotation (
    experiment(StartTime=0, StopTime=50000, Interval=1, Tolerance=0.000001),
    Documentation(info="<html>
<p>Chua's circuit is a simple nonlinear circuit which shows chaotic behaviour. See <a href=\\"modelica://Modelica.Electrical.Analog.Examples\\">the examples</a>.</p>
<p>Simulate until T=5e4 s and plot <code>capacitor1.v</code>.</p>
</html>", revisions="<html>
<ul>
<li><em>Mai 7, 2004</em> by Christoph Clauss<br> realized</li>
</ul>
</html>"),
    Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
      Rectangle(extent={{-100,-100},{100,100}}, lineColor={0,0,255}, fillColor={255,255,255}, fillPattern=FillPattern.Solid, radius=25),
      Ellipse(extent={{-40,-40},{40,40}}, lineColor={0,0,0}, fillColor={215,215,215}, fillPattern=FillPattern.Sphere, visible=DynamicSelect(true, useHeatPort)),
      Polygon(points={{-80,-80},{-80,80},{80,80},{80,-80},{-80,-80}}, lineColor={0,0,0}, smooth=Smooth.Bezier),
      Line(points={{-90,0},{-70,0}}, color={0,0,255}),
      Text(extent={{-150,-100},{150,-140}}, textString="%name", textColor={0,0,255}),
      Text(extent={{-150,140},{150,100}}, textString="L=%L", textStyle={TextStyle.Bold})}),
    Diagram(coordinateSystem(preserveAspectRatio=false, extent={{-100,-100},{100,100}}), graphics={
      Text(extent={{-98,104},{-32,72}}, textString="Chua's circuit", textColor={0,0,255}),
      Line(points={{-13,63},{22,63}}, color={0,0,255})}),
    __Dymola_Commands(file="modelica://Modelica/Resources/Scripts/Dymola/Electrical/Analog/Examples/ChuaCircuit.mos"),
    uses(Modelica(version="4.0.0")),
    preferredView="diagram");
end ChuaCircuit;
`;
    expect(text.split('\n').length).toBeGreaterThanOrEqual(95);
    const printed = expectRoundTrip(text);
    // The model is written in canonical form, so printing it is the identity.
    expect(printed).toBe(text);
  });

  it('round-trips tricky constructs', () => {
    expectRoundTrip(`package P
      type E = enumeration(a "A", b);
      connector RealInput = input Real;
      type V = Real(unit="V", min=0);
      replaceable model Sub = Base(x=1) constrainedby Iface "d" annotation(choicesAllMatching=true);
      model M
        import A.B.*;
        import C = D.E;
        import F.{g, h};
        parameter Real x[:] = {1, 2}, y[2,2] = [1, 2; 3, 4];
        replaceable Resistor r(R=1) constrainedby OnePort "res" annotation(Placement(visible=false));
        Real z(each fixed=false) if useZ;
        .Modelica.Blocks.Interfaces.RealOutput out;
      protected
        Real p annotation(HideResult=true);
      public
        Real q = -a^2 - (b - c)*(-d);
      initial equation
        (a, b) = f(x, y=2);
      equation
        q = if a then 1 elseif b then 2 else 3;
        p = x[end] + sum(x) + Modelica.Math.sin(2*Modelica.Constants.pi*time);
        when sample(0, 0.1) then
          z = pre(z) + 1;
        end when;
      algorithm
        p := 1;
      end M;
      function f
        input Real x;
        output Real y;
      external "C" y = foo(x) annotation(Library="bar");
      end f;
    end P;`);
  });

  it('round-trips real Modelica Standard Library files', () => {
    for (const name of ['Resistor.mo', 'OnePort.mo', 'Icons.mo', 'Continuous.mo']) {
      const text = fixture(name);
      const def = parse(text, name);
      expect(def.classes).toHaveLength(1);
      const printed = printStoredDefinition(def);
      const reparsed = parse(printed, name);
      expect(stripLoc(reparsed), `round trip of ${name}`).toEqual(stripLoc(def));
      expect(printStoredDefinition(reparsed), `idempotent printing of ${name}`).toBe(printed);
    }
  });

  it('parses the structure of the MSL fixtures', () => {
    const resistor = parse(fixture('Resistor.mo')).classes[0];
    expect(resistor).toMatchObject({ restriction: 'model', name: 'Resistor', description: 'Ideal linear electrical resistor' });
    expect(resistor.components.map((c) => c.name)).toEqual(['R', 'T_ref', 'alpha', 'R_actual']);
    expect(resistor.extends.map((e) => e.typeName)).toEqual(['Modelica.Electrical.Analog.Interfaces.OnePort', 'Modelica.Electrical.Analog.Interfaces.ConditionalHeatPort']);
    expect(resistor.equations.map((e) => e.kind)).toEqual(['call', 'equals', 'equals', 'equals']);
    expect(resistor.annotation?.mods.map((m) => m.name)).toEqual(['Documentation', 'Icon']);
    const graphics = resistor.annotation!.mods[1].modification.mods[1].modification.value as Extract<Expr, { kind: 'array' }>;
    expect(graphics.elements.map((e) => (e as Extract<Expr, { kind: 'call' }>).callee)).toEqual(['Rectangle', 'Line', 'Line', 'Text', 'Line', 'Text']);

    const onePort = parse(fixture('OnePort.mo')).classes[0];
    expect(onePort.partial).toBe(true);
    expect(onePort.equations).toHaveLength(2);

    const icons = parse(fixture('Icons.mo')).classes[0];
    expect(icons.name).toBe('Icons');
    expect(icons.classes.length).toBeGreaterThan(30);
    expect(icons.classes.find((c) => c.name === 'SignalBus')).toMatchObject({ restriction: 'connector', expandable: true });
    expect(icons.classes.find((c) => c.name === 'Function')).toMatchObject({ restriction: 'function', partial: true });

    const continuous = parse(fixture('Continuous.mo')).classes[0];
    expect(continuous.classes.map((c) => c.name)).toContain('Integrator');
    expect(continuous.classes.map((c) => c.name)).toContain('Internal');
    const integrator = continuous.classes.find((c) => c.name === 'Integrator')!;
    expect(integrator.initialEquations.length).toBeGreaterThan(0);
    expect(integrator.equations.some((e) => e.kind === 'if')).toBe(true);
    const internal = continuous.classes.find((c) => c.name === 'Internal')!;
    const criticalDamping = internal.classes.find((c) => c.name === 'Filter')!.classes.find((c) => c.name === 'base')!.classes.find((c) => c.name === 'CriticalDamping')!;
    expect(criticalDamping.restriction).toBe('function');
    expect(criticalDamping.algorithms).toHaveLength(1);
    expect(criticalDamping.algorithms![0].text).toContain('alpha := sqrt(10^(3/10/order)-1);');
    expect(criticalDamping.algorithms![0].text).toContain('// Determine polynomials');
  });
});
