/** Tiny request validation helpers; every failure is a 400 `validation_error`. */
import type { Router } from 'express';
import { badRequest } from './errors.js';

export type Json = Record<string, unknown>;

export function requireObject(value: unknown, what: string): Json {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest(`${what} must be an object`);
  return value as Json;
}

export function optionalObject(value: unknown, what: string): Json | undefined {
  if (value === undefined || value === null) return undefined;
  return requireObject(value, what);
}

export function requireString(value: unknown, what: string): string {
  if (typeof value !== 'string' || value.trim() === '') throw badRequest(`${what} must be a non-empty string`);
  return value;
}

export function optionalString(value: unknown, what: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw badRequest(`${what} must be a string`);
  return value;
}

export function optionalNumber(value: unknown, what: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw badRequest(`${what} must be a number`);
  return value;
}

export function optionalEnum<T extends string>(value: unknown, allowed: readonly T[], what: string): T | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T)) throw badRequest(`${what} must be one of ${allowed.join(', ')}`);
  return value as T;
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** A Modelica (possibly dotted) class name such as `Examples.Basic.Resistor`. */
export function requireClassName(value: unknown, what: string): string {
  const s = requireString(value, what);
  if (!s.split('.').every((p) => IDENT.test(p))) throw badRequest(`${what} must be a Modelica class name (identifiers separated by dots)`);
  return s;
}

/** Express query values may be string | string[] | undefined. */
export function queryString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

export function requireStringArray(value: unknown, what: string): string[] {
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) throw badRequest(`${what} must be an array of strings`);
  return value as string[];
}

/** Strict resource id (workspace, project, experiment, case, executable, library): no `.`, `/` or `\\`. */
export const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && ID_RE.test(value);
}

export function requireId(value: unknown, what: string): string {
  if (!isValidId(value)) throw badRequest(`${what} must be an id matching ${ID_RE.source}`);
  return value;
}

/** Route parameters that carry resource ids. */
export const ID_PARAMS = ['wid', 'pid', 'eid', 'cid', 'fid', 'lid'] as const;

/**
 * Rejects malformed id route params with 400 before any handler runs. Express 5 decodes
 * `%2F`, so without this `ws_x%2F.` or `..%2F..%2Fx` would reach the storage layer — and the
 * job/registry caches keyed by the raw string — as another spelling of a directory.
 */
export function validateIdParams(router: Router, names: readonly string[] = ID_PARAMS): void {
  for (const name of names) {
    router.param(name, (_req, _res, next, value: unknown) => {
      if (!isValidId(value)) {
        next(badRequest(`Route parameter '${name}' must be an id matching ${ID_RE.source}`));
        return;
      }
      next();
    });
  }
}
