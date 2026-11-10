import { loadConfig } from './config.js';
import { createDb, migrate } from './db.js';
import { buildApp } from './app.js';
import { startJobs } from './jobs.js';

const cfg = loadConfig();
const db = createDb(cfg.DATABASE_URL);
await migrate(db);
const { app, ctx, bus } = await buildApp(cfg, db);
await bus.start(cfg.DATABASE_URL);
const stopJobs = cfg.JOBS_ENABLED ? startJobs(ctx, app.log) : () => {};
await app.listen({ port: cfg.PORT, host: cfg.HOST });
app.log.warn(`${cfg.APP_NAME} API prête sur :${cfg.PORT}${cfg.DEMO_MODE ? ' · MODE DÉMONSTRATION' : ''}`);

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    stopJobs();
    await app.close();
    await bus.stop();
    await db.end();
    process.exit(0);
  });
}
