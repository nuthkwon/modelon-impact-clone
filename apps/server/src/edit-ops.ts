/**
 * Validates the `op` of `POST /:wid/classes/:className/edit` against the `EditOperation`
 * union before it reaches `applyEdit`. Unknown op names and missing or mistyped fields are
 * 400 `validation_error`s; previously they surfaced as 500s (`TypeError` inside the editor)
 * or — for an unknown op — as a silent no-op that still re-printed and re-versioned the file.
 *
 * Shapes are checked strictly; contents (component names, class names, parameter names) are
 * only required to be non-empty strings, because the editor reports semantic problems as
 * diagnostics (422) and `checkSyntax` guards the final text.
 */
import type { EditOperation, Placement, Point, Transformation } from '@impact/core';
import { badRequest } from './errors.js';
import { optionalNumber, optionalString, requireClassName, requireObject, requireString, requireStringArray, type Json } from './validate.js';

function requireNumber(value: unknown, what: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw badRequest(`${what} must be a number`);
  return value;
}

function requireInteger(value: unknown, what: string): number {
  const n = requireNumber(value, what);
  if (!Number.isInteger(n) || n < 0) throw badRequest(`${what} must be a non-negative integer`);
  return n;
}

function requireBoolean(value: unknown, what: string): boolean {
  if (typeof value !== 'boolean') throw badRequest(`${what} must be a boolean`);
  return value;
}

function requirePoint(value: unknown, what: string): Point {
  if (!Array.isArray(value) || value.length !== 2) throw badRequest(`${what} must be a point [x, y]`);
  return [requireNumber(value[0], `${what}[0]`), requireNumber(value[1], `${what}[1]`)];
}

function requirePoints(value: unknown, what: string): Point[] {
  if (!Array.isArray(value)) throw badRequest(`${what} must be an array of points`);
  return value.map((p, i) => requirePoint(p, `${what}[${i}]`));
}

function requireTransformation(value: unknown, what: string): Transformation {
  const o = requireObject(value, what);
  if (!Array.isArray(o.extent) || o.extent.length !== 2) throw badRequest(`${what}.extent must be two points`);
  return {
    origin: requirePoint(o.origin, `${what}.origin`),
    extent: [requirePoint(o.extent[0], `${what}.extent[0]`), requirePoint(o.extent[1], `${what}.extent[1]`)],
    rotation: requireNumber(o.rotation ?? 0, `${what}.rotation`),
  };
}

function requirePlacement(value: unknown, what: string): Placement {
  const o = requireObject(value, what);
  const placement: Placement = {
    visible: o.visible === undefined ? true : requireBoolean(o.visible, `${what}.visible`),
    transformation: requireTransformation(o.transformation, `${what}.transformation`),
  };
  if (o.iconTransformation !== undefined && o.iconTransformation !== null) placement.iconTransformation = requireTransformation(o.iconTransformation, `${what}.iconTransformation`);
  return placement;
}

function requireColor(value: unknown, what: string): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) throw badRequest(`${what} must be [r, g, b]`);
  return [requireNumber(value[0], `${what}[0]`), requireNumber(value[1], `${what}[1]`), requireNumber(value[2], `${what}[2]`)];
}

export const EDIT_OP_NAMES = [
  'addComponent',
  'moveComponents',
  'setPlacement',
  'rotateComponent',
  'flipComponent',
  'renameComponent',
  'deleteComponents',
  'addConnection',
  'setConnectionPoints',
  'deleteConnection',
  'setParameter',
  'setDescription',
  'setExperiment',
  'replaceText',
] as const satisfies readonly EditOperation['op'][];

/** Returns a clean `EditOperation` holding only the whitelisted fields, or throws a 400. */
export function parseEditOp(value: unknown): EditOperation {
  const op = requireObject(value, 'op');
  const kind = requireString(op.op, 'op.op');
  switch (kind as EditOperation['op']) {
    case 'addComponent': {
      const out: EditOperation = { op: 'addComponent', className: requireClassName(op.className, 'op.className'), position: requirePoint(op.position, 'op.position') };
      const name = optionalString(op.name, 'op.name');
      const rotation = optionalNumber(op.rotation, 'op.rotation');
      const size = optionalNumber(op.size, 'op.size');
      if (name !== undefined) out.name = requireString(name, 'op.name');
      if (rotation !== undefined) out.rotation = rotation;
      if (size !== undefined) out.size = size;
      return out;
    }
    case 'moveComponents':
      return { op: 'moveComponents', names: requireStringArray(op.names, 'op.names'), delta: requirePoint(op.delta, 'op.delta') };
    case 'setPlacement':
      return { op: 'setPlacement', name: requireString(op.name, 'op.name'), placement: requirePlacement(op.placement, 'op.placement') };
    case 'rotateComponent':
      return { op: 'rotateComponent', name: requireString(op.name, 'op.name'), deltaDegrees: requireNumber(op.deltaDegrees, 'op.deltaDegrees') };
    case 'flipComponent': {
      if (op.axis !== 'horizontal' && op.axis !== 'vertical') throw badRequest(`op.axis must be 'horizontal' or 'vertical'`);
      return { op: 'flipComponent', name: requireString(op.name, 'op.name'), axis: op.axis };
    }
    case 'renameComponent':
      return { op: 'renameComponent', name: requireString(op.name, 'op.name'), newName: requireString(op.newName, 'op.newName') };
    case 'deleteComponents':
      return { op: 'deleteComponents', names: requireStringArray(op.names, 'op.names') };
    case 'addConnection': {
      const out: EditOperation = { op: 'addConnection', from: requireString(op.from, 'op.from'), to: requireString(op.to, 'op.to') };
      if (op.points !== undefined && op.points !== null) out.points = requirePoints(op.points, 'op.points');
      if (op.color !== undefined && op.color !== null) out.color = requireColor(op.color, 'op.color');
      return out;
    }
    case 'setConnectionPoints':
      return { op: 'setConnectionPoints', equationIndex: requireInteger(op.equationIndex, 'op.equationIndex'), points: requirePoints(op.points, 'op.points') };
    case 'deleteConnection':
      return { op: 'deleteConnection', equationIndex: requireInteger(op.equationIndex, 'op.equationIndex') };
    case 'setParameter': {
      if (op.valueText !== null && typeof op.valueText !== 'string') throw badRequest('op.valueText must be a string or null');
      const out: EditOperation = { op: 'setParameter', name: requireString(op.name, 'op.name'), valueText: op.valueText };
      const component = optionalString(op.component, 'op.component');
      if (component) out.component = component;
      return out;
    }
    case 'setDescription': {
      if (typeof op.description !== 'string') throw badRequest('op.description must be a string');
      const out: EditOperation = { op: 'setDescription', description: op.description };
      const component = optionalString(op.component, 'op.component');
      if (component) out.component = component;
      return out;
    }
    case 'setExperiment': {
      const e = requireObject(op.experiment, 'op.experiment');
      const experiment: { StartTime?: number; StopTime?: number; Interval?: number; Tolerance?: number } = {};
      for (const key of ['StartTime', 'StopTime', 'Interval', 'Tolerance'] as const) {
        const v = optionalNumber(e[key], `op.experiment.${key}`);
        if (v !== undefined) experiment[key] = v;
      }
      return { op: 'setExperiment', experiment };
    }
    case 'replaceText':
      if (typeof op.text !== 'string') throw badRequest('op.text must be a string');
      return { op: 'replaceText', text: op.text };
    default:
      throw badRequest(`Unknown edit operation '${kind}'; expected one of ${EDIT_OP_NAMES.join(', ')}`);
  }
}

export type { Json };
