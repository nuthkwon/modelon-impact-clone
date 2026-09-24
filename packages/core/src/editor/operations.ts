/**
 * Editor operations — "text as the source of truth" (docs/ARCHITECTURE.md).
 *
 * `applyEdit` locates the file that declares the edited class, deep-clones its parsed
 * `StoredDefinition`, mutates the clone and re-prints the **whole file** with the canonical
 * printer. The registry is never mutated; callers commit the returned text with
 * `registry.addFile`. Every failure (unknown component, duplicate name, read-only library,
 * invalid expression, ...) comes back as an `EditResult` carrying an error diagnostic and the
 * original text; only a class without a file throws.
 *
 * Placement conventions (Modelica §18.6.6.2: rotation is about `origin`): unrotated components
 * are written Dymola/Impact style with an absolute extent (`extent={{30,-10},{50,10}}`),
 * rotated ones centred on their origin (`origin={40,0}, extent={{-10,-10},{10,10}},
 * rotation=90`), so rotating or flipping never moves a component on the canvas.
 */
import type { ClassDef, ComponentDecl, ComponentPrefixes, Diagnostic, Equation, Expr, ExtendsClause, Modifier, StoredDefinition } from '../ast.js';
import { E, ModelicaError } from '../ast.js';
import type { EditOperation, EditResult } from '../diagram.js';
import { resolveIcon } from '../diagram/view.js';
import type { ConnectionLine, CoordinateSystem, Placement, Point, Transformation } from '../graphics.js';
import { BLACK, DEFAULT_COORDINATE_SYSTEM, MODELICA_BLUE } from '../graphics.js';
import { DEFAULT_TRANSFORMATION, parseConnectionLine, parseGraphicsLayer, parsePlacement } from '../graphics/annotations.js';
import { connectionLineToModifier, nestedModifier, placementToModifier, pointsExpr, valueModifier } from '../graphics/serialize.js';
import {
  applyMatrixToVector,
  extentCenter,
  flipTransformationHorizontal,
  flipTransformationVertical,
  rotateTransformation,
  rotationMatrix,
  snapToGrid,
  transformationAt,
  translateTransformation,
} from '../graphics/transform.js';
import { parse, parseExpression } from '../parser/parser.js';
import { printExpr, printStoredDefinition } from '../parser/printer.js';
import type { ClassRegistry, RegisteredClass } from '../registry.js';
import { componentsOf, isConnectorClass, listConnectorRefs, validateConnectorRef } from './connectors.js';
import { findModifierPath, isEmptyModification, modifiersAlongPath, removeModifierPath, setModifierValue } from './modifiers.js';
import { defaultBaseName, defaultPrefixesOf, generateComponentName, isValidIdentifier, pickComponentName, takenNames } from './naming.js';
import {
  componentReferences,
  describeEquation,
  equationReferences,
  modificationReferences,
  removeConnectsReferencing,
  renameReferences,
} from './references.js';

export { generateComponentName, isValidIdentifier, listConnectorRefs };

type ConnectEquation = Extract<Equation, { kind: 'connect' }>;

/** An edit that cannot be applied; turned into an error diagnostic by `applyEdit`. */
class EditError extends Error {
  constructor(message: string, readonly path?: string) {
    super(message);
    this.name = 'EditError';
  }
}

interface EditContext {
  registry: ClassRegistry;
  className: string;
  def: StoredDefinition;
  target: ClassDef;
  diagnostics: Diagnostic[];
  createdName?: string;
}

const EMPTY_PREFIXES: ComponentPrefixes = {
  flow: false, stream: false, input: false, output: false, parameter: false, constant: false, discrete: false,
  final: false, inner: false, outer: false, replaceable: false, redeclare: false, protected: false,
};

const EXPERIMENT_KEYS = ['StartTime', 'StopTime', 'Interval', 'Tolerance'] as const;

// -------------------------------------------------------------------------------------------------
// Entry point
// -------------------------------------------------------------------------------------------------

/**
 * Applies `op` to `className` and returns the re-printed text of the file that declares it.
 * The registry is NOT mutated; callers re-add the file (`registry.addFile`) to commit.
 * Throws only when no registered file declares `className`.
 */
