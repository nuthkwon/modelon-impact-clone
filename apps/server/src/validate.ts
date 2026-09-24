/** Tiny request validation helpers; every failure is a 400 `validation_error`. */
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
