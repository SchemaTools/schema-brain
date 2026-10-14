// Настройки сервиса — из переменных окружения (на сервере — deploy/.env, в репозиторий не попадает).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../../', import.meta.url));

export interface Config {
  databaseUrl: string;
  port: number;
  host: string;
  cookieSecure: boolean;
  logLevel: string;
  migrationsDir: string;
  webDir: string;
  /** Schema Teams для списка проектов; пусто — проекты добавляются вручную */
  schemaTeams: { url: string; token: string } | null;
  version: string;
}

export const VERSION: string = JSON.parse(readFileSync(`${root}package.json`, 'utf8')).version;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env['DATABASE_URL'] ?? '';
  if (!databaseUrl) throw new Error('Не задан DATABASE_URL');
  const port = Number(env['PORT'] ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT — номер порта от 1 до 65535');
  return {
    databaseUrl,
    port,
    host: env['HOST'] ?? '0.0.0.0',
    cookieSecure: env['COOKIE_SECURE'] === 'true',
    logLevel: env['LOG_LEVEL'] ?? 'info',
    migrationsDir: env['MIGRATIONS_DIR'] ?? `${root}prisma/migrations`,
    webDir: env['WEB_DIR'] ?? `${root}apps/web/dist`,
    schemaTeams:
      env['SCHEMA_TEAMS_URL'] && env['SCHEMA_TEAMS_TOKEN']
        ? { url: env['SCHEMA_TEAMS_URL'], token: env['SCHEMA_TEAMS_TOKEN'] }
        : null,
    version: VERSION,
  };
}