export function applyEdit(registry: ClassRegistry, className: string, op: EditOperation): EditResult {
  const file = registry.fileOf(className);
  if (!file) throw new Error(`applyEdit: no file declares class '${className}'`);
  const original = file.text;
  const fail = (message: string, path = className): EditResult => ({
    text: original,
    diagnostics: [{ severity: 'error', message, path, file: file.path }],
  });

  if (registry.isReadOnly(className)) {
    const owner = registry.get(className);
    const library = owner ? registry.getLibrary(owner.libraryId) : undefined;
    return fail(`Class '${className}' belongs to the read-only library '${library?.name ?? owner?.libraryId ?? '?'}' and cannot be edited`);
  }

  if (op.op === 'replaceText') {
    try {
      parse(op.text, file.path);
      return { text: op.text, diagnostics: [] };
    } catch (e) {
      return { text: original, diagnostics: diagnosticsOf(e, file.path) };
    }
  }

  const def = structuredClone(file.definition);
  const target = findClassDef(def, className);
  if (!target) return fail(`Class '${className}' was not found in file '${file.path}'`);

  const ctx: EditContext = { registry, className, def, target, diagnostics: [] };
  try {
    dispatch(ctx, op);
  } catch (e) {
    if (e instanceof EditError) return fail(e.message, e.path);
    if (e instanceof ModelicaError) return { text: original, diagnostics: diagnosticsOf(e, file.path) };
    throw e;
  }

  const text = printStoredDefinition(def);
  try {
    parse(text, file.path);
  } catch (e) {
    return {
      text: original,
      diagnostics: [
        { severity: 'error', message: `Edit '${op.op}' produced Modelica text that does not parse; the file was left unchanged`, path: className, file: file.path },
        ...diagnosticsOf(e, file.path),
      ],
    };
  }
  const result: EditResult = { text, diagnostics: ctx.diagnostics };
  if (ctx.createdName !== undefined) result.createdName = ctx.createdName;
  return result;
}

function dispatch(ctx: EditContext, op: EditOperation): void {
  switch (op.op) {
    case 'addComponent': return addComponent(ctx, op);
    case 'moveComponents': return moveComponents(ctx, op);
    case 'setPlacement': return setPlacement(ctx, op);
    case 'rotateComponent': return rotateComponent(ctx, op);
    case 'flipComponent': return flipComponent(ctx, op);
    case 'renameComponent': return renameComponent(ctx, op);
    case 'deleteComponents': return deleteComponents(ctx, op);
    case 'addConnection': return addConnection(ctx, op);
    case 'setConnectionPoints': return setConnectionPoints(ctx, op);
    case 'deleteConnection': return deleteConnection(ctx, op);
    case 'setParameter': return setParameter(ctx, op);
    case 'setDescription': return setDescription(ctx, op);
    case 'setExperiment': return setExperiment(ctx, op);
    case 'replaceText': return; // handled in applyEdit
  }
}

function diagnosticsOf(e: unknown, file?: string): Diagnostic[] {
  if (e instanceof ModelicaError) return e.diagnostics.map((d) => ({ ...d, file: d.file ?? file }));
  return [{ severity: 'error', message: e instanceof Error ? e.message : String(e), file }];
}

/** The `ClassDef` for `fullName` inside `def`, following nested classes below the file's `within` prefix. */
export function findClassDef(def: StoredDefinition, fullName: string): ClassDef | undefined {
  const prefix = def.within ? `${def.within}.` : '';
  if (!fullName.startsWith(prefix)) return undefined;
  const parts = fullName.slice(prefix.length).split('.');
  let list = def.classes;
  let cls: ClassDef | undefined;
  for (const part of parts) {
    cls = list.find((c) => c.name === part);
    if (!cls) return undefined;
    list = cls.classes;
  }
  return cls;
}

// -------------------------------------------------------------------------------------------------
// Component helpers
// -------------------------------------------------------------------------------------------------

function ownComponent(ctx: EditContext, name: string): ComponentDecl | undefined {
  return ctx.target.components.find((c) => c.name === name);
}

/** The component declared by the edited class itself; inherited or unknown components are errors. */
function requireOwnComponent(ctx: EditContext, name: string, verb: string): ComponentDecl {
  const own = ownComponent(ctx, name);
  if (own) return own;
  const inherited = componentsOf(ctx.registry, ctx.className, ctx.target).find((e) => e.decl.name === name);
  if (inherited) {
    throw new EditError(
      `Component '${name}' is inherited from '${inherited.declaringClass}' and cannot be ${verb} in '${ctx.className}'`,
      `${ctx.className}.${name}`,
    );
  }
  throw new EditError(`Unknown component '${name}' in class '${ctx.className}'`, `${ctx.className}.${name}`);
}

