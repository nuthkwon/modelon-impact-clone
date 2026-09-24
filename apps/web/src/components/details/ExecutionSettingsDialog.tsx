/**
 * "Execution settings" dialog opened from the ANALYSIS "Advanced" button (UI_SPEC §6.4):
 * four sections editing `analysis.advanced.*`.
 *
 * Two fields are mirrors of ANALYSIS fields rather than settings of their own, because the run
 * request (`analysisToRequest`) takes `simulationOptions.ncp` from Interval/Points and
 * `solverOptions.rtol` from Tolerance: `ncp` shows and writes "Points" (through `interval`) and
 * `rtol` shows and writes "Tolerance".
 */
import { Dialog } from '../common/Dialog';
import { pointsOf } from '../../store';
import type { AnalysisSettings, ExecutionSettings } from '../../store/types';
import { NumberInput } from './fields';
import { linkedExecutionPatch } from './helpers';

export interface ExecutionSettingsDialogProps {
  open: boolean;
  onClose: () => void;
  /** The analysis the dialog edits: its `advanced` sections, plus `ncp` ⇄ Points and `rtol` ⇄ Tolerance. */
  analysis: AnalysisSettings;
  onAnalysisChange: (patch: Partial<AnalysisSettings>) => void;
}

const C_COMPILERS = ['gcc', 'clang', 'msvc'];
const LOG_LEVELS: { value: number; label: string }[] = [
  { value: 0, label: '0 — nothing' },
  { value: 1, label: '1 — fatal' },
  { value: 2, label: '2 — error' },
  { value: 3, label: '3 — warning' },
  { value: 4, label: '4 — info' },
  { value: 5, label: '5 — verbose' },
  { value: 6, label: '6 — debug' },
  { value: 7, label: '7 — all' },
];

function Check({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <>
      <label htmlFor={id}>
        <code>{label}</code>
      </label>
      <div className="exec-check">
        <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      </div>
    </>
  );
}

export function ExecutionSettingsDialog({ open, onClose, analysis, onAnalysisChange }: ExecutionSettingsDialogProps) {
  const s = analysis.advanced;
  const patch = <K extends keyof ExecutionSettings>(section: K, values: Partial<ExecutionSettings[K]>) => onAnalysisChange({ advanced: { ...s, [section]: { ...s[section], ...values } } });
  return (
    <Dialog
      title="Execution settings"
      open={open}
      onClose={onClose}
      actions={
        <button type="button" className="contained-button" onClick={onClose}>
          Done
        </button>
      }
    >
      <div className="exec-settings">
        <section>
          <div className="exec-section-title">Compiler options</div>
          <div className="exec-grid">
            <label htmlFor="exec-c-compiler">
              <code>c_compiler</code>
            </label>
            <select id="exec-c-compiler" className="text-field" value={C_COMPILERS.includes(s.compiler.c_compiler) ? s.compiler.c_compiler : 'gcc'} onChange={(e) => patch('compiler', { c_compiler: e.target.value })}>
              {C_COMPILERS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <Check id="exec-html-diag" label="generate_html_diagnostics" checked={s.compiler.generate_html_diagnostics} onChange={(v) => patch('compiler', { generate_html_diagnostics: v })} />
            <Check id="exec-protected" label="include_protected_variables" checked={s.compiler.include_protected_variables} onChange={(v) => patch('compiler', { include_protected_variables: v })} />
            <Check id="exec-filter-warnings" label="filter_warnings" checked={s.compiler.filter_warnings} onChange={(v) => patch('compiler', { filter_warnings: v })} />
          </div>
        </section>
        <section>
          <div className="exec-section-title">Runtime options</div>
          <div className="exec-grid">
            <label htmlFor="exec-log-level">
              <code>log_level</code>
            </label>
            <select id="exec-log-level" className="text-field" value={String(s.runtime.log_level)} onChange={(e) => patch('runtime', { log_level: Number(e.target.value) })}>
              {LOG_LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        </section>
        <section>
          <div className="exec-section-title">Simulation options</div>
          <div className="exec-grid">
            <label htmlFor="exec-ncp">
              <code>ncp</code>
            </label>
            <NumberInput id="exec-ncp" value={pointsOf(analysis)} accept={(n) => Number.isInteger(n) && n >= 1} onCommit={(n) => onAnalysisChange(linkedExecutionPatch(analysis, 'ncp', n))} />
            <div className="exec-helper" id="exec-ncp-help">
              Same as Points in the Analysis tab
            </div>
            <Check id="exec-dyn-diag" label="dynamic_diagnostics" checked={s.simulation.dynamic_diagnostics} onChange={(v) => patch('simulation', { dynamic_diagnostics: v })} />
            <Check id="exec-event-points" label="store_event_points" checked={s.simulation.store_event_points} onChange={(v) => patch('simulation', { store_event_points: v })} />
          </div>
        </section>
        <section>
          <div className="exec-section-title">Solver options</div>
          <div className="exec-grid">
            <label htmlFor="exec-rtol">
              <code>rtol</code>
            </label>
            <NumberInput id="exec-rtol" value={analysis.tolerance} accept={(n) => n > 0} onCommit={(n) => onAnalysisChange(linkedExecutionPatch(analysis, 'rtol', n))} />
            <div className="exec-helper" id="exec-rtol-help">
              Same as Tolerance in the Analysis tab
            </div>
            <label htmlFor="exec-atol">
              <code>atol</code>
            </label>
            <NumberInput id="exec-atol" value={s.solver.atol} accept={(n) => n > 0} onCommit={(n) => patch('solver', { atol: n })} />
          </div>
        </section>
      </div>
    </Dialog>
  );
}
