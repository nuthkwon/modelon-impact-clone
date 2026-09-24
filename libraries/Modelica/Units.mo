within Modelica;
package Units "Library of type and unit definitions"
  extends Modelica.Icons.Package;

  package SI "Library of SI unit definitions"
    extends Modelica.Icons.Package;

    // Space and Time (chapter 1 of ISO 31-1992)
    type Angle = Real(final quantity="Angle", final unit="rad", displayUnit="deg");
    type Length = Real(final quantity="Length", final unit="m");
    type Position = Length;
    type Distance = Length(min=0);
    type Radius = Length(min=0);
    type Diameter = Length(min=0);
    type Area = Real(final quantity="Area", final unit="m2");
    type Volume = Real(final quantity="Volume", final unit="m3");
    type Time = Real(final quantity="Time", final unit="s");
    type Duration = Time;
    type AngularVelocity = Real(final quantity="AngularVelocity", final unit="rad/s");
    type AngularAcceleration = Real(final quantity="AngularAcceleration", final unit="rad/s2");
    type Velocity = Real(final quantity="Velocity", final unit="m/s");
    type Acceleration = Real(final quantity="Acceleration", final unit="m/s2");

    // Periodic and related phenomena (chapter 2 of ISO 31-1992)
    type Period = Real(final quantity="Time", final unit="s");
    type Frequency = Real(final quantity="Frequency", final unit="Hz");
    type AngularFrequency = Real(final quantity="AngularFrequency", final unit="rad/s");
    type DampingCoefficient = Real(final quantity="DampingCoefficient", final unit="s-1");
    type Damping = DampingCoefficient;

    // Mechanics (chapter 3 of ISO 31-1992)
    type Mass = Real(quantity="Mass", final unit="kg", min=0);
    type Density = Real(final quantity="Density", final unit="kg/m3", displayUnit="g/cm3", min=0.0);
    type Momentum = Real(final quantity="Momentum", final unit="kg.m/s");
    type Impulse = Real(final quantity="Impulse", final unit="N.s");
    type AngularMomentum = Real(final quantity="AngularMomentum", final unit="kg.m2/s");
    type MomentOfInertia = Real(final quantity="MomentOfInertia", final unit="kg.m2");
    type Inertia = MomentOfInertia;
    type Force = Real(final quantity="Force", final unit="N");
    type TranslationalSpringConstant = Real(final quantity="TranslationalSpringConstant", final unit="N/m");
    type TranslationalDampingConstant = Real(final quantity="TranslationalDampingConstant", final unit="N.s/m");
    type Weight = Force;
    type Torque = Real(final quantity="Torque", final unit="N.m");
    type ElectricalTorqueConstant = Real(final quantity="ElectricalTorqueConstant", final unit="N.m/A");
    type MomentOfForce = Torque;
    type RotationalSpringConstant = Real(final quantity="RotationalSpringConstant", final unit="N.m/rad");
    type RotationalDampingConstant = Real(final quantity="RotationalDampingConstant", final unit="N.m.s/rad");
    type Pressure = Real(final quantity="Pressure", final unit="Pa", displayUnit="bar");
    type AbsolutePressure = Pressure(min=0.0, nominal=1e5);
    type PressureDifference = Pressure;
    type Work = Real(final quantity="Work", final unit="J");
    type Energy = Real(final quantity="Energy", final unit="J");
    type PotentialEnergy = Energy;
    type KineticEnergy = Energy;
    type Power = Real(final quantity="Power", final unit="W");
    type EnergyFlowRate = Power;
    type Efficiency = Real(final quantity="Efficiency", final unit="1", min=0);
    type MassFlowRate = Real(quantity="MassFlowRate", final unit="kg/s");
    type VolumeFlowRate = Real(final quantity="VolumeFlowRate", final unit="m3/s");

    // Heat (chapter 4 of ISO 31-1992)
    type ThermodynamicTemperature = Real(
        final quantity="ThermodynamicTemperature",
        final unit="K",
        min=0.0,
        start=288.15,
        nominal=300,
        displayUnit="degC")
      "Absolute temperature (use type TemperatureDifference for relative temperatures)" annotation(absoluteValue=true);
    type Temp_K = ThermodynamicTemperature;
    type Temperature = ThermodynamicTemperature;
    type TemperatureDifference = Real(final quantity="ThermodynamicTemperature", final unit="K") annotation(absoluteValue=false);
    type TemperatureSlope = Real(final quantity="TemperatureSlope", final unit="K/s");
    type LinearTemperatureCoefficient = Real(final quantity="LinearTemperatureCoefficient", final unit="1/K");
    type Heat = Real(final quantity="Energy", final unit="J");
    type HeatFlowRate = Real(final quantity="Power", final unit="W");
    type HeatFlux = Real(final quantity="HeatFlux", final unit="W/m2");
    type ThermalConductivity = Real(final quantity="ThermalConductivity", final unit="W/(m.K)");
    type CoefficientOfHeatTransfer = Real(final quantity="CoefficientOfHeatTransfer", final unit="W/(m2.K)");
    type ThermalResistance = Real(final quantity="ThermalResistance", final unit="K/W");
    type ThermalConductance = Real(final quantity="ThermalConductance", final unit="W/K");
    type HeatCapacity = Real(final quantity="HeatCapacity", final unit="J/K");
    type SpecificHeatCapacity = Real(final quantity="SpecificHeatCapacity", final unit="J/(kg.K)");
    type Emissivity = Real(final quantity="Emissivity", final unit="1");

    // Electricity and Magnetism (chapter 5 of ISO 31-1992)
    type ElectricCurrent = Real(final quantity="ElectricCurrent", final unit="A");
    type Current = ElectricCurrent;
    type CurrentSlope = Real(final quantity="CurrentSlope", final unit="A/s");
    type ElectricCharge = Real(final quantity="ElectricCharge", final unit="C");
    type Charge = ElectricCharge;
    type ElectricPotential = Real(final quantity="ElectricPotential", final unit="V");
    type Voltage = ElectricPotential;
    type PotentialDifference = ElectricPotential;
    type ElectromotiveForce = ElectricPotential;
    type VoltageSlope = Real(final quantity="VoltageSlope", final unit="V/s");
    type Capacitance = Real(final quantity="Capacitance", final unit="F", min=0);
    type MagneticFlux = Real(final quantity="MagneticFlux", final unit="Wb");
    type Inductance = Real(final quantity="Inductance", final unit="H");
    type SelfInductance = Inductance(min=0);
    type MutualInductance = Inductance;
    type Resistance = Real(final quantity="Resistance", final unit="Ohm");
    type Resistivity = Real(final quantity="Resistivity", final unit="Ohm.m");
    type Conductivity = Real(final quantity="Conductivity", final unit="S/m");
    type Impedance = Resistance;
    type Reactance = Resistance;
    type Conductance = Real(final quantity="Conductance", final unit="S");
    type Admittance = Conductance;
    type Permeability = Real(final quantity="Permeability", final unit="H/m");

    annotation (Icon(graphics={Text(
            extent={{-80,80},{80,-78}},
            textColor={128,128,128},
            fontName="serif",
            textString="SI",
            textStyle={TextStyle.Italic})}),
      Documentation(info="<html>
<p>This package provides predefined types based on the international standard
on units.
</p>
<p>
Only the types used by the sub-libraries shipped with this platform are included.
</p>
</html>"));
  end SI;

  package NonSI "Type definitions of non SI and other units"
    extends Modelica.Icons.Package;

    type Temperature_degC = Real(final quantity="ThermodynamicTemperature", final unit="degC")
      "Absolute temperature in degree Celsius (for relative temperature use Modelica.Units.SI.TemperatureDifference)" annotation(absoluteValue=true);
    type Temperature_degF = Real(final quantity="ThermodynamicTemperature", final unit="degF")
      "Absolute temperature in degree Fahrenheit (for relative temperature use Modelica.Units.SI.TemperatureDifference)" annotation(absoluteValue=true);
    type Angle_deg = Real(final quantity="Angle", final unit="deg") "Angle in degree";
    type AngularVelocity_rpm = Real(final quantity="AngularVelocity", final unit="rev/min")
      "Angular velocity in revolutions per minute. Alias unit names that are outside of the SI system: rpm, r/min, rev/min";
    type Velocity_kmh = Real(final quantity="Velocity", final unit="km/h") "Velocity in kilometres per hour";
    type Time_day = Real(final quantity="Time", final unit="d") "Time in days";
    type Time_hour = Real(final quantity="Time", final unit="h") "Time in hours";
    type Time_minute = Real(final quantity="Time", final unit="min") "Time in minutes";
    type Volume_litre = Real(final quantity="Volume", final unit="l") "Volume in litres";
    type Pressure_bar = Real(final quantity="Pressure", final unit="bar") "Absolute pressure in bar";

    annotation (Documentation(info="<html>
<p>
This package provides predefined types, such as <strong>Angle_deg</strong> (angle in
degree), <strong>AngularVelocity_rpm</strong> (angular velocity in revolutions per
minute) or <strong>Temperature_degF</strong> (temperature in degree Fahrenheit),
which are in common use but are not part of the international standard on
units according to ISO 31-1992 &quot;General principles concerning quantities,
units and symbols&quot; and ISO 1000-1992 &quot;SI units and recommendations for
the use of their multiples and of certain other units&quot;.
</p>
<p>
The conversion functions of the original <code>Modelica.Units.Conversions</code> package are not
available on this platform (functions are not supported); use plain arithmetic instead,
e.g. <code>T_K = T_degC + 273.15</code>.
</p>
</html>"));
  end NonSI;

  annotation (Icon(graphics={
      Polygon(
        fillColor={128,128,128},
        pattern=LinePattern.None,
        fillPattern=FillPattern.Solid,
        points={{-80,-40},{-80,-40},{-55,50},{-52.5,62.5},{-65,60},{-65,65},{-35,77.5},{-32.5,60},{-50,0},{-50,0},{-30,15},{-20,27.5},{-32.5,27.5},{-32.5,27.5},{-32.5,32.5},{-32.5,32.5},{2.5,32.5},{2.5,32.5},{2.5,27.5},{2.5,27.5},{-7.5,27.5},{-30,7.5},{-30,7.5},{-25,-25},{-17.5,-28.75},{-10,-25},{-5,-26.25},{-5,-32.5},{-16.25,-41.25},{-31.25,-43.75},{-40,-33.75},{-45,-5},{-45,-5},{-52.5,-10},{-52.5,-10},{-60,-40},{-60,-40}},
        smooth=Smooth.Bezier),
      Polygon(
        fillColor={128,128,128},
        pattern=LinePattern.None,
        fillPattern=FillPattern.Solid,
        points={{87.5,30},{62.5,30},{62.5,30},{55,33.75},{36.25,35},{16.25,25},{7.5,6.25},{11.25,-7.5},{22.5,-12.5},{22.5,-12.5},{6.25,-22.5},{6.25,-35},{16.25,-38.75},{16.25,-38.75},{21.25,-41.25},{21.25,-41.25},{45,-48.75},{47.5,-61.25},{32.5,-70},{12.5,-65},{7.5,-51.25},{21.25,-41.25},{21.25,-41.25},{16.25,-38.75},{16.25,-38.75},{6.25,-41.25},{-6.25,-50},{-3.75,-68.75},{30,-76.25},{65,-62.5},{63.75,-35},{27.5,-26.25},{22.5,-20},{27.5,-15},{27.5,-15},{30,-7.5},{30,-7.5},{27.5,-2.5},{28.75,11.25},{36.25,27.5},{47.5,30},{53.75,22.5},{51.25,8.75},{45,-6.25},{35,-11.25},{30,-7.5},{30,-7.5},{27.5,-15},{27.5,-15},{43.75,-16.25},{65,-6.25},{72.5,10},{70,20},{70,20},{80,20}},
        smooth=Smooth.Bezier)}), Documentation(info="<html>
<p>This package provides predefined types, such as <em>Mass</em>,
<em>Angle</em>, <em>Time</em>, based on the international standard
on units, e.g.,
</p>
<blockquote><pre>
<strong>type</strong> Angle = Real(<strong>final</strong> quantity = \"Angle\",
                  <strong>final</strong> unit     = \"rad\",
                  displayUnit   = \"deg\");
</pre></blockquote>
<p>
Copyright &copy; 1998-2020, Modelica Association and contributors
</p>
</html>"));
end Units;
