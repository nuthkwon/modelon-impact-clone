import { describe, expect, it } from 'vitest';
import { ClassRegistry, parse } from '@impact/core';
import { duplicateClassText, extractClassText, reindent, renameClassText, replaceClassInFile } from './duplicate';

const FILE = `package Examples "Example models"
  model RCCircuit "A circuit"
    parameter Real R = 1;
    annotation(Icon(graphics={Rectangle(extent={{-100,-100},{100,100}})}));
  end RCCircuit;
  type Voltage = Real(unit="V") "Voltage type";
  partial model Base
  end Base;
end Examples;
`;

function registry(): ClassRegistry {
  const r = new ClassRegistry();
  r.addLibrary({ id: 'ex', name: 'Examples', readOnly: false });
  expect(r.addFile('ex', 'Examples.mo', FILE)).toEqual([]);
  return r;
}

describe('extract + rename', () => {
  const r = registry();

  it('extracts the class source including the trailing semicolon', () => {
    const def = r.get('Examples.RCCircuit')!.def;
    const text = extractClassText(FILE, def)!;
    expect(text.startsWith('model RCCircuit "A circuit"')).toBe(true);
    expect(text.endsWith('end RCCircuit;')).toBe(true);
  });

  it('renames header and end clause of a long class', () => {
    const def = r.get('Examples.RCCircuit')!.def;
    const renamed = renameClassText(extractClassText(FILE, def)!, def, 'RCCircuitCopy');
    expect(renamed).toBe(`model RCCircuitCopy "A circuit"
    parameter Real R = 1;
    annotation(Icon(graphics={Rectangle(extent={{-100,-100},{100,100}})}));
  end RCCircuitCopy;`);
  });

  it('renames a short class definition', () => {
    const def = r.get('Examples.Voltage')!.def;
    expect(renameClassText(extractClassText(FILE, def)!, def, 'Current')).toBe('type Current = Real(unit="V") "Voltage type";');
  });

  it('keeps prefixes such as partial', () => {
    const def = r.get('Examples.Base')!.def;
    expect(renameClassText(extractClassText(FILE, def)!, def, 'Base2')).toBe('partial model Base2\n  end Base2;');
  });

  it('falls back to regex renaming when locations are missing', () => {
    const def = { ...r.get('Examples.RCCircuit')!.def, loc: undefined, nameLoc: undefined };
    expect(renameClassText('model RCCircuit\nend RCCircuit;', def, 'X')).toBe('model X\nend X;');
  });

  it('falls back to printing the AST when the file text is unavailable', () => {
    const def = r.get('Examples.RCCircuit')!.def;
    const text = duplicateClassText(def, undefined, 'Printed');
    expect(text.startsWith('model Printed')).toBe(true);
    expect(text.trimEnd().endsWith('end Printed;')).toBe(true);
    // The result must parse.
    expect(parse(text).classes[0].name).toBe('Printed');
  });
});

describe('reindent + replace', () => {
  it('re-indents lines after the first relative to the last line', () => {
    const text = 'model A\n    Real x;\n  end A;';
    expect(reindent(text, '      ')).toBe('model A\n        Real x;\n      end A;');
    expect(reindent('type T = Real;', '  ')).toBe('type T = Real;');
  });

  it('replaces the stub the server created with the duplicated text, keeping indentation', () => {
    const r = registry();
    const stubFile = `package Examples "Example models"
  model RCCircuit "A circuit"
    parameter Real R = 1;
  end RCCircuit;
  model RCCircuitCopy "A circuit"
  end RCCircuitCopy;
end Examples;
`;
    const def = r.get('Examples.RCCircuit')!.def;
    const copy = duplicateClassText(def, FILE, 'RCCircuitCopy');
    const parsed = parse(stubFile);
    const stub = parsed.classes[0].classes.find((c) => c.name === 'RCCircuitCopy')!;
    const result = replaceClassInFile(stubFile, stub, copy)!;
    expect(result).toBe(`package Examples "Example models"
  model RCCircuit "A circuit"
    parameter Real R = 1;
  end RCCircuit;
  model RCCircuitCopy "A circuit"
    parameter Real R = 1;
    annotation(Icon(graphics={Rectangle(extent={{-100,-100},{100,100}})}));
  end RCCircuitCopy;
end Examples;
`);
    // The new file parses and contains both classes.
    const again = parse(result);
    expect(again.classes[0].classes.map((c) => c.name)).toEqual(['RCCircuit', 'RCCircuitCopy']);
    const copied = again.classes[0].classes[1];
    expect(copied.components.map((c) => c.name)).toEqual(['R']);
  });

  it('replaces a whole-file top-level class', () => {
    const r = registry();
    const def = r.get('Examples')!.def;
    const copy = duplicateClassText(def, FILE, 'Examples2');
    const stubFile = 'package Examples2\nend Examples2;\n';
    const stub = parse(stubFile).classes[0];
    const result = replaceClassInFile(stubFile, stub, copy)!;
    expect(result.startsWith('package Examples2 "Example models"')).toBe(true);
    expect(result.trimEnd().endsWith('end Examples2;')).toBe(true);
    expect(parse(result).classes[0].classes.map((c) => c.name)).toEqual(['RCCircuit', 'Voltage', 'Base']);
  });
});
