/**
 * Inline Modelica fixtures shared by the diagram tests: a mini electrical library with MSL-like
 * icons, placements and connection lines, a Blocks-style library with causal connectors and
 * `Dialog` parameters, and small example models using them.
 */
import { ClassRegistry } from '../registry.js';

export const MINI = `package Mini "Mini component library"
  extends Mini.Icons.Package;
  package Icons "Icons"
    partial package Package "Standard package icon"
      annotation (Icon(coordinateSystem(preserveAspectRatio=false, extent={{-100,-100},{100,100}}), graphics={
        Rectangle(lineColor={200,200,200}, fillColor={248,248,248}, fillPattern=FillPattern.HorizontalCylinder, extent={{-100,-100},{100,100}}, radius=25),
        Rectangle(lineColor={128,128,128}, extent={{-100,-100},{100,100}}, radius=25)}));
    end Package;
    partial model Example "Runnable example icon"
      annotation (Icon(coordinateSystem(preserveAspectRatio=false, extent={{-100,-100},{100,100}}), graphics={
        Ellipse(lineColor={75,138,73}, fillColor={255,255,255}, fillPattern=FillPattern.Solid, extent={{-100,-100},{100,100}}),
        Polygon(lineColor={0,0,255}, fillColor={75,138,73}, pattern=LinePattern.None, fillPattern=FillPattern.Solid, points={{-36,60},{64,0},{-36,-60},{-36,60}})}));
    end Example;
  end Icons;
  package Units "Unit types"
    extends Mini.Icons.Package;
    type Voltage = Real(final quantity="ElectricPotential", final unit="V");
    type Current = Real(final quantity="ElectricCurrent", final unit="A");
    type Resistance = Real(final quantity="Resistance", final unit="Ohm");
    type Capacitance = Real(final quantity="Capacitance", final unit="F", min=0);
    type Temperature = Real(final quantity="ThermodynamicTemperature", final unit="K", displayUnit="degC", start=288.15);
    type HeatFlowRate = Real(final unit="W");
  end Units;
  package Thermal "Thermal"
    package Interfaces
      connector HeatPort "Thermal port"
        Units.Temperature T;
        flow Units.HeatFlowRate Q_flow;
        annotation (Icon(graphics={Rectangle(extent={{-100,100},{100,-100}}, lineColor={191,0,0}, fillColor={191,0,0}, fillPattern=FillPattern.Solid)}));
      end HeatPort;
    end Interfaces;
  end Thermal;
  package Electrical "Electrical components"
    extends Mini.Icons.Package;
    package Interfaces "Connectors and partial models"
      connector Pin "Electrical pin"
        Units.Voltage v "Potential at the pin";
        flow Units.Current i "Current flowing into the pin";
        annotation (Icon(coordinateSystem(extent={{-100,-100},{100,100}}), graphics={
          Rectangle(extent={{-100,100},{100,-100}}, lineColor={0,0,255}, fillColor={0,0,255}, fillPattern=FillPattern.Solid)}));
      end Pin;
      connector PositivePin = Pin "Positive pin";
      connector NegativePin "Negative pin"
        extends Pin;
        annotation (Icon(graphics={Rectangle(extent={{-40,40},{40,-40}}, lineColor={0,0,255}, fillColor={255,255,255}, fillPattern=FillPattern.Solid)}));
      end NegativePin;
      partial model TwoPin "Two pins"
        PositivePin p "Positive pin" annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
        NegativePin n "Negative pin" annotation (Placement(transformation(extent={{110,-10},{90,10}}), iconTransformation(extent={{90,-10},{110,10}})));
        Units.Voltage v "Voltage drop";
        annotation (Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}, grid={1,1}), graphics={
          Line(points={{-90,0},{-70,0}}, color={0,0,255}),
          Line(points={{70,0},{90,0}}, color={0,0,255})}));
      end TwoPin;
      partial model OnePort "One port"
        extends TwoPin;
        Units.Current i "Current from p to n";
      equation
        v = p.v - n.v;
        0 = p.i + n.i;
        i = p.i;
      end OnePort;
      partial model ConditionalHeatPort "Optional heat port"
        parameter Boolean useHeatPort = false "= true, if heatPort is enabled" annotation (Dialog(tab="Advanced"));
        parameter Units.Temperature T = 293.15 "Fixed device temperature if useHeatPort = false" annotation (Dialog(enable=not useHeatPort));
        Mini.Thermal.Interfaces.HeatPort heatPort if useHeatPort annotation (Placement(transformation(extent={{-10,-110},{10,-90}})));
      end ConditionalHeatPort;
    end Interfaces;
    package Basic "Basic components"
      extends Mini.Icons.Package;
      model Resistor "Ideal linear electrical resistor"
        parameter Units.Resistance R(start=1) "Resistance";
        parameter Units.Temperature T_ref = 300.15 "Reference temperature" annotation (Dialog(group="Temperature"));
        parameter Real alpha = 0 "Temperature coefficient";
        extends Interfaces.OnePort;
        extends Interfaces.ConditionalHeatPort(T=T_ref);
        Units.Resistance R_actual "Actual resistance";
      equation
        R_actual = R*(1 + alpha*(T - T_ref));
        v = R_actual*i;
        annotation (Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
          Rectangle(extent={{-70,30},{70,-30}}, lineColor={0,0,255}, fillColor={255,255,255}, fillPattern=FillPattern.Solid),
          Text(extent={{-150,-40},{150,-80}}, textString="R=%R"),
          Text(extent={{-150,90},{150,50}}, textString="%name", textColor={0,0,255})}));
      end Resistor;
      model Capacitor "Ideal linear electrical capacitor"
        extends Interfaces.OnePort;
        parameter Units.Capacitance C(start=1) "Capacitance";
      equation
        i = C*der(v);
        annotation (Icon(graphics={
          Line(points={{-6,28},{-6,-28}}, color={0,0,255}),
          Line(points={{6,28},{6,-28}}, color={0,0,255})}));
      end Capacitor;
      model Ground "Connects a pin to zero potential"
        Interfaces.Pin p annotation (Placement(transformation(origin={0,100}, extent={{-10,-10},{10,10}}, rotation=270)));
      equation
        p.v = 0;
        annotation (Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
          Line(points={{-60,50},{60,50}}, color={0,0,255}),
          Line(points={{0,90},{0,50}}, color={0,0,255})}));
      end Ground;
    end Basic;
    package Sources "Sources"
      extends Mini.Icons.Package;
      model ConstantVoltage "Source for constant voltage"
        extends Interfaces.OnePort;
        parameter Units.Voltage V(start=1) "Value of constant voltage";
      equation
        v = V;
        annotation (Icon(graphics={Line(points={{-90,0},{-10,0}}, color={0,0,255}), Line(points={{10,0},{90,0}}, color={0,0,255})}));
      end ConstantVoltage;
    end Sources;
  end Electrical;
end Mini;`;

