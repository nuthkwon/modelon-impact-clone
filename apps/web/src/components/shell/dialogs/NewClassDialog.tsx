/** New class dialog (§7): Name, Type, Location (package tree over editable projects), Extends, Description. */
import { useEffect, useId, useMemo, useState } from 'react';
import type { JSX } from 'react';
import type { CreateClassRequest } from '@impact/protocol';
import type { ClassRegistry, RegisteredClass } from '@impact/core';
import { useStore } from '../../../store';
import { Dialog } from '../../common/Dialog';
import { ChevronRightIcon, ExpandMoreIcon, FolderIcon, LibraryBooksIcon } from '../../icons';
import { IDENTIFIER_RE } from '../renameClass';
import '../shell.css';

type Restriction = CreateClassRequest['restriction'];

const TYPES: { value: Restriction; label: string }[] = [
  { value: 'model', label: 'Model' },
  { value: 'block', label: 'Block' },
  { value: 'connector', label: 'Connector' },
  { value: 'record', label: 'Record' },
  { value: 'function', label: 'Function' },
  { value: 'package', label: 'Package' },
  { value: 'type', label: 'Type' },
];

interface LocNode {
  key: string;
  label: string;
  kind: 'library' | 'package';
  libraryId: string;
  className?: string;
  children: LocNode[];
}

function buildLocationTree(registry: ClassRegistry): LocNode[] {
  const pkgNode = (c: RegisteredClass): LocNode => ({
    key: c.fullName,
    label: c.def.name,
    kind: 'package',
    libraryId: c.libraryId,
    className: c.fullName,
    children: registry
      .children(c.fullName)
      .filter((ch) => ch.def.restriction === 'package' && !ch.def.shortClass)
      .map(pkgNode),
  });
  return registry
    .listLibraries()
    .filter((l) => !l.readOnly)
    .map((lib) => ({
      key: `lib:${lib.id}`,
      label: lib.name,
      kind: 'library' as const,
      libraryId: lib.id,
      children: registry
        .children()
        .filter((c) => c.libraryId === lib.id && c.def.restriction === 'package' && !c.def.shortClass)
        .map(pkgNode),
    }));
}

function findNode(nodes: LocNode[], key: string): LocNode | undefined {
  for (const n of nodes) {
    if (n.key === key) return n;
    const hit = findNode(n.children, key);
    if (hit) return hit;
  }
  return undefined;
}

function ancestorsOf(nodes: LocNode[], key: string, trail: string[] = []): string[] | undefined {
  for (const n of nodes) {
    if (n.key === key) return trail;
    const hit = ancestorsOf(n.children, key, [...trail, n.key]);
    if (hit) return hit;
  }
  return undefined;
}

