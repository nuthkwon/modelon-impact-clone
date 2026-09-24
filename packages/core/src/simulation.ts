/**
 * Simulation options, results and log types shared by the solver, the server and the UI.
 * Option names follow Modelon Impact's `dynamic` custom function.
 */

/**
 * Solver names. The UI offers Impact's names (`CVode`, `Radau5ODE`, `ExplicitEuler`); the
 * remaining spellings are accepted aliases and map onto the integrators implemented in `solver/`.
 */
export type SolverName =
  | 'CVode'
  | 'Radau5'
  | 'Radau5ODE'
  | 'Explicit Euler'
  | 'ExplicitEuler'
  | 'Runge-Kutta'
  | 'RungeKutta'
  | 'Implicit Euler'
  | 'ImplicitEuler';

/** Canonical solver name for a user-facing spelling (case-insensitive, spaces/dashes ignored). Unknown → undefined. */
export function normalizeSolverName(name: string | undefined): SolverName | undefined {
  if (!name) return undefined;
  const key = name.replace(/[\s_-]/g, '').toLowerCase();
  switch (key) {
    case 'cvode': return 'CVode';
    case 'radau5': case 'radau5ode': case 'radau': return 'Radau5';
    case 'expliciteuler': case 'euler': return 'Explicit Euler';
    case 'rungekutta': case 'rk4': return 'Runge-Kutta';
    case 'impliciteuler': case 'bdf1': return 'Implicit Euler';
    default: return undefined;
  }
}

/** Solver names shown in the Analysis tab, in Impact's spelling. */
export const UI_SOLVER_NAMES = ['CVode', 'Radau5ODE', 'ExplicitEuler'] as const;

export interface SimulationOptions {
  /** `start_time` */
  startTime: number;
  /** `final_time` */
  finalTime: number;
  /** `ncp`: number of communication (output) points. 0 means "every step". */
  ncp: number;
  /** `rtol`: relative tolerance for variable-step integrators. */
  rtol: number;
  /** `atol`: absolute tolerance. */
  atol?: number;
  solver: SolverName;
  /** Fixed step for fixed-step integrators; defaults to (finalTime-startTime)/ncp. */
  stepSize?: number;
  /** Maximum step for variable-step integrators. */
  maxStep?: number;
  /** Emit extra diagnostics (Newton iterations, step rejections). */
  dynamicDiagnostics?: boolean;
  /** Parameter overrides: flat name -> value. */
  modifiers?: Record<string, number | boolean | string>;
  /**
   * Skip the structural pre-processing (alias elimination, known-variable propagation, index
   * reduction) and simulate the flat model as-is. Intended for debugging.
   */
  disableStructuralSimplification?: boolean;
}

export const DEFAULT_SIMULATION_OPTIONS: SimulationOptions = {
  startTime: 0,
  finalTime: 1,
  ncp: 500,
  rtol: 1e-6,
  solver: 'CVode',
};

export type LogLevel = 'debug' | 'info' | 'warning' | 'error';

export interface LogMessage {
  level: LogLevel;
  message: string;
  /** ISO timestamp or seconds since start. */
  time?: string;
  /** Where the message originated: compiler stage or simulation. */
  source: 'compiler' | 'simulation' | 'system';
}

export type TrajectoryKind = 'continuous' | 'discrete' | 'parameter' | 'constant' | 'derivative';

export interface Trajectory {
  name: string;
  /** One value per time point for variables; length 1 for parameters/constants. */
  values: number[];
  kind: TrajectoryKind;
  unit?: string;
  displayUnit?: string;
  description?: string;
}

export interface SimulationStats {
  steps: number;
  rejectedSteps: number;
  newtonIterations: number;
  jacobianEvaluations: number;
  events: number;
  cpuTimeMs: number;
  /** Whether the run reached finalTime. */
  completed: boolean;
  /** Number of alias variables removed by the structural analysis (`x = ±y + c`). */
  aliasEliminated?: number;
  /** Number of variables that were found to be constant (parameter-only equations) and propagated. */
  propagated?: number;
  /** States that were turned into algebraic variables by index reduction (dummy derivatives). */
  dummyStates?: string[];
}

export interface SimulationResult {
  className: string;
  options: SimulationOptions;
  time: number[];
  trajectories: Trajectory[];
  stats: SimulationStats;
  log: LogMessage[];
}

export function getTrajectory(result: SimulationResult, name: string): Trajectory | undefined {
  return result.trajectories.find((t) => t.name === name);
}