export const CIRCUITS = `package Circuits "Example circuits"
  model RC "RC circuit"
    extends Mini.Icons.Example;
    parameter Real Rval = 100 "Resistance value";
    Mini.Electrical.Basic.Resistor resistor(R=Rval, T_ref=310, alpha(start=0.1)) "The resistor"
      annotation (Placement(transformation(extent={{-10,30},{10,50}})));
    Mini.Electrical.Basic.Capacitor capacitor(C=1e-3)
      annotation (Placement(transformation(origin={40,0}, extent={{-10,-10},{10,10}}, rotation=270)));
    Mini.Electrical.Sources.ConstantVoltage source(V=10)
      annotation (Placement(transformation(origin={-40,0}, extent={{-10,-10},{10,10}}, rotation=90)));
    Mini.Electrical.Basic.Ground ground
      annotation (Placement(transformation(extent={{-50,-50},{-30,-30}})));
    Mini.Electrical.Interfaces.Pin pin "External pin"
      annotation (Placement(transformation(extent={{90,-10},{110,10}}), iconTransformation(extent={{90,-10},{110,10}})));
    Unknown.Thing broken annotation (Placement(transformation(extent={{60,60},{80,80}})));
  protected
    Mini.Electrical.Basic.Resistor internal(R=1) "Hidden helper";
    Real hidden;
  equation
    hidden = resistor.v;
    connect(source.p, resistor.p) annotation (Line(points={{-40,10},{-40,40},{-10,40}}, color={0,0,255}));
    connect(resistor.n, capacitor.p);
    connect(capacitor.n, ground.p) annotation (Line(points={{40,-10},{40,-30},{-40,-30}}, color={0,0,255}));
    connect(source.n, ground.p);
    connect(capacitor.p, pin);
    connect(nowhere.p, pin);
    connect(resistor.heatPort, pin);
    annotation (Diagram(coordinateSystem(extent={{-100,-100},{100,100}}), graphics={Text(extent={{-90,90},{90,70}}, textString="RC circuit")}),
      experiment(StopTime=1));
  end RC;
  model ExtendedRC "RC with a load"
    extends RC(resistor(R=5));
    Mini.Electrical.Basic.Resistor load annotation (Placement(transformation(extent={{60,-10},{80,10}})));
  equation
    connect(pin, load.p) annotation (Line(points={{100,0},{60,0}}, color={0,0,255}));
  end ExtendedRC;
end Circuits;`;