function cloneTransformation(t: Transformation): Transformation {
  return { origin: [t.origin[0], t.origin[1]], extent: [[t.extent[0][0], t.extent[0][1]], [t.extent[1][0], t.extent[1][1]]], rotation: t.rotation };
}

function placementOf(c: ComponentDecl): Placement {
  return parsePlacement(c.annotation) ?? { visible: true, transformation: cloneTransformation(DEFAULT_TRANSFORMATION) };
}

/** Replaces (or adds) the `Placement` entry of a component annotation, keeping other entries (`Dialog`, ...). */
function writePlacement(c: ComponentDecl, placement: Placement): void {
  const mod = placementToModifier(placement);
  if (!c.annotation) {
    c.annotation = { mods: [mod] };
    return;
  }
  const idx = c.annotation.mods.findIndex((m) => m.name === 'Placement' && !m.redeclare);
  if (idx >= 0) c.annotation.mods[idx] = mod;
  else c.annotation.mods.push(mod);
}

/** Normalizes an angle to (-180, 180]. */
export function normalizeSignedAngle(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  let r = ((deg % 360) + 360) % 360;
  if (r > 180) r -= 360;
  return r === 0 ? 0 : r;
}

function round2(v: number): number {
  const r = Math.round(v * 100) / 100;
  return r === 0 ? 0 : r;
}

function roundTransformation(t: Transformation): Transformation {
  return {
    origin: [round2(t.origin[0]), round2(t.origin[1])],
    extent: [[round2(t.extent[0][0]), round2(t.extent[0][1])], [round2(t.extent[1][0]), round2(t.extent[1][1])]],
    rotation: round2(t.rotation),
  };
}

/**
 * Canonical written form that keeps the visual position: unrotated → absolute extent with the
 * default origin; rotated → origin at the visual centre, extent centred, rotation in (-180, 180].
 */
export function canonicalizeTransformation(t: Transformation): Transformation {
  const rotation = normalizeSignedAngle(t.rotation);
  if (rotation === 0) {
    const [ox, oy] = t.origin;
    return {
      origin: [0, 0],
      extent: [[t.extent[0][0] + ox, t.extent[0][1] + oy], [t.extent[1][0] + ox, t.extent[1][1] + oy]],
      rotation: 0,
    };
  }
  const centered = centerTransformation(t);
  centered.rotation = rotation;
  return centered;
}

/** Visual centre of a placed component in parent coordinates: `origin + R(rotation) · centre(extent)`. */
function visualCenter(t: Transformation): Point {
  const [cx, cy] = extentCenter(t.extent);
  const [rx, ry] = applyMatrixToVector(rotationMatrix(t.rotation), [cx, cy]);
  return [t.origin[0] + rx, t.origin[1] + ry];
}

/**
 * Equivalent transformation whose origin is the visual centre and whose extent is centred on it.
 * Rotations and flips are about the origin, so this must be applied before them to keep the
 * component in place.
 */
function centerTransformation(t: Transformation): Transformation {
  const hw = (t.extent[1][0] - t.extent[0][0]) / 2; // signed: keeps flips
  const hh = (t.extent[1][1] - t.extent[0][1]) / 2;
  return { origin: visualCenter(t), extent: [[-hw, -hh], [hw, hh]], rotation: t.rotation };
}

function updateTransformation(ctx: EditContext, name: string, verb: string, fn: (t: Transformation) => Transformation): void {
  const comp = requireOwnComponent(ctx, name, verb);
  const placement = placementOf(comp);
  placement.transformation = roundTransformation(canonicalizeTransformation(fn(centerTransformation(placement.transformation))));
  writePlacement(comp, placement);
}

/** Icon coordinate system of a class (own or inherited `Icon`), used to size dropped components. */
function iconCoordinateSystemOf(registry: ClassRegistry, cls: RegisteredClass): CoordinateSystem {
  try {
    const icon = resolveIcon(registry, cls.fullName);
    if (icon) return icon.coordinateSystem;
  } catch {
    // diagram/view not available: fall back to the annotations directly
  }
  const chain = registry.inheritanceChain(cls.fullName);
  for (let i = chain.length - 1; i >= 0; i--) {
    const layer = parseGraphicsLayer(chain[i].def.annotation, 'Icon');
    if (layer) return layer.coordinateSystem;
  }
  return DEFAULT_COORDINATE_SYSTEM;
}

// -------------------------------------------------------------------------------------------------
// Components
// -------------------------------------------------------------------------------------------------

