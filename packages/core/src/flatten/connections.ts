/**
 * Connection expansion. For every class instance the `connect` statements written in its
 * class (and bases) are grouped into connection sets with a union-find over the *primitive*
 * connector variables (Modelica §9.1: hierarchical connectors are expanded first, so a
 * connector connected as a whole and through one of its sub-connectors ends up in the same
 * set). Per set, potential variables get `n-1` equalities and each flow variable one sum
 * equation `Σ(+inside) + Σ(−outside) = 0`. Causal (scalar input/output) connectors give `a = b`.
 *
 * Flow variables of inside connectors (ports of sub-components) that no connect touches are
 * set to zero. The model's own (outside) connectors are closed by the environment (§4.7): every
 * top-level flow variable gets `flow = 0` and every top-level input without a binding is bound
 * to its start value, whether or not they are also connected internally.
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

/** A primitive connector variable that takes part in a connection set. */
interface LeafMember {
  v: VariableInstance;
  outside: boolean;
  /** Path of the connector operand (as written in the first connect that reached this leaf). */
  via: string;
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

/** Checks that two connectors have the same primitive variables (names, types, flow prefixes). */
function checkCompatible(a: ConnectorRef & { inst: ClassInstance }, b: ConnectorRef & { inst: ClassInstance }, leavesA: Leaf[], leavesB: Leaf[], opts: { path: string; loc?: Expr['loc']; file?: string }): void {
  const mapB = new Map(leavesB.map((l) => [l.rel, l]));
  const same =
    leavesA.length === leavesB.length &&
    leavesA.every((l) => {
      const o = mapB.get(l.rel);
      return o !== undefined && o.v.flow === l.v.flow && o.v.type === l.v.type;
    });
  if (same) return;
  const show = (ls: Leaf[]) => `{${ls.map((l) => `${l.v.flow ? 'flow ' : ''}${l.v.type} ${l.rel}`).join(', ')}}`;
  throw error(`Incompatible connectors: '${a.inst.path}' (${a.inst.cls.fullName}) has ${show(leavesA)} but '${b.inst.path}' (${b.inst.cls.fullName}) has ${show(leavesB)}`, opts);
}

/** The innermost connector a primitive variable belongs to (for diagnostics / origins). */
function connectorOf(v: VariableInstance): string {
  return v.parent.path || v.path;
}

function expandInstance(ctx: Ctx, inst: ClassInstance, out: FlatEquation[]): number {
  // Union-find over primitive connector variables (flat paths).
  const parent = new Map<string, string>();
  const members = new Map<string, LeafMember>();
  const order: string[] = [];
  /** Every primitive connector variable touched by a connect of this instance (scalar connectors included). */
  const connectedLeaves = new Set<string>();
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
  const add = (v: VariableInstance, outside: boolean, via: string): void => {
    connectedLeaves.add(v.path);
    if (!members.has(v.path)) {
      members.set(v.path, { v, outside, via });
      parent.set(v.path, v.path);
      order.push(v.path);
    }
  };
  const union = (a: string, b: string): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
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
      connectedLeaves.add(ra.inst.path);
      connectedLeaves.add(rb.inst.path);
      continue;
    }
    if (ra.inst.kind === 'class' && rb.inst.kind === 'class' && ra.inst.isConnector && rb.inst.isConnector) {
      const ma = { ...ra, inst: ra.inst };
      const mb = { ...rb, inst: rb.inst };
      const leavesA = collectLeaves(ma.inst);
      const leavesB = collectLeaves(mb.inst);
      checkCompatible(ma, mb, leavesA, leavesB, opts);
      const mapB = new Map(leavesB.map((l) => [l.rel, l]));
      for (const la of leavesA) {
        const lb = mapB.get(la.rel)!;
        add(la.v, ma.outside, ma.inst.path);
        add(lb.v, mb.outside, mb.inst.path);
        union(la.v.path, lb.v.path);
      }
      continue;
    }
    throw error(`Incompatible connectors: cannot connect '${ra.inst.path}' (${describe(ra)}) with '${rb.inst.path}' (${describe(rb)})`, opts);
  }

  // Connection sets (of primitive variables) in order of first appearance.
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
    const vias: string[] = [];
    for (const m of ms) if (!vias.includes(m.via)) vias.push(m.via);
    if (!ms[0].v.flow) {
      for (let i = 1; i < ms.length; i++) {
        out.push({
          kind: 'connect-potential',
          left: flatRef(ms[0].v.path),
          right: flatRef(ms[i].v.path),
          origin: `connect(${ms[0].via}, ${ms[i].via})`,
          file,
        });
      }
    } else {
      let sum: Expr | undefined;
      for (const m of ms) {
        const term = flatRef(m.v.path);
        if (sum === undefined) sum = m.outside ? E.neg(term) : term;
        else sum = E.bin(m.outside ? '-' : '+', sum, term);
      }
      out.push({ kind: 'connect-flow', left: sum!, right: E.num(0), origin: `connect(${vias.join(', ')})`, file });
    }
  }

  // Inside connectors (ports of sub-components): flow variables no connect touches are zero,
  // unconnected inputs get a warning. Decided per primitive variable, so a hierarchical
  // connector connected through some of its sub-connectors only zeroes the others.
  for (const childName of inst.order) {
    const child = inst.components.get(childName);
    if (!child || child.kind !== 'class' || child.isConnector) continue;
    for (const portName of child.order) {
      const port = child.components.get(portName);
      if (!port) continue;
      if (port.kind === 'class' && port.isConnector) {
        for (const leaf of collectLeaves(port)) {
          if (leaf.v.flow && !connectedLeaves.has(leaf.v.path)) {
            out.push({ kind: 'unconnected-flow', left: flatRef(leaf.v.path), right: E.num(0), origin: `${connectorOf(leaf.v)} (unconnected)`, file });
          }
        }
      } else if (port.kind === 'variable' && port.causality === 'input' && !connectedLeaves.has(port.path) && !port.binding) {
        diag(ctx, 'warning', `Input '${port.path}' is not connected`, { path: port.path, loc: port.decl.loc, file: fileOf(ctx, port.declaredIn) });
      }
    }
  }

  // The top-level class: the environment supplies one equation per flow variable of its own
  // connectors (`flow = 0`, nothing is connected from outside) and one per input without a
  // binding (its start value), independently of any internal connection (Modelica §4.7).
  if (!inst.parent) {
    for (const name of inst.order) {
      const port = inst.components.get(name);
      if (!port) continue;
      if (port.kind === 'class' && port.isConnector) {
        for (const leaf of collectLeaves(port)) {
          if (!leaf.v.flow) continue;
          const connected = connectedLeaves.has(leaf.v.path);
          out.push({
            kind: 'unconnected-flow',
            left: flatRef(leaf.v.path),
            right: E.num(0),
            origin: `${connectorOf(leaf.v)} (${connected ? 'top-level connector, flow set by the environment' : 'unconnected'})`,
            file,
          });
        }
      } else if (port.kind === 'variable' && port.causality === 'input' && !isParamLike(port) && !port.binding) {
        const start = port.flat?.attributes.start;
        const value: Expr =
          typeof start === 'number' ? E.num(start) : typeof start === 'boolean' ? E.bool(start) : port.type === 'Boolean' ? E.bool(false) : E.num(0);
        const connected = connectedLeaves.has(port.path);
        out.push({
          kind: 'binding',
          left: flatRef(port.path),
          right: value,
          origin: `${port.path} (${connected ? 'top-level input, value set by the environment' : 'unconnected top-level input'})`,
          loc: port.decl.loc,
          file,
        });
        diag(ctx, 'warning', `Top-level input '${port.path}' has no value; using ${printExpr(value)}`, { path: port.path, loc: port.decl.loc, file: fileOf(ctx, port.declaredIn) });
      }
    }
  }
  return count;
}
