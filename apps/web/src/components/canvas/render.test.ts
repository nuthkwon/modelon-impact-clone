/**
 * Render smoke test: seeds the store with a synthetic DiagramView and renders the canvas to
 * static markup (no DOM needed), asserting the scene structure the pointer state machine relies
 * on (`data-component`, `data-port`, `data-connection`, selection outline, labels, overlays).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, beforeEach } from 'vitest';
import type { ComponentView, DiagramView, PortView } from '@impact/core';
import { DEFAULT_COORDINATE_SYSTEM } from '@impact/core';
import { useStore } from '../../store';
import { Canvas } from './Canvas';

/**
 * `renderToStaticMarkup` reads zustand's *server snapshot*, i.e. `api.getInitialState()`, while
 * the components' imperative `useStore.getState()` calls read the live state. The initial state
 * is a plain object that zustand never mutates, so seeding both keeps them consistent.
 */
function seedStore(patch: Partial<ReturnType<typeof useStore.getState>>): void {
  useStore.setState(patch);
  Object.assign(useStore.getInitialState(), patch);
}

const pinIcon = {
  coordinateSystem: DEFAULT_COORDINATE_SYSTEM,
  graphics: [
    {
      kind: 'Rectangle' as const,
      visible: true,
      origin: [0, 0] as [number, number],
      rotation: 0,
      lineColor: [0, 0, 255] as [number, number, number],
      fillColor: [0, 0, 255] as [number, number, number],
      pattern: 'Solid' as const,
      fillPattern: 'Solid' as const,
      lineThickness: 0.25,
      extent: [[-100, -100], [100, 100]] as [[number, number], [number, number]],
      borderPattern: 'None' as const,
      radius: 0,
    },
  ],
};

const port = (name: string, x: number): PortView => ({
  name,
  className: 'Modelica.Electrical.Analog.Interfaces.PositivePin',
  placement: { visible: true, transformation: { origin: [0, 0], extent: [[x - 10, -10], [x + 10, 10]], rotation: 0 } },
  icon: pinIcon,
  causality: 'none',
  physical: true,
  domain: 'electrical',
});

const resistor: ComponentView = {
  name: 'resistor',
  className: 'Modelica.Electrical.Analog.Basic.Resistor',
  shortClassName: 'Resistor',
  restriction: 'model',
  placement: { visible: true, transformation: { origin: [0, 20], extent: [[-10, -10], [10, 10]], rotation: 0 } },
  icon: {
    coordinateSystem: DEFAULT_COORDINATE_SYSTEM,
    graphics: [
      {
        kind: 'Text',
        visible: true,
        origin: [0, 0],
        rotation: 0,
        lineColor: [0, 0, 0],
        fillColor: [0, 0, 0],
        pattern: 'Solid',
        fillPattern: 'None',
        lineThickness: 0.25,
        extent: [[-100, 60], [100, 100]],
        textString: 'R=%R',
        fontSize: 0,
        fontName: '',
        textColor: [0, 0, 0],
        horizontalAlignment: 'Center',
        textStyle: [],
      },
    ],
  },
  ports: [port('p', -100), port('n', 100)],
  parameters: [{ name: 'R', typeName: 'Real', baseType: 'Real', defaultText: '1', valueText: '100', final: false, constant: false }],
  isConnector: false,
};

const ground: ComponentView = {
  ...resistor,
  name: 'ground',
  className: 'Modelica.Electrical.Analog.Basic.Ground',
  shortClassName: 'Ground',
  placement: { visible: true, transformation: { origin: [0, -40], extent: [[-10, -10], [10, 10]], rotation: 0 } },
  icon: { coordinateSystem: DEFAULT_COORDINATE_SYSTEM, graphics: [] },
  ports: [port('p', 0)],
  parameters: [],
};

const ownInput: ComponentView = {
  ...ground,
  name: 'u',
  className: 'Modelica.Blocks.Interfaces.RealInput',
  shortClassName: 'RealInput',
  restriction: 'connector',
  placement: { visible: true, transformation: { origin: [-80, 0], extent: [[-10, -10], [10, 10]], rotation: 0 } },
  ports: [],
  isConnector: true,
};

const diagram: DiagramView = {
  className: 'Lib.T',
  diagram: { coordinateSystem: DEFAULT_COORDINATE_SYSTEM, graphics: [] },
  icon: { coordinateSystem: DEFAULT_COORDINATE_SYSTEM, graphics: [] },
  components: [resistor, ground, ownInput],
  connections: [
    {
      from: 'resistor.n',
      to: 'ground.p',
      equationIndex: 0,
      line: { points: [[10, 20], [30, 20], [30, -40], [0, -40]], color: [0, 0, 255], pattern: 'Solid', thickness: 0.25, smooth: 'None', arrow: ['None', 'None'] },
    },
  ],
  diagnostics: [],
};

