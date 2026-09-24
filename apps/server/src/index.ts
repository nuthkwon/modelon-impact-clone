/**
 * Server entry point. Environment: `PORT` (default 8080), `DATA_DIR`, `LIBRARIES_DIR`,
 * `MAX_CASES` (sweep expansion cap, default 1000), `CORS_ORIGIN` (comma-separated allowed
 * origins; unset = same-origin only), `SERVER_FILE_ACCESS` (`off` disables browsing/importing
 * libraries from the server filesystem).
 */
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 8080);
const app = createApp();

const server = app.listen(port, () => {
  app.context.log(`Modelon Impact clone server v${app.context.version} listening on http://localhost:${port}`);
  app.context.log(`data directory: ${app.context.storage.dataDir}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    app.context.jobs.shutdown();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
