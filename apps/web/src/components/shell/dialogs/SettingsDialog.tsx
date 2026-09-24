/** Application settings dialog (§7): Application / Execution / Export / Units / Workspace tabs. */
import { useEffect, useState } from 'react';
import { api } from '../../../api/client';
import { DEFAULT_ANALYSIS, DEFAULT_EXECUTION_SETTINGS, pointsOf, useStore } from '../../../store';
import type { JSX } from 'react';
import { Dialog } from '../../common/Dialog';
import { Switch } from '../../common/Switch';
import { DownloadIcon, PlayIcon, RulerIcon, SettingsIcon, StorageIcon } from '../../icons';
import type { SettingsTab } from '../shellActions';
import '../shell.css';

/** Left navigation of the dialog: icon + label rows, active = pale-orange pill (Impact's left nav look). */
const TABS: { id: SettingsTab; icon: JSX.Element }[] = [
  { id: 'Application', icon: <SettingsIcon /> },
  { id: 'Execution', icon: <PlayIcon /> },
  { id: 'Export', icon: <DownloadIcon /> },
  { id: 'Units', icon: <RulerIcon /> },
  { id: 'Workspace', icon: <StorageIcon /> },
];

export function SettingsDialog({ tab: initialTab, onClose }: { tab: SettingsTab; onClose: () => void }) {
  const [tab, setTab] = useState<SettingsTab>(initialTab);
  const settings = useStore((s) => s.settings);
  const updateSettings = useStore((s) => s.updateSettings);
  const workspace = useStore((s) => s.workspace);
  const [wsName, setWsName] = useState(workspace?.definition.name ?? '');
  const [wsDesc, setWsDesc] = useState(workspace?.definition.description ?? '');
  const [wsBusy, setWsBusy] = useState(false);
  const [wsMsg, setWsMsg] = useState<{ ok: boolean; text: string } | undefined>();

  useEffect(() => {
    setWsName(workspace?.definition.name ?? '');
    setWsDesc(workspace?.definition.description ?? '');
  }, [workspace]);

  const saveWorkspace = async () => {
    if (!workspace || !wsName.trim()) return;
    setWsBusy(true);
    setWsMsg(undefined);
    try {
      const ws = await api.renameWorkspace(workspace.id, wsName.trim(), wsDesc.trim() || undefined);
      useStore.setState({ workspace: ws });
      setWsMsg({ ok: true, text: 'Workspace updated.' });
    } catch (e) {
      setWsMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setWsBusy(false);
    }
  };

  const a = DEFAULT_ANALYSIS;
  const x = DEFAULT_EXECUTION_SETTINGS;

  return (
    <Dialog open title="Application settings" onClose={onClose} width={720} className="settings-dialog" actions={<button type="button" className="contained-button" onClick={onClose}>Done</button>}>
      <div className="settings-layout">
        <div className="settings-nav" role="tablist" aria-orientation="vertical">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`settings-nav-item${tab === t.id ? ' active' : ''}`} onClick={() => setTab(t.id)}>
              {t.icon}
              <span>{t.id}</span>
            </button>
          ))}
        </div>
        <div className="settings-body" role="tabpanel">
        {tab === 'Application' && (
          <>
            <Switch label="Show grid" sub="20-unit line grid on the diagram canvas" checked={settings.showGrid} onChange={(v) => updateSettings({ showGrid: v })} />
            <Switch label="Enable snapping" sub="Snap moved components to the grid" checked={settings.snapping} onChange={(v) => updateSettings({ snapping: v })} />
            <Switch label="Enable dark mode (Public Beta)" checked={settings.darkMode} onChange={(v) => updateSettings({ darkMode: v })} />
            <Switch label="Exclude plots and stickies from dark mode" sub="Keeps the canvas, plots and stickies on a bright background" checked={settings.excludeCanvasFromDark} disabled={!settings.darkMode} onChange={(v) => updateSettings({ excludeCanvasFromDark: v })} />
            <Switch label="Enable automatic propagation" sub="Propagate parameter changes to dependent values" checked={settings.autoPropagate} onChange={(v) => updateSettings({ autoPropagate: v })} />
          </>
        )}
        {tab === 'Execution' && (
          <>
            <p className="settings-note">Default experiment values applied to new experiments. Per-experiment settings are edited in the EXPERIMENT tab of the Details panel.</p>
            <div className="settings-kv">
              <span className="k">Analysis type</span><span className="v">{a.type === 'dynamic' ? 'Dynamic' : 'Steady-State'}</span><span className="u" />
              <span className="k">Start time</span><span className="v">{a.startTime}</span><span className="u">s</span>
              <span className="k">Stop time</span><span className="v">{a.stopTime}</span><span className="u">s</span>
              <span className="k">Interval</span><span className="v">{a.interval}</span><span className="u">s</span>
              <span className="k">Points</span><span className="v">{pointsOf(a)}</span><span className="u" />
              <span className="k">Solver</span><span className="v">{a.solver}</span><span className="u" />
              <span className="k">Tolerance</span><span className="v">{a.tolerance}</span><span className="u" />
              <span className="k">Step size (ExplicitEuler)</span><span className="v">{a.stepSize}</span><span className="u">s</span>
              <span className="k">C compiler</span><span className="v">{x.compiler.c_compiler}</span><span className="u" />
              <span className="k">Log level</span><span className="v">{x.runtime.log_level}</span><span className="u" />
              <span className="k">ncp</span><span className="v">{x.simulation.ncp}</span><span className="u" />
              <span className="k">Store event points</span><span className="v">{String(x.simulation.store_event_points)}</span><span className="u" />
              <span className="k">rtol / atol</span><span className="v">{x.solver.rtol} / {x.solver.atol}</span><span className="u" />
            </div>
          </>
        )}
        {tab === 'Export' && (
          <div className="form-row">
            <label htmlFor="settings-decimal">CSV decimal separator</label>
            <select id="settings-decimal" className="text-field" value={settings.csvDecimalSeparator} onChange={(e) => updateSettings({ csvDecimalSeparator: e.target.value as '.' | ',' })} style={{ maxWidth: 240 }}>
              <option value=".">Point (.)</option>
              <option value=",">Comma (,)</option>
            </select>
            <span className="form-help">Used when downloading results as CSV.</span>
          </div>
        )}
        {tab === 'Units' && <Switch label="Show display units" sub="Show values in the declared displayUnit instead of the SI unit" checked={settings.showDisplayUnits} onChange={(v) => updateSettings({ showDisplayUnits: v })} />}
        {tab === 'Workspace' &&
          (workspace ? (
            <>
              <div className="form-row">
                <label htmlFor="settings-ws-name">Name</label>
                <input id="settings-ws-name" className="text-field" value={wsName} onChange={(e) => setWsName(e.target.value)} />
              </div>
              <div className="form-row">
                <label htmlFor="settings-ws-desc">Description</label>
                <textarea id="settings-ws-desc" className="text-field" value={wsDesc} onChange={(e) => setWsDesc(e.target.value)} rows={3} />
              </div>
              <div className="settings-kv" style={{ marginBottom: 8 }}>
                <span className="k">Id</span><span className="v">{workspace.id}</span><span className="u" />
                <span className="k">Created</span><span className="v">{new Date(workspace.definition.createdAt).toLocaleString()}</span><span className="u" />
                <span className="k">Last modified</span><span className="v">{new Date(workspace.definition.updatedAt).toLocaleString()}</span><span className="u" />
              </div>
              {wsMsg && <div className={wsMsg.ok ? 'form-help' : 'form-error'}>{wsMsg.text}</div>}
              <div className="settings-actions">
                <button type="button" className="contained-button" disabled={wsBusy || !wsName.trim() || (wsName.trim() === workspace.definition.name && (wsDesc.trim() || '') === (workspace.definition.description ?? ''))} onClick={() => void saveWorkspace()}>
                  {wsBusy ? 'Saving…' : 'Save'}
                </button>
              </div>
            </>
          ) : (
            <p className="settings-note">Open a workspace to edit its name and description.</p>
          ))}
        </div>
      </div>
    </Dialog>
  );
}

export default SettingsDialog;
