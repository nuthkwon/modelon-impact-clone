/** Confirmation dialog driven by `useShellActions().confirm()`. Mounted once by ShellDialogs. */
import { Dialog } from '../../common/Dialog';
import { useShellStore } from '../shellActions';

export function ConfirmDialog() {
  const request = useShellStore((s) => s.confirmRequest);
  const resolve = useShellStore((s) => s.resolveConfirm);
  if (!request) return null;
  const { opts } = request;
  return (
    <Dialog
      open
      title={opts.title}
      onClose={() => resolve(false)}
      onSubmit={() => resolve(true)}
      size="compact"
      zIndex={950}
      actions={
        <>
          <button type="button" className="outlined-button" onClick={() => resolve(false)}>
            {opts.cancelLabel ?? 'Cancel'}
          </button>
          <button type="button" className={`contained-button${opts.danger ? ' danger' : ''}`} data-autofocus onClick={() => resolve(true)}>
            {opts.confirmLabel ?? 'OK'}
          </button>
        </>
      }
    >
      <p className="dialog-message">{opts.message}</p>
    </Dialog>
  );
}

export default ConfirmDialog;
