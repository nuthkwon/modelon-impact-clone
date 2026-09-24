# Architecture

This repository is a browser-based system modeling & simulation platform modelled on
**Modelon Impact**: Modelica text is the single source of truth, a diagram editor edits that
text through graphical annotations, a compiler flattens a model into a DAE, a numerical
solver simulates it, and the results are plotted in the browser.

```
┌──────────────────────┐   REST (/api, mirrors Impact)   ┌─────────────────────────┐
│ apps/web  (React)    │◄───────────────────────────────►│ apps/server (Express)   │
│  • Navigation bar    │                                 │  • workspaces/projects  │
│  • Libraries panel   │   both import @impact/core      │  • libraries (.mo)      │
│  • Canvas (SVG)      │   for parsing/rendering/editing │  • model executables    │
│  • Details panel     │                                 │  • experiments/cases    │
│  • Plots / Log       │                                 │  • simulation jobs      │
└──────────────────────┘                                 └─────────────────────────┘
              ▲                                                       ▲
              └──────────────── packages/core ────────────────────────┘
      parser → registry → flatten → solver        graphics → diagram → editor
```

## Packages

| Path | Purpose |
| --- | --- |
| `packages/core` | Modelica-subset compiler + DAE solver + graphics/diagram/editor logic. Isomorphic (browser + Node), zero runtime deps. |
| `packages/protocol` | REST DTOs and route table shared by server and web. |
| `apps/server` | Express 5 server: file-backed workspaces, library serving, compilation and simulation jobs. |
| `apps/web` | React 19 + Vite UI reproducing Modelon Impact's layout and interactions. |
| `libraries/` | Modelica libraries shipped with the platform: `Modelica/` (subset of the Modelica Standard Library, BSD-3) and `Examples/` |

## `packages/core` module map

| Module | Exports (see `src/index.ts`) | Depends on |
| --- | --- | --- |
| `ast.ts` | AST types, `E` builders, `ModelicaError`, `Diagnostic` | – |
| `graphics.ts` | Graphical annotation types (`GraphicsLayer`, `Placement`, `ConnectionLine`, …) | – |
| `flat.ts` | `FlatModel`, `FlatVariable`, `FlatEquation` | ast |
| `simulation.ts` | `SimulationOptions`, `SimulationResult`, `Trajectory`, `LogMessage` | – |
| `diagram.ts` | `DiagramView`, `ComponentView`, `PortView`, `ClassTreeNode`, `ParameterInfo`, `EditOperation` | ast, graphics, flat |
| `parser/lexer.ts` | `tokenize(text): Token[]` | ast |
| `parser/parser.ts` | `parse(text, file?): StoredDefinition` (throws `ModelicaError`) | lexer |
| `parser/printer.ts` | `printStoredDefinition`, `printClass`, `printExpr`, `printModification` — canonical pretty-printer (round-trips `parse(print(ast))`) | ast |
| `registry.ts` | `ClassRegistry`: stores parsed files per library, resolves fully-qualified names, Modelica name lookup, children, inheritance chain | parser |
| `flatten/` | `flatten(registry, className, opts?) : FlatModel` — instantiation, modifications, extends, connect expansion, parameter evaluation, balance check | registry, evaluate |
| `flatten/evaluate.ts` | `evaluateConstant(expr, env)`, `Env` for constant folding | ast |
| `solver/` | `simulate(flat, options, hooks?) : SimulationResult` — residual compiler, Newton/LU, integrators (Implicit Euler, Trapezoidal/BDF2 with step control, Explicit Euler, RK4), event handling for `when`/`reinit` | flat, simulation |
| `solver/structural/` | `prepareModel(flat)` — alias elimination, known-variable propagation, Pantelides + dummy-derivative index reduction, BLT block initialisation | flat, evaluate |
| `graphics/annotations.ts` | `parseGraphicsLayer(mod, 'Icon'|'Diagram')`, `parsePlacement(annotation)`, `parseConnectionLine(annotation)`, `parseExperiment(annotation)`; robust to missing/odd values | ast, graphics |
| `graphics/serialize.ts` | inverse: `placementToModifier(p)`, `connectionLineToModifier(l)`, `graphicsLayerToModifier(layer, kind)` | ast, graphics |
| `diagram/view.ts` | `buildDiagramView(registry, className): DiagramView` (resolves inherited icons, ports incl. `iconTransformation`, connections) | registry, graphics |
| `diagram/tree.ts` | `buildClassTree(registry, parent?): ClassTreeNode[]` | registry, graphics |
| `diagram/parameters.ts` | `getParameters(registry, className, componentName?)`, `getVariables(...)` (declared + inherited, with `Dialog` groups) | registry, evaluate |
| `editor/operations.ts` | `applyEdit(registry, className, op): EditResult` — mutates a copy of the AST, re-prints the file | registry, printer, graphics/serialize |
| `units.ts` | `formatNumber`, `unitLabel` helpers used by UI | – |

`src/index.ts` re-exports everything. Implementation modules must not import from `apps/*`.

## Modelica subset ("Impact-Lite Modelica")

