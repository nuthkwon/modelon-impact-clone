/**
 * EXPERIMENT tab (UI_SPEC §6.4): experiment browser + ANALYSIS / MODIFICATIONS / OUTPUTS.
 */
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { Tooltip } from '../common/Tooltip';
import { useContextMenu } from '../common/ContextMenu';
import type { MenuItem } from '../common/ContextMenu';
import { Icon } from '../icons';
import { useShellActions } from '../shell/shellActions';
import { modifierCaseCount, pointsOf, useStore } from '../../store';
import type { AnalysisSettings, Experiment, OutputFilter, SolverOption } from '../../store/types';
import { DetailsPopover } from './DetailsPopover';
import { FieldRow, NumberInput, Switch } from './fields';
import { ExecutionSettingsDialog } from './ExecutionSettingsDialog';
import { formatDateTime, intervalFromPoints, validateTimes } from './helpers';

export interface ExperimentTabProps {
  className: string;
}

const SUB_TABS = ['ANALYSIS', 'MODIFICATIONS', 'OUTPUTS'] as const;
type SubTab = (typeof SUB_TABS)[number];

export function ExperimentTab({ className }: ExperimentTabProps) {
  const experiments = useStore((s) => s.experiments);
  const activeId = useStore((s) => s.activeExperiment[className]);
  const ensureExperiment = useStore((s) => s.ensureExperiment);
  const list = experiments.filter((e) => e.className === className);
  const active = list.find((e) => e.id === activeId) ?? list[0];
  const [subTab, setSubTab] = useState<SubTab>('ANALYSIS');

  useEffect(() => {
    if (!list.length) ensureExperiment(className);
  }, [list.length, className, ensureExperiment]);

  return (
    <div className="experiment-tab">
      <ExperimentBrowser className={className} experiments={list} activeId={active?.id} />
      <div className="details-subtabs" role="tablist">
        {SUB_TABS.map((t) => (
          <button key={t} type="button" role="tab" className={`details-subtab${t === subTab ? ' active' : ''}`} aria-selected={t === subTab} onClick={() => setSubTab(t)}>
            {t}
          </button>
        ))}
      </div>
      {!active ? (
        <div className="details-empty">No experiment.</div>
      ) : subTab === 'ANALYSIS' ? (
        <AnalysisPanel exp={active} />
      ) : subTab === 'MODIFICATIONS' ? (
        <ModificationsPanel exp={active} />
      ) : (
        <OutputsPanel exp={active} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Experiment browser
// ---------------------------------------------------------------------------

function ExperimentBrowser({ className, experiments, activeId }: { className: string; experiments: Experiment[]; activeId?: string }) {
  const createExperiment = useStore((s) => s.createExperiment);
  return (
    <div className="exp-browser">
      <div className="section-title">Experiments</div>
      <div className="exp-list" role="listbox" aria-label="Experiments">
        {experiments.map((e) => (
          <ExperimentRow key={e.id} exp={e} active={e.id === activeId} onlyOne={experiments.length <= 1} />
        ))}
      </div>
      <button type="button" className="exp-new-link" onClick={() => createExperiment(className)}>
        <Icon.Add /> New experiment
      </button>
    </div>
  );
}

function ExperimentRow({ exp, active, onlyOne }: { exp: Experiment; active: boolean; onlyOne: boolean }) {
  const setActiveExperiment = useStore((s) => s.setActiveExperiment);
  const renameExperiment = useStore((s) => s.renameExperiment);
  const duplicateExperiment = useStore((s) => s.duplicateExperiment);
  const deleteExperiment = useStore((s) => s.deleteExperiment);
  const caseCount = useStore((s) => s.caseCount);
  const menu = useContextMenu();
  const shell = useShellActions();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(exp.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const doneRef = useRef(false);
  const cases = caseCount(exp.id);

  useEffect(() => {
    if (renaming) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [renaming]);

  const startRename = () => {
    setDraft(exp.name);
    doneRef.current = false;
    setRenaming(true);
  };
  const finishRename = (commit: boolean) => {
    if (doneRef.current) return;
    doneRef.current = true;
    setRenaming(false);
    const name = draft.trim();
    if (commit && name && name !== exp.name) renameExperiment(exp.id, name);
  };
  const remove = async () => {
    const ok = await shell.confirm({ title: 'Delete experiment?', message: `Delete "${exp.name}" permanently?`, confirmLabel: 'Delete', danger: true });
    if (ok) deleteExperiment(exp.id);
  };
  const openMenu = (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const items: MenuItem[] = [
      { label: 'Rename', icon: <Icon.Edit />, onSelect: startRename },
      { label: 'Duplicate', icon: <Icon.ContentCopy />, onSelect: () => duplicateExperiment(exp.id) },
      { label: 'Delete', icon: <Icon.Delete />, onSelect: () => void remove(), disabled: onlyOne, danger: true },
    ];
    menu.open(e, items);
  };

  return (
    <div
      className={`exp-row${active ? ' active' : ''}`}
      role="button"
      tabIndex={0}
      aria-pressed={active}
      onClick={() => setActiveExperiment(exp.className, exp.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') setActiveExperiment(exp.className, exp.id);
      }}
      onContextMenu={openMenu}
    >
      {renaming ? (
        <input
          ref={inputRef}
          className="exp-row-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={() => finishRename(true)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') finishRename(true);
            else if (e.key === 'Escape') finishRename(false);
          }}
          aria-label="Experiment name"
        />
      ) : (
        <div className="exp-row-text">
          <span className="exp-row-name">{exp.name}</span>
          <span className="exp-row-meta">{formatDateTime(exp.createdAt)}</span>
        </div>
      )}
      {cases > 1 && <span className="chip">{cases} cases</span>}
      {!renaming && (
        <div className="exp-row-actions">
          <Tooltip text="Rename">
            <button
              type="button"
              className="icon-button"
              aria-label="Rename experiment"
              onClick={(e) => {
                e.stopPropagation();
                startRename();
              }}
            >
              <Icon.Edit />
            </button>
          </Tooltip>
          <button type="button" className="icon-button" aria-label="More actions" onClick={openMenu}>
            <Icon.MoreVert />
          </button>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ANALYSIS
// ---------------------------------------------------------------------------

const SOLVERS: SolverOption[] = ['CVode', 'Radau5ODE', 'ExplicitEuler'];

function AnalysisPanel({ exp }: { exp: Experiment }) {
  const updateAnalysis = useStore((s) => s.updateAnalysis);
  const a = exp.analysis;
  const update = (patch: Partial<AnalysisSettings>) => updateAnalysis(exp.id, patch);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const timeError = a.type === 'dynamic' ? validateTimes(a.startTime, a.stopTime) : undefined;
  const points = pointsOf(a);

  return (
    <div className="analysis-panel">
      <div className="analysis-types" role="radiogroup" aria-label="Analysis type">
        <button type="button" role="radio" aria-checked={a.type === 'dynamic'} className={`analysis-type analysis-type--first${a.type === 'dynamic' ? ' active' : ''}`} onClick={() => update({ type: 'dynamic' })}>
          Dynamic
        </button>
        <button type="button" role="radio" aria-checked={a.type === 'steady state'} className={`analysis-type${a.type === 'steady state' ? ' active' : ''}`} onClick={() => update({ type: 'steady state' })}>
          Steady-State
        </button>
        <Tooltip text="No custom functions installed">
          <button type="button" role="radio" aria-checked={false} className="analysis-type analysis-type--last" disabled>
            Custom
          </button>
        </Tooltip>
      </div>

      {a.type === 'dynamic' ? (
        <div className="analysis-fields">
          <FieldRow label="Start time" unit="s" htmlFor="an-start">
            <NumberInput id="an-start" value={a.startTime} onCommit={(n) => update({ startTime: n })} invalid={!!timeError} />
          </FieldRow>
          <FieldRow label="Stop time" unit="s" htmlFor="an-stop" helper={timeError}>
            <NumberInput id="an-stop" value={a.stopTime} onCommit={(n) => update({ stopTime: n })} invalid={!!timeError} />
          </FieldRow>
          <FieldRow
            label={
              <>
                <span>{a.useInterval ? 'Interval' : 'Points'}</span>
                <Switch on={a.useInterval} onToggle={() => update({ useInterval: !a.useInterval })} ariaLabel="Toggle between Interval and Points" />
                <span className="details-switch-label">{a.useInterval ? 'interval' : 'points'}</span>
              </>
            }
            unit={a.useInterval ? 's' : ''}
            htmlFor="an-interval"
          >
            {a.useInterval ? (
              <NumberInput id="an-interval" value={a.interval} accept={(n) => n > 0} onCommit={(n) => update({ interval: n })} />
            ) : (
              <NumberInput id="an-interval" value={points} accept={(n) => n >= 1} onCommit={(n) => update({ interval: intervalFromPoints(a.startTime, a.stopTime, n) })} />
            )}
          </FieldRow>
          <FieldRow label="Solver" htmlFor="an-solver">
            <select id="an-solver" className="text-field" value={a.solver} onChange={(e) => update({ solver: e.target.value as SolverOption })}>
              {SOLVERS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </FieldRow>
          {(a.solver === 'CVode' || a.solver === 'Radau5ODE') && (
            <FieldRow label="Tolerance" htmlFor="an-tol">
              <NumberInput id="an-tol" value={a.tolerance} accept={(n) => n > 0} onCommit={(n) => update({ tolerance: n })} />
            </FieldRow>
          )}
          {a.solver === 'ExplicitEuler' && (
            <FieldRow label="Step Size" unit="s" htmlFor="an-step">
              <NumberInput id="an-step" value={a.stepSize} accept={(n) => n > 0} onCommit={(n) => update({ stepSize: n })} />
            </FieldRow>
          )}
        </div>
      ) : (
        <>
          <div className="analysis-fields">
            <FieldRow label="Start time" unit="s" htmlFor="an-start">
              <NumberInput id="an-start" value={a.startTime} onCommit={(n) => update({ startTime: n })} />
            </FieldRow>
          </div>
          <div className="analysis-note">Computes the steady-state solution (der(x)=0)</div>
        </>
      )}

      <div className="analysis-advanced">
        <button type="button" className="text-button" onClick={() => setAdvancedOpen(true)}>
          Advanced
        </button>
      </div>
      <ExecutionSettingsDialog open={advancedOpen} onClose={() => setAdvancedOpen(false)} settings={a.advanced} onChange={(advanced) => update({ advanced })} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// MODIFICATIONS
// ---------------------------------------------------------------------------

function ModificationsPanel({ exp }: { exp: Experiment }) {
  const setModifier = useStore((s) => s.setModifier);
  const entries = Object.entries(exp.modifiers).sort(([a], [b]) => a.localeCompare(b));
  if (!entries.length) return <div className="details-empty">No modifications. Edit a parameter in Experiment mode to override it.</div>;
  return (
    <div className="mod-list">
      {entries.map(([name, value]) => {
        const cases = modifierCaseCount(value);
        return (
          <div key={name} className="mod-row">
            <code title={`${name} = ${value}`}>
              {name} = {value}
            </code>
            {cases > 1 && <span className="chip">{cases} cases</span>}
            <button type="button" className="icon-button" aria-label={`Remove modifier ${name}`} onClick={() => setModifier(exp.id, name, null)}>
              <Icon.Close />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// OUTPUTS
// ---------------------------------------------------------------------------

const FILTER_KINDS: OutputFilter['kind'][] = ['View', 'Favorites', 'Component', 'Variable'];

function OutputsPanel({ exp }: { exp: Experiment }) {
  const addOutputFilter = useStore((s) => s.addOutputFilter);
  const removeOutputFilter = useStore((s) => s.removeOutputFilter);
  const views = useStore((s) => s.views[exp.className]) ?? [];
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<OutputFilter['kind']>('Variable');
  const [value, setValue] = useState('');
  const anchorRef = useRef<HTMLButtonElement>(null);

  const needsValue = kind !== 'Favorites';
  const add = () => {
    const v = value.trim();
    if (needsValue && !v) return;
    addOutputFilter(exp.id, { kind, value: needsValue ? v : '' });
    setValue('');
    setOpen(false);
  };

  return (
    <div className="outputs-panel">
      {!exp.outputs.length ? (
        <div className="details-empty">No output filters. All variables are stored.</div>
      ) : (
        <div className="mod-list">
          {exp.outputs.map((f) => (
            <div key={f.id} className="mod-row">
              <span className="mod-kind">{f.kind}</span>
              <code title={f.value}>{f.value || (f.kind === 'Favorites' ? 'all favorites' : '')}</code>
              <button type="button" className="icon-button" aria-label="Remove filter" onClick={() => removeOutputFilter(exp.id, f.id)}>
                <Icon.Close />
              </button>
            </div>
          ))}
        </div>
      )}
      <button ref={anchorRef} type="button" className="exp-new-link" onClick={() => setOpen((o) => !o)}>
        <Icon.Add /> New filter
      </button>
      <DetailsPopover anchor={anchorRef.current} open={open} onClose={() => setOpen(false)} width={280} align="left">
        <div className="details-popover-title">
          <span>New output filter</span>
        </div>
        <div className="attr-grid">
          <label htmlFor="flt-kind">Type</label>
          <select id="flt-kind" className="text-field" value={kind} onChange={(e) => setKind(e.target.value as OutputFilter['kind'])}>
            {FILTER_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          {needsValue && (
            <>
              <label htmlFor="flt-value">{kind === 'View' ? 'View' : kind === 'Component' ? 'Component' : 'Variable'}</label>
              {kind === 'View' && views.length ? (
                <select id="flt-value" className="text-field" value={value} onChange={(e) => setValue(e.target.value)}>
                  <option value="">Select a view…</option>
                  {views.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  id="flt-value"
                  className="text-field"
                  value={value}
                  placeholder={kind === 'Component' ? 'e.g. resistor' : kind === 'Variable' ? 'e.g. resistor.v or *.v' : 'View name'}
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') add();
                  }}
                  spellCheck={false}
                />
              )}
            </>
          )}
        </div>
        <div className="details-popover-actions">
          <button type="button" className="text-button" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button type="button" className="contained-button" onClick={add} disabled={needsValue && !value.trim()}>
            Add
          </button>
        </div>
      </DetailsPopover>
    </div>
  );
}
