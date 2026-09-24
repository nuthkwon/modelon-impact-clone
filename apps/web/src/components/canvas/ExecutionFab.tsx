/**
 * Execution ("Play") floating action button (UI_SPEC §5.2): idle / disabled / running with a
 * progress ring and Stop / done (orange). Hover or the chevron reveals the run-kind menu.
 */
import { useMemo, useState } from 'react';
import { useStore } from '../../store';
import { Tooltip } from '../common/Tooltip';
import { Icon } from '../icons';

const RING_R = 26;
const RING_C = 2 * Math.PI * RING_R;

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
  const done = !isRunning && !!activeResult && activeResult.status !== 'running';

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
  const stateClass = isRunning ? 'running' : !canSimulate ? 'disabled' : done ? 'done' : 'idle';
  const progress = isRunning ? Math.min(1, Math.max(0, running.progress)) : 0;

  return (
    <div className={`fab-group execution-fab-group${menuOpen ? ' open' : ''}`} onMouseLeave={() => setMenuOpen(false)}>
      {phaseLabel && <span className="chip phase-chip">{phaseLabel}</span>}
      <div className="fab-stack">
        <Tooltip text={title} placement="left">
          <button className={`fab execution-fab ${stateClass}`} aria-label={title} disabled={!canSimulate && !isRunning} onClick={onMain}>
            {isRunning && (
              <svg className="fab-ring" width={56} height={56} viewBox="0 0 56 56" aria-hidden="true">
                <circle cx={28} cy={28} r={RING_R} className="fab-ring-track" />
                <circle cx={28} cy={28} r={RING_R} className="fab-ring-progress" strokeDasharray={RING_C} strokeDashoffset={RING_C * (1 - progress)} transform="rotate(-90 28 28)" />
              </svg>
            )}
            <span className="fab-icon">{isRunning ? <Icon.Stop /> : <Icon.Play />}</span>
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
