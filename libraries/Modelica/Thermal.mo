within Modelica;
package Thermal "Library of thermal system components to model heat transfer"
  extends Modelica.Icons.Package;

  package HeatTransfer "Library of 1-dimensional heat transfer with lumped elements"
    extends Modelica.Icons.Package;

    package Examples "Example models to demonstrate the usage of package Modelica.Thermal.HeatTransfer"
      extends Modelica.Icons.ExamplesPackage;

      model TwoMasses "Simple conduction demo"
        extends Modelica.Icons.Example;
        Modelica.Units.SI.Temperature T_final_K "Projected final temperature";
        Modelica.Thermal.HeatTransfer.Components.HeatCapacitor mass1(C=15, T(start=373.15, fixed=true))
          annotation (Placement(transformation(extent={{-100,20},{-40,80}})));
        Modelica.Thermal.HeatTransfer.Components.HeatCapacitor mass2(C=15, T(start=273.15, fixed=true))
          annotation (Placement(transformation(extent={{40,20},{100,80}})));
        Modelica.Thermal.HeatTransfer.Components.ThermalConductor conduction(G=10)
          annotation (Placement(transformation(extent={{-30,-20},{30,40}})));
        Modelica.Thermal.HeatTransfer.Celsius.TemperatureSensor Tsensor1
          annotation (Placement(transformation(extent={{-60,-80},{-20,-40}})));
        Modelica.Thermal.HeatTransfer.Celsius.TemperatureSensor Tsensor2
          annotation (Placement(transformation(extent={{60,-80},{20,-40}})));
      equation
        T_final_K = (mass1.T*mass1.C + mass2.T*mass2.C)/(mass1.C + mass2.C);
        connect(mass1.port, conduction.port_a) annotation (Line(points={{-70,20},{-70,10},{-30,10}}, color={191,0,0}));
        connect(conduction.port_b, mass2.port) annotation (Line(points={{30,10},{70,10},{70,20}}, color={191,0,0}));
        connect(mass1.port, Tsensor1.port) annotation (Line(points={{-70,20},{-70,-60},{-60,-60}}, color={191,0,0}));
        connect(mass2.port, Tsensor2.port) annotation (Line(points={{70,20},{70,-60},{60,-60}}, color={191,0,0}));
        annotation (Documentation(info="<html>
<p>
This example demonstrates the thermal response of two masses connected by
a conducting element. The two masses have the same heat capacity but different
initial temperatures (T1=100 [degC], T2= 0 [degC]). The mass with the higher
temperature will cool off while the mass with the lower temperature heats up.
They will each asymptotically approach the calculated temperature <strong>T_final_K</strong>
that results from dividing the total initial energy in the system by the sum
of the heat capacities of each element (in the Modelica Standard Library T_final_K is a
parameter computed in an initial equation; here it is a variable that stays constant
because energy is conserved).
</p>
<p>
Simulate for 5 s and plot the variables<br>
mass1.T, mass2.T, T_final_K or<br>
Tsensor1.T, Tsensor2.T
</p>
</html>"),
          experiment(StopTime=1.0, Interval=0.001));
        // balance (flattened): 21 unknowns (T_final_K, mass1 4, mass2 4, conduction 6, Tsensor1 3, Tsensor2 3),
        // 21 equations (15 component equations + 6 connection equations from 2 connection sets with 6 heat ports)
      end TwoMasses;

      annotation (Documentation(info="<html>
<p>
This package contains example models to demonstrate the usage of the heat transfer components.
</p>
</html>"));
    end Examples;

    package Components "Lumped thermal components"
      extends Modelica.Icons.Package;

      model HeatCapacitor "Lumped thermal element storing heat"
        parameter Modelica.Units.SI.HeatCapacity C "Heat capacity of element (= cp*m)";
        Modelica.Units.SI.Temperature T(start=293.15, displayUnit="degC") "Temperature of element";
        Modelica.Units.SI.TemperatureSlope der_T(start=0) "Time derivative of temperature (= der(T))";
        Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a port annotation (Placement(transformation(
              origin={0,-100},
              extent={{-10,-10},{10,10}},
              rotation=90)));
      equation
        T = port.T;
        der_T = der(T);
        C*der(T) = port.Q_flow;
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Text(
                extent={{-150,110},{150,70}},
                textString="%name",
                textColor={0,0,255}),
              Polygon(
                points={{0,67},{-20,63},{-40,57},{-52,43},{-58,35},{-68,25},{-72,13},{-76,-1},{-78,-15},{-76,-31},{-76,-43},{-76,-53},{-70,-65},{-64,-73},{-48,-77},{-30,-83},{-18,-83},{-2,-85},{8,-89},{22,-89},{32,-87},{42,-81},{54,-75},{56,-73},{66,-61},{68,-53},{70,-51},{72,-35},{76,-21},{78,-13},{78,3},{74,15},{66,25},{54,33},{44,41},{36,57},{26,65},{0,67}},
                lineColor={160,160,164},
                fillColor={192,192,192},
                fillPattern=FillPattern.Solid),
              Polygon(
                points={{-58,35},{-68,25},{-72,13},{-76,-1},{-78,-15},{-76,-31},{-76,-43},{-76,-53},{-70,-65},{-64,-73},{-48,-77},{-30,-83},{-18,-83},{-2,-85},{8,-89},{22,-89},{32,-87},{42,-81},{54,-75},{42,-77},{40,-77},{30,-79},{20,-81},{18,-81},{10,-81},{2,-77},{-12,-73},{-22,-73},{-30,-71},{-40,-65},{-50,-55},{-56,-43},{-58,-35},{-58,-25},{-60,-13},{-60,-5},{-60,7},{-58,17},{-56,19},{-52,27},{-48,35},{-44,45},{-40,57},{-58,35}},
                fillColor={160,160,164},
                fillPattern=FillPattern.Solid),
              Text(
                extent={{-69,7},{71,-24}},
                textString="%C")}),
          Documentation(info="<html>
<p>
This is a generic model for the heat capacity of a material.
No specific geometry is assumed beyond a total volume with
uniform temperature for the entire volume.
Furthermore, it is assumed that the heat capacity
is constant (independent of temperature).
</p>
<p>
The temperature T [Kelvin] of this component is a <strong>state</strong>.
A default of T = 25 degree Celsius (= 293.15 K)
is used as start value for initialization.
</p>
<blockquote><pre>
C = cp*m.
Typical values for cp at 20 degC in J/(kg.K):
   aluminium   896
   concrete    840
   copper      383
   iron        452
   silver      235
   steel       420 ... 500 (V2A)
   wood       2500
</pre></blockquote>
</html>"));
        // balance: 4 unknowns (port.T, port.Q_flow, T, der_T), 1 flow variable provided by connection, 3 equations
      end HeatCapacitor;

      model ThermalConductor "Lumped thermal element transporting heat without storing it"
        extends Modelica.Thermal.HeatTransfer.Interfaces.Element1D;
        parameter Modelica.Units.SI.ThermalConductance G "Constant thermal conductance of material";
      equation
        Q_flow = G*dT;
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Rectangle(
                extent={{-90,70},{90,-70}},
                pattern=LinePattern.None,
                fillColor={192,192,192},
                fillPattern=FillPattern.Backward),
              Line(
                points={{-90,70},{-90,-70}},
                thickness=0.5),
              Line(
                points={{90,70},{90,-70}},
                thickness=0.5),
              Text(
                extent={{-150,120},{150,80}},
                textString="%name",
                textColor={0,0,255}),
              Text(
                extent={{-150,-80},{150,-110}},
                textString="G=%G")}),
          Documentation(info="<html>
<p>
This is a model for transport of heat without storing it; see also:
<a href=\"modelica://Modelica.Thermal.HeatTransfer.Components.ThermalResistor\">ThermalResistor</a>.
It may be used for complicated geometries where
the thermal conductance G (= inverse of thermal resistance)
is determined by measurements and is assumed to be constant
over the range of operations. If the component consists mainly of
one type of material and a regular geometry, it may be calculated,
e.g., with one of the following equations:
</p>
<ul>
<li><p>
    Conductance for a <strong>box</strong> geometry under the assumption
    that heat flows along the box length:</p>
    <blockquote><pre>
G = k*A/L
k: Thermal conductivity (material constant)
A: Area of box
L: Length of box
    </pre></blockquote>
    </li>
<li><p>
    Conductance for a <strong>cylindrical</strong> geometry under the assumption
    that heat flows from the inside to the outside radius
    of the cylinder:</p>
    <blockquote><pre>
G = 2*pi*k*L/log(r_out/r_in)
pi   : Modelica.Constants.pi
k    : Thermal conductivity (material constant)
L    : Length of cylinder
r_out: Outer radius of cylinder
r_in : Inner radius of cylinder
    </pre></blockquote>
    </li>
</ul>
</html>"));
        // balance: 6 unknowns (port_a.T, port_a.Q_flow, port_b.T, port_b.Q_flow, Q_flow, dT),
        // 2 flow variables provided by connections, 4 equations (3 Element1D + 1)
      end ThermalConductor;

      model ThermalResistor "Lumped thermal element transporting heat without storing it"
        extends Modelica.Thermal.HeatTransfer.Interfaces.Element1D;
        parameter Modelica.Units.SI.ThermalResistance R "Constant thermal resistance of material";
      equation
        dT = R*Q_flow;
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Rectangle(
                extent={{-90,70},{90,-70}},
                pattern=LinePattern.None,
                fillColor={192,192,192},
                fillPattern=FillPattern.Forward),
              Line(
                points={{-90,70},{-90,-70}},
                thickness=0.5),
              Line(
                points={{90,70},{90,-70}},
                thickness=0.5),
              Text(
                extent={{-150,120},{150,78}},
                textString="%name",
                textColor={0,0,255}),
              Text(
                extent={{-150,-80},{150,-110}},
                textString="R=%R")}),
          Documentation(info="<html>
<p>
This is a model for transport of heat without storing it, same as the
<a href=\"modelica://Modelica.Thermal.HeatTransfer.Components.ThermalConductor\">ThermalConductor</a>
but using the thermal resistance instead of the thermal conductance as a parameter.
This is advantageous for series connections of ThermalResistors,
especially if it shall be allowed that a ThermalResistance is defined to be zero (i.e. no temperature difference).
</p>
</html>"));
        // balance: 6 unknowns (port_a.T, port_a.Q_flow, port_b.T, port_b.Q_flow, Q_flow, dT),
        // 2 flow variables provided by connections, 4 equations (3 Element1D + 1)
      end ThermalResistor;

      model Convection "Lumped thermal element for heat convection (Q_flow = Gc*dT)"
        Modelica.Units.SI.HeatFlowRate Q_flow "Heat flow rate from solid -> fluid";
        Modelica.Units.SI.TemperatureDifference dT "= solid.T - fluid.T";
        Modelica.Blocks.Interfaces.RealInput Gc(unit="W/K") "Signal representing the convective thermal conductance in [W/K]"
          annotation (Placement(transformation(
              origin={0,100},
              extent={{-20,-20},{20,20}},
              rotation=270)));
        Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a solid annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
        Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_b fluid annotation (Placement(transformation(extent={{90,-10},{110,10}})));
      equation
        dT = solid.T - fluid.T;
        solid.Q_flow = Q_flow;
        fluid.Q_flow = -Q_flow;
        Q_flow = Gc*dT;
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Rectangle(
                extent={{-62,80},{98,-80}},
                lineColor={255,255,255},
                fillColor={255,255,255},
                fillPattern=FillPattern.Solid),
              Rectangle(
                extent={{-90,80},{-60,-80}},
                fillColor={192,192,192},
                fillPattern=FillPattern.Backward),
              Text(
                extent={{-150,-90},{150,-130}},
                textString="%name",
                textColor={0,0,255}),
              Line(points={{100,0},{100,0}}, color={0,127,255}),
              Line(points={{-60,20},{76,20}}, color={191,0,0}),
              Line(points={{-60,-20},{76,-20}}, color={191,0,0}),
              Line(points={{-34,80},{-34,-80}}, color={0,127,255}),
              Line(points={{6,80},{6,-80}}, color={0,127,255}),
              Line(points={{40,80},{40,-80}}, color={0,127,255}),
              Line(points={{76,80},{76,-80}}, color={0,127,255}),
              Line(points={{-34,-80},{-44,-60}}, color={0,127,255}),
              Line(points={{-34,-80},{-24,-60}}, color={0,127,255}),
              Line(points={{6,-80},{-4,-60}}, color={0,127,255}),
              Line(points={{6,-80},{16,-60}}, color={0,127,255}),
              Line(points={{40,-80},{30,-60}}, color={0,127,255}),
              Line(points={{40,-80},{50,-60}}, color={0,127,255}),
              Line(points={{76,-80},{66,-60}}, color={0,127,255}),
              Line(points={{76,-80},{86,-60}}, color={0,127,255}),
              Line(points={{56,-30},{76,-20}}, color={191,0,0}),
              Line(points={{56,-10},{76,-20}}, color={191,0,0}),
              Line(points={{56,10},{76,20}}, color={191,0,0}),
              Line(points={{56,30},{76,20}}, color={191,0,0}),
              Text(
                extent={{22,124},{92,98}},
                textString="Gc")}),
          Documentation(info="<html>
<p>
This is a model of linear heat convection, e.g., the heat transfer between a plate and the surrounding air.
It may be used for complicated solid geometries and fluid flow over the solid by determining the
convective thermal conductance Gc by measurements. The basic constitutive equation for convection is
</p>
<blockquote><pre>
Q_flow = Gc*(solid.T - fluid.T);
Q_flow: Heat flow rate from connector 'solid' (e.g., a plate)
   to connector 'fluid' (e.g., the surrounding air)
</pre></blockquote>
<p>
Gc is an input signal to the component, since Gc is
nearly never constant in practice. For simple situations,
Gc may be <em>calculated</em> according to
</p>
<blockquote><pre>
Gc = A*h
A: Convection area (e.g., perimeter*length of a box)
h: Heat transfer coefficient
</pre></blockquote>
</html>"));
        // balance: 7 unknowns (solid.T, solid.Q_flow, fluid.T, fluid.Q_flow, Q_flow, dT, Gc),
        // 2 flow variables and 1 input provided by connections, 4 equations
      end Convection;

      model BodyRadiation "Lumped thermal element for radiation heat transfer"
        extends Modelica.Thermal.HeatTransfer.Interfaces.Element1D;
        parameter Real Gr(unit="m2") "Net radiation conductance between two surfaces (see docu)";
      equation
        Q_flow = Gr*Modelica.Constants.sigma*(port_a.T^4 - port_b.T^4);
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Rectangle(
                extent={{50,80},{90,-80}},
                fillColor={192,192,192},
                fillPattern=FillPattern.Backward),
              Rectangle(
                extent={{-90,80},{-50,-80}},
                fillColor={192,192,192},
                fillPattern=FillPattern.Backward),
              Line(points={{-36,10},{36,10}}, color={191,0,0}),
              Line(points={{-36,10},{-26,16}}, color={191,0,0}),
              Line(points={{-36,10},{-26,4}}, color={191,0,0}),
              Line(points={{-36,-10},{36,-10}}, color={191,0,0}),
              Line(points={{26,-16},{36,-10}}, color={191,0,0}),
              Line(points={{26,-4},{36,-10}}, color={191,0,0}),
              Line(points={{-36,-30},{36,-30}}, color={191,0,0}),
              Line(points={{-36,-30},{-26,-24}}, color={191,0,0}),
              Line(points={{-36,-30},{-26,-36}}, color={191,0,0}),
              Line(points={{-36,30},{36,30}}, color={191,0,0}),
              Line(points={{26,24},{36,30}}, color={191,0,0}),
              Line(points={{26,36},{36,30}}, color={191,0,0}),
              Text(
                extent={{-150,125},{150,85}},
                textString="%name",
                textColor={0,0,255}),
              Text(
                extent={{-150,-90},{150,-120}},
                textString="Gr=%Gr"),
              Rectangle(
                extent={{-50,80},{-44,-80}},
                lineColor={191,0,0},
                fillColor={191,0,0},
                fillPattern=FillPattern.Solid),
              Rectangle(
                extent={{45,80},{50,-80}},
                lineColor={191,0,0},
                fillColor={191,0,0},
                fillPattern=FillPattern.Solid)}),
          Documentation(info="<html>
<p>
This is a model describing the thermal radiation, i.e., electromagnetic
radiation emitted between two bodies as a result of their temperatures.
The following constitutive equation is used:
</p>
<blockquote><pre>
Q_flow = Gr*sigma*(port_a.T^4 - port_b.T^4);
</pre></blockquote>
<p>
where Gr is the radiation conductance and sigma is the Stefan-Boltzmann
constant (= Modelica.Constants.sigma). Gr may be determined by
measurements and is assumed to be constant over the range of operations.
</p>
<p>
<strong>Small convex object in large enclosure</strong>
(e.g., a hot machine in a room): Gr = e*A, where e is the emission value of the object (0..1)
and A the surface area of the object where radiation heat transfer takes place.
</p>
</html>"));
        // balance: 6 unknowns (port_a.T, port_a.Q_flow, port_b.T, port_b.Q_flow, Q_flow, dT),
        // 2 flow variables provided by connections, 4 equations (3 Element1D + 1)
      end BodyRadiation;

      annotation (Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
          Rectangle(
            origin={12,40},
            fillColor={192,192,192},
            fillPattern=FillPattern.Backward,
            extent={{-100,-100},{-70,18}}),
          Line(
            origin={12,40},
            points={{-44,16},{-44,-100}},
            color={0,127,255}),
          Line(
            origin={12,40},
            points={{-4,16},{-4,-100}},
            color={0,127,255}),
          Line(
            origin={12,40},
            points={{30,18},{30,-100}},
            color={0,127,255}),
          Line(
            origin={12,40},
            points={{66,18},{66,-100}},
            color={0,127,255}),
          Line(
            origin={12,40},
            points={{66,-100},{76,-80}},
            color={0,127,255}),
          Line(
            origin={12,40},
            points={{66,-100},{56,-80}},
            color={0,127,255}),
          Line(
            origin={12,40},
            points={{30,-100},{40,-80}},
            color={0,127,255}),
          Line(
            origin={12,40},
            points={{30,-100},{20,-80}},
            color={0,127,255}),
          Line(
            origin={12,40},
            points={{-4,-100},{6,-80}},
            color={0,127,255}),
          Line(
            origin={12,40},
            points={{-4,-100},{-14,-80}},
            color={0,127,255}),
          Line(
            origin={12,40},
            points={{-44,-100},{-34,-80}},
            color={0,127,255}),
          Line(
            origin={12,40},
            points={{-44,-100},{-54,-80}},
            color={0,127,255}),
          Line(
            origin={12,40},
            points={{-70,-60},{66,-60}},
            color={191,0,0}),
          Line(
            origin={12,40},
            points={{46,-70},{66,-60}},
            color={191,0,0}),
          Line(
            origin={12,40},
            points={{46,-50},{66,-60}},
            color={191,0,0}),
          Line(
            origin={12,40},
            points={{46,-30},{66,-20}},
            color={191,0,0}),
          Line(
            origin={12,40},
            points={{46,-10},{66,-20}},
            color={191,0,0}),
          Line(
            origin={12,40},
            points={{-70,-20},{66,-20}},
            color={191,0,0})}), Documentation(info="<html>
<p>Lumped thermal components: heat capacitor, conductor, resistor, convection and radiation.</p>
</html>"));
    end Components;

    package Sensors "Thermal sensors"
      extends Modelica.Icons.SensorsPackage;

      model TemperatureSensor "Absolute temperature sensor in Kelvin"
        Modelica.Blocks.Interfaces.RealOutput T(unit="K") "Absolute temperature as output signal"
          annotation (Placement(transformation(extent={{100,-10},{120,10}}), iconTransformation(extent={{100,-10},{120,10}})));
        Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a port annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
      equation
        T = port.T;
        port.Q_flow = 0;
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Ellipse(
                extent={{-20,-98},{20,-60}},
                lineThickness=0.5,
                fillColor={191,0,0},
                fillPattern=FillPattern.Solid),
              Rectangle(
                extent={{-12,40},{12,-68}},
                lineColor={191,0,0},
                fillColor={191,0,0},
                fillPattern=FillPattern.Solid),
              Line(points={{12,0},{100,0}}, color={0,0,127}),
              Line(points={{-90,0},{-12,0}}, color={191,0,0}),
              Polygon(
                points={{-12,40},{-12,80},{-10,86},{-6,88},{0,90},{6,88},{10,86},{12,80},{12,40},{-12,40}},
                lineThickness=0.5),
              Line(
                points={{-12,40},{-12,-64}},
                thickness=0.5),
              Line(
                points={{12,40},{12,-64}},
                thickness=0.5),
              Line(points={{-40,-20},{-12,-20}}),
              Line(points={{-40,20},{-12,20}}),
              Line(points={{-40,60},{-12,60}}),
              Text(
                extent={{-150,140},{150,100}},
                textString="%name",
                textColor={0,0,255}),
              Text(
                extent={{20,60},{80,0}},
                textColor={64,64,64},
                textString="K")}),
          Documentation(info="<html>
<p>
This is an ideal absolute temperature sensor which returns
the temperature of the connected port in Kelvin as an output
signal.  The sensor itself has no thermal interaction with
whatever it is connected to.  Furthermore, no
thermocouple-like lags are associated with this
sensor model.
</p>
</html>"));
        // balance: 3 unknowns (port.T, port.Q_flow, T), 1 flow variable provided by connection, 2 equations
      end TemperatureSensor;

      model HeatFlowSensor "Heat flow rate sensor"
        extends Modelica.Icons.RoundSensor;
        Modelica.Blocks.Interfaces.RealOutput Q_flow(unit="W") "Heat flow from port_a to port_b as output signal"
          annotation (Placement(transformation(
              origin={0,-110},
              extent={{-10,-10},{10,10}},
              rotation=270), iconTransformation(
              extent={{-10,-10},{10,10}},
              rotation=270,
              origin={0,-110})));
        Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a port_a annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
        Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_b port_b annotation (Placement(transformation(extent={{90,-10},{110,10}})));
      equation
        port_a.T = port_b.T;
        port_a.Q_flow + port_b.Q_flow = 0;
        Q_flow = port_a.Q_flow;
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Line(points={{-70,0},{-90,0}}, color={191,0,0}),
              Line(points={{70,0},{90,0}}, color={191,0,0}),
              Line(points={{0,-70},{0,-100}}, color={0,0,127}),
              Text(
                extent={{-150,120},{150,80}},
                textString="%name",
                textColor={0,0,255}),
              Text(
                extent={{-30,-10},{30,-70}},
                textColor={64,64,64},
                textString="W")}),
          Documentation(info="<html>
<p>
This model is capable of monitoring the heat flow rate flowing through
this component. The sensed value of heat flow rate is the amount that
passes through this sensor while keeping the temperature drop across the
sensor zero.  This is an ideal model so it does not absorb any energy
and it has no direct effect on the thermal response of a system it is included in.
The output signal is positive, if the heat flows from port_a to port_b.
</p>
</html>"));
        // balance: 5 unknowns (port_a.T, port_a.Q_flow, port_b.T, port_b.Q_flow, Q_flow),
        // 2 flow variables provided by connections, 3 equations
      end HeatFlowSensor;

      model RelTemperatureSensor "Relative temperature sensor"
        extends Modelica.Icons.RectangularSensor;
        Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a port_a annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
        Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_b port_b annotation (Placement(transformation(extent={{90,-10},{110,10}})));
        Modelica.Blocks.Interfaces.RealOutput T_rel(unit="K", displayUnit="K") "Relative temperature as output signal"
          annotation (Placement(transformation(
              origin={0,-110},
              extent={{10,-10},{-10,10}},
              rotation=90), iconTransformation(
              extent={{10,-10},{-10,10}},
              rotation=90,
              origin={0,-110})));
      equation
        T_rel = port_a.T - port_b.T;
        0 = port_a.Q_flow;
        0 = port_b.Q_flow;
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Line(points={{-90,0},{-70,0},{-70,0}}, color={191,0,0}),
              Line(points={{-90,0},{-70,0},{-70,0}}, color={191,0,0}),
              Line(points={{70,0},{90,0},{90,0}}, color={191,0,0}),
              Line(points={{0,-38},{0,-100}}, color={0,0,127}),
              Text(
                extent={{-150,80},{150,40}},
                textString="%name",
                textColor={0,0,255}),
              Text(
                extent={{-24,20},{66,-40}},
                textColor={64,64,64},
                textString="K")}),
          Documentation(info="<html>
<p>
The relative temperature &quot;port_a.T - port_b.T&quot; is determined between
the two ports of this component and is provided as output signal in Kelvin.
</p>
</html>"));
        // balance: 5 unknowns (port_a.T, port_a.Q_flow, port_b.T, port_b.Q_flow, T_rel),
        // 2 flow variables provided by connections, 3 equations
      end RelTemperatureSensor;

      annotation (Documentation(info="<html>
<p>Ideal sensors for temperature, heat flow rate and temperature difference.</p>
</html>"));
    end Sensors;

    package Sources "Thermal sources"
      extends Modelica.Icons.SourcesPackage;

      model FixedTemperature "Fixed temperature boundary condition in Kelvin"
        parameter Modelica.Units.SI.Temperature T "Fixed temperature at port";
        Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_b port annotation (Placement(transformation(extent={{90,-10},{110,10}})));
      equation
        port.T = T;
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Text(
                extent={{-150,150},{150,110}},
                textString="%name",
                textColor={0,0,255}),
              Text(
                extent={{-150,-110},{150,-140}},
                textString="T=%T"),
              Rectangle(
                extent={{-100,100},{100,-100}},
                pattern=LinePattern.None,
                fillColor={159,159,223},
                fillPattern=FillPattern.Backward),
              Text(
                extent={{0,0},{-100,-100}},
                textString="K"),
              Line(
                points={{-52,0},{56,0}},
                color={191,0,0},
                thickness=0.5),
              Polygon(
                points={{50,-20},{50,20},{90,0},{50,-20}},
                lineColor={191,0,0},
                fillColor={191,0,0},
                fillPattern=FillPattern.Solid)}),
          Documentation(info="<html>
<p>
This model defines a fixed temperature T at its port in Kelvin,
i.e., it defines a fixed temperature as a boundary condition.
</p>
</html>"));
        // balance: 2 unknowns (port.T, port.Q_flow), 1 flow variable provided by connection, 1 equation
      end FixedTemperature;

      model PrescribedTemperature "Variable temperature boundary condition in Kelvin"
        Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_b port annotation (Placement(transformation(extent={{90,-10},{110,10}})));
        Modelica.Blocks.Interfaces.RealInput T(unit="K") annotation (Placement(transformation(extent={{-140,-20},{-100,20}})));
      equation
        port.T = T;
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Rectangle(
                extent={{-100,100},{100,-100}},
                pattern=LinePattern.None,
                fillColor={159,159,223},
                fillPattern=FillPattern.Backward),
              Line(
                points={{-102,0},{64,0}},
                color={191,0,0},
                thickness=0.5),
              Text(
                extent={{0,0},{-100,-100}},
                textString="K"),
              Text(
                extent={{-150,150},{150,110}},
                textString="%name",
                textColor={0,0,255}),
              Polygon(
                points={{50,-20},{50,20},{90,0},{50,-20}},
                lineColor={191,0,0},
                fillColor={191,0,0},
                fillPattern=FillPattern.Solid)}),
          Documentation(info="<html>
<p>
This model represents a variable temperature boundary condition.
The temperature in [K] is given as input signal <strong>T</strong>
to the model. The effect is that an instance of this model acts as
an infinite reservoir able to absorb or generate as much energy
as required to keep the temperature at the specified value.
</p>
</html>"));
        // balance: 3 unknowns (port.T, port.Q_flow, T), 1 flow variable and 1 input provided by connections, 1 equation
      end PrescribedTemperature;

      model FixedHeatFlow "Fixed heat flow boundary condition"
        parameter Modelica.Units.SI.HeatFlowRate Q_flow "Fixed heat flow rate at port";
        parameter Modelica.Units.SI.Temperature T_ref=293.15 "Reference temperature";
        parameter Modelica.Units.SI.LinearTemperatureCoefficient alpha=0 "Temperature coefficient of heat flow rate";
        Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_b port annotation (Placement(transformation(extent={{90,-10},{110,10}})));
      equation
        port.Q_flow = -Q_flow*(1 + alpha*(port.T - T_ref));
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Text(
                extent={{-150,100},{150,60}},
                textString="%name",
                textColor={0,0,255}),
              Text(
                extent={{-150,-55},{150,-85}},
                textString="Q_flow=%Q_flow"),
              Line(
                points={{-100,-20},{48,-20}},
                color={191,0,0},
                thickness=0.5),
              Line(
                points={{-100,20},{46,20}},
                color={191,0,0},
                thickness=0.5),
              Polygon(
                points={{40,0},{40,40},{70,20},{40,0}},
                lineColor={191,0,0},
                fillColor={191,0,0},
                fillPattern=FillPattern.Solid),
              Polygon(
                points={{40,-40},{40,0},{70,-20},{40,-40}},
                lineColor={191,0,0},
                fillColor={191,0,0},
                fillPattern=FillPattern.Solid),
              Rectangle(
                extent={{70,40},{90,-40}},
                lineColor={191,0,0},
                fillColor={191,0,0},
                fillPattern=FillPattern.Solid)}),
          Documentation(info="<html>
<p>
This model allows a specified amount of heat flow rate to be &quot;injected&quot;
into a thermal system at a given port.  The constant amount of heat
flow rate Q_flow is given as a parameter. The heat flows into the
component to which the component FixedHeatFlow is connected,
if parameter Q_flow is positive.
</p>
<p>
If parameter alpha is &lt;&gt; 0, the heat flow is multiplied by (1 + alpha*(port.T - T_ref))
in order to simulate temperature dependent losses (which are given with respect to reference temperature T_ref).
</p>
</html>"));
        // balance: 2 unknowns (port.T, port.Q_flow), 1 flow variable provided by connection, 1 equation
      end FixedHeatFlow;

      model PrescribedHeatFlow "Prescribed heat flow boundary condition"
        parameter Modelica.Units.SI.Temperature T_ref=293.15 "Reference temperature";
        parameter Modelica.Units.SI.LinearTemperatureCoefficient alpha=0 "Temperature coefficient of heat flow rate";
        Modelica.Blocks.Interfaces.RealInput Q_flow(unit="W") annotation (Placement(transformation(
              origin={-100,0},
              extent={{20,-20},{-20,20}},
              rotation=180)));
        Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_b port annotation (Placement(transformation(extent={{90,-10},{110,10}})));
      equation
        port.Q_flow = -Q_flow*(1 + alpha*(port.T - T_ref));
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Line(
                points={{-60,-20},{40,-20}},
                color={191,0,0},
                thickness=0.5),
              Line(
                points={{-60,20},{40,20}},
                color={191,0,0},
                thickness=0.5),
              Line(
                points={{-80,0},{-60,-20}},
                color={191,0,0},
                thickness=0.5),
              Line(
                points={{-80,0},{-60,20}},
                color={191,0,0},
                thickness=0.5),
              Polygon(
                points={{40,0},{40,40},{70,20},{40,0}},
                lineColor={191,0,0},
                fillColor={191,0,0},
                fillPattern=FillPattern.Solid),
              Polygon(
                points={{40,-40},{40,0},{70,-20},{40,-40}},
                lineColor={191,0,0},
                fillColor={191,0,0},
                fillPattern=FillPattern.Solid),
              Rectangle(
                extent={{70,40},{90,-40}},
                lineColor={191,0,0},
                fillColor={191,0,0},
                fillPattern=FillPattern.Solid),
              Text(
                extent={{-150,100},{150,60}},
                textString="%name",
                textColor={0,0,255})}),
          Documentation(info="<html>
<p>
This model allows a specified amount of heat flow rate to be &quot;injected&quot;
into a thermal system at a given port.  The amount of heat
is given by the input signal Q_flow into the model. The heat flows into the
component to which the component PrescribedHeatFlow is connected,
if the input signal is positive.
</p>
<p>
If parameter alpha is &lt;&gt; 0, the heat flow is multiplied by (1 + alpha*(port.T - T_ref))
in order to simulate temperature dependent losses (which are given with respect to reference temperature T_ref).
</p>
</html>"));
        // balance: 3 unknowns (port.T, port.Q_flow, Q_flow), 1 flow variable and 1 input provided by connections, 1 equation
      end PrescribedHeatFlow;

      annotation (Documentation(info="<html>
<p>Fixed and prescribed temperature and heat flow boundary conditions.</p>
</html>"));
    end Sources;

    package Celsius "Components with Celsius input and/or output"
      extends Modelica.Icons.VariantsPackage;

      model ToKelvin "Conversion from degree Celsius to Kelvin"
        extends Modelica.Thermal.HeatTransfer.Icons.Conversion;
        Modelica.Blocks.Interfaces.RealInput Celsius(unit="degC") annotation (Placement(transformation(extent={{-140,-20},{-100,20}})));
        Modelica.Blocks.Interfaces.RealOutput Kelvin(unit="K") annotation (Placement(transformation(extent={{100,-10},{120,10}})));
      equation
        Kelvin = Celsius + 273.15;
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Text(
                extent={{-100,60},{-40,0}},
                textColor={64,64,64},
                textString="degC"),
              Text(
                extent={{40,60},{100,0}},
                textColor={64,64,64},
                textString="K")}),
          Documentation(info="<html>
<p>
This component converts an input signal from Celsius to Kelvin
and provide is as output signal.
</p>
</html>"));
        // balance: 2 unknowns (Celsius, Kelvin), 1 input provided by connection, 1 equation
      end ToKelvin;

      model FromKelvin "Conversion from Kelvin to degree Celsius"
        extends Modelica.Thermal.HeatTransfer.Icons.Conversion;
        Modelica.Blocks.Interfaces.RealInput Kelvin(unit="K") annotation (Placement(transformation(extent={{-140,-20},{-100,20}})));
        Modelica.Blocks.Interfaces.RealOutput Celsius(unit="degC") annotation (Placement(transformation(extent={{100,-10},{120,10}})));
      equation
        Celsius = Kelvin - 273.15;
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Text(
                extent={{-100,60},{-40,0}},
                textColor={64,64,64},
                textString="K"),
              Text(
                extent={{40,60},{100,0}},
                textColor={64,64,64},
                textString="degC")}),
          Documentation(info="<html>
<p>
This component converts an input signal from Kelvin to Celsius
and provides is as output signal.
</p>
</html>"));
        // balance: 2 unknowns (Kelvin, Celsius), 1 input provided by connection, 1 equation
      end FromKelvin;

      model FixedTemperature "Fixed temperature boundary condition in degree Celsius"
        extends Modelica.Thermal.HeatTransfer.Icons.FixedTemperature;
        parameter Modelica.Units.NonSI.Temperature_degC T "Fixed temperature at the port";
        Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_b port annotation (Placement(transformation(extent={{90,-10},{110,10}})));
      equation
        port.T = T + 273.15;
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Text(
                extent={{-150,150},{150,110}},
                textString="%name",
                textColor={0,0,255}),
              Text(
                extent={{-100,-40},{-40,-100}},
                textColor={64,64,64},
                textString="degC")}),
          Documentation(info="<html>
<p>
This model defines a fixed temperature T at its port in [degC],
i.e., it defines a fixed temperature as a boundary condition.
</p>
</html>"),
          Diagram(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Polygon(
                points={{52,-20},{52,20},{90,0},{52,-20}},
                lineColor={191,0,0},
                fillColor={191,0,0},
                fillPattern=FillPattern.Solid)}));
        // balance: 2 unknowns (port.T, port.Q_flow), 1 flow variable provided by connection, 1 equation
      end FixedTemperature;

      model PrescribedTemperature "Variable temperature boundary condition in degCelsius"
        extends Modelica.Thermal.HeatTransfer.Icons.PrescribedTemperature;
        Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_b port annotation (Placement(transformation(extent={{90,-10},{110,10}})));
        Modelica.Blocks.Interfaces.RealInput T(unit="degC") annotation (Placement(transformation(extent={{-140,-20},{-100,20}})));
      equation
        port.T = T + 273.15;
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Text(
                extent={{-150,150},{150,110}},
                textString="%name",
                textColor={0,0,255}),
              Text(
                extent={{-100,-40},{-40,-100}},
                textColor={64,64,64},
                textString="degC")}),
          Documentation(info="<html>
<p>
This model represents a variable temperature boundary condition
The temperature value in [degC] is given by the input signal
to the model. The effect is that an instance of this model acts as
an infinite reservoir able to absorb or generate as much energy
as required to keep the temperature at the specified value.
</p>
</html>"));
        // balance: 3 unknowns (port.T, port.Q_flow, T), 1 flow variable and 1 input provided by connections, 1 equation
      end PrescribedTemperature;

      model TemperatureSensor "Absolute temperature sensor in degCelsius"
        Modelica.Blocks.Interfaces.RealOutput T(unit="degC") "Absolute temperature in degree Celsius as output signal"
          annotation (Placement(transformation(extent={{90,-10},{110,10}})));
        Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a port annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
      equation
        T = port.T - 273.15;
        port.Q_flow = 0;
        annotation (defaultComponentName="temperatureSensor",
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Ellipse(
                extent={{-20,-98},{20,-60}},
                lineThickness=0.5,
                fillColor={191,0,0},
                fillPattern=FillPattern.Solid),
              Rectangle(
                extent={{-12,40},{12,-68}},
                lineColor={191,0,0},
                fillColor={191,0,0},
                fillPattern=FillPattern.Solid),
              Line(points={{12,0},{90,0}}, color={0,0,255}),
              Line(points={{-90,0},{-12,0}}, color={191,0,0}),
              Polygon(
                points={{-12,40},{-12,80},{-10,86},{-6,88},{0,90},{6,88},{10,86},{12,80},{12,40},{-12,40}},
                lineThickness=0.5),
              Line(
                points={{-12,40},{-12,-64}},
                thickness=0.5),
              Line(
                points={{12,40},{12,-64}},
                thickness=0.5),
              Line(points={{-40,-20},{-12,-20}}),
              Line(points={{-40,20},{-12,20}}),
              Line(points={{-40,60},{-12,60}}),
              Text(
                extent={{150,-22},{30,-92}},
                textString="degC"),
              Text(
                extent={{-150,135},{150,95}},
                textString="%name",
                textColor={0,0,255})}),
          Documentation(info="<html>
<p>
This is an ideal absolute temperature sensor which returns
the temperature of the connected port in Celsius as an output
signal.  The sensor itself has no thermal interaction with
whatever it is connected to.  Furthermore, no
thermocouple-like lags are associated with this
sensor model.
</p>
</html>"));
        // balance: 3 unknowns (port.T, port.Q_flow, T), 1 flow variable provided by connection, 2 equations
      end TemperatureSensor;

      annotation (Documentation(info="<html>
<p>
The components of this package are provided for the convenience of
people working mostly with Celsius units, since all models
in package HeatTransfer are based on Kelvin units.
</p>
<p>
The conversion is done with plain arithmetic (K = degC + 273.15) because the conversion
functions of Modelica.Units.Conversions are not available on this platform.
</p>
</html>"));
    end Celsius;

    package Interfaces "Connectors and partial models"
      extends Modelica.Icons.InterfacesPackage;

      partial connector HeatPort "Thermal port for 1-dim. heat transfer"
        Modelica.Units.SI.Temperature T "Port temperature";
        flow Modelica.Units.SI.HeatFlowRate Q_flow "Heat flow rate (positive if flowing from outside into the component)";
        annotation (Documentation(info="<html>
<p>Basic thermal connector with temperature T and heat flow rate Q_flow; only used by inheritance for HeatPort_a and HeatPort_b.</p>
</html>"));
      end HeatPort;

      connector HeatPort_a "Thermal port for 1-dim. heat transfer (filled rectangular icon)"
        extends Modelica.Thermal.HeatTransfer.Interfaces.HeatPort;
        annotation (defaultComponentName="port_a",
          Documentation(info="<html>
<p>This connector is used for 1-dimensional heat flow between components.
The variables in the connector are:</p>
<blockquote><pre>
T       Temperature in [Kelvin].
Q_flow  Heat flow rate in [Watt].
</pre></blockquote>
<p>According to the Modelica sign convention, a <strong>positive</strong> heat flow
rate <strong>Q_flow</strong> is considered to flow <strong>into</strong> a component. This
convention has to be used whenever this connector is used in a model
class.</p>
<p>Note, that the two connector classes <strong>HeatPort_a</strong> and
<strong>HeatPort_b</strong> are identical with the only exception of the different
<strong>icon layout</strong>.</p></html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Rectangle(
                extent={{-100,100},{100,-100}},
                lineColor={191,0,0},
                fillColor={191,0,0},
                fillPattern=FillPattern.Solid)}),
          Diagram(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Rectangle(
                extent={{-50,50},{50,-50}},
                lineColor={191,0,0},
                fillColor={191,0,0},
                fillPattern=FillPattern.Solid), Text(
                extent={{-120,120},{100,60}},
                textColor={191,0,0},
                textString="%name")}));
      end HeatPort_a;

      connector HeatPort_b "Thermal port for 1-dim. heat transfer (unfilled rectangular icon)"
        extends Modelica.Thermal.HeatTransfer.Interfaces.HeatPort;
        annotation (defaultComponentName="port_b",
          Documentation(info="<html>
<p>This connector is used for 1-dimensional heat flow between components.
The variables in the connector are:</p>
<blockquote><pre>
T       Temperature in [Kelvin].
Q_flow  Heat flow rate in [Watt].
</pre></blockquote>
<p>According to the Modelica sign convention, a <strong>positive</strong> heat flow
rate <strong>Q_flow</strong> is considered to flow <strong>into</strong> a component. This
convention has to be used whenever this connector is used in a model
class.</p>
<p>Note, that the two connector classes <strong>HeatPort_a</strong> and
<strong>HeatPort_b</strong> are identical with the only exception of the different
<strong>icon layout</strong>.</p></html>"),
          Diagram(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Rectangle(
                extent={{-50,50},{50,-50}},
                lineColor={191,0,0},
                fillColor={255,255,255},
                fillPattern=FillPattern.Solid), Text(
                extent={{-100,120},{120,60}},
                textColor={191,0,0},
                textString="%name")}),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Rectangle(
                extent={{-100,100},{100,-100}},
                lineColor={191,0,0},
                fillColor={255,255,255},
                fillPattern=FillPattern.Solid)}));
      end HeatPort_b;

      partial model Element1D "Partial heat transfer element with two HeatPort connectors that does not store energy"
        Modelica.Units.SI.HeatFlowRate Q_flow "Heat flow rate from port_a -> port_b";
        Modelica.Units.SI.TemperatureDifference dT "port_a.T - port_b.T";
        Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a port_a annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
        Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_b port_b annotation (Placement(transformation(extent={{90,-10},{110,10}})));
      equation
        dT = port_a.T - port_b.T;
        port_a.Q_flow = Q_flow;
        port_b.Q_flow = -Q_flow;
        annotation (Documentation(info="<html>
<p>
This partial model contains the basic connectors and variables to
allow heat transfer models to be created that <strong>do not store energy</strong>,
This model defines and includes equations for the temperature
drop across the element, <strong>dT</strong>, and the heat flow rate
through the element from port_a to port_b, <strong>Q_flow</strong>.
</p>
<p>
By extending this model, it is possible to write simple
constitutive equations for many types of heat transfer components.
</p>
</html>"));
      end Element1D;

      annotation (Documentation(info="<html>
<p>Connectors and partial models of the heat transfer library.</p>
</html>"));
    end Interfaces;

    package Icons "Icons for HeatTransfer package"
      extends Modelica.Icons.IconsPackage;

      partial model Conversion "Conversion of temperatures"
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=false), graphics={
              Ellipse(
                extent={{-40,40},{40,-40}},
                fillColor={255,255,255},
                fillPattern=FillPattern.Solid,
                lineColor={191,0,0}),
              Line(points={{-40,0},{-100,0}}, color={0,0,127}),
              Line(points={{100,0},{40,0}}, color={0,0,127}),
              Text(
                extent={{-150,100},{150,60}},
                textString="%name",
                textColor={0,0,255}),
              Line(points={{-20,4},{20,4},{0,14}}, color={191,0,0}),
              Line(points={{-20,-4},{20,-4},{0,-16}}, color={191,0,0})}),
          Documentation(info="<html>
<p>
This icon represents part of a temperature conversion model.
</p>
</html>"));
      end Conversion;

      partial model FixedTemperature "Icon of fixed temperature source"
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=false), graphics={
              Rectangle(
                extent={{-100,100},{100,-100}},
                pattern=LinePattern.None,
                fillColor={159,159,223},
                fillPattern=FillPattern.Backward),
              Line(
                points={{-42,0},{66,0}},
                color={191,0,0},
                thickness=0.5),
              Polygon(
                points={{52,-20},{52,20},{90,0},{52,-20}},
                lineColor={191,0,0},
                fillColor={191,0,0},
                fillPattern=FillPattern.Solid)}),
          Documentation(info="<html>
<p>
This icon represents a fixed temperature source model.
</p>
</html>"));
      end FixedTemperature;

      partial model PrescribedTemperature "Icon of prescribed temperature source"
        extends Modelica.Thermal.HeatTransfer.Icons.FixedTemperature;
        annotation (Icon(graphics={Line(points={{-100,0},{-42,0}}, color={191,0,0})}), Documentation(info="<html>
<p>
This icon represents a prescribed temperature source model.
</p>
</html>"));
      end PrescribedTemperature;
    end Icons;

    annotation (
      Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
        Polygon(
          origin={13.758,27.517},
          lineColor={128,128,128},
          fillColor={192,192,192},
          fillPattern=FillPattern.Solid,
          points={{-54,-6},{-61,-7},{-75,-15},{-79,-24},{-80,-34},{-78,-42},{-73,-49},{-64,-51},{-57,-51},{-47,-50},{-41,-43},{-38,-35},{-40,-27},{-40,-20},{-42,-13},{-47,-7},{-54,-5},{-54,-6}}),
        Polygon(
          origin={13.758,27.517},
          fillColor={160,160,164},
          fillPattern=FillPattern.Solid,
          points={{-75,-15},{-79,-25},{-80,-34},{-78,-42},{-72,-49},{-64,-51},{-57,-51},{-47,-50},{-57,-47},{-65,-45},{-71,-40},{-74,-33},{-76,-23},{-75,-15},{-75,-15}}),
        Polygon(
          origin={13.758,27.517},
          lineColor={160,160,164},
          fillColor={192,192,192},
          fillPattern=FillPattern.Solid,
          points={{39,-6},{32,-7},{18,-15},{14,-24},{13,-34},{15,-42},{20,-49},{29,-51},{36,-51},{46,-50},{52,-43},{55,-35},{53,-27},{53,-20},{51,-13},{46,-7},{39,-5},{39,-6}}),
        Polygon(
          origin={13.758,27.517},
          fillColor={160,160,164},
          fillPattern=FillPattern.Solid,
          points={{18,-15},{14,-25},{13,-34},{15,-42},{21,-49},{29,-51},{36,-51},{46,-50},{36,-47},{28,-45},{22,-40},{19,-33},{17,-23},{18,-15},{18,-15}}),
        Polygon(
          origin={13.758,27.517},
          lineColor={191,0,0},
          fillColor={191,0,0},
          fillPattern=FillPattern.Solid,
          points={{-9,-23},{-9,-10},{18,-17},{-9,-23}}),
        Line(
          origin={13.758,27.517},
          points={{-41,-17},{-9,-17}},
          color={191,0,0},
          thickness=0.5),
        Line(
          origin={13.758,27.517},
          points={{-17,-40},{15,-40}},
          color={191,0,0},
          thickness=0.5),
        Polygon(
          origin={13.758,27.517},
          lineColor={191,0,0},
          fillColor={191,0,0},
          fillPattern=FillPattern.Solid,
          points={{-17,-46},{-17,-34},{-40,-40},{-17,-46}})}),
      Documentation(info="<html>
<p>
This package contains components to model <strong>1-dimensional heat transfer</strong>
with lumped elements.
</p>
<p>
Copyright &copy; 1998-2020, Modelica Association and contributors
</p>
</html>"));
  end HeatTransfer;

  annotation (
    Icon(coordinateSystem(extent={{-100.0,-100.0},{100.0,100.0}}), graphics={
      Line(
        origin={-47.5,11.6667},
        points={{-2.5,-91.6667},{17.5,-71.6667},{-22.5,-51.6667},{17.5,-31.6667},{-22.5,-11.667},{17.5,8.3333},{-2.5,28.3333},{-2.5,48.3333}},
        smooth=Smooth.Bezier),
      Polygon(
        origin={-50.0,68.333},
        pattern=LinePattern.None,
        fillPattern=FillPattern.Solid,
        points={{0.0,21.667},{-10.0,-8.333},{10.0,-8.333}}),
      Line(
        origin={2.5,11.6667},
        points={{-2.5,-91.6667},{17.5,-71.6667},{-22.5,-51.6667},{17.5,-31.6667},{-22.5,-11.667},{17.5,8.3333},{-2.5,28.3333},{-2.5,48.3333}},
        smooth=Smooth.Bezier),
      Polygon(
        origin={0.0,68.333},
        pattern=LinePattern.None,
        fillPattern=FillPattern.Solid,
        points={{0.0,21.667},{-10.0,-8.333},{10.0,-8.333}}),
      Line(
        origin={52.5,11.6667},
        points={{-2.5,-91.6667},{17.5,-71.6667},{-22.5,-51.6667},{17.5,-31.6667},{-22.5,-11.667},{17.5,8.3333},{-2.5,28.3333},{-2.5,48.3333}},
        smooth=Smooth.Bezier),
      Polygon(
        origin={50.0,68.333},
        pattern=LinePattern.None,
        fillPattern=FillPattern.Solid,
        points={{0.0,21.667},{-10.0,-8.333},{10.0,-8.333}})}),
    Documentation(info="<html>
<p>
This package contains libraries to model heat transfer.
</p>
</html>"));
end Thermal;
