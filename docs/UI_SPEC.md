# UI specification — Modelon Impact look-alike

This document describes the browser UI the web app reproduces. Terminology and behaviour
follow the Modelon Impact help center (quoted labels are verbatim from the documentation).
Where the documentation gives no pixel values, the values below are the design decisions for
this clone and live in `apps/web/src/styles/tokens.css` so they can be tuned in one place.

## 1. Pages

| Route | Page |
| --- | --- |
| `/` | **Home page** – list of workspaces. Cards/rows: name, description, "Last modified", size. Buttons: "+ New workspace", "Import workspace" (ZIP; stub with tooltip), an "Apps" grid menu (entries: "Workspace Management", "Documentation"). Clicking a workspace opens it. |
| `/workspaces/:wid` | **Workspace** – the four-area layout below. Query `?class=<name>&mode=model|experiment|results&view=diagram|code`. |

## 2. Four areas

```
┌──────────────────────────────── Navigation bar (48px, dark) ─────────────────────────────────┐
│ [logo] Workspace name   │ [▣ Model: RCCircuit] [⚗ Experiment: Experiment 1] [📈 Results: Result1] │  [Diagram|Code] [⋮⋮ apps] [⚙] [?] [👤] │
├───────────────┬────────────────────────────────────────────────────────────┬──────────────────┤
│ Workspace     │  Model canvas (white)                                      │ Details panel     │
│ panel (300px) │   ┌ error banner (top, red) ┐                              │ (360px)           │
│  [Filter    ⌕]│                                              (▶) Execution │  header: icon,    │
│  PROJECTS  ⚙ +│         components, connections, stickies,   (👁) Views    │  name, class      │
│   ▸ Examples  │         floating plots                                     │  PROPERTIES | …   │
│  LIBRARIES    │                                                            │  tab content      │
│   ▸ Modelica  │  [≡ log]        [time slider ────●────  1.00 s]     [grey strip toggles panel]│
└───────────────┴────────────────────────────────────────────────────────────┴──────────────────┘
```

Panels are resizable by dragging their inner edge (min 200px, max 50% of the viewport) and
collapsible: a collapsed Details panel becomes the "right gray column of the canvas"; clicking
it (or double-clicking a component) opens it again. The Workspace panel collapses to a 40px
strip with a "Libraries" icon.

## 3. Navigation bar ("App bar")

