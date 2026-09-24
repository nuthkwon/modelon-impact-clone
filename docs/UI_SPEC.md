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

- Height 54px, background `--nav-bg` (white), 1px bottom border `--nav-border`, dark-grey text
  (`--nav-fg`); icon buttons are `#666666` glyphs on `#ebebeb` rounded squares (32px, 6px radius).
- Left: application logo (24px glyph + "IMPACT" wordmark in white; the glyph is a generic
  stylised "M" — not Modelon's trademarked logo). Click → Home page. Hover tooltip: "Impact
  Clone <version>". Right of it, the workspace name (13px, opacity .8), tooltip shows the id.
- Middle: **three mode buttons** as a segmented group, each an icon + dynamic label:
  1. Model mode — icon "diagram", label = active class short name (e.g. `RCCircuit`), tooltip "Model mode (1)".
  2. Experiment mode — icon "sliders", label = active experiment name (`Experiment 1`; a "virtual" experiment is created automatically for a model that has none), tooltip "Experiment mode (2)".
  3. Results mode — icon "chart", label = active result name (`Result1`) or "Results" when none, tooltip "Results mode (3)".
  Active button: `--accent` text on an `--accent-soft` pill (40px tall, 8px radius); inactive:
  `--text-secondary`. Keys `1`, `2`, `3` switch modes (when focus is not in an input).
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
  "Show grid" turns on thin 1px solid `--grid-line` lines every 20 model units, "Enable
  snapping" snaps moves to the grid.
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
- **Execution** button ("Play"): 56px white circular FAB (soft shadow) with an **orange play
  triangle** (`--orange`). States: *idle* — white disc, orange ▶ (disabled: grey ▶ for classes
  that cannot be simulated: packages, partial classes, connectors, types); *running* — orange
  progress ring around the disc, inner icon Stop, tooltip "Cancel", click cancels; *pending* —
  label "Pending…" chip; *done* — filled **orange** disc with white ▶ while the latest result is
  available for the active model. Hover reveals a drop-down: "Simulate" (Dynamic), "Simulate
  steady state", "Compile only", "Re-compile and simulate".
- **Views** button: 44px white circular FAB with an **orange eye icon** (`--orange`).
  Hover drop-down: "Save view…", saved view names (restores plots & stickies), "Clear canvas".

### 5.3 Overlays
- **Error banner** at the top of the canvas (below the nav bar): red background `--error-bg`,
  dark red text; message; when the diagnostic has a location, a link "line N" opens the Code
  view at that line; close ×. Stacked banners for several errors (max 3, then "+N more").
- **Log Viewer**: icon button (terminal glyph) at the bottom-left of the canvas toggles a
  bottom panel (height 220px, resizable) with two tabs "Compilation log" and "Simulation log",
  monospace 12px, coloured by level (warning amber, error red), a level filter and a
  "Download" button. The icon shows a red badge when the last run produced errors.
- **Time slider** appears at the bottom-centre of the canvas after a successful simulation as a
  white card (≈240×70px, `--card-border`, shadow): first line "Current time: **23.4** s" with
  play/pause and step buttons at the right, second line a range slider from start to stop time
  with the min/max labels at both ends and a `--slider` knob (arrow keys step). Drives sticky
  values, the Variables/Calculated values numbers and a dashed vertical cursor line in every
  plot. For multi-case results a **Case slider** with the case label sits next to it.
- **Read-only chip**, **zoom readout** as described above.

### 5.4 Stickies
White cards (min 140px wide, 6px radius, 1px `--card-border`, soft shadow, 13px text) attached
to a component (offset stored relative to the component origin): title row = component name in
600 weight; one row per variable: small orange bullet, variable name, value in an
`--accent-chip` chip (right-aligned), grey unit after the chip.
Created from the eye icon in PROPERTIES / CALCULATED VALUES. Editable stickies (parameters)
contain an input; result stickies show the value at the slider time. Buttons on hover: pin,
close. Draggable.

### 5.5 Plots on the canvas
A plot is a floating window (default 500×300 px, min 240×160) with a 28px toolbar: drag
handle (⋮⋮ at top-left), title ("Plot 1", "Plot 2", … editable on double-click), buttons: hide/
show legend, plot settings (gear: title, X variable, log Y, grid), pin, close. Body: chart on white
with a 1px `--plot-frame` frame, light grey gridlines (`--plot-grid`), tick text `--plot-axis`
11px, x-axis title "Time [s]", plot title above in 600 weight; legend **at the right** (toggle to
hide) grouped by component: 600 group name (`resistor`) then rows "● v", "● i" with colour
bullets; `[Result2]` suffix when several results are compared. Palette (category10): `#1f77b4 #ff7f0e #2ca02c #d62728 #9467bd #8c564b
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

Values were pixel-sampled from real Modelon Impact screenshots (2020 result view with
stickies/plots/FABs/time slider; 2023 Workspace Configuration and Apps menu; Diagram View
canvas). The product is a **light-themed, custom (non-Material) design**: white surfaces, very
light grey containers, dark-grey text, a warm-orange accent for active/selected state and
brand, royal-blue pill buttons for primary actions. Tokens live in
`apps/web/src/styles/tokens.css`.

| Token | Value | Used for |
| --- | --- | --- |
| `--nav-bg` / `--nav-fg` | #ffffff / #3d3d3d | App bar (white, 54px, 1px bottom border `#ebebeb`); icon buttons are `#666666` glyphs on `#ebebeb` rounded squares |
| `--accent` | #e56400 | Active mode button text, selected tree row text, active tab text + underline, orange bullets, "+" icons |
| `--accent-soft` | #fff3e6 | Active nav pill background, selected tree row background, experiment path band |
| `--accent-chip` | #fbeede | Value chips inside stickies |
| `--orange` | #f49730 | Play / eye FAB icons, "simulation complete" ring |
| `--primary` / `--primary-fg` | #4169e1 / #ffffff | Contained pill buttons ("DONE", "CLONE", "SIMULATE"), links |
| `--primary-soft` / `--menu-hover-*` | #e9eefc / text #4169e1 | Menu hover/selected rows, text-button hover |
| `--focus` | #b0c0f2 | Focus rings, dashed drop-zone border |
| `--dropzone-bg` | #f2f5f9 | Drop zones ("Drop libraries here…", plot X/Y drop zones) |
| `--canvas-bg` / `--grid-line` | #ffffff / #eae8ea | Canvas; grid = **thin 1px solid lines every 20 model units** (not dots) |
| `--panel-bg` / `--surface` / `--surface-2` | #ffffff / #ffffff / #f7f7f8 | Panels; list/card containers |
| `--input-bg` | #f2f2f2 | Borderless text inputs (4px radius) |
| `--border` / `--border-strong` / `--card-border` | #ebebeb / #dadada / #dadada | Dividers; sticky/time-card borders |
| `--selection-bg` / `--selection-fg` | #fff3e6 / #e56400 | Active class row, active experiment/result row |
| `--experiment-bg` / `--experiment-border` | #e9eefc / #b0c0f2 | Experiment-value inputs ("blue background and frame") |
| `--text-primary` / `--text-secondary` / `--text-label` / `--text-disabled` / `--caps` | #3d3d3d / #666666 / #8c8c8c / #a6a6a6 / #bfbfbf | Body text; secondary; form labels; muted; uppercase menu group headers |
| `--error` / `--error-bg` | #d32f2f / #fdecea | Error banners, red dots |
| `--warning` | #e56400 | Warnings |
| `--success` / `--teal` | #2e9e6b / #6fe1ca | Success check; synced icon |
| `--slider` | #15b5e9 | Time slider knob (20px) |
| `--plot-bg` / `--plot-frame` / `--plot-grid` / `--plot-axis` | #ffffff / #bcbcbc / #e5e5e5 / #5f5f5f | Plot background, frame, gridlines, tick text |
| `--plot-c1..c10` | #1f77b4 #ff7f0e #2ca02c #d62728 #9467bd #8c564b #e377c2 #7f7f7f #bcbd22 #17becf | Series palette (category10, as persisted in Impact "Views" files) |

**Typography**: `"Titillium Web"` (Google Fonts, weights 400/600/700; fallback Segoe UI,
Roboto, sans-serif). Body 14px/400; emphasis (workspace name, nav mode labels, section
captions, button labels, sticky titles, plot legend group names) 600. Uppercase 600 with
0.04–0.06em letter-spacing for section captions ("PROJECTS", "LIBRARIES", "EDITABLE
LIBRARIES"), tab labels and button captions. Dialog titles 20px/600 ("Editing **Name**").
Monospace `"JetBrains Mono", Consolas, monospace` 12px for code/logs. Modelica diagram texts
use Arial/Helvetica (they come from `Text` annotations).

**Shapes**: buttons are full pills (`border-radius: 999px`, 40px tall, uppercase 600 label;
secondary = white pill with 1px dark border); cards 6–8px radius with 1px `--card-border` and a
soft shadow; inputs borderless `--input-bg` 4px radius; list containers `--surface-2` 8px radius.

**Measured component looks**
- *Mode buttons / nav items*: icon + 600-weight label; active = `--accent` text on a
  `--accent-soft` pill (≈48px tall, 8px radius); inactive `--text-secondary`.
- *Apps menu*: white, soft shadow, ~250px wide; uppercase `--caps` group headers ("WORKSPACE
  MANAGEMENT", "GENERAL APPS", "TOOLS - ADVANCED"); items 14px `--text-primary`; hover row
  `--menu-hover-bg` with `--menu-hover-fg` text; external items carry an open-in-new icon.
- *Execution & Views FABs*: white circles (56px / 44px) with soft shadow and **orange**
  (`--orange`) play ▶ / eye icons; the play button gets an orange ring while running, a filled
  orange disc when results are available.
- *Stickies*: white card, 6px radius, 1px `--card-border`, soft shadow; title = component name
  (600); rows = small orange bullet + variable name + value in a `--accent-chip` chip + grey unit.
- *Time slider*: white card (≈233×66px) bottom-centre: "Current time: 23.4 s" (600 for the
  number) above a range slider with min/max labels and a `--slider` knob.
- *Plots*: white, 1px `--plot-frame` frame, title above (600), axis title "Time [s]", tick text
  `--plot-axis` 11px, dashed vertical time-cursor line, legend **at the right** grouped by
  component (600 group name, then "● variable" rows with colour bullets).
- *Result view*: top-level components of the open model get dashed grey (#5f5f5f) frames.
- *Experiment path band* (2020 style, optional): 30px `--accent-soft` band with the class path
  in light orange and the active name in `--accent`.

## 10. Keyboard shortcuts

`1/2/3` modes · `Ctrl+S` save code · `Ctrl+Z/Y` undo/redo · `Delete` delete selection ·
`Ctrl+C/V` copy/paste · `Ctrl +/-/0` zoom in/out/fit · `Esc` cancel connection/deselect ·
`←/→` step time slider · `F` fit to view · `Shift` while connecting = advanced dialog (not
implemented: shows tooltip) · `?` opens the shortcuts dialog.
