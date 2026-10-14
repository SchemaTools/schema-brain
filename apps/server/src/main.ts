// Запуск сервиса: миграции, затем HTTP. Миграция не применилась — сервис не стартует.
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDb } from './db/client.ts';
import { migrate } from './db/migrate.ts';
import { syncProjects } from './services/projects.ts';

const config = loadConfig();
const applied = await migrate(config.databaseUrl, config.migrationsDir);
const db = createDb(config.databaseUrl);
const app = buildApp({ db, version: config.version, cookieSecure: config.cookieSecure, webDir: config.webDir, schemaTeams: config.schemaTeams, logger: { level: config.logLevel } });
if (applied.length) app.log.info({ applied }, 'миграции применены');

// проекты из Schema Teams — при запуске и раз в час (раздел 9.2)
let timer: NodeJS.Timeout | undefined;
if (config.schemaTeams) {
  const teams = config.schemaTeams;
  const sync = () =>
    syncProjects(db, teams).then(
      (r) => app.log.info(r.text),
      (e: Error) => app.log.warn(`синхронизация проектов: ${e.message}`),
    );
  void sync();
  timer = setInterval(sync, 3_600_000);
}

const stop = async () => {
  if (timer) clearInterval(timer);
  await app.close();
  await db.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

await app.listen({ port: config.port, host: config.host });
app.log.info(`Schema Brain ${config.version} слушает порт ${config.port}`);
