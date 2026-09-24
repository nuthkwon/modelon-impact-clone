/**
 * Worker thread entry for `sim-worker.ts`.
 *
 * The server runs its TypeScript sources through tsx (`tsx src/index.ts`). tsx's ESM loader
 * only installs itself on the main thread: passing `--import tsx` (or the inherited
 * `--import …/tsx/dist/loader.mjs`) in a Worker's `execArgv` is a silent no-op, and
 * `--loader tsx/esm` is refused ("tsx must be loaded with --import"). Node's own type
 * stripping would load `.ts` files but cannot resolve the `./x.js` -> `x.ts` specifiers used
 * throughout the workspace. So this plain-JS bootstrap registers tsx's hooks inside the
 * worker and then loads the real body.
 */
import { register } from 'tsx/esm/api';

register();
await import('./sim-worker.ts');
