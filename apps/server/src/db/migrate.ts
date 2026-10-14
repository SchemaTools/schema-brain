// Применение миграций базы — по образцу Schema Teams: только вперёд, каждая — в транзакции;
// неудачная откатывается целиком, и сервис со старой схемой не стартует.
// Файлы миграций — prisma/migrations/<имя>/migration.sql; служебная программа Prisma
// в рабочий сервис не входит.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

/** Постоянное число: замок, чтобы два запуска не применяли миграции одновременно. */
const MIGRATION_LOCK_ID = 5_118_204;

export interface Migration {
  name: string;
  sql: string;
  checksum: string;
}

export function readMigrations(dir: string): Migration[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'migration.sql')))
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      // переводы строк — к одному виду: сумма не зависит от системы
      const sql = readFileSync(join(dir, name, 'migration.sql'), 'utf8').replace(/\r\n/g, '\n');
      return { name, sql, checksum: createHash('sha256').update(sql).digest('hex') };
    });
}

/** Применяет недостающие миграции по порядку. Возвращает имена применённых. */
export async function migrate(databaseUrl: string, dir: string): Promise<string[]> {
  const migrations = readMigrations(dir);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migration (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    const { rows } = await client.query<{ name: string; checksum: string }>(
      'SELECT name, checksum FROM schema_migration',
    );
    const applied = new Map(rows.map((row) => [row.name, row.checksum]));
    for (const name of applied.keys()) {
      if (!migrations.some((m) => m.name === name)) {
        throw new Error(`В базе применена миграция ${name}, которой нет в этой версии сервиса`);
      }
    }
    const done: string[] = [];
    for (const migration of migrations) {
      const checksum = applied.get(migration.name);
      if (checksum !== undefined) {
        if (checksum !== migration.checksum) {
          throw new Error(`Применённая миграция ${migration.name} изменена. Нужна новая миграция`);
        }
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migration (name, checksum) VALUES ($1, $2)', [
          migration.name,
          migration.checksum,
        ]);
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Миграция ${migration.name} не применена и откатана`, { cause: error });
      }
      done.push(migration.name);
    }
    return done;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => {});
    await client.end();
  }
}
