import { describe, expect, it } from 'vitest';
import { ClassRegistry } from '@impact/core';
import {
  ancestorsOf,
  brokenLibraries,
  childNodes,
  classNameOfPath,
  createRestriction,
  defaultLocation,
  editableLocations,
  errorMarkers,
  errorStateOf,
  flattenTree,
  highlightParts,
  nodeFromClass,
  resolveIconFallback,
  searchNodes,
  splitSections,
  uniqueClassName,
  withAncestors,
} from './treeModel';

const EXAMPLES = `package Examples "Example models"
  model RCCircuit "A resistor-capacitor circuit"
    annotation(Icon(graphics={Rectangle(extent={{-100,-100},{100,100}})}));
  end RCCircuit;
  partial model PartialBase "Base class"
    annotation(Icon(coordinateSystem(extent={{-50,-50},{50,50}}), graphics={Ellipse(extent={{-50,-50},{50,50}})}));
  end PartialBase;
  model Derived "Derived model"
    extends PartialBase;
    annotation(Icon(graphics={Line(points={{0,0},{10,10}})}));
  end Derived;
  package Sub "Sub package"
    connector Pin "An electrical pin"
      Real v;
      flow Real i;
    end Pin;
    record Data "Some data"
      parameter Real x = 1;
    end Data;
    type Voltage = Real(unit="V") "Voltage type";
    function f "A function"
      input Real x;
      output Real y;
    algorithm
      y := x;
    end f;
  end Sub;
end Examples;
`;

const MSL = `within ;
package Modelica "Standard library"
end Modelica;
`;

function makeRegistry(): ClassRegistry {
  const r = new ClassRegistry();
  r.addLibrary({ id: 'ex', name: 'Examples', readOnly: false });
  r.addLibrary({ id: 'msl', name: 'Modelica', readOnly: true });
  expect(r.addFile('ex', 'Examples.mo', EXAMPLES)).toEqual([]);
  expect(r.addFile('msl', 'Modelica/package.mo', MSL)).toEqual([]);
  return r;
}

describe('names', () => {
  it('computes ancestors', () => {
    expect(ancestorsOf('A')).toEqual([]);
    expect(ancestorsOf('A.B.C')).toEqual(['A', 'A.B']);
    expect([...withAncestors(['A.B.C', 'X.Y'])].sort()).toEqual(['A', 'A.B', 'A.B.C', 'X', 'X.Y']);
  });
  it('maps restrictions onto creatable ones', () => {
    expect(createRestriction('class')).toBe('model');
    expect(createRestriction('operator')).toBe('model');
    expect(createRestriction('record')).toBe('record');
  });
  it('derives class names from file paths', () => {
    expect(classNameOfPath('Modelica/Electrical/Analog/Basic/Resistor.mo')).toBe('Modelica.Electrical.Analog.Basic.Resistor');
    expect(classNameOfPath('Modelica/Electrical/package.mo')).toBe('Modelica.Electrical');
    expect(classNameOfPath('Examples.mo')).toBe('Examples');
    expect(classNameOfPath('package.mo')).toBeUndefined();
    expect(classNameOfPath('notes.txt')).toBeUndefined();
  });
});

