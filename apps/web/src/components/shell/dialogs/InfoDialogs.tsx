/** Small informational dialogs: Documentation, Support, generic text, Workspace Management. */
import { useStore } from '../../../store';
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

export function WorkspaceManagementDialog({ onClose }: { onClose: () => void }) {
  const workspace = useStore((s) => s.workspace);
  const projects = useStore((s) => s.projects);
  const dependencies = useStore((s) => s.dependencies);
  return (
    <Dialog open title="Workspace Management" onClose={onClose} width={560} actions={closeAction(onClose)}>
      {!workspace ? (
        <p className="settings-note">Open a workspace to see its projects and dependencies.</p>
      ) : (
        <>
          <p className="settings-note">
            Workspace <strong>{workspace.definition.name}</strong> ({workspace.id}). Projects are editable; dependencies are read-only libraries. Configuration is read-only in this clone.
          </p>
          <div className="section-title" style={{ padding: '4px 0' }}>Projects</div>
          <div className="mgmt-list">
            {projects.length === 0 && <div className="settings-note">No projects.</div>}
            {projects.map((p) => (
              <div key={p.id} className="mgmt-project">
                <div className="mgmt-name">
                  {p.definition.name} <span className="mgmt-badge">{p.projectType}</span>
                </div>
                <div className="mgmt-meta">{p.id}</div>
                <ul>
                  {p.definition.content.map((c) => (
                    <li key={c.id}>
                      {c.name} <span className="mgmt-meta">({c.contentType.toLowerCase()}, {c.relpath}{c.readOnly ? ', read-only' : ''})</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
          <div className="section-title" style={{ padding: '12px 0 4px' }}>Dependencies</div>
          <div className="mgmt-list">
            {dependencies.length === 0 && <div className="settings-note">No dependencies.</div>}
            {dependencies.map((p) => (
              <div key={p.id} className="mgmt-project">
                <div className="mgmt-name">
                  {p.definition.name} <span className="mgmt-badge">{p.projectType}</span>
                </div>
                <ul>
                  {p.definition.content.map((c) => (
                    <li key={c.id}>
                      {c.name} <span className="mgmt-meta">({c.relpath})</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </>
      )}
    </Dialog>
  );
}
