import { describe, expect, it } from 'vitest';
import { ClassRegistry } from './registry.js';

const MODELICA = `package Modelica "Modelica Standard Library (mini)"
  extends Modelica.Icons.Package;
  package Units
    package SI
      type Voltage = Real(unit="V");
      type Current = Real(unit="A");
    end SI;
  end Units;
  package Constants
    constant Real pi = 3.14159265358979;
  end Constants;
  package Blocks
    package Interfaces
      connector RealInput = input Real "'input Real' as connector";
      connector RealOutput = output Real "'output Real' as connector";
      partial block SISO
        RealInput u;
        RealOutput y;
      end SISO;
    end Interfaces;
    package Types
      type Init = enumeration(NoInit "no init", SteadyState, InitialState, InitialOutput);
    end Types;
  end Blocks;
  package Electrical
    package Analog
      package Interfaces
        connector Pin
          Modelica.Units.SI.Voltage v;
          flow Modelica.Units.SI.Current i;
        end Pin;
        partial model OnePort
          Pin p;
          Pin n;
        end OnePort;
      end Interfaces;
      package Basic
        model Resistor
          extends Interfaces.OnePort;
          parameter Real R = 1;
        end Resistor;
      end Basic;
    end Analog;
  end Electrical;
  package Icons
    partial package Package end Package;
    partial model Example end Example;
  end Icons;
end Modelica;`;

function makeRegistry(): ClassRegistry {
  const registry = new ClassRegistry();
  registry.addLibrary({ id: 'Modelica', name: 'Modelica', readOnly: true });
  expect(registry.addFile('Modelica', 'Modelica.mo', MODELICA)).toEqual([]);
  return registry;
}

describe('ClassRegistry indexing', () => {
  it('indexes nested classes by fully-qualified name and lists children in declaration order', () => {
    const registry = makeRegistry();
    expect(registry.has('Modelica.Electrical.Analog.Basic.Resistor')).toBe(true);
    expect(registry.get('Modelica.Units.SI.Voltage')?.parentName).toBe('Modelica.Units.SI');
    expect(registry.children().map((c) => c.fullName)).toEqual(['Modelica']);
    expect(registry.children('Modelica').map((c) => c.fullName)).toEqual([
      'Modelica.Units', 'Modelica.Constants', 'Modelica.Blocks', 'Modelica.Electrical', 'Modelica.Icons',
    ]);
    expect(registry.children('Modelica.Blocks.Interfaces').map((c) => c.def.name)).toEqual(['RealInput', 'RealOutput', 'SISO']);
    expect(registry.parentOf('Modelica.Blocks.Interfaces')?.fullName).toBe('Modelica.Blocks');
    expect(registry.isReadOnly('Modelica.Icons')).toBe(true);
    expect(registry.fileOf('Modelica.Icons.Package')?.path).toBe('Modelica.mo');
  });

  it('attaches within-declared classes to their parent after nested ones', () => {
    const registry = makeRegistry();
    registry.addLibrary({ id: 'lib', name: 'MyLib', readOnly: false });
    registry.addFile('lib', 'MyLib/package.mo', 'package MyLib\n  model Inline end Inline;\nend MyLib;');
    registry.addFile('lib', 'MyLib/Circuit.mo', 'within MyLib;\nmodel Circuit\n  extends Modelica.Icons.Example;\nend Circuit;');
    registry.addFile('lib', 'MyLib/Sub/package.mo', 'within MyLib;\npackage Sub\n  model Deep end Deep;\nend Sub;');
    registry.addFile('lib', 'MyLib/Sub/Other.mo', 'within MyLib.Sub;\nmodel Other end Other;');
    expect(registry.children('MyLib').map((c) => c.fullName)).toEqual(['MyLib.Inline', 'MyLib.Circuit', 'MyLib.Sub']);
    expect(registry.children('MyLib.Sub').map((c) => c.fullName)).toEqual(['MyLib.Sub.Deep', 'MyLib.Sub.Other']);
    expect(registry.get('MyLib.Sub.Other')?.parentName).toBe('MyLib.Sub');
    expect(registry.children().map((c) => c.fullName)).toEqual(['Modelica', 'MyLib']);
    expect(registry.isReadOnly('MyLib.Circuit')).toBe(false);
    expect(registry.listFiles('lib')).toHaveLength(4);

    registry.removeFile('lib', 'MyLib/Sub/Other.mo');
    expect(registry.has('MyLib.Sub.Other')).toBe(false);
    expect(registry.children('MyLib.Sub').map((c) => c.fullName)).toEqual(['MyLib.Sub.Deep']);
  });

  it('returns diagnostics on parse errors and keeps the previous content', () => {
    const registry = makeRegistry();
    registry.addFile('lib', 'A.mo', 'model A\n  Real x;\nend A;');
    const diagnostics = registry.addFile('lib', 'A.mo', 'model A\n  Real x\nend A;');
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatchObject({
      severity: 'error',
      message: "Expected ';' after component declaration but found 'end' (line 3, column 1)",
      file: 'A.mo',
      loc: { line: 3, column: 1 },
    });
    expect(registry.get('A')?.def.components).toHaveLength(1);
    expect(registry.getFile('lib', 'A.mo')?.version).toBe(1);

    expect(registry.addFile('lib', 'A.mo', 'model A\n  Real x, y;\nend A;')).toEqual([]);
    expect(registry.get('A')?.def.components).toHaveLength(2);
    expect(registry.getFile('lib', 'A.mo')?.version).toBe(2);
  });
});

