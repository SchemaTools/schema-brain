// Сквозные проверки сервиса на временной базе. Все записи и ярлыки — вымышленные.
import { strict as assert } from 'node:assert';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, test } from 'node:test';
import { buildApp, type App } from '../src/app.ts';
import { systemCtx } from '../src/context.ts';
import { createDb, type Db } from '../src/db/client.ts';
import { migrate } from '../src/db/migrate.ts';
import { exportDataset, importFolder, wikiPage } from '../src/services/exchange.ts';
import { addPerson, issueToken } from '../src/services/people.ts';
import { startDb } from './db.ts';

let db: Db;
let app: App;
let stopDb: () => Promise<void>;
let dbUrl: string;
const tokens: Record<string, string> = {};

const call = async (who: string | null, method: string, url: string, payload?: object) => {
  const response = await app.inject({
    method: method as 'GET',
    url,
    payload,
    headers: who ? { authorization: `Bearer ${tokens[who]}` } : {},
  });
  return { status: response.statusCode, body: response.json() as Record<string, any>, headers: response.headers };
};

const fact = (text: string, extra: object = {}) => ({
  type: 'вывод', kind: 'факт', core: 'BIM и Revit', text, source: 'сессия 2026-10-15, задача «тест»', confirmed_by_author: true, ...extra,
});

before(async () => {
  const started = await startDb();
  stopDb = started.stop;
  dbUrl = started.url;
  db = createDb(dbUrl);
  app = buildApp({ db, version: 'test', proposeLimit: 1000 });
  const moderator = await addPerson(db, 'модератор');
  tokens.moderator = (await issueToken(db, moderator.id, 'web', ['read', 'propose', 'feedback', 'moderate'])).token;
  for (const label of ['автор', 'коллега 1', 'коллега 2', 'коллега 3']) {
    const person = await addPerson(db, label);
    tokens[label] = (await issueToken(db, person.id, 'claude')).token;
  }
  const reader = await addPerson(db, 'читатель');
  tokens.reader = (await issueToken(db, reader.id, 'chatgpt', ['read'])).token;
  // второй агент того же сотрудника
  const colleague = await db.person.findUniqueOrThrow({ where: { label: 'коллега 1' } });
  tokens['коллега 1 codex'] = (await issueToken(db, colleague.id, 'codex')).token;
});

after(async () => {
  await app?.close();
  await db?.$disconnect();
  await stopDb?.();
});

