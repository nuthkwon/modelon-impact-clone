/**
 * Shell actions: a tiny zustand store that other modules use to open the shell's dialogs
 * (New class, Settings, Rename, Confirm, Shortcuts, About, Documentation) and to jump into the
 * Code view. The dialogs themselves are rendered by `<ShellDialogs/>` (mounted in App.tsx).
 *
 *   const shell = useShellActions();
 *   shell.openNewClassDialog('Examples');          // parent package preselected
 *   if (await shell.confirm({ title: 'Delete permanently?', message: '…', danger: true })) …
 *   shell.openCodeAtLine(12);                       // switches to the Code view, selects line 12
 *
 * `shellActions` gives the same API outside React (e.g. from store code or event handlers).
 */
import type { WorkspaceManagementTab } from '../workspace-management/WorkspaceManagementDialog';
import { create } from 'zustand';
import { useStore } from '../../store';

export type RenameTarget = { kind: 'class' | 'component'; name: string };

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

export type SettingsTab = 'Application' | 'Execution' | 'Export' | 'Units' | 'Workspace';

export type ShellDialog =
  | { kind: 'newClass'; parent?: string }
  | { kind: 'settings'; tab: SettingsTab }
  | { kind: 'rename'; target: RenameTarget }
  | { kind: 'shortcuts' }
  | { kind: 'about' }
  | { kind: 'docs' }
  | { kind: 'support' }
  | { kind: 'workspaceManagement'; tab?: WorkspaceManagementTab }
  | { kind: 'text'; title: string; text: string };

export interface ShellActions {
  /** Opens the *New class* dialog, optionally preselecting the parent package (`Examples` or `Examples.Sub`). */
  openNewClassDialog(parent?: string): void;
  /** Opens *Application settings* on the given tab ('Application' | 'Execution' | 'Export' | 'Units' | 'Workspace'). */
  openSettings(tab?: string): void;
  /** Opens the *Rename* dialog for a class (fully-qualified name) or a component of the active class. */
  openRename(target: RenameTarget): void;
  /** Shows a confirmation dialog; resolves true when confirmed. */
  confirm(opts: ConfirmOptions): Promise<boolean>;
  /** Shows the INFORMATION tab for `className` (opens the class when it is neither the active class nor a selected component's class). */
  showDocumentation(className: string): void;
  openShortcuts(): void;
  openAbout(): void;
  /** Help → Documentation. */
  openDocs(): void;
  /** Help → Support. */
  openSupport(): void;
  /** Workspace Management (Apps menu, or the "Configure workspace" cogwheel): configuration and installed libraries. */
  openWorkspaceManagement(tab?: WorkspaceManagementTab): void;
  /** Generic read-only text dialog. */
  openText(title: string, text: string): void;
  /** Switches to the Code view and selects/scrolls to `line` (1-based). */
  openCodeAtLine(line: number): void;
  closeDialog(): void;
}

interface ConfirmRequest {
  opts: ConfirmOptions;
  resolve: (ok: boolean) => void;
}

export interface ShellState {
  dialog?: ShellDialog;
  confirmRequest?: ConfirmRequest;
  /** Pending Code-view navigation; `seq` changes on every request so repeats re-trigger. */
  codeTarget?: { line: number; seq: number };
  actions: ShellActions;
  /** Resolves the pending confirm request (used by the Confirm dialog). */
  resolveConfirm(ok: boolean): void;
  clearCodeTarget(seq: number): void;
}

const SETTINGS_TABS: SettingsTab[] = ['Application', 'Execution', 'Export', 'Units', 'Workspace'];

let codeSeq = 0;

export const useShellStore = create<ShellState>()((set, get) => {
  const actions: ShellActions = {
    openNewClassDialog(parent) {
      set({ dialog: { kind: 'newClass', parent } });
    },
    openSettings(tab) {
      const t = SETTINGS_TABS.find((x) => x.toLowerCase() === (tab ?? 'Application').toLowerCase()) ?? 'Application';
      set({ dialog: { kind: 'settings', tab: t } });
    },
    openRename(target) {
      set({ dialog: { kind: 'rename', target } });
    },
    confirm(opts) {
      // Resolve a previous pending request as cancelled.
      get().confirmRequest?.resolve(false);
      return new Promise<boolean>((resolve) => {
        set({ confirmRequest: { opts, resolve } });
      });
    },
    showDocumentation(className) {
      const app = useStore.getState();
      const isActive = app.activeClass === className;
      const selectedClass = app.diagram?.components.find((c) => app.selection.length === 1 && c.name === app.selection[0])?.className;
      if (!isActive && selectedClass !== className) {
        if (!app.registry.has(className)) {
          app.pushBanner({ severity: 'warning', message: `Class ${className} was not found.` });
          return;
        }
        app.openClass(className);
      }
      if (app.mode !== 'model') app.setMode('model');
      useStore.getState().setDetailsTab('INFORMATION');
    },
    openShortcuts() {
      set({ dialog: { kind: 'shortcuts' } });
    },
    openAbout() {
      set({ dialog: { kind: 'about' } });
    },
    openDocs() {
      set({ dialog: { kind: 'docs' } });
    },
    openSupport() {
      set({ dialog: { kind: 'support' } });
    },
    openWorkspaceManagement(tab) {
      set({ dialog: { kind: 'workspaceManagement', ...(tab ? { tab } : {}) } });
    },
    openText(title, text) {
      set({ dialog: { kind: 'text', title, text } });
    },
    openCodeAtLine(line) {
      const app = useStore.getState();
      if (!app.activeClass) return;
      if (app.view !== 'code') app.setView('code');
      set({ codeTarget: { line: Math.max(1, Math.floor(line)), seq: ++codeSeq } });
    },
    closeDialog() {
      set({ dialog: undefined });
    },
  };
  return {
    dialog: undefined,
    confirmRequest: undefined,
    codeTarget: undefined,
    actions,
    resolveConfirm(ok) {
      const req = get().confirmRequest;
      set({ confirmRequest: undefined });
      req?.resolve(ok);
    },
    clearCodeTarget(seq) {
      if (get().codeTarget?.seq === seq) set({ codeTarget: undefined });
    },
  };
});

/** Stable actions object for opening shell dialogs from any module. */
export function useShellActions(): ShellActions {
  return useShellStore((s) => s.actions);
}

/** Imperative access (outside React). */
export const shellActions: ShellActions = useShellStore.getState().actions;

export const APP_NAME = 'Impact Clone';
export const APP_VERSION = '0.1.0';
