// Временная PostgreSQL для тестов (как в Schema Teams): во временной папке системы,
// после тестов останавливается и удаляется. В CI можно дать свою базу через DATABASE_URL.
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate } from '../src/db/migrate.ts';

const MIGRATIONS = fileURLToPath(new URL('../../../prisma/migrations', import.meta.url));

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => (address && typeof address === 'object' ? resolve(address.port) : reject(new Error('нет порта'))));
    });
  });
}

export async function startDb(): Promise<{ url: string; stop: () => Promise<void> }> {
  if (process.env['DATABASE_URL']) {
    await migrate(process.env['DATABASE_URL'], MIGRATIONS);
    return { url: process.env['DATABASE_URL'], stop: async () => {} };
  }
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const dir = mkdtempSync(join(tmpdir(), 'schema-brain-test-db-'));
  const port = await freePort();
  const pg = new EmbeddedPostgres({
    databaseDir: join(dir, 'data'),
    port,
    user: 'test',
    password: 'test',
    // папку удаляем сами в stop(): удаление внутри библиотеки падает на Windows с EBUSY
    persistent: true,
    onLog: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('schema_brain_test');
  const url = `postgresql://test:test@127.0.0.1:${port}/schema_brain_test`;
  await migrate(url, MIGRATIONS);
  return {
    url,
    stop: async () => {
      await pg.stop();
      // Windows отпускает файлы базы не сразу после остановки — несколько попыток;
      // не удалилась — остаётся во временной папке системы, на результат тестов это не влияет
      try {
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
      } catch (error) {
        console.warn(`Временная база не удалена: ${dir} (${(error as NodeJS.ErrnoException).code})`);
      }
    },
  };
}
