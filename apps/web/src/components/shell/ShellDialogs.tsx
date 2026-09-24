/** Renders the dialog requested through the shell actions store. Mounted once in App.tsx. */
import type { JSX } from 'react';
import { useShellStore } from './shellActions';
import { AboutDialog } from './dialogs/AboutDialog';
import { ConfirmDialog } from './dialogs/ConfirmDialog';
import { DocsDialog, SupportDialog, TextDialog, WorkspaceManagementDialog } from './dialogs/InfoDialogs';
import { NewClassDialog } from './dialogs/NewClassDialog';
import { RenameDialog } from './dialogs/RenameDialog';
import { SettingsDialog } from './dialogs/SettingsDialog';
import { ShortcutsDialog } from './dialogs/ShortcutsDialog';

export function ShellDialogs() {
  const dialog = useShellStore((s) => s.dialog);
  const close = useShellStore((s) => s.actions.closeDialog);
  let content: JSX.Element | null = null;
  switch (dialog?.kind) {
    case 'newClass':
      content = <NewClassDialog key={dialog.parent ?? ''} parent={dialog.parent} onClose={close} />;
      break;
    case 'settings':
      content = <SettingsDialog tab={dialog.tab} onClose={close} />;
      break;
    case 'rename':
      content = <RenameDialog key={`${dialog.target.kind}:${dialog.target.name}`} target={dialog.target} onClose={close} />;
      break;
    case 'shortcuts':
      content = <ShortcutsDialog onClose={close} />;
      break;
    case 'about':
      content = <AboutDialog onClose={close} />;
      break;
    case 'docs':
      content = <DocsDialog onClose={close} />;
      break;
    case 'support':
      content = <SupportDialog onClose={close} />;
      break;
    case 'workspaceManagement':
      content = <WorkspaceManagementDialog onClose={close} />;
      break;
    case 'text':
      content = <TextDialog title={dialog.title} text={dialog.text} onClose={close} />;
      break;
    default:
      content = null;
  }
  return (
    <>
      {content}
      <ConfirmDialog />
    </>
  );
}

export default ShellDialogs;
