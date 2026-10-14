// Локальный стенд без Docker: npm run dev:local (после npm run web:build).
// Временная PostgreSQL в private/dev-db (в репозиторий не попадает), модератор и несколько
// вымышленных записей при первом запуске, сервис с вебом на http://127.0.0.1:3000.
// Токен модератора — в private/dev-token.txt (только для этого стенда).
// -- --reset — начать с чистой базы.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import EmbeddedPostgres from 'embedded-postgres';
import { createDb } from '../apps/server/src/db/client.ts';
import { migrate } from '../apps/server/src/db/migrate.ts';
import { addPerson, issueToken } from '../apps/server/src/services/people.ts';
import { moderate, propose, feedback, setSoftware } from '../apps/server/src/services/records.ts';
import { systemCtx } from '../apps/server/src/context.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = `${root}private/dev-db`;
const PORT = Number(process.env['DEV_DB_PORT'] ?? 54331);
if (process.argv.includes('--reset')) rmSync(dir, { recursive: true, force: true });
const fresh = !existsSync(dir);
mkdirSync(`${root}private`, { recursive: true });

const pg = new EmbeddedPostgres({ databaseDir: dir, port: PORT, user: 'dev', password: 'dev', persistent: true, onLog: () => {} });
if (fresh) await pg.initialise();
await pg.start();
if (fresh) await pg.createDatabase('schema_brain');
const url = `postgresql://dev:dev@127.0.0.1:${PORT}/schema_brain`;
await migrate(url, `${root}prisma/migrations`);

if (fresh) {
  const db = createDb(url);
  const mod = await addPerson(db, 'модератор');
  const { token } = await issueToken(db, mod.id, 'web', ['read', 'propose', 'feedback', 'moderate'], 'стенд');
  writeFileSync(`${root}private/dev-token.txt`, `${token}\n`);
  const author = await addPerson(db, 'проектировщик АР-1');
  const colleague = await addPerson(db, 'проектировщик КЖ-1');
  const a = systemCtx(author.id, author.label, ['propose', 'feedback']);
  const c = systemCtx(colleague.id, colleague.label, ['propose', 'feedback']);
  const m = systemCtx(mod.id, mod.label);
  a.client = 'claude';
  c.client = 'codex';
  const base = { source: 'вымышленная запись стенда', confirmed_by_author: true };
  const r1 = await propose(db, a, { ...base, type: 'вывод', kind: 'факт', core: 'BIM и Revit', software_version: 'Revit 2026', not_applicable: 'для связанных файлов с общими уровнями', text: 'При копировании листов с планами оси обрезаются, если у видов разные зоны обрезки; перед копированием выровнять зоны по шаблонному виду.' });
  const r2 = await propose(db, c, { ...base, type: 'вывод', kind: 'правило', core: 'Проектирование', text: 'Марку двери в спецификации ставим по типоразмеру, а не по помещению: одна марка — один типоразмер с одинаковым заполнением и открыванием.' });
  const r3 = await propose(db, a, { ...base, type: 'вывод', kind: 'гипотеза', core: 'BIM и Revit', software_version: 'Revit 2025', text: 'Синхронизация с центральной моделью замедляется, если в модели больше сотни экземпляров одной вложенной группы.' });
  await propose(db, c, { ...base, type: 'вопрос', core: 'Процессы бюро', text: 'Нужно ли указывать стадию в имени PDF-файла альбома при отправке заказчику?' });
  await propose(db, c, { ...base, type: 'вывод', kind: 'факт', core: 'BIM и Revit', contradicts: [r3.record.number], text: 'Синхронизация не зависит от числа групп; медленно — из-за связанных файлов без общих координат.' });
  await moderate(db, m, r1.record.number, { decision: 'accept' });
  await moderate(db, m, r2.record.number, { decision: 'accept' });
  await moderate(db, m, r3.record.number, { decision: 'accept' });
  await feedback(db, c, r1.record.number, { worked: true });
  await setSoftware(db, m, 'Revit', '2027');
  await db.$disconnect();
  console.log('Стенд создан: модератор и вымышленные записи. Токен модератора — private/dev-token.txt');
}

const server = spawn(process.execPath, [`${root}apps/server/src/main.ts`], {
  env: { ...process.env, DATABASE_URL: url, PORT: process.env['PORT'] ?? '3000', HOST: '127.0.0.1', LOG_LEVEL: 'warn' },
  stdio: 'inherit',
});
console.log(`Schema Brain: http://127.0.0.1:${process.env['PORT'] ?? 3000}`);
const stop = async () => {
  server.kill('SIGTERM');
  await pg.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
server.on('exit', async () => {
  await pg.stop();
  process.exit(0);
});