function addComponent(ctx: EditContext, op: Extract<EditOperation, { op: 'addComponent' }>): void {
  const { registry, className, target } = ctx;
  const cls = registry.lookup(op.className, className);
  if (!cls) throw new EditError(`Unknown class '${op.className}'`);
  if (cls.fullName === className) throw new EditError(`Cannot add '${cls.fullName}' as a component of itself`);
  if (cls.def.partial) throw new EditError(`Cannot instantiate partial class '${cls.fullName}'`);
  if (cls.def.restriction === 'package' || cls.def.restriction === 'function') {
    throw new EditError(`Cannot instantiate ${cls.def.restriction} '${cls.fullName}'`);
  }

  const taken = takenNames(registry, className, target);
  let name: string;
  if (op.name !== undefined) {
    if (!isValidIdentifier(op.name)) throw new EditError(`'${op.name}' is not a valid Modelica identifier`);
    if (taken.has(op.name)) throw new EditError(`Name '${op.name}' is already used in '${className}'`);
    name = op.name;
  } else {
    name = pickComponentName(defaultBaseName(registry, cls, op.className), taken);
  }

  const position = snapToGrid(op.position, [2, 2]);
  const transformation = roundTransformation(
    canonicalizeTransformation(transformationAt(position, op.size ?? 20, iconCoordinateSystemOf(registry, cls), op.rotation ?? 0)),
  );
  const placement: Placement = { visible: true, transformation };
  if (isConnectorClass(registry, cls.fullName)) placement.iconTransformation = cloneTransformation(transformation);

  const decl: ComponentDecl = {
    kind: 'component',
    typeName: cls.fullName,
    name,
    prefixes: { ...EMPTY_PREFIXES, ...defaultPrefixesOf(registry, cls) },
    annotation: { mods: [placementToModifier(placement)] },
  };
  // After the last public component (protected ones stay at the end of the class).
  let idx = target.components.length;
  while (idx > 0 && target.components[idx - 1].prefixes.protected) idx--;
  target.components.splice(idx, 0, decl);
  ctx.createdName = name;
}

function moveComponents(ctx: EditContext, op: Extract<EditOperation, { op: 'moveComponents' }>): void {
  const names = [...new Set(op.names)];
  for (const name of names) requireOwnComponent(ctx, name, 'moved');
  const [dx, dy] = op.delta;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new EditError('Move delta must be finite');
  for (const name of names) updateTransformation(ctx, name, 'moved', (t) => translateTransformation(t, dx, dy));
}

function setPlacement(ctx: EditContext, op: Extract<EditOperation, { op: 'setPlacement' }>): void {
  const comp = requireOwnComponent(ctx, op.name, 'placed');
  writePlacement(comp, op.placement);
}

function rotateComponent(ctx: EditContext, op: Extract<EditOperation, { op: 'rotateComponent' }>): void {
  if (!Number.isFinite(op.deltaDegrees)) throw new EditError('Rotation angle must be finite');
  updateTransformation(ctx, op.name, 'rotated', (t) => rotateTransformation(t, op.deltaDegrees));
}

function flipComponent(ctx: EditContext, op: Extract<EditOperation, { op: 'flipComponent' }>): void {
  const flip = op.axis === 'horizontal' ? flipTransformationHorizontal : flipTransformationVertical;
  updateTransformation(ctx, op.name, 'flipped', flip);
}

function renameComponent(ctx: EditContext, op: Extract<EditOperation, { op: 'renameComponent' }>): void {
  const comp = requireOwnComponent(ctx, op.name, 'renamed');
  if (!isValidIdentifier(op.newName)) throw new EditError(`'${op.newName}' is not a valid Modelica identifier`);
  if (op.newName === op.name) return;
  if (takenNames(ctx.registry, ctx.className, ctx.target).has(op.newName)) {
    throw new EditError(`Name '${op.newName}' is already used in '${ctx.className}'`);
  }
  // The component is inherited by every derived class: the new name must be free there too.
  const derived = derivedClasses(ctx);
  const clashes = derived.filter((d) => takenNames(ctx.registry, d.cls.fullName, d.own).has(op.newName)).map((d) => d.cls.fullName);
  if (clashes.length) {
    throw new EditError(`Name '${op.newName}' is already used in the derived class${clashes.length > 1 ? 'es' : ''} ${quoteList(clashes)}`);
  }
  const names = new Set([op.name]);
  const toUpdate = referencingDerived(ctx, derived, names, 'renamed');

  comp.name = op.newName;
  renameReferences(ctx.target, op.name, op.newName);
  for (const { cls, own } of toUpdate) {
    renameReferences(own, op.name, op.newName);
    for (const ext of extendsTowardsTarget(ctx, cls, own)) {
      for (const m of ext.modification?.mods ?? []) if (modifierHead(m.name) === op.name) m.name = op.newName + m.name.slice(op.name.length);
    }
  }

  const algorithms = ctx.target.algorithms ?? [];
  if (algorithms.length) {
    const mention = new RegExp(`(^|[^A-Za-z0-9_])${escapeRegExp(op.name)}(?![A-Za-z0-9_])`);
    if (algorithms.some((a) => mention.test(a.text))) {
      ctx.diagnostics.push({
        severity: 'warning',
        message: `Algorithm sections mention '${op.name}' and were not updated; rename those references by hand`,
        path: `${ctx.className}.${op.newName}`,
      });
    }
  }
}

