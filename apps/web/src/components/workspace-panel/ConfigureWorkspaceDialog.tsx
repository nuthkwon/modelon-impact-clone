/**
 * "Configure workspace" dialog: read-only listing of the workspace's projects and dependencies.
 */
import type { Project } from '@impact/protocol';
import { Dialog } from '../common/Dialog';
import { useStore } from '../../store';

function ProjectList({ items, emptyText }: { items: Project[]; emptyText: string }) {
  if (!items.length) return <div className="wp-config-empty">{emptyText}</div>;
  return (
    <ul className="wp-config-list">
      {items.map((p) => (
        <li key={p.id} className="wp-config-item">
          <div className="wp-config-head">
            <span className="wp-config-name">{p.definition.name}</span>
            <span className="wp-config-type">{p.projectType}</span>
          </div>
          <div className="wp-config-meta" title={p.id}>
            {p.id}
          </div>
          {p.definition.content.length > 0 && (
            <ul className="wp-config-contents">
              {p.definition.content.map((c) => (
                <li key={c.id}>
                  <span className="wp-config-content-name">{c.name || c.relpath}</span>
                  <span className="wp-config-content-type">{c.contentType}</span>
                  {c.readOnly && <span className="wp-config-content-type">read-only</span>}
                  {c.defaultDisabled && <span className="wp-config-content-type">disabled</span>}
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

export function ConfigureWorkspaceDialog({ open, onClose }: { open: boolean; onClose(): void }) {
  const workspace = useStore((s) => s.workspace);
  const projects = useStore((s) => s.projects);
  const dependencies = useStore((s) => s.dependencies);
  if (!open) return null;
  return (
    <Dialog
      title="Configure workspace"
      open={open}
      onClose={onClose}
      actions={
        <button type="button" className="text-button" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="wp-config">
        {workspace && (
          <div className="wp-config-workspace">
            <div className="wp-config-name">{workspace.definition.name}</div>
            {workspace.definition.description && <div className="wp-config-meta">{workspace.definition.description}</div>}
            <div className="wp-config-meta">Format {workspace.definition.format}</div>
          </div>
        )}
        <div className="section-title wp-config-section">Projects</div>
        <ProjectList items={projects} emptyText="No projects" />
        <div className="section-title wp-config-section">Dependencies</div>
        <ProjectList items={dependencies} emptyText="No dependencies" />
        <div className="wp-config-note">Projects and dependencies are read-only in this clone.</div>
      </div>
    </Dialog>
  );
}
