/**
 * Context-menu actions of the tree (New class, Show Documentation, Extend, Duplicate, Rename,
 * Copy class path, Delete) wired to the store and the shell's dialogs.
 */
import { useCallback, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import type { ClassTreeNode } from '@impact/core';
import { useContextMenu } from '../common/ContextMenu';
import type { MenuItem } from '../common/ContextMenu';
import { useShellActions } from '../shell/shellActions';
import { Icon } from '../icons';
import { useStore } from '../../store';
import type { AppState } from '../../store/types';
import { NameDialog } from './NameDialog';
import { duplicateClassText, replaceClassInFile } from './duplicate';
import { createRestriction, defaultLocation, editableLocations, shortNameOf, uniqueClassName } from './treeModel';
import type { LocationOption } from './treeModel';

type DialogKind = 'duplicate' | 'extend';

interface NameDialogState {
  kind: DialogKind;
  source: ClassTreeNode;
  locations: LocationOption[];
  initialLocation: string;
  initialName: string;
  busy: boolean;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    /* fall back below */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  } catch {
    /* ignore */
  }
}

/** `model New extends Source; end New;` in an editable location. */
async function extendClass(state: AppState, source: ClassTreeNode, fullName: string): Promise<void> {
  const cls = state.registry.get(source.name);
  const restriction = createRestriction(cls?.def.restriction ?? source.restriction);
  await state.createClass({ className: fullName, restriction, extendsClass: source.name });
}

/** Creates a stub through the server, then replaces it with the (renamed) source text of the original. */
async function duplicateClass(state: AppState, source: ClassTreeNode, fullName: string): Promise<void> {
  const cls = state.registry.get(source.name);
  if (!cls || cls.builtin) throw new Error(`Unknown class ${source.name}`);
  const copyText = duplicateClassText(cls.def, state.getClassText(source.name), shortNameOf(fullName));
  await state.createClass({ className: fullName, restriction: createRestriction(cls.def.restriction), description: cls.def.description });
  const after = useStore.getState();
  const created = after.registry.get(fullName);
  const fileText = after.getClassText(fullName);
  if (!created || fileText === undefined) return;
  const newFileText = replaceClassInFile(fileText, created.def, copyText);
  if (newFileText === undefined) return;
  const res = await after.saveClassSource(fullName, newFileText);
  if (!res.ok) throw new Error(res.diagnostics[0]?.message ?? 'The copied class text could not be saved');
}

export interface ClassActions {
  /** Opens the context menu for `node`. */
  openMenu(e: MouseEvent, node: ClassTreeNode, isProjectRoot: boolean): void;
  /** Dialog element to render (Duplicate / Extend name prompt), or null. */
  dialog: ReactNode;
}