function deleteComponents(ctx: EditContext, op: Extract<EditOperation, { op: 'deleteComponents' }>): void {
  const names = new Set(op.names);
  for (const name of names) requireOwnComponent(ctx, name, 'deleted');
  const toUpdate = referencingDerived(ctx, derivedClasses(ctx), names, 'deleted');
  const { target } = ctx;
  target.components = target.components.filter((c) => !names.has(c.name));
  target.equations = removeConnectsReferencing(target.equations, names);
  target.initialEquations = removeConnectsReferencing(target.initialEquations, names);
  const leftovers = leftoverReferences(target, names);

  // Derived classes in the same file lose their connects to, and `extends` modifiers of, the deleted components.
  for (const { cls, own } of toUpdate) {
    own.equations = removeConnectsReferencing(own.equations, names);
    own.initialEquations = removeConnectsReferencing(own.initialEquations, names);
    for (const ext of extendsTowardsTarget(ctx, cls, own)) {
      if (!ext.modification) continue;
      ext.modification.mods = ext.modification.mods.filter((m) => !names.has(modifierHead(m.name)));
      if (isEmptyModification(ext.modification)) delete ext.modification;
    }
    leftovers.push(...leftoverReferences(own, names).map((where) => `${cls.fullName}: ${where}`));
  }

  if (leftovers.length) {
    ctx.diagnostics.push({
      severity: 'warning',
      message: `Deleted component${names.size > 1 ? 's' : ''} ${quoteList([...names])} still referenced by: ${leftovers.join('; ')}`,
      path: ctx.className,
    });
  }
}