export const MINI_BLOCKS = `package MiniBlocks "Mini blocks library"
  extends Mini.Icons.Package;
  package Constants
    constant Real pi = 3.141592653589793;
    constant Real small = 1e-60;
    constant Real twoPi = 2*pi;
  end Constants;
  package Interfaces "Connectors"
    connector RealInput = input Real "'input Real' as connector" annotation (defaultComponentName="u",
      Icon(graphics={Polygon(lineColor={0,0,127}, fillColor={0,0,127}, fillPattern=FillPattern.Solid, points={{-100,100},{100,0},{-100,-100}})},
        coordinateSystem(extent={{-100,-100},{100,100}}, preserveAspectRatio=true, initialScale=0.2)));
    connector RealOutput = output Real "'output Real' as connector" annotation (
      Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}),
        graphics={Polygon(lineColor={0,0,127}, fillColor={255,255,255}, fillPattern=FillPattern.Solid, points={{-100,100},{100,0},{-100,-100}})}));
    connector BooleanInput = input Boolean "'input Boolean' as connector" annotation (
      Icon(graphics={Polygon(points={{-100,100},{100,0},{-100,-100},{-100,100}}, lineColor={255,0,255}, fillColor={255,0,255}, fillPattern=FillPattern.Solid)}));
    connector Trigger = input Boolean "Causal connector without a signal-type name";
    partial block SISO "Single input single output"
      RealInput u "Input signal" annotation (Placement(transformation(extent={{-140,-20},{-100,20}})));
      RealOutput y "Output signal" annotation (Placement(transformation(extent={{100,-10},{120,10}})));
      annotation (Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
        Rectangle(extent={{-100,-100},{100,100}}, lineColor={0,0,127}, fillColor={255,255,255}, fillPattern=FillPattern.Solid),
        Text(extent={{-150,150},{150,110}}, textString="%name", textColor={0,0,255})}));
    end SISO;
  end Interfaces;
  package Types
    type Init = enumeration(NoInit "No initialization", SteadyState "Steady state", InitialState "Initial state", InitialOutput "Initial output") "Initialization";
  end Types;
  package Continuous "Continuous blocks"
    block Integrator "Output the integral of the input signal"
      parameter Real k = 1 "Integrator gain";
      parameter MiniBlocks.Types.Init initType = MiniBlocks.Types.Init.InitialState "Type of initialization" annotation (Dialog(group="Initialization"));
      parameter Real y_start = 0 "Initial value of output" annotation (Dialog(group="Initialization"));
      extends Interfaces.SISO(y(start=y_start, fixed=true));
    equation
      der(y) = k*u;
      annotation (Icon(graphics={Text(extent={{-150,-150},{150,-110}}, textString="k=%k")}));
    end Integrator;
    block FirstOrder "First order transfer function"
      extends Interfaces.SISO;
      parameter Real k = 1 "Gain";
      parameter Real T(min=Constants.small) = 0.1 "Time constant";
      parameter Real f = 1 "Frequency";
      final parameter Real w = MiniBlocks.Constants.twoPi*f "Angular frequency";
      output Real x(start=0) "State";
      discrete Real cnt "Counter";
      Boolean on "Switch";
      Interfaces.BooleanInput trigger annotation (Placement(transformation(extent={{-20,-140},{20,-100}}, rotation=90)));
      Interfaces.Trigger reset;
    protected
      parameter Real hiddenParam = 2;
      Real hiddenVar;
    equation
      der(x) = (u - x)/T;
      y = k*x;
      hiddenVar = x;
      der(cnt) = 0;
      on = x > 0;
    end FirstOrder;
  end Continuous;
  package Sources "Sources"
    block Constant "Constant output"
      parameter Real k = 1 "Constant output value";
      Interfaces.RealOutput y annotation (Placement(transformation(extent={{100,-10},{120,10}})));
    equation
      y = k;
      annotation (Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
        Rectangle(extent={{-100,-100},{100,100}}, lineColor={0,0,127}, fillColor={255,255,255}, fillPattern=FillPattern.Solid),
        Line(points={{-80,0},{80,0}}, color={0,0,127})}));
    end Constant;
  end Sources;
  package Records
    record Data "Parameter record"
      parameter Real a = 1 "Field a";
      Real b(unit="m") = 2 "Field b";
      constant Integer n = 3;
    end Data;
  end Records;
end MiniBlocks;`;

