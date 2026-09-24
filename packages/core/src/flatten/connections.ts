/**
 * Connection expansion. For every class instance the `connect` statements written in its
 * class (and bases) are grouped into connection sets with a union-find. Per set, potential
 * variables get `n-1` equalities and each flow variable one sum equation
 * `Σ(+inside) + Σ(−outside) = 0`. Causal (scalar input/output) connectors give `a = b`.
 * Unconnected inside flow variables are set to zero; unconnected top-level inputs are bound to
 * their start value with a warning.
 */
import { E, type Expr } from '../ast.js';
import { flatRef, type FlatEquation } from '../flat.js';
import { printExpr } from '../parser/printer.js';
import { resolveRef } from './scope.js';
import { diag, error, fileOf, isParamLike, pathOf, type ClassInstance, type ConnectStatement, type Ctx, type Instance, type VariableInstance } from './types.js';

interface ConnectorRef {
  inst: Instance;
  /** True for the instance's own connectors (its ports), false for connectors of sub-components. */
  outside: boolean;
}

interface Leaf {
  rel: string;
  v: VariableInstance;
}

/** Expands the connections of the whole tree; returns the number of connect statements processed. */
export function expandConnections(ctx: Ctx, root: ClassInstance, out: FlatEquation[]): number {
  let count = 0;
  const visit = (inst: ClassInstance): void => {
    count += expandInstance(ctx, inst, out);
    for (const name of inst.order) {
      const c = inst.components.get(name);
      if (c && c.kind === 'class' && !c.isConnector) visit(c);
    }
  };
  visit(root);
  return count;
}

/** True when a reference path passes through a conditionally disabled component. */
function hitsDisabled(inst: ClassInstance, names: string[]): boolean {
  let cur: ClassInstance = inst;
  for (const name of names) {
    if (cur.disabled.has(name)) return true;
    const next = cur.components.get(name);
    if (!next || next.kind !== 'class') return false;
    cur = next;
  }
  return false;
}

function resolveConnector(ctx: Ctx, ref: Expr, c: ConnectStatement, inst: ClassInstance): ConnectorRef | undefined {
  const opts = { path: pathOf(c.scope), loc: ref.loc ?? c.loc, file: fileOf(ctx, c.scope.cls) };
  if (ref.kind !== 'ref') throw error(`connect expects component references, got ${printExpr(ref)}`, opts);
  const names = ref.parts.map((p) => p.name);
  if (hitsDisabled(inst, names)) return undefined;
  const r = resolveRef(ctx, ref, c.scope);
  if (r.kind !== 'instance') throw error(`connect expects component references, got ${printExpr(ref)}`, opts);
  const first = inst.components.get(names[0]);
  const outside = first !== undefined && (first.kind === 'variable' || first.isConnector);
  return { inst: r.inst, outside };
}

/** Leaf variables of a connector (nested connectors/records flattened with dotted relative names), excluding parameters/constants. */
function collectLeaves(inst: ClassInstance, prefix = '', out: Leaf[] = []): Leaf[] {
  for (const name of inst.order) {
    const c = inst.components.get(name);
    if (!c) continue;
    if (c.kind === 'variable') {
      if (!isParamLike(c)) out.push({ rel: prefix + name, v: c });
    } else {
      collectLeaves(c, `${prefix}${name}.`, out);
    }
  }
  return out;
}

function describe(r: ConnectorRef): string {
  return r.inst.kind === 'variable' ? `${r.inst.type} variable` : r.inst.cls.fullName;
}

