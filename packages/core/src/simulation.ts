/**
 * Simulation options, results and log types shared by the solver, the server and the UI.
 * Option names follow Modelon Impact's `dynamic` custom function.
 */

/** Solver names offered in the UI. They map onto the integrators implemented in `solver/`. */
export type SolverName = 'CVode' | 'Radau5' | 'Explicit Euler' | 'Runge-Kutta' | 'Implicit Euler';

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