export const LOOP = `model Loop "Signal loop"
  MiniBlocks.Sources.Constant const(k=2) annotation (Placement(transformation(extent={{-60,-10},{-40,10}})));
  MiniBlocks.Continuous.Integrator integrator(k=const.k*2, initType=MiniBlocks.Types.Init.SteadyState)
    annotation (Placement(transformation(extent={{0,-10},{20,10}})));
  MiniBlocks.Continuous.FirstOrder firstOrder(f=2, T(min=0.01) = 0.5) annotation (Placement(transformation(extent={{40,-10},{60,10}})));
  parameter MiniBlocks.Records.Data data(a=10, b(start=5)) "Record parameter";
  MiniBlocks.Records.Data placedData(a=3) annotation (Placement(transformation(extent={{60,60},{80,80}})));
equation
  connect(const.y, integrator.u);
  connect(integrator.y, firstOrder.u) annotation (Line(points={{21,0},{38,0}}, color={0,0,127}));
end Loop;`;

/** Registry with `Mini` (read-only library), `MiniBlocks` (read-only) and the editable `Examples` project. */
export function makeRegistry(): ClassRegistry {
  const registry = new ClassRegistry();
  registry.addLibrary({ id: 'Mini', name: 'Mini', readOnly: true });
  registry.addLibrary({ id: 'MiniBlocks', name: 'MiniBlocks', readOnly: true });
  registry.addLibrary({ id: 'Examples', name: 'Examples', readOnly: false });
  for (const [lib, path, text] of [
    ['Mini', 'Mini.mo', MINI],
    ['MiniBlocks', 'MiniBlocks.mo', MINI_BLOCKS],
    ['Examples', 'Circuits.mo', CIRCUITS],
    ['Examples', 'Loop.mo', LOOP],
  ] as const) {
    const diagnostics = registry.addFile(lib, path, text);
    if (diagnostics.length) throw new Error(`${path}: ${diagnostics.map((d) => d.message).join('; ')}`);
  }
  return registry;
}