/** Places in `def` that still refer to one of `names` (connect equations are expected to be removed already). */
function leftoverReferences(def: ClassDef, names: Set<string>): string[] {
  const out: string[] = [];
  for (const eq of def.equations) if (equationReferences(eq, names)) out.push(describeEquation(eq));
  for (const eq of def.initialEquations) if (equationReferences(eq, names)) out.push(`initial equation ${describeEquation(eq)}`);
  for (const c of def.components) if (componentReferences(c, names)) out.push(`declaration of '${c.name}'`);
  for (const ext of def.extends) if (modificationReferences(ext.modification, names)) out.push(`extends ${ext.typeName}`);
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const quoteList = (names: string[]): string => names.map((n) => `'${n}'`).join(', ');

// -------------------------------------------------------------------------------------------------
// Derived classes (they inherit the edited class's components)
// -------------------------------------------------------------------------------------------------

interface DerivedClass {
  cls: RegisteredClass;
  /** The class's definition inside the edited copy of the file, when it is declared in the same file. */
  own?: ClassDef;
}

/** Every registered class that extends `ctx.className`, directly or through other classes. */
function derivedClasses(ctx: EditContext): DerivedClass[] {
  const { registry, className } = ctx;
  const edited = registry.get(className);
  const out: DerivedClass[] = [];
  for (const name of registry.allClassNames()) {
    if (name === className) continue;
    const cls = registry.get(name);
    if (!cls || cls.builtin || cls.def.extends.length === 0) continue;
    if (!registry.inheritanceChain(name).some((c) => c.fullName === className)) continue;
    const sameFile = !!edited && cls.libraryId === edited.libraryId && cls.file === edited.file;
    const own = sameFile ? findClassDef(ctx.def, name) : undefined;
    out.push(own ? { cls, own } : { cls });
  }
  return out;
}

/** Head of a (possibly dotted) modifier name: `resistor` for `resistor.R`. */
function modifierHead(name: string): string {
  const dot = name.indexOf('.');
  return dot < 0 ? name : name.slice(0, dot);
}

/** The `extends` clauses of `def` (a class derived from the edited one) through which the edited class is inherited. */
function extendsTowardsTarget(ctx: EditContext, derived: RegisteredClass, def: ClassDef): ExtendsClause[] {
  return def.extends.filter((ext) => {
    const base = ctx.registry.lookup(ext.typeName, derived.fullName);
    return !!base && (base.fullName === ctx.className || ctx.registry.inheritanceChain(base.fullName).some((c) => c.fullName === ctx.className));
  });
}

/** True when `def` mentions one of the inherited components `names`: in equations, declarations or as `extends` modifier of the edited class. */
function derivedReferences(ctx: EditContext, derived: RegisteredClass, def: ClassDef, names: Set<string>): boolean {
  if (def.equations.some((eq) => equationReferences(eq, names))) return true;
  if (def.initialEquations.some((eq) => equationReferences(eq, names))) return true;
  if (def.components.some((c) => componentReferences(c, names))) return true;
  if (def.extends.some((ext) => modificationReferences(ext.modification, names))) return true;
  return extendsTowardsTarget(ctx, derived, def).some((ext) => (ext.modification?.mods ?? []).some((m) => names.has(modifierHead(m.name))));
}

/**
 * The derived classes that refer to the components `names`. Those declared in the edited file are
 * returned so the edit can update them; a reference from a class in another file cannot be fixed
 * by this edit and makes it fail, instead of silently breaking that class.
 */
function referencingDerived(ctx: EditContext, derived: DerivedClass[], names: Set<string>, verb: string): { cls: RegisteredClass; own: ClassDef }[] {
  const sameFile: { cls: RegisteredClass; own: ClassDef }[] = [];
  const elsewhere: string[] = [];
  for (const { cls, own } of derived) {
    if (!derivedReferences(ctx, cls, own ?? cls.def, names)) continue;
    if (own) sameFile.push({ cls, own });
    else elsewhere.push(cls.fullName);
  }
  if (elsewhere.length) {
    const plural = names.size > 1;
    throw new EditError(
      `Component${plural ? 's' : ''} ${quoteList([...names])} ${plural ? 'are' : 'is'} referred to by the derived class${elsewhere.length > 1 ? 'es' : ''} ` +
        `${quoteList(elsewhere)} in other files and cannot be ${verb}; update those references first`,
      ctx.className,
    );
  }
  return sameFile;
}

// -------------------------------------------------------------------------------------------------
// Connections
// -------------------------------------------------------------------------------------------------

type RefExpr = Extract<Expr, { kind: 'ref' }>;

function parseConnectorRef(text: string): RefExpr {
  let e: Expr;
  try {
    e = parseExpression(text);
  } catch (err) {
    throw new EditError(`Invalid connector reference '${text}': ${err instanceof Error ? err.message : String(err)}`);
  }
  if (e.kind !== 'ref' || e.global) throw new EditError(`Invalid connector reference '${text}'`);
  delete e.loc;
  for (const p of e.parts) for (const s of p.subscripts ?? []) delete s.loc;
  return e;
}

function* allConnects(eqs: Equation[]): Generator<ConnectEquation> {
  for (const eq of eqs) {
    switch (eq.kind) {
      case 'connect': yield eq; break;
      case 'if':
        for (const b of eq.branches) yield* allConnects(b.equations);
        yield* allConnects(eq.else);
        break;
      case 'for': yield* allConnects(eq.equations); break;
      case 'when': for (const b of eq.branches) yield* allConnects(b.equations); break;
      default: break;
    }
  }
}

/** Fallback line when the canvas passes no points: the origins of the two connected components. */
function defaultPoints(ctx: EditContext, a: RefExpr, b: RefExpr): Point[] {
  const originOf = (ref: RefExpr): Point => {
    const entry = componentsOf(ctx.registry, ctx.className, ctx.target).find((e) => e.decl.name === ref.parts[0].name);
    if (!entry) return [0, 0];
    const [x, y] = visualCenter(placementOf(entry.decl).transformation);
    return [round2(x), round2(y)];
  };
  return [originOf(a), originOf(b)];
}

function addConnection(ctx: EditContext, op: Extract<EditOperation, { op: 'addConnection' }>): void {
  const a = parseConnectorRef(op.from);
  const b = parseConnectorRef(op.to);
  const aText = printExpr(a);
  const bText = printExpr(b);
  if (aText === bText) throw new EditError(`Cannot connect '${aText}' to itself`);
  for (const ref of [a, b]) {
    const error = validateConnectorRef(ctx.registry, ctx.className, ref.parts.map((p) => p.name), ctx.target);
    if (error) throw new EditError(error);
  }
  for (const eq of allConnects(ctx.target.equations)) {
    const x = printExpr(eq.a);
    const y = printExpr(eq.b);
    if ((x === aText && y === bText) || (x === bText && y === aText)) throw new EditError('Connection already exists');
  }
  const line: ConnectionLine = {
    points: op.points && op.points.length >= 2 ? op.points : defaultPoints(ctx, a, b),
    color: op.color ?? [MODELICA_BLUE[0], MODELICA_BLUE[1], MODELICA_BLUE[2]],
    pattern: 'Solid',
    thickness: 0.25,
    smooth: 'None',
    arrow: ['None', 'None'],
  };
  ctx.target.equations.push({ kind: 'connect', a, b, annotation: { mods: [connectionLineToModifier(line)] } });
}

function requireConnect(ctx: EditContext, index: number): ConnectEquation {
  const eq = Number.isInteger(index) ? ctx.target.equations[index] : undefined;
  if (!eq) throw new EditError(`No equation at index ${index} in '${ctx.className}'`);
  if (eq.kind !== 'connect') throw new EditError(`Equation ${index} of '${ctx.className}' is not a connect equation`);
  return eq;
}

function setConnectionPoints(ctx: EditContext, op: Extract<EditOperation, { op: 'setConnectionPoints' }>): void {
  if (op.points.length < 2) throw new EditError('A connection line needs at least two points');
  const eq = requireConnect(ctx, op.equationIndex);
  const annotation = eq.annotation ?? (eq.annotation = { mods: [] });
  const lineIdx = annotation.mods.findIndex((m) => m.name === 'Line' && !m.redeclare);
  const line: Modifier | undefined = lineIdx >= 0 ? annotation.mods[lineIdx] : undefined;
  if (line && (line.modification.mods.length > 0 || line.modification.value === undefined)) {
    // Nested-modifier form: replace only `points`, keep every other attribute verbatim.
    const points = line.modification.mods.find((m) => m.name === 'points' && !m.redeclare);
    if (points) points.modification = { mods: [], value: pointsExpr(op.points) };
    else line.modification.mods.unshift(valueModifier('points', pointsExpr(op.points)));
    return;
  }
  // Missing, or written as a `Line(...)` record call: rebuild from the parsed line.
  const parsed: ConnectionLine = parseConnectionLine(annotation) ?? {
    points: [], color: [BLACK[0], BLACK[1], BLACK[2]], pattern: 'Solid', thickness: 0.25, smooth: 'None', arrow: ['None', 'None'],
  };
  parsed.points = op.points;
  const mod = connectionLineToModifier(parsed);
  if (lineIdx >= 0) annotation.mods[lineIdx] = mod;
  else annotation.mods.push(mod);
}

function deleteConnection(ctx: EditContext, op: Extract<EditOperation, { op: 'deleteConnection' }>): void {
  requireConnect(ctx, op.equationIndex);
  ctx.target.equations.splice(op.equationIndex, 1);
}

// -------------------------------------------------------------------------------------------------
// Parameters, descriptions, experiment
// -------------------------------------------------------------------------------------------------

/** The `extends` clause of the edited class through which `declaringClass` is inherited. */
function extendsClauseFor(ctx: EditContext, declaringClass: string): ExtendsClause | undefined {
  for (const ext of ctx.target.extends) {
    const base = ctx.registry.lookup(ext.typeName, ctx.className);
    if (!base) continue;
    if (base.fullName === declaringClass) return ext;
    if (ctx.registry.inheritanceChain(base.fullName).some((c) => c.fullName === declaringClass)) return ext;
  }
  return undefined;
}

function setParameter(ctx: EditContext, op: Extract<EditOperation, { op: 'setParameter' }>): void {
  const path = [...(op.component ? op.component.split('.') : []), ...op.name.split('.')].map((p) => p.trim());
  if (!path.length || path.some((p) => !isValidIdentifier(p))) {
    throw new EditError(`Invalid parameter path '${op.component ? `${op.component}.` : ''}${op.name}'`);
  }
  let value: Expr | undefined;
  const text = op.valueText?.trim() ?? '';
  if (text !== '') {
    try {
      value = parseExpression(text);
    } catch (e) {
      throw new EditError(`Invalid expression '${text}': ${e instanceof ModelicaError ? e.diagnostics[0]?.message ?? e.message : String(e)}`);
    }
    stripLoc(value);
  }
  const dotted = path.join('.');
  const root = path[0];

  const own = ownComponent(ctx, root);
  if (own) {
    if (path.length === 1) {
      if (own.prefixes.final && value) throw new EditError(`'${root}' is declared final in '${ctx.className}'`);
      if (value) (own.modification ??= { mods: [] }).value = value;
      else if (own.modification) {
        delete own.modification.value;
        if (isEmptyModification(own.modification)) delete own.modification;
      }
      return;
    }
    const rest = path.slice(1);
    assertNotFinal(own.modification ? modifiersAlongPath(own.modification, rest) : [], dotted);
    if (value) setModifierValue((own.modification ??= { mods: [] }), rest, value);
    else if (own.modification) {
      removeModifierPath(own.modification, rest);
      if (isEmptyModification(own.modification)) delete own.modification;
    }
    return;
  }

  const inherited = componentsOf(ctx.registry, ctx.className, ctx.target).find((e) => e.decl.name === root);
  if (!inherited) throw new EditError(`Unknown component '${root}' in class '${ctx.className}'`, `${ctx.className}.${root}`);
  const ext = extendsClauseFor(ctx, inherited.declaringClass);
  if (!ext) {
    throw new EditError(`Component '${root}' is inherited from '${inherited.declaringClass}' but no extends clause of '${ctx.className}' resolves to it`);
  }
  assertNotFinal(ext.modification ? modifiersAlongPath(ext.modification, path) : [], dotted);
  if (value) setModifierValue((ext.modification ??= { mods: [] }), path, value);
  else if (ext.modification) {
    removeModifierPath(ext.modification, path);
    if (isEmptyModification(ext.modification)) delete ext.modification;
  }
}

function assertNotFinal(mods: Modifier[], dotted: string): void {
  const fin = mods.find((m) => m.final);
  if (fin) throw new EditError(`Modifier '${fin.name}' is final; '${dotted}' cannot be changed`);
}

function stripLoc(e: Expr): void {
  delete e.loc;
  switch (e.kind) {
    case 'ref': for (const p of e.parts) for (const s of p.subscripts ?? []) stripLoc(s); return;
    case 'binary': stripLoc(e.left); stripLoc(e.right); return;
    case 'unary': stripLoc(e.operand); return;
    case 'call': e.args.forEach(stripLoc); e.namedArgs.forEach((a) => stripLoc(a.value)); return;
    case 'if': e.branches.forEach((b) => { stripLoc(b.cond); stripLoc(b.value); }); stripLoc(e.else); return;
    case 'array': e.elements.forEach(stripLoc); return;
    case 'range': stripLoc(e.start); if (e.step) stripLoc(e.step); stripLoc(e.end); return;
    case 'iterator': stripLoc(e.body); for (const it of e.iterators) if (it.range) stripLoc(it.range); return;
    default: return;
  }
}

function setDescription(ctx: EditContext, op: Extract<EditOperation, { op: 'setDescription' }>): void {
  const holder: { description?: string } = op.component !== undefined ? requireOwnComponent(ctx, op.component, 'described') : ctx.target;
  if (op.description === '') delete holder.description;
  else holder.description = op.description;
}

function setExperiment(ctx: EditContext, op: Extract<EditOperation, { op: 'setExperiment' }>): void {
  for (const key of EXPERIMENT_KEYS) {
    const v = op.experiment[key];
    if (v !== undefined && !Number.isFinite(v)) throw new EditError(`experiment.${key} must be a finite number`);
  }
  const annotation = ctx.target.annotation ?? (ctx.target.annotation = { mods: [] });
  let experiment = annotation.mods.find((m) => m.name === 'experiment' && !m.redeclare);
  if (!experiment) {
    experiment = nestedModifier('experiment', []);
    annotation.mods.push(experiment);
  }
  for (const key of EXPERIMENT_KEYS) {
    const v = op.experiment[key];
    if (v === undefined) continue;
    const existing = experiment.modification.mods.find((m) => m.name === key && !m.redeclare);
    if (existing) existing.modification = { mods: [], value: E.num(v) };
    else experiment.modification.mods.push(valueModifier(key, E.num(v)));
  }
}

// Re-exported for UI convenience (parameter dialogs check whether a value is currently set).
export { findModifierPath };
