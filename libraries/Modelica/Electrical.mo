within Modelica;
package Electrical "Library of electrical models (analog)"
  extends Modelica.Icons.Package;

  package Analog "Library for analog electrical models"
    extends Modelica.Icons.Package;

    package Examples "Examples that demonstrate the usage of the Analog electrical components"
      extends Modelica.Icons.ExamplesPackage;

      model ChuaCircuit "Chua's circuit, ns, V, A"
        extends Modelica.Icons.Example;
        Modelica.Electrical.Analog.Basic.Inductor L(L=18, i(start=0, fixed=true)) annotation (Placement(transformation(
              origin={-75,38},
              extent={{-25,-25},{25,25}},
              rotation=270)));
        Modelica.Electrical.Analog.Basic.Resistor Ro(R=12.5e-3) annotation (Placement(transformation(
              origin={-75,-17},
              extent={{-25,-25},{25,25}},
              rotation=270)));
        Modelica.Electrical.Analog.Basic.Conductor G(G=0.565) annotation (Placement(transformation(extent={{-25,38},{25,88}})));
        Modelica.Electrical.Analog.Basic.Capacitor C1(C=10, v(start=4, fixed=true)) annotation (Placement(transformation(
              origin={25,3},
              extent={{-25,-25},{25,25}},
              rotation=270)));
        Modelica.Electrical.Analog.Basic.Capacitor C2(C=100, v(start=0, fixed=true)) annotation (Placement(transformation(
              origin={-25,3},
              extent={{-25,-25},{25,25}},
              rotation=270)));
        Modelica.Electrical.Analog.Examples.Utilities.NonlinearResistor Nr(
          Ga(min=-1) = -0.757576,
          Gb(min=-1) = -0.409091,
          Ve=1) annotation (Placement(transformation(
              origin={75,3},
              extent={{-25,-25},{25,25}},
              rotation=270)));
        Modelica.Electrical.Analog.Basic.Ground Gnd annotation (Placement(transformation(extent={{-25,-112},{25,-62}})));
      equation
        connect(L.n, Ro.p) annotation (Line(points={{-75,13},{-75,8}}, color={0,0,255}));
        connect(C2.p, G.p) annotation (Line(points={{-25,28},{-25,45.5},{-25,45.5},{-25,63}}, color={0,0,255}));
        connect(L.p, G.p) annotation (Line(points={{-75,63},{-25,63}}, color={0,0,255}));
        connect(G.n, Nr.p) annotation (Line(points={{25,63},{75,63},{75,28}}, color={0,0,255}));
        connect(C1.p, G.n) annotation (Line(points={{25,28},{25,45.5},{25,45.5},{25,63}}, color={0,0,255}));
        connect(Ro.n, Gnd.p) annotation (Line(points={{-75,-42},{-75,-62},{0,-62}}, color={0,0,255}));
        connect(C2.n, Gnd.p) annotation (Line(points={{-25,-22},{-24,-22},{-24,-62},{0,-62}}, color={0,0,255}));
        connect(Gnd.p, C1.n) annotation (Line(points={{0,-62},{25,-62},{25,-22}}, color={0,0,255}));
        connect(Gnd.p, Nr.n) annotation (Line(points={{0,-62},{75,-62},{75,-22}}, color={0,0,255}));
        annotation (
          Documentation(info="<html>
<p>Chua&#39;s circuit is the most simple nonlinear circuit which shows chaotic behaviour. The circuit consists of linear basic elements (capacitors, resistor, conductor, inductor), and one nonlinear element, which is called Chua&#39;s diode. The chaotic behaviour is simulated.</p>
<p>The simulation end time should be set to 5e4. To get the chaotic behaviour please plot C1.v. Choose C2.v as the independent variable.</p>
<p><strong>Reference:</strong></p>
<p>Kennedy, M.P.: Three Steps to Chaos - Part I: Evolution. IEEE Transactions on CAS I 40 (1993)10, 640-656</p>
</html>"),
          experiment(StopTime=5e4, Interval=1),
          Diagram(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}})));
        // balance (flattened): 42 unknowns (L 6, Ro 8, G 8, C1 6, C2 6, Nr 6, Gnd 2), 42 equations
        // (29 component equations + 13 connection equations from 4 connection sets with 13 pins)
      end ChuaCircuit;

      model CharacteristicIdealDiodes "Characteristic of ideal diodes"
        extends Modelica.Icons.Example;
        Modelica.Electrical.Analog.Ideal.IdealDiode Ideal(
          Ron=0,
          Goff=0,
          Vknee=0) annotation (Placement(transformation(extent={{0,40},{20,60}})));
        Modelica.Electrical.Analog.Ideal.IdealDiode With_Ron_Goff(
          Ron=0.1,
          Goff=0.1,
          Vknee=0) annotation (Placement(transformation(extent={{0,0},{20,20}})));
        Modelica.Electrical.Analog.Ideal.IdealDiode With_Ron_Goff_Vknee(
          Ron=0.2,
          Goff=0.2,
          Vknee=5) annotation (Placement(transformation(extent={{0,-40},{20,-20}})));
        Modelica.Electrical.Analog.Sources.SineVoltage SineVoltage1(
          V=10,
          offset=-9,
          f=1) annotation (Placement(transformation(
              origin={-40,0},
              extent={{-10,-10},{10,10}},
              rotation=270)));
        Modelica.Electrical.Analog.Basic.Ground Ground1 annotation (Placement(transformation(extent={{-50,-80},{-30,-60}})));
        Modelica.Electrical.Analog.Basic.Resistor R1(R=1e-3) annotation (Placement(transformation(extent={{60,40},{80,60}})));
        Modelica.Electrical.Analog.Basic.Resistor R2(R=1e-3) annotation (Placement(transformation(extent={{60,0},{80,20}})));
        Modelica.Electrical.Analog.Basic.Resistor R3(R=1e-3) annotation (Placement(transformation(extent={{60,-40},{80,-20}})));
        Modelica.Electrical.Analog.Sources.SineVoltage SineVoltage2(
          V=10,
          offset=0,
          f=1) annotation (Placement(transformation(
              origin={-60,40},
              extent={{-10,-10},{10,10}},
              rotation=270)));
        Modelica.Electrical.Analog.Sources.SineVoltage SineVoltage3(
          V=10,
          offset=0,
          f=1) annotation (Placement(transformation(
              origin={-20,-40},
              extent={{-10,-10},{10,10}},
              rotation=270)));
      equation
        connect(Ground1.p, SineVoltage1.n) annotation (Line(points={{-40,-60},{-40,-10}}, color={0,0,255}));
        connect(Ideal.n, R1.p) annotation (Line(points={{20,50},{60,50}}, color={0,0,255}));
        connect(With_Ron_Goff.n, R2.p) annotation (Line(points={{20,10},{60,10}}, color={0,0,255}));
        connect(With_Ron_Goff_Vknee.n, R3.p) annotation (Line(points={{20,-30},{60,-30}}, color={0,0,255}));
        connect(R1.n, R2.n) annotation (Line(points={{80,50},{80,10}}, color={0,0,255}));
        connect(R2.n, R3.n) annotation (Line(points={{80,10},{80,-30}}, color={0,0,255}));
        connect(R3.n, Ground1.p) annotation (Line(points={{80,-30},{80,-60},{-40,-60}}, color={0,0,255}));
        connect(SineVoltage2.p, Ideal.p) annotation (Line(points={{-60,50},{0,50}}, color={0,0,255}));
        connect(SineVoltage2.n, Ground1.p) annotation (Line(points={{-60,30},{-60,-60},{-40,-60}}, color={0,0,255}));
        connect(SineVoltage1.p, With_Ron_Goff.p) annotation (Line(points={{-40,10},{0,10}}, color={0,0,255}));
        connect(With_Ron_Goff_Vknee.p, SineVoltage3.p) annotation (Line(points={{0,-30},{-20,-30}}, color={0,0,255}));
        connect(SineVoltage3.n, Ground1.p) annotation (Line(points={{-20,-50},{-20,-60},{-40,-60}}, color={0,0,255}));
        annotation (
          Diagram(coordinateSystem(preserveAspectRatio=false, extent={{-100,-100},{100,100}})),
          Documentation(info="<html>
<p>Three examples of ideal diodes are shown:
<br>the <strong>totally ideal diode</strong> (Ideal) with all parameters to be zero,
the <strong>nearly ideal diode</strong> with <em>Ron=0.1</em> and <em>Goff=0.1</em>
 and the nearly ideal but <strong>displaced diode</strong> with <em>Vknee=5</em> and <em>Ron=0.1</em> and <em>Goff=0.1</em>.
The resistance and conductance are chosen atypically high since the slopes should be seen in the graphics.
</p><p>Simulate until T=1 s.
Plot in separate windows:
Ideal.i versus Ideal.v, With_Ron_Goff.i versus With_Ron_Goff.v, With_Ron_Goff_Vknee.i versus With_Ron_Goff_Vknee.v
</p>
</html>"),
          experiment(StopTime=1));
        // balance (flattened): 68 unknowns (3 diodes x 8, 3 sine sources x 6, 3 resistors x 8, ground 2),
        // 68 equations (49 component equations + 19 connection equations from 7 connection sets with 19 pins)
      end CharacteristicIdealDiodes;

      model CauerLowPassAnalog "Cauer low pass filter with analog components"
        extends Modelica.Icons.Example;
        parameter Modelica.Units.SI.Inductance l1=1.304 "Filter coefficient I1";
        parameter Modelica.Units.SI.Inductance l2=0.8586 "Filter coefficient I2";
        parameter Modelica.Units.SI.Capacitance c1=1.072 "Filter coefficient c1";
        parameter Modelica.Units.SI.Capacitance c2=1/(1.704992^2*l1) "Filter coefficient c2";
        parameter Modelica.Units.SI.Capacitance c3=1.682 "Filter coefficient c3";
        parameter Modelica.Units.SI.Capacitance c4=1/(1.179945^2*l2) "Filter coefficient c4";
        parameter Modelica.Units.SI.Capacitance c5=0.7262 "Filter coefficient c5";
        Modelica.Electrical.Analog.Basic.Ground G annotation (Placement(transformation(extent={{-10,-90},{10,-70}})));
        Modelica.Electrical.Analog.Basic.Capacitor C1(C=c1, v(start=0, fixed=true)) annotation (Placement(transformation(
              origin={-60,-20},
              extent={{-10,-10},{10,10}},
              rotation=270)));
        Modelica.Electrical.Analog.Basic.Capacitor C2(C=c2) annotation (Placement(transformation(extent={{-40,20},{-20,40}})));
        Modelica.Electrical.Analog.Basic.Capacitor C3(C=c3, v(start=0, fixed=true)) annotation (Placement(transformation(
              origin={0,-20},
              extent={{-10,-10},{10,10}},
              rotation=270)));
        Modelica.Electrical.Analog.Basic.Capacitor C4(C=c4) annotation (Placement(transformation(extent={{20,20},{40,40}})));
        Modelica.Electrical.Analog.Basic.Capacitor C5(C=c5, v(start=0, fixed=true)) annotation (Placement(transformation(
              origin={60,-20},
              extent={{-10,-10},{10,10}},
              rotation=270)));
        Modelica.Electrical.Analog.Basic.Inductor L1(L=l1, i(start=0, fixed=true)) annotation (Placement(transformation(extent={{-40,60},{-20,80}})));
        Modelica.Electrical.Analog.Basic.Inductor L2(L=l2, i(start=0, fixed=true)) annotation (Placement(transformation(extent={{20,60},{40,80}})));
        Modelica.Electrical.Analog.Basic.Resistor R1(R=1) annotation (Placement(transformation(extent={{-100,20},{-80,40}})));
        Modelica.Electrical.Analog.Basic.Resistor R2(R=1) annotation (Placement(transformation(
              origin={100,-20},
              extent={{-10,-10},{10,10}},
              rotation=270)));
        Modelica.Electrical.Analog.Sources.StepVoltage V(
          startTime=1,
          offset=0,
          V=1) annotation (Placement(transformation(
              origin={-100,-10},
              extent={{-10,-10},{10,10}},
              rotation=270)));
      equation
        connect(R1.n, C1.p) annotation (Line(points={{-80,30},{-60,30},{-60,-10}}, color={0,0,255}));
        connect(C1.n, G.p) annotation (Line(points={{-60,-30},{-60,-50},{0,-50},{0,-70}}, color={0,0,255}));
        connect(L1.p, C2.p) annotation (Line(points={{-40,70},{-40,30}}, color={0,0,255}));
        connect(L1.p, C1.p) annotation (Line(points={{-40,70},{-40,30},{-60,30},{-60,-10}}, color={0,0,255}));
        connect(L1.n, C2.n) annotation (Line(points={{-20,70},{-20,30}}, color={0,0,255}));
        connect(C2.n, C3.p) annotation (Line(points={{-20,30},{0,30},{0,-10}}, color={0,0,255}));
        connect(C2.n, C4.p) annotation (Line(points={{-20,30},{20,30}}, color={0,0,255}));
        connect(C2.n, L2.p) annotation (Line(points={{-20,30},{20,30},{20,70}}, color={0,0,255}));
        connect(L2.n, C4.n) annotation (Line(points={{40,70},{40,30}}, color={0,0,255}));
        connect(C4.n, C5.p) annotation (Line(points={{40,30},{60,30},{60,-10}}, color={0,0,255}));
        connect(C4.n, R2.p) annotation (Line(points={{40,30},{100,30},{100,-10}}, color={0,0,255}));
        connect(C1.n, C3.n) annotation (Line(points={{-60,-30},{-60,-50},{0,-50},{0,-30}}, color={0,0,255}));
        connect(C1.n, C5.n) annotation (Line(points={{-60,-30},{-60,-50},{60,-50},{60,-30}}, color={0,0,255}));
        connect(R2.n, C1.n) annotation (Line(points={{100,-30},{100,-50},{-60,-50},{-60,-30}}, color={0,0,255}));
        connect(R1.p, V.p) annotation (Line(points={{-100,30},{-100,0}}, color={0,0,255}));
        connect(V.n, G.p) annotation (Line(points={{-100,-20},{-100,-70},{0,-70}}, color={0,0,255}));
        annotation (Diagram(coordinateSystem(preserveAspectRatio=false, extent={{-120,-100},{120,100}}), graphics={
              Rectangle(
                extent={{-62,32},{-58,28}},
                lineColor={0,0,255},
                fillColor={85,85,255},
                fillPattern=FillPattern.Solid),
              Rectangle(
                extent={{-2,28},{2,32}},
                lineColor={0,0,255},
                fillColor={85,85,255},
                fillPattern=FillPattern.Solid),
              Rectangle(
                extent={{58,32},{62,28}},
                lineColor={0,0,255},
                fillColor={85,85,255},
                fillPattern=FillPattern.Solid),
              Rectangle(
                extent={{58,-48},{62,-52}},
                lineColor={0,0,255},
                fillColor={85,85,255},
                fillPattern=FillPattern.Solid),
              Rectangle(
                extent={{-2,-48},{2,-52}},
                lineColor={0,0,255},
                fillColor={85,85,255},
                fillPattern=FillPattern.Solid),
              Rectangle(
                extent={{-62,-48},{-58,-52}},
                lineColor={0,0,255},
                fillColor={85,85,255},
                fillPattern=FillPattern.Solid)}),
          experiment(StopTime=60),
          Documentation(info="<html>
<p>The example Cauer Filter is a low-pass-filter of the fifth order. It is realized using an analog network. The voltage source V is the input voltage (step), and the R2.p.v is the filter output voltage. The pulse response is calculated.</p>
<p>The simulation end time should be 60. Please plot both V.p.v (input voltage) and R2.p.v (output voltage).</p>
</html>"));
        // balance (flattened): 66 unknowns (G 2, 5 capacitors x 6, 2 inductors x 6, 2 resistors x 8, V 6),
        // 66 equations (45 component equations + 21 connection equations from 5 connection sets with 21 pins)
      end CauerLowPassAnalog;

      package Utilities "Utility components used by package Examples"
        extends Modelica.Icons.UtilitiesPackage;

        model NonlinearResistor "Chua's resistor"
          extends Modelica.Electrical.Analog.Interfaces.OnePort;
          parameter Modelica.Units.SI.Conductance Ga "Conductance in inner voltage range";
          parameter Modelica.Units.SI.Conductance Gb "Conductance in outer voltage range";
          parameter Modelica.Units.SI.Voltage Ve "Inner voltage range limit";
        equation
          i = if (v < -Ve) then Gb*(v + Ve) - Ga*Ve else if (v > Ve) then Gb*(v - Ve) + Ga*Ve else Ga*v;
          annotation (
            Icon(coordinateSystem(
                preserveAspectRatio=true,
                extent={{-100,-100},{100,100}}), graphics={
                Rectangle(extent={{-70,30},{70,-30}}, lineColor={0,0,255},
                  fillColor={255,255,255},
                  fillPattern=FillPattern.Solid),
                Line(points={{-90,0},{-70,0}}, color={0,0,255}),
                Line(points={{70,0},{90,0}}, color={0,0,255}),
                Line(points={{-50,-60},{50,60}}, color={0,0,255}),
                Polygon(
                  points={{50,60},{38,52},{44,46},{50,60}},
                  fillColor={0,0,255},
                  fillPattern=FillPattern.Solid,
                  lineColor={0,0,255}),
                Text(
                  extent={{-170,110},{150,70}},
                  textColor={0,0,255},
                  textString="%name")}),
            Documentation(info="<html>
<p>This is the only nonlinear component for Chua&#39;s circuit. It is a piecewise linear resistor with both an inner and an outer range, which includes the inner one. The slopes of both ranges are given by parameters. The resistance characteristic is continuous. For Chua&#39;s circuit both slopes have to be chosen to be negative.</p>
</html>"));
          // balance: 6 unknowns (v, i, p.v, p.i, n.v, n.i), 2 flow variables provided by connections, 4 equations
        end NonlinearResistor;

        annotation (Documentation(info="<html>
<p>This package contains some utility components used by package examples. These components are auxiliary components that should not be used like true MLS components since they are designed the purpose of the examples only, not for common use.</p>
</html>"));
      end Utilities;

      annotation (Documentation(info="<html>
<p>This package contains examples that demonstrate the usage of the components of the Electrical.Analog library.</p>
<p>The examples are simple to understand. They will show a typical behavior of the components, and they will give hints to users.</p>
</html>"));
    end Examples;

    package Basic "Basic electrical components"
      extends Modelica.Icons.Package;

      model Ground "Ground node"
        Modelica.Electrical.Analog.Interfaces.Pin p annotation (Placement(transformation(
              origin={0,100},
              extent={{10,-10},{-10,10}},
              rotation=270)));
      equation
        p.v = 0;
        annotation (
          Documentation(info="<html>
<p>Ground of an electrical circuit. The potential at the ground node is zero. Every electrical circuit has to contain at least one ground object.</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Line(points={{-60,50},{60,50}}, color={0,0,255}),
              Line(points={{-40,30},{40,30}}, color={0,0,255}),
              Line(points={{-20,10},{20,10}}, color={0,0,255}),
              Line(points={{0,90},{0,50}}, color={0,0,255}),
              Text(
                extent={{-150,-10},{150,-50}},
                textString="%name",
                textColor={0,0,255})}));
        // balance: 2 unknowns (p.v, p.i), 1 flow variable provided by connection, 1 equation
      end Ground;

      model Resistor "Ideal linear electrical resistor"
        parameter Modelica.Units.SI.Resistance R(start=1) "Resistance at temperature T_ref";
        parameter Modelica.Units.SI.Temperature T_ref=300.15 "Reference temperature";
        parameter Modelica.Units.SI.LinearTemperatureCoefficient alpha=0
          "Temperature coefficient of resistance (R_actual = R*(1 + alpha*(T_heatPort - T_ref)))";
        parameter Modelica.Units.SI.Temperature T=T_ref "Fixed device temperature";
        extends Modelica.Electrical.Analog.Interfaces.OnePort;
        Modelica.Units.SI.Resistance R_actual "Actual resistance = R*(1 + alpha*(T_heatPort - T_ref))";
        Modelica.Units.SI.Power LossPower "Loss power dissipated in the resistor";
        Modelica.Units.SI.Temperature T_heatPort "Device temperature (= T, no heat port on this platform)";
      equation
        T_heatPort = T;
        R_actual = R*(1 + alpha*(T_heatPort - T_ref));
        v = R_actual*i;
        LossPower = v*i;
        annotation (
          Documentation(info="<html>
<p>The linear resistor connects the branch voltage <em>v</em> with the branch current <em>i</em> by <em>i*R = v</em>. The Resistance <em>R</em> is allowed to be positive, zero, or negative.</p>
<p>The optional heat port of the Modelica Standard Library resistor is not available on this platform; the device temperature is given by the parameter T (default: T_ref).</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Rectangle(
                extent={{-70,30},{70,-30}},
                lineColor={0,0,255},
                fillColor={255,255,255},
                fillPattern=FillPattern.Solid),
              Line(points={{-90,0},{-70,0}}, color={0,0,255}),
              Line(points={{70,0},{90,0}}, color={0,0,255}),
              Text(
                extent={{-150,-40},{150,-80}},
                textString="R=%R"),
              Text(
                extent={{-150,90},{150,50}},
                textString="%name",
                textColor={0,0,255})}));
        // balance: 9 unknowns (v, i, p.v, p.i, n.v, n.i, R_actual, LossPower, T_heatPort),
        // 2 flow variables provided by connections, 7 equations (3 OnePort + 4)
      end Resistor;

      model Conductor "Ideal linear electrical conductor"
        parameter Modelica.Units.SI.Conductance G(start=1) "Conductance at temperature T_ref";
        parameter Modelica.Units.SI.Temperature T_ref=300.15 "Reference temperature";
        parameter Modelica.Units.SI.LinearTemperatureCoefficient alpha=0
          "Temperature coefficient of conductance (G_actual = G_ref/(1 + alpha*(T_heatPort - T_ref))";
        parameter Modelica.Units.SI.Temperature T=T_ref "Fixed device temperature";
        extends Modelica.Electrical.Analog.Interfaces.OnePort;
        Modelica.Units.SI.Conductance G_actual "Actual conductance = G_ref/(1 + alpha*(T_heatPort - T_ref))";
        Modelica.Units.SI.Power LossPower "Loss power dissipated in the conductor";
        Modelica.Units.SI.Temperature T_heatPort "Device temperature (= T, no heat port on this platform)";
      equation
        T_heatPort = T;
        G_actual = G/(1 + alpha*(T_heatPort - T_ref));
        i = G_actual*v;
        LossPower = v*i;
        annotation (
          Documentation(info="<html>
<p>The linear conductor connects the branch voltage <em>v</em> with the branch current <em>i</em> by <em>i = v*G</em>. The Conductance <em>G</em> is allowed to be positive, zero, or negative.</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Rectangle(
                extent={{-70,30},{70,-30}},
                fillColor={255,255,255},
                fillPattern=FillPattern.Solid,
                lineColor={0,0,255}),
              Rectangle(extent={{-70,30},{70,-30}}, lineColor={0,0,255}),
              Line(points={{-90,0},{-70,0}}, color={0,0,255}),
              Line(points={{70,0},{90,0}}, color={0,0,255}),
              Text(
                extent={{-150,-40},{150,-80}},
                textString="G=%G"),
              Text(
                extent={{-150,90},{150,50}},
                textString="%name",
                textColor={0,0,255})}));
        // balance: 9 unknowns (v, i, p.v, p.i, n.v, n.i, G_actual, LossPower, T_heatPort),
        // 2 flow variables provided by connections, 7 equations (3 OnePort + 4)
      end Conductor;

      model Capacitor "Ideal linear electrical capacitor"
        extends Modelica.Electrical.Analog.Interfaces.OnePort(v(start=0));
        parameter Modelica.Units.SI.Capacitance C(start=1) "Capacitance";
      equation
        i = C*der(v);
        annotation (
          Documentation(info="<html>
<p>The linear capacitor connects the branch voltage <em>v</em> with the branch current <em>i</em> by <em>i = C * dv/dt</em>. The Capacitance <em>C</em> is allowed to be positive or zero.</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Line(points={{-6,28},{-6,-28}}, color={0,0,255}),
              Line(points={{6,28},{6,-28}}, color={0,0,255}),
              Line(points={{-90,0},{-6,0}}, color={0,0,255}),
              Line(points={{6,0},{90,0}}, color={0,0,255}),
              Text(
                extent={{-150,-40},{150,-80}},
                textString="C=%C"),
              Text(
                extent={{-150,90},{150,50}},
                textString="%name",
                textColor={0,0,255})}));
        // balance: 6 unknowns (v, i, p.v, p.i, n.v, n.i), 2 flow variables provided by connections, 4 equations
      end Capacitor;

      model Inductor "Ideal linear electrical inductor"
        extends Modelica.Electrical.Analog.Interfaces.OnePort(i(start=0));
        parameter Modelica.Units.SI.Inductance L(start=1) "Inductance";
      equation
        L*der(i) = v;
        annotation (
          Documentation(info="<html>
<p>The linear inductor connects the branch voltage <em>v</em> with the branch current <em>i</em> by <em>v = L * di/dt</em>. The Inductance <em>L</em> is allowed to be positive, or zero.</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Line(points={{60,0},{90,0}}, color={0,0,255}),
              Line(points={{-90,0},{-60,0}}, color={0,0,255}),
              Text(
                extent={{-150,-40},{150,-80}},
                textString="L=%L"),
              Line(
                points={{-60,0},{-59,6},{-52,14},{-38,14},{-31,6},{-30,0}},
                color={0,0,255},
                smooth=Smooth.Bezier),
              Line(
                points={{-30,0},{-29,6},{-22,14},{-8,14},{-1,6},{0,0}},
                color={0,0,255},
                smooth=Smooth.Bezier),
              Line(
                points={{0,0},{1,6},{8,14},{22,14},{29,6},{30,0}},
                color={0,0,255},
                smooth=Smooth.Bezier),
              Line(
                points={{30,0},{31,6},{38,14},{52,14},{59,6},{60,0}},
                color={0,0,255},
                smooth=Smooth.Bezier),
              Text(
                extent={{-150,90},{150,50}},
                textString="%name",
                textColor={0,0,255})}));
        // balance: 6 unknowns (v, i, p.v, p.i, n.v, n.i), 2 flow variables provided by connections, 4 equations
      end Inductor;

      model Transformer "Transformer with two ports"
        extends Modelica.Electrical.Analog.Interfaces.TwoPort(i1(start=0), i2(start=0));
        parameter Modelica.Units.SI.Inductance L1(start=1) "Primary inductance";
        parameter Modelica.Units.SI.Inductance L2(start=1) "Secondary inductance";
        parameter Modelica.Units.SI.Inductance M(start=1) "Coupling inductance";
        Real dv "Difference between voltage drop over primary inductor and voltage drop over secondary inductor";
      equation
        v1 = L1*der(i1) + M*der(i2);
        /* Original equation:
              v2 = M*der(i1) + L2*der(i2);
           If L1 = L2 = M, then this model has one state less. However,
           it might be difficult for a tool to detect this. For this reason
           the model is defined with a relative potential:
        */
        dv = (L1 - M)*der(i1) + (M - L2)*der(i2);
        v2 = v1 - dv;
        annotation (
          Documentation(info="<html>
<p>The transformer is a two port. The left port voltage <em>v1</em>, left port current <em>i1</em>, right port voltage <em>v2</em> and right port current <em>i2</em> are connected by the following relation:</p>
<blockquote><pre>
| v1 |         | L1   M  |  | i1&#39; |
|    |    =    |         |  |     |
| v2 |         | M    L2 |  | i2&#39; |
</pre></blockquote>
<p><em>L1</em>, <em>L2</em>, and <em>M</em> are the primary, secondary, and coupling inductances respectively.</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Text(
                extent={{-150,150},{150,110}},
                textString="%name",
                textColor={0,0,255}),
              Text(
                extent={{-20,-60},{20,-100}},
                textString="M",
                textColor={0,0,255}),
              Line(points={{-40,60},{-40,100},{-90,100}}, color={0,0,255}),
              Line(points={{40,60},{40,100},{90,100}}, color={0,0,255}),
              Line(points={{-40,-60},{-40,-100},{-90,-100}}, color={0,0,255}),
              Line(points={{40,-60},{40,-100},{90,-100}}, color={0,0,255}),
              Line(
                points={{-15,-7},{-14,-1},{-7,7},{7,7},{14,-1},{15,-7}},
                color={0,0,255},
                smooth=Smooth.Bezier,
                origin={-33,45},
                rotation=270),
              Line(
                points={{-15,-7},{-14,-1},{-7,7},{7,7},{14,-1},{15,-7}},
                color={0,0,255},
                smooth=Smooth.Bezier,
                origin={-33,15},
                rotation=270),
              Line(
                points={{-15,-7},{-14,-1},{-7,7},{7,7},{14,-1},{15,-7}},
                color={0,0,255},
                smooth=Smooth.Bezier,
                origin={-33,-15},
                rotation=270),
              Line(
                points={{-15,-7},{-14,-1},{-7,7},{7,7},{14,-1},{15,-7}},
                color={0,0,255},
                smooth=Smooth.Bezier,
                origin={-33,-45},
                rotation=270),
              Line(
                points={{-15,-7},{-14,-1},{-7,7},{7,7},{14,-1},{15,-7}},
                color={0,0,255},
                smooth=Smooth.Bezier,
                origin={33,45},
                rotation=90),
              Line(
                points={{-15,-7},{-14,-1},{-7,7},{7,7},{14,-1},{15,-7}},
                color={0,0,255},
                smooth=Smooth.Bezier,
                origin={33,15},
                rotation=90),
              Line(
                points={{-15,-7},{-14,-1},{-7,7},{7,7},{14,-1},{15,-7}},
                color={0,0,255},
                smooth=Smooth.Bezier,
                origin={33,-15},
                rotation=90),
              Line(
                points={{-15,-7},{-14,-1},{-7,7},{7,7},{14,-1},{15,-7}},
                color={0,0,255},
                smooth=Smooth.Bezier,
                origin={33,-45},
                rotation=90),
              Text(
                extent={{-100,20},{-58,-20}},
                textString="L1",
                textColor={0,0,255}),
              Text(
                extent={{60,20},{100,-20}},
                textString="L2",
                textColor={0,0,255})}));
        // balance: 13 unknowns (8 pin variables, v1, v2, i1, i2, dv), 4 flow variables provided by connections,
        // 9 equations (4 FourPin + 2 TwoPort + 3)
      end Transformer;

      model RotationalEMF "Electromotoric force (electric/mechanic transformer)"
        parameter Modelica.Units.SI.ElectricalTorqueConstant k(start=1) "Transformation coefficient";
        Modelica.Units.SI.Voltage v "Voltage drop between the two pins";
        Modelica.Units.SI.Current i "Current flowing from positive to negative pin";
        Modelica.Units.SI.Angle phi "Angle of shaft flange with respect to support (= flange.phi - support.phi)";
        Modelica.Units.SI.AngularVelocity w "Angular velocity of flange relative to support";
        Modelica.Units.SI.Torque tau "Torque of flange";
        Modelica.Units.SI.Torque tauElectrical "Electrical torque";
        Modelica.Electrical.Analog.Interfaces.PositivePin p "Positive electrical pin" annotation (Placement(transformation(
              origin={0,100},
              extent={{-10,-10},{10,10}},
              rotation=90)));
        Modelica.Electrical.Analog.Interfaces.NegativePin n "Negative electrical pin" annotation (Placement(transformation(
              origin={0,-100},
              extent={{-10,-10},{10,10}},
              rotation=90)));
        Modelica.Mechanics.Rotational.Interfaces.Flange_b flange "Flange" annotation (
            Placement(transformation(extent={{90,-10},{110,10}})));
      protected
        Modelica.Units.SI.Angle phi_support "Absolute angle of the (internally fixed) support";
      equation
        v = p.v - n.v;
        0 = p.i + n.i;
        i = p.i;
        phi_support = 0;
        phi = flange.phi - phi_support;
        w = der(phi);
        k*w = v;
        tau = -k*i;
        tauElectrical = -tau;
        tau = flange.tau;
        annotation (
          defaultComponentName="emf",
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Rectangle(
                extent={{-85,10},{-36,-10}},
                fillPattern=FillPattern.HorizontalCylinder,
                fillColor={192,192,192}),
              Rectangle(
                extent={{35,10},{100,-10}},
                fillPattern=FillPattern.HorizontalCylinder,
                fillColor={192,192,192}),
              Ellipse(
                extent={{-40,40},{40,-40}},
                fillColor={255,255,255},
                fillPattern=FillPattern.Solid,
                lineColor={0,0,255}),
              Text(
                extent={{-150,90},{150,50}},
                textString="%name",
                textColor={0,0,255}),
              Text(
                extent={{-150,-50},{150,-90}},
                textString="k=%k"),
              Line(points={{-100,-30},{-40,-30}}),
              Line(points={{-100,-50},{-80,-30}}),
              Line(points={{-80,-50},{-60,-30}}),
              Line(points={{-60,-50},{-40,-30}}),
              Line(points={{-70,-30},{-70,-10}}),
              Line(points={{0,40},{0,50}}, color={0,0,255}),
              Line(points={{0,-50},{0,-40}}, color={0,0,255})}),
          Documentation(info="<html>
<p>EMF transforms electrical energy into rotational mechanical energy. It is used as basic building block of an electrical motor. The mechanical connector flange can be connected to elements of the Modelica.Mechanics.Rotational library. flange.tau is the cut-torque, flange.phi is the angle at the rotational connection.</p>
<p>The shaft is internally fixed to the housing (the optional support connector of the Modelica Standard Library is not available on this platform).</p>
</html>"));
        // balance: 13 unknowns (p.v, p.i, n.v, n.i, flange.phi, flange.tau, v, i, phi, w, tau, tauElectrical, phi_support),
        // 3 flow variables provided by connections, 10 equations
      end RotationalEMF;

      model EMF "Electromotoric force (MSL 3 name of RotationalEMF)"
        extends Modelica.Electrical.Analog.Basic.RotationalEMF;
        annotation (defaultComponentName="emf", Documentation(info="<html>
<p>Compatibility alias for <a href=\"modelica://Modelica.Electrical.Analog.Basic.RotationalEMF\">RotationalEMF</a>
(the component was called EMF up to MSL 3.2.3).</p>
</html>"));
        // balance: identical to RotationalEMF (13 unknowns, 3 flows provided by connections, 10 equations)
      end EMF;

      annotation (Documentation(info="<html>
<p>This package contains very basic analog electrical components such as resistor, conductor, capacitor, inductor, and the ground (which is needed in each electrical circuit description. Furthermore, the transformer and the electromotoric force are in this package.</p>
</html>"), Icon(graphics={
            Line(points={{-12,60},{-12,-60}}),
            Line(points={{-80,0},{-12,0}}),
            Line(points={{12,60},{12,-60}}),
            Line(points={{12,0},{80,0}})}));
    end Basic;

    package Ideal "Ideal electrical elements such as switches and diode"
      extends Modelica.Icons.Package;

      model IdealDiode "Ideal diode"
        extends Modelica.Electrical.Analog.Interfaces.IdealSemiconductor;
      equation
        off = s < 0;
        annotation (defaultComponentName="diode",
          Documentation(info="<html>
<p>
This is an ideal diode, for details see partial model <a href=\"modelica://Modelica.Electrical.Analog.Interfaces.IdealSemiconductor\">IdealSemiconductor</a><br>
The diode is conducting if voltage &gt; Vknee.<br>
The diode is locking if current &lt; Vknee*Goff.
</p>
</html>"));
        // balance: 9 unknowns (v, i, p.v, p.i, n.v, n.i, off, s, LossPower), 2 flow variables provided by connections,
        // 7 equations (3 OnePort + 3 IdealSemiconductor + 1)
      end IdealDiode;

      model IdealOpeningSwitch "Ideal electrical opener"
        extends Modelica.Electrical.Analog.Interfaces.IdealSwitch;
        Modelica.Blocks.Interfaces.BooleanInput control "true => switch open, false => p--n connected"
          annotation (Placement(transformation(
              origin={0,120},
              extent={{-20,-20},{20,20}},
              rotation=270), iconTransformation(
              extent={{-20,-20},{20,20}},
              rotation=270,
              origin={0,120})));
      equation
        off = control;
        annotation (defaultComponentName="switch",
          Documentation(info="<html>
<p>
The switching behaviour of the ideal opening switch is controlled by the input signal control: off = control.<br>
For further details, see partial model <a href=\"modelica://Modelica.Electrical.Analog.Interfaces.IdealSwitch\">IdealSwitch</a>.
</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Line(points={{40,20},{40,0}}, color={0,0,255})}));
        // balance: 10 unknowns (v, i, p.v, p.i, n.v, n.i, off, s, LossPower, control), 2 flow variables and
        // 1 input provided by connections, 7 equations (3 OnePort + 3 IdealSwitch + 1)
      end IdealOpeningSwitch;

      model IdealClosingSwitch "Ideal electrical closer"
        extends Modelica.Electrical.Analog.Interfaces.IdealSwitch;
        Modelica.Blocks.Interfaces.BooleanInput control "true => p--n connected, false => switch open"
          annotation (Placement(transformation(
              origin={0,120},
              extent={{-20,-20},{20,20}},
              rotation=270)));
      equation
        off = not control;
        annotation (defaultComponentName="switch",
          Documentation(info="<html>
<p>
The switching behaviour of the ideal closing switch is controlled by the input signal control: off = not control.<br>
For further details, see partial model <a href=\"modelica://Modelica.Electrical.Analog.Interfaces.IdealSwitch\">IdealSwitch</a>.
</p>
</html>"));
        // balance: 10 unknowns (v, i, p.v, p.i, n.v, n.i, off, s, LossPower, control), 2 flow variables and
        // 1 input provided by connections, 7 equations (3 OnePort + 3 IdealSwitch + 1)
      end IdealClosingSwitch;

      annotation (Documentation(info="<html>
<p>This package contains electrical components with idealized behaviour. To enable more realistic applications than it is possible with pure realistic behavior some components are improved by additional features. E.g. the switches have resistances for the open or close case which can be parametrized.</p>
</html>"), Icon(graphics={
            Line(points={{-90,0},{-40,0}}),
            Line(points={{-40,0},{32,60}}),
            Line(points={{40,0},{90,0}})}));
    end Ideal;

    package Sensors "Potential, voltage, current, and power sensors"
      extends Modelica.Icons.SensorsPackage;

      model VoltageSensor "Sensor to measure the voltage between two pins"
        extends Modelica.Icons.RoundSensor;
        Modelica.Electrical.Analog.Interfaces.PositivePin p "Positive pin"
          annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
        Modelica.Electrical.Analog.Interfaces.NegativePin n "Negative pin"
          annotation (Placement(transformation(extent={{90,-10},{110,10}})));
        Modelica.Blocks.Interfaces.RealOutput v(unit="V") "Voltage between pin p and n (= p.v - n.v) as output signal"
          annotation (Placement(transformation(
              origin={0,-110},
              extent={{10,-10},{-10,10}},
              rotation=90)));
      equation
        p.i = 0;
        n.i = 0;
        v = p.v - n.v;
        annotation (
          Icon(coordinateSystem(
              preserveAspectRatio=true,
              extent={{-100,-100},{100,100}}), graphics={
              Line(points={{-70,0},{-90,0}}, color={0,0,255}),
              Line(points={{70,0},{90,0}}, color={0,0,255}),
              Line(points={{0,-100},{0,-70}}, color={0,0,127}),
              Text(
                extent={{-150,80},{150,120}},
                textString="%name",
                textColor={0,0,255}),
              Text(
                extent={{-30,-10},{30,-70}},
                textString="V",
                textColor={64,64,64})}),
          Documentation(info="<html>
<p>The voltage sensor converts the voltage between the two connectors into a real valued signal. It does not influence the current sum at the nodes in between the voltage is measured, therefore, the electrical behavior is not influenced by the sensor.</p>
</html>"));
        // balance: 5 unknowns (p.v, p.i, n.v, n.i, v), 2 flow variables provided by connections, 3 equations
      end VoltageSensor;

      model CurrentSensor "Sensor to measure the current in a branch"
        extends Modelica.Icons.RoundSensor;
        Modelica.Electrical.Analog.Interfaces.PositivePin p "Positive pin"
          annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
        Modelica.Electrical.Analog.Interfaces.NegativePin n "Negative pin"
          annotation (Placement(transformation(extent={{90,-10},{110,10}})));
        Modelica.Blocks.Interfaces.RealOutput i(unit="A") "Current in the branch from p to n as output signal"
          annotation (Placement(transformation(
              origin={0,-110},
              extent={{10,-10},{-10,10}},
              rotation=90)));
      equation
        p.v = n.v;
        p.i = i;
        n.i = -i;
        annotation (
          Icon(coordinateSystem(
              preserveAspectRatio=true,
              extent={{-100,-100},{100,100}}), graphics={
              Text(
                extent={{-150,80},{150,120}},
                textString="%name",
                textColor={0,0,255}),
              Line(points={{0,-100},{0,-70}}, color={0,0,127}),
              Text(
                extent={{-30,-10},{30,-70}},
                textColor={64,64,64},
                textString="A"),
              Line(points={{100,0},{-100,0}}, color={0,0,255})}),
          Documentation(info="<html>
<p>The current sensor converts the current flowing between the two connectors into a real valued signal. The two connectors are in the sensor connected like a short cut. The sensor has to be placed within an electrical connection in series.  It does not influence the current sum at the connected nodes. Therefore, the electrical behavior is not influenced by the sensor.</p>
</html>"));
        // balance: 5 unknowns (p.v, p.i, n.v, n.i, i), 2 flow variables provided by connections, 3 equations
      end CurrentSensor;

      model PowerSensor "Sensor to measure the power"
        extends Modelica.Icons.RoundSensor;
        Modelica.Electrical.Analog.Interfaces.PositivePin pc "Positive pin, current path"
          annotation (Placement(transformation(extent={{-90,-10},{-110,10}})));
        Modelica.Electrical.Analog.Interfaces.NegativePin nc "Negative pin, current path"
          annotation (Placement(transformation(extent={{110,-10},{90,10}})));
        Modelica.Electrical.Analog.Interfaces.PositivePin pv "Positive pin, voltage path"
          annotation (Placement(transformation(extent={{-10,110},{10,90}})));
        Modelica.Electrical.Analog.Interfaces.NegativePin nv "Negative pin, voltage path"
          annotation (Placement(transformation(extent={{10,-110},{-10,-90}})));
        Modelica.Blocks.Interfaces.RealOutput power(unit="W") "Instantaneous power as output signal"
          annotation (Placement(transformation(
              origin={-100,-110},
              extent={{-10,10},{10,-10}},
              rotation=270), iconTransformation(
              extent={{-10,10},{10,-10}},
              rotation=270,
              origin={-100,-110})));
        Modelica.Electrical.Analog.Sensors.VoltageSensor voltageSensor
          annotation (Placement(transformation(
              origin={0,-30},
              extent={{10,10},{-10,-10}},
              rotation=90)));
        Modelica.Electrical.Analog.Sensors.CurrentSensor currentSensor
          annotation (Placement(transformation(extent={{-50,-10},{-30,10}})));
        Modelica.Blocks.Math.Product product
          annotation (Placement(transformation(
              origin={-30,-50},
              extent={{-10,-10},{10,10}},
              rotation=270)));
      equation
        connect(pv, voltageSensor.p) annotation (Line(points={{0,100},{0,-20}}, color={0,0,255}));
        connect(voltageSensor.n, nv) annotation (Line(points={{0,-40},{0,-63},{0,-100}}, color={0,0,255}));
        connect(pc, currentSensor.p) annotation (Line(points={{-100,0},{-50,0}}, color={0,0,255}));
        connect(currentSensor.n, nc) annotation (Line(points={{-30,0},{100,0}}, color={0,0,255}));
        connect(currentSensor.i, product.u2) annotation (Line(points={{-40,-11},{-40,-30},{-36,-30},{-36,-38}}, color={0,0,127}));
        connect(voltageSensor.v, product.u1) annotation (Line(points={{-11,-30},{-24,-30},{-24,-38}}, color={0,0,127}));
        connect(product.y, power) annotation (Line(points={{-30,-61},{-30,-80},{-100,-80},{-100,-110}}, color={0,0,127}));
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
            Line(points={{0,100},{0,70}}, color={0,0,255}),
            Line(points={{0,-70},{0,-100}}, color={0,0,255}),
            Line(points={{-100,-100},{-100,-80},{-58,-38}}, color={0,0,127}),
            Line(points={{-100,0},{100,0}}, color={0,0,255}),
            Text(textColor={0,0,255}, extent={{-150,110},{150,150}}, textString="%name"),
            Line(points={{0,70},{0,40}}),
              Text(
                  extent={{-30,-10},{30,-70}},
                  textColor={64,64,64},
                  textString="W")}),
          Documentation(info="<html>
<p>This power sensor measures instantaneous electrical power of a single-phase system and has a separated voltage and current path. The pins of the voltage path are pv and nv, the pins of the current path are pc and nc. The internal resistance of the current path is zero, the internal resistance of the voltage path is infinite.</p>
</html>"));
        // balance (flattened): 22 unknowns (8 outside pin variables, power, voltageSensor 5, currentSensor 5, product 3),
        // 4 outside flow variables provided by connections, 18 equations (3 + 3 + 1 component equations,
        // 4 pin connections x 2 equations = 8, 3 signal connections)
      end PowerSensor;

      model PotentialSensor "Sensor to measure the potential"
        extends Modelica.Icons.RoundSensor;
        Modelica.Electrical.Analog.Interfaces.PositivePin p "Pin to be measured"
          annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
        Modelica.Blocks.Interfaces.RealOutput phi(unit="V") "Absolute voltage potential as output signal"
          annotation (Placement(transformation(extent={{100,-10},{120,10}})));
      equation
        p.i = 0;
        phi = p.v;
        annotation (
          Icon(coordinateSystem(
              preserveAspectRatio=true,
              extent={{-100,-100},{100,100}}), graphics={
              Line(points={{-70,0},{-90,0}}, color={0,0,255}),
              Line(points={{100,0},{70,0}}, color={0,0,127}),
              Text(
                extent={{-150,80},{150,120}},
                textString="%name",
                textColor={0,0,255}),
              Text(
                extent={{-30,-10},{30,-70}},
                textString="V",
                textColor={64,64,64})}),
          Documentation(info="<html>
<p>The potential sensor converts the voltage of a node (with respect to the ground node) into a real valued signal. It does not influence the current sum at the node which voltage is measured, therefore, the electrical behavior is not influenced by the sensor.</p>
</html>"));
        // balance: 3 unknowns (p.v, p.i, phi), 1 flow variable provided by connection, 2 equations
      end PotentialSensor;

      annotation (Documentation(info="<html>
<p>This package contains potential, voltage, and current sensors. The sensors can be used to convert voltages or currents into real signal values o be connected to components of the Blocks package. The sensors are designed in such a way that they do not influence the electrical behavior.</p>
</html>"));
    end Sensors;

    package Sources "Time-dependent and controlled voltage and current sources"
      extends Modelica.Icons.SourcesPackage;

      model ConstantVoltage "Source for constant voltage"
        parameter Modelica.Units.SI.Voltage V(start=1) "Value of constant voltage";
        extends Modelica.Electrical.Analog.Interfaces.OnePort;
        extends Modelica.Electrical.Analog.Icons.VoltageSource;
      equation
        v = V;
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Text(
                extent={{-150,-110},{150,-70}},
                textString="V=%V")}),
          Documentation(info="<html>
<p>The ConstantVoltage source is a simple source for an ideal constant voltage which is provided by a parameter. There is no internal resistance modeled. If it is used instead of a battery model it is not very realistic: This battery will never be unloaded.</p>
</html>"));
        // balance: 6 unknowns (v, i, p.v, p.i, n.v, n.i), 2 flow variables provided by connections, 4 equations
      end ConstantVoltage;

      model SineVoltage "Sine voltage source"
        parameter Modelica.Units.SI.Voltage V(start=1) "Amplitude of sine wave";
        parameter Modelica.Units.SI.Angle phase=0 "Phase of sine wave";
        parameter Modelica.Units.SI.Frequency f(start=1) "Frequency of sine wave";
        extends Modelica.Electrical.Analog.Interfaces.VoltageSource;
      equation
        v = offset + (if time < startTime then 0 else V*sin(2*Modelica.Constants.pi*f*(time - startTime) + phase));
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=false, extent={{-100,-100},{100,100}}), graphics={Line(points={{-66,0},{-56.2,29.9},{-49.8,46.5},{-44.2,58.1},{-39.3,65.2},{-34.3,69.2},{-29.4,69.8},{-24.5,67},{-19.6,61},{-14.6,52},{-9,38.6},{-1.98,18.6},{12.79,-26.9},{19.1,-44},{24.8,-56.2},{29.7,-64},{34.6,-68.6},{39.5,-70},{44.5,-67.9},{49.4,-62.5},{54.3,-54.1},{59.9,-41.3},{67,-21.7},{74,0}},
                  color={192,192,192})}),
          Documentation(info="<html>
<p>This voltage source generates the sine wave v = offset + V*sin(2*pi*f*(time - startTime) + phase) for time &gt;= startTime and v = offset before. In the Modelica Standard Library the signal is produced by the corresponding block of Modelica.Blocks.Sources; here the equation is written directly in the source.</p>
</html>"));
        // balance: 6 unknowns (v, i, p.v, p.i, n.v, n.i), 2 flow variables provided by connections, 4 equations
      end SineVoltage;

      model StepVoltage "Step voltage source"
        parameter Modelica.Units.SI.Voltage V(start=1) "Height of step";
        extends Modelica.Electrical.Analog.Interfaces.VoltageSource;
      equation
        v = offset + (if time < startTime then 0 else V);
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Line(points={{-70,-70},{0,-70},{0,70},{69,70}},
                  color={192,192,192})}),
          Documentation(info="<html>
<p>This voltage source generates a step: v = offset for time &lt; startTime and v = offset + V afterwards. In the Modelica Standard Library the signal is produced by the corresponding block of Modelica.Blocks.Sources; here the equation is written directly in the source.</p>
</html>"));
        // balance: 6 unknowns (v, i, p.v, p.i, n.v, n.i), 2 flow variables provided by connections, 4 equations
      end StepVoltage;

      model RampVoltage "Ramp voltage source"
        parameter Modelica.Units.SI.Voltage V(start=1) "Height of ramp";
        parameter Modelica.Units.SI.Time duration(min=Modelica.Constants.small, start=2) "Duration of ramp";
        extends Modelica.Electrical.Analog.Interfaces.VoltageSource;
      equation
        v = offset + (if time < startTime then 0 else if time < (startTime + duration) then (time - startTime)*V/duration else V);
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Line(points={{-80,-60},{-50,-60},{50,60},{80,60}},
                  color={192,192,192})}),
          Documentation(info="<html>
<p>This voltage source generates a ramp rising from offset to offset + V within the time duration after startTime. In the Modelica Standard Library the signal is produced by the corresponding block of Modelica.Blocks.Sources; here the equation is written directly in the source.</p>
</html>"));
        // balance: 6 unknowns (v, i, p.v, p.i, n.v, n.i), 2 flow variables provided by connections, 4 equations
      end RampVoltage;

      model PulseVoltage "Pulse voltage source"
        parameter Modelica.Units.SI.Voltage V(start=1) "Amplitude of pulse";
        parameter Real width(final min=Modelica.Constants.small, final max=100, start=50) "Width of pulse in % of period";
        parameter Modelica.Units.SI.Time period(final min=Modelica.Constants.small, start=1) "Time for one period";
        extends Modelica.Electrical.Analog.Interfaces.VoltageSource;
      protected
        parameter Modelica.Units.SI.Time T_width=period*width/100 "Width of one pulse";
      equation
        v = offset + (if time < startTime then 0 else if mod(time - startTime, period) < T_width then V else 0);
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Line(points={{-70,-70},{-40,-70},{-40,70},{0,70},{0,-70},{40,-70},{40,70},{80,70}}, color={192,192,192})}),
          Documentation(info="<html>
<p>This voltage source generates a pulse train with amplitude V, period and width (in % of the period). In the Modelica Standard Library the signal is produced by the corresponding block of Modelica.Blocks.Sources; here the equation is written directly in the source using the mod() function.</p>
</html>"));
        // balance: 6 unknowns (v, i, p.v, p.i, n.v, n.i), 2 flow variables provided by connections, 4 equations
      end PulseVoltage;

      model SignalVoltage "Generic voltage source using the input signal as source voltage"
        extends Modelica.Electrical.Analog.Icons.VoltageSource;
        Modelica.Electrical.Analog.Interfaces.PositivePin p annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
        Modelica.Electrical.Analog.Interfaces.NegativePin n annotation (Placement(transformation(extent={{110,-10},{90,10}})));
        Modelica.Blocks.Interfaces.RealInput v(unit="V") "Voltage between pin p and n (= p.v - n.v) as input signal"
          annotation (Placement(transformation(
              origin={0,120},
              extent={{-20,-20},{20,20}},
              rotation=270)));
        Modelica.Units.SI.Current i "Current flowing from pin p to pin n";
      equation
        v = p.v - n.v;
        0 = p.i + n.i;
        i = p.i;
        annotation (
          Documentation(info="<html>
<p>The signal voltage source is a parameterless converter of real valued signals into a the source voltage. No further effects are modeled. The real valued signal has to be provided by components of the blocks library. It can be regarded as the &quot;Opposite&quot; of a voltage sensor.</p>
</html>"));
        // balance: 6 unknowns (p.v, p.i, n.v, n.i, v, i), 2 flow variables and 1 input provided by connections, 3 equations
      end SignalVoltage;

      model ConstantCurrent "Source for constant current"
        parameter Modelica.Units.SI.Current I(start=1) "Value of constant current";
        extends Modelica.Electrical.Analog.Interfaces.OnePort;
        extends Modelica.Electrical.Analog.Icons.CurrentSource;
      equation
        i = I;
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Text(
                extent={{-150,-100},{150,-60}},
                textString="I=%I")}),
          Documentation(info="<html>
<p>The ConstantCurrent source is a simple source for an ideal constant current which is provided by a parameter. There is no internal resistance modeled. No further effects are modeled. Especially, the current flow will never end.</p>
</html>"));
        // balance: 6 unknowns (v, i, p.v, p.i, n.v, n.i), 2 flow variables provided by connections, 4 equations
      end ConstantCurrent;

      model SineCurrent "Sine current source"
        parameter Modelica.Units.SI.Current I(start=1) "Amplitude of sine wave";
        parameter Modelica.Units.SI.Angle phase=0 "Phase of sine wave";
        parameter Modelica.Units.SI.Frequency f(start=1) "Frequency of sine wave";
        extends Modelica.Electrical.Analog.Interfaces.CurrentSource;
      equation
        i = offset + (if time < startTime then 0 else I*sin(2*Modelica.Constants.pi*f*(time - startTime) + phase));
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Line(points={{-70,0},{-60.2,29.9},{-53.8,46.5},{-48.2,58.1},{-43.3,65.2},{-38.3,69.2},{-33.4,69.8},{-28.5,67},{-23.6,61},{-18.6,52},{-13,38.6},{-5.98,18.6},{8.79,-26.9},{15.1,-44},{20.8,-56.2},{25.7,-64},{30.6,-68.6},{35.5,-70},{40.5,-67.9},{45.4,-62.5},{50.3,-54.1},{55.9,-41.3},{63,-21.7},{70,0}},
                  color={192,192,192})}),
          Documentation(info="<html>
<p>This current source generates the sine wave i = offset + I*sin(2*pi*f*(time - startTime) + phase) for time &gt;= startTime and i = offset before. In the Modelica Standard Library the signal is produced by the corresponding block of Modelica.Blocks.Sources; here the equation is written directly in the source.</p>
</html>"));
        // balance: 6 unknowns (v, i, p.v, p.i, n.v, n.i), 2 flow variables provided by connections, 4 equations
      end SineCurrent;

      model StepCurrent "Step current source"
        parameter Modelica.Units.SI.Current I(start=1) "Height of step";
        extends Modelica.Electrical.Analog.Interfaces.CurrentSource;
      equation
        i = offset + (if time < startTime then 0 else I);
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Line(points={{-86,-70},{-14,-70},{-14,70},{57,70}}, color={192,192,192})}),
          Documentation(info="<html>
<p>This current source generates a step: i = offset for time &lt; startTime and i = offset + I afterwards. In the Modelica Standard Library the signal is produced by the corresponding block of Modelica.Blocks.Sources; here the equation is written directly in the source.</p>
</html>"));
        // balance: 6 unknowns (v, i, p.v, p.i, n.v, n.i), 2 flow variables provided by connections, 4 equations
      end StepCurrent;

      model SignalCurrent "Generic current source using the input signal as source current"
        extends Modelica.Electrical.Analog.Icons.CurrentSource;
        Modelica.Electrical.Analog.Interfaces.PositivePin p annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
        Modelica.Electrical.Analog.Interfaces.NegativePin n annotation (Placement(transformation(extent={{110,-10},{90,10}})));
        Modelica.Blocks.Interfaces.RealInput i(unit="A") "Current flowing from pin p to pin n as input signal"
          annotation (Placement(transformation(
              origin={0,120},
              extent={{-20,-20},{20,20}},
              rotation=270)));
        Modelica.Units.SI.Voltage v "Voltage drop between the two pins (= p.v - n.v)";
      equation
        v = p.v - n.v;
        0 = p.i + n.i;
        i = p.i;
        annotation (
          Documentation(info="<html>
<p>The signal current source is a parameterless converter of real valued signals into a the source current. No further effects are modeled. The real valued signal has to be provided by components of the blocks library. It can be regarded as the &quot;Opposite&quot; of a current sensor.</p>
</html>"));
        // balance: 6 unknowns (p.v, p.i, n.v, n.i, i, v), 2 flow variables and 1 input provided by connections, 3 equations
      end SignalCurrent;

      annotation (Documentation(info="<html>
<p>This package contains time-dependent and controlled voltage and current sources. The signal shapes correspond to the blocks of the Modelica.Blocks.Sources package. All sources are ideal in the sense that <strong>no</strong> internal resistances are included.</p>
</html>"));
    end Sources;

    package Interfaces "Connectors and partial models for Analog electrical components"
      extends Modelica.Icons.InterfacesPackage;

      connector Pin "Pin of an electrical component"
        Modelica.Units.SI.ElectricPotential v "Potential at the pin";
        flow Modelica.Units.SI.Current i "Current flowing into the pin";
        annotation (defaultComponentName="pin",
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Rectangle(
                extent={{-100,100},{100,-100}},
                lineColor={0,0,255},
                fillColor={0,0,255},
                fillPattern=FillPattern.Solid)}),
          Diagram(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Rectangle(
                extent={{-40,40},{40,-40}},
                lineColor={0,0,255},
                fillColor={0,0,255},
                fillPattern=FillPattern.Solid), Text(
                extent={{-160,110},{40,50}},
                textColor={0,0,255},
                textString="%name")}),
          Documentation(info="<html>
<p>Pin is the basic electric connector. It includes the voltage which consists between the pin and the ground node. The ground node is the node of (any) ground device (Modelica.Electrical.Basic.Ground). Furthermore, the pin includes the current, which is considered to be <strong>positive</strong> if it is flowing at the pin <strong>into the device</strong>.</p>
</html>"));
      end Pin;

      connector PositivePin "Positive pin of an electrical component"
        Modelica.Units.SI.ElectricPotential v "Potential at the pin";
        flow Modelica.Units.SI.Current i "Current flowing into the pin";
        annotation (defaultComponentName="pin_p",
          Documentation(info="<html>
<p>Connectors PositivePin and NegativePin are nearly identical. The only difference is that the icons are different in order to identify more easily the pins of a component. Usually, connector PositivePin is used for the positive and connector NegativePin for the negative pin of an electrical component.</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Rectangle(
                extent={{-100,100},{100,-100}},
                lineColor={0,0,255},
                fillColor={0,0,255},
                fillPattern=FillPattern.Solid)}),
          Diagram(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Rectangle(
                extent={{-40,40},{40,-40}},
                lineColor={0,0,255},
                fillColor={0,0,255},
                fillPattern=FillPattern.Solid), Text(
                extent={{-160,110},{40,50}},
                textColor={0,0,255},
                textString="%name")}));
      end PositivePin;

      connector NegativePin "Negative pin of an electrical component"
        Modelica.Units.SI.ElectricPotential v "Potential at the pin";
        flow Modelica.Units.SI.Current i "Current flowing into the pin";
        annotation (defaultComponentName="pin_n",
          Documentation(info="<html>
<p>Connectors PositivePin and NegativePin are nearly identical. The only difference is that the icons are different in order to identify more easily the pins of a component. Usually, connector PositivePin is used for the positive and connector NegativePin for the negative pin of an electrical component.</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Rectangle(
                extent={{-100,100},{100,-100}},
                lineColor={0,0,255},
                fillColor={255,255,255},
                fillPattern=FillPattern.Solid)}),
          Diagram(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Rectangle(
                extent={{-40,40},{40,-40}},
                lineColor={0,0,255},
                fillColor={255,255,255},
                fillPattern=FillPattern.Solid), Text(
                extent={{-40,110},{160,50}},
                textString="%name",
                textColor={0,0,255})}));
      end NegativePin;

      partial model TwoPin "Component with two electrical pins"
        Modelica.Units.SI.Voltage v "Voltage drop of the two pins (= p.v - n.v)";
        Modelica.Electrical.Analog.Interfaces.PositivePin p "Positive electrical pin"
          annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
        Modelica.Electrical.Analog.Interfaces.NegativePin n "Negative electrical pin"
          annotation (Placement(transformation(extent={{90,-10},{110,10}})));
      equation
        v = p.v - n.v;
        annotation (Documentation(info="<html>
<p>TwoPin is a partial model with two pins and one internal variable for the voltage over the two pins. Internal currents are not defined. It is intended to be used in cases where the model which inherits TwoPin is composed by combining other components graphically, not by equations.</p>
</html>"));
      end TwoPin;

      partial model OnePort "Component with two electrical pins p and n and current i from p to n"
        extends Modelica.Electrical.Analog.Interfaces.TwoPin;
        Modelica.Units.SI.Current i "Current flowing from pin p to pin n";
      equation
        0 = p.i + n.i;
        i = p.i;
        annotation (Documentation(info="<html>
<p>Superclass of elements which have <strong>two</strong> electrical pins: the positive pin connector <em>p</em>, and the negative pin connector <em>n</em>. It is assumed that the current flowing into pin p is identical to the current flowing out of pin n. This current is provided explicitly as current i.</p>
</html>"));
      end OnePort;

      partial model FourPin "Component with two pairs of each two electrical pins"
        Modelica.Units.SI.Voltage v1 "Voltage drop of port 1 (= p1.v - n1.v)";
        Modelica.Units.SI.Voltage v2 "Voltage drop of port 2 (= p2.v - n2.v)";
        Modelica.Units.SI.Current i1 "Current flowing from pos. to neg. pin of port 1";
        Modelica.Units.SI.Current i2 "Current flowing from pos. to neg. pin of port 2";
        Modelica.Electrical.Analog.Interfaces.PositivePin p1 "Positive electrical pin of port 1"
          annotation (Placement(transformation(extent={{-110,90},{-90,110}}), iconTransformation(extent={{-110,90},{-90,110}})));
        Modelica.Electrical.Analog.Interfaces.NegativePin n1 "Negative electrical pin of port 1"
          annotation (Placement(transformation(extent={{-90,-110},{-110,-90}}), iconTransformation(extent={{-90,-110},{-110,-90}})));
        Modelica.Electrical.Analog.Interfaces.PositivePin p2 "Positive electrical pin of port 2"
          annotation (Placement(transformation(extent={{110,90},{90,110}}), iconTransformation(extent={{110,90},{90,110}})));
        Modelica.Electrical.Analog.Interfaces.NegativePin n2 "Negative electrical pin of port 2"
          annotation (Placement(transformation(extent={{90,-110},{110,-90}}), iconTransformation(extent={{90,-110},{110,-90}})));
      equation
        v1 = p1.v - n1.v;
        v2 = p2.v - n2.v;
        i1 = p1.i;
        i2 = p2.i;
        annotation (Documentation(info="<html>
<p>FourPin is a partial model that consists of two pairs of each two electrical pins.</p>
</html>"));
      end FourPin;

      partial model TwoPort "Component with two electrical ports, including current"
        extends Modelica.Electrical.Analog.Interfaces.FourPin;
      equation
        0 = p1.i + n1.i;
        0 = p2.i + n2.i;
        annotation (Documentation(info="<html>
<p>TwoPort is a partial model that consists of two ports. Like OnePort each port has two pins. It is assumed that the current flowing into the positive  pin   is identical to the current flowing out of pin n. This currents of each port are  provided explicitly as currents i1 and i2, the voltages respectively as v1 and v2.</p>
</html>"));
      end TwoPort;

      partial model VoltageSource "Interface for voltage sources"
        extends Modelica.Electrical.Analog.Icons.VoltageSource;
        extends Modelica.Electrical.Analog.Interfaces.OnePort;
        parameter Modelica.Units.SI.Voltage offset=0 "Voltage offset";
        parameter Modelica.Units.SI.Time startTime=0 "Time offset";
        annotation (Documentation(info="<html>
<p>The VoltageSource partial model prepares voltage sources by providing the pins, and the offset and startTime parameters, which are the same at all voltage sources. The source behavior (equation for v) is given in the derived classes; in the Modelica Standard Library it is taken from a replaceable Modelica.Blocks signal source.</p>
</html>"));
      end VoltageSource;

      partial model CurrentSource "Interface for current sources"
        extends Modelica.Electrical.Analog.Icons.CurrentSource;
        extends Modelica.Electrical.Analog.Interfaces.OnePort;
        parameter Modelica.Units.SI.Current offset=0 "Current offset";
        parameter Modelica.Units.SI.Time startTime=0 "Time offset";
        annotation (Documentation(info="<html>
<p>The CurrentSource partial model prepares current sources by providing the pins, and the offset and startTime parameters, which are the same at all current sources. The source behavior (equation for i) is given in the derived classes; in the Modelica Standard Library it is taken from a replaceable Modelica.Blocks signal source.</p>
</html>"));
      end CurrentSource;

      partial model IdealSemiconductor "Ideal semiconductor"
        extends Modelica.Electrical.Analog.Interfaces.OnePort;
        parameter Modelica.Units.SI.Resistance Ron(final min=0) = 1e-5 "Forward state-on differential resistance (closed resistance)";
        parameter Modelica.Units.SI.Conductance Goff(final min=0) = 1e-5 "Backward state-off conductance (opened conductance)";
        parameter Modelica.Units.SI.Voltage Vknee(final min=0) = 0 "Forward threshold voltage";
        Boolean off(start=true) "Switching state";
        Modelica.Units.SI.Power LossPower "Loss power dissipated in the semiconductor";
      protected
        Real s(start=0, final unit="1") "Auxiliary variable for actual position on the ideal diode characteristic";
        /* s = 0: knee point
           s < 0: below knee point, blocking
           s > 0: above knee point, conducting */
        constant Modelica.Units.SI.Voltage unitVoltage=1 annotation (HideResult=true);
        constant Modelica.Units.SI.Current unitCurrent=1 annotation (HideResult=true);
      equation
        v = s*(if off then unitVoltage else Ron*unitCurrent) + Vknee;
        i = s*(if off then Goff*unitVoltage else unitCurrent) + Goff*Vknee;
        LossPower = v*i;
        annotation (
          Documentation(info="<html>
<p>
This is an ideal semiconductor which is<br><br>
<strong>open </strong>(off), if it is reversed biased (voltage drop less than 0)<br>
<strong>closed</strong> (on), if it is conducting (current > 0).<br>
<br>
This is the behaviour if all parameters are exactly zero.<br><br>
Note, there are circuits, where this ideal description
with zero resistance and zero conductance is not possible.
In order to prevent singularities during switching, the opened
semiconductor has a small conductance <em>Gon</em>
and the closed semiconductor has a low resistance <em>Roff</em> which is default.
</p>
<p>
The parameter <em>Vknee</em> which is the forward threshold voltage, allows to displace
the knee point<br> along  the <em>Gon</em>-characteristic until <em>v = Vknee</em>.
</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Polygon(
                points={{30,0},{-30,40},{-30,-40},{30,0}},
                lineColor={0,0,255},
                fillColor={255,255,255},
                fillPattern=FillPattern.Solid),
              Line(points={{-90,0},{40,0}}, color={0,0,255}),
              Line(points={{40,0},{90,0}}, color={0,0,255}),
              Line(points={{30,40},{30,-40}}, color={0,0,255}),
              Text(
                extent={{-150,90},{150,50}},
                textString="%name",
                textColor={0,0,255})}),
          Diagram(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Line(points={{-80,0},{80,0}}, color={128,128,128}),
                Polygon(
                  points={{70,4},{80,0},{70,-4},{70,4}},
                  lineColor={128,128,128},
                  fillColor={128,128,128},
                  fillPattern=FillPattern.Solid),Line(points={{0,80},{0,-80}},
                color={128,128,128}),Polygon(
                  points={{-4,70},{0,80},{4,70},{-4,70}},
                  lineColor={128,128,128},
                  fillColor={128,128,128},
                  fillPattern=FillPattern.Solid),Text(
                  extent={{10,80},{20,70}},
                  textColor={128,128,128},
                  textString="i"),Text(
                  extent={{70,-10},{80,-20}},
                  textColor={128,128,128},
                  textString="v"),Line(
                  points={{-80,-40},{-20,-10},{20,10},{40,70}},
                  thickness=0.5),Line(
                  points={{20,9},{20,0}},
                  color={128,128,128},
                  pattern=LinePattern.Dot),Text(
                  extent={{20,0},{40,-10}},
                  textColor={128,128,128},
                  textString="Vknee"),Text(
                  extent={{20,70},{40,60}},
                  textColor={128,128,128},
                  textString="Ron"),Text(
                  extent={{-20,10},{0,0}},
                  textColor={128,128,128},
                  textString="Goff"),Ellipse(
                  extent={{18,12},{22,8}},
                  pattern=LinePattern.Dot,
                  lineColor={0,0,255})}));
      end IdealSemiconductor;

      partial model IdealSwitch "Ideal electrical switch"
        extends Modelica.Electrical.Analog.Interfaces.OnePort;
        parameter Modelica.Units.SI.Resistance Ron(final min=0) = 1e-5 "Closed switch resistance";
        parameter Modelica.Units.SI.Conductance Goff(final min=0) = 1e-5 "Opened switch conductance";
        Modelica.Units.SI.Power LossPower "Loss power dissipated in the switch";
      protected
        Boolean off "Indicates off-state";
        Real s(final unit="1") "Auxiliary variable";
        constant Modelica.Units.SI.Voltage unitVoltage=1 annotation (HideResult=true);
        constant Modelica.Units.SI.Current unitCurrent=1 annotation (HideResult=true);
      equation
        v = s*(if off then unitVoltage else Ron*unitCurrent);
        i = s*(if off then Goff*unitVoltage else unitCurrent);
        LossPower = v*i;
        annotation (
          Documentation(info="<html>
<p>
The ideal switch has a positive pin p and a negative pin n.
The switching behaviour is controlled by the boolean signal off.
If off is true, pin p is not connected with negative pin n.
Otherwise, pin p is connected with negative pin n.<br><br>
In order to prevent singularities during switching, the opened
switch has a (very low) conductance Goff
and the closed switch has a (very low) resistance Ron.
The limiting case is also allowed, i.e., the resistance Ron of the
closed switch could be exactly zero and the conductance Goff of the
open switch could be also exactly zero. Note, there are circuits,
where a description with zero Ron or zero Goff is not possible.
</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Ellipse(extent={{-44,4},{-36,-4}}, lineColor={0,0,255}),
              Line(points={{-90,0},{-44,0}}, color={0,0,255}),
              Line(points={{-37,2},{40,40}}, color={0,0,255}),
              Line(points={{40,0},{90,0}}, color={0,0,255}),
              Text(
                extent={{-150,90},{150,50}},
                textString="%name",
                textColor={0,0,255})}));
      end IdealSwitch;

      partial model AbsoluteSensor "Base class to measure the absolute value of a pin variable"
        extends Modelica.Icons.RoundSensor;
        Modelica.Electrical.Analog.Interfaces.PositivePin p "Positive electrical pin"
          annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
        Modelica.Blocks.Interfaces.RealOutput y "Measured quantity as Real output signal"
          annotation (Placement(transformation(extent={{100,-10},{120,10}})));
        annotation (
          Icon(coordinateSystem(
              preserveAspectRatio=true,
              extent={{-100,-100},{100,100}}), graphics={
              Line(points={{-70,0},{-90,0}}),
              Line(points={{70,0},{100,0}}, color={0,0,255}),
              Text(
                extent={{-150,80},{150,120}},
                textString="%name",
                textColor={0,0,255})}),
          Documentation(info="<html>
<p>The AbsoluteSensor is a partial model for converting values that can be calculated from one pin connector into a real valued signal. The special calculation has to be described in the model which inherits the AbsoluteSensor.  It is often used in sensor devices. To be a true sensor the modeller has to take care that the sensor model does not influence the electrical behavior to be measured.</p>
</html>"));
      end AbsoluteSensor;

      partial model RelativeSensor "Base class to measure a relative variable between two pins"
        extends Modelica.Icons.RoundSensor;
        Modelica.Electrical.Analog.Interfaces.PositivePin p "Positive electrical pin"
          annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
        Modelica.Electrical.Analog.Interfaces.NegativePin n "Negative electrical pin"
          annotation (Placement(transformation(extent={{90,-10},{110,10}})));
        Modelica.Blocks.Interfaces.RealOutput y "Measured quantity as Real output signal"
          annotation (Placement(transformation(
              origin={0,-100},
              extent={{10,-10},{-10,10}},
              rotation=90)));
        annotation (
          Icon(coordinateSystem(
              preserveAspectRatio=true,
              extent={{-100,-100},{100,100}}), graphics={
              Line(points={{-70,0},{-90,0}}),
              Line(points={{70,0},{90,0}}),
              Line(points={{0,-90},{0,-70}}, color={0,0,255}),
              Text(
                extent={{-150,80},{150,120}},
                textString="%name",
                textColor={0,0,255})}),
          Documentation(info="<html>
<p>The RelativeSensor is a partial model for converting values that can be calculated from two pin connectors into a real valued signal. The special calculation has to be described in the model which inherits the RelativeSensor.  It is often used in sensor devices. To be a true sensor the modeller has to take care that the sensor model does not influence the electrical behavior to be measured.</p>
</html>"));
      end RelativeSensor;

      annotation (Documentation(info="<html>
<p>This package contains connectors and interfaces (partial models) for analog electrical components. The partial models contain typical combinations of pins, and internal variables which are often used.</p>
</html>"));
    end Interfaces;

    package Icons "Icons for analog electrical models"
      extends Modelica.Icons.IconsPackage;

      partial model VoltageSource "Icon for voltage sources"
        annotation (
          Icon(coordinateSystem(
              preserveAspectRatio=true,
              extent={{-100,-100},{100,100}}), graphics={
              Ellipse(
                extent={{-50,50},{50,-50}},
                lineColor={0,0,255},
                fillColor={255,255,255},
                fillPattern=FillPattern.Solid),
              Text(
                extent={{-150,60},{150,100}},
                textString="%name",
                textColor={0,0,255}),
              Line(points={{-90,0},{90,0}}, color={0,0,255}),
              Line(points={{-80,20},{-60,20}}, color={0,0,255}),
              Line(points={{-70,30},{-70,10}}, color={0,0,255}),
              Line(points={{60,20},{80,20}}, color={0,0,255})}),
          Documentation(info="<html>
<p>Just the common icon for voltage sources.</p>
</html>"));
      end VoltageSource;

      partial model CurrentSource "Icon for current sources"
        annotation (
          Icon(coordinateSystem(
              preserveAspectRatio=true,
              extent={{-100,-100},{100,100}}), graphics={
              Ellipse(
                extent={{-50,50},{50,-50}},
                lineColor={0,0,255},
                fillColor={255,255,255},
                fillPattern=FillPattern.Solid),
              Line(points={{-90,0},{-50,0}}, color={0,0,255}),
              Line(points={{50,0},{90,0}}, color={0,0,255}),
              Line(points={{0,-50},{0,50}}, color={0,0,255}),
              Text(
                extent={{-150,100},{150,60}},
                textString="%name",
                textColor={0,0,255}),
              Polygon(
                points={{90,0},{60,10},{60,-10},{90,0}},
                lineColor={0,0,255},
                fillColor={0,0,255},
                fillPattern=FillPattern.Solid)}),
          Documentation(info="<html>
<p>Just the common icon for current sources.</p>
</html>"));
      end CurrentSource;
    end Icons;

    annotation (Documentation(info="<html>
<p>
This package contains packages for single-phase electrical components.
</p>
</html>"), Icon(graphics={
          Line(points={{12,60},{12,-60}}),
          Line(points={{-12,60},{-12,-60}}),
          Line(points={{-80,0},{-12,0}}),
          Line(points={{12,0},{80,0}})}));
  end Analog;

  annotation (
    Documentation(info="<html>
<p>
This library contains electrical components to build up analog circuits.
</p>
</html>"),
    Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100.0,-100.0},{100.0,100.0}}), graphics={
      Rectangle(
        origin={20.3125,82.8571},
        extent={{-45.3125,-57.8571},{4.6875,-27.8571}}),
      Line(
        origin={8.0,48.0},
        points={{32.0,-58.0},{72.0,-58.0}}),
      Line(
        origin={9.0,54.0},
        points={{31.0,-49.0},{71.0,-49.0}}),
      Line(
        origin={-2.0,55.0},
        points={{-83.0,-50.0},{-33.0,-50.0}}),
      Line(
        origin={-3.0,45.0},
        points={{-72.0,-55.0},{-42.0,-55.0}}),
      Line(
        origin={1.0,50.0},
        points={{-61.0,-45.0},{-61.0,-10.0},{-26.0,-10.0}}),
      Line(
        origin={7.0,50.0},
        points={{18.0,-10.0},{53.0,-10.0},{53.0,-45.0}}),
      Line(
        origin={6.2593,48.0},
        points={{53.7407,-58.0},{53.7407,-93.0},{-66.2593,-93.0},{-66.2593,-58.0}})}));
end Electrical;
