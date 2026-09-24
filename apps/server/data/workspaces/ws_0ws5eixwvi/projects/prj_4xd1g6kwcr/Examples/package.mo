within ;
package Examples "Example models"
  extends Modelica.Icons.ExamplesPackage;

  model RCCircuit "RC low-pass circuit charged by a step voltage"
    extends Modelica.Icons.Example;
    Modelica.Electrical.Analog.Sources.StepVoltage stepVoltage(V=5, startTime=0.5) "5 V step at t = 0.5 s"
      annotation (Placement(transformation(
          origin={-60,0},
          extent={{-10,-10},{10,10}},
          rotation=270)));
    Modelica.Electrical.Analog.Basic.Resistor resistor(R=1000) "1 kOhm"
      annotation (Placement(transformation(extent={{-30,30},{-10,50}})));
    Modelica.Electrical.Analog.Basic.Capacitor capacitor(C=1e-3, v(start=0, fixed=true)) "1 mF, initially discharged"
      annotation (Placement(transformation(
          origin={20,0},
          extent={{-10,-10},{10,10}},
          rotation=270)));
    Modelica.Electrical.Analog.Basic.Ground ground
      annotation (Placement(transformation(extent={{-10,-60},{10,-40}})));
  equation
    connect(stepVoltage.p, resistor.p) annotation (Line(points={{-60,10},{-60,40},{-30,40}}, color={0,0,255}));
    connect(resistor.n, capacitor.p) annotation (Line(points={{-10,40},{20,40},{20,10}}, color={0,0,255}));
    connect(capacitor.n, ground.p) annotation (Line(points={{20,-10},{20,-40},{0,-40}}, color={0,0,255}));
    connect(stepVoltage.n, ground.p) annotation (Line(points={{-60,-10},{-60,-40},{0,-40}}, color={0,0,255}));
    annotation (
      experiment(StopTime=5, Interval=0.005),
      Diagram(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}})),
      Documentation(info="<html>
<p>
A first order RC low-pass filter: the capacitor is charged through the resistor after the
voltage source steps from 0 V to 5 V at t = 0.5 s. The time constant is R*C = 1 s.
</p>
<p>Plot <code>capacitor.v</code> and <code>resistor.i</code>.</p>
</html>"));
    // balance: 23 unknowns (stepVoltage 6, resistor 9, capacitor 6, ground 2), 23 equations
    // (16 component equations + 7 connection equations from 3 connection sets with 7 pins)
  end RCCircuit;

  model RLCCircuit "Series RLC resonance circuit driven by a sine voltage"
    extends Modelica.Icons.Example;
    Modelica.Electrical.Analog.Sources.SineVoltage sineVoltage(V=10, f=50) "10 V, 50 Hz"
      annotation (Placement(transformation(
          origin={-70,0},
          extent={{-10,-10},{10,10}},
          rotation=270)));
    Modelica.Electrical.Analog.Basic.Resistor resistor(R=10)
      annotation (Placement(transformation(extent={{-50,30},{-30,50}})));
    Modelica.Electrical.Analog.Basic.Inductor inductor(L=0.1, i(start=0, fixed=true))
      annotation (Placement(transformation(extent={{-10,30},{10,50}})));
    Modelica.Electrical.Analog.Sensors.CurrentSensor currentSensor
      annotation (Placement(transformation(extent={{30,50},{50,30}})));
    Modelica.Electrical.Analog.Basic.Capacitor capacitor(C=100e-6, v(start=0, fixed=true))
      annotation (Placement(transformation(
          origin={70,0},
          extent={{-10,-10},{10,10}},
          rotation=270)));
    Modelica.Electrical.Analog.Basic.Ground ground
      annotation (Placement(transformation(extent={{-10,-60},{10,-40}})));
  equation
    connect(sineVoltage.p, resistor.p) annotation (Line(points={{-70,10},{-70,40},{-50,40}}, color={0,0,255}));
    connect(resistor.n, inductor.p) annotation (Line(points={{-30,40},{-10,40}}, color={0,0,255}));
    connect(inductor.n, currentSensor.p) annotation (Line(points={{10,40},{30,40}}, color={0,0,255}));
    connect(currentSensor.n, capacitor.p) annotation (Line(points={{50,40},{70,40},{70,10}}, color={0,0,255}));
    connect(capacitor.n, ground.p) annotation (Line(points={{70,-10},{70,-40},{0,-40}}, color={0,0,255}));
    connect(sineVoltage.n, ground.p) annotation (Line(points={{-70,-10},{-70,-40},{0,-40}}, color={0,0,255}));
    annotation (
      experiment(StopTime=0.2, Interval=1e-4),
      Diagram(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}})),
      Documentation(info="<html>
<p>
Series RLC circuit. With L = 0.1 H and C = 100 &micro;F the resonance frequency is
1/(2*pi*sqrt(L*C)) &asymp; 50.3 Hz, i.e. the circuit is driven close to resonance and the current
builds up over several periods (quality factor sqrt(L/C)/R &asymp; 3.2).
</p>
<p>Plot <code>currentSensor.i</code> and <code>capacitor.v</code>.</p>
</html>"));
    // balance: 34 unknowns (sineVoltage 6, resistor 9, inductor 6, currentSensor 5, capacitor 6, ground 2),
    // 34 equations (23 component equations + 11 connection equations from 5 connection sets with 11 pins)
  end RLCCircuit;

  model MassSpringDamper "Mass-spring-damper system excited by a step force"
    extends Modelica.Icons.Example;
    Modelica.Blocks.Sources.Step step(height=10, startTime=0.5) "Force step of 10 N"
      annotation (Placement(transformation(extent={{-90,-10},{-70,10}})));
    Modelica.Mechanics.Translational.Sources.Force force
      annotation (Placement(transformation(extent={{-60,-10},{-40,10}})));
    Modelica.Mechanics.Translational.Components.Mass mass(
      m=1,
      s(start=0, fixed=true),
      v(start=0, fixed=true))
      annotation (Placement(transformation(extent={{-20,-10},{0,10}})));
    Modelica.Mechanics.Translational.Components.Spring spring(c=100)
      annotation (Placement(transformation(extent={{20,10},{40,30}})));
    Modelica.Mechanics.Translational.Components.Damper damper(d=2)
      annotation (Placement(transformation(extent={{20,-30},{40,-10}})));
    Modelica.Mechanics.Translational.Components.Fixed fixed
      annotation (Placement(transformation(extent={{50,-10},{70,10}})));
  equation
    connect(step.y, force.f) annotation (Line(points={{-69,0},{-62,0}}, color={0,0,127}));
    connect(force.flange, mass.flange_a) annotation (Line(points={{-40,0},{-20,0}}, color={0,127,0}));
    connect(mass.flange_b, spring.flange_a) annotation (Line(points={{0,0},{10,0},{10,20},{20,20}}, color={0,127,0}));
    connect(mass.flange_b, damper.flange_a) annotation (Line(points={{0,0},{10,0},{10,-20},{20,-20}}, color={0,127,0}));
    connect(spring.flange_b, fixed.flange) annotation (Line(points={{40,20},{50,20},{50,0},{60,0}}, color={0,127,0}));
    connect(damper.flange_b, fixed.flange) annotation (Line(points={{40,-20},{50,-20},{50,0},{60,0}}, color={0,127,0}));
    annotation (
      experiment(StopTime=5, Interval=0.005),
      Diagram(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}})),
      Documentation(info="<html>
<p>
A sliding mass (m = 1 kg) attached to the housing by a spring (c = 100 N/m) and a damper
(d = 2 N.s/m) is pushed by a force step of 10 N at t = 0.5 s. The undamped natural frequency is
sqrt(c/m) = 10 rad/s and the damping ratio d/(2*sqrt(c*m)) = 0.1, so the mass oscillates around
its new equilibrium position of 0.1 m.
</p>
<p>Plot <code>mass.s</code>, <code>mass.v</code> and <code>spring.f</code>.</p>
</html>"));
    // balance: 29 unknowns (step 1, force 5, mass 7, spring 6, damper 8, fixed 2), 29 equations
    // (20 component equations + 1 signal connection + 8 flange connection equations from 3 sets with 8 flanges)
  end MassSpringDamper;

  model RotationalDrive "Two inertias coupled by a spring-damper and driven by a sine torque"
    extends Modelica.Icons.Example;
    Modelica.Blocks.Sources.Sine sine(amplitude=10, f=1) "Driving torque, 10 N.m at 1 Hz"
      annotation (Placement(transformation(extent={{-90,-10},{-70,10}})));
    Modelica.Mechanics.Rotational.Sources.Torque torque
      annotation (Placement(transformation(extent={{-60,-10},{-40,10}})));
    Modelica.Mechanics.Rotational.Components.Inertia inertia1(
      J=1,
      phi(start=0, fixed=true),
      w(start=0, fixed=true))
      annotation (Placement(transformation(extent={{-30,-10},{-10,10}})));
    Modelica.Mechanics.Rotational.Components.SpringDamper springDamper(
      c=100,
      d=5,
      phi_rel(start=0, fixed=true),
      w_rel(start=0, fixed=true))
      annotation (Placement(transformation(extent={{0,-10},{20,10}})));
    Modelica.Mechanics.Rotational.Components.Inertia inertia2(J=2)
      annotation (Placement(transformation(extent={{30,-10},{50,10}})));
    Modelica.Mechanics.Rotational.Components.Damper bearing(d=1) "Bearing friction of the load"
      annotation (Placement(transformation(extent={{60,-10},{80,10}})));
    Modelica.Mechanics.Rotational.Components.Fixed fixed
      annotation (Placement(transformation(extent={{80,-10},{100,10}})));
  equation
    connect(sine.y, torque.tau) annotation (Line(points={{-69,0},{-62,0}}, color={0,0,127}));
    connect(torque.flange, inertia1.flange_a) annotation (Line(points={{-40,0},{-30,0}}, color={95,95,95}));
    connect(inertia1.flange_b, springDamper.flange_a) annotation (Line(points={{-10,0},{0,0}}, color={95,95,95}));
    connect(springDamper.flange_b, inertia2.flange_a) annotation (Line(points={{20,0},{30,0}}, color={95,95,95}));
    connect(inertia2.flange_b, bearing.flange_a) annotation (Line(points={{50,0},{60,0}}, color={95,95,95}));
    connect(bearing.flange_b, fixed.flange) annotation (Line(points={{80,0},{90,0}}, color={95,95,95}));
    annotation (
      experiment(StopTime=10, Interval=0.01),
      Diagram(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}})),
      Documentation(info="<html>
<p>
A motor inertia (J = 1 kg.m2) is driven by a sinusoidal torque and coupled through an elastic
shaft (spring-damper, c = 100 N.m/rad, d = 5 N.m.s/rad) to a load inertia (J = 2 kg.m2) that
runs in a viscous bearing (d = 1 N.m.s/rad).
</p>
<p>Plot <code>inertia1.w</code>, <code>inertia2.w</code> and <code>springDamper.tau</code>.</p>
</html>"));
    // balance: 41 unknowns (sine 1, torque 4, inertia1 7, springDamper 11, inertia2 7, bearing 9, fixed 2),
    // 41 equations (30 component equations + 1 signal connection + 10 flange connection equations from 5 sets)
  end RotationalDrive;

  model PIDControlledMotor "DC motor with PI speed control"
    extends Modelica.Icons.Example;
    Modelica.Blocks.Sources.Step reference(height=10, startTime=0.5) "Speed reference: 10 rad/s"
      annotation (Placement(transformation(extent={{-100,-60},{-80,-40}})));
    Modelica.Blocks.Math.Feedback feedback
      annotation (Placement(transformation(extent={{-70,-60},{-50,-40}})));
    Modelica.Blocks.Continuous.PI controller(k=5, T=0.05) "PI speed controller"
      annotation (Placement(transformation(extent={{-40,-60},{-20,-40}})));
    Modelica.Electrical.Analog.Sources.SignalVoltage signalVoltage
      annotation (Placement(transformation(
          origin={-70,50},
          extent={{-10,-10},{10,10}},
          rotation=270)));
    Modelica.Electrical.Analog.Basic.Resistor Ra(R=1) "Armature resistance"
      annotation (Placement(transformation(extent={{-50,70},{-30,90}})));
    Modelica.Electrical.Analog.Basic.Inductor La(L=1e-3, i(start=0, fixed=true)) "Armature inductance"
      annotation (Placement(transformation(extent={{-20,70},{0,90}})));
    Modelica.Electrical.Analog.Basic.RotationalEMF emf(k=0.5)
      annotation (Placement(transformation(extent={{-10,30},{10,50}})));
    Modelica.Electrical.Analog.Basic.Ground ground
      annotation (Placement(transformation(extent={{-40,-10},{-20,10}})));
    Modelica.Mechanics.Rotational.Components.Inertia inertia(
      J=0.01,
      phi(start=0, fixed=true),
      w(start=0, fixed=true)) "Rotor and load inertia"
      annotation (Placement(transformation(extent={{20,30},{40,50}})));
    Modelica.Mechanics.Rotational.Components.Damper bearing(d=0.01) "Viscous load"
      annotation (Placement(transformation(extent={{50,30},{70,50}})));
    Modelica.Mechanics.Rotational.Components.Fixed fixed
      annotation (Placement(transformation(extent={{70,30},{90,50}})));
    Modelica.Mechanics.Rotational.Sensors.SpeedSensor speedSensor
      annotation (Placement(transformation(
          origin={50,10},
          extent={{-10,-10},{10,10}},
          rotation=270)));
  equation
    connect(reference.y, feedback.u1) annotation (Line(points={{-79,-50},{-68,-50}}, color={0,0,127}));
    connect(feedback.y, controller.u) annotation (Line(points={{-51,-50},{-42,-50}}, color={0,0,127}));
    connect(controller.y, signalVoltage.v) annotation (Line(points={{-19,-50},{-10,-50},{-10,-30},{-50,-30},{-50,50},{-58,50}}, color={0,0,127}));
    connect(speedSensor.w, feedback.u2) annotation (Line(points={{50,-1},{50,-80},{-60,-80},{-60,-58}}, color={0,0,127}));
    connect(signalVoltage.p, Ra.p) annotation (Line(points={{-70,60},{-70,80},{-50,80}}, color={0,0,255}));
    connect(Ra.n, La.p) annotation (Line(points={{-30,80},{-20,80}}, color={0,0,255}));
    connect(La.n, emf.p) annotation (Line(points={{0,80},{0,50}}, color={0,0,255}));
    connect(emf.n, ground.p) annotation (Line(points={{0,30},{0,10},{-30,10}}, color={0,0,255}));
    connect(signalVoltage.n, ground.p) annotation (Line(points={{-70,40},{-70,10},{-30,10}}, color={0,0,255}));
    connect(emf.flange, inertia.flange_a) annotation (Line(points={{10,40},{20,40}}, color={95,95,95}));
    connect(inertia.flange_b, bearing.flange_a) annotation (Line(points={{40,40},{50,40}}, color={95,95,95}));
    connect(speedSensor.flange, bearing.flange_a) annotation (Line(points={{50,20},{50,40}}, color={95,95,95}));
    connect(bearing.flange_b, fixed.flange) annotation (Line(points={{70,40},{80,40}}, color={95,95,95}));
    annotation (
      experiment(StopTime=2, Interval=0.001),
      Diagram(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
          Text(
            extent={{-100,-84},{-20,-90}},
            textColor={255,0,0},
            textString="PI speed controller"),
          Text(
            extent={{-60,98},{60,92}},
            textColor={255,0,0},
            textString="DC motor (armature circuit + EMF) with viscous load")}),
      Documentation(info="<html>
<p>
Speed control of a permanent-magnet DC motor. The armature circuit (Ra = 1 Ohm, La = 1 mH) is
fed by a controlled voltage source, the electromotoric force (k = 0.5 N.m/A) converts the
electrical power into mechanical power that accelerates the rotor inertia (J = 0.01 kg.m2)
against a viscous bearing load (d = 0.01 N.m.s/rad). A PI controller (k = 5, T = 0.05 s)
compares the measured speed with the reference step of 10 rad/s at t = 0.5 s.
</p>
<p>Plot <code>inertia.w</code> together with <code>reference.y</code>, and <code>emf.i</code>.</p>
</html>"));
    // balance: 64 unknowns (reference 1, feedback 3, controller 3, signalVoltage 6, Ra 9, La 6, emf 13, ground 2,
    // inertia 7, bearing 9, fixed 2, speedSensor 3), 64 equations (44 component equations + 4 signal connections
    // + 9 pin connection equations from 4 electrical sets + 7 flange connection equations from 3 mechanical sets)
  end PIDControlledMotor;

  model HeatedRoom "Room heated by a prescribed heat flow and losing heat through a wall"
    extends Modelica.Icons.Example;
    Modelica.Blocks.Sources.Step heating(height=1000, startTime=3600) "Heater switched on after one hour (1 kW)"
      annotation (Placement(transformation(extent={{-100,-10},{-80,10}})));
    Modelica.Thermal.HeatTransfer.Sources.PrescribedHeatFlow heater
      annotation (Placement(transformation(extent={{-70,-10},{-50,10}})));
    Modelica.Thermal.HeatTransfer.Components.HeatCapacitor room(C=5e5, T(start=283.15, fixed=true)) "Thermal mass of the room"
      annotation (Placement(transformation(extent={{-30,0},{-10,20}})));
    Modelica.Thermal.HeatTransfer.Components.ThermalConductor wall(G=100) "Heat loss through the walls"
      annotation (Placement(transformation(extent={{0,-10},{20,10}})));
    Modelica.Thermal.HeatTransfer.Sources.FixedTemperature ambient(T=283.15) "Outside temperature 10 degC"
      annotation (Placement(transformation(extent={{60,-10},{40,10}})));
    Modelica.Thermal.HeatTransfer.Celsius.TemperatureSensor roomTemperature
      annotation (Placement(transformation(extent={{0,-50},{20,-30}})));
  equation
    connect(heating.y, heater.Q_flow) annotation (Line(points={{-79,0},{-70,0}}, color={0,0,127}));
    connect(heater.port, room.port) annotation (Line(points={{-50,0},{-20,0}}, color={191,0,0}));
    connect(room.port, wall.port_a) annotation (Line(points={{-20,0},{0,0}}, color={191,0,0}));
    connect(wall.port_b, ambient.port) annotation (Line(points={{20,0},{40,0}}, color={191,0,0}));
    connect(room.port, roomTemperature.port) annotation (Line(points={{-20,0},{-20,-40},{0,-40}}, color={191,0,0}));
    annotation (
      experiment(StopTime=21600, Interval=10),
      Diagram(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}})),
      Documentation(info="<html>
<p>
A room with a lumped heat capacity of 5e5 J/K starts at the ambient temperature of 10 &deg;C.
After one hour a 1 kW heater is switched on; heat is lost through the walls with a thermal
conductance of 100 W/K, so the room approaches 20 &deg;C with a time constant of C/G = 5000 s.
</p>
<p>Plot <code>roomTemperature.T</code> (in &deg;C) and <code>wall.Q_flow</code>.</p>
</html>"));
    // balance: 19 unknowns (heating 1, heater 3, room 4, wall 6, ambient 2, roomTemperature 3), 19 equations
    // (12 component equations + 1 signal connection + 6 heat port connection equations from 2 sets with 6 ports)
  end HeatedRoom;

  model BouncingBall "Bouncing ball with coefficient of restitution"
    extends Modelica.Icons.Example;
    parameter Real e(min=0, max=1) = 0.7 "Coefficient of restitution";
    parameter Modelica.Units.SI.Acceleration g=Modelica.Constants.g_n "Gravity acceleration";
    Modelica.Units.SI.Position h(start=1, fixed=true) "Height of the ball";
    Modelica.Units.SI.Velocity v(start=0, fixed=true) "Velocity of the ball";
  equation
    der(h) = v;
    der(v) = -g;
    when h < 0 then
      reinit(v, -e*pre(v));
    end when;
    annotation (
      experiment(StopTime=3, Interval=0.001),
      Icon(graphics={
          Ellipse(
            extent={{-30,80},{10,40}},
            lineColor={0,0,127},
            fillColor={0,0,127},
            fillPattern=FillPattern.Solid),
          Line(points={{-80,-80},{80,-80}}, thickness=0.5)}),
      Documentation(info="<html>
<p>
The classical bouncing ball: a point mass falls freely from a height of 1 m and bounces on the
floor at h = 0. At each impact the velocity is reversed and reduced by the coefficient of
restitution e using a when-clause with reinit().
</p>
<p>Plot <code>h</code> and <code>v</code>.</p>
</html>"));
    // balance: 2 unknowns (h, v), 2 equations (the when-clause only re-initializes the state v)
  end BouncingBall;

  model VanDerPol "Van der Pol oscillator"
    extends Modelica.Icons.Example;
    parameter Real mu=1 "Nonlinearity/damping parameter";
    Real x(start=2, fixed=true) "Position";
    Real y(start=0, fixed=true) "Velocity";
  equation
    der(x) = y;
    der(y) = mu*(1 - x^2)*y - x;
    annotation (
      experiment(StopTime=20, Interval=0.01),
      Icon(graphics={Line(
            points={{-80,0},{-70,60},{-50,70},{-20,-60},{10,-70},{40,60},{60,70},{80,0}},
            color={0,0,127},
            smooth=Smooth.Bezier)}),
      Documentation(info="<html>
<p>
The Van der Pol oscillator is a nonlinear oscillator with a stable limit cycle:
</p>
<blockquote><pre>
x'' - mu*(1 - x^2)*x' + x = 0
</pre></blockquote>
<p>Plot <code>x</code> versus time or <code>y</code> versus <code>x</code> (phase portrait).</p>
</html>"));
    // balance: 2 unknowns (x, y), 2 equations
  end VanDerPol;

  model LotkaVolterra "Lotka-Volterra predator-prey equations"
    extends Modelica.Icons.Example;
    parameter Real alpha=1.1 "Prey growth rate";
    parameter Real beta=0.4 "Predation rate";
    parameter Real delta=0.1 "Predator growth rate per prey eaten";
    parameter Real gamma=0.4 "Predator death rate";
    Real prey(start=10, fixed=true) "Prey population";
    Real predator(start=10, fixed=true) "Predator population";
  equation
    der(prey) = alpha*prey - beta*prey*predator;
    der(predator) = delta*prey*predator - gamma*predator;
    annotation (
      experiment(StopTime=50, Interval=0.05),
      Icon(graphics={
          Line(
            points={{-80,-40},{-60,20},{-40,60},{-20,20},{0,-40},{20,20},{40,60},{60,20},{80,-40}},
            color={0,127,0},
            smooth=Smooth.Bezier),
          Line(
            points={{-80,-60},{-60,-60},{-40,0},{-20,40},{0,-20},{20,-60},{40,0},{60,40},{80,-20}},
            color={191,0,0},
            smooth=Smooth.Bezier)}),
      Documentation(info="<html>
<p>
The Lotka-Volterra equations describe the dynamics of a prey population (e.g. rabbits) and a
predator population (e.g. foxes):
</p>
<blockquote><pre>
der(prey)     = alpha*prey - beta*prey*predator
der(predator) = delta*prey*predator - gamma*predator
</pre></blockquote>
<p>Plot <code>prey</code> and <code>predator</code> versus time, or against each other.</p>
</html>"));
    // balance: 2 unknowns (prey, predator), 2 equations
  end LotkaVolterra;

  model SimplePendulum "Mathematical pendulum with viscous damping (equation based)"
    extends Modelica.Icons.Example;
    parameter Modelica.Units.SI.Length L=1 "Length of the pendulum";
    parameter Modelica.Units.SI.Acceleration g=Modelica.Constants.g_n "Gravity acceleration";
    parameter Modelica.Units.SI.Damping d=0.1 "Viscous damping coefficient";
    Modelica.Units.SI.Angle phi(start=1.0, fixed=true) "Angle from the vertical";
    Modelica.Units.SI.AngularVelocity w(start=0, fixed=true) "Angular velocity";
  equation
    der(phi) = w;
    der(w) = -g/L*sin(phi) - d*w;
    annotation (
      experiment(StopTime=10, Interval=0.01),
      Icon(graphics={
          Line(points={{0,80},{40,-40}}, thickness=0.5),
          Ellipse(
            extent={{24,-24},{56,-56}},
            fillColor={0,0,127},
            fillPattern=FillPattern.Solid),
          Line(points={{0,80},{0,-60}}, pattern=LinePattern.Dash)}),
      Documentation(info="<html>
<p>
A mathematical pendulum (point mass on a massless rod of length L) released from an angle of
1 rad, described directly by its equation of motion including a small viscous damping term:
</p>
<blockquote><pre>
der(phi) = w
der(w)   = -g/L*sin(phi) - d*w
</pre></blockquote>
<p>Plot <code>phi</code> and <code>w</code>.</p>
</html>"));
    // balance: 2 unknowns (phi, w), 2 equations
  end SimplePendulum;

  annotation (
    version="1.0.0",
    uses(Modelica(version="4.0.0-subset")),
    Documentation(info="<html>
<p>
Ready-to-simulate demonstration models built from the components of the Modelica Standard Library
subset shipped with this platform. Each example carries an <code>experiment</code> annotation with a
suitable stop time; open a model, press <em>Simulate</em> and plot the variables mentioned in its
documentation.
</p>
<ul>
<li><a href=\"modelica://Examples.RCCircuit\">RCCircuit</a>, <a href=\"modelica://Examples.RLCCircuit\">RLCCircuit</a> &ndash; electrical circuits</li>
<li><a href=\"modelica://Examples.MassSpringDamper\">MassSpringDamper</a>, <a href=\"modelica://Examples.RotationalDrive\">RotationalDrive</a> &ndash; mechanics</li>
<li><a href=\"modelica://Examples.PIDControlledMotor\">PIDControlledMotor</a> &ndash; multi-domain: controlled DC motor</li>
<li><a href=\"modelica://Examples.HeatedRoom\">HeatedRoom</a> &ndash; heat transfer</li>
<li><a href=\"modelica://Examples.BouncingBall\">BouncingBall</a>, <a href=\"modelica://Examples.VanDerPol\">VanDerPol</a>,
    <a href=\"modelica://Examples.LotkaVolterra\">LotkaVolterra</a>, <a href=\"modelica://Examples.SimplePendulum\">SimplePendulum</a> &ndash; equation based models</li>
</ul>
</html>"));
end Examples;
