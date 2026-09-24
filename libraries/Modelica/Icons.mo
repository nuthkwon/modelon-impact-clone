within Modelica;
package Icons "Library of icons"
  extends Modelica.Icons.Package;

  partial class Information "Icon for general information packages"
    annotation (Icon(coordinateSystem(preserveAspectRatio=false, extent={{-100,-100},{100,100}}), graphics={
          Ellipse(
            lineColor={75,138,73},
            fillColor={75,138,73},
            pattern=LinePattern.None,
            fillPattern=FillPattern.Solid,
            extent={{-100.0,-100.0},{100.0,100.0}}),
          Polygon(origin={-4.167,-15.0},
            fillColor={255,255,255},
            pattern=LinePattern.None,
            fillPattern=FillPattern.Solid,
            points={{-15.833,20.0},{-15.833,30.0},{14.167,40.0},{24.167,20.0},{4.167,-30.0},{14.167,-30.0},{24.167,-30.0},{24.167,-40.0},{-5.833,-50.0},{-15.833,-30.0},{4.167,20.0},{-5.833,20.0}},
            smooth=Smooth.Bezier),
          Ellipse(origin={7.5,56.5},
            fillColor={255,255,255},
            pattern=LinePattern.None,
            fillPattern=FillPattern.Solid,
            extent={{-12.5,-12.5},{12.5,12.5}})}),
      Documentation(info="<html>
<p>This icon indicates classes containing only documentation, intended for general description of, e.g., concepts and features of a package.</p>
</html>"));
  end Information;

  partial package ExamplesPackage "Icon for packages containing runnable examples"
    extends Modelica.Icons.Package;
    annotation (Icon(coordinateSystem(preserveAspectRatio=false, extent={{-100,-100},{100,100}}), graphics={
          Polygon(
            origin={8.0,14.0},
            lineColor={78,138,73},
            fillColor={78,138,73},
            pattern=LinePattern.None,
            fillPattern=FillPattern.Solid,
            points={{-58.0,46.0},{42.0,-14.0},{-58.0,-74.0},{-58.0,46.0}})}), Documentation(info="<html>
<p>This icon indicates a package that contains executable examples.</p>
</html>"));
  end ExamplesPackage;

  partial model Example "Icon for runnable examples"
    annotation (Icon(coordinateSystem(preserveAspectRatio=false, extent={{-100,-100},{100,100}}), graphics={
          Ellipse(lineColor={75,138,73},
                  fillColor={255,255,255},
                  fillPattern=FillPattern.Solid,
                  extent={{-100,-100},{100,100}}),
          Polygon(lineColor={0,0,255},
                  fillColor={75,138,73},
                  pattern=LinePattern.None,
                  fillPattern=FillPattern.Solid,
                  points={{-36,60},{64,0},{-36,-60},{-36,60}})}), Documentation(info="<html>
<p>This icon indicates an example. The play button suggests that the example can be executed.</p>
</html>"));
  end Example;

  partial package Package "Icon for standard packages"
    annotation (Icon(coordinateSystem(preserveAspectRatio=false, extent={{-100,-100},{100,100}}), graphics={
          Rectangle(
            lineColor={200,200,200},
            fillColor={248,248,248},
            fillPattern=FillPattern.HorizontalCylinder,
            extent={{-100.0,-100.0},{100.0,100.0}},
            radius=25.0),
          Rectangle(
            lineColor={128,128,128},
            extent={{-100.0,-100.0},{100.0,100.0}},
            radius=25.0)}), Documentation(info="<html>
<p>Standard package icon.</p>
</html>"));
  end Package;

  partial package BasesPackage "Icon for packages containing base classes"
    extends Modelica.Icons.Package;
    annotation (Icon(coordinateSystem(preserveAspectRatio=false, extent={{-100,-100},{100,100}}), graphics={
          Ellipse(
            extent={{-30.0,-30.0},{30.0,30.0}},
            lineColor={128,128,128},
            fillColor={255,255,255},
            fillPattern=FillPattern.Solid)}),
      Documentation(info="<html>
<p>This icon shall be used for a package/library that contains base models and classes, respectively.</p>
</html>"));
  end BasesPackage;

  partial package VariantsPackage "Icon for package containing variants"
    extends Modelica.Icons.Package;
    annotation (Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}),
        graphics={
          Ellipse(
            extent={{-70.0,-70.0},{-10.0,-10.0}},
            lineColor={76,76,76},
            fillColor={76,76,76},
            fillPattern=FillPattern.Solid),
          Ellipse(
            extent={{70.0,-70.0},{10.0,-10.0}},
            fillPattern=FillPattern.Solid),
          Ellipse(
            extent={{70.0,70.0},{10.0,10.0}},
            lineColor={128,128,128},
            fillColor={128,128,128},
            fillPattern=FillPattern.Solid),
          Ellipse(
            extent={{-70.0,70.0},{-10.0,10.0}},
            lineColor={128,128,128},
            fillColor={255,255,255},
            fillPattern=FillPattern.Solid)}),
      Documentation(info="<html>
<p>This icon shall be used for a package/library that contains several variants of one component.</p>
</html>"));
  end VariantsPackage;

  partial package InterfacesPackage "Icon for packages containing interfaces"
    extends Modelica.Icons.Package;
    annotation (
      Icon(coordinateSystem(preserveAspectRatio=false, extent={{-100,-100},{100,100}}),
        graphics={
          Polygon(
            lineColor={64,64,64},
            fillColor={255,255,255},
            fillPattern=FillPattern.Solid,
            points={{10,70},{30,70},{60,20},{100,20},{100,-20},{60,-20},{30,-70},{10,-70}}),
          Polygon(
            lineColor={102,102,102},
            fillColor={102,102,102},
            fillPattern=FillPattern.Solid,
            points={{-100,20},{-60,20},{-30,70},{-10,70},{-10,-70},{-30,-70},{-60,-20},{-100,-20}})}),
      Documentation(info="<html>
<p>This icon indicates packages containing interfaces.</p>
</html>"));
  end InterfacesPackage;

  partial package SourcesPackage "Icon for packages containing sources"
    extends Modelica.Icons.Package;
    annotation (Icon(coordinateSystem(preserveAspectRatio=false, extent={{-100,-100},{100,100}}), graphics={
          Polygon(origin={23.3333,0.0},
            fillColor={128,128,128},
            pattern=LinePattern.None,
            fillPattern=FillPattern.Solid,
            points={{-23.333,30.0},{46.667,0.0},{-23.333,-30.0}}),
          Rectangle(
            fillColor={128,128,128},
            pattern=LinePattern.None,
            fillPattern=FillPattern.Solid,
            extent={{-70,-4.5},{0,4.5}})}),
      Documentation(info="<html>
<p>This icon indicates a package which contains sources.</p>
</html>"));
  end SourcesPackage;

  partial package SensorsPackage "Icon for packages containing sensors"
    extends Modelica.Icons.Package;
    annotation (Icon(coordinateSystem(preserveAspectRatio=false, extent={{-100,-100},{100,100}}), graphics={
          Ellipse(origin={0.0,-30.0},
            fillColor={255,255,255},
            extent={{-90.0,-90.0},{90.0,90.0}},
            startAngle=20.0,
            endAngle=160.0),
          Ellipse(origin={0.0,-30.0},
            fillColor={128,128,128},
            pattern=LinePattern.None,
            fillPattern=FillPattern.Solid,
            extent={{-20.0,-20.0},{20.0,20.0}}),
          Line(origin={0.0,-30.0},
            points={{0.0,60.0},{0.0,90.0}}),
          Ellipse(origin={-0.0,-30.0},
            fillColor={64,64,64},
            pattern=LinePattern.None,
            fillPattern=FillPattern.Solid,
            extent={{-10.0,-10.0},{10.0,10.0}}),
          Polygon(
            origin={-0.0,-30.0},
            rotation=-35.0,
            fillColor={64,64,64},
            pattern=LinePattern.None,
            fillPattern=FillPattern.Solid,
            points={{-7.0,0.0},{-3.0,85.0},{0.0,90.0},{3.0,85.0},{7.0,0.0}})}),
      Documentation(info="<html>
<p>This icon indicates a package containing sensors.</p>
</html>"));
  end SensorsPackage;

  partial package UtilitiesPackage "Icon for utility packages"
    extends Modelica.Icons.Package;
    annotation (Icon(coordinateSystem(extent={{-100.0,-100.0},{100.0,100.0}}), graphics={
      Polygon(
        origin={1.3835,-4.1418},
        rotation=45.0,
        fillColor={64,64,64},
        pattern=LinePattern.None,
        fillPattern=FillPattern.Solid,
        points={{-15.0,93.333},{-15.0,68.333},{0.0,58.333},{15.0,68.333},{15.0,93.333},{20.0,93.333},{25.0,83.333},{25.0,58.333},{10.0,43.333},{10.0,-41.667},{25.0,-56.667},{25.0,-76.667},{10.0,-91.667},{0.0,-91.667},{0.0,-81.667},{5.0,-81.667},{15.0,-71.667},{15.0,-61.667},{5.0,-51.667},{-5.0,-51.667},{-15.0,-61.667},{-15.0,-71.667},{-5.0,-81.667},{0.0,-81.667},{0.0,-91.667},{-10.0,-91.667},{-25.0,-76.667},{-25.0,-56.667},{-10.0,-41.667},{-10.0,43.333},{-25.0,58.333},{-25.0,83.333},{-20.0,93.333}}),
      Polygon(
        origin={10.1018,5.218},
        rotation=-45.0,
        fillColor={255,255,255},
        fillPattern=FillPattern.Solid,
        points={{-15.0,87.273},{15.0,87.273},{20.0,82.273},{20.0,27.273},{10.0,17.273},{10.0,7.273},{20.0,2.273},{20.0,-2.727},{5.0,-2.727},{5.0,-77.727},{10.0,-87.727},{5.0,-112.727},{-5.0,-112.727},{-10.0,-87.727},{-5.0,-77.727},{-5.0,-2.727},{-20.0,-2.727},{-20.0,2.273},{-10.0,7.273},{-10.0,17.273},{-20.0,27.273},{-20.0,82.273}})}),
      Documentation(info="<html>
<p>This icon indicates a package containing utility classes.</p>
</html>"));
  end UtilitiesPackage;

  partial package TypesPackage "Icon for packages containing type definitions"
    extends Modelica.Icons.Package;
    annotation (Icon(coordinateSystem(preserveAspectRatio=false, extent={{-100,-100},{100,100}}), graphics={Polygon(
            origin={-12.167,-23},
            fillColor={128,128,128},
            pattern=LinePattern.None,
            fillPattern=FillPattern.Solid,
            points={{12.167,65},{14.167,93},{36.167,89},{24.167,20},{4.167,-30},{14.167,-30},{24.167,-30},{24.167,-40},{-5.833,-50},{-15.833,-30},{4.167,20},{12.167,65}},
            smooth=Smooth.Bezier), Polygon(
            origin={2.7403,1.6673},
            fillColor={128,128,128},
            pattern=LinePattern.None,
            fillPattern=FillPattern.Solid,
            points={{49.2597,22.3327},{31.2597,24.3327},{7.2597,18.3327},{-26.7403,10.3327},{-46.7403,14.3327},{-48.7403,6.3327},{-32.7403,0.3327},{-6.7403,4.3327},{33.2597,14.3327},{49.2597,14.3327},{49.2597,22.3327}},
            smooth=Smooth.Bezier)}));
  end TypesPackage;

  partial package IconsPackage "Icon for packages containing icons"
    extends Modelica.Icons.Package;
    annotation (Icon(coordinateSystem(preserveAspectRatio=false, extent={{-100,-100},{100,100}}), graphics={Polygon(
            origin={-8.167,-17},
            fillColor={128,128,128},
            pattern=LinePattern.None,
            fillPattern=FillPattern.Solid,
            points={{-15.833,20.0},{-15.833,30.0},{14.167,40.0},{24.167,20.0},{4.167,-30.0},{14.167,-30.0},{24.167,-30.0},{24.167,-40.0},{-5.833,-50.0},{-15.833,-30.0},{4.167,20.0},{-5.833,20.0}},
            smooth=Smooth.Bezier), Ellipse(
            origin={-0.5,56.5},
            fillColor={128,128,128},
            pattern=LinePattern.None,
            fillPattern=FillPattern.Solid,
            extent={{-12.5,-12.5},{12.5,12.5}})}));
  end IconsPackage;

  partial class RoundSensor "Icon representing a round measurement device"
    annotation (
      Icon(coordinateSystem(preserveAspectRatio=false, extent={{-100,-100},{100,100}}), graphics={
          Ellipse(
            fillColor={245,245,245},
            fillPattern=FillPattern.Solid,
            extent={{-70.0,-70.0},{70.0,70.0}}),
          Line(points={{0.0,70.0},{0.0,40.0}}),
          Line(points={{22.9,32.8},{40.2,57.3}}),
          Line(points={{-22.9,32.8},{-40.2,57.3}}),
          Line(points={{37.6,13.7},{65.8,23.9}}),
          Line(points={{-37.6,13.7},{-65.8,23.9}}),
          Ellipse(
            lineColor={64,64,64},
            fillColor={255,255,255},
            extent={{-12.0,-12.0},{12.0,12.0}}),
          Polygon(
            rotation=-17.5,
            fillColor={64,64,64},
            pattern=LinePattern.None,
            fillPattern=FillPattern.Solid,
            points={{-5.0,0.0},{-2.0,60.0},{0.0,65.0},{2.0,60.0},{5.0,0.0}}),
          Ellipse(
            fillColor={64,64,64},
            pattern=LinePattern.None,
            fillPattern=FillPattern.Solid,
            extent={{-7.0,-7.0},{7.0,7.0}})}),
      Documentation(info="<html>
<p>
This icon is designed for a <strong>rotational sensor</strong> model.
</p>
</html>"));
  end RoundSensor;

  partial class RectangularSensor "Icon representing a linear measurement device"
    annotation (
      Icon(coordinateSystem(preserveAspectRatio=false, extent={{-100,-100},{100,100}}), graphics={
          Rectangle(
            fillColor={245,245,245},
            fillPattern=FillPattern.Solid,
            extent={{-70.0,-60.0},{70.0,20.0}}),
          Polygon(
            pattern=LinePattern.None,
            fillPattern=FillPattern.Solid,
            points={{-40,-40},{-50,-16},{-30,-16},{-40,-40}}),
          Line(points={{-40,0},{-40,-16}}),
          Line(points={{-70,0},{-40,0}}),
          Line(points={{-50.0,-40.0},{-50.0,-60.0}}),
          Line(points={{-30.0,-40.0},{-30.0,-60.0}}),
          Line(points={{-10.0,-40.0},{-10.0,-60.0}}),
          Line(points={{10.0,-40.0},{10.0,-60.0}}),
          Line(points={{30.0,-40.0},{30.0,-60.0}}),
          Line(points={{50.0,-40.0},{50.0,-60.0}})}),
      Documentation(info="<html>
<p>
This icon is designed for a <strong>translational sensor</strong> model.
</p></html>"));
  end RectangularSensor;

  partial class RotationalSensor "Icon representing a round measurement device (MSL 3 name of RoundSensor)"
    extends Modelica.Icons.RoundSensor;
    annotation (Documentation(info="<html>
<p>Compatibility alias for <a href=\"modelica://Modelica.Icons.RoundSensor\">RoundSensor</a> (the name used up to MSL 3.2.3).</p>
</html>"));
  end RotationalSensor;

  partial class TranslationalSensor "Icon representing a linear measurement device (MSL 3 name of RectangularSensor)"
    extends Modelica.Icons.RectangularSensor;
    annotation (Documentation(info="<html>
<p>Compatibility alias for <a href=\"modelica://Modelica.Icons.RectangularSensor\">RectangularSensor</a> (the name used up to MSL 3.2.3).</p>
</html>"));
  end TranslationalSensor;

  partial class Function "Icon for functions"
    annotation (Icon(coordinateSystem(preserveAspectRatio=false, extent={{-100,-100},{100,100}}), graphics={
          Text(
            textColor={0,0,255},
            extent={{-150,105},{150,145}},
            textString="%name"),
          Ellipse(
            lineColor={108,88,49},
            fillColor={255,215,136},
            fillPattern=FillPattern.Solid,
            extent={{-100,-100},{100,100}}),
          Text(
            textColor={108,88,49},
            extent={{-90.0,-90.0},{90.0,90.0}},
            textString="f")}),
      Documentation(info="<html>
<p>This icon indicates Modelica functions. (Declared as a partial class here because user functions are not supported by this platform.)</p>
</html>"));
  end Function;

  partial record Record "Icon for records"
    annotation (Icon(coordinateSystem(preserveAspectRatio=true, extent={{-100,-100},{100,100}}), graphics={
          Text(
            textColor={0,0,255},
            extent={{-150,60},{150,100}},
            textString="%name"),
          Rectangle(
            origin={0.0,-25.0},
            lineColor={64,64,64},
            fillColor={255,215,136},
            fillPattern=FillPattern.Solid,
            extent={{-100.0,-75.0},{100.0,75.0}},
            radius=25.0),
          Line(
            points={{-100.0,0.0},{100.0,0.0}},
            color={64,64,64}),
          Line(
            origin={0.0,-50.0},
            points={{-100.0,0.0},{100.0,0.0}},
            color={64,64,64}),
          Line(
            origin={0.0,-25.0},
            points={{0.0,75.0},{0.0,-75.0}},
            color={64,64,64})}), Documentation(info="<html>
<p>
This icon is indicates a record.
</p>
</html>"));
  end Record;

  annotation (Icon(coordinateSystem(preserveAspectRatio=false, extent={{-100,-100},{100,100}}), graphics={Polygon(
            origin={-8.167,-17},
            fillColor={128,128,128},
            pattern=LinePattern.None,
            fillPattern=FillPattern.Solid,
            points={{-15.833,20.0},{-15.833,30.0},{14.167,40.0},{24.167,20.0},{4.167,-30.0},{14.167,-30.0},{24.167,-30.0},{24.167,-40.0},{-5.833,-50.0},{-15.833,-30.0},{4.167,20.0},{-5.833,20.0}},
            smooth=Smooth.Bezier), Ellipse(
            origin={-0.5,56.5},
            fillColor={128,128,128},
            pattern=LinePattern.None,
            fillPattern=FillPattern.Solid,
            extent={{-12.5,-12.5},{12.5,12.5}})}), Documentation(info="<html>
<p>This package contains definitions for the graphical layout of components which may be used in different libraries. The icons can be utilized by inheriting them in the desired class using &quot;extends&quot; or by directly copying the &quot;icon&quot; layer.</p>
<p>
Copyright &copy; 1998-2020, Modelica Association and contributors
</p>
</html>"));
end Icons;