The parser accepts full Modelica 3.x syntax for the constructs listed below and reports a
clear `Diagnostic` for anything else. The **flattener/solver** support the semantics marked ✔.

| Construct | Parse | Flatten/simulate |
| --- | --- | --- |
| `within A.B;` stored definitions, several top-level classes per file | ✔ | ✔ |
| `package`, `model`, `block`, `connector`, `record`, `type`, `class`; `partial`, `encapsulated`, `expandable` | ✔ | ✔ (record as struct of components; expandable connectors ✘) |
| `function` with `algorithm` body | ✔ (body kept as opaque text) | ✘ (calling a user function is a diagnostic) |
| Short class: `type Voltage = Real(unit="V");` `connector RealInput = input Real;` `type StateSelect = enumeration(never, avoid, default, prefer, always);` | ✔ | ✔ (type attributes merge; enumerations as strings) |
| `extends Base(mod=...) annotation(...);` incl. `Modelica.Icons.*` bases | ✔ | ✔ (components + equations + icons merged) |
| `import A.B;` `import X = A.B;` `import A.B.*;` `import A.{x,y};` | ✔ | ✔ |
| Component decl with prefixes `flow stream input output parameter constant discrete final inner outer replaceable redeclare` and `protected` sections | ✔ | ✔ (`stream`, `inner/outer` are diagnostics; `replaceable` accepted and ignored) |
| Array dimensions `Real x[3]`, `Real m[n,2]` | ✔ | ✘ (diagnostic "arrays are not supported") — except in annotations |
| Conditional components `Resistor r if useR;` | ✔ | ✔ (condition must evaluate to a constant) |
| Modifications `(R=100, i(start=1, fixed=true), each x=1, final y=2, redeclare ...)` | ✔ | ✔ (`redeclare` ✘) |
| Type attributes `start fixed min max nominal unit displayUnit quantity stateSelect` | ✔ | ✔ |
| Equations: `a = b;`, `connect(a.p, b.n) annotation(Line(...));`, `if/elseif/else … end if;`, `for i in 1:n loop … end for;`, `when … then … elsewhen … end when;`, `assert(c, "msg");`, `reinit(x, e);`, `terminate("msg");` | ✔ | ✔ except `for` (✘) |
| `initial equation` | ✔ | ✔ |
| `algorithm` / `initial algorithm` sections | ✔ (kept as opaque text) | ✘ (diagnostic) |
| Expressions: `+ - * / ^`, unary minus/plus, `.+ .* etc.` (parsed), `== <> < <= > >=`, `and or not`, `if c then a else b`, parentheses, number literals (`1`, `1.5`, `1e-3`, `.5`), strings with escapes, `true/false`, `time`, refs with subscripts, ranges `1:n`, array literals `{…}`, `end` | ✔ | ✔ (arrays/ranges only in annotations) |
| Built-in functions: `der pre initial terminal noEvent smooth sample edge change abs sign sqrt exp log log10 sin cos tan asin acos atan atan2 sinh cosh tanh min max mod rem div floor ceil integer Modelica.Constants.pi/e/eps/inf/small/g_n` | ✔ | ✔ (`pre/sample/edge/change` limited to when-conditions; `smooth(k, e)` = `e`; `noEvent(e)` = `e`) |
| Annotations: `Icon(coordinateSystem(...), graphics={...})`, `Diagram(...)`, `Placement(visible, transformation(origin, extent, rotation), iconTransformation(...))`, connection `Line(points, color, pattern, thickness, smooth, arrow, arrowSize)`, `Documentation(info="…", revisions="…")`, `experiment(StartTime, StopTime, Interval, Tolerance)`, `Dialog(tab, group, enable)`, `choices(...)`, `Evaluate`, `HideResult`, `defaultComponentName`, `defaultComponentPrefixes`, `DynamicSelect(a, b)` (→ `a`), `preferredView`, `version`, `uses` | ✔ (stored as modification) | interpreted where relevant |
| Comments `//` and `/* */` | dropped by lexer | – |

### Name lookup (Modelica §5.3, simplified)