- Height 48px, background `--nav-bg` (#1e1e1e), white text/icons, no shadow.
- Left: application logo (24px glyph + "IMPACT" wordmark in white; the glyph is a generic
  stylised "M" — not Modelon's trademarked logo). Click → Home page. Hover tooltip: "Impact
  Clone <version>". Right of it, the workspace name (13px, opacity .8), tooltip shows the id.
- Middle: **three mode buttons** as a segmented group, each an icon + dynamic label:
  1. Model mode — icon "diagram", label = active class short name (e.g. `RCCircuit`), tooltip "Model mode (1)".
  2. Experiment mode — icon "sliders", label = active experiment name (`Experiment 1`; a "virtual" experiment is created automatically for a model that has none), tooltip "Experiment mode (2)".
  3. Results mode — icon "chart", label = active result name (`Result1`) or "Results" when none, tooltip "Results mode (3)".
  Active button: white text, 3px accent underline `--accent`; inactive: 70% white. Keys `1`,
  `2`, `3` switch modes (when focus is not in an input).
- Right: view toggle (two icon buttons "Diagram view" / "Code view", active filled), "Apps"
  grid icon menu (Workspace Management, Documentation), settings gear (opens Application
  settings dialog), help "?" menu (Documentation, Keyboard shortcuts, Support, About),
  user avatar circle (initial letter, menu: Sign out (stub)).

## 4. Workspace panel (left)

- Background `--panel-bg` (#fafafa), right border 1px `--border`.
- Top row (40px): **"Filter"** text field with search icon and a funnel icon button
  ("Limit libraries" – popover with checkboxes per library). Right: "Create class" `+` icon
  button (opens the *New class* dialog).
- Section **"PROJECTS"** (11px uppercase, letter-spacing .08em, `--text-secondary`) with a
  cogwheel "Configure workspace" icon button (opens a dialog listing projects and dependencies;
  read-only in this clone). Below: tree of the workspace's editable projects (`Examples`, …).
- Section **"LIBRARIES"**: read-only dependency libraries (`Modelica`).
- Tree rows: 26px high, indent 16px per level, chevron (▸/▾, 16px) for packages, class icon
  rendered from its Modelica `Icon` annotation at 18×18 (fallback glyphs: package = folder-like
  MSL package icon, model = rounded square, connector = small filled square, function = "f",
  record = table, type = "T"), name in 13px. Hover: row background `--hover`. Active model:
  background `--selection-bg` (#e3f2fd) + bold name. Partial classes render 60% opacity and
  are not draggable. Syntax error in a file: red dot (8px, `--error`) after the name of its
  classes; packages containing errors show a light red dot.
- Filter typing filters the tree to matching classes (name or description, case-insensitive)
  and auto-expands matches; matches highlighted.
- Drag & drop: a `model`/`block`/`connector`/`record` row is draggable onto the canvas
  (`dataTransfer` type `application/x-modelica-class`, payload = full class name). Dragging a
  ghost shows the icon.
- Double-click / click a class → becomes the active class (opens it in the canvas).
- Context menu (right-click): on a package: "New class…", "Show Documentation", "Duplicate to…",
  "Extend…", "Delete permanently" (editable projects only). On a class: "Open", "Show
  Documentation", "Extend…", "Duplicate to…", "Rename…", "Delete permanently", "Copy class path".
  On a project: "New class…", "Configure workspace".

## 5. Model canvas (center)

### 5.1 Diagram View
- Background `--canvas-bg` (white). Grid hidden by default; Application settings
  "Show grid" turns on 20-unit dots (`--grid-dot`), "Enable snapping" snaps moves to the grid.
- The class's `Diagram` coordinate system extent is fitted into the viewport on open (padding
  40px). Zoom: `Ctrl` + wheel, `Ctrl` `+`/`-`, pinch; pan: wheel (no modifier scrolls), middle
  mouse or `Space`+drag. Zoom range 10%–800%. A small zoom % readout with "Fit" button sits at
  the bottom-right corner of the canvas above the strip.
- Components render their resolved icon layer (own + inherited graphics, base classes first)
  inside their `Placement.transformation` (see core `placementMatrix`). Icon texts substitute
  `%name` → component name, `%class` → short class name, `%<param>` → the parameter's value
  text (or default). Component name label: if the icon has no `%name` text, draw the name in
  12px below the icon.
- Ports (connectors of the component) are drawn from the connector class icon at the port's
  `Placement` inside the component. Hovering a port shows a tooltip `resistor.p (PositivePin)`.
- Connections render `Line.points` (polyline; `Smooth.Bezier` → smoothed) with the annotation
  colour and thickness (default 0.25 units → min 1.5px on screen), arrowheads when set.
- Selection: click selects (blue 1px outline `--accent` with 4 corner handles + a **rotation
  handle at the top-right**); `Shift`+click adds; rubber band on empty canvas. `Delete`/
  `Backspace` deletes selected components (and their connections) or the selected connection.
  `Ctrl+C`/`Ctrl+V` copy/paste (offset 20 units), `Ctrl+Z`/`Ctrl+Y` undo/redo (text history).
- Moving: drag selected components (snap when enabled); rotation handle rotates in 90° steps
  (Shift for 15°). Right-click menu on a component: "Rotate 90° clockwise", "Rotate 90°
  counter-clockwise", "Flip horizontal", "Flip vertical", "Rename…", "Show documentation",
  "Open class", "Copy", "Delete". Right-click on empty canvas: "Paste", "Fit to view",
  "Show grid" toggle. Right-click on a connection: "Delete connection".
- Connecting: press on a port and drag; compatible ports (same connector class, or
  input↔output of the same base type) highlight green (`--port-compatible`), incompatible ones
  grey out; release on a compatible port creates `connect(a.p, b.n)` with an orthogonal
  2-segment default route and the domain colour of the connector class (Electrical
  {0,0,255}, Rotational {95,95,95}, Translational {0,127,0}, Thermal {191,0,0}, Real signal
  {0,0,127}, Boolean signal {255,0,255}). Existing lines: dragging a straight segment moves it
  perpendicular; dragging a corner moves the corner; double-click on a segment inserts a corner.
- Drop from the library adds a component at the drop point (snapped to 2-unit grid), sized
  20×20 units (extent {{-10,-10},{10,10}}), named from `defaultComponentName` or the
  lower-camel class name with a numeric suffix (`resistor`, `resistor1`, …).
- Double-clicking a component opens the Details panel on PROPERTIES for it.
- In Experiment and Results mode the canvas is **read-only** (no drag/connect/delete; cursor
  default; a small "Read-only" chip at the top-left of the canvas).

### 5.2 Floating action buttons (right side of the canvas, vertically centred)
- **Execution** button ("Play"): 48px circular FAB. States: *idle* — `--accent` blue with a
  white play triangle (disabled/grey for classes that cannot be simulated: packages, partial
  classes, connectors, types); *running* — spinner ring around the button, tooltip "Cancel",
  click cancels; *pending* — label "Pending…" chip; *done* — turns **orange** (`--orange`)
  while the latest result is available for the active model. Hover reveals a drop-down: "Simulate"
  (Dynamic), "Simulate steady state", "Compile only", "Re-compile and simulate".
- **Views** button: 40px circular FAB with an **orange eye icon** (`--orange` on white).
  Hover drop-down: "Save view…", saved view names (restores plots & stickies), "Clear canvas".

### 5.3 Overlays
- **Error banner** at the top of the canvas (below the nav bar): red background `--error-bg`,
  dark red text; message; when the diagnostic has a location, a link "line N" opens the Code
  view at that line; close ×. Stacked banners for several errors (max 3, then "+N more").
- **Log Viewer**: icon button (terminal glyph) at the bottom-left of the canvas toggles a
  bottom panel (height 220px, resizable) with two tabs "Compilation log" and "Simulation log",
  monospace 12px, coloured by level (warning amber, error red), a level filter and a
  "Download" button. The icon shows a red badge when the last run produced errors.
- **Time slider** appears at the bottom-centre of the canvas after a successful simulation:
  play/pause, step back/forward (arrow keys), slider from start to stop time, current time
  input with unit "s". Drives sticky values, the Variables/Calculated values numbers and a
  vertical cursor line in every plot. For multi-case results a **Case slider** with the case
  label sits next to it.
- **Read-only chip**, **zoom readout** as described above.

### 5.4 Stickies
Small cards (min 120px wide, white, 1px `--border`, 2px shadow, 12px text) attached to a
component (offset stored relative to the component origin) showing `variable = value unit`.
Created from the eye icon in PROPERTIES / CALCULATED VALUES. Editable stickies (parameters)
contain an input; result stickies show the value at the slider time. Buttons on hover: pin,
close. Draggable.

### 5.5 Plots on the canvas
A plot is a floating window (default 500×300 px, min 240×160) with a 28px toolbar: drag
handle (⋮⋮ at top-left), title ("Plot 1", "Plot 2", … editable on double-click), buttons: hide/
show legend, plot settings (gear: title, X variable, log Y, grid), pin, close. Body: Plotly-like
chart on white, light grey gridlines (#e5e5e5), axes labels in 11px, legend at the bottom with
colour dot + fully-qualified variable name (`resistor.v`), `[Result2]` suffix when several
results are compared. Palette (category10): `#1f77b4 #ff7f0e #2ca02c #d62728 #9467bd #8c564b
#e377c2 #7f7f7f #bcbd22 #17becf`. Interactions: hover → vertical guide + tooltip listing every
trace value at that time; click-drag → box zoom; double-click → reset autoscale; wheel → zoom
around cursor; legend item click toggles a trace; dropping a variable on the plot adds it; the
plot shows **two drop zones** ("Y axis" over the body, "X axis" over the bottom axis) while a
variable is being dragged. Multi-case results draw one trace per case (`resistor.v [case_2]`).
Plots persist per class inside the store (and in saved Views).

### 5.6 Code View
Full-canvas CodeMirror 6 editor with a Modelica language mode (keywords, types, numbers,
strings, comments, annotations dimmed), line numbers, active-line highlight, bracket matching,
search (`Ctrl+F`), 13px monospace. Edits are auto-saved when leaving the Code view (and with
`Ctrl+S`); on a syntax error the file is not saved and a red gutter marker + error banner
show the location. Library (read-only) classes show a "Read-only" banner and reject edits.
A top strip shows the file path (`Examples.mo`) and "Saved"/"Unsaved changes" status.

## 6. Details panel (right)

- Background white, left border 1px `--border`. Width 360px.
- **Header** (72px): class/component icon (40px, rendered from the Icon annotation), the
  active class name **or** the selected component's name (both editable inline when writable:
  click → input, `Enter` confirms, `Esc` cancels — component rename rewrites the model text),
  and below it the class path in `--text-secondary` (for a component: `Modelica.Electrical.Analog.Basic.Resistor`,
  clickable to open that class). Multi-selection shows "N components selected".
- **Tabs** (Material style: uppercase 12px, letter-spacing .06em, 40px tall, 2px accent
  underline indicator). Tabs depend on the mode:
  - Model mode: **PROPERTIES**, **INFORMATION**, **COMPONENTS**
  - Experiment mode: **PROPERTIES**, **COMPONENTS**, **EXPERIMENT**
  - Results mode: **PROPERTIES**, **SIMULATIONS**, **CALCULATED VALUES**

### 6.1 PROPERTIES
- Top row: additive filter chips — "Parameters" (on), "Results" (on), "Favorites" — and a free-text
  filter field (funnel icon turns `--accent` when a filter is active).
- Sub-tabs per Modelica `Dialog(tab=…)` ("General" default; e.g. "Advanced"), then groups per
  `Dialog(group=…)` as collapsible headers ("Parameters" default group). The last sub-tab is
  **"Variables"** listing non-parameter variables (with the value at the slider time when a result
  is active).
- Row layout (32px): `[name 40%] [⋮] [value input 40%] [unit]`. Hover shows the description
  as a tooltip and a star ("favorite") icon at the far right; favourites are marked by an orange
  dot. The `⋮` "attributes" button opens a popover with `start`, `fixed`, `min`, `max`,
  `nominal`, `displayUnit`; changed attributes highlight the `⋮` in `--accent`.
- Value editing: text input accepting Modelica expressions; `Enter`/blur commits → rewrites
  the component modifier in the model text (`resistor(R=100)`); empty value → removes the
  modifier and shows the default (grey placeholder text). Values that differ from the class
  default render in `--text-primary` bold; defaults render grey. `final`/constant parameters are
  read-only. Booleans → checkbox; enumerations → select.
- Experiment mode: edited values become **experiment modifiers**, shown with a **blue
  background and frame** (`--experiment-bg`) and an **X** on hover that removes the override.
  Parameter sweep: values may be `range(start, stop, n)` or `choices(a, b, c)`; a chip below
  the row shows "N cases".
- Nested components (record parameters / sub-components) show an expander icon on the right.
- Eye icon on hover → creates a sticky for that parameter/variable.

### 6.2 INFORMATION
Rendered `Documentation(info=…)` HTML of the active class or selected component's class in a
scrollable area (sanitised; images ignored). Empty → "No documentation available."

### 6.3 COMPONENTS
List of all components of the active model (icon 20px, name, class short name, grey
description). Click selects the component on the canvas and shows its header/properties.

### 6.4 EXPERIMENT
- **Experiment browser** (top): list of experiments for the active model (name, created
  time, case count). Hover: pencil (rename) and "…" menu (Rename, Duplicate, Delete). Link
  "+ New experiment". Selecting an experiment makes it active (shown in the nav-bar Experiment
  button). A model without experiments gets a virtual "Experiment 1".
- Sub-tabs **ANALYSIS**, **MODIFICATIONS**, **OUTPUTS**.
- ANALYSIS: type buttons **"Dynamic"** (default) | **"Steady-State"** | **"Custom"** (disabled
  with tooltip "No custom functions installed"). Dynamic fields, each with unit label:
  - "Start time" `0` s
  - "Stop time" `1` s
  - "Interval" `0.002` s ⇄ "Points" `500` (toggle switch; values converted into each other:
    points = (stop − start) / interval)
  - "Solver" select: `CVode` (default), `Radau5ODE`, `ExplicitEuler`
  - "Tolerance" `1e-6` (only for CVode / Radau5ODE)
  - "Step Size" `0.01` s (only for ExplicitEuler)
  - "Advanced" button → **Execution settings** dialog with four sections: "Compiler options"
    (`c_compiler`=gcc, `generate_html_diagnostics`, `include_protected_variables`,
    `filter_warnings`), "Runtime options" (`log_level`), "Simulation options" (`ncp`,
    `dynamic_diagnostics`, `store_event_points`), "Solver options" (`rtol`, `atol`).
  Steady-State: "Start time" and a note "Computes the steady-state solution (der(x)=0)".
  Values save into the experiment definition (`analysis.parameters.start_time/final_time`,
  `simulationOptions.ncp`, `solverOptions.solver/rtol/step_size`).
- MODIFICATIONS: read-only list `resistor.R = 100` of every experiment modifier, each with an X.
- OUTPUTS: list of output filters with "+ New filter" (types View / Favorites / Component /
  Variable), each removable with X (stored in the experiment; applied when downloading CSV).

### 6.5 SIMULATIONS
List of results of the active model, newest first: name (`Result1`, `Result2`, …
auto-numbered; renamable), timestamp ("2026-09-24 14:03:12"), duration, status icon (green
check / red error symbol / grey cancelled), case count for multi-run ("3 cases", red
exclamation mark when some failed). Hover: "…" menu: "Rename", "Delete", "Download result
(CSV)", "Show simulation log", "Show compilation log". Clicking selects the active result
(shown in the Results mode button; feeds Calculated values, Variables, stickies, plots).

### 6.6 CALCULATED VALUES
Text filter + type filter select ("All", "Parameters", "Variables", "States", "Derivatives")
above a tree that follows the model hierarchy (component → nested → variables). Rows show the
name, current value at the slider time (right-aligned, 6 significant digits) and unit. Hover
icons: "Add Variable to Plot" (adds to the most recent plot or creates "Plot N"), eye (sticky).
Rows are draggable (`application/x-impact-variable`, payload `{result, variable}`) onto the
canvas (creates a plot) or onto a plot (adds a trace / sets X axis via the drop zones).

## 7. Dialogs

- **New class**: fields "Name", "Type" (Model, Block, Connector, Record, Function, Package,
  Type), "Location" (package selector tree over editable projects), "Extends" (optional class
  path with picker), "Description". Creates the class and opens it.
- **Application settings** (gear): tabs "Application" (Show grid, Enable snapping, Enable dark
  mode (Public Beta), Exclude plots and stickies from dark mode, Enable automatic propagation),
  "Execution" (default experiment values), "Export" (CSV decimal separator), "Units" (display
  units on/off), "Workspace" (name/description). Persisted in localStorage.
- **Execution settings** (Advanced) — see 6.4.
- **Rename**, **Confirm delete** ("Delete permanently?"), **About** (version, license notice
  for the Modelica Standard Library subset).
- **Show Documentation**: opens INFORMATION tab for the chosen class.

## 8. Simulation flow

1. Press Play → nav-bar button switches to Experiment/Results as appropriate? No: mode stays;
   the FAB shows the spinner; the Log Viewer badge clears.
2. Client `POST /experiments` (definition from the active experiment) then
   `POST …/execution`; polls `GET …/execution` every 300ms.
3. On `done`: a new result `ResultN` appears in SIMULATIONS and becomes active; the FAB turns
   orange; the time slider appears; the Results mode button shows the result name; open plots
   for this class refresh their traces; Variables show values.
4. On failure: error banner at the top of the canvas with the first error and a "Show log" link;
   the Log Viewer opens on the failing log (compilation or simulation).
5. Structural errors from the compiler use Impact's phrasing, e.g. "The model is not balanced:
   12 equations and 13 variables" and "The system is structurally singular".

## 9. Colours & typography (tokens)

| Token | Light | Dark mode |
| --- | --- | --- |
| `--nav-bg` | #1e1e1e | #121212 |
| `--nav-fg` | #ffffff | #ffffff |
| `--accent` | #1976d2 | #64b5f6 |
| `--accent-hover` | #1565c0 | #90caf9 |
| `--orange` | #ff9800 | #ffb74d |
| `--canvas-bg` | #ffffff | #ffffff (canvas stays bright unless "Exclude plots…" off) |
| `--grid-dot` | #d9d9d9 | #444 |
| `--panel-bg` | #fafafa | #1e1e1e |
| `--surface` | #ffffff | #252526 |
| `--border` | #e0e0e0 | #3c3c3c |
| `--hover` | rgba(0,0,0,.04) | rgba(255,255,255,.06) |
| `--selection-bg` | #e3f2fd | #1e3a5f |
| `--experiment-bg` | #e3f2fd (with 1px #90caf9 frame) | #1e3a5f |
| `--text-primary` | rgba(0,0,0,.87) | rgba(255,255,255,.87) |
| `--text-secondary` | rgba(0,0,0,.6) | rgba(255,255,255,.6) |
| `--error` | #d32f2f | #ef5350 |
| `--error-bg` | #fdecea | #4a1f1f |
| `--warning` | #f57c00 | #ffb74d |
| `--success` | #388e3c | #81c784 |
| `--port-compatible` | #43a047 | #66bb6a |
| `--shadow-1` | 0 1px 3px rgba(0,0,0,.2) | 0 1px 3px rgba(0,0,0,.6) |

Font: `Roboto, "Segoe UI", "Helvetica Neue", Arial, sans-serif`, base 13px, headings 14px/500;
monospace `"JetBrains Mono", "Fira Code", Consolas, monospace` 12px. Icons: inline SVG,
Material-style 20px outlined glyphs (`apps/web/src/components/icons.tsx`).

## 10. Keyboard shortcuts

`1/2/3` modes · `Ctrl+S` save code · `Ctrl+Z/Y` undo/redo · `Delete` delete selection ·
`Ctrl+C/V` copy/paste · `Ctrl +/-/0` zoom in/out/fit · `Esc` cancel connection/deselect ·
`←/→` step time slider · `F` fit to view · `Shift` while connecting = advanced dialog (not
implemented: shows tooltip) · `?` opens the shortcuts dialog.