function expandInstance(ctx: Ctx, inst: ClassInstance, out: FlatEquation[]): number {
  const parent = new Map<string, string>();
  const members = new Map<string, ConnectorRef & { inst: ClassInstance }>();
  const order: string[] = [];
  const connectedVars = new Set<string>();
  const connectedConnectors = new Set<string>();
  let count = 0;

  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    // path compression
    let c = x;
    while (parent.get(c) !== r) {
      const next = parent.get(c)!;
      parent.set(c, r);
      c = next;
    }
    return r;
  };
  const add = (m: ConnectorRef & { inst: ClassInstance }): void => {
    if (!members.has(m.inst.path)) {
      members.set(m.inst.path, m);
      parent.set(m.inst.path, m.inst.path);
      order.push(m.inst.path);
    }
  };

  for (const c of inst.connects) {
    const opts = { path: pathOf(c.scope), loc: c.loc, file: fileOf(ctx, c.scope.cls) };
    const ra = resolveConnector(ctx, c.a, c, inst);
    const rb = resolveConnector(ctx, c.b, c, inst);
    if (!ra || !rb) continue; // a conditionally disabled component: the connection is dropped
    count++;
    if (ra.inst.kind === 'variable' && rb.inst.kind === 'variable') {
      if (ra.inst.type !== rb.inst.type) {
        throw error(`Incompatible connectors: cannot connect '${ra.inst.path}' (${ra.inst.type}) with '${rb.inst.path}' (${rb.inst.type})`, opts);
      }
      if (isParamLike(ra.inst) || isParamLike(rb.inst)) {
        throw error(`Cannot connect parameters or constants: connect(${ra.inst.path}, ${rb.inst.path})`, opts);
      }
      out.push({
        kind: 'connect-potential',
        left: flatRef(ra.inst.path),
        right: flatRef(rb.inst.path),
        origin: `connect(${ra.inst.path}, ${rb.inst.path})`,
        loc: c.loc,
        file: opts.file,
      });
      connectedVars.add(ra.inst.path);
      connectedVars.add(rb.inst.path);
      continue;
    }
    if (ra.inst.kind === 'class' && rb.inst.kind === 'class' && ra.inst.isConnector && rb.inst.isConnector) {
      const ma = { ...ra, inst: ra.inst };
      const mb = { ...rb, inst: rb.inst };
      add(ma);
      add(mb);
      const rootA = find(ma.inst.path);
      const rootB = find(mb.inst.path);
      if (rootA !== rootB) parent.set(rootB, rootA);
      connectedConnectors.add(ma.inst.path);
      connectedConnectors.add(mb.inst.path);
      continue;
    }
    throw error(`Incompatible connectors: cannot connect '${ra.inst.path}' (${describe(ra)}) with '${rb.inst.path}' (${describe(rb)})`, opts);
  }

  // Connection sets in order of first appearance.
  const sets = new Map<string, string[]>();
  for (const path of order) {
    const r = find(path);
    const list = sets.get(r);
    if (list) list.push(path);
    else sets.set(r, [path]);
  }
  const file = fileOf(ctx, inst.cls);
  for (const paths of sets.values()) {
    const ms = paths.map((p) => members.get(p)!);
    const leaves = ms.map((m) => collectLeaves(m.inst));
    const first = leaves[0];
    const firstMap = new Map(first.map((l) => [l.rel, l]));
    for (let i = 1; i < ms.length; i++) {
      const map = new Map(leaves[i].map((l) => [l.rel, l]));
      const same =
        map.size === firstMap.size &&
        [...firstMap.values()].every((l) => {
          const o = map.get(l.rel);
          return o !== undefined && o.v.flow === l.v.flow && o.v.type === l.v.type;
        });
      if (!same) {
        const show = (ls: Leaf[]) => `{${ls.map((l) => `${l.v.flow ? 'flow ' : ''}${l.v.type} ${l.rel}`).join(', ')}}`;
        throw error(
          `Incompatible connectors: '${ms[0].inst.path}' (${ms[0].inst.cls.fullName}) has ${show(first)} but '${ms[i].inst.path}' (${ms[i].inst.cls.fullName}) has ${show(leaves[i])}`,
          { path: inst.path || inst.cls.fullName, file },
        );
      }
    }
    const allText = `connect(${ms.map((m) => m.inst.path).join(', ')})`;
    for (const leaf of first) {
      if (!leaf.v.flow) {
        for (let i = 1; i < ms.length; i++) {
          const other = leaves[i].find((l) => l.rel === leaf.rel)!;
          out.push({
            kind: 'connect-potential',
            left: flatRef(leaf.v.path),
            right: flatRef(other.v.path),
            origin: `connect(${ms[0].inst.path}, ${ms[i].inst.path})`,
            file,
          });
        }
      } else {
        let sum: Expr | undefined;
        for (let i = 0; i < ms.length; i++) {
          const term = flatRef(leaves[i].find((l) => l.rel === leaf.rel)!.v.path);
          if (sum === undefined) sum = ms[i].outside ? E.neg(term) : term;
          else sum = E.bin(ms[i].outside ? '-' : '+', sum, term);
        }
        out.push({ kind: 'connect-flow', left: sum!, right: E.num(0), origin: allText, file });
      }
    }
  }

  // Unconnected inside connectors (ports of sub-components) and inputs.
  for (const childName of inst.order) {
    const child = inst.components.get(childName);
    if (!child || child.kind !== 'class' || child.isConnector) continue;
    for (const portName of child.order) {
      const port = child.components.get(portName);
      if (!port) continue;
      if (port.kind === 'class' && port.isConnector) {
        if (connectedConnectors.has(port.path)) continue;
        for (const leaf of collectLeaves(port)) {
          if (leaf.v.flow) out.push({ kind: 'unconnected-flow', left: flatRef(leaf.v.path), right: E.num(0), origin: `${port.path} (unconnected)`, file });
        }
      } else if (port.kind === 'variable' && port.causality === 'input' && !connectedVars.has(port.path) && !port.binding) {
        diag(ctx, 'warning', `Input '${port.path}' is not connected`, { path: port.path, loc: port.decl.loc, file: fileOf(ctx, port.declaredIn) });
      }
    }
  }

  // The top-level class: its own unconnected ports.
  if (!inst.parent) {
    for (const name of inst.order) {
      const port = inst.components.get(name);
      if (!port) continue;
      if (port.kind === 'class' && port.isConnector) {
        if (connectedConnectors.has(port.path)) continue;
        for (const leaf of collectLeaves(port)) {
          if (leaf.v.flow) out.push({ kind: 'unconnected-flow', left: flatRef(leaf.v.path), right: E.num(0), origin: `${port.path} (unconnected)`, file });
        }
      } else if (port.kind === 'variable' && port.causality === 'input' && !isParamLike(port) && !connectedVars.has(port.path) && !port.binding) {
        const start = port.flat?.attributes.start;
        const value: Expr =
          typeof start === 'number' ? E.num(start) : typeof start === 'boolean' ? E.bool(start) : port.type === 'Boolean' ? E.bool(false) : E.num(0);
        out.push({ kind: 'binding', left: flatRef(port.path), right: value, origin: `${port.path} (unconnected top-level input)`, loc: port.decl.loc, file });
        diag(ctx, 'warning', `Top-level input '${port.path}' has no value; using ${printExpr(value)}`, { path: port.path, loc: port.decl.loc, file: fileOf(ctx, port.declaredIn) });
      }
    }
  }
  return count;
}
