within Modelica;
package Mechanics "Library of 1-dim. mechanical components (rotational, translational)"
  extends Modelica.Icons.Package;

  package Rotational "Library to model 1-dimensional, rotational mechanical systems"
    extends Modelica.Icons.Package;

    package Examples "Demonstration examples of the components of this package"
      extends Modelica.Icons.ExamplesPackage;

      model First "First example: simple drive train"
        extends Modelica.Icons.Example;
        parameter Modelica.Units.SI.Torque amplitude=10 "Amplitude of driving torque";
        parameter Modelica.Units.SI.Frequency f=5 "Frequency of driving torque";
        parameter Modelica.Units.SI.Inertia Jmotor(min=0) = 0.1 "Motor inertia";
        parameter Modelica.Units.SI.Inertia Jload(min=0) = 2 "Load inertia";
        parameter Real ratio=10 "Gear ratio";
        parameter Real damping=10 "Damping in bearing of gear";
        Modelica.Mechanics.Rotational.Components.Fixed fixed
          annotation (Placement(transformation(extent={{38,-48},{54,-32}})));
        Modelica.Mechanics.Rotational.Sources.Torque torque
          annotation (Placement(transformation(extent={{-68,-8},{-52,8}})));
        Modelica.Mechanics.Rotational.Components.Inertia inertia1(J=Jmotor)
          annotation (Placement(transformation(extent={{-38,-8},{-22,8}})));
        Modelica.Mechanics.Rotational.Components.IdealGear idealGear(ratio=ratio)
          annotation (Placement(transformation(extent={{-8,-8},{8,8}})));
        Modelica.Mechanics.Rotational.Components.Inertia inertia2(
          J=2,
          phi(fixed=true, start=0),
          w(fixed=true, start=0))
          annotation (Placement(transformation(extent={{22,-8},{38,8}})));
        Modelica.Mechanics.Rotational.Components.Spring spring(c=1.e4, phi_rel(fixed=true))
          annotation (Placement(transformation(extent={{52,-8},{68,8}})));
        Modelica.Mechanics.Rotational.Components.Inertia inertia3(J=Jload, w(fixed=true, start=0))
          annotation (Placement(transformation(extent={{82,-8},{98,8}})));
        Modelica.Mechanics.Rotational.Components.Damper damper(d=damping)
          annotation (Placement(transformation(
              origin={46,-22},
              extent={{-8,-8},{8,8}},
              rotation=270)));
        Modelica.Blocks.Sources.Sine sine(amplitude=amplitude, f=f)
          annotation (Placement(transformation(extent={{-98,-8},{-82,8}})));
      equation
        connect(inertia1.flange_b, idealGear.flange_a) annotation (Line(points={{-22,0},{-8,0}}));
        connect(idealGear.flange_b, inertia2.flange_a) annotation (Line(points={{8,0},{22,0}}));
        connect(inertia2.flange_b, spring.flange_a) annotation (Line(points={{38,0},{52,0}}));
        connect(spring.flange_b, inertia3.flange_a) annotation (Line(points={{68,0},{82,0}}));
        connect(damper.flange_a, inertia2.flange_b) annotation (Line(points={{46,-14},{46,0},{38,0}}));
        connect(damper.flange_b, fixed.flange) annotation (Line(points={{46,-30},{46,-40}}));
        connect(sine.y, torque.tau) annotation (Line(points={{-81.2,0},{-69.6,0}}, color={0,0,127}));
        connect(torque.flange, inertia1.flange_a) annotation (Line(points={{-52,0},{-38,0}}));
        annotation (
          Documentation(info="<html>
<p>The drive train consists of a motor inertia which is driven by
a sine-wave motor torque. Via a gearbox the rotational energy is
transmitted to a load inertia. Elasticity in the gearbox is modeled
by a spring element. A linear damper is used to model the
damping in the gearbox bearing.</p>
<p>Note, that a force component (like the damper of this example)
which is acting between a shaft and the housing has to be fixed
in the housing on one side via component Fixed.</p>
<p>Simulate for 1 second and plot the following variables:<br>
   angular velocities of inertias inertia2 and 3: inertia2.w, inertia3.w</p>
<p>Compared to the Modelica Standard Library the torque source and the gear are implicitly
fixed to ground (no support connectors on this platform).</p>
</html>"),
          experiment(StopTime=1.0, Interval=0.001));
        // balance (flattened): 50 unknowns (fixed 2, torque 4, inertia1 7, idealGear 7, inertia2 7, spring 6,
        // inertia3 7, damper 9, sine 1), 50 equations (35 component equations, 1 signal connection,
        // 13 flange connection equations from 6 connection sets with 13 flanges, 1 zero-flow equation for
        // the unconnected inertia3.flange_b)
      end First;

      annotation (Documentation(info="<html>
<p>
This package contains example models to demonstrate the usage of the
Modelica.Mechanics.Rotational package. Open the models and
simulate them according to the provided description in the models.
</p>
</html>"));
    end Examples;

    package Components "Components for 1D rotational mechanical drive trains"
      extends Modelica.Icons.Package;

      model Fixed "Flange fixed in housing at a given angle"
        parameter Modelica.Units.SI.Angle phi0=0 "Fixed offset angle of housing";
        Modelica.Mechanics.Rotational.Interfaces.Flange_b flange "(right) flange fixed in housing"
          annotation (Placement(transformation(extent={{10,-10},{-10,10}})));
      equation
        flange.phi = phi0;
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Text(
                extent={{-150,-90},{150,-130}},
                textColor={0,0,255},
                textString="%name"),
              Line(points={{-80,-40},{80,-40}}),
              Line(points={{80,-40},{40,-80}}),
              Line(points={{40,-40},{0,-80}}),
              Line(points={{0,-40},{-40,-80}}),
              Line(points={{-40,-40},{-80,-80}}),
              Line(points={{0,-40},{0,-10}})}),
          Documentation(info="<html>
<p>
The <strong>flange</strong> of a 1D rotational mechanical system is <strong>fixed</strong>
at an angle phi0 in the <strong>housing</strong>. May be used:
</p>
<ul>
<li> to connect a compliant element, such as a spring or a damper,
     between an inertia or gearbox component and the housing.</li>
<li> to fix a rigid element, such as an inertia, with a specific
     angle to the housing.</li>
</ul>
</html>"));
        // balance: 2 unknowns (flange.phi, flange.tau), 1 flow variable provided by connection, 1 equation
      end Fixed;

      model Inertia "1D-rotational component with inertia"
        extends Modelica.Mechanics.Rotational.Interfaces.PartialTwoFlanges;
        parameter Modelica.Units.SI.Inertia J(min=0, start=1) "Moment of inertia";
        Modelica.Units.SI.Angle phi "Absolute rotation angle of component"
          annotation (Dialog(group="Initialization", showStartAttribute=true));
        Modelica.Units.SI.AngularVelocity w "Absolute angular velocity of component (= der(phi))"
          annotation (Dialog(group="Initialization", showStartAttribute=true));
        Modelica.Units.SI.AngularAcceleration a "Absolute angular acceleration of component (= der(w))"
          annotation (Dialog(group="Initialization", showStartAttribute=true));
      equation
        phi = flange_a.phi;
        phi = flange_b.phi;
        w = der(phi);
        a = der(w);
        J*a = flange_a.tau + flange_b.tau;
        annotation (Documentation(info="<html>
<p>
Rotational component with <strong>inertia</strong> and two rigidly connected flanges.
</p>
</html>"),
          Icon(
            coordinateSystem(preserveAspectRatio=true, extent={{-100.0,-100.0},{100.0,100.0}}),
            graphics={
              Rectangle(lineColor={64,64,64},
                fillColor={192,192,192},
                fillPattern=FillPattern.HorizontalCylinder,
                extent={{-100.0,-10.0},{-50.0,10.0}}),
              Rectangle(lineColor={64,64,64},
                fillColor={192,192,192},
                fillPattern=FillPattern.HorizontalCylinder,
                extent={{50.0,-10.0},{100.0,10.0}}),
              Line(points={{-80.0,-25.0},{-60.0,-25.0}}),
              Line(points={{60.0,-25.0},{80.0,-25.0}}),
              Line(points={{-70.0,-25.0},{-70.0,-70.0}}),
              Line(points={{70.0,-25.0},{70.0,-70.0}}),
              Line(points={{-80.0,25.0},{-60.0,25.0}}),
              Line(points={{60.0,25.0},{80.0,25.0}}),
              Line(points={{-70.0,45.0},{-70.0,25.0}}),
              Line(points={{70.0,45.0},{70.0,25.0}}),
              Line(points={{-70.0,-70.0},{70.0,-70.0}}),
              Rectangle(lineColor={64,64,64},
                fillColor={255,255,255},
                fillPattern=FillPattern.HorizontalCylinder,
                extent={{-50.0,-50.0},{50.0,50.0}},
                radius=10.0),
              Text(textColor={0,0,255},
                extent={{-150.0,60.0},{150.0,100.0}},
                textString="%name"),
              Text(extent={{-150.0,-120.0},{150.0,-80.0}},
                textString="J=%J"),
              Rectangle(
                lineColor={64,64,64},
                fillColor={255,255,255},
                extent={{-50,-50},{50,50}},
                radius=10)}));
        // balance: 7 unknowns (flange_a.phi, flange_a.tau, flange_b.phi, flange_b.tau, phi, w, a),
        // 2 flow variables provided by connections, 5 equations
      end Inertia;

      model Spring "Linear 1D rotational spring"
        extends Modelica.Mechanics.Rotational.Interfaces.PartialCompliant;
        parameter Modelica.Units.SI.RotationalSpringConstant c(final min=0, start=1.0e5) "Spring constant";
        parameter Modelica.Units.SI.Angle phi_rel0=0 "Unstretched spring angle";
      equation
        tau = c*(phi_rel - phi_rel0);
        annotation (
          Documentation(info="<html>
<p>
A <strong>linear 1D rotational spring</strong>. The component can be connected either
between two inertias/gears to describe the shaft elasticity, or between
a inertia/gear and the housing (component Fixed), to describe
a coupling of the element with the housing via a spring.
</p>
</html>"),
          Icon(
            coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}),
            graphics={
              Text(extent={{-150,80},{150,40}},
                textString="%name",
                textColor={0,0,255}),
              Text(extent={{-150,-40},{150,-80}},
                textString="c=%c"),
              Line(points={{-100,0},{-58,0},{-43,-30},{-13,30},{17,-30},{47,30},{62,0},{100,0}})}));
        // balance: 6 unknowns (4 flange variables, phi_rel, tau), 2 flow variables provided by connections, 4 equations
      end Spring;

      model Damper "Linear 1D rotational damper"
        extends Modelica.Mechanics.Rotational.Interfaces.PartialCompliantWithRelativeStates;
        parameter Modelica.Units.SI.RotationalDampingConstant d(final min=0, start=0) "Damping constant";
        Modelica.Units.SI.Power lossPower "Loss power leaving component via heatPort (dissipated)";
      equation
        tau = d*w_rel;
        lossPower = tau*w_rel;
        annotation (
          Documentation(info="<html>
<p>
<strong>Linear, velocity dependent damper</strong> element. It can be either connected
between an inertia or gear and the housing (component Fixed), or
between two inertia/gear elements.
</p>
<p>
The optional heat port of the Modelica Standard Library is not available on this platform;
the dissipated power is available as variable lossPower.
</p>
</html>"),
          Icon(
            coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Line(points={{-90,0},{-60,0}}),
              Line(points={{-60,-30},{-60,30}}),
              Line(points={{-60,-30},{60,-30}}),
              Line(points={{-60,30},{60,30}}),
              Rectangle(extent={{-60,30},{30,-30}},
                fillColor={192,192,192},
                fillPattern=FillPattern.Solid),
              Line(points={{30,0},{90,0}}),
              Text(extent={{-150,80},{150,40}},
                textString="%name",
                textColor={0,0,255}),
              Text(extent={{-150,-50},{150,-90}},
                textString="d=%d")}));
        // balance: 9 unknowns (4 flange variables, phi_rel, w_rel, a_rel, tau, lossPower),
        // 2 flow variables provided by connections, 7 equations (5 base + 2)
      end Damper;

      model SpringDamper "Linear 1D rotational spring and damper in parallel"
        parameter Modelica.Units.SI.RotationalSpringConstant c(final min=0, start=1.0e5) "Spring constant";
        parameter Modelica.Units.SI.RotationalDampingConstant d(final min=0, start=0) "Damping constant";
        parameter Modelica.Units.SI.Angle phi_rel0=0 "Unstretched spring angle";
        extends Modelica.Mechanics.Rotational.Interfaces.PartialCompliantWithRelativeStates;
        Modelica.Units.SI.Power lossPower "Loss power leaving component via heatPort (dissipated)";
      protected
        Modelica.Units.SI.Torque tau_c "Spring torque";
        Modelica.Units.SI.Torque tau_d "Damping torque";
      equation
        tau_c = c*(phi_rel - phi_rel0);
        tau_d = d*w_rel;
        tau = tau_c + tau_d;
        lossPower = tau_d*w_rel;
        annotation (
          Documentation(info="<html>
<p>
A <strong>spring</strong> and <strong>damper</strong> element <strong>connected in parallel</strong>.
The component can be
connected either between two inertias/gears to describe the shaft elasticity
and damping, or between an inertia/gear and the housing (component Fixed),
to describe a coupling of the element with the housing via a spring/damper.
</p>
</html>"),
          Icon(
            coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}),
            graphics={
              Line(points={{-80,40},{-60,40},{-45,10},{-15,70},{15,10},{45,70},{60,40},{80,40}}),
              Line(points={{-80,40},{-80,-40}}),
              Line(points={{-80,-40},{-50,-40}}),
              Rectangle(extent={{-50,-10},{40,-70}},
                fillColor={192,192,192},
                fillPattern=FillPattern.Solid),
              Line(points={{-50,-10},{70,-10}}),
              Line(points={{-50,-70},{70,-70}}),
              Line(points={{40,-40},{80,-40}}),
              Line(points={{80,40},{80,-40}}),
              Line(points={{-90,0},{-80,0}}),
              Line(points={{80,0},{90,0}}),
              Text(origin={0,-9},
                extent={{-150,-144},{150,-104}},
                textString="d=%d"),
              Text(extent={{-190,110},{190,70}},
                textColor={0,0,255},
                textString="%name"),
              Text(
                origin={0,-7},
                extent={{-150,-108},{150,-68}},
                textString="c=%c")}));
        // balance: 11 unknowns (4 flange variables, phi_rel, w_rel, a_rel, tau, lossPower, tau_c, tau_d),
        // 2 flow variables provided by connections, 9 equations (5 base + 4)
      end SpringDamper;

      model IdealGear "Ideal gear without inertia"
        extends Modelica.Mechanics.Rotational.Icons.Gear;
        extends Modelica.Mechanics.Rotational.Interfaces.PartialElementaryTwoFlangesAndSupport2;
        parameter Real ratio(start=1) "Transmission ratio (flange_a.phi/flange_b.phi)";
        Modelica.Units.SI.Angle phi_a "Angle between left shaft flange and support";
        Modelica.Units.SI.Angle phi_b "Angle between right shaft flange and support";
      equation
        phi_a = flange_a.phi - phi_support;
        phi_b = flange_b.phi - phi_support;
        phi_a = ratio*phi_b;
        0 = ratio*flange_a.tau + flange_b.tau;
        annotation (
          Documentation(info="<html>
<p>
This element characterizes any type of gear box which is fixed in the
ground and which has one driving shaft and one driven shaft.
The gear is <strong>ideal</strong>, i.e., it does not have inertia, elasticity, damping
or backlash. If these effects have to be considered, the gear has to be
connected to other elements in an appropriate way.
</p>
</html>"),
          Icon(
            coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}),
            graphics={
              Text(extent={{-153,145},{147,105}},
                textColor={0,0,255},
                textString="%name"),
              Text(extent={{-146,-49},{154,-79}},
                textString="ratio=%ratio")}));
        // balance: 7 unknowns (4 flange variables, phi_support, phi_a, phi_b), 2 flow variables provided by
        // connections, 5 equations (1 base + 4)
      end IdealGear;

      annotation (Icon(
          coordinateSystem(preserveAspectRatio=true, extent={{-100.0,-100.0},{100.0,100.0}}),
          graphics={
            Rectangle(origin={13.5135,76.9841},
              lineColor={64,64,64},
              fillColor={255,255,255},
              fillPattern=FillPattern.HorizontalCylinder,
              extent={{-63.5135,-126.9841},{36.4865,-26.9841}},
              radius=10.0),
            Rectangle(origin={13.5135,76.9841},
              lineColor={64,64,64},
              extent={{-63.5135,-126.9841},{36.4865,-26.9841}},
              radius=10.0),
            Rectangle(origin={-3.0,73.0769},
              lineColor={64,64,64},
              fillColor={192,192,192},
              fillPattern=FillPattern.HorizontalCylinder,
              extent={{-87.0,-83.0769},{-47.0,-63.0769}}),
            Rectangle(origin={22.3077,70.0},
              lineColor={64,64,64},
              fillColor={192,192,192},
              fillPattern=FillPattern.HorizontalCylinder,
              extent={{27.6923,-80.0},{67.6923,-60.0}})}), Documentation(info="<html>
<p>
This package contains basic components 1D mechanical rotational drive trains.
</p>
</html>"));
    end Components;

    package Sources "Sources to drive 1D rotational mechanical components"
      extends Modelica.Icons.SourcesPackage;

      model Torque "Input signal acting as external torque on a flange"
        extends Modelica.Mechanics.Rotational.Interfaces.PartialElementaryOneFlangeAndSupport2;
        Modelica.Blocks.Interfaces.RealInput tau(unit="N.m") "Accelerating torque acting at flange (= -flange.tau)"
          annotation (Placement(transformation(extent={{-140,-20},{-100,20}})));
      equation
        flange.tau = -tau;
        annotation (
          Documentation(info="<html>
<p>
The input signal <strong>tau</strong> defines an external
torque in [Nm] which acts (with negative sign) at
a flange connector, i.e., the component connected to this
flange is driven by torque <strong>tau</strong>.</p>
<p>
The input signal can be provided from one of the signal generator
blocks of Modelica.Blocks.Sources.
</p>
</html>"),
          Icon(
            coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}),
            graphics={
              Ellipse(
                extent={{-100,-100},{100,100}},
                lineColor={0,0,0},
                startAngle=40,
                endAngle=150,
                closure=EllipseClosure.None,
                origin={0,-40}),
              Ellipse(
                extent={{-60,-60},{60,60}},
                lineColor={0,0,0},
                startAngle=40,
                endAngle=140,
                closure=EllipseClosure.None,
                origin={0,-80}),
              Text(
                extent={{-62,-29},{-141,-70}},
                textString="tau"),
              Polygon(
                points={{90,10},{66,60},{40,34},{90,10}},
                fillPattern=FillPattern.Solid),
              Line(
                points={{0,-20},{0,-101}}),
              Polygon(
                points={{-54,-54},{-30,-38},{-44,-26},{-54,-54}},
                fillPattern=FillPattern.Solid),
              Text(
                extent={{-150,110},{150,70}},
                textString="%name",
                textColor={0,0,255})}));
        // balance: 4 unknowns (flange.phi, flange.tau, phi_support, tau), 1 flow variable and 1 input provided
        // by connections, 2 equations (1 base + 1)
      end Torque;

      model ConstantTorque "Constant torque, not dependent on speed"
        extends Modelica.Mechanics.Rotational.Interfaces.PartialTorque;
        parameter Modelica.Units.SI.Torque tau_constant
          "Constant torque (if negative, torque is acting as load in positive direction of rotation)";
        Modelica.Units.SI.AngularVelocity w "Angular velocity of flange with respect to support (= der(phi))";
        Modelica.Units.SI.Torque tau "Accelerating torque acting at flange (= -flange.tau)";
      equation
        w = der(phi);
        tau = -flange.tau;
        tau = tau_constant;
        annotation (
          Icon(
            coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}),
            graphics={
              Line(points={{-75,10},{75,10}}, color={192,192,192}),
              Line(points={{0,60},{0,0}}, color={192,192,192}),
              Line(points={{-75,30},{75,30}}, color={0,0,127}),
              Text(extent={{-120,-40},{120,-10}}, textString="%tau_constant")}),
          Documentation(info="<html>
<p>Model of constant torque, not dependent on angular velocity of flange.</p>
<p>Please note:<br>
Positive torque accelerates in positive direction of rotation, but brakes in reverse direction of rotation.<br>
Negative torque brakes in positive direction of rotation, but accelerates in reverse direction of rotation.</p>
</html>"));
        // balance: 6 unknowns (flange.phi, flange.tau, phi_support, phi, w, tau), 1 flow variable provided by
        // connection, 5 equations (2 base + 3)
      end ConstantTorque;

      model ConstantSpeed "Constant speed, not dependent on torque"
        extends Modelica.Mechanics.Rotational.Interfaces.PartialTorque;
        Modelica.Units.SI.AngularVelocity w "Angular velocity of flange with respect to support (= der(phi))";
        parameter Modelica.Units.SI.AngularVelocity w_fixed "Fixed speed";
      equation
        w = der(phi);
        w = w_fixed;
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Line(points={{-60,60},{-60,-10}}, color={192,192,192}),
              Line(points={{-75,0},{75,0}}, color={192,192,192}),
              Line(points={{10,60},{10,-10}}, color={0,0,127}),
              Text(extent={{-120,-50},{120,-20}}, textString="%w_fixed")}),
          Documentation(info="<html>
<p>
Model of <strong>fixed</strong> angular velocity of flange, not dependent on torque.
</p>
</html>"));
        // balance: 5 unknowns (flange.phi, flange.tau, phi_support, phi, w), 1 flow variable provided by
        // connection, 4 equations (2 base + 2)
      end ConstantSpeed;

      annotation (Documentation(info="<html>
<p>
This package contains ideal sources to drive 1D mechanical rotational drive trains.
</p>
</html>"));
    end Sources;

    package Sensors "Sensors to measure variables in 1D rotational mechanical components"
      extends Modelica.Icons.SensorsPackage;

      model AngleSensor "Ideal sensor to measure the absolute angle of flange"
        extends Modelica.Mechanics.Rotational.Interfaces.PartialAbsoluteSensor;
        Modelica.Blocks.Interfaces.RealOutput phi(unit="rad", displayUnit="deg") "Absolute angle of flange as output signal"
          annotation (Placement(transformation(extent={{100,-10},{120,10}})));
      equation
        phi = flange.phi;
        annotation (
          Documentation(info="<html>
<p>
Measures the <em>absolute angle</em>
of a&nbsp;flange in an ideal way and provides the result as
output signal&nbsp;<code>phi</code>
(to be further processed with blocks of the
<a href=\"modelica://Modelica.Blocks\">Modelica.Blocks</a> library).
</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Text(
                extent={{-30,-10},{30,-70}},
                textColor={64,64,64},
                textString="rad")}));
        // balance: 3 unknowns (flange.phi, flange.tau, phi), 1 flow variable provided by connection, 2 equations
      end AngleSensor;

      model SpeedSensor "Ideal sensor to measure the absolute angular velocity of flange"
        extends Modelica.Mechanics.Rotational.Interfaces.PartialAbsoluteSensor;
        Modelica.Blocks.Interfaces.RealOutput w(unit="rad/s") "Absolute angular velocity of flange as output signal"
          annotation (Placement(transformation(extent={{100,-10},{120,10}})));
      equation
        w = der(flange.phi);
        annotation (
          Documentation(info="<html>
<p>
Measures the <em>absolute angular velocity</em>
of a&nbsp;flange in an ideal way and provides the result as
output signal&nbsp;<code>w</code>
(to be further processed with blocks of the
<a href=\"modelica://Modelica.Blocks\">Modelica.Blocks</a> library).
</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Text(
                extent={{-50,-14},{50,-54}},
                textColor={64,64,64},
                textString="rad/s")}));
        // balance: 3 unknowns (flange.phi, flange.tau, w), 1 flow variable provided by connection, 2 equations
      end SpeedSensor;

      model AccSensor "Ideal sensor to measure the absolute angular acceleration of flange"
        extends Modelica.Mechanics.Rotational.Interfaces.PartialAbsoluteSensor;
        Modelica.Units.SI.AngularVelocity w "Absolute angular velocity of flange";
        Modelica.Blocks.Interfaces.RealOutput a(unit="rad/s2") "Absolute angular acceleration of flange as output signal"
          annotation (Placement(transformation(extent={{100,-10},{120,10}})));
      equation
        w = der(flange.phi);
        a = der(w);
        annotation (
          Documentation(info="<html>
<p>
Measures the <em>absolute angular acceleration</em>
of a&nbsp;flange in an ideal way and provides the result as
output signal&nbsp;<code>a</code>
(to be further processed with blocks of the
<a href=\"modelica://Modelica.Blocks\">Modelica.Blocks</a> library).
</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Text(
                extent={{-50,-14},{50,-54}},
                textColor={64,64,64},
                textString="rad/s2")}));
        // balance: 4 unknowns (flange.phi, flange.tau, w, a), 1 flow variable provided by connection, 3 equations
      end AccSensor;

      model TorqueSensor "Ideal sensor to measure the torque between two flanges"
        extends Modelica.Mechanics.Rotational.Interfaces.PartialRelativeSensor;
        Modelica.Blocks.Interfaces.RealOutput tau(unit="N.m")
          "Torque in flange flange_a and flange_b (tau = flange_a.tau = -flange_b.tau) as output signal"
          annotation (Placement(transformation(
              origin={-80,-110},
              extent={{10,-10},{-10,10}},
              rotation=90)));
      equation
        flange_a.phi = flange_b.phi;
        flange_a.tau = tau;
        annotation (
          Documentation(info="<html>
<p>
Measures the <em>cut-torque</em> between two flanges
in an ideal way and provides the result as output signal <code>tau</code>
(to be further processed with blocks of the
<a href=\"modelica://Modelica.Blocks\">Modelica.Blocks</a> library).
</p>
</html>"),
          Icon(
            coordinateSystem(preserveAspectRatio=true, extent={{-100.0,-100.0},{100.0,100.0}}),
            graphics={
              Line(points={{-80.0,-100.0},{-80.0,0.0}}, color={0,0,127}),
              Text(
                extent={{-50,-14},{50,-54}},
                textColor={64,64,64},
                textString="N.m")}));
        // balance: 5 unknowns (4 flange variables, tau), 2 flow variables provided by connections, 3 equations (1 base + 2)
      end TorqueSensor;

      model PowerSensor "Ideal sensor to measure the power between two flanges"
        extends Modelica.Mechanics.Rotational.Interfaces.PartialRelativeSensor;
        Modelica.Blocks.Interfaces.RealOutput power(unit="W") "Power in flange flange_a as output signal"
          annotation (Placement(transformation(
              origin={-80,-110},
              extent={{10,-10},{-10,10}},
              rotation=90)));
      equation
        flange_a.phi = flange_b.phi;
        power = flange_a.tau*der(flange_a.phi);
        annotation (
          Documentation(info="<html>
<p>
Measures the <em>power</em> between two flanges
in an ideal way and provides the result as output signal <code>power</code>
(to be further processed with blocks of the
<a href=\"modelica://Modelica.Blocks\">Modelica.Blocks</a> library), i.e.
</p>
<blockquote><pre>
power = flange_a.tau * der(flange_a.phi)
</pre></blockquote>
</html>"),
          Icon(
            coordinateSystem(preserveAspectRatio=true, extent={{-100.0,-100.0},{100.0,100.0}}),
            graphics={
              Line(points={{-80.0,-100.0},{-80.0,0.0}}, color={0,0,127}),
              Text(
                extent={{-30,-10},{30,-70}},
                textColor={64,64,64},
                textString="W")}));
        // balance: 5 unknowns (4 flange variables, power), 2 flow variables provided by connections, 3 equations (1 base + 2)
      end PowerSensor;

      model RelAngleSensor "Ideal sensor to measure the relative angle between two flanges"
        extends Modelica.Mechanics.Rotational.Interfaces.PartialRelativeSensor;
        Modelica.Blocks.Interfaces.RealOutput phi_rel(unit="rad", displayUnit="deg")
          "Relative angle between two flanges (= flange_b.phi - flange_a.phi) as output signal"
          annotation (Placement(transformation(
              origin={0,-110},
              extent={{10,-10},{-10,10}},
              rotation=90)));
      equation
        phi_rel = flange_b.phi - flange_a.phi;
        0 = flange_a.tau;
        annotation (
          Documentation(info="<html>
<p>
Measures the <em>relative angle</em> between two flanges
in an ideal way and provides the result as output signal <code>phi_rel</code>
(to be further processed with blocks of the
<a href=\"modelica://Modelica.Blocks\">Modelica.Blocks</a> library).
</p>
</html>"),
          Icon(
            coordinateSystem(preserveAspectRatio=true, extent={{-100.0,-100.0},{100.0,100.0}}),
            graphics={
              Line(points={{0.0,-100.0},{0.0,-70.0}}, color={0,0,127}),
              Text(
                extent={{-30,-10},{30,-70}},
                textColor={64,64,64},
                textString="rad")}));
        // balance: 5 unknowns (4 flange variables, phi_rel), 2 flow variables provided by connections, 3 equations (1 base + 2)
      end RelAngleSensor;

      model RelSpeedSensor "Ideal sensor to measure the relative angular velocity between two flanges"
        extends Modelica.Mechanics.Rotational.Interfaces.PartialRelativeSensor;
        Modelica.Units.SI.Angle phi_rel "Relative angle between two flanges (flange_b.phi - flange_a.phi)";
        Modelica.Blocks.Interfaces.RealOutput w_rel(unit="rad/s")
          "Relative angular velocity between two flanges (= der(flange_b.phi) - der(flange_a.phi)) as output signal"
          annotation (Placement(transformation(
              origin={0,-110},
              extent={{10,-10},{-10,10}},
              rotation=90)));
      equation
        phi_rel = flange_b.phi - flange_a.phi;
        w_rel = der(phi_rel);
        0 = flange_a.tau;
        annotation (
          Documentation(info="<html>
<p>
Measures the <em>relative angular velocity</em> between two flanges
in an ideal way and provides the result as output signal <code>w_rel</code>
(to be further processed with blocks of the
<a href=\"modelica://Modelica.Blocks\">Modelica.Blocks</a> library).
</p>
</html>"),
          Icon(
            coordinateSystem(preserveAspectRatio=true, extent={{-100.0,-100.0},{100.0,100.0}}),
            graphics={
              Line(points={{0.0,-100.0},{0.0,-70.0}}, color={0,0,127}),
              Text(
                extent={{-50,-14},{50,-54}},
                textColor={64,64,64},
                textString="rad/s")}));
        // balance: 6 unknowns (4 flange variables, phi_rel, w_rel), 2 flow variables provided by connections, 4 equations (1 base + 3)
      end RelSpeedSensor;

      annotation (Documentation(info="<html>
<p>
This package contains ideal sensor components that provide
the connector variables as signals for further processing with the
<a href=\"modelica://Modelica.Blocks\">Modelica.Blocks</a> library.
</p>
</html>"));
    end Sensors;

    package Interfaces "Connectors and partial models for 1D rotational mechanical components"
      extends Modelica.Icons.InterfacesPackage;

      connector Flange "One-dimensional rotational flange"
        Modelica.Units.SI.Angle phi "Absolute rotation angle of flange";
        flow Modelica.Units.SI.Torque tau "Cut torque in the flange";
        annotation (Documentation(info="<html>
<p>
This is a connector for 1D rotational mechanical systems.
It has no icon definition and is only used by inheritance from
flange connectors to define different icons.
</p>
<p>
The following variables are defined in this connector:
</p>
<blockquote><pre>
phi: Absolute rotation angle of the flange in [rad].
tau: Cut-torque in the flange in [Nm].
</pre></blockquote>
</html>"));
      end Flange;

      connector Flange_a "One-dimensional rotational flange of a shaft (filled circle icon)"
        extends Modelica.Mechanics.Rotational.Interfaces.Flange;
        annotation (
          defaultComponentName="flange_a",
          Documentation(info="<html>
<p>
This is a connector for 1-dim. rotational mechanical systems and models which represents
a mechanical flange of a shaft. The following variables are defined in this connector:
</p>
<blockquote><pre>
phi: Absolute rotation angle of the shaft flange in [rad].
tau: Cut-torque in the shaft flange in [Nm].
</pre></blockquote>
<p>
The connectors Flange_a and Flange_b are completely identical. There is only a difference
in the icons, in order to easier identify a flange variable in a diagram.
</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
            Ellipse(
              extent={{-100,100},{100,-100}},
              fillColor={95,95,95},
              fillPattern=FillPattern.Solid)}),
          Diagram(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Text(
                    extent={{-160,90},{40,50}},
                    textString="%name"),Ellipse(
                    extent={{-40,40},{40,-40}},
                    fillColor={135,135,135},
                    fillPattern=FillPattern.Solid)}));
      end Flange_a;

      connector Flange_b "One-dimensional rotational flange of a shaft (non-filled circle icon)"
        extends Modelica.Mechanics.Rotational.Interfaces.Flange;
        annotation (
          defaultComponentName="flange_b",
          Documentation(info="<html>
<p>
This is a connector for 1-dim. rotational mechanical systems and models which represents
a mechanical flange of a shaft. The following variables are defined in this connector:
</p>
<blockquote><pre>
phi: Absolute rotation angle of the shaft flange in [rad].
tau: Cut-torque in the shaft flange in [Nm].
</pre></blockquote>
<p>
The connectors Flange_a and Flange_b are completely identical. There is only a difference
in the icons, in order to easier identify a flange variable in a diagram.
</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Ellipse(
                    extent={{-100,100},{100,-100}},
                    fillColor={255,255,255},
                    fillPattern=FillPattern.Solid)}),
          Diagram(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Ellipse(
                    extent={{-40,40},{40,-40}},
                    fillColor={255,255,255},
                    fillPattern=FillPattern.Solid),Text(
                    extent={{-40,90},{160,50}},
                    textString="%name")}));
      end Flange_b;

      connector Support "Support/housing flange of a one-dimensional rotational shaft"
        extends Modelica.Mechanics.Rotational.Interfaces.Flange;
        annotation (
          Documentation(info="<html>
<p>
This is a connector for 1-dim. rotational mechanical systems and models which represents
a support or housing of a shaft. The following variables are defined in this connector:
</p>
<blockquote><pre>
phi: Absolute rotation angle of the support/housing in [rad].
tau: Reaction torque in the support/housing in [Nm].
</pre></blockquote>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Ellipse(
                extent={{-100,100},{100,-100}},
                fillColor={95,95,95},
                fillPattern=FillPattern.Solid),
              Rectangle(
                extent={{-150,150},{150,-150}},
                lineColor={192,192,192},
                fillColor={192,192,192},
                fillPattern=FillPattern.Solid),
              Ellipse(
                extent={{-100,100},{100,-100}},
                fillColor={95,95,95},
                fillPattern=FillPattern.Solid)}),
          Diagram(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Rectangle(
                    extent={{-60,60},{60,-60}},
                    lineColor={192,192,192},
                    fillColor={192,192,192},
                    fillPattern=FillPattern.Solid),Text(
                    extent={{-160,100},{40,60}},
                    textString="%name"),Ellipse(
                    extent={{-40,40},{40,-40}},
                    fillColor={135,135,135},
                    fillPattern=FillPattern.Solid)}));
      end Support;

      partial model PartialTwoFlanges "Partial model for a component with two rotational 1-dim. shaft flanges"
        Modelica.Mechanics.Rotational.Interfaces.Flange_a flange_a "Flange of left shaft"
          annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
        Modelica.Mechanics.Rotational.Interfaces.Flange_b flange_b "Flange of right shaft"
          annotation (Placement(transformation(extent={{90,-10},{110,10}})));
        annotation (Documentation(info="<html>
<p>
This is a 1-dim. rotational component with two flanges.
It is used e.g., to build up parts of a drive train consisting
of several components.
</p>
</html>"));
      end PartialTwoFlanges;

      partial model PartialCompliant "Partial model for the compliant connection of two rotational 1-dim. shaft flanges"
        Modelica.Units.SI.Angle phi_rel(start=0) "Relative rotation angle (= flange_b.phi - flange_a.phi)";
        Modelica.Units.SI.Torque tau "Torque between flanges (= flange_b.tau)";
        Modelica.Mechanics.Rotational.Interfaces.Flange_a flange_a "Left flange of compliant 1-dim. rotational component"
          annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
        Modelica.Mechanics.Rotational.Interfaces.Flange_b flange_b "Right flange of compliant 1-dim. rotational component"
          annotation (Placement(transformation(extent={{90,-10},{110,10}})));
      equation
        phi_rel = flange_b.phi - flange_a.phi;
        flange_b.tau = tau;
        flange_a.tau = -tau;
        annotation (Documentation(info="<html>
<p>
This is a 1-dim. rotational component with a compliant connection of two
rotational 1-dim. flanges where inertial effects between the two
flanges are neglected. The basic assumption is that the cut-torques
of the two flanges sum-up to zero, i.e., they have the same absolute value
but opposite sign: flange_a.tau + flange_b.tau = 0. This base class
is used to built up force elements such as springs, dampers, friction.
</p>
</html>"));
      end PartialCompliant;

      partial model PartialCompliantWithRelativeStates
        "Partial model for the compliant connection of two rotational 1-dim. shaft flanges where the relative angle and speed are used as preferred states"
        Modelica.Units.SI.Angle phi_rel(start=0, nominal=phi_nominal) "Relative rotation angle (= flange_b.phi - flange_a.phi)";
        Modelica.Units.SI.AngularVelocity w_rel(start=0) "Relative angular velocity (= der(phi_rel))";
        Modelica.Units.SI.AngularAcceleration a_rel(start=0) "Relative angular acceleration (= der(w_rel))";
        Modelica.Units.SI.Torque tau "Torque between flanges (= flange_b.tau)";
        Modelica.Mechanics.Rotational.Interfaces.Flange_a flange_a "Left flange of compliant 1-dim. rotational component"
          annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
        Modelica.Mechanics.Rotational.Interfaces.Flange_b flange_b "Right flange of compliant 1-dim. rotational component"
          annotation (Placement(transformation(extent={{90,-10},{110,10}})));
        parameter Modelica.Units.SI.Angle phi_nominal(displayUnit="rad", min=0.0) = 1e-4 "Nominal value of phi_rel (used for scaling)"
          annotation (Dialog(tab="Advanced"));
      equation
        phi_rel = flange_b.phi - flange_a.phi;
        w_rel = der(phi_rel);
        a_rel = der(w_rel);
        flange_b.tau = tau;
        flange_a.tau = -tau;
        annotation (Documentation(info="<html>
<p>
This is a 1-dim. rotational component with a compliant connection of two
rotational 1-dim. flanges where inertial effects between the two
flanges are neglected. The basic assumption is that the cut-torques
of the two flanges sum-up to zero, i.e., they have the same absolute value
but opposite sign: flange_a.tau + flange_b.tau = 0. This base class
is used to built up force elements such as springs, dampers, friction.
</p>
<p>
The relative angle and the relative speed are defined as states (w_rel = der(phi_rel)).
The stateSelect parameter of the Modelica Standard Library is not available on this platform.
</p>
</html>"));
      end PartialCompliantWithRelativeStates;

      partial model PartialElementaryOneFlangeAndSupport2
        "Partial model for a component with one rotational 1-dim. shaft flange and a support used for textual modeling, i.e., for elementary models"
        Modelica.Mechanics.Rotational.Interfaces.Flange_b flange "Flange of shaft"
          annotation (Placement(transformation(extent={{90,-10},{110,10}})));
      protected
        Modelica.Units.SI.Angle phi_support "Absolute angle of support flange";
      equation
        phi_support = 0;
        annotation (Documentation(info="<html>
<p>
This is a 1-dim. rotational component with one flange and a support/housing.
It is used to build up elementary components of a drive train with
equations in the text layer.
</p>
<p>
The component is internally fixed to ground (the conditional support connector of the
Modelica Standard Library, parameter useSupport, is not available on this platform).
</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Line(points={{-50,-120},{-30,-100}}),
              Line(points={{-30,-120},{-10,-100}}),
              Line(points={{-10,-120},{10,-100}}),
              Line(points={{10,-120},{30,-100}}),
              Line(points={{-30,-100},{30,-100}})}));
      end PartialElementaryOneFlangeAndSupport2;

      partial model PartialElementaryTwoFlangesAndSupport2
        "Partial model for a component with two rotational 1-dim. shaft flanges and a support used for textual modeling, i.e., for elementary models"
        Modelica.Mechanics.Rotational.Interfaces.Flange_a flange_a "Flange of left shaft"
          annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
        Modelica.Mechanics.Rotational.Interfaces.Flange_b flange_b "Flange of right shaft"
          annotation (Placement(transformation(extent={{90,-10},{110,10}})));
      protected
        Modelica.Units.SI.Angle phi_support "Absolute angle of support flange";
      equation
        phi_support = 0;
        annotation (Documentation(info="<html>
<p>
This is a 1-dim. rotational component with two flanges and a support/housing.
It is used to build up elementary components of a drive train with
equations in the text layer.
</p>
<p>
The component is internally fixed to ground (the conditional support connector of the
Modelica Standard Library, parameter useSupport, is not available on this platform).
</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Line(points={{-50,-120},{-30,-100}}),
              Line(points={{-30,-120},{-10,-100}}),
              Line(points={{-10,-120},{10,-100}}),
              Line(points={{10,-120},{30,-100}}),
              Line(points={{-30,-100},{30,-100}})}));
      end PartialElementaryTwoFlangesAndSupport2;

      partial model PartialTorque "Partial model of a torque acting at the flange (accelerates the flange)"
        extends Modelica.Mechanics.Rotational.Interfaces.PartialElementaryOneFlangeAndSupport2;
        Modelica.Units.SI.Angle phi "Angle of flange with respect to support (= flange.phi - support.phi)";
      equation
        phi = flange.phi - phi_support;
        annotation (
          Icon(
            coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}),
            graphics={
              Rectangle(
                extent={{-80,64},{80,-56}},
                lineColor={255,255,255},
                fillColor={255,255,255},
                fillPattern=FillPattern.Solid),
              Ellipse(
                extent={{-100,-100},{100,100}},
                lineColor={0,0,0},
                startAngle=40,
                endAngle=150,
                closure=EllipseClosure.None,
                origin={0,0}),
              Polygon(
                points={{90,50},{66,100},{40,74},{90,50}},
                fillPattern=FillPattern.Solid),
              Ellipse(
                extent={{-60,-60},{60,60}},
                lineColor={0,0,0},
                startAngle=40,
                endAngle=140,
                closure=EllipseClosure.None,
                origin={0,-120}),
              Line(
                points={{0,-60},{0,-100}}),
              Text(
                extent={{-150,150},{150,110}},
                textColor={0,0,255},
                textString="%name"),
              Polygon(
                points={{-54,-94},{-30,-78},{-44,-66},{-54,-94}},
                fillPattern=FillPattern.Solid),
              Line(points={{-50,-120},{-30,-100}}),
              Line(points={{-30,-120},{-10,-100}}),
              Line(points={{-10,-120},{10,-100}}),
              Line(points={{10,-120},{30,-100}}),
              Line(points={{-30,-100},{30,-100}})}),
          Documentation(info="<html>
<p>
Partial model of torque that accelerates the flange.
</p>
</html>"));
      end PartialTorque;

      partial model PartialAbsoluteSensor "Partial model to measure a single absolute flange variable"
        extends Modelica.Icons.RoundSensor;
        Modelica.Mechanics.Rotational.Interfaces.Flange_a flange "Flange of shaft from which sensor information shall be measured"
          annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
      equation
        0 = flange.tau;
        annotation (Documentation(info="<html>
<p>
This is a partial model of a 1-dim. rotational component with one flange of a shaft
in order to measure an absolute kinematic quantity in the flange
and to provide the measured signal as output signal for further processing
with the blocks of package Modelica.Blocks.
</p>
</html>"),
          Icon(
            coordinateSystem(preserveAspectRatio=true, extent={{-100.0,-100.0},{100.0,100.0}}),
            graphics={
              Line(points={{-70.0,0.0},{-90.0,0.0}}),
              Line(points={{70.0,0.0},{100.0,0.0}}, color={0,0,127}),
              Text(textColor={0,0,255},
                extent={{-150.0,80.0},{150.0,120.0}},
                textString="%name")}));
      end PartialAbsoluteSensor;

      partial model PartialRelativeSensor "Partial model to measure a single relative variable between two flanges"
        extends Modelica.Icons.RoundSensor;
        Modelica.Mechanics.Rotational.Interfaces.Flange_a flange_a "Left flange of shaft"
          annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
        Modelica.Mechanics.Rotational.Interfaces.Flange_b flange_b "Right flange of shaft"
          annotation (Placement(transformation(extent={{90,-10},{110,10}})));
      equation
        0 = flange_a.tau + flange_b.tau;
        annotation (Documentation(info="<html>
<p>
This is a partial model for 1-dim. rotational components with two rigidly connected
flanges in order to measure relative kinematic quantities
between the two flanges or the cut-torque in the flange and
to provide the measured signal as output signal for further processing
with the blocks of package Modelica.Blocks.
</p>
</html>"),
          Icon(
            coordinateSystem(preserveAspectRatio=true, extent={{-100.0,-100.0},{100.0,100.0}}),
            graphics={
              Line(points={{-70.0,0.0},{-90.0,0.0}}),
              Line(points={{70.0,0.0},{90.0,0.0}}),
              Text(textColor={0,0,255},
                extent={{-150,80},{150,120}},
                textString="%name")}));
      end PartialRelativeSensor;

      annotation (Documentation(info="<html>
<p>
This package contains connectors and partial models for 1-dim.
rotational mechanical components. The components of this package can
only be used as basic building elements for models.
</p>
</html>"));
    end Interfaces;

    package Icons "Icons for Rotational package"
      extends Modelica.Icons.IconsPackage;

      partial class Gear "Icon of a rotational gear"
        annotation (Icon(
            coordinateSystem(preserveAspectRatio=true, extent={{-100.0,-100.0},{100.0,100.0}}),
            graphics={
              Rectangle(
                origin={-35.0,60.0},
                fillColor={255,255,255},
                fillPattern=FillPattern.HorizontalCylinder,
                extent={{-15.0,-40.0},{15.0,40.0}}),
              Rectangle(
                origin={-35.0,0.0},
                fillColor={255,255,255},
                fillPattern=FillPattern.HorizontalCylinder,
                extent={{-15.0,-21.0},{15.0,21.0}}),
              Line(points={{-80.0,20.0},{-60.0,20.0}}),
              Line(points={{-80.0,-20.0},{-60.0,-20.0}}),
              Line(points={{-70.0,-20.0},{-70.0,-86.0}}),
              Line(points={{0.0,40.0},{0.0,-86.0}}),
              Line(points={{-10.0,40.0},{10.0,40.0}}),
              Line(points={{-10.0,80.0},{10.0,80.0}}),
              Line(points={{60.0,-20.0},{80.0,-20.0}}),
              Line(points={{60.0,20.0},{80.0,20.0}}),
              Line(points={{70.0,-20.0},{70.0,-86.0}}),
              Line(points={{70.0,-86.0},{-70.0,-86.0}}),
              Rectangle(
                origin={-75.0,0.0},
                lineColor={64,64,64},
                fillColor={191,191,191},
                fillPattern=FillPattern.HorizontalCylinder,
                extent={{-25.0,-10.0},{25.0,10.0}}),
              Rectangle(
                origin={75.0,0.0},
                lineColor={64,64,64},
                fillColor={191,191,191},
                fillPattern=FillPattern.HorizontalCylinder,
                extent={{-25.0,-10.0},{25.0,10.0}}),
              Rectangle(
                origin={-35.0,-19.0},
                fillColor={153,153,153},
                fillPattern=FillPattern.Solid,
                extent={{-15.0,-2.0},{15.0,2.0}}),
              Rectangle(
                origin={-35.0,-8.0},
                fillColor={204,204,204},
                fillPattern=FillPattern.Solid,
                extent={{-15.0,-3.0},{15.0,3.0}}),
              Rectangle(
                origin={-35.0,19.0},
                fillColor={204,204,204},
                fillPattern=FillPattern.Solid,
                extent={{-15.0,-2.0},{15.0,2.0}}),
              Rectangle(
                origin={-35.0,8.0},
                fillColor={255,255,255},
                fillPattern=FillPattern.Solid,
                extent={{-15.0,-3.0},{15.0,3.0}}),
              Rectangle(
                origin={0.0,60.0},
                lineColor={64,64,64},
                fillColor={191,191,191},
                fillPattern=FillPattern.HorizontalCylinder,
                extent={{-20.0,-10.0},{20.0,10.0}}),
              Rectangle(
                origin={-35.0,98.0},
                fillColor={153,153,153},
                fillPattern=FillPattern.Solid,
                extent={{-15.0,-2.0},{15.0,2.0}}),
              Rectangle(
                origin={-35.0,87.0},
                fillColor={204,204,204},
                fillPattern=FillPattern.Solid,
                extent={{-15.0,-3.0},{15.0,3.0}}),
              Rectangle(
                origin={-35.0,50.0},
                fillColor={204,204,204},
                fillPattern=FillPattern.Solid,
                extent={{-15.0,-4.0},{15.0,4.0}}),
              Rectangle(
                origin={-35.0,22.0},
                fillColor={102,102,102},
                fillPattern=FillPattern.Solid,
                extent={{-15.0,-2.0},{15.0,2.0}}),
              Rectangle(
                origin={-35.0,33.0},
                fillColor={153,153,153},
                fillPattern=FillPattern.Solid,
                extent={{-15.0,-3.0},{15.0,3.0}}),
              Rectangle(
                origin={-35.0,70.0},
                fillColor={255,255,255},
                fillPattern=FillPattern.Solid,
                extent={{-15.0,-4.0},{15.0,4.0}}),
              Rectangle(
                origin={35.0,60.0},
                fillColor={255,255,255},
                fillPattern=FillPattern.HorizontalCylinder,
                extent={{-15.0,-21.0},{15.0,21.0}}),
              Rectangle(
                origin={35.0,41.0},
                fillColor={153,153,153},
                fillPattern=FillPattern.Solid,
                extent={{-15.0,-2.0},{15.0,2.0}}),
              Rectangle(
                origin={35.0,52.0},
                fillColor={204,204,204},
                fillPattern=FillPattern.Solid,
                extent={{-15.0,-3.0},{15.0,3.0}}),
              Rectangle(
                origin={35.0,79.0},
                fillColor={204,204,204},
                fillPattern=FillPattern.Solid,
                extent={{-15.0,-2.0},{15.0,2.0}}),
              Rectangle(
                origin={35.0,68.0},
                fillColor={255,255,255},
                fillPattern=FillPattern.Solid,
                extent={{-15.0,-3.0},{15.0,3.0}}),
              Rectangle(
                origin={35.0,0.0},
                fillColor={255,255,255},
                fillPattern=FillPattern.HorizontalCylinder,
                extent={{-15.0,-40.0},{15.0,40.0}}),
              Rectangle(
                origin={35.0,38.0},
                fillColor={153,153,153},
                fillPattern=FillPattern.Solid,
                extent={{-15.0,-2.0},{15.0,2.0}}),
              Rectangle(
                origin={35.0,27.0},
                fillColor={204,204,204},
                fillPattern=FillPattern.Solid,
                extent={{-15.0,-3.0},{15.0,3.0}}),
              Rectangle(
                origin={35.0,-10.0},
                fillColor={204,204,204},
                fillPattern=FillPattern.Solid,
                extent={{-15.0,-4.0},{15.0,4.0}}),
              Rectangle(
                origin={35.0,-38.0},
                fillColor={102,102,102},
                fillPattern=FillPattern.Solid,
                extent={{-15.0,-2.0},{15.0,2.0}}),
              Rectangle(
                origin={35.0,-27.0},
                fillColor={153,153,153},
                fillPattern=FillPattern.Solid,
                extent={{-15.0,-3.0},{15.0,3.0}}),
              Rectangle(
                origin={35.0,10.0},
                fillColor={255,255,255},
                fillPattern=FillPattern.Solid,
                extent={{-15.0,-4.0},{15.0,4.0}}),
              Rectangle(
                origin={-35,40},
                fillColor={255,255,255},
                extent={{-15,-61},{15,60}}),
              Rectangle(
                origin={35,21},
                fillColor={255,255,255},
                extent={{-15,-61},{15,60}})}), Documentation(info="<html>
<p>
This is the icon of a gear from the rotational package.
</p>
</html>"));
      end Gear;
    end Icons;

    annotation (Documentation(info="<html>
<p>
Library <strong>Rotational</strong> is a <strong>free</strong> Modelica package providing
1-dimensional, rotational mechanical components to model in a convenient way
drive trains with frictional losses.
</p>
<p>
On this platform the components are always implicitly fixed to ground (no support connectors)
and have no optional heat ports. Dissipated power is available as variable lossPower of the
damping components.
</p>
<p>
Copyright &copy; 1998-2020, Modelica Association and contributors
</p>
</html>"), Icon(
      coordinateSystem(preserveAspectRatio=true, extent={{-100.0,-100.0},{100.0,100.0}}),
      graphics={
        Line(origin={-2.0,46.0},
          points={{-83.0,-66.0},{-63.0,-66.0}}),
        Line(origin={29.0,48.0},
          points={{36.0,-68.0},{56.0,-68.0}}),
        Line(origin={-2.0,49.0},
          points={{-83.0,-29.0},{-63.0,-29.0}}),
        Line(origin={29.0,52.0},
          points={{36.0,-32.0},{56.0,-32.0}}),
        Line(origin={-2.0,49.0},
          points={{-73.0,-9.0},{-73.0,-29.0}}),
        Line(origin={29.0,52.0},
          points={{46.0,-12.0},{46.0,-32.0}}),
        Line(origin={-0.0,-47.5},
          points={{-75.0,27.5},{-75.0,-27.5},{75.0,-27.5},{75.0,27.5}}),
        Rectangle(origin={13.5135,76.9841},
          lineColor={64,64,64},
          fillColor={255,255,255},
          fillPattern=FillPattern.HorizontalCylinder,
          extent={{-63.5135,-126.9841},{36.4865,-26.9841}},
          radius=10.0),
        Rectangle(origin={13.5135,76.9841},
          lineColor={64,64,64},
          extent={{-63.5135,-126.9841},{36.4865,-26.9841}},
          radius=10.0),
        Rectangle(origin={-3.0,73.0769},
          lineColor={64,64,64},
          fillColor={192,192,192},
          fillPattern=FillPattern.HorizontalCylinder,
          extent={{-87.0,-83.0769},{-47.0,-63.0769}}),
        Rectangle(origin={22.3077,70.0},
          lineColor={64,64,64},
          fillColor={192,192,192},
          fillPattern=FillPattern.HorizontalCylinder,
          extent={{27.6923,-80.0},{67.6923,-60.0}})}));
  end Rotational;

  package Translational "Library to model 1-dimensional, translational mechanical systems"
    extends Modelica.Icons.Package;

    package Examples "Demonstration examples of the components of this package"
      extends Modelica.Icons.ExamplesPackage;

      model Oscillator "Oscillator demonstrates the use of initial conditions"
        extends Modelica.Icons.Example;
        Modelica.Mechanics.Translational.Components.Mass mass1(
          L=1,
          s(start=-0.5, fixed=true),
          v(start=0, fixed=true),
          m=1) annotation (Placement(transformation(extent={{-20,20},{0,40}})));
        Modelica.Mechanics.Translational.Components.Spring spring1(s_rel0=1, c=10000)
          annotation (Placement(transformation(extent={{20,20},{40,40}})));
        Modelica.Mechanics.Translational.Components.Fixed fixed1(s0=1)
          annotation (Placement(transformation(extent={{60,20},{80,40}})));
        Modelica.Mechanics.Translational.Sources.Force force1
          annotation (Placement(transformation(extent={{-60,20},{-40,40}})));
        Modelica.Blocks.Sources.Sine sine1(f=15.9155)
          annotation (Placement(transformation(extent={{-100,20},{-80,40}})));
        Modelica.Mechanics.Translational.Components.Mass mass2(
          L=1,
          s(start=-0.5, fixed=true),
          v(start=0, fixed=true),
          m=1) annotation (Placement(transformation(extent={{-20,-40},{0,-20}})));
        Modelica.Mechanics.Translational.Components.Spring spring2(s_rel0=1, c=10000)
          annotation (Placement(transformation(extent={{20,-50},{40,-30}})));
        Modelica.Mechanics.Translational.Components.Fixed fixed2(s0=1)
          annotation (Placement(transformation(extent={{60,-40},{80,-20}})));
        Modelica.Mechanics.Translational.Sources.Force force2
          annotation (Placement(transformation(extent={{-60,-40},{-40,-20}})));
        Modelica.Blocks.Sources.Sine sine2(f=15.9155)
          annotation (Placement(transformation(extent={{-100,-40},{-80,-20}})));
        Modelica.Mechanics.Translational.Components.Damper damper1(d=10)
          annotation (Placement(transformation(extent={{20,-30},{40,-10}})));
      equation
        connect(mass1.flange_b, spring1.flange_a) annotation (Line(points={{0,30},{20,30}}, color={0,127,0}));
        connect(spring2.flange_a, damper1.flange_a) annotation (Line(points={{20,-40},{10,-40},{10,-20},{20,-20}}, color={0,127,0}));
        connect(mass2.flange_b, spring2.flange_a) annotation (Line(points={{0,-30},{10,-30},{10,-40},{20,-40}}, color={0,127,0}));
        connect(damper1.flange_b, spring2.flange_b) annotation (Line(points={{40,-20},{50,-20},{50,-40},{40,-40}}, color={0,127,0}));
        connect(sine1.y, force1.f) annotation (Line(points={{-79,30},{-62,30}}, color={0,0,127}));
        connect(sine2.y, force2.f) annotation (Line(points={{-79,-30},{-62,-30}}, color={0,0,127}));
        connect(spring1.flange_b, fixed1.flange) annotation (Line(points={{40,30},{70,30}}, color={0,127,0}));
        connect(force2.flange, mass2.flange_a) annotation (Line(points={{-40,-30},{-20,-30}}, color={0,127,0}));
        connect(force1.flange, mass1.flange_a) annotation (Line(points={{-40,30},{-20,30}}, color={0,127,0}));
        connect(spring2.flange_b, fixed2.flange) annotation (Line(points={{40,-40},{50,-40},{50,-30},{70,-30}}, color={0,127,0}));
        annotation (Documentation(info="<html>
<p>
A spring - mass system is a mechanical oscillator. If no
damping is included and the system is excited at resonance
frequency infinite amplitudes will result.
The resonant frequency is given by
omega_res&nbsp;=&nbsp;sqrt(c&nbsp;/&nbsp;m)
with:
</p>
<blockquote>
  c &hellip; spring stiffness and<br>
  m &hellip; mass.
</blockquote>
<p>
To make sure that the system is initially at rest the initial
conditions s(start=-0.5) and v(start=0) for the sliding masses
are set.
If damping is added the amplitudes are bounded.
</p>
</html>"),
          experiment(StopTime=1.0, Interval=0.001));
        // balance (flattened): 50 unknowns (mass1 7, spring1 6, fixed1 2, force1 5, sine1 1, mass2 7, spring2 6,
        // fixed2 2, force2 5, sine2 1, damper1 8), 50 equations (34 component equations, 2 signal connections,
        // 14 flange connection equations from 6 connection sets with 14 flanges)
      end Oscillator;

      annotation (Documentation(info="<html>
<p>
This package contains example models to demonstrate the usage of the
Translational package. Open the models and
simulate them according to the provided description in the models.
</p>
</html>"));
    end Examples;

    package Components "Components for 1D translational mechanical drive trains"
      extends Modelica.Icons.Package;

      model Fixed "Fixed flange"
        parameter Modelica.Units.SI.Position s0=0 "Fixed offset position of housing";
        Modelica.Mechanics.Translational.Interfaces.Flange_b flange annotation (Placement(transformation(
              extent={{-10,10},{10,-10}},
              rotation=180)));
      equation
        flange.s = s0;
        annotation (Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Line(points={{-80,-40},{80,-40}}, color={0,127,0}),
              Line(points={{80,-40},{40,-80}}, color={0,127,0}),
              Line(points={{40,-40},{0,-80}}, color={0,127,0}),
              Line(points={{0,-40},{-40,-80}}, color={0,127,0}),
              Line(points={{-40,-40},{-80,-80}}, color={0,127,0}),
              Line(points={{0,-40},{0,-10}}, color={0,127,0}),
              Text(
                extent={{-150,-90},{150,-130}},
                textString="%name",
                textColor={0,0,255})}), Documentation(info="<html>
<p>
The <em>flange</em> of a 1D translational mechanical system <em>fixed</em>
at an position s0 in the <em>housing</em>. May be used:
</p>
<ul>
<li> to connect a compliant element, such as a spring or a damper,
     between a sliding mass and the housing.</li>
<li> to fix a rigid element, such as a sliding mass, at a specific
     position.</li>
</ul>
</html>"));
        // balance: 2 unknowns (flange.s, flange.f), 1 flow variable provided by connection, 1 equation
      end Fixed;

      model Mass "Sliding mass with inertia"
        parameter Modelica.Units.SI.Mass m(min=0, start=1) "Mass of the sliding mass";
        extends Modelica.Mechanics.Translational.Interfaces.PartialRigid(L=0, s(start=0));
        Modelica.Units.SI.Velocity v(start=0) "Absolute velocity of component";
        Modelica.Units.SI.Acceleration a(start=0) "Absolute acceleration of component";
      equation
        v = der(s);
        a = der(v);
        m*a = flange_a.f + flange_b.f;
        annotation (
          Documentation(info="<html>
<p>
Sliding mass with <em>inertia, without friction</em> and two rigidly connected flanges.
</p>
<p>
The sliding mass has the length L, the position coordinate s is in the middle.
Sign convention: A positive force at flange flange_a moves the sliding mass in the positive direction.
A negative force at flange flange_a moves the sliding mass to the negative direction.
</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Line(points={{-100,0},{100,0}}, color={0,127,0}),
              Rectangle(
                extent={{-55,-30},{56,30}},
                fillPattern=FillPattern.Sphere,
                fillColor={160,215,160},
                lineColor={0,127,0}),
              Polygon(
                points={{50,-90},{20,-80},{20,-100},{50,-90}},
                lineColor={95,127,95},
                fillColor={95,127,95},
                fillPattern=FillPattern.Solid),
              Line(points={{-60,-90},{20,-90}}, color={95,127,95}),
              Text(
                extent={{-150,85},{150,45}},
                textString="%name",
                textColor={0,0,255}),
              Text(
                extent={{-150,-45},{150,-75}},
                textString="m=%m",
                fontSize=0)}));
        // balance: 7 unknowns (flange_a.s, flange_a.f, flange_b.s, flange_b.f, s, v, a), 2 flow variables provided
        // by connections, 5 equations (2 PartialRigid + 3)
      end Mass;

      model Rod "Rod without inertia"
        extends Modelica.Mechanics.Translational.Interfaces.PartialRigid;
      equation
        0 = flange_a.f + flange_b.f;
        annotation (
          Documentation(info="<html>
<p>
A translational rod <strong>without inertia</strong> and two rigidly connected flanges.
</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Line(points={{-100,0},{100,0}}, color={0,127,0}),
              Polygon(
                points={{50,-90},{20,-80},{20,-100},{50,-90}},
                lineColor={95,127,95},
                fillColor={95,127,95},
                fillPattern=FillPattern.Solid),
              Line(points={{-60,-90},{20,-90}}, color={95,127,95}),
              Rectangle(
                extent={{-60,10},{60,-10}},
                lineColor={0,127,0},
                fillColor={160,215,160},
                fillPattern=FillPattern.Solid),
              Text(
                extent={{-150,80},{150,40}},
                textString="%name",
                textColor={0,0,255}),
              Text(
                extent={{-150,-30},{150,-60}},
                textString="L=%L")}));
        // balance: 5 unknowns (4 flange variables, s), 2 flow variables provided by connections, 3 equations (2 PartialRigid + 1)
      end Rod;

      model Spring "Linear 1D translational spring"
        extends Modelica.Mechanics.Translational.Interfaces.PartialCompliant;
        parameter Modelica.Units.SI.TranslationalSpringConstant c(final min=0, start=1) "Spring constant";
        parameter Modelica.Units.SI.Distance s_rel0=0 "Unstretched spring length";
      equation
        f = c*(s_rel - s_rel0);
        annotation (
          Documentation(info="<html>
<p>
A <em>linear 1D translational spring</em>. The component can be connected either
between two sliding masses, or between
a sliding mass and the housing (model Fixed), to describe
a coupling of the sliding mass with the housing via a spring.
</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Line(points={{-60,-90},{20,-90}}, color={95,127,95}),
              Polygon(
                points={{50,-90},{20,-80},{20,-100},{50,-90}},
                lineColor={95,127,95},
                fillColor={95,127,95},
                fillPattern=FillPattern.Solid),
              Text(
                extent={{-150,90},{150,50}},
                textString="%name",
                textColor={0,0,255}),
              Line(points={{-98,0},{-60,0},{-44,-30},{-16,30},{14,-30},{44,30},{60,0},{100,0}}, color={0,127,0}),
              Text(
                extent={{-150,-45},{150,-75}},
                textString="c=%c")}));
        // balance: 6 unknowns (4 flange variables, s_rel, f), 2 flow variables provided by connections, 4 equations
      end Spring;

      model Damper "Linear 1D translational damper"
        extends Modelica.Mechanics.Translational.Interfaces.PartialCompliantWithRelativeStates;
        parameter Modelica.Units.SI.TranslationalDampingConstant d(final min=0, start=0) "Damping constant";
        Modelica.Units.SI.Power lossPower "Loss power leaving component via heatPort (dissipated)";
      equation
        f = d*v_rel;
        lossPower = f*v_rel;
        annotation (
          Documentation(info="<html>
<p>
<em>Linear, velocity dependent damper</em> element. It can be either connected
between a sliding mass and the housing (model Fixed), or
between two sliding masses.
</p>
<p>
The optional heat port of the Modelica Standard Library is not available on this platform;
the dissipated power is available as variable lossPower.
</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Line(points={{-90,0},{100,0}}, color={0,127,0}),
              Line(points={{-60,-30},{-60,30}}),
              Rectangle(
                extent={{-60,30},{30,-30}},
                fillColor={192,192,192},
                fillPattern=FillPattern.Solid,
                lineColor={0,127,0}),
              Polygon(
                points={{50,-90},{20,-80},{20,-100},{50,-90}},
                lineColor={95,127,95},
                fillColor={95,127,95},
                fillPattern=FillPattern.Solid),
              Line(points={{-60,-90},{20,-90}}, color={95,127,95}),
              Text(
                extent={{-150,90},{150,50}},
                textString="%name",
                textColor={0,0,255}),
              Text(
                extent={{-150,-45},{150,-75}},
                textString="d=%d"),
              Line(points={{60,-30},{-60,-30},{-60,30},{60,30}}, color={0,127,0})}));
        // balance: 8 unknowns (flange_a.s, flange_a.f, flange_b.s, flange_b.f, s_rel, v_rel, f, lossPower),
        // 2 flow variables provided by connections, 6 equations (4 base + 2)
      end Damper;

      model SpringDamper "Linear 1D translational spring and damper in parallel"
        extends Modelica.Mechanics.Translational.Interfaces.PartialCompliantWithRelativeStates;
        parameter Modelica.Units.SI.TranslationalSpringConstant c(final min=0, start=1) "Spring constant";
        parameter Modelica.Units.SI.TranslationalDampingConstant d(final min=0, start=1) "Damping constant";
        parameter Modelica.Units.SI.Position s_rel0=0 "Unstretched spring length";
        Modelica.Units.SI.Power lossPower "Loss power leaving component via heatPort (dissipated)";
      protected
        Modelica.Units.SI.Force f_c "Spring force";
        Modelica.Units.SI.Force f_d "Damping force";
      equation
        f_c = c*(s_rel - s_rel0);
        f_d = d*v_rel;
        f = f_c + f_d;
        lossPower = f_d*v_rel;
        annotation (
          Documentation(info="<html>
<p>
A <em>spring and damper element connected in parallel</em>.
The component can be
connected either between two sliding masses to describe the elasticity
and damping, or between a sliding mass and the housing (model Fixed),
to describe a coupling of the sliding mass with the housing via a spring/damper.
</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Line(points={{-80,40},{-60,40},{-45,10},{-15,70},{15,10},{45,70},{60,40},{80,40}}, color={0,127,0}),
              Line(points={{-80,40},{-80,-70},{80,-70},{80,40}}, color={0,127,0}),
              Line(points={{-90,0},{-80,0}}, color={0,127,0}),
              Line(points={{80,0},{90,0}}, color={0,127,0}),
              Polygon(
                points={{53,-20},{23,-10},{23,-30},{53,-20}},
                lineColor={95,127,95},
                fillColor={95,127,95},
                fillPattern=FillPattern.Solid),
              Line(points={{-57,-20},{23,-20}}, color={95,127,95}),
              Text(
                extent={{-150,120},{150,80}},
                textString="%name",
                textColor={0,0,255}),
              Text(
                extent={{-150,-135},{150,-165}},
                textString="d=%d"),
              Text(
                extent={{-150,-100},{150,-130}},
                textString="c=%c"),
              Rectangle(
                extent={{-50,-50},{40,-90}},
                fillColor={192,192,192},
                fillPattern=FillPattern.Solid,
                lineColor={0,127,0}),
              Line(points={{70,-90},{-50,-90},{-50,-50},{70,-50}}, color={0,127,0})}));
        // balance: 10 unknowns (4 flange variables, s_rel, v_rel, f, lossPower, f_c, f_d), 2 flow variables provided
        // by connections, 8 equations (4 base + 4)
      end SpringDamper;

      model ElastoGap "1D translational spring damper combination with gap"
        extends Modelica.Mechanics.Translational.Interfaces.PartialCompliantWithRelativeStates;
        parameter Modelica.Units.SI.TranslationalSpringConstant c(final min=0, start=1) "Spring constant";
        parameter Modelica.Units.SI.TranslationalDampingConstant d(final min=0, start=1) "Damping constant";
        parameter Modelica.Units.SI.Position s_rel0=0 "Unstretched spring length";
        parameter Modelica.Units.SI.Force f_ref(min=0) = c*s_ref "Reference spring force at s_ref" annotation (Dialog(tab="Advanced"));
        parameter Modelica.Units.SI.Length s_ref(min=Modelica.Constants.eps) = 1 "Reference relative compression at which f_c = f_ref" annotation (Dialog(tab="Advanced"));
        parameter Real n(final min=1) = 1 "Exponent of spring force ( f_c = -f_ref*|(s_rel-s_rel0)/s_ref|^n )";
        Modelica.Units.SI.Power lossPower "Loss power leaving component via heatPort (dissipated)";
        Boolean contact "= true, if contact, otherwise no contact";
      protected
        Modelica.Units.SI.Force f_c "Spring force";
        Modelica.Units.SI.Force f_d2 "Linear damping force";
        Modelica.Units.SI.Force f_d "Linear damping force which is limited by spring force (|f_d| <= |f_c|)";
        Real ratio "Scaling ratio of relative compression to s_ref";
      equation
        // Modify contact force, so that it is only "pushing" and not
        // "pulling/sticking" and that it is continuous
        contact = s_rel < s_rel0;
        ratio = (s_rel - s_rel0)/s_ref;
        f_c = if contact then -f_ref*abs(ratio)^n else 0;
        f_d2 = if contact then d*v_rel else 0;
        f_d = if contact then min(max(f_d2, f_c), -f_c) else 0;
        f = f_c + f_d;
        lossPower = f_d*v_rel;
        annotation (
          Documentation(info="<html>
<p>
This component models a spring damper combination that can lift off.
It can be connected between a sliding mass and the housing (model
<a href=\"modelica://Modelica.Mechanics.Translational.Components.Fixed\">Fixed</a>),
to describe the contact of a sliding mass with the housing.
</p>
<p>
As long as s_rel &gt; s_rel0, no force is exerted (s_rel = flange_b.s - flange_a.s).
If s_rel &le; s_rel0, the contact force is basically computed with a linear
spring/damper characteristic. With parameter n&ge;1 (exponent of spring force),
a nonlinear spring force can be modeled:
</p>
<blockquote><pre>
desiredContactForce = f_ref*|(s_rel - s_rel0)/s_ref|^n + d*<strong>der</strong>(s_rel)
</pre></blockquote>
<p>
The damper force is limited by the spring force (|f_d| &le; |f_c|) so that pulling forces
cannot occur and the contact force is continuous.
</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Line(points={{-98,0},{-48,0}}, color={0,127,0}),
              Line(
                points={{-48,36},{-48,-38}},
                thickness=1,
                color={0,127,0}),
              Line(
                points={{-12,-38},{-12,36}},
                thickness=1,
                color={0,127,0}),
              Line(points={{-12,-28},{70,-28},{70,24}}, color={0,127,0}),
              Line(points={{70,0},{98,0}}, color={0,127,0}),
              Line(points={{-12,24},{0,24},{6,34},{18,14},{30,34},{42,14},{54,34},{60,24},{70,24}}, color={0,127,0}),
              Rectangle(
                extent={{10,-6},{50,-50}},
                fillColor={192,192,192},
                fillPattern=FillPattern.Solid,
                lineColor={0,127,0}),
              Line(points={{-52,-70},{28,-70}}, color={95,127,95}),
              Polygon(
                points={{58,-70},{28,-60},{28,-80},{58,-70}},
                lineColor={95,127,95},
                fillColor={95,127,95},
                fillPattern=FillPattern.Solid),
              Text(
                extent={{-150,100},{150,60}},
                textString="%name",
                textColor={0,0,255}),
              Text(
                extent={{-150,-125},{150,-95}},
                textString="c=%c"),
              Text(
                extent={{-150,-160},{150,-130}},
                textString="d=%d"),
              Line(points={{0,-50},{50,-50},{50,-6},{0,-6}}, color={0,127,0})}));
        // balance: 13 unknowns (4 flange variables, s_rel, v_rel, f, lossPower, contact, f_c, f_d2, f_d, ratio),
        // 2 flow variables provided by connections, 11 equations (4 base + 7)
      end ElastoGap;

      annotation (Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Rectangle(
              origin={11.5,31.183},
              lineColor={64,64,64},
              fillColor={255,255,255},
              fillPattern=FillPattern.Sphere,
              extent={{-67,-66},{44,-6}})}), Documentation(info="<html>
<p>
This package contains basic components 1D mechanical translational drive trains.
</p>
</html>"));
    end Components;

    package Sources "Sources to drive 1D translational mechanical components"
      extends Modelica.Icons.SourcesPackage;

      model Force "External force acting on a drive train element as input signal"
        extends Modelica.Mechanics.Translational.Interfaces.PartialElementaryOneFlangeAndSupport2;
        Modelica.Blocks.Interfaces.RealInput f(unit="N") "Driving force as input signal"
          annotation (Placement(transformation(extent={{-140,-20},{-100,20}})));
      equation
        flange.f = -f;
        annotation (
          Documentation(info="<html>
<p>
The input signal &quot;f&quot; in [N] characterizes an <em>external
force</em> which acts (with positive sign) at a flange,
i.e., the component connected to the flange is driven by force f.
</p>
<p>
Input signal f can be provided from one of the signal generator
blocks of Modelica.Blocks.Source.
</p>
</html>"),
          Icon(
            coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}),
            graphics={
              Line(points={{0,-60},{0,-101}}, color={0,127,0}),
              Polygon(
                points={{-100,10},{20,10},{20,41},{90,0},{20,-41},{20,-10},{-100,-10},{-100,10}},
                lineColor={0,127,0},
                fillColor={160,215,160},
                fillPattern=FillPattern.Solid),
              Text(
                extent={{-150,-32},{-80,-62}},
                textString="f"),
              Text(
                extent={{-150,90},{150,50}},
                textString="%name",
                textColor={0,0,255}),
              Polygon(
                points={{50,-54},{-30,-54},{-30,-46},{-60,-60},{-30,-74},{-30,-66},{50,-66},{50,-54}},
                lineColor={0,127,0},
                fillColor={160,215,160},
                fillPattern=FillPattern.Solid)}));
        // balance: 5 unknowns (flange.s, flange.f, s, s_support, f), 1 flow variable and 1 input provided by
        // connections, 3 equations (2 base + 1)
      end Force;

      model ConstantForce "Constant force, not dependent on speed"
        extends Modelica.Mechanics.Translational.Interfaces.PartialForce;
        parameter Modelica.Units.SI.Force f_constant "Nominal force (if negative, force is acting as load in positive direction of motion)";
      equation
        f = -f_constant;
        annotation (
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Line(points={{-75,10},{75,10}}, color={192,192,192}),
              Line(points={{0,60},{0,0}}, color={192,192,192}),
              Line(points={{-75,30},{75,30}}, color={0,0,127}),
              Text(extent={{-120,-40},{120,-10}}, textString="%f_constant")}),
          Documentation(info="<html>
<p>Model of constant force, not dependent on velocity of flange.</p>
<p>Please note:<br>
Positive force accelerates in positive direction of movement, but brakes in reverse direction of movement.<br>
Negative force brakes in positive direction of movement, but accelerates in reverse direction of movement.</p>
</html>"));
        // balance: 5 unknowns (flange.s, flange.f, s, s_support, f), 1 flow variable provided by connection,
        // 4 equations (3 base + 1)
      end ConstantForce;

      annotation (Documentation(info="<html>
<p>
This package contains ideal sources to drive 1D mechanical translational drive trains.
</p>
</html>"));
    end Sources;

    package Sensors "Sensors for 1-dim. translational mechanical quantities"
      extends Modelica.Icons.SensorsPackage;

      model PositionSensor "Ideal sensor to measure the absolute position of flange"
        extends Modelica.Mechanics.Translational.Interfaces.PartialAbsoluteSensor;
        Modelica.Blocks.Interfaces.RealOutput s(unit="m") "Absolute position of flange as output signal"
          annotation (Placement(transformation(extent={{100,-11},{120,9}}), iconTransformation(extent={{100,-10},{120,10}})));
      equation
        s = flange.s;
        annotation (
          Documentation(info="<html>
<p>
Measures the <em>absolute position</em>
of a&nbsp;flange in an ideal way and provides the result as
output signal&nbsp;<code>s</code>
(to be further processed with blocks of the
<a href=\"modelica://Modelica.Blocks\">Modelica.Blocks</a> library).
</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Text(
                extent={{-24,20},{66,-40}},
                textColor={64,64,64},
                textString="m")}));
        // balance: 3 unknowns (flange.s, flange.f, s), 1 flow variable provided by connection, 2 equations
      end PositionSensor;

      model SpeedSensor "Ideal sensor to measure the absolute velocity of flange"
        extends Modelica.Mechanics.Translational.Interfaces.PartialAbsoluteSensor;
        Modelica.Blocks.Interfaces.RealOutput v(unit="m/s") "Absolute velocity of flange as output signal"
          annotation (Placement(transformation(extent={{100,-10},{120,10}})));
      equation
        v = der(flange.s);
        annotation (
          Documentation(info="<html>
<p>
Measures the <em>absolute velocity</em>
of a&nbsp;flange in an ideal way and provides the result as
output signal&nbsp;<code>v</code>
(to be further processed with blocks of the
<a href=\"modelica://Modelica.Blocks\">Modelica.Blocks</a> library).
</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Text(
                extent={{-24,20},{66,-40}},
                textColor={64,64,64},
                textString="m/s")}));
        // balance: 3 unknowns (flange.s, flange.f, v), 1 flow variable provided by connection, 2 equations
      end SpeedSensor;

      model AccSensor "Ideal sensor to measure the absolute acceleration of flange"
        extends Modelica.Mechanics.Translational.Interfaces.PartialAbsoluteSensor;
        Modelica.Units.SI.Velocity v "Absolute velocity of flange";
        Modelica.Blocks.Interfaces.RealOutput a(unit="m/s2") "Absolute acceleration of flange as output signal"
          annotation (Placement(transformation(extent={{100,-10},{120,10}})));
      equation
        v = der(flange.s);
        a = der(v);
        annotation (
          Documentation(info="<html>
<p>
Measures the <em>absolute acceleration</em>
of a&nbsp;flange in an ideal way and provides the result as
output signal&nbsp;<code>a</code>
(to be further processed with blocks of the
<a href=\"modelica://Modelica.Blocks\">Modelica.Blocks</a> library).
</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Text(
                extent={{-24,20},{66,-40}},
                textColor={64,64,64},
                textString="m/s2")}));
        // balance: 4 unknowns (flange.s, flange.f, v, a), 1 flow variable provided by connection, 3 equations
      end AccSensor;

      model ForceSensor "Ideal sensor to measure the force between two flanges"
        extends Modelica.Mechanics.Translational.Interfaces.PartialRelativeSensor;
        Modelica.Blocks.Interfaces.RealOutput f(unit="N") "Force in flange_a and flange_b (f = flange_a.f = -flange_b.f) as output signal"
          annotation (Placement(transformation(
              origin={-80,-110},
              extent={{10,-10},{-10,10}},
              rotation=90)));
      equation
        flange_a.s = flange_b.s;
        flange_a.f = f;
        annotation (
          Documentation(info="<html>
<p>
Measures the <em>cut-force</em> between two flanges
in an ideal way and provides the result as output signal&nbsp;<code>f</code>
(to be further processed with blocks of the
<a href=\"modelica://Modelica.Blocks\">Modelica.Blocks</a> library).
</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Line(points={{-80,-100},{-80,0}}, color={0,0,127}),
              Text(
                extent={{-24,20},{66,-40}},
                textColor={64,64,64},
                textString="N")}));
        // balance: 5 unknowns (4 flange variables, f), 2 flow variables provided by connections, 3 equations (1 base + 2)
      end ForceSensor;

      model RelPositionSensor "Ideal sensor to measure the relative position between two flanges"
        extends Modelica.Mechanics.Translational.Interfaces.PartialRelativeSensor;
        Modelica.Blocks.Interfaces.RealOutput s_rel(unit="m") "Relative distance between two flanges (= flange_b.s - flange_a.s) as output signal"
          annotation (Placement(transformation(
              extent={{-10,-10},{10,10}},
              rotation=270,
              origin={0,-110})));
      equation
        s_rel = flange_b.s - flange_a.s;
        0 = flange_a.f;
        annotation (
          Documentation(info="<html>
<p>
Measures the <em>relative position</em> between two flanges
in an ideal way and provides the result as output signal <code>s_rel</code>
(to be further processed with blocks of the
<a href=\"modelica://Modelica.Blocks\">Modelica.Blocks</a> library).
</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Line(points={{0,-99},{0,-60}}, color={0,0,127}),
              Text(
                extent={{-24,20},{66,-40}},
                textColor={64,64,64},
                textString="m")}));
        // balance: 5 unknowns (4 flange variables, s_rel), 2 flow variables provided by connections, 3 equations (1 base + 2)
      end RelPositionSensor;

      model RelSpeedSensor "Ideal sensor to measure the relative velocity between two flanges"
        extends Modelica.Mechanics.Translational.Interfaces.PartialRelativeSensor;
        Modelica.Units.SI.Position s_rel "Relative distance between two flanges (flange_b.s - flange_a.s)";
        Modelica.Blocks.Interfaces.RealOutput v_rel(unit="m/s") "Relative velocity between two flanges (= der(flange_b.s) - der(flange_a.s)) as output signal"
          annotation (Placement(transformation(
              extent={{-10,-10},{10,10}},
              rotation=270,
              origin={0,-110})));
      equation
        s_rel = flange_b.s - flange_a.s;
        v_rel = der(s_rel);
        0 = flange_a.f;
        annotation (
          Documentation(info="<html>
<p>
Measures the <em>relative velocity</em> between two flanges
in an ideal way and provides the result as output signal <code>v_rel</code>
(to be further processed with blocks of the
<a href=\"modelica://Modelica.Blocks\">Modelica.Blocks</a> library).
</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Line(points={{0,-100},{0,-61}}, color={0,0,127}),
              Text(
                extent={{-24,20},{66,-40}},
                textColor={64,64,64},
                textString="m/s")}));
        // balance: 6 unknowns (4 flange variables, s_rel, v_rel), 2 flow variables provided by connections, 4 equations (1 base + 3)
      end RelSpeedSensor;

      annotation (Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
            Line(points={{-56,-61},{-56,-81}}),
            Line(points={{-36,-61},{-36,-81}}),
            Line(points={{-16,-61},{-16,-81}}),
            Line(points={{4,-61},{4,-81}}),
            Line(points={{24,-61},{24,-81}}),
            Line(points={{44,-61},{44,-81}})}), Documentation(info="<html>
<p>
This package contains ideal sensor components that provide
the connector variables as signals for further processing with the
<a href=\"modelica://Modelica.Blocks\">Modelica.Blocks</a> library.
</p>
</html>"));
    end Sensors;

    package Interfaces "Interfaces for 1-dim. translational mechanical components"
      extends Modelica.Icons.InterfacesPackage;

      connector Flange "One-dimensional translational flange"
        Modelica.Units.SI.Position s "Absolute position of flange";
        flow Modelica.Units.SI.Force f "Cut force directed into flange";
        annotation (Documentation(info="<html>
<p>
This is a connector for 1D translational mechanical systems.
It has no icon definition and is only used by inheritance from
flange connectors to define different icons.
</p>
<p>
The following variables are defined in this connector:
</p>
<blockquote><pre>
s: Absolute position of the flange in [m]. A positive translation
   means that the flange is translated along the flange axis.
f: Cut-force in direction of the flange axis in [N].
</pre></blockquote>
</html>"));
      end Flange;

      connector Flange_a "One-dimensional translational flange (left, flange axis directed INTO cut plane)"
        extends Modelica.Mechanics.Translational.Interfaces.Flange;
        annotation (
          defaultComponentName="flange_a",
          Documentation(info="<html>
<p>
This is a connector for 1-dim. translational mechanical systems which represents
a mechanical flange. In the cut plane of
the flange a unit vector n, called flange axis, is defined which is directed
INTO the cut plane, i. e. from left to right. All vectors in the cut plane are
resolved with respect to
this unit vector. E.g. force f characterizes a vector which is directed in
the direction of n with value equal to f.
</p>
<p>
The following variables are transported through this connector:
</p>
<blockquote><pre>
s: Absolute position of the flange in [m]. A positive translation
   means that the flange is translated along the flange axis.
f: Cut-force in direction of the flange axis in [N].
</pre></blockquote>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Rectangle(
                extent={{-100,-100},{100,100}},
                lineColor={0,127,0},
                fillColor={0,127,0},
                fillPattern=FillPattern.Solid)}),
          Diagram(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Rectangle(
                extent={{-40,-40},{40,40}},
                lineColor={0,127,0},
                fillColor={0,127,0},
                fillPattern=FillPattern.Solid), Text(
                extent={{-160,110},{40,50}},
                textColor={0,127,0},
                textString="%name")}));
      end Flange_a;

      connector Flange_b "One-dimensional translational flange (right, flange axis directed OUT OF cut plane)"
        extends Modelica.Mechanics.Translational.Interfaces.Flange;
        annotation (
          defaultComponentName="flange_b",
          Documentation(info="<html>
<p>
This is a connector for 1-dim. translational mechanical systems which represents
a mechanical flange. In the cut plane of
the flange a unit vector n, called flange axis, is defined which is directed
OUT OF the cut plane. All vectors in the cut plane are resolved with respect to
this unit vector. E.g. force f characterizes a vector which is directed in
the direction of n with value equal to f.
</p>
<p>
The following variables are transported through this connector:
</p>
<blockquote><pre>
s: Absolute position of the flange in [m]. A positive translation
   means that the flange is translated along the flange axis.
f: Cut-force in direction of the flange axis in [N].
</pre></blockquote>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Rectangle(
                extent={{-100,-100},{100,100}},
                lineColor={0,127,0},
                fillColor={255,255,255},
                fillPattern=FillPattern.Solid)}),
          Diagram(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Rectangle(
                extent={{-40,-40},{40,40}},
                lineColor={0,127,0},
                fillColor={255,255,255},
                fillPattern=FillPattern.Solid), Text(
                extent={{-40,110},{160,50}},
                textColor={0,127,0},
                textString="%name")}));
      end Flange_b;

      connector Support "Support/housing flange of a one-dimensional translational component"
        extends Modelica.Mechanics.Translational.Interfaces.Flange;
        annotation (
          Diagram(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Rectangle(
                    extent={{-60,60},{60,-60}},
                    fillColor={175,190,175},
                    fillPattern=FillPattern.Solid,
                    pattern=LinePattern.None), Text(
                    extent={{-160,110},{40,50}},
                    textColor={0,127,0},
                    textString="%name"),Rectangle(
                    extent={{-40,-40},{40,40}},
                    lineColor={0,127,0},
                    fillColor={0,127,0},
                    fillPattern=FillPattern.Solid)}),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={Rectangle(
                    extent={{-90,-90},{90,90}},
                    lineColor={0,127,0},
                    fillColor={175,175,175},
                    fillPattern=FillPattern.Solid),Rectangle(
                extent={{-150,150},{150,-150}},
                fillColor={175,190,175},
                fillPattern=FillPattern.Solid,
                pattern=LinePattern.None), Rectangle(
                    extent={{-90,-90},{90,90}},
                    lineColor={0,127,0},
                    fillColor={0,127,0},
                    fillPattern=FillPattern.Solid)}),
          Documentation(info="<html>
<p>
This is a connector for 1-dim. translational mechanical systems and models
the support or housing of a shaft.
The following variables are defined in this connector:
</p>
<blockquote><pre>
s: Absolute position of the support/housing in [m].
f: Reaction force in the support/housing in [N].
</pre></blockquote>
</html>"));
      end Support;

      partial model PartialTwoFlanges "Component with two translational 1D flanges"
        Modelica.Mechanics.Translational.Interfaces.Flange_a flange_a "(left) driving flange (flange axis directed into cut plane, e. g. from left to right)"
          annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
        Modelica.Mechanics.Translational.Interfaces.Flange_b flange_b "(right) driven flange (flange axis directed out of cut plane)"
          annotation (Placement(transformation(extent={{90,-10},{110,10}})));
        annotation (Documentation(info="<html>
<p>
This is a 1D translational component with two flanges.
It is used e.g., to built up parts of a drive train consisting
of several base components.
</p>
</html>"));
      end PartialTwoFlanges;

      partial model PartialCompliant "Compliant connection of two translational 1D flanges"
        extends Modelica.Mechanics.Translational.Interfaces.PartialTwoFlanges;
        Modelica.Units.SI.Position s_rel(start=0) "Relative distance (= flange_b.s - flange_a.s)";
        Modelica.Units.SI.Force f "Force between flanges (positive in direction of flange axis R)";
      equation
        s_rel = flange_b.s - flange_a.s;
        flange_b.f = f;
        flange_a.f = -f;
        annotation (Documentation(info="<html>
<p>
This is a 1D translational component with a <em>compliant</em> connection of two
translational 1D flanges where inertial effects between the two
flanges are not included. The absolute value of the force at the left and the right
flange is the same. It is used to built up springs, dampers etc.
</p>
</html>"));
      end PartialCompliant;

      partial model PartialCompliantWithRelativeStates
        "Base model for the compliant connection of two translational 1-dim. shaft flanges where the relative position and relative velocities are used as states"
        parameter Modelica.Units.SI.Distance s_nominal=1e-4 "Nominal value of s_rel (used for scaling)"
          annotation (Dialog(tab="Advanced"));
        Modelica.Units.SI.Position s_rel(start=0, nominal=s_nominal) "Relative distance (= flange_b.s - flange_a.s)";
        Modelica.Units.SI.Velocity v_rel(start=0) "Relative velocity (= der(s_rel))";
        Modelica.Units.SI.Force f "Forces between flanges (= flange_b.f)";
        extends Modelica.Mechanics.Translational.Interfaces.PartialTwoFlanges;
      equation
        s_rel = flange_b.s - flange_a.s;
        v_rel = der(s_rel);
        flange_b.f = f;
        flange_a.f = -f;
        annotation (Documentation(info="<html>
<p>
This is a 1-dim. translational component with a compliant connection of two
translational 1-dim. flanges where inertial effects between the two
flanges are neglected. The basic assumption is that the cut-forces
of the two flanges sum-up to zero, i.e., they have the same absolute value
but opposite sign: flange_a.f + flange_b.f = 0. This base class
is used to built up force elements such as springs, dampers, friction.
</p>
<p>
The difference to base class &quot;PartialCompliant&quot; is that the relative
distance and the relative velocity are defined as states (v_rel = der(s_rel)).
The stateSelect parameter of the Modelica Standard Library is not available on this platform.
</p>
</html>"));
      end PartialCompliantWithRelativeStates;

      partial model PartialRigid "Rigid connection of two translational 1D flanges"
        Modelica.Units.SI.Position s "Absolute position of center of component (s = flange_a.s + L/2 = flange_b.s - L/2)";
        parameter Modelica.Units.SI.Length L(start=0) "Length of component, from left flange to right flange (= flange_b.s - flange_a.s)";
        extends Modelica.Mechanics.Translational.Interfaces.PartialTwoFlanges;
      equation
        flange_a.s = s - L/2;
        flange_b.s = s + L/2;
        annotation (Documentation(info="<html>
<p>
This is a 1-dim. translational component with two <em>rigidly</em> connected flanges.
The fixed distance between the left and the right flange is defined by parameter &quot;L&quot;.
The forces at the right and left flange can be different.
It is used e.g., to built up sliding masses.
</p>
</html>"));
      end PartialRigid;

      partial model PartialElementaryOneFlangeAndSupport2
        "Partial model for a component with one translational 1-dim. shaft flange and a support used for textual modeling, i.e., for elementary models"
        Modelica.Units.SI.Length s "Distance between flange and support (= flange.s - support.s)";
        Modelica.Mechanics.Translational.Interfaces.Flange_b flange "Flange of component"
          annotation (Placement(transformation(extent={{90,-10},{110,10}})));
      protected
        Modelica.Units.SI.Length s_support "Absolute position of support flange";
      equation
        s = flange.s - s_support;
        s_support = 0;
        annotation (Documentation(info="<html>
<p>
This is a 1-dim. translational component with one flange and a support/housing.
It is used to build up elementary components of a drive train with
equations in the text layer.
</p>
<p>
The component is internally fixed to ground (the conditional support connector of the
Modelica Standard Library, parameter useSupport, is not available on this platform).
</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}),
            graphics={
              Line(points={{-50,-120},{-30,-100}}, color={0,127,0}),
              Line(points={{-30,-120},{-10,-100}}, color={0,127,0}),
              Line(points={{-10,-120},{10,-100}}, color={0,127,0}),
              Line(points={{10,-120},{30,-100}}, color={0,127,0}),
              Line(points={{-30,-100},{30,-100}}, color={0,127,0})}));
      end PartialElementaryOneFlangeAndSupport2;

      partial model PartialForce "Partial model of a force acting at the flange (accelerates the flange)"
        extends Modelica.Mechanics.Translational.Interfaces.PartialElementaryOneFlangeAndSupport2;
        Modelica.Units.SI.Force f "Accelerating force acting at flange (= flange.f)";
      equation
        f = flange.f;
        annotation (Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Rectangle(
                extent={{-96,96},{96,-96}},
                lineColor={255,255,255},
                fillColor={255,255,255},
                fillPattern=FillPattern.Solid),
              Line(points={{0,-60},{0,-100}}, color={0,127,0}),
              Text(
                extent={{-150,140},{150,100}},
                textColor={0,0,255},
                textString="%name"),
              Line(points={{-78,80},{51,80}}, color={95,127,95}),
              Polygon(
                points={{81,80},{51,90},{51,70},{81,80}},
                fillColor={95,127,95},
                fillPattern=FillPattern.Solid,
                lineColor={95,127,95}),
              Line(points={{-52,-60},{77,-60}}, color={95,127,95}),
              Polygon(
                points={{-82,-60},{-51,-50},{-51,-70},{-82,-60}},
                fillColor={95,127,95},
                fillPattern=FillPattern.Solid,
                lineColor={95,127,95})}), Documentation(info="<html>
<p>
Partial model of force that accelerates the flange.
</p>
</html>"));
      end PartialForce;

      partial model PartialAbsoluteSensor "Device to measure a single absolute flange variable"
        extends Modelica.Icons.RectangularSensor;
        Modelica.Mechanics.Translational.Interfaces.Flange_a flange "Flange to be measured (flange axis directed into cut plane, e. g. from left to right)"
          annotation (Placement(transformation(extent={{-110,-10},{-90,10}})));
      equation
        0 = flange.f;
        annotation (Documentation(info="<html>
<p>
This is the superclass of a 1D translational component with one flange and one
output signal in order to measure an absolute kinematic quantity in the flange
and to provide the measured signal as output signal for further processing
with the Modelica.Blocks blocks.
</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Line(points={{-100,-90},{-20,-90}}, color={95,127,95}),
              Polygon(
                points={{10,-90},{-20,-80},{-20,-100},{10,-90}},
                lineColor={95,127,95},
                fillColor={95,127,95},
                fillPattern=FillPattern.Solid),
              Line(points={{-70,0},{-100,0}}, color={0,127,0}),
              Line(points={{70,0},{100,0}}, color={0,0,127}),
              Text(
                extent={{-150,80},{150,40}},
                textString="%name",
                textColor={0,0,255})}));
      end PartialAbsoluteSensor;

      partial model PartialRelativeSensor "Device to measure a single relative variable between two flanges"
        extends Modelica.Icons.RectangularSensor;
        extends Modelica.Mechanics.Translational.Interfaces.PartialTwoFlanges;
      equation
        0 = flange_a.f + flange_b.f;
        annotation (Documentation(info="<html>
<p>
This is a superclass for 1D translational components with two rigidly connected
flanges and one output signal in order to measure relative kinematic quantities
between the two flanges or the cut-force in the flange and
to provide the measured signal as output signal for further processing
with the Modelica.Blocks blocks.
</p>
</html>"),
          Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
              Line(points={{-51,34},{29,34}}, color={95,127,95}),
              Polygon(
                points={{59,34},{29,44},{29,24},{59,34}},
                fillColor={95,127,95},
                fillPattern=FillPattern.Solid,
                lineColor={95,127,95}),
              Line(points={{-70,0},{-100,0}}, color={0,127,0}),
              Line(points={{70,0},{100,0}}, color={0,127,0}),
              Text(
                extent={{-150,100},{150,60}},
                textString="%name",
                textColor={0,0,255})}));
      end PartialRelativeSensor;

      annotation (Documentation(info="<html>
<p>
This package contains connectors and partial models for 1-dim.
translational mechanical components. The components of this package can
only be used as basic building elements for models.
</p>
</html>"));
    end Interfaces;

    annotation (Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
          Line(origin={14,53}, points={{-84,-73},{66,-73}}),
          Rectangle(
            origin={14,53},
            lineColor={64,64,64},
            fillColor={192,192,192},
            fillPattern=FillPattern.Sphere,
            extent={{-81,-65},{-8,-22}}),
          Line(
            origin={14,53},
            points={{-8,-43},{-1,-43},{6,-64},{17,-23},{29,-65},{40,-23},{50,-44},{61,-44}}),
          Line(origin={14,53}, points={{-59,-73},{-84,-93}}),
          Line(origin={14,53}, points={{-11,-73},{-36,-93}}),
          Line(origin={14,53}, points={{-34,-73},{-59,-93}}),
          Line(origin={14,53}, points={{14,-73},{-11,-93}}),
          Line(origin={14,53}, points={{39,-73},{14,-93}}),
          Line(origin={14,53}, points={{63,-73},{38,-93}})}), Documentation(info="<html>
<p>
This package contains components to model <em>1-dimensional translational
mechanical</em> systems.
</p>
<p>
The <em>filled</em> and <em>non-filled green squares</em> at the left and
right side of a component represent <em>mechanical flanges</em>.
Drawing a line between such squares means that the corresponding
flanges are <em>rigidly attached</em> to each other. The components of this
library can be usually connected together in an arbitrary way. E.g. it is
possible to connect two springs or two sliding masses with inertia directly
together.
</p>
<p>
In the <em>icon</em> of every component an <em>arrow</em> is displayed in grey
color. This arrow characterizes the coordinate system in which the vectors
of the component are resolved. It is directed into the positive
translational direction (in the mathematical sense).
</p>
<p>
On this platform the components are always implicitly fixed to ground (no support connectors)
and have no optional heat ports. Dissipated power is available as variable lossPower of the
damping components.
</p>
<p>
Copyright &copy; 1998-2020, Modelica Association and contributors
</p>
</html>"));
  end Translational;

  annotation (
    Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100.0,-100.0},{100.0,100.0}}), graphics={
      Rectangle(
        origin={8.6,63.3333},
        lineColor={64,64,64},
        fillColor={192,192,192},
        fillPattern=FillPattern.HorizontalCylinder,
        extent={{-4.6,-93.3333},{41.4,-53.3333}}),
      Ellipse(
        origin={9.0,46.0},
        extent={{-90.0,-60.0},{-80.0,-50.0}}),
      Line(
        origin={9.0,46.0},
        points={{-85.0,-55.0},{-60.0,-21.0}},
        thickness=0.5),
      Ellipse(
        origin={9.0,46.0},
        extent={{-65.0,-26.0},{-55.0,-16.0}}),
      Line(
        origin={9.0,46.0},
        points={{-60.0,-21.0},{9.0,-55.0}},
        thickness=0.5),
      Ellipse(
        origin={9.0,46.0},
        fillPattern=FillPattern.Solid,
        extent={{4.0,-60.0},{14.0,-50.0}}),
      Line(
        origin={9.0,46.0},
        points={{-10.0,-26.0},{72.0,-26.0},{72.0,-86.0},{-10.0,-86.0}})}),
    Documentation(info="<html>
<p>
This package contains components to model the movement
of 1-dim. rotational and 1-dim. translational
<strong>mechanical systems</strong>.
</p>
</html>"));
end Mechanics;