describe('ClassRegistry lookup', () => {
  it('finds nested classes of enclosing scopes and global names', () => {
    const registry = makeRegistry();
    expect(registry.lookup('Pin', 'Modelica.Electrical.Analog.Interfaces.OnePort')?.fullName).toBe('Modelica.Electrical.Analog.Interfaces.Pin');
    expect(registry.lookup('Interfaces.OnePort', 'Modelica.Electrical.Analog.Basic.Resistor')?.fullName).toBe('Modelica.Electrical.Analog.Interfaces.OnePort');
    expect(registry.lookup('Modelica.Units.SI.Voltage', 'Modelica.Electrical.Analog.Interfaces.Pin')?.fullName).toBe('Modelica.Units.SI.Voltage');
    expect(registry.lookup('.Modelica.Icons.Package')?.fullName).toBe('Modelica.Icons.Package');
    expect(registry.lookup('Real', 'Modelica.Units.SI.Voltage')?.builtin).toBe(true);
    expect(registry.lookup('Nope', 'Modelica.Units.SI')).toBeUndefined();
  });

  it('finds inherited nested classes and resolves base classes through extends', () => {
    const registry = makeRegistry();
    registry.addFile('lib', 'B.mo', `package B
      model Base
        model Inner end Inner;
        connector Port end Port;
      end Base;
      model Derived
        extends Base;
        Inner inner1;
      end Derived;
      model Twice
        extends Derived;
      end Twice;
    end B;`);
    expect(registry.lookup('Inner', 'B.Derived')?.fullName).toBe('B.Base.Inner');
    expect(registry.lookup('Port', 'B.Twice')?.fullName).toBe('B.Base.Port');
    expect(registry.lookup('Derived.Inner', 'B')?.fullName).toBe('B.Base.Inner');
    expect(registry.baseClasses('B.Twice').map((c) => c.fullName)).toEqual(['B.Derived']);
    expect(registry.inheritanceChain('B.Twice').map((c) => c.fullName)).toEqual(['B.Base', 'B.Derived', 'B.Twice']);
    expect(registry.baseClasses('Modelica.Electrical.Analog.Basic.Resistor').map((c) => c.fullName)).toEqual(['Modelica.Electrical.Analog.Interfaces.OnePort']);
    expect(registry.unresolvedBases('Modelica')).toEqual([]);
  });

  it('resolves names through all import forms', () => {
    const registry = makeRegistry();
    registry.addFile('lib', 'C.mo', `package C
      model UsesImports
        import SI = Modelica.Units.SI;
        import Modelica.Blocks.Interfaces.*;
        import Modelica.Electrical.Analog.Basic.{Resistor};
        import Modelica.Constants;
        import Modelica.Icons.Example;
        SI.Voltage v;
        RealInput u;
        Resistor r;
        Example e;
      end UsesImports;
      package Deep
        import Modelica.Blocks.Types;
        model Nested
          Types.Init init;
        end Nested;
      end Deep;
    end C;`);
    expect(registry.lookup('SI.Voltage', 'C.UsesImports')?.fullName).toBe('Modelica.Units.SI.Voltage');
    expect(registry.lookup('SI', 'C.UsesImports')?.fullName).toBe('Modelica.Units.SI');
    expect(registry.lookup('RealInput', 'C.UsesImports')?.fullName).toBe('Modelica.Blocks.Interfaces.RealInput');
    expect(registry.lookup('Resistor', 'C.UsesImports')?.fullName).toBe('Modelica.Electrical.Analog.Basic.Resistor');
    expect(registry.lookup('Constants.pi', 'C.UsesImports')).toBeUndefined(); // pi is a component, not a class
    expect(registry.lookup('Constants', 'C.UsesImports')?.fullName).toBe('Modelica.Constants');
    expect(registry.lookup('Example', 'C.UsesImports')?.fullName).toBe('Modelica.Icons.Example');
    // Imports of an enclosing class are visible in nested classes.
    expect(registry.lookup('Types.Init', 'C.Deep.Nested')?.fullName).toBe('Modelica.Blocks.Types.Init');
    // Unqualified imports do not leak names that are not there.
    expect(registry.lookup('Capacitor', 'C.UsesImports')).toBeUndefined();
  });

  it('unindexes classes when a library is removed', () => {
    const registry = makeRegistry();
    registry.addFile('lib', 'D.mo', 'model D end D;');
    expect(registry.allClassNames()).toContain('D');
    registry.removeLibrary('lib');
    expect(registry.allClassNames()).not.toContain('D');
    expect(registry.listLibraries().map((l) => l.id)).toEqual(['Modelica']);
  });
});

