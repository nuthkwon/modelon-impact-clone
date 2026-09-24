/**
 * Views floating action button (UI_SPEC §5.2 / §9: 44px white disc, orange eye): saves/restores
 * the plots & stickies of the active class as named views and clears the canvas objects.
 */
import { useState } from 'react';
import { useStore } from '../../store';
import { Dialog } from '../common/Dialog';
import { Tooltip } from '../common/Tooltip';
import { Icon } from '../icons';

const EMPTY: never[] = [];

/** Filled orange eye with a white iris ring (the Views FAB glyph in Impact). */
function EyeGlyph() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 5.5C7.2 5.5 3.1 8.3 1.4 12.25 3.1 16.2 7.2 19 12 19s8.9-2.8 10.6-6.75C20.9 8.3 16.8 5.5 12 5.5z" />
      <circle className="glyph-surface" cx="12" cy="12.25" r="4.7" />
      <circle cx="12" cy="12.25" r="3" fill="currentColor" />
      <circle className="glyph-surface" cx="13.5" cy="10.9" r="0.9" />
    </svg>
  );
}

export function ViewsFab() {
  const activeClass = useStore((s) => s.activeClass);
  const views = useStore((s) => (activeClass ? s.views[activeClass] : undefined)) ?? EMPTY;
  const saveView = useStore((s) => s.saveView);
  const loadView = useStore((s) => s.loadView);
  const deleteView = useStore((s) => s.deleteView);
  const clearCanvasObjects = useStore((s) => s.clearCanvasObjects);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);

  const openDialog = () => {
    setMenuOpen(false);
    setName(`View ${views.length + 1}`);
    setDialogOpen(true);
  };
  const save = () => {
    const n = name.trim();
    if (!n || !activeClass) return;
    saveView(activeClass, n);
    setDialogOpen(false);
  };

  return (
    <div className={`fab-group views-fab-group${menuOpen ? ' open' : ''}`} onMouseLeave={() => setMenuOpen(false)}>
      <div className="fab-stack">
        <Tooltip text="Views" placement="left">
          <button className="fab views-fab" data-testid="views-fab" aria-label="Views" disabled={!activeClass} onClick={() => setMenuOpen((o) => !o)}>
            <span className="fab-icon">
              <EyeGlyph />
            </span>
          </button>
        </Tooltip>
        <div className="fab-menu menu" role="menu">
          <button className="menu-item" role="menuitem" disabled={!activeClass} onClick={openDialog}>
            Save view…
          </button>
          {views.length > 0 && <div className="menu-separator" />}
          {views.map((v) => (
            <div key={v.name} className="menu-item view-item">
              <button
                className="view-item-name"
                onClick={() => {
                  if (activeClass) loadView(activeClass, v.name);
                  setMenuOpen(false);
                }}
                title={`Restore view ${v.name}`}
              >
                {v.name}
              </button>
              <button
                className="icon-button view-item-delete"
                title="Delete view"
                aria-label={`Delete view ${v.name}`}
                onClick={(e) => {
                  e.stopPropagation();
                  if (activeClass) deleteView(activeClass, v.name);
                }}
              >
                <Icon.Delete />
              </button>
            </div>
          ))}
          <div className="menu-separator" />
          <button
            className="menu-item"
            role="menuitem"
            disabled={!activeClass}
            onClick={() => {
              if (activeClass) clearCanvasObjects(activeClass);
              setMenuOpen(false);
            }}
          >
            Clear canvas
          </button>
        </div>
      </div>
      <Dialog
        title="Save view"
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        actions={
          <>
            <button className="text-button" onClick={() => setDialogOpen(false)}>
              Cancel
            </button>
            <button className="contained-button" disabled={!name.trim()} onClick={save}>
              Save
            </button>
          </>
        }
      >
        <label className="dialog-field">
          <span className="dialog-label">Name</span>
          <input
            className="text-field"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
            }}
          />
        </label>
        {views.some((v) => v.name === name.trim()) && <div className="dialog-hint">A view with this name exists and will be replaced.</div>}
      </Dialog>
    </div>
  );
}
