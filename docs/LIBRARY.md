# Library reference

This document lists every class shipped in `libraries/` (the Modelica Standard Library subset
`Modelica` and the demo project `Examples`), how it relates to the original Modelica Standard
Library (MSL) 4.0.0 and which simplifications were made so that it fits the Modelica subset
supported by the platform (see `docs/ARCHITECTURE.md`, section "Modelica subset").

The class list below is generated from the sources by the structural checker used to validate the
library (346 classes: 39 block, 7 class, 18 connector, 124 model, 59 package, 1 record, 98 type).

## Files

| File | Content |
| --- | --- |
| `libraries/Modelica/package.mo` | top-level `package Modelica` (icon, version `4.0.0-subset`, documentation, license note) |
| `libraries/Modelica/LICENSE.md` | 3-Clause BSD license of the Modelica Standard Library with a note about this adapted subset |
| `libraries/Modelica/Icons.mo` | `Modelica.Icons`: package/class icon base classes |
| `libraries/Modelica/Units.mo` | `Modelica.Units.SI` and `Modelica.Units.NonSI` type definitions |
| `libraries/Modelica/Constants.mo` | `Modelica.Constants` (pi, e, eps, small, inf, g_n, R, sigma, T_zero, ...) |
| `libraries/Modelica/Blocks.mo` | `Modelica.Blocks`: Examples, Continuous, Interfaces, Math, Nonlinear, Sources, Types, Icons |
| `libraries/Modelica/Electrical.mo` | `Modelica.Electrical.Analog`: Examples, Basic, Ideal, Sensors, Sources, Interfaces, Icons |
| `libraries/Modelica/Mechanics.mo` | `Modelica.Mechanics.Rotational` and `Modelica.Mechanics.Translational` |
| `libraries/Modelica/Thermal.mo` | `Modelica.Thermal.HeatTransfer`: Examples, Components, Sensors, Sources, Celsius, Interfaces, Icons |
| `libraries/Examples/package.mo` | `Examples`: ready-to-simulate demo models seeded into every workspace |

Each `.mo` file is a `within Modelica;` stored definition holding one sub-package with all nested
packages and classes inside it (nested-class style, not one file per class as in MSL 4).

## Conventions and global simplifications

* **Icons, diagrams, parameter names, units, descriptions and defaults are taken verbatim from MSL 4.0.0.**
  Graphical annotations (`Icon`, `Diagram`, `Placement`, `Line`) are copied exactly; only graphics that
  depended on removed options (`visible=useHeatPort`, `DynamicSelect(...)`) were dropped or made static.
* **No conditional components.** MSL's optional heat ports (`useHeatPort`) and support flanges
  (`useSupport`) do not exist. Dissipative components keep the MSL variable `lossPower`/`LossPower`;
  components with a support (torque/force sources, gears, EMF) are always fixed to ground through a
  protected variable `phi_support = 0` / `s_support = 0`, so their MSL equations are unchanged.
* **No `replaceable`/`redeclare`.** The electrical sources contain their signal equation directly
  (e.g. `v = offset + (if time < startTime then 0 else V*sin(2*pi*f*(time - startTime) + phase))`).
* **No functions.** `Modelica.Math` and `Modelica.Units.Conversions` are not included; blocks use the
  builtin `sin`, `cos`, `exp`, `log`, `sqrt`, `abs`, `min`, `max`, `mod`; Celsius components use
  `K = degC + 273.15`; `Modelica.Constants` are numeric literals; `Modelica.Icons.Function` is a class.
* **No `initType`.** Continuous blocks initialize their states from `y_start`/`x_start` with
  `fixed=true`. For steady-state initialization set `x(fixed=false)` on the block and add
  `initial equation der(block.x) = 0;` in the enclosing model (see `Blocks.Examples.PID_Controller`).
* **No `stateSelect` parameters** (the builtin `StateSelect` enumeration is not part of the library);
  relative-state components (`Damper`, `SpringDamper`, `ElastoGap`) still use `w_rel = der(phi_rel)`
  / `v_rel = der(s_rel)` exactly like MSL, so the flattener must handle the resulting alias/index
  structure (relative angle = difference of two absolute angles that are states themselves).
* **Time-event sources** (`Pulse`, `SawTooth`, `Trapezoid`, `PulseVoltage`) are written with `mod()`
  if-expressions instead of `when`/`pre` clauses and initial algorithms.
* **Assertions** are kept where MSL has them but without `String()` concatenation in the message;
  `homotopy()`, `smooth()` and `noEvent()` wrappers were dropped (they do not change results).
* MSL 3 names are provided as thin aliases for convenience: `Icons.RotationalSensor`,
  `Icons.TranslationalSensor`, `Blocks.Sources.Clock`, `Electrical.Analog.Basic.EMF`.
* Every non-partial component class carries a `// balance: ...` comment before its `end` stating the
  number of unknowns, the flow/input variables provided by connections and the number of equations
  (locally balanced per Modelica specification section 4.7). Example models state the flattened count.

## Class tree

Column *Origin*: `MSL` = copied from MSL 4.0.0 (icons and equations unchanged apart from the global
conventions above); `MSL, simplified: ...` = MSL class with the listed change; `new` = written for
this platform.

### `libraries/Modelica/package.mo`

| Class | Kind | Description | Origin |
| --- | --- | --- | --- |
| `Modelica` | package | Modelica Standard Library (subset adapted for this platform) | MSL, simplified: top-level package only; version "4.0.0-subset" |

### `libraries/Modelica/Icons.mo`

