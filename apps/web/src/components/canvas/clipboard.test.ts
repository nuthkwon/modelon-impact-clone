import { describe, expect, it } from 'vitest';
import type { ComponentView, DiagramView, EditOperation } from '@impact/core';
import { DEFAULT_COORDINATE_SYSTEM } from '@impact/core';
import { clipboardSize, copyComponents, pasteComponents } from './clipboard';

const icon = { coordinateSystem: DEFAULT_COORDINATE_SYSTEM, graphics: [] };
const comp = (name: string, placement: ComponentView['placement'], over: Partial<ComponentView> = {}): ComponentView => ({
  name,
  className: 'Modelica.Electrical.Analog.Basic.Resistor',
  shortClassName: 'Resistor',
  restriction: 'model',
  placement,
  icon,
  ports: [],
  parameters: [{ name: 'R', typeName: 'Real', baseType: 'Real', defaultText: '1', valueText: '100', final: false, constant: false }],
  isConnector: false,
  ...over,
});

// Examples.RCCircuit: canonical unrotated form (origin {0,0}, absolute extent) → visual centre (-20,40).
const resistor = comp('resistor', { visible: true, transformation: { origin: [0, 0], extent: [[-30, 30], [-10, 50]], rotation: 0 } });
// Rotated components are stored with the origin at the visual centre.
const rotated = comp('inductor', { visible: true, transformation: { origin: [40, -20], extent: [[-10, -10], [10, 10]], rotation: 90 } }, { parameters: [] });

const diagram: DiagramView = {
  className: 'Examples.RCCircuit',
  diagram: { coordinateSystem: DEFAULT_COORDINATE_SYSTEM, graphics: [] },
  icon: { coordinateSystem: DEFAULT_COORDINATE_SYSTEM, graphics: [] },
  components: [resistor, rotated],
  connections: [],
  diagnostics: [],
};

function recorder() {
  const ops: EditOperation[] = [];
  let n = 0;
  const applyEdit = async (op: EditOperation) => {
    ops.push(op);
    return op.op === 'addComponent' ? { text: '', diagnostics: [], createdName: `${op.className.split('.').pop()!.toLowerCase()}${++n}` } : { text: '', diagnostics: [] };
  };
  return { ops, applyEdit };
}

describe('component clipboard', () => {
  it('pastes an unrotated component 20 units right of and below where it is drawn, not next to the diagram origin', async () => {
    expect(copyComponents(diagram, ['resistor'])).toBe(1);
    expect(clipboardSize()).toBe(1);
    const { ops, applyEdit } = recorder();
    const created = await pasteComponents(applyEdit);
    expect(created).toEqual(['resistor1']);
    const add = ops.find((o) => o.op === 'addComponent');
    expect(add).toMatchObject({ op: 'addComponent', className: resistor.className, position: [0, 20], rotation: 0, size: 20 });
    // modified parameters are copied onto the new component
    expect(ops).toContainEqual({ op: 'setParameter', component: 'resistor1', name: 'R', valueText: '100' });
  });

  it('offsets every further paste by another 20 units', async () => {
    copyComponents(diagram, ['resistor']);
    const { ops, applyEdit } = recorder();
    await pasteComponents(applyEdit);
    await pasteComponents(applyEdit);
    const positions = ops.filter((o) => o.op === 'addComponent').map((o) => (o as Extract<EditOperation, { op: 'addComponent' }>).position);
    expect(positions).toEqual([[0, 20], [20, 0]]);
  });

  it('keeps the rotation and pastes rotated components relative to their visual centre', async () => {
    copyComponents(diagram, ['inductor']);
    const { ops, applyEdit } = recorder();
    await pasteComponents(applyEdit);
    expect(ops[0]).toMatchObject({ op: 'addComponent', position: [60, -40], rotation: 90, size: 20 });
  });
});