describe('nodes', () => {
  const r = makeRegistry();

  it('builds nodes from the registry with restriction, partial, droppable and readOnly flags', () => {
    const rc = nodeFromClass(r, r.get('Examples.RCCircuit')!);
    expect(rc).toMatchObject({ name: 'Examples.RCCircuit', shortName: 'RCCircuit', restriction: 'model', description: 'A resistor-capacitor circuit', partial: false, hasChildren: false, libraryId: 'ex', readOnly: false, droppable: true });
    expect(rc.icon?.graphics).toHaveLength(1);

    expect(nodeFromClass(r, r.get('Examples.PartialBase')!)).toMatchObject({ partial: true, droppable: false });
    expect(nodeFromClass(r, r.get('Examples')!)).toMatchObject({ restriction: 'package', hasChildren: true, droppable: false });
    expect(nodeFromClass(r, r.get('Examples.Sub.Pin')!)).toMatchObject({ restriction: 'connector', droppable: true });
    expect(nodeFromClass(r, r.get('Examples.Sub.Data')!)).toMatchObject({ restriction: 'record', droppable: true });
    expect(nodeFromClass(r, r.get('Examples.Sub.Voltage')!)).toMatchObject({ restriction: 'type', droppable: false, description: 'Voltage type' });
    expect(nodeFromClass(r, r.get('Examples.Sub.f')!)).toMatchObject({ restriction: 'function', droppable: false });
    expect(nodeFromClass(r, r.get('Modelica')!)).toMatchObject({ readOnly: true, libraryId: 'msl' });
  });

  it('resolves icons through the inheritance chain, base graphics first', () => {
    const icon = resolveIconFallback(r, 'Examples.Derived');
    expect(icon?.graphics.map((g) => g.kind)).toEqual(['Ellipse', 'Line']);
    // The derived class has no coordinateSystem of its own -> the default one wins over the base's.
    expect(icon?.coordinateSystem.extent).toEqual([[-100, -100], [100, 100]]);
    expect(resolveIconFallback(r, 'Examples.Sub.Data')).toBeUndefined();
  });

  it('lists children in declaration order and the top level across libraries', () => {
    expect(childNodes(r).map((n) => n.name)).toEqual(['Examples', 'Modelica']);
    expect(childNodes(r, 'Examples').map((n) => n.shortName)).toEqual(['RCCircuit', 'PartialBase', 'Derived', 'Sub']);
    expect(childNodes(r, 'Examples.Sub').map((n) => n.hasChildren)).toEqual([false, false, false, false]);
    expect(childNodes(r, 'Nope')).toEqual([]);
  });
});

describe('search', () => {
  const r = makeRegistry();

  it('matches short names and descriptions case-insensitively', () => {
    expect(searchNodes(r, 'PIN').map((n) => n.name)).toEqual(['Examples.Sub.Pin']);
    expect(searchNodes(r, 'circuit').map((n) => n.name)).toEqual(['Examples.RCCircuit']);
    expect(searchNodes(r, 'voltage').map((n) => n.name)).toEqual(['Examples.Sub.Voltage']);
    expect(searchNodes(r, '   ')).toEqual([]);
  });

  it('honours the limit and the library filter', () => {
    expect(searchNodes(r, 'e', { limit: 2 })).toHaveLength(2);
    const onlyMsl = searchNodes(r, 'a', { includeLibrary: (id) => id === 'msl' });
    expect(onlyMsl.map((n) => n.name)).toEqual(['Modelica']);
  });

  it('splits text into highlight parts', () => {
    expect(highlightParts('RCCircuit', 'circ')).toEqual([
      { text: 'RC', match: false },
      { text: 'Circ', match: true },
      { text: 'uit', match: false },
    ]);
    expect(highlightParts('aaa', 'a')).toEqual([
      { text: 'a', match: true },
      { text: 'a', match: true },
      { text: 'a', match: true },
    ]);
    expect(highlightParts('Pin', '')).toEqual([{ text: 'Pin', match: false }]);
    expect(highlightParts('Pin', 'x')).toEqual([{ text: 'Pin', match: false }]);
  });
});

describe('sections and rows', () => {
  const r = makeRegistry();
  const top = childNodes(r);
  const childrenOf = (name: string) => childNodes(r, name);

  it('splits editable projects from read-only libraries and honours hidden libraries', () => {
    const sections = splitSections(top, r.listLibraries(), new Set());
    expect(sections.map((s) => [s.id, s.roots.map((n) => n.name)])).toEqual([
      ['projects', ['Examples']],
      ['libraries', ['Modelica']],
    ]);
    const hidden = splitSections(top, r.listLibraries(), new Set(['msl']));
    expect(hidden[1].roots).toEqual([]);
  });

  it('flattens collapsed and expanded trees', () => {
    const sections = splitSections(top, r.listLibraries(), new Set());
    const collapsed = flattenTree(sections, { expanded: new Set(), childrenOf });
    expect(collapsed.map((row) => (row.kind === 'node' ? `${row.depth}:${row.node.shortName}` : row.kind))).toEqual(['header', '0:Examples', 'header', '0:Modelica']);

    const expanded = flattenTree(sections, { expanded: new Set(['Examples', 'Examples.Sub']), childrenOf });
    const names = expanded.filter((row) => row.kind === 'node').map((row) => (row.kind === 'node' ? `${row.depth}:${row.node.shortName}${row.expanded ? '*' : ''}` : ''));
    expect(names).toEqual(['0:Examples*', '1:RCCircuit', '1:PartialBase', '1:Derived', '1:Sub*', '2:Pin', '2:Data', '2:Voltage', '2:f', '0:Modelica']);
  });

  it('shows placeholders for empty sections', () => {
    const sections = splitSections(top, r.listLibraries(), new Set(['msl']));
    const rows = flattenTree(sections, { expanded: new Set(), childrenOf });
    expect(rows.at(-1)).toMatchObject({ kind: 'empty', section: 'libraries' });
  });

  it('in filter mode shows matches plus ancestors, all expanded, and drops empty sections', () => {
    const sections = splitSections(top, r.listLibraries(), new Set());
    const visible = withAncestors(['Examples.Sub.Pin']);
    const rows = flattenTree(sections, { expanded: new Set(), childrenOf, visible });
    expect(rows.map((row) => (row.kind === 'node' ? `${row.depth}:${row.node.shortName}${row.expanded ? '*' : ''}` : row.kind))).toEqual(['header', '0:Examples*', '1:Sub*', '2:Pin']);
    expect(flattenTree(sections, { expanded: new Set(), childrenOf, visible: new Set() })).toEqual([]);
  });
});

