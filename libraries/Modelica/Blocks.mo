within Modelica;
package Blocks "Library of basic input/output control blocks (continuous, math, nonlinear, sources)"
  extends Modelica.Icons.Package;

  package Examples "Library of examples to demonstrate the usage of package Blocks"
    extends Modelica.Icons.ExamplesPackage;

    model PID_Controller "Demonstrates the usage of a Continuous.PI controller"
      extends Modelica.Icons.Example;
      parameter Modelica.Units.SI.Angle driveAngle=1.570796326794897 "Reference distance to move";
      Modelica.Blocks.Continuous.PI PI(
        k=100,
        T=0.1,
        x(fixed=false, start=0.1))
        annotation (Placement(transformation(extent={{-36,-20},{-16,0}})));
      Modelica.Mechanics.Rotational.Components.Inertia inertia1(
        J=1,
        phi(fixed=true, start=0),
        w(fixed=false, start=0))
        annotation (Placement(transformation(extent={{22,-20},{42,0}})));
      Modelica.Mechanics.Rotational.Sources.Torque torque
        annotation (Placement(transformation(extent={{-6,-20},{14,0}})));
      Modelica.Mechanics.Rotational.Components.SpringDamper spring(
        c=1e4,
        d=100,
        phi_rel(fixed=false, start=1e-3),
        w_rel(fixed=true, start=0))
        annotation (Placement(transformation(extent={{50,-20},{70,0}})));
      Modelica.Mechanics.Rotational.Components.Inertia inertia2(
        J=2,
        phi(start=1e-3),
        w(start=0))
        annotation (Placement(transformation(extent={{76,-20},{96,0}})));
      Modelica.Blocks.Sources.Trapezoid speedRef(
        amplitude=1,
        rising=1,
        width=driveAngle - 1,
        falling=1,
        period=10,
        nperiod=1,
        startTime=0.5) "Reference speed (constant acceleration, constant speed, constant deceleration)"
        annotation (Placement(transformation(extent={{-92,20},{-72,40}})));
      Modelica.Blocks.Math.Feedback feedback
        annotation (Placement(transformation(extent={{-66,-20},{-46,0}})));
      Modelica.Mechanics.Rotational.Sensors.SpeedSensor speedSensor
        annotation (Placement(transformation(extent={{42,-50},{22,-30}})));
      Modelica.Mechanics.Rotational.Sources.ConstantTorque loadTorque(tau_constant=10)
        annotation (Placement(transformation(extent={{120,-20},{100,0}})));
    initial equation
      der(inertia1.w) = 0;
      der(spring.w_rel) = 0;
      der(PI.x) = 0;
    equation
      connect(spring.flange_b, inertia2.flange_a)
        annotation (Line(points={{70,-10},{76,-10}}));
      connect(inertia1.flange_b, spring.flange_a)
        annotation (Line(points={{42,-10},{50,-10}}));
      connect(torque.flange, inertia1.flange_a)
        annotation (Line(points={{14,-10},{22,-10}}));
      connect(speedSensor.flange, inertia1.flange_b)
        annotation (Line(points={{42,-40},{46,-40},{46,-10},{42,-10}}));
      connect(loadTorque.flange, inertia2.flange_b)
        annotation (Line(points={{100,-10},{96,-10}}));
      connect(PI.y, torque.tau)
        annotation (Line(points={{-15,-10},{-8,-10}}, color={0,0,127}));
      connect(speedRef.y, feedback.u1)
        annotation (Line(points={{-71,30},{-66,30},{-66,10},{-70,10},{-70,-10},{-64,-10}}, color={0,0,127}));
      connect(feedback.y, PI.u)
        annotation (Line(points={{-47,-10},{-38,-10}}, color={0,0,127}));
      connect(speedSensor.w, feedback.u2)
        annotation (Line(points={{21,-40},{-56,-40},{-56,-18}}, color={0,0,127}));
      annotation (
        Diagram(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{120,100}}), graphics={
            Rectangle(extent={{-99,48},{-32,8}}, lineColor={255,0,0}),
            Text(
              extent={{-98,59},{-31,51}},
              textColor={255,0,0},
              textString="reference speed generation"),
            Text(
              extent={{-98,-46},{-60,-52}},
              textColor={255,0,0},
              textString="PI controller"),
            Line(
              points={{-76,-44},{-57,-23}},
              color={255,0,0},
              arrow={Arrow.None,Arrow.Filled}),
            Rectangle(extent={{-5,6},{119,-50}}, lineColor={255,0,0}),
            Text(
              extent={{24,14},{91,7}},
              textColor={255,0,0},
              textString="plant (simple drive train)")}),
        experiment(StopTime=4),
        Documentation(info="<html>
<p>
This is a simple drive train controlled by a PI controller:
</p>
<ul>
<li> The block &quot;speedRef&quot; generates the reference speed (= constant acceleration phase,
     constant speed phase, constant deceleration phase until inertia is at rest). To check
     whether the system starts in steady state, the reference speed is
     zero until time = 0.5 s and then follows the sketched trajectory.</li>
<li> The block &quot;PI&quot; is an instance of &quot;Blocks.Continuous.PI&quot;. In the original
     Modelica Standard Library example the anti-windup controller &quot;LimPID&quot; is used instead.</li>
<li> The output of the controller is a torque that drives a motor inertia
     &quot;inertia1&quot;. Via a compliant spring/damper component, the load
     inertia &quot;inertia2&quot; is attached. A constant external torque of 10 Nm
     is acting on the load inertia.</li>
</ul>
<p>
The PI controller and the drive are initialized in steady state via the initial equations
der(inertia1.w) = 0, der(spring.w_rel) = 0 and der(PI.x) = 0 together with the fixed start values
of inertia1.phi and spring.w_rel.
</p>
</html>"));
      // balance (flattened): 45 unknowns (PI 3, inertia1 7, torque 4, spring 10, inertia2 7, speedRef 2,
      // feedback 3, speedSensor 3, loadTorque 6) and 45 equations (32 component equations,
      // 4 signal connections, 9 flange connection equations from 4 connection sets with 9 flanges);
      // 5 initial conditions: inertia1.phi (fixed), spring.w_rel (fixed) + 3 initial equations.
    end PID_Controller;

    annotation (Documentation(info="<html>
<p>
This package contains example models to demonstrate the
usage of package blocks.
</p>
</html>"));
  end Examples;

  package Continuous "Library of continuous control blocks with internal states"
    extends Modelica.Icons.Package;

    block Integrator "Output the integral of the input signal"
      parameter Real k=1 "Integrator gain";
      parameter Real y_start=0 "Initial or guess value of output (= state)"
        annotation (Dialog(group="Initialization"));
      extends Modelica.Blocks.Interfaces.SISO(y(start=y_start, fixed=true));
    equation
      der(y) = k*u;
      annotation (
        Documentation(info="<html>
<p>
This blocks computes output <strong>y</strong> as
<em>integral</em> of the input <strong>u</strong> multiplied with
the gain <em>k</em>:
</p>
<blockquote><pre>
    k
y = - u
    s
</pre></blockquote>
<p>
The state y is initialized with y_start (simplified initialization compared to the
Modelica Standard Library: the initType parameter and the optional reset port are not available).
</p>
</html>"), Icon(coordinateSystem(
              preserveAspectRatio=true,
              extent={{-100.0,-100.0},{100.0,100.0}}),
            graphics={
              Line(
                points={{-80.0,78.0},{-80.0,-90.0}},
                color={192,192,192}),
              Polygon(
                lineColor={192,192,192},
                fillColor={192,192,192},
                fillPattern=FillPattern.Solid,
                points={{-80.0,90.0},{-88.0,68.0},{-72.0,68.0},{-80.0,90.0}}),
              Line(
                points={{-90.0,-80.0},{82.0,-80.0}},
                color={192,192,192}),
              Polygon(
                lineColor={192,192,192},
                fillColor={192,192,192},
                fillPattern=FillPattern.Solid,
                points={{90.0,-80.0},{68.0,-72.0},{68.0,-88.0},{90.0,-80.0}}),
              Text(
                textColor={192,192,192},
                extent={{0.0,-70.0},{60.0,-10.0}},
                textString="I"),
              Text(
                extent={{-150.0,-150.0},{150.0,-110.0}},
                textString="k=%k"),
              Line(
                points={{-80.0,-80.0},{80.0,80.0}},
                color={0,0,127})}));
      // balance: 2 unknowns (u, y), 1 input provided by connection, 1 equation
    end Integrator;

    block Derivative "Approximated derivative block"
      parameter Real k=1 "Gains";
      parameter Modelica.Units.SI.Time T(min=Modelica.Constants.small) = 0.01
        "Time constants (T>0 required; T=0 is ideal derivative block)";
      parameter Real x_start=0 "Initial or guess value of state"
        annotation (Dialog(group="Initialization"));
      extends Modelica.Blocks.Interfaces.SISO;
      output Real x(start=x_start, fixed=true) "State of block";
    equation
      der(x) = (u - x)/T;
      y = (k/T)*(u - x);
      annotation (
        Documentation(info="<html>
<p>
This blocks defines the transfer function between the
input u and the output y
as <em>approximated derivative</em>:
</p>
<blockquote><pre>
        k * s
y = ------------ * u
       T * s + 1
</pre></blockquote>
<p>
The state x is initialized with x_start (the initType parameter of the Modelica Standard
Library is not available).
</p>
</html>"), Icon(
        coordinateSystem(preserveAspectRatio=true,
            extent={{-100.0,-100.0},{100.0,100.0}}),
          graphics={
        Line(points={{-80.0,78.0},{-80.0,-90.0}},
          color={192,192,192}),
      Polygon(lineColor={192,192,192},
        fillColor={192,192,192},
        fillPattern=FillPattern.Solid,
        points={{-80.0,90.0},{-88.0,68.0},{-72.0,68.0},{-80.0,90.0}}),
      Line(points={{-90.0,-80.0},{82.0,-80.0}},
        color={192,192,192}),
      Polygon(lineColor={192,192,192},
        fillColor={192,192,192},
        fillPattern=FillPattern.Solid,
        points={{90.0,-80.0},{68.0,-72.0},{68.0,-88.0},{90.0,-80.0}}),
      Line(origin={-24.667,-27.333},
        points={{-55.333,87.333},{-19.333,-40.667},{86.667,-52.667}},
        color={0,0,127},
        smooth=Smooth.Bezier),
      Text(textColor={192,192,192},
        extent={{-30.0,14.0},{86.0,60.0}},
        textString="DT1"),
      Text(extent={{-150.0,-150.0},{150.0,-110.0}},
        textString="k=%k")}));
      // balance: 3 unknowns (u, y, x), 1 input provided by connection, 2 equations
    end Derivative;

    block FirstOrder "First order transfer function block (= 1 pole)"
      parameter Real k=1 "Gain";
      parameter Modelica.Units.SI.Time T(start=1) "Time Constant";
      parameter Real y_start=0 "Initial or guess value of output (= state)"
        annotation (Dialog(group="Initialization"));
      extends Modelica.Blocks.Interfaces.SISO(y(start=y_start, fixed=true));
    equation
      der(y) = (k*u - y)/T;
      annotation (
        Documentation(info="<html>
<p>
This blocks defines the transfer function between the input u
and the output y as <em>first order</em> system:
</p>
<blockquote><pre>
          k
y = ------------ * u
       T * s + 1
</pre></blockquote>
<blockquote><pre>
Example:
   parameter: k = 0.3, T = 0.4
   results in:
             0.3
      y = ----------- * u
          0.4 s + 1.0
</pre></blockquote>
</html>"), Icon(
      coordinateSystem(preserveAspectRatio=true,
          extent={{-100.0,-100.0},{100.0,100.0}}),
        graphics={
      Line(points={{-80.0,78.0},{-80.0,-90.0}},
        color={192,192,192}),
      Polygon(lineColor={192,192,192},
        fillColor={192,192,192},
        fillPattern=FillPattern.Solid,
        points={{-80.0,90.0},{-88.0,68.0},{-72.0,68.0},{-80.0,90.0}}),
      Line(points={{-90.0,-80.0},{82.0,-80.0}},
        color={192,192,192}),
      Polygon(lineColor={192,192,192},
        fillColor={192,192,192},
        fillPattern=FillPattern.Solid,
        points={{90.0,-80.0},{68.0,-72.0},{68.0,-88.0},{90.0,-80.0}}),
      Line(origin={-26.667,6.667},
          points={{106.667,43.333},{-13.333,29.333},{-53.333,-86.667}},
          color={0,0,127},
          smooth=Smooth.Bezier),
      Text(textColor={192,192,192},
        extent={{0.0,-60.0},{60.0,0.0}},
        textString="PT1"),
      Text(extent={{-150.0,-150.0},{150.0,-110.0}},
        textString="T=%T")}));
      // balance: 2 unknowns (u, y), 1 input provided by connection, 1 equation
    end FirstOrder;

    block SecondOrder "Second order transfer function block (= 2 poles)"
      parameter Real k=1 "Gain";
      parameter Real w(start=1) "Angular frequency";
      parameter Real D(start=1) "Damping";
      parameter Real y_start=0 "Initial or guess value of output (= state)"
        annotation (Dialog(group="Initialization"));
      parameter Real yd_start=0 "Initial or guess value of derivative of output (= state)"
        annotation (Dialog(group="Initialization"));
      extends Modelica.Blocks.Interfaces.SISO(y(start=y_start, fixed=true));
      output Real yd(start=yd_start, fixed=true) "Derivative of y";
    equation
      der(y) = yd;
      der(yd) = w*(w*(k*u - y) - 2*D*yd);
      annotation (
        Documentation(info="<html>
<p>
This blocks defines the transfer function between the input u and
the output y as <em>second order</em> system:
</p>
<blockquote><pre>
                    k
y = --------------------------------- * u
     ( s / w )^2 + 2*D*( s / w ) + 1
</pre></blockquote>
<blockquote><pre>
Example:

   parameter: k =  0.3,  w = 0.5,  D = 0.4
   results in:
                  0.3
      y = ------------------- * u
          4.0 s^2 + 1.6 s + 1
</pre></blockquote>
</html>"), Icon(
          coordinateSystem(preserveAspectRatio=true,
                extent={{-100.0,-100.0},{100.0,100.0}}),
              graphics={
          Line(points={{-80.0,78.0},{-80.0,-90.0}},
              color={192,192,192}),
        Polygon(lineColor={192,192,192},
            fillColor={192,192,192},
            fillPattern=FillPattern.Solid,
            points={{-80.0,90.0},{-88.0,68.0},{-72.0,68.0},{-80.0,90.0}}),
        Line(points={{-90.0,-80.0},{82.0,-80.0}},
            color={192,192,192}),
        Polygon(lineColor={192,192,192},
            fillColor={192,192,192},
            fillPattern=FillPattern.Solid,
            points={{90.0,-80.0},{68.0,-72.0},{68.0,-88.0},{90.0,-80.0}}),
        Line(origin={-1.939,-1.816},
            points={{81.939,36.056},{65.362,36.056},{14.39,-26.199},{-29.966,113.485},{-65.374,-61.217},{-78.061,-78.184}},
            color={0,0,127},
            smooth=Smooth.Bezier),
        Text(textColor={192,192,192},
            extent={{0.0,-70.0},{60.0,-10.0}},
            textString="PT2"),
        Text(extent={{-150.0,-150.0},{150.0,-110.0}},
            textString="w=%w")}));
      // balance: 3 unknowns (u, y, yd), 1 input provided by connection, 2 equations
    end SecondOrder;

    block PI "Proportional-Integral controller"
      parameter Real k=1 "Gain";
      parameter Modelica.Units.SI.Time T(start=1, min=Modelica.Constants.small) "Time Constant (T>0 required)";
      parameter Real x_start=0 "Initial or guess value of state"
        annotation (Dialog(group="Initialization"));
      extends Modelica.Blocks.Interfaces.SISO;
      output Real x(start=x_start, fixed=true) "State of block";
    equation
      der(x) = u/T;
      y = k*(x + u);
      annotation (defaultComponentName="PI",
        Documentation(info="<html>
<p>
This blocks defines the transfer function between the input u and
the output y as <em>PI</em> system:
</p>
<blockquote><pre>
              1
y = k * (1 + ---) * u
             T*s
        T*s + 1
  = k * ------- * u
          T*s
</pre></blockquote>
<blockquote><pre>
Example:

   parameter: k = 0.3,  T = 0.4

   results in:
               0.4 s + 1
      y = 0.3 ----------- * u
                 0.4 s
</pre></blockquote>
<p>
The state x is initialized with x_start. For a steady-state initialization set x(fixed=false)
and add the initial equation der(x) = 0 in the surrounding model.
</p>
</html>"), Icon(coordinateSystem(
            preserveAspectRatio=true,
            extent={{-100,-100},{100,100}}), graphics={
            Line(points={{-80,78},{-80,-90}}, color={192,192,192}),
            Polygon(
              points={{-80,90},{-88,68},{-72,68},{-80,90}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(points={{-90,-80},{82,-80}}, color={192,192,192}),
            Polygon(
              points={{90,-80},{68,-72},{68,-88},{90,-80}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(points={{-80.0,-80.0},{-80.0,-20.0},{60.0,80.0}}, color={0,0,127}),
            Text(
              extent={{0,6},{60,-56}},
              textColor={192,192,192},
              textString="PI"),
            Text(
              extent={{-150,-150},{150,-110}},
              textString="T=%T")}));
      // balance: 3 unknowns (u, y, x), 1 input provided by connection, 2 equations
    end PI;

    block PID "PID controller in additive description form"
      extends Modelica.Blocks.Interfaces.SISO;
      parameter Real k=1 "Gain";
      parameter Modelica.Units.SI.Time Ti(min=Modelica.Constants.small, start=0.5) "Time Constant of Integrator";
      parameter Modelica.Units.SI.Time Td(min=0, start=0.1) "Time Constant of Derivative block";
      parameter Real Nd(min=Modelica.Constants.small) = 10 "The higher Nd, the more ideal the derivative block";
      parameter Real xi_start=0 "Initial or guess value for integrator output (= integrator state)"
        annotation (Dialog(group="Initialization"));
      parameter Real xd_start=0 "Initial or guess value for state of derivative block"
        annotation (Dialog(group="Initialization"));
      constant Modelica.Units.SI.Time unitTime=1 annotation (HideResult=true);
      Modelica.Blocks.Math.Gain P(k=1) "Proportional part of PID controller"
        annotation (Placement(transformation(extent={{-60,60},{-20,100}})));
      Modelica.Blocks.Continuous.Integrator I(k=unitTime/Ti, y_start=xi_start) "Integral part of PID controller"
        annotation (Placement(transformation(extent={{-60,-20},{-20,20}})));
      Modelica.Blocks.Continuous.Derivative D(
        k=Td/unitTime,
        T=max(Td/Nd, 100*Modelica.Constants.eps),
        x_start=xd_start) "Derivative part of PID controller"
        annotation (Placement(transformation(extent={{-60,-100},{-20,-60}})));
      Modelica.Blocks.Math.Gain Gain(k=k) "Gain of PID controller"
        annotation (Placement(transformation(extent={{60,-10},{80,10}})));
      Modelica.Blocks.Math.Add3 Add
        annotation (Placement(transformation(extent={{20,-10},{40,10}})));
    equation
      connect(u, P.u) annotation (Line(points={{-120,0},{-80,0},{-80,80},{-64,80}}, color={0,0,127}));
      connect(u, I.u) annotation (Line(points={{-120,0},{-64,0}}, color={0,0,127}));
      connect(u, D.u) annotation (Line(points={{-120,0},{-80,0},{-80,-80},{-64,-80}}, color={0,0,127}));
      connect(P.y, Add.u1) annotation (Line(points={{-18,80},{0,80},{0,8},{18,8}}, color={0,0,127}));
      connect(I.y, Add.u2) annotation (Line(points={{-18,0},{18,0}}, color={0,0,127}));
      connect(D.y, Add.u3) annotation (Line(points={{-18,-80},{0,-80},{0,-8},{18,-8}}, color={0,0,127}));
      connect(Add.y, Gain.u) annotation (Line(points={{41,0},{58,0}}, color={0,0,127}));
      connect(Gain.y, y) annotation (Line(points={{81,0},{110,0}}, color={0,0,127}));
      annotation (defaultComponentName="PID",
        Icon(
            coordinateSystem(preserveAspectRatio=true,
                extent={{-100.0,-100.0},{100.0,100.0}}),
                graphics={
            Line(points={{-80.0,78.0},{-80.0,-90.0}},
                color={192,192,192}),
          Polygon(lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid,
              points={{-80.0,90.0},{-88.0,68.0},{-72.0,68.0},{-80.0,90.0}}),
          Line(points={{-90.0,-80.0},{82.0,-80.0}},
              color={192,192,192}),
          Polygon(lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid,
              points={{90.0,-80.0},{68.0,-72.0},{68.0,-88.0},{90.0,-80.0}}),
          Line(points={{-80,-80},{-80,-20},{60,80}}, color={0,0,127}),
          Text(textColor={192,192,192},
              extent={{-20.0,-60.0},{80.0,-20.0}},
              textString="PID"),
          Text(extent={{-150.0,-150.0},{150.0,-110.0}},
              textString="Ti=%Ti")}),
        Documentation(info="<html>
<p>
This is the text-book version of a PID controller, built graphically from the blocks
Gain (P), Integrator (I), Derivative (D), Add3 and Gain:
</p>
<blockquote><pre>
y = k * (u + 1/Ti * integral(u) + Td * du/dt)
</pre></blockquote>
<p>
The integrator state is initialized with xi_start and the state of the derivative block
with xd_start (the initType parameter of the Modelica Standard Library is not available).
</p>
</html>"));
      // balance (flattened): 14 unknowns (y, P.u, P.y, I.u, I.y, D.u, D.y, D.x, Gain.u, Gain.y, Add.u1..u3, Add.y),
      // top-level input u provided by connection; 6 block equations + 8 connection equations = 14
    end PID;

    annotation (Documentation(info="<html>
<p>
This package contains basic <strong>continuous</strong> input/output blocks
described by differential equations.
</p>
<p>
All blocks of this package are initialized with the start values of their states
(parameters y_start, x_start, ...). The initType option of the Modelica Standard Library
is not available on this platform; for steady-state initialization set fixed=false on the
state and add an initial equation in the enclosing model.
</p>
</html>"), Icon(graphics={Line(
            origin={0.061,4.184},
            points={{81.939,36.056},{65.362,36.056},{14.39,-26.199},{-29.966,113.485},{-65.374,-61.217},{-78.061,-78.184}},
            color={95,95,95},
            smooth=Smooth.Bezier)}));
  end Continuous;

  package Interfaces "Library of connectors and partial models for input/output blocks"
    extends Modelica.Icons.InterfacesPackage;

    connector RealInput = input Real "'input Real' as connector" annotation (
      defaultComponentName="u",
      Icon(graphics={
        Polygon(
          lineColor={0,0,127},
          fillColor={0,0,127},
          fillPattern=FillPattern.Solid,
          points={{-100.0,100.0},{100.0,0.0},{-100.0,-100.0}})},
        coordinateSystem(extent={{-100.0,-100.0},{100.0,100.0}},
          preserveAspectRatio=true,
          initialScale=0.2)),
      Diagram(
        coordinateSystem(preserveAspectRatio=true,
          initialScale=0.2,
          extent={{-100.0,-100.0},{100.0,100.0}}),
          graphics={
        Polygon(
          lineColor={0,0,127},
          fillColor={0,0,127},
          fillPattern=FillPattern.Solid,
          points={{0.0,50.0},{100.0,0.0},{0.0,-50.0},{0.0,50.0}}),
        Text(
          textColor={0,0,127},
          extent={{-10.0,60.0},{-10.0,85.0}},
          textString="%name")}),
      Documentation(info="<html>
<p>
Connector with one input signal of type Real.
</p>
</html>"));

    connector RealOutput = output Real "'output Real' as connector" annotation (
      defaultComponentName="y",
      Icon(
        coordinateSystem(preserveAspectRatio=true,
          extent={{-100.0,-100.0},{100.0,100.0}}),
          graphics={
        Polygon(
          lineColor={0,0,127},
          fillColor={255,255,255},
          fillPattern=FillPattern.Solid,
          points={{-100.0,100.0},{100.0,0.0},{-100.0,-100.0}})}),
      Diagram(
        coordinateSystem(preserveAspectRatio=true,
          extent={{-100.0,-100.0},{100.0,100.0}}),
          graphics={
        Polygon(
          lineColor={0,0,127},
          fillColor={255,255,255},
          fillPattern=FillPattern.Solid,
          points={{-100.0,50.0},{0.0,0.0},{-100.0,-50.0}}),
        Text(
          textColor={0,0,127},
          extent={{30.0,60.0},{30.0,110.0}},
          textString="%name")}),
      Documentation(info="<html>
<p>
Connector with one output signal of type Real.
</p>
</html>"));

    connector BooleanInput = input Boolean "'input Boolean' as connector"
      annotation (
      defaultComponentName="u",
      Icon(graphics={Polygon(
            points={{-100,100},{100,0},{-100,-100},{-100,100}},
            lineColor={255,0,255},
            fillColor={255,0,255},
            fillPattern=FillPattern.Solid)}, coordinateSystem(
          extent={{-100,-100},{100,100}},
          preserveAspectRatio=true,
          initialScale=0.2)),
      Diagram(coordinateSystem(
          preserveAspectRatio=true,
          initialScale=0.2,
          extent={{-100,-100},{100,100}}), graphics={Polygon(
            points={{0,50},{100,0},{0,-50},{0,50}},
            lineColor={255,0,255},
            fillColor={255,0,255},
            fillPattern=FillPattern.Solid), Text(
            extent={{-10,85},{-10,60}},
            textColor={255,0,255},
            textString="%name")}),
      Documentation(info="<html>
<p>
Connector with one input signal of type Boolean.
</p>
</html>"));

    connector BooleanOutput = output Boolean "'output Boolean' as connector"
      annotation (
      defaultComponentName="y",
      Icon(coordinateSystem(
          preserveAspectRatio=true,
          extent={{-100,-100},{100,100}}), graphics={Polygon(
            points={{-100,100},{100,0},{-100,-100},{-100,100}},
            lineColor={255,0,255},
            fillColor={255,255,255},
            fillPattern=FillPattern.Solid)}),
      Diagram(coordinateSystem(
          preserveAspectRatio=true,
          extent={{-100,-100},{100,100}}), graphics={Polygon(
            points={{-100,50},{0,0},{-100,-50},{-100,50}},
            lineColor={255,0,255},
            fillColor={255,255,255},
            fillPattern=FillPattern.Solid), Text(
            extent={{30,110},{30,60}},
            textColor={255,0,255},
            textString="%name")}),
      Documentation(info="<html>
<p>
Connector with one output signal of type Boolean.
</p>
</html>"));

    partial block SO "Single Output continuous control block"
      extends Modelica.Blocks.Icons.Block;
      Modelica.Blocks.Interfaces.RealOutput y "Connector of Real output signal"
        annotation (Placement(transformation(extent={{100,-10},{120,10}})));
      annotation (Documentation(info="<html>
<p>
Block has one continuous Real output signal.
</p>
</html>"));
    end SO;

    partial block SISO "Single Input Single Output continuous control block"
      extends Modelica.Blocks.Icons.Block;
      Modelica.Blocks.Interfaces.RealInput u "Connector of Real input signal"
        annotation (Placement(transformation(extent={{-140,-20},{-100,20}})));
      Modelica.Blocks.Interfaces.RealOutput y "Connector of Real output signal"
        annotation (Placement(transformation(extent={{100,-10},{120,10}})));
      annotation (Documentation(info="<html>
<p>
Block has one continuous Real input and one continuous Real output signal.
</p>
</html>"));
    end SISO;

    partial block SI2SO "2 Single Input / 1 Single Output continuous control block"
      extends Modelica.Blocks.Icons.Block;
      Modelica.Blocks.Interfaces.RealInput u1 "Connector of Real input signal 1"
        annotation (Placement(transformation(extent={{-140,40},{-100,80}})));
      Modelica.Blocks.Interfaces.RealInput u2 "Connector of Real input signal 2"
        annotation (Placement(transformation(extent={{-140,-80},{-100,-40}})));
      Modelica.Blocks.Interfaces.RealOutput y "Connector of Real output signal"
        annotation (Placement(transformation(extent={{100,-10},{120,10}})));
      annotation (Documentation(info="<html>
<p>
Block has two continuous Real input signals u1 and u2 and one
continuous Real output signal y.
</p>
</html>"));
    end SI2SO;

    partial block SignalSource "Base class for continuous signal source"
      extends Modelica.Blocks.Interfaces.SO;
      parameter Real offset=0 "Offset of output signal y";
      parameter Modelica.Units.SI.Time startTime=0 "Output y = offset for time < startTime";
      annotation (Documentation(info="<html>
<p>
Basic block for Real sources of package Blocks.Sources.
This component has one continuous Real output signal y
and two parameters (offset, startTime) to shift the
generated signal.
</p>
</html>"));
    end SignalSource;

    annotation (Documentation(info="<html>
<p>
This package contains interface definitions for
<strong>continuous</strong> input/output blocks with Real and Boolean signals.
</p>
</html>"));
  end Interfaces;

  package Math "Library of Real mathematical functions as input/output blocks"
    extends Modelica.Icons.Package;

    block Gain "Output the product of a gain value with the input signal"
      parameter Real k(start=1) "Gain value multiplied with input signal";
      Modelica.Blocks.Interfaces.RealInput u "Input signal connector"
        annotation (Placement(transformation(extent={{-140,-20},{-100,20}})));
      Modelica.Blocks.Interfaces.RealOutput y "Output signal connector"
        annotation (Placement(transformation(extent={{100,-10},{120,10}})));
    equation
      y = k*u;
      annotation (
        Documentation(info="<html>
<p>
This block computes output <em>y</em> as
<em>product</em> of gain <em>k</em> with the
input <em>u</em>:
</p>
<blockquote><pre>
y = k * u;
</pre></blockquote>
</html>"),
        Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
            Polygon(
              points={{-100,-100},{-100,100},{100,0},{-100,-100}},
              lineColor={0,0,127},
              fillColor={255,255,255},
              fillPattern=FillPattern.Solid),
            Text(
              extent={{-150,-140},{150,-100}},
              textString="k=%k"),
            Text(
              extent={{-150,140},{150,100}},
              textString="%name",
              textColor={0,0,255})}));
      // balance: 2 unknowns (u, y), 1 input provided by connection, 1 equation
    end Gain;

    block Add "Output the sum of the two inputs"
      extends Modelica.Blocks.Interfaces.SI2SO;
      parameter Real k1=+1 "Gain of input signal 1";
      parameter Real k2=+1 "Gain of input signal 2";
    equation
      y = k1*u1 + k2*u2;
      annotation (
        Documentation(info="<html>
<p>
This blocks computes output <strong>y</strong> as <em>sum</em> of the
two input signals <strong>u1</strong> and <strong>u2</strong>:
</p>
<blockquote><pre>
<strong>y</strong> = k1*<strong>u1</strong> + k2*<strong>u2</strong>;
</pre></blockquote>
</html>"),
        Icon(coordinateSystem(
            preserveAspectRatio=true,
            extent={{-100,-100},{100,100}}), graphics={
            Line(points={{-100,60},{-74,24},{-44,24}}, color={0,0,127}),
            Line(points={{-100,-60},{-74,-24},{-44,-24}}, color={0,0,127}),
            Ellipse(lineColor={0,0,127}, extent={{-50,-50},{50,50}}),
            Line(points={{50,0},{100,0}}, color={0,0,127}),
            Text(extent={{-40,40},{40,-40}}, textString="+"),
            Text(extent={{-100,52},{5,92}}, textString="%k1"),
            Text(extent={{-100,-92},{5,-52}}, textString="%k2")}));
      // balance: 3 unknowns (u1, u2, y), 2 inputs provided by connection, 1 equation
    end Add;

    block Add3 "Output the sum of the three inputs"
      extends Modelica.Blocks.Icons.Block;
      parameter Real k1=+1 "Gain of input signal 1";
      parameter Real k2=+1 "Gain of input signal 2";
      parameter Real k3=+1 "Gain of input signal 3";
      Modelica.Blocks.Interfaces.RealInput u1 "Connector of Real input signal 1"
        annotation (Placement(transformation(extent={{-140,60},{-100,100}})));
      Modelica.Blocks.Interfaces.RealInput u2 "Connector of Real input signal 2"
        annotation (Placement(transformation(extent={{-140,-20},{-100,20}})));
      Modelica.Blocks.Interfaces.RealInput u3 "Connector of Real input signal 3"
        annotation (Placement(transformation(extent={{-140,-100},{-100,-60}})));
      Modelica.Blocks.Interfaces.RealOutput y "Connector of Real output signal"
        annotation (Placement(transformation(extent={{100,-10},{120,10}})));
    equation
      y = k1*u1 + k2*u2 + k3*u3;
      annotation (
        Documentation(info="<html>
<p>
This blocks computes output <strong>y</strong> as <em>sum</em> of the
three input signals <strong>u1</strong>, <strong>u2</strong> and <strong>u3</strong>:
</p>
<blockquote><pre>
<strong>y</strong> = k1*<strong>u1</strong> + k2*<strong>u2</strong> + k3*<strong>u3</strong>;
</pre></blockquote>
</html>"),
        Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
            Text(
              extent={{-100,50},{5,90}},
              textString="%k1"),
            Text(
              extent={{-100,-20},{5,20}},
              textString="%k2"),
            Text(
              extent={{-100,-50},{5,-90}},
              textString="%k3"),
            Text(
              extent={{10,40},{90,-40}},
              textString="+")}));
      // balance: 4 unknowns (u1, u2, u3, y), 3 inputs provided by connection, 1 equation
    end Add3;

    block Feedback "Output difference between commanded and feedback input"
      Modelica.Blocks.Interfaces.RealInput u1 "Commanded input"
        annotation (Placement(transformation(extent={{-100,-20},{-60,20}})));
      Modelica.Blocks.Interfaces.RealInput u2 "Feedback input"
        annotation (Placement(transformation(
            origin={0,-80},
            extent={{-20,-20},{20,20}},
            rotation=90)));
      Modelica.Blocks.Interfaces.RealOutput y
        annotation (Placement(transformation(extent={{80,-10},{100,10}})));
    equation
      y = u1 - u2;
      annotation (
        Documentation(info="<html>
<p>
This blocks computes output <strong>y</strong> as <em>difference</em> of the
commanded input <strong>u1</strong> and the feedback
input <strong>u2</strong>:
</p>
<blockquote><pre>
<strong>y</strong> = <strong>u1</strong> - <strong>u2</strong>;
</pre></blockquote>
</html>"),
        Icon(coordinateSystem(
            preserveAspectRatio=true,
            extent={{-100,-100},{100,100}}), graphics={
            Ellipse(
              lineColor={0,0,127},
              fillColor={235,235,235},
              fillPattern=FillPattern.Solid,
              extent={{-20,-20},{20,20}}),
            Line(points={{-60,0},{-20,0}}, color={0,0,127}),
            Line(points={{20,0},{80,0}}, color={0,0,127}),
            Line(points={{0,-20},{0,-60}}, color={0,0,127}),
            Text(extent={{-14,-94},{82,0}}, textString="-"),
            Text(
              textColor={0,0,255},
              extent={{-150,40},{150,80}},
              textString="%name")}));
      // balance: 3 unknowns (u1, u2, y), 2 inputs provided by connection, 1 equation
    end Feedback;

    block Product "Output product of the two inputs"
      extends Modelica.Blocks.Interfaces.SI2SO;
    equation
      y = u1*u2;
      annotation (
        Documentation(info="<html>
<p>
This blocks computes the output <strong>y</strong>
as <em>product</em> of the two inputs <strong>u1</strong> and <strong>u2</strong>:
</p>
<blockquote><pre>
y = u1 * u2;
</pre></blockquote>
</html>"),
        Icon(coordinateSystem(
            preserveAspectRatio=true,
            extent={{-100,-100},{100,100}}), graphics={
            Line(points={{-100,60},{-40,60},{-30,40}}, color={0,0,127}),
            Line(points={{-100,-60},{-40,-60},{-30,-40}}, color={0,0,127}),
            Line(points={{50,0},{100,0}}, color={0,0,127}),
            Line(points={{-30,0},{30,0}}),
            Line(points={{-15,25.99},{15,-25.99}}),
            Line(points={{-15,-25.99},{15,25.99}}),
            Ellipse(lineColor={0,0,127}, extent={{-50,-50},{50,50}})}));
      // balance: 3 unknowns (u1, u2, y), 2 inputs provided by connection, 1 equation
    end Product;

    block Division "Output first input divided by second input"
      extends Modelica.Blocks.Interfaces.SI2SO;
    equation
      y = u1/u2;
      annotation (
        Documentation(info="<html>
<p>
This block computes the output (quotient) <strong>y</strong>
by <em>dividing</em> the two inputs <strong>u1</strong> (dividend) and <strong>u2</strong> (divisor):
</p>
<blockquote><pre>
y = u1 / u2;
</pre></blockquote>
</html>"),
        Icon(coordinateSystem(
            preserveAspectRatio=true,
            extent={{-100,-100},{100,100}}), graphics={
            Line(points={{-100,60},{-60,60},{0,0}}, color={0,0,127}),
            Line(points={{-100,-60},{-60,-60},{0,0}}, color={0,0,127}),
            Ellipse(lineColor={0,0,127}, extent={{-50,-50},{50,50}},
              fillColor={255,255,255},
              fillPattern=FillPattern.Solid),
            Line(points={{50,0},{100,0}}, color={0,0,127}),
            Line(points={{-30,0},{30,0}}),
            Ellipse(fillPattern=FillPattern.Solid, extent={{-5,20},{5,30}}),
            Ellipse(fillPattern=FillPattern.Solid, extent={{-5,-30},{5,-20}}),
            Text(
              extent={{-60,90},{90,50}},
              textColor={128,128,128},
              textString="u1 / u2")}));
      // balance: 3 unknowns (u1, u2, y), 2 inputs provided by connection, 1 equation
    end Division;

    block Abs "Output the absolute value of the input"
      extends Modelica.Blocks.Interfaces.SISO;
      parameter Boolean generateEvent=false "Choose whether events shall be generated" annotation (Evaluate=true);
    equation
      y = if generateEvent then (if u >= 0 then u else -u) else (if noEvent(u >= 0) then u else -u);
      annotation (
        defaultComponentName="abs1",
        Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
            Polygon(
              points={{92,0},{70,8},{70,-8},{92,0}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(points={{-80,80},{0,0},{80,80}}),
            Line(points={{0,-14},{0,68}}, color={192,192,192}),
            Polygon(
              points={{0,90},{-8,68},{8,68},{0,90}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Text(
              extent={{-34,-28},{38,-76}},
              textColor={192,192,192},
              textString="abs"),
            Line(points={{-88,0},{76,0}}, color={192,192,192})}),
        Documentation(info="<html>
<p>
This blocks computes the output <strong>y</strong>
as <em>absolute value</em> of the input <strong>u</strong>:
</p>
<blockquote><pre>
y = <strong>abs</strong>( u );
</pre></blockquote>
<p>
The Boolean parameter generateEvent decides whether Events are generated at zero crossing (Modelica specification before 3) or not.
</p>
</html>"));
      // balance: 2 unknowns (u, y), 1 input provided by connection, 1 equation
    end Abs;

    block Sqrt "Output the square root of the input (input >= 0 required)"
      extends Modelica.Blocks.Interfaces.SISO;
    equation
      y = sqrt(u);
      annotation (
        defaultComponentName="sqrt1",
        Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
            Line(points={{-90,-80},{68,-80}}, color={192,192,192}),
            Polygon(
              points={{90,-80},{68,-72},{68,-88},{90,-80}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(
              points={{-80,-80},{-79.2,-68.7},{-78.4,-64},{-76.8,-57.3},{-73.6,-47.9},{-67.9,-36.1},{-59.1,-22.2},{-46.2,-6.49},{-28.5,10.7},{-4.42,30},{27.7,51.3},{69.5,74.7},{80,80}},
              smooth=Smooth.Bezier),
            Polygon(
              points={{-80,90},{-88,68},{-72,68},{-80,90}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(points={{-80,-88},{-80,68}}, color={192,192,192}),
            Text(
              extent={{-8,-4},{64,-52}},
              textColor={192,192,192},
              textString="sqrt")}),
        Documentation(info="<html>
<p>
This blocks computes the output <strong>y</strong>
as <em>square root</em> of the input <strong>u</strong>:
</p>
<blockquote><pre>
y = <strong>sqrt</strong>( u );
</pre></blockquote>
<p>
The input shall be zero or positive.
Otherwise an error occurs.
</p>
</html>"));
      // balance: 2 unknowns (u, y), 1 input provided by connection, 1 equation
    end Sqrt;

    block Sin "Output the sine of the input"
      extends Modelica.Blocks.Interfaces.SISO(u(unit="rad"));
    equation
      y = sin(u);
      annotation (
        Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
            Polygon(
              points={{-80,90},{-88,68},{-72,68},{-80,90}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(points={{-80,-80},{-80,68}}, color={192,192,192}),
            Line(points={{-90,0},{68,0}}, color={192,192,192}),
            Line(
              points={{-80,0},{-68.7,34.2},{-61.5,53.1},{-55.1,66.4},{-49.4,74.6},{-43.8,79.1},{-38.2,79.8},{-32.6,76.6},{-26.9,69.7},{-21.3,59.4},{-14.9,44.1},{-6.83,21.2},{10.1,-30.8},{17.3,-50.2},{23.7,-64.2},{29.3,-73.1},{35,-78.4},{40.6,-80},{46.2,-77.6},{51.9,-71.5},{57.5,-61.9},{63.9,-47.2},{72,-24.8},{80,0}},
              smooth=Smooth.Bezier),
            Polygon(
              points={{90,0},{68,8},{68,-8},{90,0}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Text(
              extent={{12,84},{84,36}},
              textColor={192,192,192},
              textString="sin")}),
        Documentation(info="<html>
<p>
This blocks computes the output <strong>y</strong>
as <strong>sine</strong> of the input <strong>u</strong>:
</p>
<blockquote><pre>
y = <strong>sin</strong>( u );
</pre></blockquote>
</html>"));
      // balance: 2 unknowns (u, y), 1 input provided by connection, 1 equation
    end Sin;

    block Cos "Output the cosine of the input"
      extends Modelica.Blocks.Interfaces.SISO(u(unit="rad"));
    equation
      y = cos(u);
      annotation (
        Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
            Polygon(
              points={{-80,90},{-88,68},{-72,68},{-80,90}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(points={{-80,-80},{-80,68}}, color={192,192,192}),
            Line(points={{-90,0},{68,0}}, color={192,192,192}),
            Polygon(
              points={{90,0},{68,8},{68,-8},{90,0}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(
              points={{-80,80},{-74.4,78.1},{-68.7,72.3},{-63.1,63},{-56.7,48.7},{-48.6,26.6},{-29.3,-32.5},{-22.1,-51.7},{-15.7,-65.3},{-10.1,-73.8},{-4.42,-78.8},{1.21,-79.9},{6.83,-77.1},{12.5,-70.6},{18.1,-60.6},{24.5,-45.7},{32.6,-23},{50.3,31.3},{57.5,50.7},{63.9,64.6},{69.5,73.4},{75.2,78.6},{80,80}},
              smooth=Smooth.Bezier),
            Text(
              extent={{-36,82},{36,34}},
              textColor={192,192,192},
              textString="cos")}),
        Documentation(info="<html>
<p>
This blocks computes the output <strong>y</strong>
as <strong>cos</strong> of the input <strong>u</strong>:
</p>
<blockquote><pre>
y = <strong>cos</strong>( u );
</pre></blockquote>
</html>"));
      // balance: 2 unknowns (u, y), 1 input provided by connection, 1 equation
    end Cos;

    block Exp "Output the exponential (base e) of the input"
      extends Modelica.Blocks.Interfaces.SISO;
    equation
      y = exp(u);
      annotation (
        Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
            Line(points={{-90,-80},{68,-80}}, color={192,192,192}),
            Line(points={{0,-80},{0,68}}, color={192,192,192}),
            Polygon(
              points={{0,90},{-8,68},{8,68},{0,90}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Text(
              extent={{-86,50},{-14,2}},
              textColor={192,192,192},
              textString="exp"),
            Line(points={{-80,-80},{-31,-77.9},{-6.03,-74},{10.9,-68.4},{23.7,-61},{34.2,-51.6},{43,-40.3},{50.3,-27.8},{56.7,-13.5},{62.3,2.23},{67.1,18.6},{72,38.2},{76,57.6},{80,80}},
              smooth=Smooth.Bezier),
            Polygon(
              points={{90,-80},{68,-72.3976},{68,-88.3976},{90,-80}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid)}),
        Documentation(info="<html>
<p>
This blocks computes the output <strong>y</strong> as the
<em>exponential</em> (of base e) of the input <strong>u</strong>:
</p>
<blockquote><pre>
y = <strong>exp</strong>( u );
</pre></blockquote>
</html>"));
      // balance: 2 unknowns (u, y), 1 input provided by connection, 1 equation
    end Exp;

    block Log "Output the logarithm (default base e) of the input (input > 0 required)"
      extends Modelica.Blocks.Interfaces.SISO;
      parameter Real base=Modelica.Constants.e "Base of logarithm" annotation (Evaluate=true);
    equation
      y = log(u)/log(base);
      annotation (
        Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
            Line(points={{-80,-80},{-80,68}}, color={192,192,192}),
            Polygon(
              points={{-80,90},{-88,68},{-72,68},{-80,90}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(
              points={{-80,-80},{-79.2,-50.6},{-78.4,-37},{-77.6,-28},{-76.8,-21.3},{-75.2,-11.4},{-72.8,-1.31},{-69.5,8.08},{-64.7,17.9},{-57.5,28},{-47,38.1},{-31.8,48.1},{-10.1,58},{22.1,68},{68.7,78.1},{80,80}},
              smooth=Smooth.Bezier),
            Line(points={{-90,0},{68,0}}, color={192,192,192}),
            Polygon(
              points={{90,0},{68,8},{68,-8},{90,0}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Text(
              extent={{-6,-24},{66,-72}},
              textColor={192,192,192},
              textString="log")}),
        Documentation(info="<html>
<p>
This blocks computes the output <strong>y</strong> as the
<em>logarithm</em> to the parameter <em>base</em> of the input <strong>u</strong>:
</p>
<blockquote><pre>
y = <strong>log</strong>( u ) / <strong>log</strong>( base );
</pre></blockquote>
<p>
An error occurs if the input <strong>u</strong> is
zero or negative.
</p>
</html>"));
      // balance: 2 unknowns (u, y), 1 input provided by connection, 1 equation
    end Log;

    block Max "Pass through the largest signal"
      extends Modelica.Blocks.Interfaces.SI2SO;
    equation
      y = max(u1, u2);
      annotation (Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Text(
              extent={{-90,36},{90,-36}},
              textColor={160,160,164},
              textString="max()")}), Documentation(info="<html>
<p>
This block computes the output <strong>y</strong> as <em>maximum</em>
of the two Real inputs <strong>u1</strong> and <strong>u2</strong>:
</p>
<blockquote><pre>
y = <strong>max</strong> ( u1 , u2 );
</pre></blockquote>
</html>"));
      // balance: 3 unknowns (u1, u2, y), 2 inputs provided by connection, 1 equation
    end Max;

    block Min "Pass through the smallest signal"
      extends Modelica.Blocks.Interfaces.SI2SO;
    equation
      y = min(u1, u2);
      annotation (Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Text(
              extent={{-90,36},{90,-36}},
              textColor={160,160,164},
              textString="min()")}), Documentation(info="<html>
<p>
This block computes the output <strong>y</strong> as <em>minimum</em> of
the two Real inputs <strong>u1</strong> and <strong>u2</strong>:
</p>
<blockquote><pre>
y = <strong>min</strong> ( u1 , u2 );
</pre></blockquote>
</html>"));
      // balance: 3 unknowns (u1, u2, y), 2 inputs provided by connection, 1 equation
    end Min;

    annotation (Documentation(info="<html>
<p>
This package contains basic <strong>mathematical operations</strong>,
such as summation and multiplication, and basic <strong>mathematical
functions</strong>, such as <strong>sqrt</strong> and <strong>sin</strong>, as
input/output blocks.
</p>
</html>"), Icon(graphics={Line(
            points={{-80,-2},{-68.7,32.2},{-61.5,51.1},{-55.1,64.4},{-49.4,72.6},{-43.8,77.1},{-38.2,77.8},{-32.6,74.6},{-26.9,67.7},{-21.3,57.4},{-14.9,42.1},{-6.83,19.2},{10.1,-32.8},{17.3,-52.2},{23.7,-66.2},{29.3,-75.1},{35,-80.4},{40.6,-82},{46.2,-79.6},{51.9,-73.5},{57.5,-63.9},{63.9,-49.2},{72,-26.8},{80,-2}},
            color={95,95,95},
            smooth=Smooth.Bezier)}));
  end Math;

  package Nonlinear "Library of discontinuous or non-differentiable algebraic control blocks"
    extends Modelica.Icons.Package;

    block Limiter "Limit the range of a signal"
      parameter Real uMax(start=1) "Upper limits of input signals";
      parameter Real uMin=-uMax "Lower limits of input signals";
      parameter Boolean strict=false "= true, if strict limits with noEvent(..)"
        annotation (Evaluate=true, choices(checkBox=true), Dialog(tab="Advanced"));
      extends Modelica.Blocks.Interfaces.SISO;
    equation
      assert(uMax >= uMin, "Limiter: Limits must be consistent. However, uMax < uMin");
      if strict then
        y = noEvent(if u > uMax then uMax else if u < uMin then uMin else u);
      else
        y = if u > uMax then uMax else if u < uMin then uMin else u;
      end if;
      annotation (
        Documentation(info="<html>
<p>
The Limiter block passes its input signal as output signal
as long as the input is within the specified upper and lower
limits. If this is not the case, the corresponding limits are passed
as output.
</p>
<p>
The homotopy-based initialization option of the Modelica Standard Library (parameter
homotopyType) is not available on this platform.
</p>
</html>"), Icon(coordinateSystem(
            preserveAspectRatio=true,
            extent={{-100,-100},{100,100}}), graphics={
            Line(points={{0,-90},{0,68}}, color={192,192,192}),
            Polygon(
              points={{0,90},{-8,68},{8,68},{0,90}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(points={{-90,0},{68,0}}, color={192,192,192}),
            Polygon(
              points={{90,0},{68,-8},{68,8},{90,0}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(points={{-80,-70},{-50,-70},{50,70},{80,70}}),
            Text(
              extent={{-150,-150},{150,-110}},
              textString="uMax=%uMax"),
            Line(
              visible=strict,
              points={{50,70},{80,70}},
              color={255,0,0}),
            Line(
              visible=strict,
              points={{-80,-70},{-50,-70}},
              color={255,0,0})}));
      // balance: 2 unknowns (u, y), 1 input provided by connection, 1 equation (one branch of the if-equation)
    end Limiter;

    block DeadZone "Provide a region of zero output"
      parameter Real uMax(start=1) "Upper limits of dead zones";
      parameter Real uMin=-uMax "Lower limits of dead zones";
      extends Modelica.Blocks.Interfaces.SISO;
    equation
      assert(uMax >= uMin, "DeadZone: Limits must be consistent. However, uMax < uMin");
      y = if u > uMax then u - uMax else if u < uMin then u - uMin else 0;
      annotation (
        Documentation(info="<html>
<p>
The DeadZone block defines a region of zero output.
</p>
<p>
If the input is within uMin ... uMax, the output
is zero. Outside of this zone, the output is a linear
function of the input with a slope of 1.
</p>
</html>"), Icon(coordinateSystem(
            preserveAspectRatio=true,
            extent={{-100,-100},{100,100}}), graphics={
            Line(points={{0,-90},{0,68}}, color={192,192,192}),
            Polygon(
              points={{0,90},{-8,68},{8,68},{0,90}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(points={{-90,0},{68,0}}, color={192,192,192}),
            Polygon(
              points={{90,0},{68,-8},{68,8},{90,0}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(points={{-80,-60},{-20,0},{20,0},{80,60}}),
            Text(
              extent={{-150,-150},{150,-110}},
              textColor={160,160,164},
              textString="uMax=%uMax")}));
      // balance: 2 unknowns (u, y), 1 input provided by connection, 1 equation
    end DeadZone;

    annotation (Documentation(info="<html>
<p>
This package contains <strong>discontinuous</strong> and
<strong>non-differentiable, algebraic</strong> input/output blocks.
</p>
</html>"), Icon(graphics={Line(points={{-80,-66},{-26,-66},{28,52},{88,52}},
              color={95,95,95})}));
  end Nonlinear;

  package Sources "Library of signal source blocks generating Real signals"
    extends Modelica.Icons.SourcesPackage;

    block Constant "Generate constant signal of type Real"
      parameter Real k(start=1) "Constant output value";
      extends Modelica.Blocks.Interfaces.SO;
    equation
      y = k;
      annotation (
        defaultComponentName="const",
        Icon(coordinateSystem(
            preserveAspectRatio=true,
            extent={{-100,-100},{100,100}}), graphics={
            Line(points={{-80,68},{-80,-80}}, color={192,192,192}),
            Polygon(
              points={{-80,90},{-88,68},{-72,68},{-80,90}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(points={{-90,-70},{82,-70}}, color={192,192,192}),
            Polygon(
              points={{90,-70},{68,-62},{68,-78},{90,-70}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(points={{-80,0},{80,0}}),
            Text(
              extent={{-150,-150},{150,-110}},
              textString="k=%k")}),
        Documentation(info="<html>
<p>
The Real output y is a constant signal.
</p>
</html>"));
      // balance: 1 unknown (y), 1 equation
    end Constant;

    block Step "Generate step signal of type Real"
      parameter Real height=1 "Height of step";
      extends Modelica.Blocks.Interfaces.SignalSource;
    equation
      y = offset + (if time < startTime then 0 else height);
      annotation (
        Icon(coordinateSystem(
            preserveAspectRatio=true,
            extent={{-100,-100},{100,100}}), graphics={
            Line(points={{-80,68},{-80,-80}}, color={192,192,192}),
            Polygon(
              points={{-80,90},{-88,68},{-72,68},{-80,90}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(points={{-90,-70},{82,-70}}, color={192,192,192}),
            Polygon(
              points={{90,-70},{68,-62},{68,-78},{90,-70}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(points={{-80,-70},{0,-70},{0,50},{80,50}}),
            Text(
              extent={{-150,-150},{150,-110}},
              textString="startTime=%startTime")}),
        Documentation(info="<html>
<p>
The Real output y is a step signal: y = offset for time &lt; startTime and y = offset + height afterwards.
</p>
</html>"));
      // balance: 1 unknown (y), 1 equation
    end Step;

    block Sine "Generate sine signal"
      parameter Real amplitude=1 "Amplitude of sine wave";
      parameter Modelica.Units.SI.Frequency f(start=1) "Frequency of sine wave";
      parameter Modelica.Units.SI.Angle phase=0 "Phase of sine wave";
      extends Modelica.Blocks.Interfaces.SignalSource;
    equation
      y = offset + (if time < startTime then 0 else amplitude*sin(2*Modelica.Constants.pi*f*(time - startTime) + phase));
      annotation (
        Icon(coordinateSystem(
            preserveAspectRatio=true,
            extent={{-100,-100},{100,100}}), graphics={
            Line(points={{-80,68},{-80,-80}}, color={192,192,192}),
            Polygon(
              points={{-80,90},{-88,68},{-72,68},{-80,90}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(points={{-90,0},{68,0}}, color={192,192,192}),
            Polygon(
              points={{90,0},{68,8},{68,-8},{90,0}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(points={{-80,0},{-68.7,34.2},{-61.5,53.1},{-55.1,66.4},{-49.4,74.6},{-43.8,79.1},{-38.2,79.8},{-32.6,76.6},{-26.9,69.7},{-21.3,59.4},{-14.9,44.1},{-6.83,21.2},{10.1,-30.8},{17.3,-50.2},{23.7,-64.2},{29.3,-73.1},{35,-78.4},{40.6,-80},{46.2,-77.6},{51.9,-71.5},{57.5,-61.9},{63.9,-47.2},{72,-24.8},{80,0}}, smooth=Smooth.Bezier),
            Text(
              extent={{-147,-152},{153,-112}},
              textString="f=%f")}),
        Documentation(info="<html>
<p>
The Real output y is a sine signal:
</p>
<blockquote><pre>
y = offset + amplitude*sin(2*pi*f*(time - startTime) + phase)   for time &gt;= startTime
</pre></blockquote>
</html>"));
      // balance: 1 unknown (y), 1 equation
    end Sine;

    block Cosine "Generate cosine signal"
      parameter Real amplitude=1 "Amplitude of cosine wave";
      parameter Modelica.Units.SI.Frequency f(start=1) "Frequency of cosine wave";
      parameter Modelica.Units.SI.Angle phase=0 "Phase of cosine wave";
      extends Modelica.Blocks.Interfaces.SignalSource;
    equation
      y = offset + (if time < startTime then 0 else amplitude*cos(2*Modelica.Constants.pi*f*(time - startTime) + phase));
      annotation (
        Icon(coordinateSystem(
            preserveAspectRatio=true,
            extent={{-100,-100},{100,100}}), graphics={
            Line(points={{-80,68},{-80,-80}}, color={192,192,192}),
            Polygon(
              points={{-80,90},{-88,68},{-72,68},{-80,90}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(points={{-90,0},{68,0}}, color={192,192,192}),
            Polygon(
              points={{90,0},{68,8},{68,-8},{90,0}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(points={{-80,80},{-76.2,79.8},{-70.6,76.6},{-64.9,69.7},{-59.3,59.4},{-52.9,44.1},{-44.83,21.2},{-27.9,-30.8},{-20.7,-50.2},{-14.3,-64.2},{-8.7,-73.1},{-3,-78.4},{2.6,-80},{8.2,-77.6},{13.9,-71.5},{19.5,-61.9},{25.9,-47.2},{34,-24.8},{42,0},{53.3,35.2},{60.5,54.1},{66.9,67.4},{72.6,75.6},{78.2,80.1},{83.8,80.8}}, smooth=Smooth.Bezier),
            Text(
              extent={{-147,-152},{153,-112}},
              textString="f=%f")}),
        Documentation(info="<html>
<p>
The Real output y is a cosine signal:
</p>
<blockquote><pre>
y = offset + amplitude*cos(2*pi*f*(time - startTime) + phase)   for time &gt;= startTime
</pre></blockquote>
</html>"));
      // balance: 1 unknown (y), 1 equation
    end Cosine;

    block Ramp "Generate ramp signal"
      parameter Real height=1 "Height of ramp";
      parameter Modelica.Units.SI.Time duration(min=0.0, start=2) "Duration of ramp (= 0.0 gives a Step)";
      extends Modelica.Blocks.Interfaces.SignalSource;
    equation
      y = offset + (if time < startTime then 0 else if time < (startTime + duration) then (time - startTime)*height/duration else height);
      annotation (
        Icon(coordinateSystem(
            preserveAspectRatio=true,
            extent={{-100,-100},{100,100}}), graphics={
            Line(points={{-80,68},{-80,-80}}, color={192,192,192}),
            Polygon(
              points={{-80,90},{-88,68},{-72,68},{-80,90}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(points={{-90,-70},{82,-70}}, color={192,192,192}),
            Polygon(
              points={{90,-70},{68,-62},{68,-78},{90,-70}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(points={{-80,-70},{-40,-70},{31,38},{86,38}}),
            Text(
              extent={{-150,-150},{150,-110}},
              textString="duration=%duration")}),
        Documentation(info="<html>
<p>
The Real output y is a ramp signal: starting at startTime it rises linearly from offset
to offset + height within the time duration and stays constant afterwards.
</p>
<p>
If parameter duration is set to 0.0, the limiting case of a Step signal is achieved.
</p>
</html>"));
      // balance: 1 unknown (y), 1 equation
    end Ramp;

    block ExpSine "Generate exponentially damped sine signal"
      parameter Real amplitude=1 "Amplitude of sine wave";
      parameter Modelica.Units.SI.Frequency f(start=2) "Frequency of sine wave";
      parameter Modelica.Units.SI.Angle phase=0 "Phase of sine wave";
      parameter Modelica.Units.SI.Damping damping(start=1) "Damping coefficient of sine wave";
      extends Modelica.Blocks.Interfaces.SignalSource;
    equation
      y = offset + (if time < startTime then 0 else amplitude*exp(-(time - startTime)*damping)*sin(2*Modelica.Constants.pi*f*(time - startTime) + phase));
      annotation (
        Icon(coordinateSystem(
            preserveAspectRatio=true,
            extent={{-100,-100},{100,100}}), graphics={
            Line(points={{-80,68},{-80,-80}}, color={192,192,192}),
            Polygon(
              points={{-80,90},{-88,68},{-72,68},{-80,90}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(points={{-90,0},{68,0}}, color={192,192,192}),
            Polygon(
              points={{90,0},{68,8},{68,-8},{90,0}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(points={{-80,0},{-75.2,32.3},{-72,50.3},{-68.7,64.5},{-65.5,74.2},{-62.3,79.3},{-59.1,79.6},{-55.9,75.3},{-52.7,67.1},{-48.6,52.2},{-43,25.8},{-35,-13.9},{-30.2,-33.7},{-26.1,-45.9},{-22.1,-53.2},{-18.1,-55.3},{-14.1,-52.5},{-10.1,-45.3},{-5.23,-32.1},{8.44,13.7},{13.3,26.4},{18.1,34.8},{22.1,38},{26.9,37.2},{31.8,31.8},{38.2,19.4},{51.1,-10.5},{57.5,-21.2},{63.1,-25.9},{68.7,-25.9},{75.2,-20.5},{80,-13.8}}, smooth=Smooth.Bezier),
            Text(
              extent={{-147,-152},{153,-112}},
              textString="f=%f")}),
        Documentation(info="<html>
<p>
The Real output y is a sine signal with exponentially changing amplitude:
</p>
<blockquote><pre>
y = offset + amplitude*exp(-damping*(time - startTime))*sin(2*pi*f*(time - startTime) + phase)
</pre></blockquote>
</html>"));
      // balance: 1 unknown (y), 1 equation
    end ExpSine;

    block Pulse "Generate pulse signal of type Real"
      parameter Real amplitude=1 "Amplitude of pulse";
      parameter Real width(final min=Modelica.Constants.small, final max=100) = 50 "Width of pulse in % of period";
      parameter Modelica.Units.SI.Time period(final min=Modelica.Constants.small, start=1) "Time for one period";
      parameter Integer nperiod=-1 "Number of periods (< 0 means infinite number of periods)";
      extends Modelica.Blocks.Interfaces.SignalSource;
    protected
      parameter Modelica.Units.SI.Time T_width=period*width/100 "Width of one pulse";
    equation
      y = offset + (if time < startTime or nperiod == 0 or (nperiod > 0 and time >= startTime + nperiod*period) then 0
        else if mod(time - startTime, period) < T_width then amplitude else 0);
      annotation (
        Icon(coordinateSystem(
            preserveAspectRatio=true,
            extent={{-100,-100},{100,100}}), graphics={
            Line(points={{-80,68},{-80,-80}}, color={192,192,192}),
            Polygon(
              points={{-80,90},{-88,68},{-72,68},{-80,90}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(points={{-90,-70},{82,-70}}, color={192,192,192}),
            Polygon(
              points={{90,-70},{68,-62},{68,-78},{90,-70}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(points={{-80,-70},{-40,-70},{-40,44},{0,44},{0,-70},{40,-70},{40,44},{79,44}}),
            Text(
              extent={{-147,-152},{153,-112}},
              textString="period=%period")}),
        Documentation(info="<html>
<p>
The Real output y is a pulse signal with the given amplitude, period and width (in % of the period).
The signal is computed with the mod() function instead of the time events of the
Modelica Standard Library implementation.
</p>
</html>"));
      // balance: 1 unknown (y), 1 equation
    end Pulse;

    block SawTooth "Generate saw tooth signal"
      parameter Real amplitude=1 "Amplitude of saw tooth";
      parameter Modelica.Units.SI.Time period(final min=Modelica.Constants.small, start=1) "Time for one period";
      parameter Integer nperiod=-1 "Number of periods (< 0 means infinite number of periods)";
      extends Modelica.Blocks.Interfaces.SignalSource;
    equation
      y = offset + (if time < startTime or nperiod == 0 or (nperiod > 0 and time >= startTime + nperiod*period) then 0
        else amplitude*mod(time - startTime, period)/period);
      annotation (
        Icon(coordinateSystem(
            preserveAspectRatio=true,
            extent={{-100,-100},{100,100}}), graphics={
            Line(points={{-80,68},{-80,-80}}, color={192,192,192}),
            Polygon(
              points={{-80,90},{-88,68},{-72,68},{-80,90}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(points={{-90,-70},{82,-70}}, color={192,192,192}),
            Polygon(
              points={{90,-70},{68,-62},{68,-78},{90,-70}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(points={{-80,-70},{-60,-70},{0,40},{0,-70},{60,41},{60,-70}}),
            Text(
              extent={{-147,-152},{153,-112}},
              textString="period=%period")}),
        Documentation(info="<html>
<p>
The Real output y is a saw tooth signal rising linearly from offset to offset + amplitude
within one period. The signal is computed with the mod() function instead of the time
events of the Modelica Standard Library implementation.
</p>
</html>"));
      // balance: 1 unknown (y), 1 equation
    end SawTooth;

    block Trapezoid "Generate trapezoidal signal of type Real"
      parameter Real amplitude=1 "Amplitude of trapezoid";
      parameter Modelica.Units.SI.Time rising(final min=0) = 0 "Rising duration of trapezoid";
      parameter Modelica.Units.SI.Time width(final min=0) = 0.5 "Width duration of trapezoid";
      parameter Modelica.Units.SI.Time falling(final min=0) = 0 "Falling duration of trapezoid";
      parameter Modelica.Units.SI.Time period(final min=Modelica.Constants.small, start=1) "Time for one period";
      parameter Integer nperiod=-1 "Number of periods (< 0 means infinite number of periods)";
      extends Modelica.Blocks.Interfaces.SignalSource;
    protected
      parameter Modelica.Units.SI.Time T_rising=rising "End time of rising phase within one period";
      parameter Modelica.Units.SI.Time T_width=T_rising + width "End time of width phase within one period";
      parameter Modelica.Units.SI.Time T_falling=T_width + falling "End time of falling phase within one period";
      Modelica.Units.SI.Time t_period "Time since start of the current period";
    equation
      t_period = mod(time - startTime, period);
      y = offset + (if time < startTime or nperiod == 0 or (nperiod > 0 and time >= startTime + nperiod*period) then 0
        else if t_period < T_rising then amplitude*t_period/rising
        else if t_period < T_width then amplitude
        else if t_period < T_falling then amplitude*(T_falling - t_period)/falling else 0);
      annotation (
        Icon(coordinateSystem(
            preserveAspectRatio=true,
            extent={{-100,-100},{100,100}}), graphics={
            Line(points={{-80,68},{-80,-80}}, color={192,192,192}),
            Polygon(
              points={{-80,90},{-88,68},{-72,68},{-80,90}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Line(points={{-90,-70},{82,-70}}, color={192,192,192}),
            Polygon(
              points={{90,-70},{68,-62},{68,-78},{90,-70}},
              lineColor={192,192,192},
              fillColor={192,192,192},
              fillPattern=FillPattern.Solid),
            Text(
              extent={{-147,-152},{153,-112}},
              textString="period=%period"),
            Line(points={{-81,-70},{-60,-70},{-30,40},{9,40},{39,-70},{61,-70},{90,40}})}),
        Documentation(info="<html>
<p>
The Real output y is a trapezoid signal (rising, width, falling phases repeated every period).
The signal is computed with the mod() function instead of the time events of the
Modelica Standard Library implementation.
</p>
</html>"));
      // balance: 2 unknowns (y, t_period), 2 equations
    end Trapezoid;

    block ContinuousClock "Generate current time signal"
      extends Modelica.Blocks.Interfaces.SignalSource;
    equation
      y = offset + (if time < startTime then 0 else time - startTime);
      annotation (
        Icon(coordinateSystem(
            preserveAspectRatio=true,
            extent={{-100,-100},{100,100}}), graphics={
            Ellipse(extent={{-80,80},{80,-80}}, lineColor={160,160,164}),
            Line(points={{0,80},{0,60}}, color={160,160,164}),
            Line(points={{80,0},{60,0}}, color={160,160,164}),
            Line(points={{0,-80},{0,-60}}, color={160,160,164}),
            Line(points={{-80,0},{-60,0}}, color={160,160,164}),
            Line(points={{37,70},{26,50}}, color={160,160,164}),
            Line(points={{70,38},{49,26}}, color={160,160,164}),
            Line(points={{71,-37},{52,-27}}, color={160,160,164}),
            Line(points={{39,-70},{29,-51}}, color={160,160,164}),
            Line(points={{-39,-70},{-29,-52}}, color={160,160,164}),
            Line(points={{-71,-37},{-50,-26}}, color={160,160,164}),
            Line(points={{-71,37},{-54,28}}, color={160,160,164}),
            Line(points={{-38,70},{-28,51}}, color={160,160,164}),
            Line(
              points={{0,0},{-50,50}},
              thickness=0.5),
            Line(
              points={{0,0},{40,0}},
              thickness=0.5),
            Text(
              extent={{-150,-150},{150,-110}},
              textString="startTime=%startTime")}),
        Documentation(info="<html>
<p>
The Real output y is a clock signal: y = offset + (time - startTime) for time &gt;= startTime.
</p>
</html>"));
      // balance: 1 unknown (y), 1 equation
    end ContinuousClock;

    block Clock "Generate current time signal (MSL 3 name of ContinuousClock)"
      extends Modelica.Blocks.Sources.ContinuousClock;
      annotation (Documentation(info="<html>
<p>
Compatibility alias for <a href=\"modelica://Modelica.Blocks.Sources.ContinuousClock\">ContinuousClock</a>
(the block was called Clock up to MSL 3.2.3).
</p>
</html>"));
      // balance: 1 unknown (y), 1 equation (inherited)
    end Clock;

    annotation (Documentation(info="<html>
<p>
This package contains <strong>source</strong> components, i.e., blocks which
have only output signals. These blocks are used as signal generators
for Real signals.
</p>
<p>
All Real source signals (with the exception of the Constant source)
have at least the following two parameters:
</p>
<table border=\"1\" cellspacing=\"0\" cellpadding=\"2\">
  <tr><td><strong>offset</strong></td>
      <td>Value which is added to the signal</td>
  </tr>
  <tr><td><strong>startTime</strong></td>
      <td>Start time of signal. For time &lt; startTime,
                the output y is set to offset.</td>
  </tr>
</table>
</html>"));
  end Sources;

  package Types "Library of constants and types with choices, especially to build menus"
    extends Modelica.Icons.TypesPackage;

    type Init = enumeration(
        NoInit "No initialization (start values are used as guess values with fixed=false)",
        SteadyState "Steady state initialization (derivatives of states are zero)",
        InitialState "Initialization with initial states",
        InitialOutput "Initialization with initial outputs (and steady state of the states if possible)")
      "Enumeration defining initialization of a block" annotation (Evaluate=true,
      Documentation(info="<html>
  <p>The following initialization alternatives are available:</p>
  <dl>
    <dt><code><strong>NoInit</strong></code></dt>
      <dd>No initialization (start values are used as guess values with <code>fixed=false</code>)</dd>
    <dt><code><strong>SteadyState</strong></code></dt>
      <dd>Steady state initialization (derivatives of states are zero)</dd>
    <dt><code><strong>InitialState</strong></code></dt>
      <dd>Initialization with initial states</dd>
    <dt><code><strong>InitialOutput</strong></code></dt>
      <dd>Initialization with initial outputs (and steady state of the states if possible)</dd>
  </dl>
</html>"));

    type SimpleController = enumeration(
        P "P controller",
        PI "PI controller",
        PD "PD controller",
        PID "PID controller")
      "Enumeration defining P, PI, PD, or PID simple controller type" annotation (Evaluate=true);

    annotation (Documentation(info="<html>
<p>
In this package <strong>types</strong> and <strong>constants</strong> are defined that are used
in library Modelica.Blocks. The types have additional annotation choices
definitions that define the menus to be built up in the graphical
user interface when the type is used as parameter in a declaration.
</p>
</html>"));
  end Types;

  package Icons "Icons for Blocks"
    extends Modelica.Icons.IconsPackage;

    partial block Block "Basic graphical layout of input/output block"
      annotation (
        Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Rectangle(
              extent={{-100,-100},{100,100}},
              lineColor={0,0,127},
              fillColor={255,255,255},
              fillPattern=FillPattern.Solid), Text(
              extent={{-150,150},{150,110}},
              textString="%name",
              textColor={0,0,255})}),
        Documentation(info="<html>
<p>
Block that has only the basic icon for an input/output
block (no declarations, no equations). Most blocks
of package Modelica.Blocks inherit directly or indirectly
from this block.
</p>
</html>"));
    end Block;

    partial block BooleanBlock "Basic graphical layout of Boolean block"
      annotation (
        Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Rectangle(
              extent={{-100,-100},{100,100}},
              lineColor={255,0,255},
              fillColor={255,255,255},
              fillPattern=FillPattern.Solid), Text(
              extent={{-150,150},{150,110}},
              textString="%name",
              textColor={0,0,255})}),
        Documentation(info="<html>
<p>
Block that has only the basic icon for an input/output,
Boolean block (no declarations, no equations).
</p>
</html>"));
    end BooleanBlock;
  end Icons;

  annotation (Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100.0,-100.0},{100.0,100.0}}), graphics={
        Rectangle(
          origin={0.0,35.1488},
          fillColor={255,255,255},
          extent={{-30.0,-20.1488},{30.0,20.1488}}),
        Rectangle(
          origin={0.0,-34.8512},
          fillColor={255,255,255},
          extent={{-30.0,-20.1488},{30.0,20.1488}}),
        Line(
          origin={-51.25,0.0},
          points={{21.25,-35.0},{-13.75,-35.0},{-13.75,35.0},{6.25,35.0}}),
        Polygon(
          origin={-40.0,35.0},
          pattern=LinePattern.None,
          fillPattern=FillPattern.Solid,
          points={{10.0,0.0},{-5.0,5.0},{-5.0,-5.0}}),
        Line(
          origin={51.25,0.0},
          points={{-21.25,35.0},{13.75,35.0},{13.75,-35.0},{-6.25,-35.0}}),
        Polygon(
          origin={40.0,-35.0},
          pattern=LinePattern.None,
          fillPattern=FillPattern.Solid,
          points={{-10.0,0.0},{5.0,5.0},{5.0,-5.0}})}), Documentation(info="<html>
<p>
This library contains input/output blocks to build up block diagrams.
</p>
<p>
Copyright &copy; 1998-2020, Modelica Association and contributors
</p>
</html>"));
end Blocks;
