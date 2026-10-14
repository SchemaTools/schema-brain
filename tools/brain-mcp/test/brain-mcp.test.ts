// MCP-пакет против настоящего сервиса на временной базе. Записи и ярлыки — вымышленные.
import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { after, before, describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { buildApp, type App } from '../../../apps/server/src/app.ts';
import { createDb, type Db } from '../../../apps/server/src/db/client.ts';
import { addPerson, issueToken } from '../../../apps/server/src/services/people.ts';
import { startDb } from '../../../apps/server/test/db.ts';
import { createApi, handle, tools } from '../server.mjs';

let db: Db;
let app: App;
let stopDb: () => Promise<void>;
let url: string;
const token: Record<string, string> = {};

before(async () => {
  const started = await startDb();
  stopDb = started.stop;
  db = createDb(started.url);
  app = buildApp({ db, version: 'test' });
  await app.listen({ port: 0, host: '127.0.0.1' });
  url = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  const moderator = await addPerson(db, 'модератор');
  token.moderator = (await issueToken(db, moderator.id, 'claude', ['read', 'propose', 'feedback', 'moderate'])).token;
  const author = await addPerson(db, 'автор');
  token.author = (await issueToken(db, author.id, 'claude')).token;
  const colleague = await addPerson(db, 'коллега');
  token.colleague = (await issueToken(db, colleague.id, 'codex')).token;
});

after(async () => {
  await app?.close();
  await db?.$disconnect();
  await stopDb?.();
});

const agent = (who: string) => {
  const list = tools(createApi({ url, token: token[who] }));
  let id = 0;
  const rpc = (method: string, params?: object) =>
    handle({ jsonrpc: '2.0', id: ++id, method, params }, list, async () => null) as Promise<any>;
  const call = async (name: string, args: object) => {
    const response = await rpc('tools/call', { name, arguments: args });
    return { text: response.result.content[0].text as string, isError: response.result.isError === true };
  };
  return { rpc, call };
};

describe('MCP-пакет', () => {
  test('протокол: initialize, список инструментов, неизвестный метод', async () => {
    const { rpc } = agent('author');
    const init = await rpc('initialize', { protocolVersion: '2025-06-18' });
    assert.equal(init.result.serverInfo.name, 'schema-brain');
    const list = await rpc('tools/list');
    assert.equal(list.result.tools.length, 11);
    assert.equal((await rpc('nothing')).error.code, -32601);
    assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }, [], async () => null), null);
  });

  test('сценарий: отправка → модерация → поиск → отметка', async () => {
    const author = agent('author');
    const refused = await author.call('brain_propose', {
      kind: 'факт', text: 'Оси обрезаются при копировании листов, если зоны обрезки разные.', core: 'BIM и Revit', source: 'сессия', confirmed_by_author: false,
    });
    assert.ok(refused.isError);
    assert.match(refused.text, /только после «ок» автора/);

    const sent = await author.call('brain_propose', {
      kind: 'факт', text: 'Оси обрезаются при копировании листов, если зоны обрезки разные.', core: 'BIM и Revit', source: 'сессия', confirmed_by_author: true,
    });
    assert.match(sent.text, /^Отправлено: № 1 — на модерации\.$/);

    const moderator = agent('moderator');
    assert.match((await moderator.call('brain_queue', {})).text, /^№ 1 · факт · BIM и Revit/);
    assert.equal((await moderator.call('brain_moderate', { number: 1, decision: 'accept' })).text, '№ 1: принята');

    const colleague = agent('colleague');
    const found = await colleague.call('brain_search', { query: 'зоны обрезки | crop region' });
    assert.match(found.text, /^№ 1 · факт · BIM и Revit · нет отметок\nОси обрезаются/);
    assert.match((await colleague.call('brain_feedback', { number: '№ 1', worked: true })).text, /мало отметок · 1 за, 0 против/);

    const similar = await colleague.call('brain_propose', {
      kind: 'гипотеза', text: 'Оси на копиях листов обрезаются из-за разных зон обрезки видов.', core: 'BIM и Revit', source: 'сессия', confirmed_by_author: true,
    });
    assert.match(similar.text, /Похожие записи в базе — сравни/);
    assert.match(similar.text, /№ 1 · мало отметок/);
  });

  test('вопрос: повтор возвращает номер прежнего', async () => {
    const a = agent('author');
    const ask = { text: 'Нужно ли указывать стадию в имени файла альбома для заказчика?', core: 'Процессы бюро', source: 'сессия', confirmed_by_author: true };
    const first = await a.call('brain_ask', ask);
    assert.match(first.text, /^Вопрос записан: № \d+/);
    const again = await agent('colleague').call('brain_ask', { ...ask, text: 'Указывать ли стадию в имени файла альбома для заказчика?' });
    assert.match(again.text, /^Такой вопрос уже задан: № \d+/);
  });

  test('справочники и права', async () => {
    const a = agent('author');
    assert.match((await a.call('brain_cores', {})).text, /^Проектирование\nBIM и Revit\nПроцессы бюро\nИнструменты — Плагины, навыки, MCP$/);
    assert.equal((await a.call('brain_projects', {})).text, 'Проектов не найдено.');
    const denied = await a.call('brain_queue', {});
    assert.ok(denied.isError);
    assert.match(denied.text, /нет права на модерацию/);
    const bad = await a.call('brain_get', { number: 'abc' });
    assert.ok(bad.isError);
  });

  test('ошибки связи и токена — понятным текстом', async () => {
    const offline = tools(createApi({ url: 'http://127.0.0.1:9', token: token.author }));
    const search = offline.find((t) => t.name === 'brain_search')!;
    await assert.rejects(() => search.run({ query: 'оси' }), /не отвечает.*локальной сети/);
    const wrong = tools(createApi({ url, token: 'sbt_' + 'x'.repeat(43) }));
    await assert.rejects(() => wrong.find((t) => t.name === 'brain_search')!.run({ query: 'оси' }), /Токен доступа недействителен/);
    const empty = tools(createApi({ url: '', token: '' }));
    await assert.rejects(() => empty[0].run({ query: 'оси' }), /Не задан адрес/);
  });

  test('stdio: сотрудник не видит инструментов модератора', async () => {
    const child = spawn(process.execPath, [fileURLToPath(new URL('../server.mjs', import.meta.url))], {
      env: { ...process.env, SB_URL: url, SB_TOKEN: token.author },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const lines: any[] = [];
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf('\n')) >= 0) {
        lines.push(JSON.parse(buffer.slice(0, i)));
        buffer = buffer.slice(i + 1);
      }
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })}\n`);
    child.stdin.write('не json\n');
    child.stdin.end();
    await new Promise((resolve) => child.on('exit', resolve));
    const byId = new Map(lines.map((l) => [l.id, l]));
    assert.equal(byId.get(1).result.serverInfo.version, '0.1.0');
    const names = byId.get(2).result.tools.map((t: { name: string }) => t.name);
    assert.deepEqual(names, ['brain_search', 'brain_get', 'brain_propose', 'brain_ask', 'brain_feedback', 'brain_cores', 'brain_projects']);
    assert.equal(byId.get(null).error.code, -32700);
  });
});