describe('error markers', () => {
  it('marks classes of broken files and the packages containing them', () => {
    const r = new ClassRegistry();
    r.addLibrary({ id: 'lib', name: 'Lib', readOnly: false });
    r.addFile('lib', 'Lib/package.mo', 'within ;\npackage Lib\nend Lib;\n');
    r.addFile('lib', 'Lib/Sub/package.mo', 'within Lib;\npackage Sub\nend Sub;\n');
    r.addFile('lib', 'Lib/Sub/Good.mo', 'within Lib.Sub;\nmodel Good\nend Good;\n');
    // Previously parsed content is kept when a re-save fails; simulate with a registered file + diagnostics.
    r.addFile('lib', 'Lib/Sub/Bad.mo', 'within Lib.Sub;\nmodel Bad\nend Bad;\n');
    const diags = {
      [ClassRegistry.fileKey('lib', 'Lib/Sub/Bad.mo')]: [{ severity: 'error' as const, message: 'boom' }],
      [ClassRegistry.fileKey('lib', 'Lib/Other/Missing.mo')]: [{ severity: 'error' as const, message: 'never parsed' }],
      [ClassRegistry.fileKey('lib', 'Lib/Sub/Clean.mo')]: [],
    };
    const markers = errorMarkers(r, diags);
    expect(errorStateOf(r, markers, 'Lib.Sub.Bad')).toBe('own');
    expect(errorStateOf(r, markers, 'Lib.Sub.Good')).toBe('none');
    expect(errorStateOf(r, markers, 'Lib.Sub')).toBe('contains');
    expect(errorStateOf(r, markers, 'Lib')).toBe('contains');
    expect(markers.containers.has('Lib.Other')).toBe(true);
    expect(errorStateOf(r, { files: new Set(), containers: new Set() }, 'Lib.Sub.Bad')).toBe('none');
  });

  it('reports libraries without any parsed class as broken', () => {
    const r = new ClassRegistry();
    r.addLibrary({ id: 'ex', name: 'Examples', readOnly: false });
    const broken = brokenLibraries(r, { [ClassRegistry.fileKey('ex', 'Examples.mo')]: [{ severity: 'error', message: "Expected 'end Examples'", loc: { line: 3, column: 1, offset: 10, length: 1 } }] });
    expect(broken).toEqual([{ libraryId: 'ex', name: 'Examples', message: "Examples.mo (line 3): Expected 'end Examples'" }]);
    expect(brokenLibraries(r, {})).toEqual([]);
  });
});

describe('locations', () => {
  const r = makeRegistry();

  it('lists editable packages plus the top level', () => {
    expect(editableLocations(r).map((o) => o.value)).toEqual(['Examples', 'Examples.Sub', '']);
  });

  it('defaults to the source package when editable, else to the first editable package', () => {
    const options = editableLocations(r);
    expect(defaultLocation(r, 'Examples.Sub.Pin', options)).toBe('Examples.Sub');
    expect(defaultLocation(r, 'Examples', options)).toBe('');
    expect(defaultLocation(r, 'Modelica', options)).toBe('Examples');
  });

  it('generates unique names', () => {
    expect(uniqueClassName(r, 'Examples', 'RCCircuit')).toBe('RCCircuit1');
    expect(uniqueClassName(r, 'Examples', 'Fresh')).toBe('Fresh');
    expect(uniqueClassName(r, '', 'Examples')).toBe('Examples1');
  });
});
