/** Small informational dialogs: Documentation, Support, generic text. */
import { Dialog } from '../../common/Dialog';
import '../shell.css';

const closeAction = (onClose: () => void) => (
  <button type="button" className="contained-button" onClick={onClose}>
    Close
  </button>
);

export function DocsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open title="Documentation" onClose={onClose} width={520} className="docs-dialog" actions={closeAction(onClose)}>
      <p>The documentation of this clone lives in the repository:</p>
      <ul>
        <li>
          <code>docs/UI_SPEC.md</code> — the user interface: pages, panels, canvas interactions, dialogs, colours and keyboard shortcuts.
        </li>
        <li>
          <code>docs/ARCHITECTURE.md</code> — the architecture: packages, the <code>@impact/core</code> module map (parser → registry → flatten → solver; graphics → diagram → editor), the supported Modelica subset, name lookup, flattening, simulation, text as source of truth, the server data layout and the REST protocol.
        </li>
        <li>
          <code>libraries/Modelica/LICENSE.md</code> — license of the shipped Modelica Standard Library subset.
        </li>
      </ul>
      <p>The behaviour and terminology follow the Modelon Impact help center; quoted labels in the UI are verbatim from that documentation.</p>
    </Dialog>
  );
}

export function SupportDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open title="Support" onClose={onClose} size="compact" className="text-dialog" actions={closeAction(onClose)}>
      <p>This is an independent open-source clone without a support organisation.</p>
      <p>
        Report problems or ideas through the issue tracker of the repository you obtained this application from, including the workspace, the class name and, for simulation problems, the compilation and simulation logs (Log Viewer → <em>Download</em>).
      </p>
    </Dialog>
  );
}

export function TextDialog({ title, text, onClose }: { title: string; text: string; onClose: () => void }) {
  return (
    <Dialog open title={title} onClose={onClose} width={520} className="text-dialog" actions={closeAction(onClose)}>
      <pre>{text}</pre>
    </Dialog>
  );
}