export function useClassActions(opts: { onConfigureWorkspace(): void }): ClassActions {
  const shell = useShellActions();
  const menu = useContextMenu();
  const [dialog, setDialog] = useState<NameDialogState | null>(null);

  const startNameDialog = useCallback((kind: DialogKind, source: ClassTreeNode) => {
    const s = useStore.getState();
    const locations = editableLocations(s.registry);
    const initialLocation = defaultLocation(s.registry, source.name, locations);
    const base = kind === 'duplicate' ? `${source.shortName}Copy` : `My${source.shortName}`;
    setDialog({ kind, source, locations, initialLocation, initialName: uniqueClassName(s.registry, initialLocation, base), busy: false });
  }, []);

  const runDelete = useCallback(
    async (node: ClassTreeNode) => {
      const ok = await shell.confirm({
        title: 'Delete permanently?',
        message: `${node.name} will be deleted permanently. This cannot be undone.`,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return;
      try {
        await useStore.getState().deleteClass(node.name);
      } catch (e) {
        useStore.getState().pushBanner({ severity: 'error', message: `Could not delete ${node.name}: ${messageOf(e)}` });
      }
    },
    [shell],
  );

  const confirmDialog = useCallback(
    async (name: string, location: string) => {
      if (!dialog) return;
      const fullName = location ? `${location}.${name}` : name;
      setDialog((d) => (d ? { ...d, busy: true } : d));
      const s = useStore.getState();
      try {
        if (dialog.kind === 'extend') await extendClass(s, dialog.source, fullName);
        else await duplicateClass(s, dialog.source, fullName);
        setDialog(null);
        useStore.getState().openClass(fullName);
      } catch (e) {
        setDialog(null);
        s.pushBanner({ severity: 'error', message: `Could not ${dialog.kind === 'extend' ? 'extend' : 'duplicate'} ${dialog.source.name}: ${messageOf(e)}` });
      }
    },
    [dialog],
  );

  const openMenu = useCallback(
    (e: MouseEvent, node: ClassTreeNode, isProjectRoot: boolean) => {
      e.preventDefault();
      const s = useStore.getState();
      const editable = !node.readOnly;
      const canCreate = s.registry.listLibraries().some((l) => !l.readOnly);
      const docs: MenuItem = { label: 'Show Documentation', icon: <Icon.Description />, onSelect: () => shell.showDocumentation(node.name) };
      const copyPath: MenuItem = { label: 'Copy class path', onSelect: () => void copyText(node.name) };
      const extend: MenuItem = { label: 'Extend…', onSelect: () => startNameDialog('extend', node), disabled: !canCreate };
      const remove: MenuItem = { label: 'Delete permanently', danger: true, disabled: !editable, onSelect: () => void runDelete(node) };
      const separator: MenuItem = { label: '', separator: true };
      let items: MenuItem[];
      if (isProjectRoot) {
        items = [
          { label: 'New class…', icon: <Icon.Add />, onSelect: () => shell.openNewClassDialog(node.name), disabled: !editable },
          { label: 'Configure workspace', icon: <Icon.Settings />, onSelect: opts.onConfigureWorkspace },
          separator,
          docs,
          copyPath,
        ];
      } else if (node.restriction === 'package') {
        items = [
          { label: 'New class…', icon: <Icon.Add />, onSelect: () => shell.openNewClassDialog(node.name), disabled: !editable },
          docs,
          { label: 'Duplicate to…', onSelect: () => startNameDialog('duplicate', node), disabled: !editable || !canCreate },
          extend,
          separator,
          copyPath,
          remove,
        ];
      } else {
        items = [
          { label: 'Open', onSelect: () => useStore.getState().openClass(node.name) },
          docs,
          extend,
          { label: 'Duplicate to…', onSelect: () => startNameDialog('duplicate', node), disabled: !canCreate },
          { label: 'Rename…', onSelect: () => shell.openRename({ kind: 'class', name: node.name }), disabled: !editable },
          separator,
          copyPath,
          remove,
        ];
      }
      menu.open(e, items);
    },
    [menu, shell, opts.onConfigureWorkspace, startNameDialog, runDelete],
  );

  const dialogNode: ReactNode = dialog ? (
    <NameDialog
      key={`${dialog.kind}:${dialog.source.name}`}
      title={dialog.kind === 'duplicate' ? 'Duplicate to…' : 'Extend…'}
      message={dialog.kind === 'duplicate' ? `Create a copy of ${dialog.source.name}` : `Create a new class extending ${dialog.source.name}`}
      confirmLabel={dialog.kind === 'duplicate' ? 'Duplicate' : 'Create'}
      initialName={dialog.initialName}
      locations={dialog.locations}
      initialLocation={dialog.initialLocation}
      validate={(fullName) => (useStore.getState().registry.has(fullName) ? `${fullName} already exists` : undefined)}
      onConfirm={(name, location) => void confirmDialog(name, location)}
      onClose={() => setDialog(null)}
      busy={dialog.busy}
    />
  ) : null;

  return { openMenu, dialog: dialogNode };
}