| Class | Kind | Description | Origin |
| --- | --- | --- | --- |
| `Modelica.Icons` | package | Library of icons | MSL, simplified: subset of icon classes |
| `Modelica.Icons.Information` | partial class | Icon for general information packages | MSL |
| `Modelica.Icons.ExamplesPackage` | partial package | Icon for packages containing runnable examples | MSL |
| `Modelica.Icons.Example` | partial model | Icon for runnable examples | MSL |
| `Modelica.Icons.Package` | partial package | Icon for standard packages | MSL |
| `Modelica.Icons.BasesPackage` | partial package | Icon for packages containing base classes | MSL |
| `Modelica.Icons.VariantsPackage` | partial package | Icon for package containing variants | MSL |
| `Modelica.Icons.InterfacesPackage` | partial package | Icon for packages containing interfaces | MSL |
| `Modelica.Icons.SourcesPackage` | partial package | Icon for packages containing sources | MSL |
| `Modelica.Icons.SensorsPackage` | partial package | Icon for packages containing sensors | MSL |
| `Modelica.Icons.UtilitiesPackage` | partial package | Icon for utility packages | MSL |
| `Modelica.Icons.TypesPackage` | partial package | Icon for packages containing type definitions | MSL |
| `Modelica.Icons.IconsPackage` | partial package | Icon for packages containing icons | MSL |
| `Modelica.Icons.RoundSensor` | partial class | Icon representing a round measurement device | MSL |
| `Modelica.Icons.RectangularSensor` | partial class | Icon representing a linear measurement device | MSL |
| `Modelica.Icons.RotationalSensor` | partial class | Icon representing a round measurement device (MSL 3 name of RoundSensor) | new (alias of RoundSensor (MSL 3 name)) |
| `Modelica.Icons.TranslationalSensor` | partial class | Icon representing a linear measurement device (MSL 3 name of RectangularSensor) | new (alias of RectangularSensor (MSL 3 name)) |
| `Modelica.Icons.Function` | partial class | Icon for functions | MSL, simplified: declared as \`partial class\` (functions are not supported) |
| `Modelica.Icons.Record` | partial record | Icon for records | MSL |

### `libraries/Modelica/Units.mo`

| Class | Kind | Description | Origin |
| --- | --- | --- | --- |
| `Modelica.Units` | package | Library of type and unit definitions | MSL, simplified: Conversions package omitted (functions) |
| `Modelica.Units.SI` | package | Library of SI unit definitions | MSL, simplified: subset of the SI types actually used |
| `Modelica.Units.SI.Angle` | type (short class) |  | MSL |
| `Modelica.Units.SI.Length` | type (short class) |  | MSL |
| `Modelica.Units.SI.Position` | type (short class) |  | MSL |
| `Modelica.Units.SI.Distance` | type (short class) |  | MSL |
| `Modelica.Units.SI.Radius` | type (short class) |  | MSL |
| `Modelica.Units.SI.Diameter` | type (short class) |  | MSL |
| `Modelica.Units.SI.Area` | type (short class) |  | MSL |
| `Modelica.Units.SI.Volume` | type (short class) |  | MSL |
| `Modelica.Units.SI.Time` | type (short class) |  | MSL |
| `Modelica.Units.SI.Duration` | type (short class) |  | MSL |
| `Modelica.Units.SI.AngularVelocity` | type (short class) |  | MSL |
| `Modelica.Units.SI.AngularAcceleration` | type (short class) |  | MSL |
| `Modelica.Units.SI.Velocity` | type (short class) |  | MSL |
| `Modelica.Units.SI.Acceleration` | type (short class) |  | MSL |
| `Modelica.Units.SI.Period` | type (short class) |  | MSL |
| `Modelica.Units.SI.Frequency` | type (short class) |  | MSL |
| `Modelica.Units.SI.AngularFrequency` | type (short class) |  | MSL |
| `Modelica.Units.SI.DampingCoefficient` | type (short class) |  | MSL |
| `Modelica.Units.SI.Damping` | type (short class) |  | MSL |
| `Modelica.Units.SI.Mass` | type (short class) |  | MSL |
| `Modelica.Units.SI.Density` | type (short class) |  | MSL |
| `Modelica.Units.SI.Momentum` | type (short class) |  | MSL |
| `Modelica.Units.SI.Impulse` | type (short class) |  | MSL |
| `Modelica.Units.SI.AngularMomentum` | type (short class) |  | MSL |
| `Modelica.Units.SI.MomentOfInertia` | type (short class) |  | MSL |
| `Modelica.Units.SI.Inertia` | type (short class) |  | MSL |
| `Modelica.Units.SI.Force` | type (short class) |  | MSL |
| `Modelica.Units.SI.TranslationalSpringConstant` | type (short class) |  | MSL |
| `Modelica.Units.SI.TranslationalDampingConstant` | type (short class) |  | MSL |
| `Modelica.Units.SI.Weight` | type (short class) |  | MSL |
| `Modelica.Units.SI.Torque` | type (short class) |  | MSL |
| `Modelica.Units.SI.ElectricalTorqueConstant` | type (short class) |  | MSL |
| `Modelica.Units.SI.MomentOfForce` | type (short class) |  | MSL |
| `Modelica.Units.SI.RotationalSpringConstant` | type (short class) |  | MSL |
| `Modelica.Units.SI.RotationalDampingConstant` | type (short class) |  | MSL |
| `Modelica.Units.SI.Pressure` | type (short class) |  | MSL |
| `Modelica.Units.SI.AbsolutePressure` | type (short class) |  | MSL |
| `Modelica.Units.SI.PressureDifference` | type (short class) |  | MSL |
| `Modelica.Units.SI.Work` | type (short class) |  | MSL |
| `Modelica.Units.SI.Energy` | type (short class) |  | MSL |
| `Modelica.Units.SI.PotentialEnergy` | type (short class) |  | MSL |
| `Modelica.Units.SI.KineticEnergy` | type (short class) |  | MSL |
| `Modelica.Units.SI.Power` | type (short class) |  | MSL |
| `Modelica.Units.SI.EnergyFlowRate` | type (short class) |  | MSL |
| `Modelica.Units.SI.Efficiency` | type (short class) |  | MSL |
| `Modelica.Units.SI.MassFlowRate` | type (short class) |  | MSL |
| `Modelica.Units.SI.VolumeFlowRate` | type (short class) |  | MSL |
| `Modelica.Units.SI.ThermodynamicTemperature` | type (short class) |  | MSL |
| `Modelica.Units.SI.Temp_K` | type (short class) |  | MSL |
| `Modelica.Units.SI.Temperature` | type (short class) |  | MSL |
| `Modelica.Units.SI.TemperatureDifference` | type (short class) |  | MSL |
| `Modelica.Units.SI.TemperatureSlope` | type (short class) |  | MSL |
| `Modelica.Units.SI.LinearTemperatureCoefficient` | type (short class) |  | MSL |
| `Modelica.Units.SI.Heat` | type (short class) |  | MSL |
| `Modelica.Units.SI.HeatFlowRate` | type (short class) |  | MSL |
| `Modelica.Units.SI.HeatFlux` | type (short class) |  | MSL |
| `Modelica.Units.SI.ThermalConductivity` | type (short class) |  | MSL |
| `Modelica.Units.SI.CoefficientOfHeatTransfer` | type (short class) |  | MSL |
| `Modelica.Units.SI.ThermalResistance` | type (short class) |  | MSL |
| `Modelica.Units.SI.ThermalConductance` | type (short class) |  | MSL |
| `Modelica.Units.SI.HeatCapacity` | type (short class) |  | MSL |
| `Modelica.Units.SI.SpecificHeatCapacity` | type (short class) |  | MSL |
| `Modelica.Units.SI.Emissivity` | type (short class) |  | MSL |
| `Modelica.Units.SI.ElectricCurrent` | type (short class) |  | MSL |
| `Modelica.Units.SI.Current` | type (short class) |  | MSL |
| `Modelica.Units.SI.CurrentSlope` | type (short class) |  | MSL |
| `Modelica.Units.SI.ElectricCharge` | type (short class) |  | MSL |
| `Modelica.Units.SI.Charge` | type (short class) |  | MSL |
| `Modelica.Units.SI.ElectricPotential` | type (short class) |  | MSL |
| `Modelica.Units.SI.Voltage` | type (short class) |  | MSL |
| `Modelica.Units.SI.PotentialDifference` | type (short class) |  | MSL |
| `Modelica.Units.SI.ElectromotiveForce` | type (short class) |  | MSL |
| `Modelica.Units.SI.VoltageSlope` | type (short class) |  | MSL |
| `Modelica.Units.SI.Capacitance` | type (short class) |  | MSL |
| `Modelica.Units.SI.MagneticFlux` | type (short class) |  | MSL |
| `Modelica.Units.SI.Inductance` | type (short class) |  | MSL |
| `Modelica.Units.SI.SelfInductance` | type (short class) |  | MSL |
| `Modelica.Units.SI.MutualInductance` | type (short class) |  | MSL |
| `Modelica.Units.SI.Resistance` | type (short class) |  | MSL |
| `Modelica.Units.SI.Resistivity` | type (short class) |  | MSL |
| `Modelica.Units.SI.Conductivity` | type (short class) |  | MSL |
| `Modelica.Units.SI.Impedance` | type (short class) |  | MSL |
| `Modelica.Units.SI.Reactance` | type (short class) |  | MSL |
| `Modelica.Units.SI.Conductance` | type (short class) |  | MSL |
| `Modelica.Units.SI.Admittance` | type (short class) |  | MSL |
| `Modelica.Units.SI.Permeability` | type (short class) |  | MSL |
| `Modelica.Units.NonSI` | package | Type definitions of non SI and other units | MSL, simplified: subset of the NonSI types |
| `Modelica.Units.NonSI.Temperature_degC` | type (short class) |  | MSL |
| `Modelica.Units.NonSI.Temperature_degF` | type (short class) |  | MSL |
| `Modelica.Units.NonSI.Angle_deg` | type (short class) |  | MSL |
| `Modelica.Units.NonSI.AngularVelocity_rpm` | type (short class) |  | MSL |
| `Modelica.Units.NonSI.Velocity_kmh` | type (short class) |  | MSL |
| `Modelica.Units.NonSI.Time_day` | type (short class) |  | MSL |
| `Modelica.Units.NonSI.Time_hour` | type (short class) |  | MSL |
| `Modelica.Units.NonSI.Time_minute` | type (short class) |  | MSL |
| `Modelica.Units.NonSI.Volume_litre` | type (short class) |  | MSL |
| `Modelica.Units.NonSI.Pressure_bar` | type (short class) |  | MSL |

### `libraries/Modelica/Constants.mo`

| Class | Kind | Description | Origin |
| --- | --- | --- | --- |
| `Modelica.Constants` | package | Library of mathematical constants and constants of nature (e.g., pi, eps, R, sigma) | MSL, simplified: values given as literals (e, pi, eps, small, inf, sigma, R, ...) instead of function calls / ModelicaServices |

### `libraries/Modelica/Blocks.mo`

| Class | Kind | Description | Origin |
| --- | --- | --- | --- |
| `Modelica.Blocks` | package | Library of basic input/output control blocks (continuous, math, nonlinear, sources) | MSL |
| `Modelica.Blocks.Examples` | package | Library of examples to demonstrate the usage of package Blocks | MSL |
| `Modelica.Blocks.Examples.PID_Controller` | model | Demonstrates the usage of a Continuous.PI controller | MSL, simplified: uses Continuous.PI + Math.Feedback instead of LimPID, Sources.Trapezoid instead of KinematicPTP + Integrator; steady-state initialization via initial equations |
| `Modelica.Blocks.Continuous` | package | Library of continuous control blocks with internal states | MSL, simplified: no initType option in any block; states initialized from *_start with fixed=true |
| `Modelica.Blocks.Continuous.Integrator` | block | Output the integral of the input signal | MSL, simplified: initType, reset/set ports removed; y(start=y_start, fixed=true) |
| `Modelica.Blocks.Continuous.Derivative` | block | Approximated derivative block | MSL, simplified: initType removed; x(start=x_start, fixed=true) |
| `Modelica.Blocks.Continuous.FirstOrder` | block | First order transfer function block (= 1 pole) | MSL, simplified: initType removed; y(start=y_start, fixed=true) |
| `Modelica.Blocks.Continuous.SecondOrder` | block | Second order transfer function block (= 2 poles) | MSL, simplified: initType removed; y, yd fixed start values |
| `Modelica.Blocks.Continuous.PI` | block | Proportional-Integral controller | MSL, simplified: initType removed; x(start=x_start, fixed=true) |
| `Modelica.Blocks.Continuous.PID` | block | PID controller in additive description form | MSL, simplified: initType removed (xi_start, xd_start kept); T=max(Td/Nd, 100*eps) scalar instead of matrix max; hierarchical structure kept |
| `Modelica.Blocks.Interfaces` | package | Library of connectors and partial models for input/output blocks | MSL |
| `Modelica.Blocks.Interfaces.RealInput` | connector (short class) |  | MSL |
| `Modelica.Blocks.Interfaces.RealOutput` | connector (short class) |  | MSL |
| `Modelica.Blocks.Interfaces.BooleanInput` | connector (short class) |  | MSL |
| `Modelica.Blocks.Interfaces.BooleanOutput` | connector (short class) |  | MSL |
| `Modelica.Blocks.Interfaces.SO` | partial block | Single Output continuous control block | MSL |
| `Modelica.Blocks.Interfaces.SISO` | partial block | Single Input Single Output continuous control block | MSL |
| `Modelica.Blocks.Interfaces.SI2SO` | partial block | 2 Single Input / 1 Single Output continuous control block | MSL |
| `Modelica.Blocks.Interfaces.SignalSource` | partial block | Base class for continuous signal source | MSL |
| `Modelica.Blocks.Math` | package | Library of Real mathematical functions as input/output blocks | MSL |
| `Modelica.Blocks.Math.Gain` | block | Output the product of a gain value with the input signal | MSL |
| `Modelica.Blocks.Math.Add` | block | Output the sum of the two inputs | MSL |
| `Modelica.Blocks.Math.Add3` | block | Output the sum of the three inputs | MSL |
| `Modelica.Blocks.Math.Feedback` | block | Output difference between commanded and feedback input | MSL |
| `Modelica.Blocks.Math.Product` | block | Output product of the two inputs | MSL |
| `Modelica.Blocks.Math.Division` | block | Output first input divided by second input | MSL |
| `Modelica.Blocks.Math.Abs` | block | Output the absolute value of the input | MSL |
| `Modelica.Blocks.Math.Sqrt` | block | Output the square root of the input (input >= 0 required) | MSL |
| `Modelica.Blocks.Math.Sin` | block | Output the sine of the input | MSL, simplified: uses builtin sin() instead of Modelica.Math.sin |
| `Modelica.Blocks.Math.Cos` | block | Output the cosine of the input | MSL, simplified: uses builtin cos() |
| `Modelica.Blocks.Math.Exp` | block | Output the exponential (base e) of the input | MSL, simplified: uses builtin exp() |
| `Modelica.Blocks.Math.Log` | block | Output the logarithm (default base e) of the input (input > 0 required) | MSL, simplified: uses builtin log() |
| `Modelica.Blocks.Math.Max` | block | Pass through the largest signal | MSL |
| `Modelica.Blocks.Math.Min` | block | Pass through the smallest signal | MSL |
| `Modelica.Blocks.Nonlinear` | package | Library of discontinuous or non-differentiable algebraic control blocks | MSL |
| `Modelica.Blocks.Nonlinear.Limiter` | block | Limit the range of a signal | MSL, simplified: homotopyType parameter and homotopy() removed; assert message without String() |
| `Modelica.Blocks.Nonlinear.DeadZone` | block | Provide a region of zero output | MSL, simplified: homotopy() removed; assert message without String() |
| `Modelica.Blocks.Sources` | package | Library of signal source blocks generating Real signals | MSL, simplified: Real signal sources only (no Integer/Boolean sources, tables, KinematicPTP, ...) |
| `Modelica.Blocks.Sources.Constant` | block | Generate constant signal of type Real | MSL |
| `Modelica.Blocks.Sources.Step` | block | Generate step signal of type Real | MSL |
| `Modelica.Blocks.Sources.Sine` | block | Generate sine signal | MSL, simplified: \`continuous\` option removed (MSL 3.2.3 form) |
| `Modelica.Blocks.Sources.Cosine` | block | Generate cosine signal | MSL, simplified: \`continuous\` option removed |
| `Modelica.Blocks.Sources.Ramp` | block | Generate ramp signal | MSL |
| `Modelica.Blocks.Sources.ExpSine` | block | Generate exponentially damped sine signal | MSL |
| `Modelica.Blocks.Sources.Pulse` | block | Generate pulse signal of type Real | MSL, simplified: mod()-based expression instead of when/pre time events and initial algorithm |
| `Modelica.Blocks.Sources.SawTooth` | block | Generate saw tooth signal | MSL, simplified: mod()-based expression instead of when/pre time events |
| `Modelica.Blocks.Sources.Trapezoid` | block | Generate trapezoidal signal of type Real | MSL, simplified: mod()-based expression (helper variable t_period) instead of when/pre time events |
| `Modelica.Blocks.Sources.ContinuousClock` | block | Generate current time signal | MSL |
| `Modelica.Blocks.Sources.Clock` | block | Generate current time signal (MSL 3 name of ContinuousClock) | new (alias of ContinuousClock (MSL 3 name)) |
| `Modelica.Blocks.Types` | package | Library of constants and types with choices, especially to build menus | MSL, simplified: Init and SimpleController only (kept for compatibility, not used by the blocks) |
| `Modelica.Blocks.Types.Init` | type (short class) |  | MSL |
| `Modelica.Blocks.Types.SimpleController` | type (short class) |  | MSL |
| `Modelica.Blocks.Icons` | package | Icons for Blocks | MSL |
| `Modelica.Blocks.Icons.Block` | partial block | Basic graphical layout of input/output block | MSL |
| `Modelica.Blocks.Icons.BooleanBlock` | partial block | Basic graphical layout of Boolean block | MSL |

### `libraries/Modelica/Electrical.mo`

| Class | Kind | Description | Origin |
| --- | --- | --- | --- |
| `Modelica.Electrical` | package | Library of electrical models (analog) | MSL |
| `Modelica.Electrical.Analog` | package | Library for analog electrical models | MSL |
| `Modelica.Electrical.Analog.Examples` | package | Examples that demonstrate the usage of the Analog electrical components | MSL |
| `Modelica.Electrical.Analog.Examples.ChuaCircuit` | model | Chua's circuit, ns, V, A | MSL |
| `Modelica.Electrical.Analog.Examples.CharacteristicIdealDiodes` | model | Characteristic of ideal diodes | MSL |
| `Modelica.Electrical.Analog.Examples.CauerLowPassAnalog` | model | Cauer low pass filter with analog components | MSL, simplified: unchanged equations; only the components it uses are simplified |
| `Modelica.Electrical.Analog.Examples.Utilities` | package | Utility components used by package Examples | MSL |
| `Modelica.Electrical.Analog.Examples.Utilities.NonlinearResistor` | model | Chua's resistor | MSL |
| `Modelica.Electrical.Analog.Basic` | package | Basic electrical components | MSL |
| `Modelica.Electrical.Analog.Basic.Ground` | model | Ground node | MSL |
| `Modelica.Electrical.Analog.Basic.Resistor` | model | Ideal linear electrical resistor | MSL, simplified: conditional heat port removed: fixed device temperature parameter T (=T_ref) and variables T_heatPort, LossPower kept |
| `Modelica.Electrical.Analog.Basic.Conductor` | model | Ideal linear electrical conductor | MSL, simplified: conditional heat port removed (see Resistor) |
| `Modelica.Electrical.Analog.Basic.Capacitor` | model | Ideal linear electrical capacitor | MSL |
| `Modelica.Electrical.Analog.Basic.Inductor` | model | Ideal linear electrical inductor | MSL |
| `Modelica.Electrical.Analog.Basic.Transformer` | model | Transformer with two ports | MSL |
| `Modelica.Electrical.Analog.Basic.RotationalEMF` | model | Electromotoric force (electric/mechanic transformer) | MSL, simplified: useSupport/support connector removed: shaft internally fixed (protected phi_support = 0) |
| `Modelica.Electrical.Analog.Basic.EMF` | model | Electromotoric force (MSL 3 name of RotationalEMF) | new (alias of RotationalEMF (MSL 3 name)) |
| `Modelica.Electrical.Analog.Ideal` | package | Ideal electrical elements such as switches and diode | MSL |
| `Modelica.Electrical.Analog.Ideal.IdealDiode` | model | Ideal diode | MSL, simplified: inherits simplified IdealSemiconductor (no heat port) |
| `Modelica.Electrical.Analog.Ideal.IdealOpeningSwitch` | model | Ideal electrical opener | MSL, simplified: inherits simplified IdealSwitch (no heat port) |
| `Modelica.Electrical.Analog.Ideal.IdealClosingSwitch` | model | Ideal electrical closer | MSL, simplified: inherits simplified IdealSwitch (no heat port) |
| `Modelica.Electrical.Analog.Sensors` | package | Potential, voltage, current, and power sensors | MSL |
| `Modelica.Electrical.Analog.Sensors.VoltageSensor` | model | Sensor to measure the voltage between two pins | MSL |
| `Modelica.Electrical.Analog.Sensors.CurrentSensor` | model | Sensor to measure the current in a branch | MSL |
| `Modelica.Electrical.Analog.Sensors.PowerSensor` | model | Sensor to measure the power | MSL |
| `Modelica.Electrical.Analog.Sensors.PotentialSensor` | model | Sensor to measure the potential | MSL |
| `Modelica.Electrical.Analog.Sources` | package | Time-dependent and controlled voltage and current sources | MSL |
| `Modelica.Electrical.Analog.Sources.ConstantVoltage` | model | Source for constant voltage | MSL |
| `Modelica.Electrical.Analog.Sources.SineVoltage` | model | Sine voltage source | MSL, simplified: signal equation written directly (no redeclare of Blocks.Sources.Sine) |
| `Modelica.Electrical.Analog.Sources.StepVoltage` | model | Step voltage source | MSL, simplified: signal equation written directly |
| `Modelica.Electrical.Analog.Sources.RampVoltage` | model | Ramp voltage source | MSL, simplified: signal equation written directly |
| `Modelica.Electrical.Analog.Sources.PulseVoltage` | model | Pulse voltage source | MSL, simplified: signal equation written directly with mod(); nperiod not available |
| `Modelica.Electrical.Analog.Sources.SignalVoltage` | model | Generic voltage source using the input signal as source voltage | MSL |
| `Modelica.Electrical.Analog.Sources.ConstantCurrent` | model | Source for constant current | MSL |
| `Modelica.Electrical.Analog.Sources.SineCurrent` | model | Sine current source | MSL, simplified: signal equation written directly |
| `Modelica.Electrical.Analog.Sources.StepCurrent` | model | Step current source | MSL, simplified: signal equation written directly |
| `Modelica.Electrical.Analog.Sources.SignalCurrent` | model | Generic current source using the input signal as source current | MSL |
| `Modelica.Electrical.Analog.Interfaces` | package | Connectors and partial models for Analog electrical components | MSL |
| `Modelica.Electrical.Analog.Interfaces.Pin` | connector | Pin of an electrical component | MSL, simplified: unassignedMessage annotations dropped |
| `Modelica.Electrical.Analog.Interfaces.PositivePin` | connector | Positive pin of an electrical component | MSL, simplified: unassignedMessage annotations dropped |
| `Modelica.Electrical.Analog.Interfaces.NegativePin` | connector | Negative pin of an electrical component | MSL, simplified: unassignedMessage annotations dropped |
| `Modelica.Electrical.Analog.Interfaces.TwoPin` | partial model | Component with two electrical pins | MSL |
| `Modelica.Electrical.Analog.Interfaces.OnePort` | partial model | Component with two electrical pins p and n and current i from p to n | MSL |
| `Modelica.Electrical.Analog.Interfaces.FourPin` | partial model | Component with two pairs of each two electrical pins | MSL |
| `Modelica.Electrical.Analog.Interfaces.TwoPort` | partial model | Component with two electrical ports, including current | MSL |
| `Modelica.Electrical.Analog.Interfaces.VoltageSource` | partial model | Interface for voltage sources | MSL, simplified: replaceable signalSource block removed; derived sources contain the signal equation directly |
| `Modelica.Electrical.Analog.Interfaces.CurrentSource` | partial model | Interface for current sources | MSL, simplified: replaceable signalSource block removed |
| `Modelica.Electrical.Analog.Interfaces.IdealSemiconductor` | partial model | Ideal semiconductor | MSL, simplified: conditional heat port removed; LossPower kept as variable |
| `Modelica.Electrical.Analog.Interfaces.IdealSwitch` | partial model | Ideal electrical switch | MSL, simplified: conditional heat port removed; LossPower kept as variable |
| `Modelica.Electrical.Analog.Interfaces.AbsoluteSensor` | partial model | Base class to measure the absolute value of a pin variable | MSL |
| `Modelica.Electrical.Analog.Interfaces.RelativeSensor` | partial model | Base class to measure a relative variable between two pins | MSL |
| `Modelica.Electrical.Analog.Icons` | package | Icons for analog electrical models | MSL |
| `Modelica.Electrical.Analog.Icons.VoltageSource` | partial model | Icon for voltage sources | MSL |
| `Modelica.Electrical.Analog.Icons.CurrentSource` | partial model | Icon for current sources | MSL |

### `libraries/Modelica/Mechanics.mo`

| Class | Kind | Description | Origin |
| --- | --- | --- | --- |
| `Modelica.Mechanics` | package | Library of 1-dim. mechanical components (rotational, translational) | MSL |
| `Modelica.Mechanics.Rotational` | package | Library to model 1-dimensional, rotational mechanical systems | MSL |
| `Modelica.Mechanics.Rotational.Examples` | package | Demonstration examples of the components of this package | MSL |
| `Modelica.Mechanics.Rotational.Examples.First` | model | First example: simple drive train | MSL, simplified: torque and idealGear without useSupport=true (connections to fixed.flange via support removed) |
| `Modelica.Mechanics.Rotational.Components` | package | Components for 1D rotational mechanical drive trains | MSL |
| `Modelica.Mechanics.Rotational.Components.Fixed` | model | Flange fixed in housing at a given angle | MSL |
| `Modelica.Mechanics.Rotational.Components.Inertia` | model | 1D-rotational component with inertia | MSL, simplified: stateSelect parameter removed |
| `Modelica.Mechanics.Rotational.Components.Spring` | model | Linear 1D rotational spring | MSL |
| `Modelica.Mechanics.Rotational.Components.Damper` | model | Linear 1D rotational damper | MSL, simplified: conditional heat port removed; lossPower kept as variable |
| `Modelica.Mechanics.Rotational.Components.SpringDamper` | model | Linear 1D rotational spring and damper in parallel | MSL, simplified: conditional heat port removed; lossPower kept as variable |
| `Modelica.Mechanics.Rotational.Components.IdealGear` | model | Ideal gear without inertia | MSL, simplified: no support connector (internally fixed) |
| `Modelica.Mechanics.Rotational.Sources` | package | Sources to drive 1D rotational mechanical components | MSL |
| `Modelica.Mechanics.Rotational.Sources.Torque` | model | Input signal acting as external torque on a flange | MSL, simplified: no support connector (internally fixed) |
| `Modelica.Mechanics.Rotational.Sources.ConstantTorque` | model | Constant torque, not dependent on speed | MSL, simplified: no support connector (internally fixed) |
| `Modelica.Mechanics.Rotational.Sources.ConstantSpeed` | model | Constant speed, not dependent on torque | MSL, simplified: no support connector (internally fixed) |
| `Modelica.Mechanics.Rotational.Sensors` | package | Sensors to measure variables in 1D rotational mechanical components | MSL |
| `Modelica.Mechanics.Rotational.Sensors.AngleSensor` | model | Ideal sensor to measure the absolute angle of flange | MSL |
| `Modelica.Mechanics.Rotational.Sensors.SpeedSensor` | model | Ideal sensor to measure the absolute angular velocity of flange | MSL |
| `Modelica.Mechanics.Rotational.Sensors.AccSensor` | model | Ideal sensor to measure the absolute angular acceleration of flange | MSL |
| `Modelica.Mechanics.Rotational.Sensors.TorqueSensor` | model | Ideal sensor to measure the torque between two flanges | MSL |
| `Modelica.Mechanics.Rotational.Sensors.PowerSensor` | model | Ideal sensor to measure the power between two flanges | MSL |
| `Modelica.Mechanics.Rotational.Sensors.RelAngleSensor` | model | Ideal sensor to measure the relative angle between two flanges | MSL |
| `Modelica.Mechanics.Rotational.Sensors.RelSpeedSensor` | model | Ideal sensor to measure the relative angular velocity between two flanges | MSL |
| `Modelica.Mechanics.Rotational.Interfaces` | package | Connectors and partial models for 1D rotational mechanical components | MSL |
| `Modelica.Mechanics.Rotational.Interfaces.Flange` | connector | One-dimensional rotational flange | MSL |
| `Modelica.Mechanics.Rotational.Interfaces.Flange_a` | connector | One-dimensional rotational flange of a shaft (filled circle icon) | MSL |
| `Modelica.Mechanics.Rotational.Interfaces.Flange_b` | connector | One-dimensional rotational flange of a shaft (non-filled circle icon) | MSL |
| `Modelica.Mechanics.Rotational.Interfaces.Support` | connector | Support/housing flange of a one-dimensional rotational shaft | MSL |
| `Modelica.Mechanics.Rotational.Interfaces.PartialTwoFlanges` | partial model | Partial model for a component with two rotational 1-dim. shaft flanges | MSL |
| `Modelica.Mechanics.Rotational.Interfaces.PartialCompliant` | partial model | Partial model for the compliant connection of two rotational 1-dim. shaft flanges | MSL |
| `Modelica.Mechanics.Rotational.Interfaces.PartialCompliantWithRelativeStates` | partial model | Partial model for the compliant connection of two rotational 1-dim. shaft flanges where the relative angle and speed are used as preferred states | MSL, simplified: stateSelect parameter removed; nominal=phi_nominal directly |
| `Modelica.Mechanics.Rotational.Interfaces.PartialElementaryOneFlangeAndSupport2` | partial model | Partial model for a component with one rotational 1-dim. shaft flange and a support used for textual modeling, i.e., for elementary models | MSL, simplified: useSupport/support connector removed; protected phi_support = 0 (grounding lines always visible) |
| `Modelica.Mechanics.Rotational.Interfaces.PartialElementaryTwoFlangesAndSupport2` | partial model | Partial model for a component with two rotational 1-dim. shaft flanges and a support used for textual modeling, i.e., for elementary models | MSL, simplified: useSupport/support connector removed; protected phi_support = 0 |
| `Modelica.Mechanics.Rotational.Interfaces.PartialTorque` | partial model | Partial model of a torque acting at the flange (accelerates the flange) | MSL, simplified: inherits simplified support handling |
| `Modelica.Mechanics.Rotational.Interfaces.PartialAbsoluteSensor` | partial model | Partial model to measure a single absolute flange variable | MSL |
| `Modelica.Mechanics.Rotational.Interfaces.PartialRelativeSensor` | partial model | Partial model to measure a single relative variable between two flanges | MSL |
| `Modelica.Mechanics.Rotational.Icons` | package | Icons for Rotational package | MSL |
| `Modelica.Mechanics.Rotational.Icons.Gear` | partial class | Icon of a rotational gear | MSL |
| `Modelica.Mechanics.Translational` | package | Library to model 1-dimensional, translational mechanical systems | MSL |
| `Modelica.Mechanics.Translational.Examples` | package | Demonstration examples of the components of this package | MSL |
| `Modelica.Mechanics.Translational.Examples.Oscillator` | model | Oscillator demonstrates the use of initial conditions | MSL |
| `Modelica.Mechanics.Translational.Components` | package | Components for 1D translational mechanical drive trains | MSL |
| `Modelica.Mechanics.Translational.Components.Fixed` | model | Fixed flange | MSL |
| `Modelica.Mechanics.Translational.Components.Mass` | model | Sliding mass with inertia | MSL, simplified: stateSelect parameter removed |
| `Modelica.Mechanics.Translational.Components.Rod` | model | Rod without inertia | MSL |
| `Modelica.Mechanics.Translational.Components.Spring` | model | Linear 1D translational spring | MSL |
| `Modelica.Mechanics.Translational.Components.Damper` | model | Linear 1D translational damper | MSL, simplified: conditional heat port removed; lossPower kept as variable |
| `Modelica.Mechanics.Translational.Components.SpringDamper` | model | Linear 1D translational spring and damper in parallel | MSL, simplified: conditional heat port removed; lossPower kept as variable |
| `Modelica.Mechanics.Translational.Components.ElastoGap` | model | 1D translational spring damper combination with gap | MSL, simplified: conditional heat port removed; smooth()/noEvent() dropped |
| `Modelica.Mechanics.Translational.Sources` | package | Sources to drive 1D translational mechanical components | MSL |
| `Modelica.Mechanics.Translational.Sources.Force` | model | External force acting on a drive train element as input signal | MSL, simplified: no support connector (internally fixed) |
| `Modelica.Mechanics.Translational.Sources.ConstantForce` | model | Constant force, not dependent on speed | MSL, simplified: no support connector (internally fixed) |
| `Modelica.Mechanics.Translational.Sensors` | package | Sensors for 1-dim. translational mechanical quantities | MSL |
| `Modelica.Mechanics.Translational.Sensors.PositionSensor` | model | Ideal sensor to measure the absolute position of flange | MSL |
| `Modelica.Mechanics.Translational.Sensors.SpeedSensor` | model | Ideal sensor to measure the absolute velocity of flange | MSL |
| `Modelica.Mechanics.Translational.Sensors.AccSensor` | model | Ideal sensor to measure the absolute acceleration of flange | MSL |
| `Modelica.Mechanics.Translational.Sensors.ForceSensor` | model | Ideal sensor to measure the force between two flanges | MSL |
| `Modelica.Mechanics.Translational.Sensors.RelPositionSensor` | model | Ideal sensor to measure the relative position between two flanges | MSL |
| `Modelica.Mechanics.Translational.Sensors.RelSpeedSensor` | model | Ideal sensor to measure the relative velocity between two flanges | MSL |
| `Modelica.Mechanics.Translational.Interfaces` | package | Interfaces for 1-dim. translational mechanical components | MSL |
| `Modelica.Mechanics.Translational.Interfaces.Flange` | connector | One-dimensional translational flange | MSL |
| `Modelica.Mechanics.Translational.Interfaces.Flange_a` | connector | One-dimensional translational flange (left, flange axis directed INTO cut plane) | MSL |
| `Modelica.Mechanics.Translational.Interfaces.Flange_b` | connector | One-dimensional translational flange (right, flange axis directed OUT OF cut plane) | MSL |
| `Modelica.Mechanics.Translational.Interfaces.Support` | connector | Support/housing flange of a one-dimensional translational component | MSL |
| `Modelica.Mechanics.Translational.Interfaces.PartialTwoFlanges` | partial model | Component with two translational 1D flanges | MSL |
| `Modelica.Mechanics.Translational.Interfaces.PartialCompliant` | partial model | Compliant connection of two translational 1D flanges | MSL |
| `Modelica.Mechanics.Translational.Interfaces.PartialCompliantWithRelativeStates` | partial model | Base model for the compliant connection of two translational 1-dim. shaft flanges where the relative position and relative velocities are used as states | MSL, simplified: stateSelect parameter removed |
| `Modelica.Mechanics.Translational.Interfaces.PartialRigid` | partial model | Rigid connection of two translational 1D flanges | MSL |
| `Modelica.Mechanics.Translational.Interfaces.PartialElementaryOneFlangeAndSupport2` | partial model | Partial model for a component with one translational 1-dim. shaft flange and a support used for textual modeling, i.e., for elementary models | MSL, simplified: useSupport/support connector removed; protected s_support = 0 |
| `Modelica.Mechanics.Translational.Interfaces.PartialForce` | partial model | Partial model of a force acting at the flange (accelerates the flange) | MSL, simplified: inherits simplified support handling |
| `Modelica.Mechanics.Translational.Interfaces.PartialAbsoluteSensor` | partial model | Device to measure a single absolute flange variable | MSL |
| `Modelica.Mechanics.Translational.Interfaces.PartialRelativeSensor` | partial model | Device to measure a single relative variable between two flanges | MSL |

### `libraries/Modelica/Thermal.mo`

| Class | Kind | Description | Origin |
| --- | --- | --- | --- |
| `Modelica.Thermal` | package | Library of thermal system components to model heat transfer | MSL |
| `Modelica.Thermal.HeatTransfer` | package | Library of 1-dimensional heat transfer with lumped elements | MSL |
| `Modelica.Thermal.HeatTransfer.Examples` | package | Example models to demonstrate the usage of package Modelica.Thermal.HeatTransfer | MSL |
| `Modelica.Thermal.HeatTransfer.Examples.TwoMasses` | model | Simple conduction demo | MSL, simplified: T_final_K is a variable with a regular equation instead of a parameter with fixed=false and an initial equation |
| `Modelica.Thermal.HeatTransfer.Components` | package | Lumped thermal components | MSL |
| `Modelica.Thermal.HeatTransfer.Components.HeatCapacitor` | model | Lumped thermal element storing heat | MSL |
| `Modelica.Thermal.HeatTransfer.Components.ThermalConductor` | model | Lumped thermal element transporting heat without storing it | MSL |
| `Modelica.Thermal.HeatTransfer.Components.ThermalResistor` | model | Lumped thermal element transporting heat without storing it | MSL |
| `Modelica.Thermal.HeatTransfer.Components.Convection` | model | Lumped thermal element for heat convection (Q_flow = Gc*dT) | MSL |
| `Modelica.Thermal.HeatTransfer.Components.BodyRadiation` | model | Lumped thermal element for radiation heat transfer | MSL |
| `Modelica.Thermal.HeatTransfer.Sensors` | package | Thermal sensors | MSL |
| `Modelica.Thermal.HeatTransfer.Sensors.TemperatureSensor` | model | Absolute temperature sensor in Kelvin | MSL |
| `Modelica.Thermal.HeatTransfer.Sensors.HeatFlowSensor` | model | Heat flow rate sensor | MSL |
| `Modelica.Thermal.HeatTransfer.Sensors.RelTemperatureSensor` | model | Relative temperature sensor | MSL |
| `Modelica.Thermal.HeatTransfer.Sources` | package | Thermal sources | MSL |
| `Modelica.Thermal.HeatTransfer.Sources.FixedTemperature` | model | Fixed temperature boundary condition in Kelvin | MSL |
| `Modelica.Thermal.HeatTransfer.Sources.PrescribedTemperature` | model | Variable temperature boundary condition in Kelvin | MSL |
| `Modelica.Thermal.HeatTransfer.Sources.FixedHeatFlow` | model | Fixed heat flow boundary condition | MSL |
| `Modelica.Thermal.HeatTransfer.Sources.PrescribedHeatFlow` | model | Prescribed heat flow boundary condition | MSL |
| `Modelica.Thermal.HeatTransfer.Celsius` | package | Components with Celsius input and/or output | MSL |
| `Modelica.Thermal.HeatTransfer.Celsius.ToKelvin` | model | Conversion from degree Celsius to Kelvin | MSL, simplified: K = degC + 273.15 instead of Modelica.Units.Conversions.from_degC |
| `Modelica.Thermal.HeatTransfer.Celsius.FromKelvin` | model | Conversion from Kelvin to degree Celsius | MSL, simplified: degC = K - 273.15 instead of to_degC |
| `Modelica.Thermal.HeatTransfer.Celsius.FixedTemperature` | model | Fixed temperature boundary condition in degree Celsius | MSL, simplified: arithmetic conversion instead of from_degC |
| `Modelica.Thermal.HeatTransfer.Celsius.PrescribedTemperature` | model | Variable temperature boundary condition in degCelsius | MSL, simplified: arithmetic conversion instead of from_degC |
| `Modelica.Thermal.HeatTransfer.Celsius.TemperatureSensor` | model | Absolute temperature sensor in degCelsius | MSL, simplified: arithmetic conversion instead of to_degC |
| `Modelica.Thermal.HeatTransfer.Interfaces` | package | Connectors and partial models | MSL |
| `Modelica.Thermal.HeatTransfer.Interfaces.HeatPort` | partial connector | Thermal port for 1-dim. heat transfer | MSL |
| `Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a` | connector | Thermal port for 1-dim. heat transfer (filled rectangular icon) | MSL |
| `Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_b` | connector | Thermal port for 1-dim. heat transfer (unfilled rectangular icon) | MSL |
| `Modelica.Thermal.HeatTransfer.Interfaces.Element1D` | partial model | Partial heat transfer element with two HeatPort connectors that does not store energy | MSL |
| `Modelica.Thermal.HeatTransfer.Icons` | package | Icons for HeatTransfer package | MSL |
| `Modelica.Thermal.HeatTransfer.Icons.Conversion` | partial model | Conversion of temperatures | MSL, simplified: declared partial |
| `Modelica.Thermal.HeatTransfer.Icons.FixedTemperature` | partial model | Icon of fixed temperature source | MSL, simplified: declared partial |
| `Modelica.Thermal.HeatTransfer.Icons.PrescribedTemperature` | partial model | Icon of prescribed temperature source | MSL, simplified: declared partial |

### `libraries/Examples/package.mo`

| Class | Kind | Description | Origin |
| --- | --- | --- | --- |
| `Examples` | package | Example models | new |
| `Examples.RCCircuit` | model | RC low-pass circuit charged by a step voltage | new |
| `Examples.RLCCircuit` | model | Series RLC resonance circuit driven by a sine voltage | new |
| `Examples.MassSpringDamper` | model | Mass-spring-damper system excited by a step force | new |
| `Examples.RotationalDrive` | model | Two inertias coupled by a spring-damper and driven by a sine torque | new |
| `Examples.PIDControlledMotor` | model | DC motor with PI speed control | new |
| `Examples.HeatedRoom` | model | Room heated by a prescribed heat flow and losing heat through a wall | new |
| `Examples.BouncingBall` | model | Bouncing ball with coefficient of restitution | new |
| `Examples.VanDerPol` | model | Van der Pol oscillator | new |
| `Examples.LotkaVolterra` | model | Lotka-Volterra predator-prey equations | new |
| `Examples.SimplePendulum` | model | Mathematical pendulum with viscous damping (equation based) | new |

## Verification

The libraries were validated with three scripts (kept outside the repository):

1. **Structure**: balanced `()`, `{}`, `[]` outside strings/comments; every `kind Name ... end Name;`
   properly nested and closed; `within` clause matching the directory; no forbidden constructs
   (`redeclare`, `replaceable`, `algorithm`, `function`, `for`, `loop`, `inner`, `outer`, `stream`,
   `expandable`, `operator`, `external`, `homotopy`) and no `[` (arrays) anywhere in code.
2. **References**: every `Modelica.*` name used in code resolves to a defined class or constant; every
   `extends` and component type resolves; every `connect(a.b, c.d)` refers to declared components and
   connectors (including inherited ones).
3. **Diagram geometry**: for every connection `Line`, the first/last point coincides (tolerance 1.5)
   with the connector position computed from the component `Placement` (origin, extent, rotation)
   and the connector's own `Placement`/`iconTransformation`.

Equation/unknown balance was verified by hand for every non-partial class and recorded in the
`// balance:` comments in the sources.
