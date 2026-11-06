// Векторы смысла на временной базе — с тестовой моделью (мешок основ слов); настоящая e5 — вручную на стенде.
import { strict as assert } from 'node:assert';
import { after, before, test } from 'node:test';
import { buildApp, type App } from '../src/app.ts';
import { createDb, type Db } from '../src/db/client.ts';
import { HashEmbedder } from '../src/embed/e5.ts';
import { addPerson, issueToken } from '../src/services/people.ts';
import { embedPending } from '../src/services/vectors.ts';
import { startDb } from './db.ts';

let db: Db;
let app: App;
let stopDb: () => Promise<void>;
const tokens: Record<string, string> = {};

const call = async (who: string | null, method: string, url: string, payload?: object) => {
  const response = await app.inject({ method: method as 'GET', url, payload, headers: who ? { authorization: `Bearer ${tokens[who]}` } : {} });
  return { status: response.statusCode, body: response.json() as Record<string, any> };
};
const fact = (text: string) => ({ type: 'вывод', kind: 'факт', core: 'BIM и Revit', text, source: 'сессия 2026-11-06, задача «тест»', confirmed_by_author: true });
const accepted = async (text: string) => {
  const n = (await call('автор', 'POST', '/api/records', fact(text))).body.record.number as number;
  await call('moderator', 'POST', `/api/records/${n}/moderate`, { decision: 'accept' });
  return n;
};
const stored = (n: number) =>
  db.$queryRaw<{ model: string | null; embedded: number | null; version: number; len: number | null }[]>`
    SELECT embedding_model AS model, embedded_version AS embedded, version, array_length(embedding, 1) AS len FROM record WHERE number = ${n}`.then((r) => r[0]!);

before(async () => {
  const started = await startDb();
  stopDb = started.stop;
  db = createDb(started.url);
  app = buildApp({ db, version: 'test', proposeLimit: 1000, embedder: new HashEmbedder(64) });
  const moderator = await addPerson(db, 'модератор');
  tokens.moderator = (await issueToken(db, moderator.id, 'web', ['read', 'propose', 'feedback', 'moderate'])).token;
  const author = await addPerson(db, 'автор');
  tokens['автор'] = (await issueToken(db, author.id, 'claude')).token;
});

after(async () => {
  await app?.close();
  await db?.$disconnect();
  await stopDb?.();
});

test('состояние показывает модель векторов', async () => {
  assert.equal((await call(null, 'GET', '/api/health')).body.vectors, 'hash');
});

test('вектор считается у записи и пересчитывается после правки текста', async () => {
  const n = await accepted('Зоны обрезки видов выравнивать по шаблонному виду перед копированием листов.');
  await embedPending(db);
  const first = await stored(n);
  assert.equal(first.model, 'hash');
  assert.equal(first.len, 64);
  assert.equal(first.embedded, first.version);
  const card = (await call('moderator', 'GET', `/api/records/${n}`)).body.record;
  assert.equal((await call('moderator', 'PATCH', `/api/records/${n}`, { text: 'Зоны обрезки выравнивать до копирования листов.', version: card.version })).status, 200);
  await embedPending(db);
  const second = await stored(n);
  assert.ok(second.version > first.version, 'правка меняет версию записи');
  assert.equal(second.embedded, second.version, 'вектор посчитан для нового текста');
});

test('поиск по смыслу находит то, чего не находят слова', async () => {
  const n = await accepted('Обрезочные рамки на листе съезжают при печати в PDF.');
  // «обрезочн» и «обрезк» — разные основы для поиска по словам; тестовая модель видит общее начало
  const words = await db.$queryRaw<{ n: number }[]>`
    SELECT number AS n FROM record WHERE search_vector @@ to_tsquery('russian', 'обрезка') AND number = ${n}`;
  assert.equal(words.length, 0, 'слова запись не находят');
  const r = await call('автор', 'GET', '/api/search?q=обрезка рамка');
  assert.ok(r.body.records.some((x: any) => x.number === n), r.body.text);
});

test('похожие при отправке — тоже по смыслу', async () => {
  const n = await accepted('Шаблон вида задаёт видимость категорий на планах этажей.');
  const sent = await call('автор', 'POST', '/api/records', fact('Видимость категорий на планах задаётся шаблоном вида.'));
  assert.ok(sent.body.similar.some((x: any) => x.number === n));
});

test('память: облако записей в осях смысла, вопрос — точка с найденными и связанными', async () => {
  const a = await accepted('Связанный файл без общих координат сдвигает отметки уровней при обновлении.');
  const sent = await call('автор', 'POST', '/api/records', { ...fact('Синхронизация медленная из-за отметок связанного файла.'), derived_from: [a] });
  const b = sent.body.record.number as number;
  await call('moderator', 'POST', `/api/records/${b}/moderate`, { decision: 'accept' });
  const m = (await call('автор', 'GET', '/api/memory')).body;
  assert.equal(m.vectors, 'hash');
  assert.ok(m.nodes.length >= 2);
  for (const n of m.nodes) for (const c of [n.x, n.y, n.z]) assert.ok(Math.abs(c) <= 1 + 1e-9, `координата ${c}`);
  assert.ok(m.links.some((l: any) => l.from === b && l.to === a && l.type === 'derived_from'));
  const q = (await call('автор', 'GET', `/api/memory/query?q=${encodeURIComponent('связанный файл координаты отметки')}`)).body;
  assert.ok(q.found.includes(a), JSON.stringify(q.found));
  assert.equal(typeof q.point.x, 'number');
  assert.ok(q.scores[0].score >= q.scores.at(-1).score, 'близость — по убыванию');
  if (!q.found.includes(b)) assert.ok(q.linked.includes(b), 'связанная запись подтягивается');
  assert.equal((await call('автор', 'GET', '/api/memory/query?q=')).status, 400);
});
