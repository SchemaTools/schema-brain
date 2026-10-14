// Запуск сервиса: миграции, затем HTTP. Миграция не применилась — сервис не стартует.
import { buildApp } from './app.ts';
import { loadConfig } from './config.ts';
import { createDb } from './db/client.ts';
import { migrate } from './db/migrate.ts';

const config = loadConfig();
const applied = await migrate(config.databaseUrl, config.migrationsDir);
const db = createDb(config.databaseUrl);
const app = buildApp({ db, version: config.version, cookieSecure: config.cookieSecure, logger: { level: config.logLevel } });
if (applied.length) app.log.info({ applied }, 'миграции применены');

const stop = async () => {
  await app.close();
  await db.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);

await app.listen({ port: config.port, host: config.host });
app.log.info(`Schema Brain ${config.version} слушает порт ${config.port}`);
