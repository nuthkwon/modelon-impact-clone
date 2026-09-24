within Modelica;
package Constants "Library of mathematical constants and constants of nature (e.g., pi, eps, R, sigma)"
  extends Modelica.Icons.Package;

  // Mathematical constants
  final constant Real e(final unit="1") = 2.71828182845904523536 "Euler's number";
  final constant Real pi = 3.14159265358979323846 "Pi";
  final constant Real D2R(final unit="rad/deg") = pi/180 "Degree to Radian";
  final constant Real R2D(final unit="deg/rad") = 180/pi "Radian to Degree";
  final constant Real gamma(final unit="1") = 0.57721566490153286061 "See http://en.wikipedia.org/wiki/Euler_constant";

  // Machine dependent constants
  final constant Real eps = 1e-15 "Biggest number such that 1.0 + eps = 1.0";
  final constant Real small = 1e-60 "Smallest number such that small and -small are representable on the machine";
  final constant Real inf = 1e60 "Biggest Real number such that inf and -inf are representable on the machine";
  final constant Integer Integer_inf = 2147483647 "Biggest Integer number such that Integer_inf and -Integer_inf are representable on the machine";

  // Constants of nature
  final constant Modelica.Units.SI.Velocity c = 299792458 "Speed of light in vacuum";
  final constant Modelica.Units.SI.Acceleration g_n = 9.80665 "Standard acceleration of gravity on earth";
  final constant Real G(final unit="m3/(kg.s2)") = 6.67430e-11 "Newtonian constant of gravitation";
  final constant Modelica.Units.SI.ElectricCharge q = 1.602176634e-19 "Elementary charge";
  final constant Real h(final unit="J.s") = 6.62607015e-34 "Planck constant";
  final constant Real k(final unit="J/K") = 1.380649e-23 "Boltzmann constant";
  final constant Real R(final unit="J/(mol.K)") = 8.31446261815324 "Molar gas constant";
  final constant Real sigma(final unit="W/(m2.K4)") = 5.670374419e-8 "Stefan-Boltzmann constant";
  final constant Real N_A(final unit="1/mol") = 6.02214076e23 "Avogadro constant";
  final constant Modelica.Units.SI.Permeability mu_0 = 1.25663706212e-6 "Magnetic constant";
  final constant Real epsilon_0(final unit="F/m") = 8.8541878128e-12 "Electric constant";
  final constant Modelica.Units.NonSI.Temperature_degC T_zero = -273.15 "Absolute zero temperature";

  annotation (
    Documentation(info="<html>
<p>
This package provides often needed constants from mathematics, machine
dependent constants and constants from nature. It provides mainly the constants
of the 2019 redefinition of the SI system (values are given as literals here because
functions are not available on this platform).
</p>
<p>
Copyright &copy; 1998-2020, Modelica Association and contributors
</p>
</html>"),
    Icon(coordinateSystem(extent={{-100.0,-100.0},{100.0,100.0}}), graphics={
      Polygon(
        origin={-9.2597,25.6673},
        fillColor={102,102,102},
        pattern=LinePattern.None,
        fillPattern=FillPattern.Solid,
        points={{48.017,11.336},{48.017,11.336},{10.766,11.336},{-25.684,10.95},{-34.944,-15.111},{-34.944,-15.111},{-32.298,-15.244},{-32.298,-15.244},{-22.112,0.168},{11.292,0.234},{48.267,-0.097},{48.267,-0.097}},
        smooth=Smooth.Bezier),
      Polygon(
        origin={-19.9923,-8.3993},
        fillColor={102,102,102},
        pattern=LinePattern.None,
        fillPattern=FillPattern.Solid,
        points={{3.239,37.343},{3.305,37.343},{-0.399,2.683},{-16.936,-20.071},{-7.808,-28.604},{6.811,-22.519},{9.986,37.145},{9.986,37.145}},
        smooth=Smooth.Bezier),
      Polygon(
        origin={23.753,-11.5422},
        fillColor={102,102,102},
        pattern=LinePattern.None,
        fillPattern=FillPattern.Solid,
        points={{-10.873,41.478},{-10.873,41.478},{-14.048,-4.162},{-9.352,-24.8},{7.912,-24.469},{16.247,0.27},{16.247,0.27},{13.336,0.071},{13.336,0.071},{7.515,-9.983},{-3.134,-7.271},{-2.671,41.214},{-2.671,41.214}},
        smooth=Smooth.Bezier)}));
end Constants;
