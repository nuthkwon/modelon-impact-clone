/**
 * Execution ("Play") floating action button (UI_SPEC §5.2 / §9): a 56px white disc with an
 * orange play triangle. States (`data-state`): idle / disabled (grey triangle) / running
 * (orange progress ring + Stop, click cancels) / done (filled orange disc, white triangle).
 * Hover or the chevron reveals the run-kind menu.
 */
import { useMemo, useState } from 'react';
import type { JSX } from 'react';
import { useStore } from '../../store';
import { Tooltip } from '../common/Tooltip';
import { Icon } from '../icons';

const RING_SIZE = 64;
const RING_R = 30;
const RING_C = 2 * Math.PI * RING_R;

function PlayGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M7.5 4.2v15.6L21 12z" />
    </svg>
  );
}

function StopGlyph(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="6.5" y="6.5" width="11" height="11" rx="1.5" fill="currentColor" />
    </svg>
  );
}

export type ExecutionFabState = 'idle' | 'running' | 'done' | 'disabled';

export function ExecutionFab() {
  const activeClass = useStore((s) => s.activeClass);
  const running = useStore((s) => s.running);
  const registryVersion = useStore((s) => s.registryVersion);
  const activeResult = useStore((s) => (activeClass ? s.getActiveResult(activeClass) : undefined));
  const simulate = useStore((s) => s.simulate);
  const cancelSimulation = useStore((s) => s.cancelSimulation);
  const [menuOpen, setMenuOpen] = useState(false);

  const def = useMemo(() => (activeClass ? useStore.getState().registry.get(activeClass)?.def : undefined), [activeClass, registryVersion]);
  const canSimulate = !!def && !def.partial && (def.restriction === 'model' || def.restriction === 'block' || def.restriction === 'class');
  const isRunning = !!running && running.className === activeClass;
  const busy = !!running;
  const done = !isRunning && !!activeResult && (activeResult.status === 'successful' || activeResult.status === 'partial');

  const phaseLabel = isRunning
    ? running.phase === 'compiling'
      ? 'Compiling…'
      : running.phase === 'simulating'
        ? `Simulating… ${Math.round(Math.min(1, Math.max(0, running.progress)) * 100)}%`
        : 'Pending…'
    : undefined;

  const onMain = () => {
    if (isRunning) void cancelSimulation();
    else if (canSimulate && !busy) void simulate('dynamic');
  };

  const run = (kind: 'dynamic' | 'steady state' | 'compile') => {
    setMenuOpen(false);
    if (!canSimulate || busy) return;
    void simulate(kind);
  };

  const title = isRunning ? 'Cancel simulation' : !canSimulate ? 'This class cannot be simulated' : done ? 'Simulate (latest result available)' : 'Simulate';
  const state: ExecutionFabState = isRunning ? 'running' : !canSimulate ? 'disabled' : done ? 'done' : 'idle';
  const progress = isRunning ? Math.min(1, Math.max(0, running.progress)) : 0;

  return (
    <div className={`fab-group execution-fab-group${menuOpen ? ' open' : ''}`} onMouseLeave={() => setMenuOpen(false)}>
      {phaseLabel && <span className="chip phase-chip">{phaseLabel}</span>}
      <div className="fab-stack">
        <Tooltip text={title} placement="left">
          <button
            className={`fab execution-fab ${state}`}
            data-testid="execution-fab"
            data-state={state}
            aria-label={title}
            disabled={!canSimulate && !isRunning}
            onClick={onMain}
          >
            {isRunning && (
              <svg className="fab-ring" width={RING_SIZE} height={RING_SIZE} viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} aria-hidden="true">
                <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_R} className="fab-ring-track" />
                <circle
                  cx={RING_SIZE / 2}
                  cy={RING_SIZE / 2}
                  r={RING_R}
                  className="fab-ring-progress"
                  strokeDasharray={RING_C}
                  strokeDashoffset={RING_C * (1 - progress)}
                  transform={`rotate(-90 ${RING_SIZE / 2} ${RING_SIZE / 2})`}
                />
              </svg>
            )}
            <span className="fab-icon">{isRunning ? <StopGlyph /> : <PlayGlyph />}</span>
          </button>
        </Tooltip>
        <button className="fab-chevron" title="Execution options" aria-label="Execution options" onClick={() => setMenuOpen((o) => !o)}>
          <Icon.ExpandMore />
        </button>
        <div className="fab-menu menu" role="menu">
          <button className="menu-item" role="menuitem" disabled={!canSimulate || busy} onClick={() => run('dynamic')}>
            Simulate
          </button>
          <button className="menu-item" role="menuitem" disabled={!canSimulate || busy} onClick={() => run('steady state')}>
            Simulate steady state
          </button>
          <button className="menu-item" role="menuitem" disabled={!canSimulate || busy} onClick={() => run('compile')}>
            Compile only
          </button>
          <button className="menu-item" role="menuitem" disabled={!canSimulate || busy} onClick={() => run('dynamic')}>
            Re-compile and simulate
          </button>
        </div>
      </div>
    </div>
  );
}