describe('ClassRegistry.resolveType', () => {
  it('follows short class chains to the builtin type collecting modifications', () => {
    const registry = makeRegistry();
    registry.addFile('lib', 'T.mo', `package T
      import Modelica.Units.SI;
      type HighVoltage = SI.Voltage(min=1000, displayUnit="kV");
      type VeryHigh = HighVoltage(max=1e6);
      type Vector = Real[3];
    end T;`);
    const voltage = registry.resolveType('Modelica.Units.SI.Voltage')!;
    expect(voltage.base.fullName).toBe('Real');
    expect(voltage.base.builtin).toBe(true);
    expect(voltage.chain.map((c) => c.fullName)).toEqual(['Modelica.Units.SI.Voltage', 'Real']);
    expect(voltage.modifications).toHaveLength(1);
    expect(voltage.modifications[0].mods[0]).toMatchObject({ name: 'unit', modification: { value: { kind: 'string', value: 'V' } } });
    expect(voltage.prefixes).toEqual({ input: false, output: false, flow: false });

    const veryHigh = registry.resolveType('T.VeryHigh')!;
    expect(veryHigh.base.fullName).toBe('Real');
    expect(veryHigh.chain.map((c) => c.fullName)).toEqual(['T.VeryHigh', 'T.HighVoltage', 'Modelica.Units.SI.Voltage', 'Real']);
    // innermost (closest to the base) first
    expect(veryHigh.modifications.map((m) => m.mods.map((x) => x.name))).toEqual([['unit'], ['min', 'displayUnit'], ['max']]);
    expect(veryHigh.enumerationLiterals).toBeUndefined();

    expect(registry.resolveType('T.Vector')?.base.fullName).toBe('Real');
    expect(registry.resolveType('Real')?.chain.map((c) => c.fullName)).toEqual(['Real']);
    expect(registry.resolveType('T.Missing')).toBeUndefined();
  });

  it('collects causality prefixes of connector short classes', () => {
    const registry = makeRegistry();
    const input = registry.resolveType('Modelica.Blocks.Interfaces.RealInput')!;
    expect(input.base.fullName).toBe('Real');
    expect(input.prefixes).toEqual({ input: true, output: false, flow: false });
    expect(registry.resolveType('Modelica.Blocks.Interfaces.RealOutput')?.prefixes.output).toBe(true);
    // A long class resolves to itself.
    const pin = registry.resolveType('Modelica.Electrical.Analog.Interfaces.Pin')!;
    expect(pin.base.fullName).toBe('Modelica.Electrical.Analog.Interfaces.Pin');
    expect(pin.modifications).toEqual([]);
  });

  it('returns enumeration literals', () => {
    const registry = makeRegistry();
    const init = registry.resolveType('Modelica.Blocks.Types.Init')!;
    expect(init.enumerationLiterals).toEqual(['NoInit', 'SteadyState', 'InitialState', 'InitialOutput']);
    expect(init.base.fullName).toBe('Modelica.Blocks.Types.Init');
    registry.addFile('lib', 'U.mo', 'package U\n  import Modelica.Blocks.Types.Init;\n  type MyInit = Init;\nend U;');
    expect(registry.resolveType('U.MyInit')?.enumerationLiterals).toEqual(['NoInit', 'SteadyState', 'InitialState', 'InitialOutput']);
  });
});