function seed(patch: Partial<ReturnType<typeof useStore.getState>> = {}) {
  const registry = useStore.getState().registry;
  if (!registry.has('Lib.T')) {
    registry.addLibrary({ id: 'lib', name: 'Lib', readOnly: false });
    const diags = registry.addFile('lib', 'Lib.mo', 'package Lib\n  model T\n  end T;\nend Lib;\n');
    expect(diags).toEqual([]);
  }
  seedStore({
    workspaceId: 'ws',
    activeClass: 'Lib.T',
    diagram,
    diagramError: undefined,
    mode: 'model',
    view: 'diagram',
    selection: [],
    selectedConnection: undefined,
    banners: [],
    stickies: {},
    plots: {},
    results: [],
    running: undefined,
    logOpen: false,
    ...patch,
  });
}

const render = () => renderToStaticMarkup(createElement(Canvas));

describe('Canvas rendering', () => {
  beforeEach(() => seed());

  it('renders components, ports, connections and the y-flipped root transform', () => {
    const html = render();
    expect(html).toContain('class="canvas editable"');
    expect(html).toContain('data-component="resistor"');
    expect(html).toContain('data-component="ground"');
    expect(html).toContain('data-port="resistor.p"');
    expect(html).toContain('data-port="resistor.n"');
    expect(html).toContain('data-port="ground.p"');
    expect(html).toContain('data-connection="0"');
    expect(html).toMatch(/class="diagram-root" transform="matrix\(1 0 0 -1 0 0\)"/);
    // %R substituted in the icon text
    expect(html).toContain('R=100');
  });

  it('draws the model\'s own connector as a component that is also a port', () => {
    const html = render();
    expect(html).toContain('data-component="u" data-port="u"');
  });

  it('labels components whose icon has no %name text, but not those with one', () => {
    const html = render();
    expect(html).toMatch(/<text class="component-label"[^>]*>ground<\/text>/);
    expect(html).toMatch(/<text class="component-label"[^>]*>u<\/text>/);
    // resistor's icon text is R=%R (no %name) → also labelled
    expect(html).toMatch(/<text class="component-label"[^>]*>resistor<\/text>/);
  });

  it('shows a selection outline with a rotation handle for the selected component', () => {
    seed({ selection: ['resistor'] });
    const html = render();
    expect(html).toContain('class="component selected"');
    expect(html).toContain('class="selection-rect"');
    expect(html).toContain('data-handle="rotate" data-component="resistor"');
    expect((html.match(/class="selection-handle"/g) ?? []).length).toBe(4);
  });

  it('highlights the selected connection and draws interior corner handles', () => {
    seed({ selectedConnection: 0 });
    const html = render();
    expect(html).toContain('class="connection selected"');
    expect(html).toContain('class="connection-glow"');
    // 4 points → 2 interior corners get handles (endpoints stay attached to their ports)
    expect((html.match(/class="selection-handle connection-handle"/g) ?? []).length).toBe(2);
  });

  it('is read-only outside model mode and hides the rotation handle', () => {
    seed({ mode: 'experiment', selection: ['resistor'] });
    const html = render();
    expect(html).toContain('read-only');
    expect(html).toContain('>Read-only<');
    expect(html).not.toContain('data-handle="rotate"');
  });

  it('shows the error label when the diagram could not be built', () => {
    seed({ diagram: undefined, diagramError: 'buildDiagramView: boom' });
    const html = render();
    expect(html).toContain('buildDiagramView: boom');
    expect(html).not.toContain('data-component=');
  });

  it('renders banners with line and log links and stickies with a dash for unknown values', () => {
    seed({
      banners: [
        { id: 'b1', severity: 'error', message: 'The model is not balanced', loc: { line: 12, column: 1, offset: 0, length: 1 }, log: 'compilation' },
        { id: 'b2', severity: 'warning', message: 'w' },
        { id: 'b3', severity: 'info', message: 'i' },
        { id: 'b4', severity: 'info', message: 'hidden' },
      ],
      stickies: { 'Lib.T': [{ id: 's1', component: 'resistor', variable: 'resistor.v', dx: 10, dy: 10, pinned: false, editable: false }] },
    });
    const html = render();
    expect(html).toContain('The model is not balanced');
    expect(html).toContain('line 12');
    expect(html).toContain('Show log');
    expect(html).toContain('+1 more');
    expect(html).not.toContain('>hidden<');
    expect(html).toContain('class="sticky"');
    expect(html).toContain('resistor.v');
    expect(html).toContain('class="value-chip sticky-value">–<');
    // grouped card: the component name is the title, the row shows the short variable name
    expect(html).toContain('class="sticky-title-text">resistor<');
    expect(html).toContain('class="sticky-var">v<');
  });

  it('renders the execution FAB as idle for a model and the zoom readout', () => {
    const html = render();
    expect(html).toContain('execution-fab idle');
    expect(html).toContain('class="zoom-value">100%<');
    expect(html).toContain('views-fab');
    expect(html).toContain('log-toggle');
  });

  it('shows the running state with a progress ring and phase chip', () => {
    seed({ running: { className: 'Lib.T', experimentId: 'e', phase: 'simulating', progress: 0.43, startedAt: 0 } });
    const html = render();
    expect(html).toContain('execution-fab running');
    expect(html).toContain('fab-ring-progress');
    expect(html).toContain('Simulating… 43%');
  });
});