export function NewClassDialog({ parent, onClose }: { parent?: string; onClose: () => void }) {
  const registryVersion = useStore((s) => s.registryVersion);
  const tree = useMemo(() => {
    void registryVersion;
    return buildLocationTree(useStore.getState().registry);
  }, [registryVersion]);

  const defaultKey = useMemo(() => {
    if (parent && findNode(tree, parent)) return parent;
    const firstLib = tree[0];
    return firstLib?.children[0]?.key ?? firstLib?.key ?? '';
  }, [tree, parent]);

  const [name, setName] = useState('');
  const [type, setType] = useState<Restriction>('model');
  const [location, setLocation] = useState(defaultKey);
  const [extendsClass, setExtendsClass] = useState('');
  const [description, setDescription] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([...tree.map((t) => t.key), ...(ancestorsOf(tree, defaultKey) ?? [])]));
  const [error, setError] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const listId = useId();

  useEffect(() => {
    if (!findNode(tree, location)) setLocation(defaultKey);
  }, [tree, location, defaultKey]);

  const target = findNode(tree, location);
  const fullName = target ? (target.className ? `${target.className}.${name}` : name) : name;
  const registry = useStore.getState().registry;
  const extendsOptions = useMemo(() => {
    const q = extendsClass.trim().toLowerCase();
    const all = registry.allClassNames();
    const list = q ? all.filter((n) => n.toLowerCase().includes(q)) : all;
    return list.slice(0, 150);
  }, [extendsClass, registry, registryVersion]);

  const validate = (): string | undefined => {
    if (!name.trim()) return 'Enter a name.';
    if (!IDENTIFIER_RE.test(name.trim())) return 'The name must be a Modelica identifier (letters, digits, underscore; not starting with a digit).';
    if (!target) return 'Select a location.';
    if (registry.has(fullName)) return `${fullName} already exists.`;
    if (extendsClass.trim() && !registry.has(extendsClass.trim())) return `Class ${extendsClass.trim()} was not found.`;
    return undefined;
  };

  const submit = async () => {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const s = useStore.getState();
      const created = await s.createClass({
        className: fullName,
        restriction: type,
        description: description.trim() || undefined,
        extendsClass: extendsClass.trim() || undefined,
        libraryId: target!.libraryId,
      });
      onClose();
      const after = useStore.getState();
      if (after.registry.has(created)) {
        after.openClass(created);
        after.setMode('model');
        if (type === 'function' || type === 'type') after.setView('code');
        else if (after.view === 'code') after.setView('diagram');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const renderNode = (node: LocNode, depth: number): JSX.Element => {
    const open = expanded.has(node.key);
    const hasChildren = node.children.length > 0;
    return (
      <div key={node.key} role="treeitem" aria-expanded={hasChildren ? open : undefined} aria-selected={location === node.key}>
        <button type="button" className={`tree-row${location === node.key ? ' selected' : ''}`} style={{ paddingLeft: 4 + depth * 16 }} onClick={() => setLocation(node.key)} onDoubleClick={() => hasChildren && toggle(node.key)}>
          <span
            className="tree-chevron"
            onClick={(e) => {
              e.stopPropagation();
              if (hasChildren) toggle(node.key);
            }}
          >
            {hasChildren ? open ? <ExpandMoreIcon size={16} /> : <ChevronRightIcon size={16} /> : null}
          </span>
          <span className="tree-icon">{node.kind === 'library' ? <LibraryBooksIcon size={16} /> : <FolderIcon size={16} />}</span>
          <span className="tree-name">{node.label}</span>
          {node.kind === 'library' && <span className="tree-sub">project</span>}
        </button>
        {open && hasChildren && <div role="group">{node.children.map((c) => renderNode(c, depth + 1))}</div>}
      </div>
    );
  };

  return (
    <Dialog
      open
      title="New class"
      onClose={onClose}
      onSubmit={() => void submit()}
      width={520}
      actions={
        <>
          <button type="button" className="text-button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className="contained-button" onClick={() => void submit()} disabled={busy || !name.trim()}>
            {busy ? 'Creating…' : 'Create'}
          </button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-row">
          <label htmlFor="newclass-name">Name</label>
          <input id="newclass-name" className="text-field" value={name} onChange={(e) => setName(e.target.value)} placeholder="MyModel" autoComplete="off" spellCheck={false} />
        </div>
        <div className="form-row">
          <label htmlFor="newclass-type">Type</label>
          <select id="newclass-type" className="text-field" value={type} onChange={(e) => setType(e.target.value as Restriction)}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-row">
        <span className="form-label">Location</span>
        <div className="location-tree" role="tree">
          {tree.length ? tree.map((n) => renderNode(n, 0)) : <div className="location-empty">No editable project in this workspace.</div>}
        </div>
        {name.trim() && target && <span className="new-class-preview">{fullName}</span>}
      </div>
      <div className="form-row">
        <label htmlFor="newclass-extends">Extends (optional)</label>
        <input id="newclass-extends" className="text-field" list={listId} value={extendsClass} onChange={(e) => setExtendsClass(e.target.value)} placeholder="Modelica.Electrical.Analog.Interfaces.OnePort" autoComplete="off" spellCheck={false} />
        <datalist id={listId}>
          {extendsOptions.map((n) => (
            <option key={n} value={n} />
          ))}
        </datalist>
      </div>
      <div className="form-row">
        <label htmlFor="newclass-description">Description</label>
        <input id="newclass-description" className="text-field" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description" />
      </div>
      {error && <div className="form-error">{error}</div>}
    </Dialog>
  );
}

export default NewClassDialog;