describe('сервис', () => {
  test('состояние без токена; без токена остальное — 401', async () => {
    assert.deepEqual((await call(null, 'GET', '/api/health')).body, { ok: true, version: 'test' });
    assert.equal((await call(null, 'GET', '/api/search?q=оси')).status, 401);
    assert.equal(
      (await app.inject({ method: 'GET', url: '/api/me', headers: { authorization: 'Bearer sbt_' + 'x'.repeat(43) } })).statusCode,
      401,
    );
  });

  test('миграции повторно — ничего не применяют', async () => {
    const dir = new URL('../../../prisma/migrations', import.meta.url);
    assert.deepEqual(await migrate(dbUrl, decodeURIComponent(dir.pathname.replace(/^\/([A-Za-z]:)/, '$1'))), []);
  });

  test('двойной контроль: без «ок» автора запись не принимается', async () => {
    const r = await call('автор', 'POST', '/api/records', fact('Текст', { confirmed_by_author: false }));
    assert.equal(r.status, 400);
    assert.match(r.body.details.join(), /только после «ок» автора/);
  });

  test('права: токен только на чтение не отправляет; очередь — только модератору', async () => {
    assert.equal((await call('reader', 'POST', '/api/records', fact('Текст'))).status, 403);
    assert.equal((await call('автор', 'GET', '/api/queue')).status, 403);
  });

  test('отправка → модерация → поиск; ожидающая запись агенту не видна, но её счётчик растёт', async () => {
    const sent = await call('автор', 'POST', '/api/records', fact('При копировании листов оси обрезаются, если у видов разные зоны обрезки.', { software_version: 'Revit 2026' }));
    assert.equal(sent.status, 201);
    assert.equal(sent.body.record.status, 'pending');
    const number = sent.body.record.number;

    const hidden = await call('коллега 2', 'GET', '/api/search?q=зона обрезки');
    assert.equal(hidden.body.records.length, 0);
    assert.equal(hidden.body.text, 'Ничего не найдено.');
    const waiting = await call('moderator', 'GET', `/api/records/${number}`);
    assert.equal(waiting.body.record.requestsCount, 1);

    const accepted = await call('moderator', 'POST', `/api/records/${number}/moderate`, { decision: 'accept', comment: 'проверено' });
    assert.equal(accepted.body.record.status, 'accepted');

    const found = await call('коллега 2', 'GET', '/api/search?q=' + encodeURIComponent('обрезка видов | crop'));
    assert.equal(found.body.records.length, 1);
    assert.match(found.body.text, /^№ \d+ · факт · BIM и Revit · нет отметок\nПри копировании листов/);
  });

  test('отметки: по людям, автор не считается, два «не сработало» — ложная и скрыта', async () => {
    const sent = await call('автор', 'POST', '/api/records', fact('Параметр марки у вложенных семейств не попадает в спецификацию основного.'));
    const n = sent.body.record.number;
    await call('moderator', 'POST', `/api/records/${n}/moderate`, { decision: 'accept' });

    await call('автор', 'POST', `/api/records/${n}/feedback`, { worked: true });
    let r = await call('коллега 1', 'POST', `/api/records/${n}/feedback`, { worked: false });
    assert.equal(r.body.text, `№ ${n}: мало отметок · 0 за, 1 против`);
    r = await call('коллега 1 codex', 'POST', `/api/records/${n}/feedback`, { worked: false }); // тот же человек
    assert.equal(r.body.text, `№ ${n}: мало отметок · 0 за, 1 против`);
    r = await call('коллега 2', 'POST', `/api/records/${n}/feedback`, { worked: false });
    assert.equal(r.body.text, `№ ${n}: ложная · 0 за, 2 против`);

    assert.equal((await call('коллега 3', 'GET', '/api/search?q=вложенных семейств')).body.records.length, 0);
    assert.equal((await call('коллега 3', 'GET', '/api/search?q=вложенных семейств&false=true')).body.records.length, 1);

    r = await call('коллега 1', 'POST', `/api/records/${n}/feedback`, { worked: true }); // передумал
    assert.equal(r.body.text, `№ ${n}: 33 % · 1 за, 1 против`);
    assert.equal((await call('коллега 1', 'POST', `/api/records/${n}/feedback`, { worked: 'да' })).status, 400);
  });

  test('противоречие фактов: оба принятых выдаются рядом', async () => {
    const a = (await call('автор', 'POST', '/api/records', fact('Связанный файл с общими уровнями сдвигает отметки при обновлении.'))).body.record.number;
    await call('moderator', 'POST', `/api/records/${a}/moderate`, { decision: 'accept' });
    const sent = await call('коллега 1', 'POST', '/api/records', fact('Связанный файл с общими уровнями не сдвигает отметки, если координаты общие.', { contradicts: [a] }));
    assert.equal(sent.body.record.status, 'disputed');
    const b = sent.body.record.number;
    const queue = await call('moderator', 'GET', '/api/queue');
    assert.equal(queue.body.records[0].number, b, 'противоречие — первым в очереди');
    await call('moderator', 'POST', `/api/records/${b}/moderate`, { decision: 'accept' });
    const found = await call('коллега 3', 'GET', '/api/search?q=связанный файл общие уровни');
    assert.match(found.body.text, new RegExp(`Противоречит: № ${b}`));
  });

  test('правило бюро: соперников нет — принять нельзя, только заменить', async () => {
    const rule = (text: string, extra = {}) => fact(text, { kind: 'правило', core: 'Проектирование', ...extra });
    const old = (await call('автор', 'POST', '/api/records', rule('Марку двери в спецификации ставим по помещению.'))).body.record.number;
    await call('moderator', 'POST', `/api/records/${old}/moderate`, { decision: 'accept' });
    const sent = await call('коллега 2', 'POST', '/api/records', rule('Марку двери ставим по типоразмеру, а не по помещению.', { contradicts: [old] }));
    assert.equal(sent.body.record.status, 'disputed');
    const fresh = sent.body.record.number;
    const refused = await call('moderator', 'POST', `/api/records/${fresh}/moderate`, { decision: 'accept' });
    assert.equal(refused.status, 400);
    assert.match(refused.body.message, /противоречит правилу бюро/);
    const replaced = await call('moderator', 'POST', `/api/records/${fresh}/moderate`, { decision: 'replace', target: old });
    assert.equal(replaced.body.record.status, 'accepted');
    assert.equal((await call('moderator', 'GET', `/api/records/${old}`)).body.record.status, 'replaced');
    const card = await call('moderator', 'GET', `/api/records/${fresh}?history=true`);
    assert.deepEqual(card.body.links.map((l: any) => l.type), ['replaces']);
    assert.deepEqual(card.body.history.map((h: any) => h.kind), ['created', 'moderated']);
  });

  test('вопрос: без модерации, повтор поднимает счётчик, принятый ответ — «есть ответ»', async () => {
    const ask = { type: 'вопрос', core: 'Процессы бюро', text: 'Нужно ли указывать стадию в имени файла альбома для заказчика?', source: 'сессия', confirmed_by_author: true };
    const first = await call('автор', 'POST', '/api/records', ask);
    assert.equal(first.status, 201);
    assert.equal(first.body.record.status, 'open');
    const again = await call('коллега 1', 'POST', '/api/records', { ...ask, text: 'Указывать ли стадию в имени файла альбома для заказчика?' });
    assert.equal(again.status, 200);
    assert.equal(again.body.existing, true);
    assert.equal(again.body.record.number, first.body.record.number);
    assert.equal(again.body.record.askedCount, 1);

    const q = first.body.record.number;
    const answer = await call('moderator', 'POST', '/api/records', { ...fact('Стадию указываем в конце имени файла альбома: «…_Р.pdf».'), kind: 'правило', core: 'Процессы бюро', answers: [q] });
    await call('moderator', 'POST', `/api/records/${answer.body.record.number}/moderate`, { decision: 'accept' });
    const card = await call('автор', 'GET', `/api/records/${q}`);
    assert.equal(card.body.record.status, 'answered');
    assert.match(card.body.text, new RegExp(`Ответы: № ${answer.body.record.number}`));
  });

  test('смена версии: пометка «проверить», снимается отметкой на текущей версии', async () => {
    const set = await call('moderator', 'PUT', '/api/software', { product: 'Revit', version: '2027' });
    assert.match(set.body.text, /пометка «проверить» — у 1 записей/);
    const found = await call('коллега 3', 'GET', '/api/search?q=зоны обрезки');
    assert.match(found.body.text, /Проверить: записано для Revit 2026, текущая — Revit 2027\./);
    const n = found.body.records[0].number;
    const r = await call('коллега 3', 'POST', `/api/records/${n}/feedback`, { worked: true, software_version: 'Revit 2027' });
    assert.match(r.body.text, /пометка «проверить» снята/);
  });

  test('правка модератором: чужая версия — 409, длинный текст — 400', async () => {
    const n = (await call('автор', 'POST', '/api/records', fact('Черновик для правки.'))).body.record.number;
    const ok = await call('moderator', 'PATCH', `/api/records/${n}`, { text: 'Поправленный текст.', version: 1 });
    assert.equal(ok.body.text, 'Поправленный текст.');
    assert.equal((await call('moderator', 'PATCH', `/api/records/${n}`, { text: 'Ещё', version: 1 })).status, 409);
    assert.equal((await call('moderator', 'PATCH', `/api/records/${n}`, { text: 'ё'.repeat(301) })).status, 400);
  });

  test('связи модератором и граф', async () => {
    const a = (await call('автор', 'POST', '/api/records', fact('Исходный факт для графа.'))).body.record.number;
    const b = (await call('автор', 'POST', '/api/records', fact('Следствие для графа.'))).body.record.number;
    const linked = await call('moderator', 'POST', '/api/links', { from: b, to: `№ ${a}`, type: 'derived_from' });
    assert.match(linked.body.text, new RegExp(`№ ${b} выведена из № ${a}`));
    assert.equal((await call('moderator', 'POST', '/api/links', { from: a, to: a, type: 'derived_from' })).status, 400);
    const g = await call('автор', 'GET', `/api/graph?center=${a}&depth=2`);
    assert.deepEqual(g.body.nodes.map((n: any) => n.number).sort(), [a, b].sort());
    assert.deepEqual(g.body.edges, [{ from: b, to: a, type: 'derived_from' }]);
  });

  test('список для разбора — короткими строками', async () => {
    const r = await call('moderator', 'GET', '/api/records?core=bim&status=принята');
    assert.ok(r.body.total >= 3);
    assert.match(r.body.text, /^№ \d+ · факт · принята · /m);
  });

  test('поиск: «B25» латиницей находит «В25»', async () => {
    const n = (await call('автор', 'POST', '/api/records', fact('Класс бетона В25 для фундаментной плиты по умолчанию.', { core: 'Проектирование' }))).body.record.number;
    await call('moderator', 'POST', `/api/records/${n}/moderate`, { decision: 'accept' });
    const r = await call('коллега 2', 'GET', '/api/search?q=B25');
    assert.equal(r.body.records[0]?.number, n);
  });

  test('вход в веб по токену: cookie сеанса, выход', async () => {
    const login = await app.inject({ method: 'POST', url: '/api/session', payload: { token: tokens.moderator } });
    assert.equal(login.statusCode, 200);
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    const me = await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } });
    assert.equal(me.json().label, 'модератор');
    await app.inject({ method: 'DELETE', url: '/api/session', headers: { cookie } });
    assert.equal((await app.inject({ method: 'GET', url: '/api/me', headers: { cookie } })).statusCode, 401);
    assert.equal((await app.inject({ method: 'POST', url: '/api/session', payload: { token: 'чужой' } })).statusCode, 401);
  });

  test('отзыв токена', async () => {
    const person = await addPerson(db, 'временный');
    const issued = await issueToken(db, person.id, 'claude');
    tokens.temp = issued.token;
    assert.equal((await call('temp', 'GET', '/api/me')).status, 200);
    await call('moderator', 'DELETE', `/api/tokens/${issued.id}`);
    assert.equal((await call('temp', 'GET', '/api/me')).status, 401);
  });

  test('импорт md шага 0: принято, повтор пропущен, ошибки с причиной', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'brain-import-'));
    const format = readFileSync(new URL('../../../skills/vyvody/vyvody/references/format.md', import.meta.url), 'utf8');
    const examples = [...format.matchAll(/```markdown\r?\n([\s\S]*?)```/g)].map((m) => m[1]);
    examples.forEach((text, i) => writeFileSync(join(folder, `2026-10-15 — пример ${i + 1}.md`), text));
    writeFileSync(join(folder, '2026-10-15 — плохой.md'), '---\ntype: вывод\n---\nбез полей');
    const person = await db.person.findUniqueOrThrow({ where: { label: 'коллега 3' } });
    const ctx = systemCtx(person.id, person.label, ['propose']);
    const first = await importFolder(db, ctx, folder);
    assert.equal(first.accepted.length, 4);
    assert.equal(first.failed.length, 1);
    const second = await importFolder(db, ctx, folder);
    assert.equal(second.accepted.length, 0);
    assert.equal(second.skipped.length, 4);
    const card = await call('moderator', 'GET', `/api/records/${first.accepted[0].number}`);
    assert.match(card.body.record.source, /импорт md: 2026-10-15 — пример 1\.md/);
  });

  test('датасет JSONL: ярлыки вместо людей, без токенов', async () => {
    const folder = mkdtempSync(join(tmpdir(), 'brain-dataset-'));
    const meta = await exportDataset(db, folder, 'test');
    assert.deepEqual(readdirSync(folder).sort(), ['events.jsonl', 'feedback.jsonl', 'links.jsonl', 'meta.json', 'records.jsonl']);
    assert.ok(meta.counts.records > 5);
    const all = readdirSync(folder).map((f) => readFileSync(join(folder, f), 'utf8')).join('\n');
    assert.ok(!all.includes('sbt_'));
    const record = JSON.parse(readFileSync(join(folder, 'records.jsonl'), 'utf8').split('\n')[0]);
    assert.equal(record.author, 'автор');
  });

  test('страница справки: принятые правила и факты ядра', async () => {
    const page = await wikiPage(db, 'Проектирование');
    assert.match(page, /^# Проектирование: выводы Schema Brain/);
    assert.match(page, /## Правила бюро\n\n- \*\*№ \d+\.\*\* Марку двери ставим по типоразмеру/);
    assert.doesNotMatch(page, /в спецификации ставим по помещению/, 'заменённое правило не попадает');
  });

  test('веб: страница приложения на любом не-API адресе; неизвестный API — 404', async () => {
    const webDir = mkdtempSync(join(tmpdir(), 'brain-web-'));
    writeFileSync(join(webDir, 'index.html'), '<!doctype html><title>Schema Brain</title>');
    const web = buildApp({ db, version: 'test', webDir });
    const page = await web.inject({ method: 'GET', url: '/' });
    assert.equal(page.statusCode, 200);
    assert.match(page.body, /<title>Schema Brain<\/title>/);
    assert.match((await web.inject({ method: 'GET', url: '/queue' })).body, /Schema Brain/);
    const api = await web.inject({ method: 'GET', url: '/api/nothing' });
    assert.equal(api.statusCode, 404);
    assert.equal(api.json().error, 'not_found');
    await web.close();
  });

  test('проекты из Schema Teams: новые, обновлённые, снятые; ручные не трогаются; имена не читаются', async () => {
    const { syncProjects } = await import('../src/services/projects.ts');
    await db.project.create({ data: { code: 'РУЧНОЙ-1', name: 'добавлен вручную' } });
    let objects: object[] = [
      { id: 101, code: '01/2026-01', name: 'Объект А', client: 'Заказчик', gip: { name: 'Иванова И.И.' } },
      { id: 102, code: '01/2026-02', name: 'Объект Б' },
    ];
    const fake = (async (url: string, init: RequestInit) => {
      assert.match(String(url), /\/api\/objects\?status=active$/);
      assert.equal((init.headers as Record<string, string>).authorization, 'Bearer stt_тест');
      return new Response(JSON.stringify({ objects, counts: null }), { status: 200 });
    }) as unknown as typeof fetch;
    const opts = { url: 'http://schema-teams.test/', token: 'stt_тест', fetch: fake };

    assert.equal((await syncProjects(db, opts)).text, 'Проекты из Schema Teams: новых 2, обновлено 0, неактивных 0');
    objects = [{ id: 101, code: '01/2026-01', name: 'Объект А (переименован)' }];
    assert.equal((await syncProjects(db, opts)).text, 'Проекты из Schema Teams: новых 0, обновлено 1, неактивных 1');

    const projects = await db.project.findMany({ orderBy: { code: 'asc' }, where: { code: { in: ['01/2026-01', '01/2026-02', 'РУЧНОЙ-1'] } } });
    assert.deepEqual(
      projects.map((p) => [p.code, p.name, p.active]),
      [['01/2026-01', 'Объект А (переименован)', true], ['01/2026-02', 'Объект Б', false], ['РУЧНОЙ-1', 'добавлен вручную', true]],
    );
    const listed = await call('автор', 'GET', '/api/projects');
    assert.ok(!JSON.stringify(listed.body).includes('Иванова'));
    assert.ok(!listed.body.some((p: { code: string }) => p.code === '01/2026-02'), 'неактивный не показывается');

    const denied = (async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    await assert.rejects(() => syncProjects(db, { ...opts, fetch: denied }), /не принял токен/);
    const button = await call('moderator', 'POST', '/api/projects/sync');
    assert.equal(button.status, 400);
    assert.match(button.body.message, /Schema Teams не настроен/);
  });

  test('не больше N отправок в час с одного токена', async () => {
    const limited = buildApp({ db, version: 'test', proposeLimit: 2 });
    const send = () =>
      limited.inject({ method: 'POST', url: '/api/records', payload: fact('Запись для проверки лимита.'), headers: { authorization: `Bearer ${tokens['коллега 2']}` } });
    assert.equal((await send()).statusCode, 201);
    assert.equal((await send()).statusCode, 201);
    assert.equal((await send()).statusCode, 429);
    await limited.close();
  });
});