Given a name `A.B.C` used in class `Scope`:
1. If it starts with `.`, look up globally.
2. Look for `A` as a nested class of `Scope`, then of `Scope`'s base classes (recursively, via `extends`).
3. Look for `A` in `Scope`'s imports (qualified alias, qualified last-name, or unqualified `*`).
4. Repeat 2–3 for each enclosing class of `Scope` (walk `Scope`'s dotted name upwards), then at top level (the set of all libraries in the registry).
5. Resolve `B` then `C` as nested classes of the found class (following its `extends` too).
Built-in types `Real Integer Boolean String` and `enumeration` are predefined; short-class chains (`type Voltage = Real(...)`) collapse to their base type with merged attributes.

### Flattening

1. Instantiate the class: collect its own components/equations plus those of every base class (depth-first, `extends` modifications applied). Component names are prefixed with the instance path.
2. Merge modifications outermost-wins: component modifier > class default binding; nested `a(b(start=1))` reaches attributes.
3. For each connector-typed component create the connector's variables (`v`, `i` …). `input/output` connectors are causal (single Real).
4. `connect(a, b)`: group connected connectors into **connection sets** (union-find). For each set: potential variables get `n-1` equality equations; flow variables get one equation `Σ ±flow = 0` (sign `+` for inside connectors — components of the model —, `−` for outside connectors — the model's own ports). Causal connections become `a = b`. Unconnected inside flow variables get `flow = 0`.
5. Evaluate constants and parameters (bindings may reference other parameters; cycles are diagnostics). Variables with `parameter`/`constant` variability leave the unknown set.
6. Count unknowns (`continuous` + `discrete` Real/Integer/Boolean non-parameter variables) and equations; unequal counts produce a `ModelicaError` listing both numbers (Impact shows "The model is not balanced: N equations, M variables").
7. Detect states: any variable `x` appearing inside `der(x)`.

### Structural pre-processing (`solver/structural/`)

Before compiling residuals, `prepareModel(flat)` transforms the flat DAE so that Modelica
models built from acausal components initialise and integrate robustly:

1. **Alias elimination** — equations of the form `a = b`, `a = -b`, `a + b = 0`, `a = k*b`,
   `a = b + c` (constants/parameters `k`, `c`) and derivative aliases (`w1 = der(phi)`,
   `w2 = -der(phi)`) are merged with a union-find of affine transforms; start/fixed/min/max
   attributes are merged (conflicting fixed start values are an error) and the eliminated
   variables are reconstructed in the result trajectories.
2. **Known-variable propagation** — equations with a single unknown that depends only on
   parameters (`R_actual = R*(1+alpha*(T-T_ref))`) turn that unknown into a constant.
   Steps 1–2 are iterated to a fixed point.
3. **Index reduction** — Hopcroft–Karp matching of equations against highest-order unknowns;
   unmatched (constraint) equations are differentiated symbolically (Pantelides) and
   **dummy derivatives** (Mattsson–Söderlind) are selected with a numeric rank test at the
   start point, preferring `stateSelect`, states without `fixed=true` starts and relative
   coordinates. Demoted states become algebraic; `der(x)` of a dummy state becomes an
   algebraic unknown. Balance is preserved.
4. **BLT initialisation** — the initialisation system is sorted into strongly connected blocks
   (Tarjan); 1×1 blocks are solved by safeguarded scalar Newton, larger blocks by damped Newton
   with homotopy fallback. This is what makes bilinear terms with zero start values (`v = R*i`)
   solvable where a simultaneous Newton has a singular Jacobian.

The log reports `Structural analysis: N alias variables eliminated, M variables propagated,
K dummy derivatives selected (…)`. `options.disableStructuralSimplification` bypasses the stage.

### Simulation

`simulate(flat, options)` compiles residuals `F(t, v, dv) = 0` from the (pre-processed) flat
equations into closures over a `Float64Array`. Unknown vector `v` = states ∪ algebraics; `dv` = derivatives
of states. Integrators:

| UI name | Implementation |
| --- | --- |
| `CVode` (default) | variable-step, variable-order (1–2) BDF with local error control (`rtol`, `atol`), Newton with LU-factorised finite-difference Jacobian re-used across steps |
| `Radau5` | implicit trapezoidal rule with the same step control (stiffly accurate alternative) |
| `Implicit Euler` | fixed-step BDF1 |
| `Explicit Euler`, `Runge-Kutta` | fixed step; require the model to be solvable for `dv` given `v` (algebraics solved by Newton each stage) |

Initialisation: solve the initial system (equations + initial equations, states fixed to
`start` unless `fixed=false` and initial equations free them) by Newton from `start` guesses.
Events: after each accepted step evaluate `when` conditions; on a false→true crossing apply
`reinit` / discrete assignments and restart the integrator (order 1). Results are sampled at
`ncp` communication points (plus event points).

## Text as source of truth

The UI never holds a separate diagram document. A canvas drop calls
`applyEdit(registry, className, {op:'addComponent', …})`, which mutates a copy of the AST
(adds a `ComponentDecl` with `Placement` annotation) and re-prints the **whole file** using
the canonical printer. The Code view shows exactly that text; editing the text and pressing
save re-parses it and re-renders the diagram. Formatting: 2-space indent, one declaration per
line, annotations on a continuation line, `points` arrays kept on one line.

## Server data layout

```
apps/server/data/
  workspaces/<wid>/workspace.json          WorkspaceDefinition
  workspaces/<wid>/projects/<pid>/project.json
  workspaces/<wid>/projects/<pid>/<Library>.mo | <Library>/package.mo + files
  workspaces/<wid>/experiments/<eid>/experiment.json  ExperimentDto
  workspaces/<wid>/experiments/<eid>/cases/<cid>.json  CaseDto + result (time + trajectories)
libraries/Modelica/…   read-only dependency, mounted into every workspace
libraries/Examples/…   editable copy is seeded into every new workspace as project "Examples"
```

On first start the server seeds a workspace named `Default` with the `Examples` project.

## UI

See `docs/UI_SPEC.md` for the pixel-level description of the Modelon Impact interface the
web app reproduces.
