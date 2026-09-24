/** Keyboard shortcuts dialog (§10). */
import { Fragment } from 'react';
import { Dialog } from '../../common/Dialog';
import '../shell.css';

const SHORTCUTS: { keys: string[][]; action: string }[] = [
  { keys: [['1'], ['2'], ['3']], action: 'Model / Experiment / Results mode' },
  { keys: [['Ctrl', 'S']], action: 'Save code (Code view)' },
  { keys: [['Ctrl', 'Z'], ['Ctrl', 'Y']], action: 'Undo / redo' },
  { keys: [['Delete'], ['Backspace']], action: 'Delete selection' },
  { keys: [['Ctrl', 'C'], ['Ctrl', 'V']], action: 'Copy / paste components' },
  { keys: [['Ctrl', '+'], ['Ctrl', '−'], ['Ctrl', '0']], action: 'Zoom in / out / fit' },
  { keys: [['Ctrl', 'Wheel']], action: 'Zoom around the cursor' },
  { keys: [['Wheel'], ['Shift', 'Wheel']], action: 'Scroll the canvas vertically / horizontally' },
  { keys: [['H']], action: 'Pan tool (drag anywhere to move the view)' },
  { keys: [['V']], action: 'Select tool' },
  { keys: [['Right mouse', 'Drag'], ['Middle mouse', 'Drag'], ['Space', 'Drag']], action: 'Pan the canvas' },
  { keys: [['Esc']], action: 'Cancel connection / deselect / close dialog' },
  { keys: [['←'], ['→']], action: 'Step the time slider' },
  { keys: [['F']], action: 'Fit diagram to view' },
  { keys: [['Shift', 'Click']], action: 'Add to selection' },
  { keys: [['Shift'], ['Connect']], action: 'Advanced connection dialog (not implemented: shows a tooltip)' },
  { keys: [['Ctrl', 'F']], action: 'Search in Code view' },
  { keys: [['?']], action: 'Open this dialog' },
];

export function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  return (
    <Dialog open title="Keyboard shortcuts" onClose={onClose} width={520} actions={<button type="button" className="contained-button" onClick={onClose}>Close</button>}>
      <table className="shortcuts-table">
        <tbody>
          {SHORTCUTS.map((s) => (
            <tr key={s.action}>
              <td>
                {s.keys.map((combo, i) => (
                  <Fragment key={i}>
                    {i > 0 && <span className="kbd-sep">/</span>}
                    {combo.map((k, j) => (
                      <Fragment key={j}>
                        {j > 0 && <span className="kbd-sep">+</span>}
                        <span className="kbd">{k}</span>
                      </Fragment>
                    ))}
                  </Fragment>
                ))}
              </td>
              <td>{s.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Dialog>
  );
}

export default ShortcutsDialog;
